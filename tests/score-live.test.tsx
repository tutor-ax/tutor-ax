import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScoreLive from "../src/admin/ScoreLive";
import { DEFAULT_ITEMS } from "../src/domain";
import { changedFields, fieldsOf, scoreEq, withCarry } from "../src/scoreSheet";
import { groupPicks, groupStats, movedFrom, nextItemKey } from "../src/weekGroup";
import type { AdminWeek } from "../src/adminApi";

const items = DEFAULT_ITEMS.filter((i) => i.active).map((i) => (i.key === "word_score" ? { ...i, cut: 20 } : i));

it("compares like score-system and carries the nearest earlier homework only into an empty row", () => {
  expect(scoreEq("", null)).toBe(true);
  expect(scoreEq("10", 10.0)).toBe(true);
  expect(scoreEq(" 잘함 ", "잘함")).toBe(true);
  expect(scoreEq(false, null)).toBe(false);
  const empty = fieldsOf(undefined, items);
  expect(empty).toMatchObject({ attendance: true, "score:word_score": null, "retest:word_score": false });
  // retest shows only below the cut: an old pass on a score above the cut is not a field
  expect(fieldsOf({ student_id: 1, week_id: 1, word_score: 22, retest_pass: { word_score: true } }, items)["retest:word_score"]).toBe(false);
  const prev = [
    { student_id: 1, week_id: 9, homework_eval: "", homework_rate: 70 },
    { student_id: 1, week_id: 8, homework_eval: "성실", homework_rate: 50 },
  ];
  const carried = withCarry(empty, undefined, prev, 1);
  expect(carried).toMatchObject({ homework_eval: "성실", homework_rate: 70 });
  expect(changedFields(empty, carried).sort()).toEqual(["homework_eval", "homework_rate"]);
  const scored = { student_id: 1, week_id: 10, word_score: 5 };
  expect(withCarry(fieldsOf(scored, items), scored, prev, 1).homework_eval).toBeNull();
});

const allWeeks = [
  { id: 7, class_id: 5, label: "11.20", test_date: "11.20", group_id: "g9", item_config: null, created_at: "2026-11-16T00:00:00Z" },
  { id: 6, class_id: 4, label: "11.12", test_date: "11.12", group_id: "g9", item_config: null, created_at: "2026-11-09T00:00:00Z" },
  {
    id: 5,
    class_id: 4,
    label: "11.19",
    test_date: "11.19",
    group_id: "g1",
    item_config: { items: [{ key: "word_score", label: "단어", max: 25, cut: 15, active: true }] },
    created_at: "2026-11-16T00:00:00Z",
  },
  { id: 2, class_id: 3, label: "11.17", test_date: "11.17", group_id: "g1", item_config: null, created_at: "2026-11-16T00:00:00Z" },
  { id: 1, class_id: 3, label: "11.10", test_date: "11.10", group_id: null, item_config: null, created_at: "2026-11-09T00:00:00Z" },
];

function fakeServer(conflictOnce?: Record<string, unknown>, opts: { noHomework?: boolean; weekConflict?: boolean } = {}) {
  const puts: { no_homework: boolean; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
  const writes: { url: string; body: unknown }[] = [];
  const weekReads = { n: 0 };
  let conflict = conflictOnce;
  const rows: Record<string, unknown>[] = [
    { student_id: 7, week_id: 1, word_score: 20, homework_eval: "성실", homework_rate: 80 },
    { student_id: 9, week_id: 5, word_score: 10, reading_score: 20, mc_score: 30 },
    ...(opts.noHomework ? [{ student_id: 7, week_id: 2, no_homework: true, homework_rate: null }] : []),
  ];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/roster/classes")
      return Response.json([3, 4, 5].map((id) => ({ id, name: { 3: "고2 화", 4: "고2 목", 5: "고1 금" }[id], grade: "고2", day: "화", time: null })));
    if (u === "/api/admin/classes/3/weeks") {
      weekReads.n++;
      return Response.json(
        allWeeks.filter((w) => w.class_id === 3).map((w) => ({ ...w, memo: w.id === 2 ? "p.1" : null })),
      );
    }
    if (u === "/api/admin/roster/weeks") return Response.json(allWeeks);
    if (u.startsWith("/api/admin/scores?weekIds=")) {
      const ids = u.split("=")[1].split(",").map(Number);
      return Response.json(rows.filter((r) => ids.includes(r.week_id as number)));
    }
    if (u.startsWith("/api/admin/roster/weeks/") && init?.method === "PUT") {
      writes.push({ url: u, body: JSON.parse(String(init.body)) });
      if (opts.weekConflict) return Response.json({ error: "changed_elsewhere", current: {} }, { status: 409 });
      return new Response(null, { status: 204 });
    }
    if (u === "/api/admin/roster/students?classId=3")
      return Response.json([
        { id: 7, name: "가상 학생", pin: "0012", phone: null, student_phone: null, note: "", is_active: true },
        { id: 8, name: "퇴원 학생", pin: "0013", phone: null, student_phone: null, note: "", is_active: false },
      ]);
    if (u === "/api/admin/roster/scores" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push({ no_homework: body.no_homework, before: body.before, after: body.after });
      if (conflict) {
        const current = conflict;
        conflict = undefined;
        return Response.json({ error: "changed_elsewhere", current }, { status: 409 });
      }
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, puts, writes, weekReads };
}

async function openWeek(server: ReturnType<typeof fakeServer>) {
  render(<ScoreLive fetchImpl={server.fetchImpl as never} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByRole("option", { name: "11.17" });
  fireEvent.change(screen.getByLabelText("실제 주차 선택"), { target: { value: "2" } });
  await screen.findByLabelText("가상 학생 단어");
}

it("saves only the changed cells of one student, with the carried homework, on leaving the cell", async () => {
  const server = fakeServer();
  await openWeek(server);
  expect(screen.queryByText("퇴원 학생")).toBeNull();
  expect(screen.getByLabelText("가상 학생 과제평가")).toHaveValue("성실");
  const word = screen.getByLabelText("가상 학생 단어");
  fireEvent.change(word, { target: { value: "21" } });
  fireEvent.blur(word);
  await waitFor(() => expect(screen.getByLabelText("가상 학생 저장 상태")).toHaveTextContent("저장됨"));
  expect(server.puts).toEqual([
    {
      no_homework: false,
      before: { homework_rate: null, homework_eval: null, "score:word_score": null },
      after: { homework_rate: 80, homework_eval: "성실", "score:word_score": 21 },
    },
  ]);
  fireEvent.blur(word); // nothing changed since the save
  expect(server.puts).toHaveLength(1);
});

it("reverts only the cell someone else changed and still saves the rest", async () => {
  const server = fakeServer({ "score:word_score": 15 });
  await openWeek(server);
  fireEvent.change(screen.getByLabelText("가상 학생 클리닉메모"), { target: { value: "단어 보충" } });
  const word = screen.getByLabelText("가상 학생 단어");
  fireEvent.change(word, { target: { value: "21" } });
  fireEvent.blur(word);
  await waitFor(() => expect(screen.getByLabelText("가상 학생 저장 상태")).toHaveTextContent("단어: 다른 곳에서 바뀌어"));
  expect(word).toHaveValue(15);
  expect(server.puts).toHaveLength(2);
  expect(server.puts[1].after).not.toHaveProperty("score:word_score");
  expect(server.puts[1].after).toMatchObject({ clinic_memo: "단어 보충" });
});

it("does not save a score above the item maximum", async () => {
  const server = fakeServer();
  await openWeek(server);
  const word = screen.getByLabelText("가상 학생 단어");
  fireEvent.change(word, { target: { value: "99" } });
  fireEvent.blur(word);
  await waitFor(() => expect(screen.getByLabelText("가상 학생 저장 상태")).toHaveTextContent("만점 초과"));
  expect(server.puts).toEqual([]);
});

it("saves the week memo on leaving it", async () => {
  const server = fakeServer();
  await openWeek(server);
  const memo = screen.getByLabelText("이번 주 과제 내용");
  expect(memo).toHaveValue("p.1");
  fireEvent.blur(memo); // unchanged: no request
  fireEvent.change(memo, { target: { value: " p.1~5 " } });
  fireEvent.blur(memo);
  await screen.findByText("과제 내용을 저장했습니다.");
  expect(server.writes).toEqual([{ url: "/api/admin/roster/weeks/2/memo", body: { before: "p.1", after: " p.1~5 " } }]);
  expect(memo).toHaveValue("p.1~5");
});

it("asks before no-homework clears homework%, then locks it and stops saving it", async () => {
  const server = fakeServer();
  await openWeek(server);
  const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  const box = screen.getByLabelText("이번 주 과제 없음");
  fireEvent.click(box);
  expect(ask).toHaveBeenCalledWith(expect.stringContaining("과제% 1건"));
  expect(server.writes).toEqual([]);
  fireEvent.click(box);
  await screen.findByText("이번 주 과제 없음으로 저장했습니다.");
  ask.mockRestore();
  expect(server.writes).toEqual([{ url: "/api/admin/roster/weeks/2/no-homework", body: { no_homework: true } }]);
  expect(box).toBeChecked();
  expect(screen.getByLabelText("가상 학생 과제%")).toBeDisabled();
  expect(screen.getByLabelText("가상 학생 과제%")).toHaveValue(null);
  const word = screen.getByLabelText("가상 학생 단어");
  fireEvent.change(word, { target: { value: "21" } });
  fireEvent.blur(word);
  await waitFor(() => expect(server.puts).toHaveLength(1));
  expect(server.puts[0].after).not.toHaveProperty("homework_rate");
  // 이 주차는 아직 점수 줄이 없어 위 저장이 DB를 안 바꿨다. 첫 줄이 과제 없음을 가져가야 다시 열어도 남는다.
  expect(server.puts[0].no_homework).toBe(true);
});

it("opens a no-homework week with homework% locked and nothing carried", async () => {
  await openWeek(fakeServer(undefined, { noHomework: true }));
  expect(screen.getByLabelText("이번 주 과제 없음")).toBeChecked();
  expect(screen.getByLabelText("가상 학생 과제%")).toHaveValue(null);
});

it("checks the item config, adds a 5th item and saves it for the comparison group", async () => {
  const server = fakeServer();
  await openWeek(server);
  expect(screen.getByText("사용 항목 3개 · 총점 만점 100점")).toBeInTheDocument();
  const save = screen.getByRole("button", { name: "항목 설정 저장" });
  for (const n of [1, 2, 3]) fireEvent.click(screen.getByLabelText(`${n}번째 항목 사용`));
  fireEvent.click(save);
  expect(screen.getByRole("alert")).toHaveTextContent("최소 한 개 항목은 사용해야 합니다.");
  fireEvent.click(screen.getByLabelText("1번째 항목 사용"));
  expect(screen.queryByLabelText("4번째 항목 삭제")).toBeNull(); // column slots can only be turned off
  fireEvent.click(screen.getByRole("button", { name: "+ 항목 추가" }));
  fireEvent.click(save);
  expect(screen.getByRole("alert")).toHaveTextContent("5번째 항목의 이름을 입력하세요.");
  fireEvent.change(screen.getByLabelText("5번째 항목 이름"), { target: { value: " 듣기 " } });
  fireEvent.change(screen.getByLabelText("5번째 항목 만점"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("5번째 항목 커트라인"), { target: { value: "6" } });
  expect(screen.getByText("사용 항목 2개 · 총점 만점 35점")).toBeInTheDocument();
  fireEvent.click(await screen.findByLabelText(/커트라인도 비교 그룹의 모든 반에/));
  const reads = server.weekReads.n;
  fireEvent.click(save);
  await screen.findByText("항목 설정을 저장했습니다. (커트라인 포함 비교 그룹 2개 반 공통 적용)");
  expect(server.writes).toEqual([
    {
      url: "/api/admin/roster/weeks/2/item-config",
      body: {
        before: null,
        group_id: "g1",
        cut_all: true,
        items: [
          { key: "word_score", label: "단어", max: 25, cut: null, active: true },
          { key: "reading_score", label: "해석", max: 30, cut: null, active: false },
          { key: "mc_score", label: "객관식", max: 45, cut: null, active: false },
          { key: "item4_score", label: "", max: 20, cut: null, active: false },
          { key: "item5_score", label: "듣기", max: 10, cut: 6, active: true },
        ],
      },
    },
  ]);
  expect(server.weekReads.n).toBe(reads + 1); // reopened with the saved config
});

it("reloads the week when its item config changed elsewhere", async () => {
  const server = fakeServer(undefined, { weekConflict: true });
  await openWeek(server);
  const reads = server.weekReads.n;
  fireEvent.click(screen.getByRole("button", { name: "항목 설정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳에서 먼저 수정됐습니다");
  expect(server.weekReads.n).toBe(reads + 1);
});

it("shows the comparison group average and regroups weeks with a warning for the one leaving its group", async () => {
  const server = fakeServer();
  await openWeek(server);
  const info = await screen.findByLabelText("비교 그룹");
  expect(info).toHaveTextContent("비교 그룹 2개 반 (고2 목, 고2 화) · 그룹 평균 60.0점 / 100점 · 표본 1명");
  expect(info).toHaveTextContent("반별 커트라인: 고2 목 단어 15, 해석 –, 객관식 – · 고2 화 단어 –, 해석 –, 객관식 –");
  fireEvent.click(screen.getByRole("button", { name: "비교 그룹 수정" }));
  const editor = await screen.findByRole("group", { name: "비교 그룹 수정" });
  expect(editor).toHaveTextContent("비교 그룹 2개 반 — 고2 화 11.17 · 고2 목 11.19");
  fireEvent.change(screen.getByLabelText("고2 목 주차"), { target: { value: "6" } });
  expect(editor).toHaveTextContent("고2 목(현재 다른 그룹 2개 반)은 기존 그룹에서 빠져");
  const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "비교 그룹 저장" }));
  await screen.findByText("비교 그룹이 2개 반으로 설정됐습니다.");
  ask.mockRestore();
  expect(server.writes).toEqual([{ url: "/api/admin/roster/weeks/2/group", body: { week_ids: [2, 6], before: { 2: "g1", 6: "g9" } } }]);
});

it("picks group weeks like score-system and keeps new item keys unique", () => {
  const cur = allWeeks[3] as AdminWeek;
  const byClass = new Map([
    [3, [cur]],
    [4, [allWeeks[2], allWeeks[1]] as AdminWeek[]],
    [5, [allWeeks[0]] as AdminWeek[]],
    [6, []],
  ]);
  expect(groupPicks(byClass, cur, 3)).toEqual({ 3: { on: true, weekId: 2 }, 4: { on: true, weekId: 5 }, 5: { on: false, weekId: 7 } });
  expect(groupPicks(byClass, { ...cur, group_id: null, label: "11.12" }, 3)[4]).toEqual({ on: false, weekId: 6 });
  expect(nextItemKey([{ key: "word_score" }, { key: "item5_score" }, { key: "item7_score" }])).toBe("item6_score");
  expect(movedFrom(allWeeks as AdminWeek[], [2, 6], "g1")).toEqual([{ week: allWeeks[1], size: 2 }]);
  const stats = groupStats([cur], [], DEFAULT_ITEMS, () => "");
  expect(stats).toMatchObject({ avg: null, count: 0, totalMax: 100, mismatched: [], cutLines: [] });
});

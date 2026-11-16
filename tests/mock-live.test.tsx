import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MockLive from "../src/admin/MockLive";
import { MOCK_ITEMS } from "../src/domain";
import { mockFieldsOf } from "../src/scoreSheet";

const cfg2 = {
  items: [
    { key: "item1_score", label: "듣기", max: 50, cut: 30, active: true },
    { key: "item2_score", label: "독해", max: 50, cut: null, active: true },
  ],
};
const exams = [
  { id: 31, class_id: 3, label: "6월 모의", exam_date: "6.10", group_id: "gm", item_config: cfg2, created_at: "2026-06-01T00:00:00Z" },
  { id: 41, class_id: 4, label: "6월 모의", exam_date: "6.10", group_id: "gm", item_config: null, created_at: "2026-06-01T00:00:00Z" },
  { id: 30, class_id: 3, label: "3월", exam_date: "3.20", group_id: null, item_config: null, created_at: "2026-03-01T00:00:00Z" },
];

it("shows an old score-only row in the first item, like score-system", () => {
  const items = MOCK_ITEMS.filter((i) => i.active);
  expect(mockFieldsOf({ score: 80, item1_score: null }, items)).toEqual({ absent: false, memo: null, "score:item1_score": 80, "retest:item1_score": false });
  // an item value anywhere means the row is not old: score is the sum, not a value to show
  expect(mockFieldsOf({ score: 5, item1_score: null, item2_score: 5 }, items)["score:item1_score"]).toBeNull();
  expect(mockFieldsOf(undefined, items)).toMatchObject({ absent: false, "score:item1_score": null });
});

function fakeServer(conflictOnce?: Record<string, unknown>) {
  const writes: { method: string; url: string; body: unknown }[] = [];
  let conflict = conflictOnce;
  const rows = [
    { student_id: 7, exam_id: 31, score: 40, item1_score: null, item2_score: null, absent: false, memo: null },
    { student_id: 9, exam_id: 41, score: 60, item1_score: 60, absent: false },
    { student_id: 10, exam_id: 41, score: null, absent: true },
  ];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      writes.push({ method, url: u, body: JSON.parse(String(init?.body)) });
      if (u === "/api/admin/roster/mock-scores" && conflict) {
        const current = conflict;
        conflict = undefined;
        return Response.json({ error: "changed_elsewhere", current }, { status: 409 });
      }
      return u === "/api/admin/roster/mock-exams" ? Response.json({ group_id: "g", ids: [1] }) : new Response(null, { status: 204 });
    }
    if (u === "/api/admin/roster/classes")
      return Response.json([3, 4].map((id) => ({ id, name: { 3: "고2 화", 4: "고2 목" }[id], grade: "고2", day: "화", time: null })));
    if (u === "/api/admin/classes/3/mock-exams") return Response.json(exams.filter((e) => e.class_id === 3));
    if (u === "/api/admin/roster/mock-exams") return Response.json(exams);
    if (u.startsWith("/api/admin/mock-scores?examIds=")) {
      const ids = u.split("=")[1].split(",").map(Number);
      return Response.json(rows.filter((r) => ids.includes(r.exam_id)));
    }
    if (u === "/api/admin/roster/students?classId=3")
      return Response.json([
        { id: 7, name: "가상 학생", pin: "0012", phone: null, student_phone: null, note: "", is_active: true },
        { id: 8, name: "새 학생", pin: "0013", phone: null, student_phone: null, note: "", is_active: true },
        { id: 6, name: "퇴원 학생", pin: "0014", phone: null, student_phone: null, note: "", is_active: false },
      ]);
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, writes };
}

async function openExam(server: ReturnType<typeof fakeServer>) {
  render(<MockLive fetchImpl={server.fetchImpl as never} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByRole("option", { name: "6월 모의" });
  fireEvent.change(screen.getByLabelText("실제 모의고사 선택"), { target: { value: "31" } });
  await screen.findByLabelText("가상 학생 듣기");
}

it("adds one exam for the checked classes as one group, after checking the date", async () => {
  const server = fakeServer();
  render(<MockLive fetchImpl={server.fetchImpl as never} />);
  fireEvent.click(await screen.findByLabelText("고2 목"));
  fireEvent.change(screen.getByLabelText("시험 날짜"), { target: { value: "6/10" } });
  fireEvent.click(screen.getByRole("button", { name: "실제 모의고사 추가" }));
  expect(screen.getByRole("alert")).toHaveTextContent("날짜 형식이 올바르지 않습니다");
  fireEvent.click(screen.getByLabelText("고2 화"));
  fireEvent.change(screen.getByLabelText("시험 날짜"), { target: { value: "06.10" } });
  fireEvent.change(screen.getByLabelText("모의고사 이름"), { target: { value: " 6월 모의 " } });
  expect(screen.getByText(/6.10 · 선택된 반 2개/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "실제 모의고사 추가" }));
  await screen.findByText("모의고사가 추가됐습니다. (2개 반 공통 그룹)");
  expect(server.writes).toEqual([{ method: "POST", url: "/api/admin/roster/mock-exams", body: { date: "6.10", label: "6월 모의", class_ids: [3, 4] } }]);
});

it("saves only the changed cells, shows an old score in the first item and clears scores for 미응시", async () => {
  const server = fakeServer();
  await openExam(server);
  expect(screen.queryByText("퇴원 학생")).toBeNull();
  expect(screen.getByLabelText("가상 학생 듣기")).toHaveValue(40);
  expect(screen.getByLabelText("학부모 공개 현황")).toHaveTextContent("학부모에게 보이는 학생 1명 (점수 1명 · 미응시 0명) / 전체 2명 · 1명은 이 시험이 보이지 않습니다");
  const read = screen.getByLabelText("가상 학생 독해");
  fireEvent.change(read, { target: { value: "5" } });
  fireEvent.blur(read);
  await waitFor(() => expect(screen.getByLabelText("가상 학생 저장 상태")).toHaveTextContent("저장됨"));
  expect(server.writes).toEqual([
    {
      method: "PUT",
      url: "/api/admin/roster/mock-scores",
      body: { exam_id: 31, student_id: 7, items: ["item1_score", "item2_score"], before: { "score:item2_score": null }, after: { "score:item2_score": 5 } },
    },
  ]);
  fireEvent.click(screen.getByLabelText("가상 학생 미응시"));
  await waitFor(() => expect(server.writes).toHaveLength(2));
  expect(server.writes[1].body).toMatchObject({
    before: { absent: false, "score:item1_score": 40, "score:item2_score": 5 },
    after: { absent: true, "score:item1_score": null, "score:item2_score": null },
  });
  expect(screen.getByLabelText("가상 학생 듣기")).toBeDisabled();
  expect(screen.getAllByText("미응시").length).toBeGreaterThan(1);
  expect(screen.getByLabelText("학부모 공개 현황")).toHaveTextContent("(점수 0명 · 미응시 1명)");
});

it("marks everyone absent only after asking", async () => {
  const server = fakeServer();
  await openExam(server);
  const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "전원 미응시" }));
  expect(server.writes).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "전원 미응시" }));
  await waitFor(() => expect(server.writes).toHaveLength(2));
  ask.mockRestore();
  expect(server.writes.map((w) => (w.body as { student_id: number }).student_id).sort()).toEqual([7, 8]);
});

it("reverts only the cell someone else changed and blocks a score over the maximum", async () => {
  const server = fakeServer({ "score:item1_score": 30 });
  await openExam(server);
  fireEvent.change(screen.getByLabelText("가상 학생 메모"), { target: { value: "지각" } });
  const listen = screen.getByLabelText("가상 학생 듣기");
  fireEvent.change(listen, { target: { value: "45" } });
  fireEvent.blur(listen);
  await waitFor(() => expect(screen.getByLabelText("가상 학생 저장 상태")).toHaveTextContent("듣기: 다른 곳에서 바뀌어"));
  expect(listen).toHaveValue(30);
  expect(server.writes[1].body).toMatchObject({ after: { memo: "지각" } });
  expect((server.writes[1].body as { after: object }).after).not.toHaveProperty("score:item1_score");
  fireEvent.change(listen, { target: { value: "51" } });
  fireEvent.blur(listen);
  await waitFor(() => expect(screen.getByLabelText("가상 학생 저장 상태")).toHaveTextContent("만점 초과"));
  expect(server.writes).toHaveLength(2);
});

it("shows the group average like score-system and saves item config and group for mock exams", async () => {
  const server = fakeServer();
  await openExam(server);
  // 40 (old score-only row) and 60 count; the absent row does not.
  const info = await screen.findByLabelText("비교 그룹");
  expect(info).toHaveTextContent("비교 그룹 2개 반 (고2 화, 고2 목) · 그룹 평균 50.0점 / 100점 · 표본 2명");
  expect(info).toHaveTextContent("항목 구성(활성 항목·만점)이 다른 반: 고2 목");
  expect(screen.queryByLabelText("1번째 항목 삭제")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "항목 설정 저장" }));
  await screen.findByText("항목 설정을 저장했습니다. (항목·만점은 2개 반 공통, 커트라인은 이 반만)");
  expect(server.writes[0]).toMatchObject({
    url: "/api/admin/roster/mock-exams/31/item-config",
    body: { before: cfg2, group_id: "gm", cut_all: false },
  });
  expect((server.writes[0].body as { items: { key: string }[] }).items.map((i) => i.key)).toEqual(["item1_score", "item2_score", "item3_score", "item4_score"]);

  fireEvent.click(screen.getByRole("button", { name: "비교 그룹 수정" }));
  const editor = await screen.findByRole("group", { name: "비교 그룹 수정" });
  expect(editor).toHaveTextContent("비교 그룹 2개 반 — 고2 화 6월 모의 · 고2 목 6월 모의");
  fireEvent.click(screen.getAllByRole("checkbox", { name: /고2 목/ }).at(-1)!);
  const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "비교 그룹 저장" }));
  await screen.findByText("비교 그룹이 1개 반으로 설정됐습니다.");
  ask.mockRestore();
  expect(server.writes[1]).toEqual({ method: "PUT", url: "/api/admin/roster/mock-exams/31/group", body: { week_ids: [31], before: { 31: "gm" } } });
});

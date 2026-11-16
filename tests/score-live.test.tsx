import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScoreLive from "../src/admin/ScoreLive";
import { DEFAULT_ITEMS } from "../src/domain";
import { changedFields, fieldsOf, scoreEq, withCarry } from "../src/scoreSheet";

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

function fakeServer(conflictOnce?: Record<string, unknown>) {
  const puts: { before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
  let conflict = conflictOnce;
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/roster/classes") return Response.json([{ id: 3, name: "고2 화", grade: "고2", day: "화", time: null }]);
    if (u === "/api/admin/classes/3/weeks")
      return Response.json([
        { id: 1, label: "11.10", test_date: "11.10", created_at: "2026-11-09T00:00:00Z" },
        { id: 2, label: "11.17", test_date: "11.17", created_at: "2026-11-16T00:00:00Z" },
      ]);
    if (u === "/api/admin/scores?weekIds=2,1")
      return Response.json([{ student_id: 7, week_id: 1, word_score: 20, homework_eval: "성실", homework_rate: 80 }]);
    if (u === "/api/admin/roster/students?classId=3")
      return Response.json([
        { id: 7, name: "가상 학생", pin: "0012", phone: null, student_phone: null, note: "", is_active: true },
        { id: 8, name: "퇴원 학생", pin: "0013", phone: null, student_phone: null, note: "", is_active: false },
      ]);
    if (u === "/api/admin/roster/scores" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push({ before: body.before, after: body.after });
      if (conflict) {
        const current = conflict;
        conflict = undefined;
        return Response.json({ error: "changed_elsewhere", current }, { status: 409 });
      }
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, puts };
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

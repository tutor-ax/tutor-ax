import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HistoryLive from "../src/admin/HistoryLive";
import { historyDiff, historyLabels, planUpTo, revertFor, type HistoryEntry } from "../src/history";

const cfg = { items: [{ key: "word_score", label: "단어", max: 30, cut: null, active: true }] };
const labels = historyLabels(cfg);
const row = (sid: number, extra: Record<string, unknown> = {}) => ({
  student_id: sid, week_id: 2, word_score: 10, homework_rate: 80, homework_eval: "성실", attendance: true, no_homework: false,
  item_scores: null, retest_pass: null, hw_cert: null, clinic_memo: "", ...extra,
});
const entry = (id: number, at: string, old: Record<string, unknown>, now: Record<string, unknown> | null, op: "UPDATE" | "DELETE" = "UPDATE"): HistoryEntry =>
  ({ id, row_id: 100 + Number(old.student_id), op, old_row: old, new_row: now, changed_at: at });

afterEach(() => vi.restoreAllMocks());

it("diffs like score-system with the week's item names and reverts through score-save fields", () => {
  const e = entry(1, "2026-11-10T01:00:00Z", row(7), row(7, { word_score: 25, item_scores: { x1: 3 }, retest_pass: { word_score: true } }));
  expect(historyDiff(e, labels).map((d) => d.label)).toEqual(["재시험통과", "단어", "추가항목"]);
  // A deleted row lists only fields that held something (not empty, not false).
  const del = entry(2, "2026-11-10T02:00:00Z", row(8, { homework_eval: "", attendance: false }), null, "DELETE");
  expect(historyDiff(del, labels).map((d) => d.key)).toEqual(["homework_rate", "word_score"]);

  const cur = row(7, { word_score: 25, item_scores: { x1: 3 }, retest_pass: { word_score: true } });
  const r = revertFor(e.old_row!, cur, historyDiff(e, labels).map((d) => d.key), labels, 7);
  expect(r?.before).toEqual({ "score:word_score": 25, "score:x1": 3, "retest:word_score": true });
  expect(r?.after).toEqual({ "score:word_score": 10, "score:x1": null, "retest:word_score": false });
  expect(revertFor(e.old_row!, e.old_row!, Object.keys(labels), labels, 7)).toBeNull();
  // An old row's null attendance was the default (present); the server takes only true/false.
  expect(revertFor({ attendance: null }, { attendance: false }, ["attendance"], labels, 7)?.after).toEqual({ attendance: true });
});

it("plans 'up to this time' from the first change after it, skipping rows recreated after a delete", () => {
  const entries = [
    entry(3, "2026-11-10T03:00:00Z", row(7, { word_score: 20 }), row(7, { word_score: 30 })),
    entry(2, "2026-11-10T02:00:00Z", row(7, { word_score: 15 }), row(7, { word_score: 20 })),
    entry(1, "2026-11-10T01:00:00Z", row(7), row(7, { word_score: 15 })),
    entry(4, "2026-11-10T02:30:00Z", row(8, { hw_cert: "2/5" }), null, "DELETE"),
    entry(5, "2026-11-10T02:40:00Z", row(9, { word_score: 5 }), null, "DELETE"),
  ];
  const current = [row(7, { word_score: 30 }), row(9, { word_score: 1 })];
  const plan = planUpTo(entries, entries[1], current, labels);
  expect(plan.map((p) => p.student_id)).toEqual([7, 8]);
  expect(plan[0].after).toEqual({ "score:word_score": 15 });
  // Deleted row with no current row: the save creates it, then sets the old values.
  expect(plan[1].after).toMatchObject({ hw_cert: "2/5", homework_rate: 80, homework_eval: "성실", "score:word_score": 10 });
});

function fakeServer(conflictFor?: number) {
  const puts: { student_id: number; items: string[]; before: unknown; after: unknown }[] = [];
  let history: HistoryEntry[] = [
    entry(2, "2026-11-10T02:00:00Z", row(7, { word_score: 15 }), row(7, { word_score: 20 })),
    entry(1, "2026-11-10T01:00:00Z", row(8), row(8, { homework_eval: "보통" })),
  ];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/roster/classes") return Response.json([{ id: 3, name: "고2 화", grade: "고2", day: "화", time: null }]);
    if (u === "/api/admin/classes/3/weeks")
      return Response.json([{ id: 2, class_id: 3, label: "11.17", test_date: "11.17", item_config: cfg, created_at: "2026-11-16T00:00:00Z" }]);
    if (u === "/api/admin/roster/students?classId=3")
      return Response.json([7, 8].map((id) => ({ id, name: `학생${id}`, pin: "0000", phone: null, student_phone: null, note: "", is_active: true })));
    if (u === "/api/admin/history?weekId=2") return Response.json(history);
    if (u === "/api/admin/scores?weekIds=2") return Response.json([row(7, { word_score: 20 }), row(8, { homework_eval: "보통" })]);
    if (u === "/api/admin/roster/scores" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      if (body.student_id === conflictFor) return Response.json({ error: "changed_elsewhere", current: {} }, { status: 409 });
      history = [entry(9, "2026-11-10T04:00:00Z", row(body.student_id), row(body.student_id)), ...history];
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, puts };
}

async function open(fetchImpl: typeof fetch) {
  render(<HistoryLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByText(/변경 2건/);
}

it("reverts one student through the guarded score save after confirming", async () => {
  const { fetchImpl, puts } = fakeServer();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await open(fetchImpl);
  expect(screen.getByText("단어")).toBeTruthy(); // the week's item name, not 항목1
  fireEvent.click(screen.getByRole("button", { name: /학생7 .* 이 학생만 되돌리기/ }));
  await screen.findByText("1명을 되돌렸습니다.");
  expect(confirm.mock.calls[0][0]).toContain("학생7의 값을");
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ week_id: 2, student_id: 7, no_homework: false, before: { "score:word_score": 20 }, after: { "score:word_score": 15 } });
});

it("does nothing when the confirm is cancelled", async () => {
  const { fetchImpl, puts } = fakeServer();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await open(fetchImpl);
  fireEvent.click(screen.getByRole("button", { name: /학생8 .* 이 학생만 되돌리기/ }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalled());
  expect(puts).toEqual([]);
});

it("reverts everyone up to a time and reports students changed elsewhere", async () => {
  const { fetchImpl, puts } = fakeServer(8);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await open(fetchImpl);
  const buttons = screen.getAllByRole("button", { name: /이전으로 전체 되돌리기/ });
  fireEvent.click(buttons[buttons.length - 1]); // the oldest change: both students
  await screen.findByText(/1명을 되돌렸습니다\. 1명은 그사이 다른 곳에서 바뀌어 건너뛰었습니다/);
  expect(puts.map((p) => p.student_id).sort()).toEqual([7, 8]);
  expect(puts.find((p) => p.student_id === 8)?.after).toEqual({ homework_eval: "성실" });
});

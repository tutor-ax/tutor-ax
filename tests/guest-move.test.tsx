import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GuestInput from "../src/admin/GuestInput";
import RosterLive from "../src/admin/RosterLive";
import { createAdminApi, type AdminWeek } from "../src/adminApi";
import { guestMatchWeek, matchMoveWeeks, newWeekLabel, weekStartKey } from "../src/weekMatch";

// 연도가 없는 'M.D'는 오늘 기준 연도로 읽으므로 요일이 해마다 달라진다.
beforeEach(() => void vi.useFakeTimers({ now: new Date(2026, 10, 16), toFake: ["Date"] }));
afterEach(() => void vi.useRealTimers());

const wk = (id: number, label: string, group_id: string | null = null): AdminWeek => ({ id, label, test_date: label, group_id, created_at: "2026-11-01T00:00:00Z" });
const cls = (id: number, name: string, day: string) => ({ id, name, grade: "고2", day, time: null });

it("matches weeks like score-system: group first, then same date, then same Monday-start week", () => {
  expect(weekStartKey("11.20")).toBe(weekStartKey("11.16")); // 목·월 같은 주
  expect(weekStartKey("11.15")).not.toBe(weekStartKey("11.16")); // 일요일은 앞 주
  expect(weekStartKey("1주차")).toBeNull();
  expect(guestMatchWeek(wk(1, "11.17", "g"), [wk(5, "11.19"), wk(6, "11.3", "g")])).toMatchObject({ week: { id: 6 }, how: "같은 비교 그룹" });
  expect(guestMatchWeek(wk(1, "11.17", "g"), [wk(4, "11.10"), wk(5, "11.19")])).toMatchObject({ week: { id: 5 }, how: "같은 주" });
  expect(guestMatchWeek(wk(1, "11.17"), [wk(4, "11.10")])).toBeNull();
  // newest first in, oldest matched first; a target week is used once
  const rows = matchMoveWeeks([wk(3, "11.18"), wk(2, "11.11", "g2"), wk(1, "11.4")], [wk(12, "11.19"), wk(11, "11.13", "g2"), wk(10, "11.4")]);
  expect(rows.map((r) => [r.fw.id, r.tw?.id ?? null, r.how])).toEqual([
    [1, 10, "같은 날짜"],
    [2, 11, "비교 그룹 일치"],
    [3, 12, "같은 주"],
  ]);
  expect(matchMoveWeeks([wk(2, "11.18"), wk(1, "11.17")], [wk(10, "11.19")]).map((r) => r.tw?.id ?? null)).toEqual([10, null]);
  expect(newWeekLabel(wk(1, "11.17"), cls(4, "목반", "목"))).toBe("11.19");
  expect(newWeekLabel(wk(1, "1주차"), cls(4, "목반", "목"))).toBe("1주차");
});

function guestServer(opts: { ownWeeks: AdminWeek[]; row?: Record<string, unknown>; conflict?: Record<string, unknown> }) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let conflict = opts.conflict;
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.startsWith("/api/admin/roster/students/search")) return Response.json([{ id: 9, name: "손님", class_id: 4 }, { id: 7, name: "손님반", class_id: 3 }]);
    if (u === "/api/admin/classes/4/weeks") return Response.json(opts.ownWeeks);
    if (u.startsWith("/api/admin/scores?weekIds=")) return Response.json(opts.row ? [opts.row] : []);
    if (u === "/api/admin/roster/weeks/copy") return Response.json({ id: 77 });
    if (u === "/api/admin/roster/scores" && method === "PUT") {
      if (conflict) {
        const current = conflict;
        conflict = undefined;
        return Response.json({ error: "changed_elsewhere", current }, { status: 409 });
      }
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, calls };
}

function renderGuest(server: ReturnType<typeof guestServer>) {
  const api = createAdminApi(server.fetchImpl as never);
  const run = async (task: () => Promise<void>) => task();
  render(<GuestInput api={api} run={run} busy={false} classes={[cls(3, "화반", "화"), cls(4, "목반", "목")]} host={wk(2, "11.17", "g1")} hostClassId={3} />);
}

async function pickGuest() {
  fireEvent.change(screen.getByLabelText("학생 이름"), { target: { value: "손님" } });
  fireEvent.click(screen.getByRole("button", { name: "찾기" }));
  fireEvent.click(await screen.findByRole("button", { name: "손님 · 목반" }));
  expect(screen.queryByRole("button", { name: /손님반/ })).toBeNull(); // 보고 있는 반 학생은 빠진다
}

it("saves a guest score into the student's own class week found by group", async () => {
  const server = guestServer({ ownWeeks: [wk(5, "11.19", "g1")], row: { student_id: 9, week_id: 5, word_score: 10 } });
  renderGuest(server);
  await pickGuest();
  expect(await screen.findByText(/저장될 주차: 목반 11.19 \(같은 비교 그룹\)/)).toBeInTheDocument();
  expect(screen.getByLabelText("손님 단어")).toHaveValue(10);
  fireEvent.change(screen.getByLabelText("손님 단어"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "손님 점수 저장" }));
  expect(await screen.findByText("저장됨 — 목반 11.19")).toBeInTheDocument();
  const put = server.calls.find((c) => c.method === "PUT");
  expect(put?.body).toMatchObject({ week_id: 5, student_id: 9, before: { "score:word_score": 10 }, after: { "score:word_score": 12 } });
  expect(server.calls.some((c) => c.url.endsWith("/weeks/copy"))).toBe(false);
});

it("creates the missing week from the one on screen, then saves; asks before overwriting a changed cell", async () => {
  const server = guestServer({ ownWeeks: [wk(4, "11.6")], conflict: { "score:word_score": 3 } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderGuest(server);
  await pickGuest();
  expect(await screen.findByText(/11.19 주차를 새로 만들어 넣습니다/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "손님 점수 저장" }));
  expect(await screen.findByText("입력한 점수가 없어요.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("손님 단어"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "손님 점수 저장" }));
  expect(await screen.findByText("저장됨 — 목반 11.19")).toBeInTheDocument();
  expect(server.calls.find((c) => c.url.endsWith("/weeks/copy"))?.body).toEqual({ class_id: 4, label: "11.19", from_week_id: 2 });
  const puts = server.calls.filter((c) => c.method === "PUT").map((c) => c.body as { week_id: number; before: object });
  expect(puts.map((p) => [p.week_id, p.before])).toEqual([
    [77, { "score:word_score": null }],
    [77, { "score:word_score": 3 }],
  ]);
  expect(confirm.mock.calls[0][0]).toContain("지금 저장된 값 3 / 내가 입력한 값 8");
  confirm.mockRestore();
});

function moveServer() {
  const moves: { dry_run: boolean; moves: unknown[] }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/roster/classes") return Response.json([cls(3, "화반", "화"), cls(4, "목반", "목")]);
    if (u === "/api/admin/roster/students?classId=3")
      return Response.json(moves.some((m) => !m.dry_run) ? [] : [{ id: 7, name: "가상 학생", pin: "0012", phone: null, student_phone: null, note: "", is_active: true }]);
    if (u === "/api/admin/classes/3/weeks") return Response.json([wk(1, "11.10", "g1"), wk(2, "11.17"), wk(3, "11.3")]);
    if (u === "/api/admin/classes/4/weeks") return Response.json([wk(10, "11.12", "g1"), wk(11, "11.6")]);
    if (u === "/api/admin/roster/students/7/score-weeks") return Response.json([1, 2, 3, 11]);
    if (u === "/api/admin/roster/students/7/move") {
      const b = JSON.parse(String(init?.body));
      moves.push(b);
      return Response.json({ moved: 2, created: 1, kept: 1 });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, moves };
}

it("moves a student after a server dry run and confirmation, with the plan the preview shows", async () => {
  const server = moveServer();
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<RosterLive mode="students" fetchImpl={server.fetchImpl as never} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  fireEvent.click(await screen.findByRole("button", { name: "가상 학생 반 이동" }));
  fireEvent.change(screen.getByLabelText("이동할 반"), { target: { value: "4" } });
  // 11.3 → 11.6 is already this student's row there: shown and skipped, never overwritten
  expect(await screen.findByLabelText("11.3 옮길 주차")).toHaveValue("11");
  expect(screen.getByText("이미 점수 있음 — 건너뜀")).toBeInTheDocument();
  expect(screen.getByLabelText("11.10 옮길 주차")).toHaveValue("10");
  expect(screen.getByLabelText("11.17 옮길 주차")).toHaveValue("new");
  expect(screen.getByText(/이전 2건 \(새 주차 1개 생성\) \/ 제외 1건/)).toBeInTheDocument();
  const plan = [{ from_week_id: 3 }, { from_week_id: 1, to_week_id: 10 }, { from_week_id: 2, new_label: "11.19" }];

  fireEvent.click(screen.getByRole("button", { name: "반 이동 확인" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(server.moves).toEqual([{ from_class_id: 3, to_class_id: 4, dry_run: true, moves: plan }]);
  expect(confirm.mock.calls[0][0]).toContain("11.17 → 11.19");

  fireEvent.click(screen.getByRole("button", { name: "반 이동 확인" }));
  expect(await screen.findByText("반 이동 완료 — 2건 이전 (새 주차 1개 생성) / 미이전 1건")).toBeInTheDocument();
  expect(server.moves.map((m) => m.dry_run)).toEqual([true, true, false]);
  expect(server.moves[2]).toEqual({ from_class_id: 3, to_class_id: 4, dry_run: false, moves: plan });
  expect(screen.queryByRole("button", { name: "가상 학생 반 이동" })).toBeNull();
  expect(server.fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  confirm.mockRestore();
});

import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SmsLive from "../src/admin/SmsLive";

const cfg = { items: [{ key: "word_score", label: "단어", max: 25, cut: 20, active: true }, { key: "reading_score", label: "해석", max: 30, cut: null, active: false }, { key: "mc_score", label: "객관식", max: 45, cut: null, active: false }] };
const weeks = [
  { id: 12, class_id: 3, label: "11.10", test_date: "11.10", item_config: cfg, group_id: null, memo: "", created_at: "2026-11-01T00:00:00Z" },
  { id: 11, class_id: 3, label: "11.03", test_date: "11.03", item_config: cfg, group_id: null, memo: "", created_at: "2026-10-25T00:00:00Z" },
];
const students = [
  { id: 1, name: "가상 일", pin: "0001", phone: "010-0000-0001", student_phone: "010-0000-1001", note: null, is_active: true },
  { id: 2, name: "가상 이", pin: "0002", phone: "010-0000-0002", student_phone: null, note: null, is_active: true },
  { id: 3, name: "가상 삼", pin: "0003", phone: null, student_phone: "010-0000-1003", note: null, is_active: true },
  { id: 4, name: "퇴원", pin: "0004", phone: "010-0000-0004", student_phone: null, note: null, is_active: false },
];
const scores = [
  { student_id: 1, week_id: 12, word_score: 18, clinic_memo: "수 3시", clinic_attend: false },
  { student_id: 2, week_id: 12, word_score: 24, clinic_memo: "", clinic_attend: null },
  { student_id: 3, week_id: 12, word_score: 10, clinic_memo: "토 2시", clinic_attend: true },
];

function fakeServer(reply: (body: { messages: { studentId: number; key: string }[] }) => Response) {
  const sent: { messages: { studentId: number; recipient: string; text: string; key: string }[] }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/sms" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      return reply(body);
    }
    if (u === "/api/admin/roster/classes") return Response.json([{ id: 3, name: "고1 화", grade: "고1", day: "화", time: null }]);
    if (u === "/api/admin/classes/3/weeks") return Response.json(weeks);
    if (u === "/api/admin/classes/3/mock-exams") return Response.json([]);
    if (u === "/api/admin/roster/students?classId=3") return Response.json(students);
    if (u.startsWith("/api/admin/scores?weekIds=")) {
      const ids = u.split("=")[1].split(",").map(Number);
      return Response.json(scores.filter((r) => ids.includes(r.week_id)));
    }
    return new Response(null, { status: 404 });
  });
  return { fetchImpl, sent };
}
const dryRun = (body: { messages: { studentId: number }[] }) =>
  Response.json({ success: 0, fail: 0, dryRun: body.messages.length, results: body.messages.map((m) => ({ studentId: m.studentId, recipient: "parent", to: "010****0001", ok: false, msg: "dry_run" })) });

afterEach(() => vi.restoreAllMocks());

it("previews the score message and sends only the checked students with keys", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { fetchImpl, sent } = fakeServer(dryRun);
  render(<SmsLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  const table = await screen.findByLabelText("발송 대상");
  expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3 active students
  expect(screen.getByText("발송 대상 — 성적 3명 / 미응시 0명")).toBeTruthy();
  expect(within(table).getByText(/단어 18\/25 \(재시험\)/)).toBeTruthy();
  expect((screen.getByLabelText("가상 삼 선택") as HTMLInputElement).disabled).toBe(true); // no parent number

  fireEvent.click(screen.getByLabelText("가상 이 선택"));
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (1명)" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].messages).toHaveLength(1);
  expect(sent[0].messages[0]).toMatchObject({ studentId: 1, recipient: "parent" });
  expect(sent[0].messages[0].text).toContain("클리닉 일정: 수 3시");
  expect(sent[0].messages[0].key).toMatch(/^score:w12:1:parent:[0-9a-f]+$/);
  expect(await screen.findByText("미리보기만 (실제 발송 꺼짐)")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("미리보기만 1건");

  // a second click sends the same key, so the server can refuse a duplicate
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (1명)" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1].messages[0].key).toBe(sent[0].messages[0].key);
});

it("shows duplicates and keeps the checks when switching to students", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { fetchImpl, sent } = fakeServer((body) =>
    Response.json({ success: 0, fail: 0, duplicate: 1, results: body.messages.map((m) => ({ studentId: m.studentId, recipient: "student", to: "x", ok: false, msg: "already_sent" })) }),
  );
  render(<SmsLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByLabelText("발송 대상");
  fireEvent.click(screen.getByRole("button", { name: "학생" }));
  expect((screen.getByLabelText("가상 이 선택") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("가상 삼 선택") as HTMLInputElement).checked).toBe(false); // was unchecked (no parent number)
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (1명)" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].messages[0]).toMatchObject({ studentId: 1, recipient: "student" });
  expect(await screen.findByText("이미 보낸 문자 — 다시 보내지 않음")).toBeTruthy();
});

it("does not send when the confirm is cancelled, and explains a lost reply", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { fetchImpl, sent } = fakeServer(() => new Response(null, { status: 502 }));
  render(<SmsLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByLabelText("발송 대상");
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (2명)" }));
  expect(sent).toHaveLength(0);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (2명)" }));
  expect((await screen.findByRole("alert")).textContent).toContain("이미 나간 문자는 다시 보내지 않습니다");
});

it("lists test absentees and texts the student", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { fetchImpl, sent } = fakeServer(dryRun);
  render(<SmsLive fetchImpl={fetchImpl} />);
  fireEvent.click(await screen.findByRole("button", { name: "테스트 미응시 문자" }));
  fireEvent.change(screen.getByLabelText("실제 반 선택"), { target: { value: "3" } });
  fireEvent.change(await screen.findByLabelText("주차 · 모의고사 선택"), { target: { value: "w11" } });
  expect(await screen.findByText("미응시 학생 — 3명 (11.03)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (2명)" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].messages.map((m) => [m.studentId, m.recipient])).toEqual([
    [1, "student"],
    [3, "student"],
  ]);
  expect(sent[0].messages[0].text).toBe("[용산대성N학원 영어과]\n11.03 테스트 미응시 상태입니다.\n테스트 응시 후 제출 바랍니다.");
  expect(sent[0].messages[0].key).toMatch(/^absent:w11:1:student:/);
});

it("pre-checks clinic no-shows only", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { fetchImpl, sent } = fakeServer(dryRun);
  render(<SmsLive fetchImpl={fetchImpl} />);
  fireEvent.click(await screen.findByRole("button", { name: "클리닉 미참석 문자" }));
  fireEvent.change(screen.getByLabelText("실제 반 선택"), { target: { value: "3" } });
  expect(await screen.findByText("반 전체 3명 · 클리닉 미참석 1명을 체크해 두었어요")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "선택 발송 (1명)" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].messages[0]).toMatchObject({ studentId: 1, recipient: "parent" });
  expect(sent[0].messages[0].text).toContain("가상 일 학생의 영어 클리닉");
  expect(sent[0].messages[0].text).toContain("클리닉 일정: 수 3시");
});

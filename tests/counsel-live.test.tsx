import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CounselLive from "../src/admin/CounselLive";

const cfg = { items: [{ key: "word_score", label: "어휘", max: 50, cut: 40, active: true }] };
const routes: Record<string, unknown> = {
  "/api/admin/classes": [{ id: 3, name: "고2 화목", grade: "고2" }],
  "/api/admin/classes/3/students": [
    { id: 7, name: "가상 실제학생", created_at: new Date(Date.now() - 9 * 86400000).toISOString() },
  ],
  "/api/admin/classes/3/weeks": [
    { id: 11, label: "10.28", test_date: "10.28", item_config: cfg },
    { id: 10, label: "10.21", test_date: "10.21", item_config: cfg },
  ],
  "/api/admin/scores?weekIds=11,10": [
    { student_id: 7, week_id: 10, word_score: 30, homework_rate: 90 },
    { student_id: 8, week_id: 10, word_score: 40 },
    { student_id: 7, week_id: 11, word_score: 45, homework_rate: 80 },
  ],
};

function fakeFetch(password: string) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const ok = (init?.headers as Record<string, string>)["X-Admin-Password"] === password;
    if (!ok) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify(routes[String(url)] ?? null), { status: routes[String(url)] ? 200 : 404 });
  });
}

it("builds a card from live rows using the student's real registration date", async () => {
  const fetchImpl = fakeFetch("pw");
  render(<CounselLive fetchImpl={fetchImpl as unknown as typeof fetch} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByRole("option", { name: "가상 실제학생" });
  fireEvent.change(screen.getByLabelText("실제 학생 선택"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "상담 카드 만들기" }));
  const card = (await screen.findByLabelText("실제 상담 카드")) as HTMLTextAreaElement;
  expect(card.value).toContain("[가상 실제학생 · 고2 화목 · 신규 2주차]  최근 2주차 기준");
  expect(card.value).toContain("총점 반 평균 대비: 10.21 -5 → 10.28 0");
  expect(card.value).toContain("커트라인 미달 많은 항목: 어휘 1/2주");
});

it("tells the teacher when the password is wrong", async () => {
  render(<CounselLive fetchImpl={fakeFetch("pw") as unknown as typeof fetch} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("비밀번호가 맞지 않습니다"));
});

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

// 서버 흉내: 맞는 비밀번호로 로그인해야 세션(쿠키)이 생기고, 그 뒤에만 조회가 된다.
function fakeServer(password: string, aiStatus = 200) {
  let session = false;
  const sent: unknown[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/session" && init?.method === "POST") {
      session = JSON.parse(String(init.body)).password === password;
      return new Response(null, { status: session ? 204 : 401 });
    }
    if (u === "/api/admin/session" && init?.method === "DELETE") {
      session = false;
      return new Response(null, { status: 204 });
    }
    if (!session) return new Response("{}", { status: 401 });
    if (u === "/api/admin/counsel/questions") {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ questions: "1. 요즘 어휘 공부는 어떻게 하고 있나요?" }), { status: aiStatus });
    }
    return new Response(JSON.stringify(routes[u] ?? null), { status: routes[u] ? 200 : 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, sent };
}

async function signInAndBuild(fetchImpl: typeof fetch, pw = "pw") {
  render(<CounselLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("관리자 비밀번호"), { target: { value: pw } });
  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByRole("option", { name: "가상 실제학생" });
  fireEvent.change(screen.getByLabelText("실제 학생 선택"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "상담 카드 만들기" }));
}

it("signs in once, builds the card with the real registration date, and asks AI with summary lines only", async () => {
  const { fetchImpl, sent } = fakeServer("pw");
  await signInAndBuild(fetchImpl);
  const card = (await screen.findByLabelText("실제 상담 카드")) as HTMLTextAreaElement;
  expect(card.value).toContain("[가상 실제학생 · 고2 화목 · 신규 2주차]  최근 2주차 기준");
  expect(card.value).toContain("총점 반 평균 대비: 10.21 -5 → 10.28 0");
  expect(await screen.findByLabelText("상담 질문")).toHaveValue("1. 요즘 어휘 공부는 어떻게 하고 있나요?");
  expect(JSON.stringify(sent)).not.toContain("가상 실제학생");
  expect(sent[0]).toMatchObject({ weekCount: 2 });
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(await screen.findByLabelText("관리자 비밀번호")).toBeInTheDocument();
});

it("keeps the card when AI fails", async () => {
  const { fetchImpl } = fakeServer("pw", 502);
  await signInAndBuild(fetchImpl);
  expect(await screen.findByLabelText("실제 상담 카드")).toBeInTheDocument();
  expect(await screen.findByRole("status")).toHaveTextContent("AI 질문을 만들지 못했습니다");
});

it("tells the teacher when the password is wrong", async () => {
  const { fetchImpl } = fakeServer("pw");
  render(<CounselLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("관리자 비밀번호"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("비밀번호가 맞지 않거나"));
});

import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RosterLive from "../src/admin/RosterLive";

// 서버 흉내: 세션은 이미 있다. PATCH는 "before"가 현재 값과 같을 때만 반영한다(실서버와 같은 규칙).
function fakeServer() {
  const students = [
    { id: 7, name: "가상 학생", pin: "0012", phone: null, student_phone: null, note: "", is_active: true },
  ];
  const patches: unknown[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/roster/classes") return Response.json([{ id: 3, name: "고2 화목", grade: "고2", day: "화", time: null }]);
    if (u === "/api/admin/roster/students?classId=3") return Response.json(students);
    if (u === "/api/admin/roster/students/7" && init?.method === "PATCH") {
      const { before, after } = JSON.parse(String(init.body));
      patches.push({ before, after });
      const row = students[0] as Record<string, unknown>;
      if (Object.keys(after).some((k) => row[k] !== before[k])) return new Response("{}", { status: 409 });
      Object.assign(row, after);
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, patches, students };
}

async function openClass() {
  const server = fakeServer();
  render(<RosterLive mode="students" fetchImpl={server.fetchImpl as never} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "3" } });
  await screen.findByLabelText("가상 학생 이름");
  return server;
}

it("saves an edited field with the value it read, so the server can refuse a stale save", async () => {
  const server = await openClass();
  const name = screen.getByLabelText("가상 학생 이름");
  fireEvent.change(name, { target: { value: "가상 학생2" } });
  fireEvent.blur(name);
  await screen.findByText("저장했습니다.");
  expect(server.patches).toEqual([{ before: { name: "가상 학생" }, after: { name: "가상 학생2" } }]);
  expect(await screen.findByLabelText("가상 학생2 이름")).toBeInTheDocument();
});

it("reloads and warns instead of overwriting when someone else saved first", async () => {
  const server = await openClass();
  server.students[0].pin = "9999"; // score-system changed it after this screen read it
  const pin = screen.getByLabelText("가상 학생 PIN");
  fireEvent.change(pin, { target: { value: "0034" } });
  fireEvent.blur(pin);
  expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳에서 먼저 수정됐습니다");
  expect(server.students[0].pin).toBe("9999");
  await waitFor(() => expect(screen.getByLabelText("가상 학생 PIN")).toHaveValue("9999"));
});

it("withdraws only after confirmation and never deletes", async () => {
  const server = await openClass();
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "가상 학생 퇴원" }));
  expect(server.patches).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "가상 학생 퇴원" }));
  expect(await screen.findByRole("button", { name: "가상 학생 복귀" })).toBeInTheDocument();
  expect(server.patches).toEqual([{ before: { is_active: true }, after: { is_active: false } }]);
  expect(server.fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  confirm.mockRestore();
});

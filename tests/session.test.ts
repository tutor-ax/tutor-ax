import { beforeEach, expect, it, vi } from "vitest";
import {
  GatewayUnavailable,
  InvalidCredentials,
  PARENT_LOGIN_PATH,
  STUDENT_ME_PATH,
  createApiGateway,
} from "../src/gateway";
import { fixtureData } from "./fixtures";

function respond(body: unknown, status = 200) {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
});
const gateway = () => createApiGateway(PARENT_LOGIN_PATH, fetchMock as never, STUDENT_ME_PATH);

it("reads scores from tutor-server and keeps login and logout on parent-login", async () => {
  fetchMock.mockResolvedValue(respond(fixtureData()));
  await gateway().resume();
  await gateway().logout();
  expect(fetchMock.mock.calls.map(([path, init]) => `${init.method} ${path}`)).toEqual([
    "GET /api/student/me",
    "DELETE /api/parent-login",
  ]);
});

it("sends the session cookie on every call to the same-origin endpoint", async () => {
  fetchMock.mockResolvedValue(respond(fixtureData()));
  await gateway().resume();
  const [path, init] = fetchMock.mock.calls[0];
  expect(path).toBe("/api/student/me");
  // The session is an HttpOnly SameSite=Lax cookie: without credentials the
  // browser drops it and every request looks signed out.
  expect(init.credentials).toBe("same-origin");
  expect(init.method).toBe("GET");
});

it("treats 401 on resume as signed out rather than a failure", async () => {
  fetchMock.mockResolvedValue(respond({ error: "session_expired" }, 401));
  await expect(gateway().resume()).resolves.toBeNull();
});

it("reports a rejected PIN separately from an unreachable server", async () => {
  fetchMock.mockResolvedValue(respond({ error: "invalid" }, 401));
  await expect(gateway().login("학생", "0000")).rejects.toBeInstanceOf(
    InvalidCredentials,
  );
  fetchMock.mockResolvedValue(respond({ error: "boom" }, 500));
  await expect(gateway().login("학생", "0000")).rejects.toBeInstanceOf(
    GatewayUnavailable,
  );
  fetchMock.mockRejectedValue(Error("offline"));
  await expect(gateway().login("학생", "0000")).rejects.toBeInstanceOf(
    GatewayUnavailable,
  );
});

it("posts credentials as JSON and never puts them in the URL", async () => {
  fetchMock.mockResolvedValue(respond(fixtureData()));
  await gateway().login("데모 학생", "1234");
  const [path, init] = fetchMock.mock.calls[0];
  expect(path).toBe("/api/parent-login");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ name: "데모 학생", pin: "1234" });
});

it("rejects a malformed or studentless session body instead of showing an empty screen", async () => {
  fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
  await expect(gateway().resume()).rejects.toBeInstanceOf(GatewayUnavailable);
  fetchMock.mockResolvedValue(respond({ weeks: [] }));
  await expect(gateway().resume()).rejects.toBeInstanceOf(GatewayUnavailable);
});

it("defaults every collection so a sparse response cannot crash the screen", async () => {
  fetchMock.mockResolvedValue(respond({ student: { id: 7, name: "학생" } }));
  const data = await gateway().resume();
  expect(data).toMatchObject({
    student: { id: 7 },
    weeks: [],
    myScores: [],
    rankScores: [],
    exams: [],
    myMockScores: [],
    mockRankScores: [],
  });
});

it("asks the server to clear the cookie on logout", async () => {
  fetchMock.mockResolvedValue(respond({ ok: true }));
  await gateway().logout();
  expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
});

it("never stores the session or credentials in browser storage", async () => {
  localStorage.clear();
  // A Response body can only be read once; build a fresh one per call.
  fetchMock.mockImplementation(async () => respond(fixtureData()));
  await gateway().login("데모 학생", "1234");
  await gateway().resume();
  // The cookie is the only session carrier; anything in localStorage would be
  // readable by scripts and outlive the server's own expiry.
  expect(localStorage.length).toBe(0);
});

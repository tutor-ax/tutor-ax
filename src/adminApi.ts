// 관리자 읽기 전용 API(backend/ Spring Boot). 로그인하면 HttpOnly 쿠키(admin_session)로 확인한다 — 비밀번호를 들고 다니지 않는다.
import type { Period } from "./domain";
import type { CounselRow } from "./counsel";

export const ADMIN_API_PATH = "/api/admin";
export interface AdminClass { id: number; name: string; grade: string | null }
export interface AdminStudent { id: number; name: string; created_at: string | null }
export interface AdminWeek extends Period { created_at?: string }

export class AdminUnauthorized extends Error {}
export class AdminLocked extends Error {}
export class AdminUnavailable extends Error {}
/** 409: someone saved this row elsewhere (score-system or another tab) after we read it. Reload, then edit again. */
export class AdminConflict extends Error {}
/** 400: the server rejected a value (e.g. PIN over 4 digits, unknown day). */
export class AdminInvalid extends Error {}

// 반·학생 관리(실제 DB). 학년 고1/고2, 요일 월~일, PIN 4자리 — score-system과 같은 규칙을 서버가 검사한다.
export interface RosterClass { id: number; name: string; grade: string | null; day: string; time: string | null }
export interface RosterStudent {
  id: number;
  name: string;
  pin: string;
  phone: string | null;
  student_phone: string | null;
  note: string | null;
  is_active: boolean;
}

export function createAdminApi(fetchImpl: typeof fetch = fetch) {
  async function call(path: string, init: RequestInit = {}, timeoutMs = 15000) {
    let res: Response;
    try {
      res = await fetchImpl(`${ADMIN_API_PATH}${path}`, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(timeoutMs),
        ...init,
      });
    } catch (cause) {
      throw new AdminUnavailable(String(cause));
    }
    if (res.status === 401) throw new AdminUnauthorized();
    if (res.status === 429) throw new AdminLocked();
    if (res.status === 409) throw new AdminConflict();
    if (res.status === 400) throw new AdminInvalid();
    if (!res.ok) throw new AdminUnavailable(`status ${res.status}`);
    return res;
  }
  async function list<T>(path: string): Promise<T> {
    const data: unknown = await (await call(path)).json().catch(() => null);
    if (!Array.isArray(data)) throw new AdminUnavailable("bad payload");
    return data as T;
  }
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const send = (method: string, body: unknown): RequestInit => ({ ...json(body), method });
  return {
    rosterClasses: () => list<RosterClass[]>("/roster/classes"),
    rosterStudents: (classId: number) => list<RosterStudent[]>(`/roster/students?classId=${classId}`),
    addClass: async (c: Omit<RosterClass, "id">) => void (await call("/roster/classes", json(c))),
    addStudent: async (s: { name: string; pin: string; class_id: number; phone: string; student_phone: string }) =>
      void (await call("/roster/students", json(s))),
    // before = 화면이 읽어 온 값. 서버는 그 값이 그대로일 때만 바꾼다(덮어쓰기 방지).
    patch: async (kind: "classes" | "students", id: number, before: object, after: object) =>
      void (await call(`/roster/${kind}/${id}`, send("PATCH", { before, after }))),
    login: async (password: string) => void (await call("/session", json({ password }))),
    logout: async () => void (await call("/session", { method: "DELETE" })),
    classes: () => list<AdminClass[]>("/classes"),
    students: (classId: number) => list<AdminStudent[]>(`/classes/${classId}/students`),
    weeks: (classId: number) => list<AdminWeek[]>(`/classes/${classId}/weeks`),
    scores: (weekIds: number[]) => list<CounselRow[]>(`/scores?weekIds=${weekIds.join(",")}`),
    // 요약 줄만 보낸다(이름·메모 원문 없음). 모델 응답이 느려 시간 제한을 길게 둔다.
    questions: async (lines: string[], weekCount: number) => {
      const data = (await (await call("/counsel/questions", json({ lines, weekCount }), 30000))
        .json()
        .catch(() => null)) as { questions?: unknown } | null;
      if (typeof data?.questions !== "string") throw new AdminUnavailable("bad payload");
      return data.questions;
    },
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;

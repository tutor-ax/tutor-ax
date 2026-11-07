import type { Period, ScoreRow } from "./domain";

export interface LoginData {
  student: { id: number; name: string; classes?: { name: string } | null };
  weeks: Period[];
  myScores: ScoreRow[];
  rankScores: ScoreRow[];
  groupWeekMap?: Record<string, number[]>;
  exams: Period[];
  myMockScores: ScoreRow[];
  mockRankScores: ScoreRow[];
  mockGroupExamMap?: Record<string, number[]>;
}

/**
 * Application boundary for student score data.
 *
 * The live implementation talks to the existing `parent-login` endpoint, which
 * owns the session. This app never issues its own session: it reads the
 * `parent_session` HttpOnly cookie the legacy score screen already set, so a
 * student who signed in there arrives here still signed in.
 */
export interface ScoreGateway {
  /** Restore an existing session. `null` means signed out — not an error. */
  resume(): Promise<LoginData | null>;
  /** Exchange name + PIN for a session cookie. */
  login(name: string, pin: string): Promise<LoginData>;
  /** Clear the session cookie. */
  logout(): Promise<void>;
}

/** Thrown when the server rejected the supplied name/PIN. */
export class InvalidCredentials extends Error {
  constructor() {
    super("invalid_credentials");
    this.name = "InvalidCredentials";
  }
}

/** Thrown when the endpoint is unreachable or answered unusably. */
export class GatewayUnavailable extends Error {
  constructor(cause?: unknown) {
    super("gateway_unavailable", { cause });
    this.name = "GatewayUnavailable";
  }
}

/**
 * Same-origin path served by the Vercel rewrite in front of the Supabase
 * function. It must stay same-origin: the session cookie is `SameSite=Lax`,
 * so a cross-origin call would silently drop it.
 */
export const PARENT_LOGIN_PATH = "/api/parent-login";

/**
 * Read-only score endpoint of tutor-server (migration phase 1–3). It verifies the
 * same `parent_session` cookie, so login and logout stay on parent-login.
 * Rollback: point the `/api/student/me` rewrite in vercel.json back at parent-login.
 */
export const STUDENT_ME_PATH = "/api/student/me";

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new GatewayUnavailable(cause);
  }
}

function asLoginData(payload: unknown): LoginData {
  const data = payload as Partial<LoginData> | null;
  // A session response without a student is unusable; treat it as a fault
  // rather than rendering an empty screen that looks like "no records".
  if (!data || typeof data !== "object" || !data.student?.id) {
    throw new GatewayUnavailable();
  }
  return {
    student: data.student,
    weeks: data.weeks ?? [],
    myScores: data.myScores ?? [],
    rankScores: data.rankScores ?? [],
    groupWeekMap: data.groupWeekMap,
    exams: data.exams ?? [],
    myMockScores: data.myMockScores ?? [],
    mockRankScores: data.mockRankScores ?? [],
    mockGroupExamMap: data.mockGroupExamMap,
  };
}

export function createApiGateway(
  path: string = PARENT_LOGIN_PATH,
  fetchImpl: typeof fetch = fetch,
  readPath: string = STUDENT_ME_PATH,
): ScoreGateway {
  async function call(init: RequestInit, url: string = path): Promise<Response> {
    try {
      return await fetchImpl(url, {
        // The session lives in an HttpOnly cookie, so every call must carry
        // credentials even though the request is same-origin.
        credentials: "same-origin",
        ...init,
      });
    } catch (cause) {
      throw new GatewayUnavailable(cause);
    }
  }
  return {
    async resume() {
      const response = await call({ method: "GET" }, readPath);
      // 401 is the documented "no valid session" answer, not a failure.
      if (response.status === 401) return null;
      if (!response.ok) throw new GatewayUnavailable();
      return asLoginData(await readJson(response));
    },
    async login(name, pin) {
      const response = await call({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin }),
      });
      if (response.status === 401) throw new InvalidCredentials();
      if (!response.ok) throw new GatewayUnavailable();
      return asLoginData(await readJson(response));
    },
    async logout() {
      // The server clears the cookie; a failure here must still sign the user
      // out locally, so the caller treats this as best-effort.
      await call({ method: "DELETE" });
    },
  };
}

// 관리자 읽기 전용 API(backend/ Spring Boot). 로그인하면 HttpOnly 쿠키(admin_session)로 확인한다 — 비밀번호를 들고 다니지 않는다.
import type { Item, Period, ScoreRow } from "./domain";
import type { CounselRow } from "./counsel";

export const ADMIN_API_PATH = "/api/admin";
export interface AdminClass { id: number; name: string; grade: string | null }
export interface AdminStudent { id: number; name: string; created_at: string | null }
export interface AdminWeek extends Period { created_at?: string; class_id?: number; memo?: string | null }

export class AdminUnauthorized extends Error {}
export class AdminLocked extends Error {}
export class AdminUnavailable extends Error {}
/** 409: someone saved this row elsewhere (score-system or another tab) after we read it. Reload, then edit again. */
export class AdminConflict extends Error {
  /** Score saves only: the fields someone else changed, with their saved values. */
  constructor(readonly current: Record<string, unknown> = {}) {
    super("changed_elsewhere");
  }
}
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

// 문자: 번호는 서버가 학생 id로 찾는다. key가 같은 문자는 서버가 두 번 보내지 않는다(재시도 안전).
export interface SmsMessage { studentId: number; recipient: "parent" | "student"; text: string; key: string }
export interface SmsResult { studentId: number; recipient: string; to: string; ok: boolean; msg: string }
export interface SmsResponse { success: number; fail: number; dryRun?: number; duplicate?: number; results: SmsResult[] }

/** 옮길 점수 행 하나: 기존 주차로(to_week_id), 새 주차로(new_label), 둘 다 없으면 옮기지 않음. */
export interface MovePlan { from_week_id: number; to_week_id?: number; new_label?: string }

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
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { current?: Record<string, unknown> } | null;
      throw new AdminConflict(body?.current ?? {});
    }
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
  const asWeek = (e: AdminWeek): AdminWeek => ({ ...e, test_date: e.exam_date });
  return {
    rosterClasses: () => list<RosterClass[]>("/roster/classes"),
    rosterStudents: (classId: number) => list<RosterStudent[]>(`/roster/students?classId=${classId}`),
    addClass: async (c: Omit<RosterClass, "id">) => void (await call("/roster/classes", json(c))),
    addStudent: async (s: { name: string; pin: string; class_id: number; phone: string; student_phone: string }) =>
      void (await call("/roster/students", json(s))),
    // 체크한 반들을 한 비교 그룹으로 한 번에 추가한다. 서버는 전부 넣거나 하나도 넣지 않는다.
    addWeeks: async (base: string, weeks: { class_id: number; test_date: string }[]) =>
      void (await call("/roster/weeks", json({ base, weeks }))),
    // 학생 한 명의 바뀐 칸만. 칸 이름: score:<항목>, retest:<항목>, homework_rate·homework_eval·attendance·clinic_memo.
    saveScore: async (s: { week_id: number; student_id: number; items: string[]; no_homework: boolean; before: object; after: object }) =>
      void (await call("/roster/scores", send("PUT", s))),
    // 주차 도구(점수 입력 탭). 서버가 그룹 전체를 한 번에 바꾸고, 화면이 읽은 뒤 바뀌었으면 409.
    allWeeks: () => list<AdminWeek[]>("/roster/weeks"),
    saveMemo: async (weekId: number, before: string, after: string) =>
      void (await call(`/roster/weeks/${weekId}/memo`, send("PUT", { before, after }))),
    setNoHomework: async (weekId: number, noHomework: boolean) =>
      void (await call(`/roster/weeks/${weekId}/no-homework`, send("PUT", { no_homework: noHomework }))),
    saveItemConfig: async (weekId: number, c: { before: unknown; group_id: string | null; cut_all: boolean; items: Item[] }) =>
      void (await call(`/roster/weeks/${weekId}/item-config`, send("PUT", c))),
    saveGroup: async (weekId: number, weekIds: number[], before: Record<number, string | null>) =>
      void (await call(`/roster/weeks/${weekId}/group`, send("PUT", { week_ids: weekIds, before }))),
    // 모의고사(이전 5단계). 주차 도구(정렬·비교 그룹 선택)를 그대로 쓰도록 exam_date를 test_date로도 둔다.
    mockExams: async (classId: number) => (await list<AdminWeek[]>(`/classes/${classId}/mock-exams`)).map(asWeek),
    allMockExams: async () => (await list<AdminWeek[]>("/roster/mock-exams")).map(asWeek),
    mockScores: (examIds: number[]) => list<ScoreRow[]>(`/mock-scores?examIds=${examIds.join(",")}`),
    addMockExams: async (date: string, label: string, classIds: number[]) =>
      void (await call("/roster/mock-exams", json({ date, label, class_ids: classIds }))),
    // 학생 한 명의 바뀐 칸만. 칸 이름: score:<항목>, retest:<항목>, memo, absent(미응시).
    saveMockScore: async (s: { exam_id: number; student_id: number; items: string[]; before: object; after: object }) =>
      void (await call("/roster/mock-scores", send("PUT", s))),
    saveMockItemConfig: async (examId: number, c: { before: unknown; group_id: string | null; cut_all: boolean; items: Item[] }) =>
      void (await call(`/roster/mock-exams/${examId}/item-config`, send("PUT", c))),
    saveMockGroup: async (examId: number, examIds: number[], before: Record<number, string | null>) =>
      void (await call(`/roster/mock-exams/${examId}/group`, send("PUT", { week_ids: examIds, before }))),
    // 다른 반 학생 입력·반 이동. 주차 짝짓기는 화면(weekMatch.ts)이 하고, 서버는 그 계획을 검사해 한 번에 적용한다.
    searchStudents: (q: string) => list<{ id: number; name: string; class_id: number }[]>(`/roster/students/search?q=${encodeURIComponent(q)}`),
    scoreWeeks: (studentId: number) => list<number[]>(`/roster/students/${studentId}/score-weeks`),
    copyWeek: async (b: { class_id: number; label: string; from_week_id: number }) =>
      ((await (await call("/roster/weeks/copy", json(b))).json()) as { id: number }).id,
    moveStudent: async (studentId: number, b: { from_class_id: number; to_class_id: number; dry_run: boolean; moves: MovePlan[] }) =>
      (await (await call(`/roster/students/${studentId}/move`, json(b))).json()) as { moved: number; created: number; kept: number },
    // before = 화면이 읽어 온 값. 서버는 그 값이 그대로일 때만 바꾼다(덮어쓰기 방지).
    patch: async (kind: "classes" | "students", id: number, before: object, after: object) =>
      void (await call(`/roster/${kind}/${id}`, send("PATCH", { before, after }))),
    // 300건을 8개씩 보내면 20초 남짓 걸릴 수 있어 Lambda 시간 제한(30초)에 맞춘다.
    sendSms: async (messages: SmsMessage[]) => (await (await call("/sms", json({ messages }), 30000)).json()) as SmsResponse,
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

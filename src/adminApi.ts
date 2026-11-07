// 관리자 읽기 전용 API(backend/ Spring Boot). 비밀번호는 메모리에만 두고 요청마다 헤더로 보낸다.
import type { Period } from "./domain";
import type { CounselRow } from "./counsel";

export const ADMIN_API_PATH = "/api/admin";
export interface AdminClass { id: number; name: string; grade: string | null }
export interface AdminStudent { id: number; name: string; created_at: string | null }
export interface AdminWeek extends Period { created_at?: string }

export class AdminUnauthorized extends Error {}
export class AdminUnavailable extends Error {}

export function createAdminApi(password: string, fetchImpl: typeof fetch = fetch) {
  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${ADMIN_API_PATH}${path}`, {
        headers: { "X-Admin-Password": password },
        signal: AbortSignal.timeout(15000),
      });
    } catch (cause) {
      throw new AdminUnavailable(String(cause));
    }
    if (res.status === 401) throw new AdminUnauthorized();
    if (!res.ok) throw new AdminUnavailable(`status ${res.status}`);
    const data: unknown = await res.json().catch(() => null);
    if (!Array.isArray(data)) throw new AdminUnavailable("bad payload");
    return data as T;
  }
  return {
    classes: () => get<AdminClass[]>("/classes"),
    students: (classId: number) => get<AdminStudent[]>(`/classes/${classId}/students`),
    weeks: (classId: number) => get<AdminWeek[]>(`/classes/${classId}/weeks`),
    scores: (weekIds: number[]) => get<CounselRow[]>(`/scores?weekIds=${weekIds.join(",")}`),
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;

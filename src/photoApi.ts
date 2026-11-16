export const HOMEWORK_PHOTOS_PATH = "/api/student/homework-photos";
// Same limits as tutor-server HomeworkPhotoController; the server and S3 enforce them, this only answers early.
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic"];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_WEEK = 5;

export interface HomeworkPhoto {
  student_id: number;
  url: string;
  uploaded_at: string;
}

export class PhotoError extends Error {}

const MESSAGES: Record<number, string> = {
  400: "JPG·PNG·HEIC 사진, 10MB 이하만 올릴 수 있어요.",
  401: "로그인이 만료됐습니다. 다시 로그인해주세요.",
  403: "이 주차에는 사진을 올릴 수 없어요.",
  409: `한 주차에 사진은 ${MAX_PHOTOS_PER_WEEK}장까지 올릴 수 있어요.`,
};
const FAILED = "사진을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";

export function createHomeworkApi(fetchImpl: typeof fetch = fetch) {
  async function call(url: string, init: RequestInit = {}, timeoutMs = 15000) {
    let res: Response;
    try {
      res = await fetchImpl(url, { credentials: "same-origin", signal: AbortSignal.timeout(timeoutMs), ...init });
    } catch {
      throw new PhotoError(FAILED);
    }
    if (!res.ok) throw new PhotoError(MESSAGES[res.status] ?? FAILED);
    return res;
  }
  return {
    list: async (weekId: number) => {
      const data: unknown = await (await call(`${HOMEWORK_PHOTOS_PATH}?weekId=${weekId}`)).json().catch(() => null);
      if (!Array.isArray(data)) throw new PhotoError(FAILED);
      return data as HomeworkPhoto[];
    },
    upload: async (weekId: number, file: File) => {
      if (!PHOTO_TYPES.includes(file.type) || file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new PhotoError(MESSAGES[400]);
      const res = await call(HOMEWORK_PHOTOS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_id: weekId, content_type: file.type, size: file.size }),
      });
      const { url, content_type } = (await res.json()) as { url: string; content_type: string };
      // Straight to S3 with the signed type; the session cookie must not go to another origin.
      await call(url, { method: "PUT", headers: { "Content-Type": content_type }, body: file, credentials: "omit" }, 120000);
    },
  };
}
export type HomeworkApi = ReturnType<typeof createHomeworkApi>;

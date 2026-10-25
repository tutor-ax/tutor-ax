import type { Period, ScoreRow } from "./domain";
import fixture from "./data/demo-score.json";

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

/** Demo-only application boundary. No live backend adapter is supplied. */
export interface ScoreGateway {
  resume(): Promise<LoginData | null>;
  openDemo(): Promise<LoginData>;
  logout(): Promise<void>;
}
export type SessionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export const DEMO_SESSION_KEY = "tutor-ax.demo-session.v1";
const demoData = (): LoginData => structuredClone(fixture) as LoginData;
const SESSION_TTL = 12 * 60 * 60 * 1000;
export function createDemoGateway(storage: SessionStorage): ScoreGateway {
  function clear() {
    try {
      storage.removeItem(DEMO_SESSION_KEY);
    } catch {
      /* Storage can be disabled. */
    }
  }
  return {
    async resume() {
      try {
        const saved = JSON.parse(storage.getItem(DEMO_SESSION_KEY) || "null");
        if (
          saved?.version === 1 &&
          Number.isFinite(saved.expiresAt) &&
          saved.expiresAt > Date.now()
        ) {
          return demoData();
        }
      } catch {
        /* Malformed or unavailable storage means signed out. */
      }
      clear();
      return null;
    },
    async openDemo() {
      try {
        storage.setItem(
          DEMO_SESSION_KEY,
          JSON.stringify({ version: 1, expiresAt: Date.now() + SESSION_TTL }),
        );
      } catch {
        /* Demo works in memory; refresh will require re-entry. */
      }
      return demoData();
    },
    async logout() {
      clear();
    },
  };
}

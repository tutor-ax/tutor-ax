import { expect, it } from "vitest";
import {
  counselBrief,
  counselCard,
  counselPrompt,
  type CounselRow,
} from "../src/counsel";

const cfg = {
  items: [
    { key: "word_score", label: "어휘", max: 50, cut: 40, active: true },
    { key: "reading_score", label: "해석", max: 50, cut: 30, active: true },
    { key: "mc_score", active: false },
  ],
};
const weeks = [1, 2, 3, 4].map((i) => ({ id: i, label: `10.${i}`, item_config: cfg }));
const row = (
  sid: number,
  w: number,
  word: number,
  read: number,
  extra: Partial<CounselRow> = {},
): CounselRow => ({ student_id: sid, week_id: w, word_score: word, reading_score: read, item_scores: {}, ...extra });
const rows = [
  row(7, 1, 45, 40, { homework_rate: 90 }),
  row(9, 1, 35, 35),
  row(7, 2, 38, 35, { homework_rate: 90, retest_pass: { word_score: false } }),
  row(9, 2, 35, 35),
  row(7, 3, 36, 30, { homework_rate: 50, attendance: false, clinic_target: true, clinic_memo: "목 6시" }),
  row(9, 3, 35, 35),
  row(7, 4, 30, 29, { homework_rate: 40, clinic_target: true, clinic_attend: true, no_homework: true }),
  row(9, 4, 35, 35),
];
const NOW = Date.parse("2026-11-07T00:00:00Z");

it("summarizes the signals a teacher needs before a face-to-face talk", () => {
  const b = counselBrief(weeks, rows, 7, "2026-10-28T00:00:00Z", NOW);
  expect(b.newWeek).toBe(2);
  expect(b.lines).toEqual([
    "신규생 2주차 (등록 후 4주 이내)",
    "총점 반 평균 대비: 10.1 +7.5 → 10.2 +1.5 → 10.3 -2 → 10.4 -5.5 (최근 3주 연속 하락)",
    "커트라인 미달 많은 항목: 어휘 3/4주, 해석 1/4주",
    "재시험 기록: 통과 0 · 미통과 1 (어휘 1)",
    "과제 완료율: 90% → 90% → 50% → 40% (최근 2주 급락), 미제출 1회",
    "클리닉: 대상 2주 중 참석 1주",
    "결석 1회 (10.3)",
  ]);
  expect(b.memos).toEqual([{ week: "10.3", memo: "목 6시" }]);
});

it("keeps names and memo text out of the model prompt", () => {
  const b = counselBrief(weeks, rows, 7, null, NOW);
  const card = counselCard("가상 학생 A · 데모 A", 4, b);
  expect(card).toContain("가상 학생 A");
  expect(card).toContain("10.3: 목 6시");
  const prompt = counselPrompt(b, 4);
  expect(prompt).not.toContain("가상 학생 A");
  expect(prompt).not.toContain("목 6시");
  expect(prompt).toContain("최근 3주 연속 하락");
});

it("reports missing weeks instead of inventing numbers", () => {
  const b = counselBrief(weeks, rows, 99, null, NOW);
  expect(b.lines).toEqual(["기록 없는 주차: 10.1, 10.2, 10.3, 10.4"]);
  expect(b.newWeek).toBeNull();
  expect(counselCard("x", 4, { lines: [], memos: [], newWeek: null })).toContain("눈에 띄는 기록 없음");
});

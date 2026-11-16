import { expect, it } from "vitest";
import type { AdminWeek, RosterStudent } from "../src/adminApi";
import type { ScoreRow } from "../src/domain";
import {
  clinicExpected,
  composeScore,
  DEFAULT_TEMPLATES,
  fillSmsTemplate,
  isTestAbsent,
  mockScoreTargets,
  scoreWarnings,
  smsBytes,
  smsKey,
  weekScoreTargets,
} from "../src/sms";

const st = (id: number, name: string): RosterStudent => ({ id, name, pin: "0000", phone: "010-1", student_phone: null, note: null, is_active: true });
const week: AdminWeek = {
  id: 12,
  label: "11.10",
  memo: "단어 3과 외우기",
  item_config: {
    items: [
      { key: "word_score", label: "단어", max: 25, cut: 20, active: true },
      { key: "reading_score", label: "해석", max: 30, cut: null, active: true },
      { key: "mc_score", label: "객관식", max: 45, cut: 30, active: false },
    ],
  },
};

it("drops lines whose placeholder is empty, like score-system", () => {
  expect(fillSmsTemplate("A {x}\n총점 {y}\n끝", { x: "1", y: "" })).toBe("A 1\n끝");
  expect(smsBytes("가a")).toBe(3);
});

it("composes the weekly score message with verdicts, retest and clinic lines", () => {
  const rows: ScoreRow[] = [
    { student_id: 1, week_id: 12, word_score: 18, reading_score: 27, mc_score: null, item4_score: null, homework_rate: 90, clinic_memo: "수 3시", retest_pass: {} },
    { student_id: 2, week_id: 12, word_score: 15, reading_score: null, mc_score: null, item4_score: null, homework_rate: null, retest_pass: { word_score: true } },
  ];
  const [a, b, c] = weekScoreTargets([st(1, "가"), st(2, "나"), st(3, "다")], rows, week, "11.10");
  expect(composeScore(a, false, DEFAULT_TEMPLATES)).toBe(
    "[용산대성N학원 영어과]\n가 학생 11.10 테스트 결과입니다.\n단어 18/25 (재시험), 해석 27/30\n총점 45/55\n과제 수행률: 90%\n단어 3과 외우기\n재시험 대상: 단어\n클리닉 일정: 수 3시\n감사합니다.",
  );
  const tpl = { ...DEFAULT_TEMPLATES, clinicDefault: "이번 주 클리닉 대상이 아닙니다." };
  expect(composeScore(b, false, tpl)).toContain("단어 15/25 (재시험 통과)\n총점 15/25\n단어 3과 외우기\n재시험 통과: 단어\n이번 주 클리닉 대상이 아닙니다.");
  expect(c.absent).toBe(true);
  expect(composeScore(c, false, DEFAULT_TEMPLATES)).toBe("[용산대성N학원 영어과]\n다 학생은 11.10 테스트에 응시하지 않았습니다.\n확인 부탁드립니다.");
  expect(scoreWarnings([a, b, c], DEFAULT_TEMPLATES)).toEqual([
    "1명은 클리닉메모가 비어 있어 클리닉 줄이 빠집니다. (점수 입력 탭 '클리닉메모' 칸에 입력하거나 위 기본 문구를 채우세요)",
  ]);
});

it("leaves out the homework lines on a no-homework week", () => {
  const rows = [{ student_id: 1, week_id: 12, word_score: 22, reading_score: 30, homework_rate: 80, no_homework: true }];
  const [a] = weekScoreTargets([st(1, "가")], rows, week, "11.10");
  const text = composeScore(a, false, DEFAULT_TEMPLATES);
  expect(text).not.toContain("과제");
  expect(text).toContain("단어 22/25 (통과)");
  expect(scoreWarnings([a], DEFAULT_TEMPLATES)[0]).toContain("과제 줄이 빠집니다");
});

it("computes the mock average and rank over the comparison group", () => {
  const exam: AdminWeek = { id: 31, label: "6월 모의", exam_date: "6.10", group_id: "g", item_config: null };
  const rows = [
    { student_id: 1, exam_id: 31, item1_score: 80 },
    { student_id: 2, exam_id: 31, score: 70, item1_score: null }, // old score-only row
    { student_id: 3, exam_id: 31, absent: true },
  ];
  const group = [...rows, { student_id: 9, exam_id: 41, item1_score: 90 }];
  const { targets, avg, sample } = mockScoreTargets([st(1, "가"), st(2, "나"), st(3, "다"), st(4, "라")], rows, exam, group);
  expect([avg, sample]).toEqual(["80.0", 3]);
  expect(targets.map((t) => t.student.name)).toEqual(["가", "나", "다", "라"]);
  expect(composeScore(targets[0], true, DEFAULT_TEMPLATES)).toBe(
    "[용산대성N학원 영어과]\n가 학생 6월 모의 결과입니다.\n총점 80/100\n평균 80.0점\n석차 2등 / 응시인원 3명\n감사합니다.",
  );
  expect(composeScore(targets[1], true, DEFAULT_TEMPLATES)).toContain("총점 70/100\n평균 80.0점\n석차 3등");
  expect(targets[2].absent && targets[3].notTarget).toBe(true);
  expect(composeScore(targets[3], true, DEFAULT_TEMPLATES)).toBe("[용산대성N학원 영어과]\n라 학생은 6월 모의에 응시하지 않았습니다.\n확인 부탁드립니다.");
  // group failed to load: average and rank lines drop out
  const failed = mockScoreTargets([st(1, "가")], rows, { ...exam, label: "6.10" }, null);
  expect(composeScore(failed.targets[0], true, DEFAULT_TEMPLATES)).toBe("[용산대성N학원 영어과]\n가 학생 6.10 모의고사 결과입니다.\n총점 80/100\n감사합니다.");
});

it("finds test absentees per score-system rules", () => {
  expect(isTestAbsent(undefined, week, false)).toBe(true);
  expect(isTestAbsent({ word_score: 20, reading_score: null }, week, false)).toBe(true);
  expect(isTestAbsent({ word_score: 20, reading_score: 10, mc_score: null }, week, false)).toBe(false); // inactive item ignored
  expect(isTestAbsent({ item1_score: null }, week, true)).toBe(false);
  expect(isTestAbsent({ absent: true }, week, true)).toBe(true);
});

it("knows who is expected at the clinic", () => {
  expect(clinicExpected(undefined, week)).toBe(false);
  expect(clinicExpected({ clinic_memo: "수 3시" }, week)).toBe(true);
  expect(clinicExpected({ clinic_memo: "통과" }, week)).toBe(false);
  expect(clinicExpected({ clinic_target: true, clinic_memo: "" }, week)).toBe(true);
  // passed every cut item: homework-only, no day in the memo → not expected
  expect(clinicExpected({ clinic_memo: "과제 확인", word_score: 22, reading_score: 10 }, week)).toBe(false);
  expect(clinicExpected({ clinic_memo: "과제 확인", word_score: 10, reading_score: 10 }, week)).toBe(true);
});

it("makes a stable key that changes with the text", () => {
  expect(smsKey("score:w12", 1, "parent", "안녕")).toBe(smsKey("score:w12", 1, "parent", "안녕"));
  expect(smsKey("score:w12", 1, "parent", "안녕")).not.toBe(smsKey("score:w12", 1, "parent", "안녕!"));
  expect(smsKey("score:w12", 1, "parent", "안녕")).toMatch(/^score:w12:1:parent:[0-9a-f]+$/);
});

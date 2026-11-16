import { expect, it } from "vitest";
import { buildClinicSchedule, clinicColLabel, clinicColumns, clinicHwDeadline, clinicTallies, isUncert, parseClinicMemo, recentClinicWeeks } from "../src/clinic";
import { clinicClasses, clinicRows, clinicStudents, clinicWeeks } from "./clinic-fixture";

// 기대값은 score-system admin.html의 parseClinicMemo를 같은 입력으로 돌린 결과다.
it("reads clinic memos like score-system", () => {
  const e = (day: string, min: number | string | null, note = "", exact: string | null = null) => ({ day, min, note, exact });
  expect(parseClinicMemo("월요일 3시, 수요일 4시")).toEqual([e("월", 900), e("수", 960)]);
  expect(parseClinicMemo("수요일 4시에서 5시로")).toEqual([e("수", 1020)]);
  expect(parseClinicMemo("목 6시 (금요일은 불가능)")).toEqual([e("목", 1080)]);
  expect(parseClinicMemo("화 2:45")).toEqual([e("화", 870, "", "2:45")]);
  expect(parseClinicMemo("수요일 하교 후")).toEqual([e("수", "after_school")]);
  expect(parseClinicMemo("과제는 토요일까지 인증")).toEqual([]);
  expect(parseClinicMemo("수 / 목 시간 미정")).toEqual([e("수", null), e("목", null, "시간 미정")]);
  expect(parseClinicMemo("수요일 4시 이후")).toEqual([e("수", 960, "이후")]);
  expect(parseClinicMemo("내일 일찍 옴")).toEqual([]);
  expect(clinicHwDeadline("못한 과제는 토요일 저녁까지 사진으로 인증해주세요")).toBe("토요일 저녁까지");
  expect(clinicHwDeadline("토요일까지")).toBeNull();
  expect([930, "after_school", null].map((v) => clinicColLabel(v as never))).toEqual(["3시 반", "하교 후", "시간 미정"]);
});

it("builds the schedule from each class's latest clinic week and drops stale classes", () => {
  const students = Object.entries(clinicStudents).flatMap(([cid, list]) => list.map((s) => ({ ...s, class_id: Number(cid) })));
  const s = buildClinicSchedule(clinicClasses, recentClinicWeeks(clinicWeeks), students, clinicRows);
  expect(s.grades).toEqual(["고1", "고2"]);
  const g1 = s.data["고1"];
  // 옛 주차(삼번), '통과' 메모(오번), 퇴원 학생(9)은 빠진다
  expect(g1.entries.map((e) => [e.name, e.day, e.min, e.items, e.hwOnly])).toEqual([["일번", "월", 900, ["단"], false]]);
  expect(g1.unassigned.map((u) => [u.name, u.hw, u.items])).toEqual([["사번", 60, ["단"]]]);
  expect(g1.hwDue).toEqual([{ sid: "11:2", name: "이번", hw: null, due: "토요일까지" }]);
  expect(g1.weekOf).toEqual({ "고1 수요일 상반": "11.12", "고1 토요일": "11.15" });
  const g2 = s.data["고2"];
  expect(g2.stale).toEqual([{ name: "고2 화", label: "11.4" }]);
  expect(g2.entries.map((e) => [e.name, e.day, e.min, e.items, e.hwOnly])).toEqual([["칠번", "목", 1020, [], false]]);
  expect(s.refs["51:7"]).toEqual({ weekId: 51, studentId: 7, attend: true, items: ["word_score", "reading_score"] });
  expect(clinicColumns(g1.entries)).toEqual({ keys: [900], days: ["월"] });
  // 고1 토요일은 수요일 상반 시험지를 쓴다 — 한 표로 합친다
  const [t] = clinicTallies("고1", g1);
  expect(t.title).toBe("고1 수요일 상반 (+ 고1 토요일)");
  expect(t.t!.rows).toEqual(["월", "요일 미정"]);
  expect(t.t!.cols.map((c) => c.abbr)).toEqual(["단"]);
  expect(t.t!.colSum("단")).toBe(2);
});

it("keeps only the newest eight weeks per class", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, class_id: 1, label: `10.${i + 1}`, test_date: `10.${i + 1}`, created_at: "2026-10-20T00:00:00Z" }));
  expect(recentClinicWeeks(many).map((w) => w.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
});

it("flags uncertified students like score-system renderUncertGrid", () => {
  const r = (homework_rate: number | null, homework_eval = "") => ({ student_id: 1, week_id: 1, homework_rate, homework_eval });
  expect(isUncert([r(80), undefined])).toBe(false);
  expect(isUncert([r(80), r(79)])).toBe(true);
  expect(isUncert([r(null)])).toBe(true);
  expect(isUncert([r(100, "단어 미제출")])).toBe(true);
  expect(isUncert([undefined])).toBe(false);
});

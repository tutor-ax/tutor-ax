const cfg = {
  items: [
    { key: "word_score", label: "단어", max: 25, cut: 15, active: true },
    { key: "reading_score", label: "해석", max: 30, cut: 20, active: true },
    { key: "mc_score", active: false },
  ],
};
const wk = (id: number, class_id: number, label: string) => ({ id, class_id, label, test_date: label, group_id: null, item_config: cfg, created_at: "2026-11-16T00:00:00Z" });
export const clinicClasses = [
  { id: 1, name: "고1 수요일 상반", grade: "고1" },
  { id: 2, name: "고1 토요일", grade: "고1" },
  { id: 3, name: "고2 화", grade: "고2" },
  { id: 5, name: "고2 목", grade: "고2" },
];
export const clinicWeeks = [wk(51, 5, "11.13"), wk(31, 3, "11.4"), wk(21, 2, "11.15"), wk(11, 1, "11.12"), wk(10, 1, "11.5")];
export const clinicStudents: Record<number, { id: number; name: string }[]> = {
  1: [
    { id: 1, name: "일번" },
    { id: 2, name: "이번" },
    { id: 3, name: "삼번" },
    { id: 5, name: "오번" },
  ],
  2: [{ id: 4, name: "사번" }],
  3: [{ id: 6, name: "육번" }],
  5: [{ id: 7, name: "칠번" }],
};
const row = (student_id: number, week_id: number, r: Record<string, unknown>) => ({
  student_id, week_id, word_score: null, reading_score: null, homework_rate: null, homework_eval: null,
  clinic_memo: "", clinic_target: false, clinic_attend: false as boolean | null, ...r,
});
export const clinicRows = [
  row(1, 11, { word_score: 10, reading_score: 25, clinic_memo: "월요일 3시", homework_rate: 80 }),
  row(2, 11, { word_score: 20, reading_score: 25, clinic_memo: "과제는 토요일까지 인증" }),
  row(3, 10, { clinic_memo: "화 4시" }),
  row(4, 21, { word_score: 5, clinic_target: true, homework_rate: 60 }),
  row(5, 11, { word_score: 22, reading_score: 25, clinic_memo: "올 통과" }),
  row(6, 31, { clinic_memo: "수 4시" }),
  row(7, 51, { clinic_memo: "목 5시", clinic_attend: true }),
  row(9, 11, { clinic_memo: "월 3시" }),
];

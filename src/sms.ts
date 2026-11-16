import type { AdminWeek, RosterStudent } from "./adminApi";
import { parseClinicMemo } from "./clinic";
import { activeItems, hasMockScore, isBelowCut, itemVal, MOCK_ITEMS, mockTotal, normalizeItemConfig, stats, type Item, type ScoreRow } from "./domain";
import { blank } from "./scoreSheet";

export type Recipient = "parent" | "student";

// score-system admin.html의 처음 문구 그대로.
export const DEFAULT_TEMPLATES = {
  week: `[용산대성N학원 영어과]
{이름} 학생 {주차} 테스트 결과입니다.
{점수}
총점 {총점}
{수행률}
{과제}
{재시험}
{클리닉}
감사합니다.`,
  weekAbsent: `[용산대성N학원 영어과]
{이름} 학생은 {주차} 테스트에 응시하지 않았습니다.
확인 부탁드립니다.`,
  mock: `[용산대성N학원 영어과]
{이름} 학생 {시험명} 결과입니다.
{점수}
총점 {총점}
평균 {평균}점
석차 {석차}등 / 응시인원 {응시인원}명
{재시험}
감사합니다.`,
  mockAbsent: `[용산대성N학원 영어과]
{이름} 학생은 {시험명}에 응시하지 않았습니다.
확인 부탁드립니다.`,
  clinicDefault: "",
  clinic: `[용산대성N학원 영어과 - 등원 확인 안내]
안녕하세요, {이름} 학생의 영어 클리닉 등원 관련 안내드립니다.
현재 배정된 클리닉 시간에 학생의 입실이 확인되지 않고 있습니다.
클리닉 일정: {클리닉}`,
};
export type Templates = typeof DEFAULT_TEMPLATES;

export const absentText = (label: string) => `[용산대성N학원 영어과]\n${label} 테스트 미응시 상태입니다.\n테스트 응시 후 제출 바랍니다.`;

// 값이 빈 자리표시자가 들어간 줄은 통째로 지운다('총점 '이나 '클리닉 일정: ' 껍데기가 나가지 않게).
export function fillSmsTemplate(template: string, vars: Record<string, string>) {
  const keys = Object.keys(vars);
  return template
    .split("\n")
    .filter((line) => !keys.some((k) => line.includes(`{${k}}`) && !vars[k]))
    .map((line) => keys.reduce((out, k) => out.split(`{${k}}`).join(vars[k]), line))
    .join("\n");
}

// 한글은 2바이트(EUC-KR)로 센다 — 90바이트를 넘으면 LMS.
export const smsBytes = (text: string) => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);

const fmt = (v: number) => (Number.isFinite(v) ? String(parseFloat(v.toFixed(2))) : "");

// 서버가 같은 키를 두 번 보내지 않는다. 문구가 바뀌면 다른 문자이므로 문구 해시(FNV-1a)를 넣는다.
export function smsKey(source: string, studentId: number, recipient: Recipient, text: string) {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return `${source}:${studentId}:${recipient}:${h.toString(16)}`;
}

export const mockExamName = (e: AdminWeek) =>
  e.label && e.label !== e.exam_date ? e.label : `${e.exam_date || e.label || ""} 모의고사`.trim();

type Scored = Item & { value: number };
const scoredOf = (sc: ScoreRow | undefined, items: Item[], fallback: (i: number) => unknown = () => null) =>
  items
    .map((it, i) => {
      const raw = (sc ? itemVal(sc, it.key) : null) ?? fallback(i);
      return { ...it, value: blank(raw) ? NaN : parseFloat(String(raw)) };
    })
    .filter((x): x is Scored => !isNaN(x.value));
const hasMax = (x: Item) => Number.isFinite(x.max);
const verdict = (x: Scored, pass: Record<string, boolean>) =>
  x.cut === null ? "" : !isBelowCut(x.value, x.cut) ? " (통과)" : pass[x.key] === true ? " (재시험 통과)" : " (재시험)";
const itemsText = (scored: Scored[], pass: Record<string, boolean>) =>
  scored.map((x) => `${x.label || "항목"} ${fmt(x.value)}${hasMax(x) ? "/" + fmt(x.max!) : ""}${verdict(x, pass)}`).join(", ");
const retestText = (scored: Scored[], pass: Record<string, boolean>) => {
  const below = scored.filter((x) => isBelowCut(x.value, x.cut));
  const left = below.filter((x) => pass[x.key] !== true).map((x) => x.label || "항목");
  const passed = below.filter((x) => pass[x.key] === true).map((x) => x.label || "항목");
  return [left.length ? `재시험 대상: ${left.join(", ")}` : "", passed.length ? `재시험 통과: ${passed.join(", ")}` : ""].filter(Boolean).join("\n");
};

export interface ScoreTarget {
  student: RosterStudent;
  absent: boolean;
  notTarget: boolean;
  attendanceFalse: boolean;
  vars: Record<string, string>;
  cutCount: number;
  clinicMemo: string;
}
const byStudent = (rows: ScoreRow[]) => new Map(rows.map((r) => [Number(r.student_id), r]));

export function weekScoreTargets(students: RosterStudent[], rows: ScoreRow[], week: AdminWeek, label: string): ScoreTarget[] {
  const items = activeItems(week);
  const map = byStudent(rows);
  // 학부모 화면과 같은 기준: '과제 없음' 주차면 과제 줄을 보내지 않는다.
  const hwNote = rows.some((r) => r.no_homework === true) ? "" : (week.memo || "").trim();
  return students.map((student) => {
    const sc = map.get(student.id);
    const scored = scoredOf(sc, items);
    const pass = sc?.retest_pass || {};
    return {
      student,
      absent: scored.length === 0,
      notTarget: false,
      attendanceFalse: sc?.attendance === false,
      cutCount: scored.filter((x) => x.cut !== null).length,
      clinicMemo: (sc?.clinic_memo || "").trim(),
      vars: {
        이름: student.name,
        주차: label,
        점수: itemsText(scored, pass),
        총점: `${fmt(scored.reduce((a, x) => a + x.value, 0))}/${fmt(scored.filter(hasMax).reduce((a, x) => a + x.max!, 0))}`,
        수행률: sc && sc.no_homework !== true && !blank(sc.homework_rate) ? `과제 수행률: ${sc.homework_rate}%` : "",
        과제: hwNote,
        재시험: retestText(scored, pass),
      },
    };
  });
}

/** groupRows = 비교 그룹 시험 전체의 점수(그룹이 없으면 이 시험만). null = 못 불러옴. */
export function mockScoreTargets(students: RosterStudent[], rows: ScoreRow[], exam: AdminWeek, groupRows: ScoreRow[] | null) {
  const items = activeItems(exam, true);
  const map = byStudent(rows);
  const totals = (groupRows ?? []).map((r) => mockTotal(r, items));
  const all = stats(null, totals);
  const totalMax = items.filter(hasMax).reduce((a, x) => a + x.max!, 0);
  const legacyKeys = [...new Set([...MOCK_ITEMS.map((i) => i.key), ...items.map((i) => i.key)])];
  const targets = students.map((student): ScoreTarget => {
    const sc = map.get(student.id);
    const has = hasMockScore(sc);
    // 항목 칸 없이 score만 있는 옛 행은 점수 입력 화면처럼 첫 항목 값으로 본다
    const legacy = sc && legacyKeys.every((k) => itemVal(sc, k) == null) ? sc.score : null;
    const scored = has ? scoredOf(sc, items, (i) => (i === 0 ? legacy : null)) : [];
    const pass = sc?.retest_pass || {};
    const cutCount = scored.filter((x) => x.cut !== null).length;
    const total = has && sc ? mockTotal(sc, items) : null;
    const rank = groupRows && total !== null ? stats(total, totals).rank : null;
    return {
      student,
      absent: !has && sc?.absent === true,
      notTarget: !has && sc?.absent !== true,
      attendanceFalse: false,
      cutCount,
      clinicMemo: "",
      vars: {
        이름: student.name,
        시험명: mockExamName(exam),
        // 항목이 하나뿐이고 판정도 없으면 '점수' 줄이 총점과 같아서 뺀다
        점수: scored.length && (items.length > 1 || cutCount > 0) ? itemsText(scored, pass) : "",
        총점: total === null ? "" : `${fmt(total)}/${fmt(totalMax)}`,
        평균: all.average ?? "",
        석차: rank ? String(rank) : "",
        응시인원: all.count ? String(all.count) : "",
        재시험: retestText(scored, pass),
      },
    };
  });
  // 대상 아님은 맨 아래로(이름순 유지)
  return { targets: targets.sort((a, b) => Number(a.notTarget) - Number(b.notTarget)), avg: all.average, sample: all.count };
}

export function composeScore(t: ScoreTarget, mock: boolean, tpl: Templates) {
  if (mock) return fillSmsTemplate(t.absent || t.notTarget ? tpl.mockAbsent : tpl.mock, t.vars);
  if (t.absent) return fillSmsTemplate(tpl.weekAbsent, { 이름: t.vars.이름, 주차: t.vars.주차 });
  return fillSmsTemplate(tpl.week, { ...t.vars, 클리닉: t.clinicMemo ? `클리닉 일정: ${t.clinicMemo}` : tpl.clinicDefault.trim() });
}

// 빈 줄은 조용히 사라지므로 빠지는 이유를 미리 알린다.
export function scoreWarnings(targets: ScoreTarget[], tpl: Templates) {
  const scored = targets.filter((t) => !t.absent);
  const out: string[] = [];
  if (!tpl.week.includes("{재시험}")) out.push("양식에 {재시험}이 없어 재시험 안내가 발송되지 않습니다.");
  if (!tpl.week.includes("{클리닉}")) out.push("양식에 {클리닉}이 없어 클리닉 일정이 발송되지 않습니다.");
  if (tpl.week.includes("{과제}") && scored.length && !scored[0].vars.과제)
    out.push("이 주차는 과제 내용이 비어 있거나 '과제 없음'이라 과제 줄이 빠집니다. (점수 입력 탭 → 이번 주 과제 내용)");
  if (scored.length && scored.every((t) => t.cutCount === 0))
    out.push("이 주차 항목 설정에 커트라인이 없어 통과/재시험 판정이 붙지 않습니다. (점수 입력 탭 → 항목 설정)");
  const noMemo = scored.filter((t) => !t.clinicMemo).length;
  if (noMemo && !tpl.clinicDefault.trim())
    out.push(`${noMemo}명은 클리닉메모가 비어 있어 클리닉 줄이 빠집니다. (점수 입력 탭 '클리닉메모' 칸에 입력하거나 위 기본 문구를 채우세요)`);
  return out;
}

// 주차: 이 주차에 쓰는 항목 중 하나라도 비었으면 미응시. 모의고사: 점수 입력에서 '미응시'로 체크한 학생만.
export function isTestAbsent(sc: ScoreRow | undefined, period: AdminWeek, mock: boolean) {
  if (mock) return sc?.absent === true;
  return !sc || activeItems(period).some((it) => itemVal(sc, it.key) == null);
}

// 클리닉 배정표에 오르는(와야 하는) 학생인지. score-system clinicExpectedOf와 같은 규칙.
export function clinicExpected(sc: ScoreRow | undefined, week: AdminWeek) {
  if (!sc) return false;
  const memo = (sc.clinic_memo || "").trim();
  if (!(sc.clinic_target === true || memo !== "")) return false;
  const items = normalizeItemConfig(week.item_config).filter((it) => it.active);
  const scored = scoredOf(sc, items);
  const pass = sc.retest_pass || {};
  const retestLeft = scored.some((x) => isBelowCut(x.value, x.cut) && pass[x.key] !== true);
  const hwOnly = items.some((it) => it.cut !== null) && scored.length > 0 && !retestLeft;
  const parsed = parseClinicMemo(memo);
  if (hwOnly && !parsed.length) return false;
  if (parsed.length || sc.clinic_target === true) return true;
  return !/통과/.test(memo);
}

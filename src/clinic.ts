import { isBelowCut, itemVal, normalizeItemConfig, type ScoreRow } from "./domain";
import type { AdminClass, AdminWeek } from "./adminApi";
import { resolveBaseDate, sortByTestDate } from "./weekDates";

export const CLINIC_DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
// 재시험지 종류가 반마다 다른 학년은 수요 집계를 반별로 나누고, 같은 시험지를 쓰는 반은 한 표로 합친다.
const TALLY_SPLIT_BY_CLASS: Record<string, boolean> = { 고1: true, 고2: true };
const TALLY_CLASS_GROUP: Record<string, string> = { "고1 토요일": "고1 수요일 상반" };
export const CLINIC_WEEK_WINDOW = 8;
export const UNCERT_VISIBLE = 4;

export type ClinicMin = number | "after_school" | null;
export interface ClinicEntry { day: string; min: ClinicMin; note: string; exact: string | null }

type Tok = { type: "day" | "time" | "change" | "cancel" | "neg"; at: number; end: number; day?: string; h?: number; mm?: number; word?: string };
type Group = { days: string[]; time: Tok | null; at: number; from: Group | null; closed?: boolean; dropped?: boolean; span?: string };

export function parseClinicMemo(memo: string | null | undefined): ClinicEntry[] {
  const entries: ClinicEntry[] = [];
  const dayAlt = "(월|화|수|목|금|토|일)요일|(^|[\\s,().>→])(월|화|수|목|금|토|일)(?=$|[\\s,().0-9])";
  (memo || "").split(/[\n/·.]+/).forEach((raw) => {
    const seg = raw.trim();
    if (!seg) return;
    const toks: Tok[] = [];
    const dayRe = new RegExp(dayAlt, "g");
    let m: RegExpExecArray | null;
    while ((m = dayRe.exec(seg)) !== null) {
      toks.push({ type: "day", day: m[1] || m[3], at: m.index + (m[2] || "").length, end: dayRe.lastIndex });
    }
    if (!toks.length) return;
    const timeRe = /(\d{1,2})\s*:\s*(\d{2})|(\d{1,2})\s*시\s*(?:(반)|(\d{1,2})\s*분)?/g;
    while ((m = timeRe.exec(seg)) !== null) {
      const mm = m[4] ? 30 : parseInt(m[2] || m[5] || "0");
      toks.push({ type: "time", h: parseInt(m[1] || m[3]), mm, at: m.index, end: timeRe.lastIndex });
    }
    const hasTime = toks.some((t) => t.type === "time");
    const markRe = /에서|→|->|=>|⇒|말고|대신|취소/g;
    while ((m = markRe.exec(seg)) !== null) {
      toks.push({ type: m[0] === "취소" ? "cancel" : "change", word: m[0], at: m.index, end: markRe.lastIndex });
    }
    const negRe = /불가능|불가|안\s*(?:돼|되|됨|됩|와|옴|가|감)|못\s*(?:와|옴|오|가|감|함|해)|제외|빼고|어려|힘들|[X✕×❌]/g;
    while ((m = negRe.exec(seg)) !== null) toks.push({ type: "neg", at: m.index, end: negRe.lastIndex });
    toks.sort((a, b) => a.at - b.at);

    const groups: Group[] = [];
    let cur: Group | null = null;
    let from: Group | null = null;
    let prevEnd = 0;
    const open = (at: number) => {
      cur = { days: [], time: null, at, from };
      from = null;
      groups.push(cur);
      return cur;
    };
    toks.forEach((t) => {
      const c = cur as Group | null;
      if (t.type === "day") {
        const g = !c || c.time || c.closed ? open(t.at) : c;
        if (!g.days.includes(t.day!)) g.days.push(t.day!);
      } else if (t.type === "time") {
        const g = !c || c.time || c.closed ? open(t.at) : c;
        g.time = t;
      } else if (c && !c.closed) {
        if (t.type === "cancel") {
          c.dropped = c.closed = true;
        } else if (t.type === "neg") {
          // 일정 바로 뒤에 붙은 부정만 그 일정을 버린다 — "월요일 3시, 서술형 제외"의 '제외'는 일정과 무관
          if (/^\s*(?:은|는|이|가|도|에|엔|에는|에도|은요|는요)?\s*(?:좀|조금)?\s*$/.test(seg.slice(prevEnd, t.at))) c.dropped = c.closed = true;
        } else {
          const glued = /^\s*(?:은|는|이|가)?\s*$/.test(seg.slice(prevEnd, t.at));
          const isChange =
            /→|->|=>|⇒/.test(t.word!) ||
            (glued && (t.word !== "에서" || /(?:요일|시|반|분|\d|[월화수목금토일])\s*(?:으로|로)/.test(seg.slice(t.end))));
          if (isChange) {
            c.dropped = c.closed = true;
            from = c;
          } else if (glued && t.word === "에서" && /^\s*(?:변경|바뀜|바꿈|옮김|이동)/.test(seg.slice(t.end))) c.dropped = c.closed = true;
        }
      }
      if (t.type === "day" || t.type === "time") prevEnd = t.end;
    });
    const heads = groups.filter((g) => g.days.length || g.from);
    groups.forEach((g) => {
      const i = heads.indexOf(g);
      const next = heads.find((h) => h.at > g.at);
      g.span = seg.slice(i > 0 ? g.at : 0, next ? next.at : seg.length);
    });

    const seen = new Set<string>();
    let lastTime: Tok | null = null;
    groups.forEach((g) => {
      if (g.from) {
        if (!g.days.length) g.days = g.from.days.slice();
        if (!g.time) g.time = g.from.time;
      }
      let min: ClinicMin = null;
      let note = "";
      let exact: string | null = null;
      if (!g.time && hasTime && !/하교|학교 ?끝/.test(g.span!)) g.time = lastTime;
      if (g.time) lastTime = g.time;
      if (g.dropped || !g.days.length) return;
      if (g.time) {
        const h = g.time.h!;
        const mm = g.time.mm!;
        const hh = h >= 1 && h <= 8 ? h + 12 : h;
        min = hh * 60 + (mm >= 30 && mm < 60 ? 30 : 0);
        if (mm % 30 && mm < 60) exact = (hh > 12 ? hh - 12 : hh) + ":" + String(mm).padStart(2, "0");
        const q = g.span!.match(/(이후|이전|전까지|까지|일찍|전후)/);
        if (q) note = q[1];
      } else if (/하교|학교 ?끝/.test(hasTime ? g.span! : seg)) {
        min = "after_school";
      } else if (/과제|인증/.test(seg)) {
        return; // 과제 마감 안내 속 요일("과제는 토요일까지 인증")을 클리닉 일정으로 오인하지 않는다
      } else {
        const rest = g.from ? g.span! : seg;
        note = rest
          .replace(new RegExp(dayAlt, "g"), "$2")
          .replace(/^[\s,.·()]+/, "")
          .replace(/^(?:으로|로)\s*/, "")
          .trim();
      }
      g.days.forEach((day) => {
        if (seen.has(day + "|" + min)) return;
        seen.add(day + "|" + min);
        entries.push({ day, min, note, exact });
      });
    });
  });
  return entries;
}

export function clinicHwDeadline(memo: string | null | undefined): string | null {
  const m = (memo || "").trim();
  if (!m || !/과제|인증/.test(m) || !/까지/.test(m)) return null;
  const withDay = m.match(/((?:월|화|수|목|금|토|일)(?:요일)?[^.,\n()]*까지)/);
  if (withDay) return withDay[1].trim();
  const any = m.match(/([^\s.,\n()]+\s*까지)/);
  return any ? any[1].trim() : null;
}

export function clinicColLabel(min: ClinicMin) {
  if (min === "after_school") return "하교 후";
  if (min === null) return "시간 미정";
  const h = Math.floor(min / 60);
  return (h > 12 ? h - 12 : h) + "시" + (min % 60 === 30 ? " 반" : "");
}

export interface ClinicRow extends ScoreRow {
  id?: number;
  student_id: number;
  week_id: number;
  clinic_target?: boolean | null;
  clinic_attend?: boolean | null;
  homework_eval?: string | null;
}
export interface ClinicStudent { id: number; name: string; class_id: number }
// sid = 점수 행을 가리키는 키(week_id:student_id). 출석 표시를 저장할 때 쓴다.
export interface Placed { id: number; sid: string; name: string; hw: number | null; items: string[]; cls: string }
export interface GradeData {
  entries: (ClinicEntry & Placed & { hwOnly: boolean })[];
  unassigned: (Placed & { memo: string })[];
  hwDue: { sid: string; name: string; hw: number | null; due: string }[];
  weekOf: Record<string, string>;
  itemOrder: { abbr: string; label: string }[];
  stale: { name: string; label: string }[];
}
export interface ClinicRef { weekId: number; studentId: number; attend: boolean | null; items: string[] }

const labelOf = (w: AdminWeek) => w.label || w.test_date || "";

// 반마다 최근 8주차만 본다(점수 조회 범위를 줄이려고). 날짜 최신순으로 센다.
export function recentClinicWeeks(weeks: AdminWeek[]) {
  const seen: Record<number, number> = {};
  return sortByTestDate(weeks).filter((w) => (seen[w.class_id!] = (seen[w.class_id!] ?? 0) + 1) <= CLINIC_WEEK_WINDOW);
}

export function buildClinicSchedule(classes: AdminClass[], recentWeeks: AdminWeek[], students: ClinicStudent[], rows: ClinicRow[]) {
  const weekById = new Map(recentWeeks.map((w) => [w.id, w]));
  const recency = new Map(recentWeeks.map((w, i) => [w.id, i]));
  const hasClinic = (sc: ClinicRow) => sc.clinic_target === true || (sc.clinic_memo || "").trim() !== "";
  // 반마다 클리닉 흔적(메모 또는 대상 체크)이 있는 가장 최근 주차
  const latest = new Map<number, AdminWeek>();
  rows.forEach((sc) => {
    const w = weekById.get(sc.week_id);
    if (!hasClinic(sc) || !w) return;
    const cur = latest.get(w.class_id!);
    if (!cur || recency.get(w.id)! < recency.get(cur.id)!) latest.set(w.class_id!, w);
  });
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  const gradeOf = (c?: AdminClass) => c?.grade || "학년 미지정";

  // 학년의 최신 주차보다 5일 넘게 뒤처진 반은 옛 배정이라 빼고 사유를 적는다.
  const timeOf = (w: AdminWeek) => resolveBaseDate(w.test_date || w.label || "")?.getTime() ?? null;
  const gradeMax: Record<string, number> = {};
  latest.forEach((w, cid) => {
    const c = classMap.get(cid);
    const t = timeOf(w);
    if (!c || t === null) return;
    const g = gradeOf(c);
    if (!(g in gradeMax) || t > gradeMax[g]) gradeMax[g] = t;
  });
  const staleIds = new Set<number>();
  const staleByGrade: Record<string, { name: string; label: string }[]> = {};
  latest.forEach((w, cid) => {
    const c = classMap.get(cid);
    const t = timeOf(w);
    if (!c || t === null) return;
    const g = gradeOf(c);
    if (gradeMax[g] !== undefined && gradeMax[g] - t > 5 * 86400000) {
      staleIds.add(c.id);
      (staleByGrade[g] ??= []).push({ name: c.name, label: labelOf(w) });
    }
  });

  const data: Record<string, GradeData> = {};
  const refs: Record<string, ClinicRef> = {};
  const blankGrade = (): GradeData => ({ entries: [], unassigned: [], hwDue: [], weekOf: {}, itemOrder: [], stale: [] });
  rows.forEach((sc) => {
    const w = weekById.get(sc.week_id);
    if (!hasClinic(sc) || !w || staleIds.has(w.class_id!) || latest.get(w.class_id!)?.id !== sc.week_id) return;
    const st = studentMap.get(sc.student_id);
    if (!st) return; // 퇴원 처리된 학생의 잔여 점수 행
    const cls = classMap.get(st.class_id);
    const g = (data[gradeOf(cls)] ??= blankGrade());
    const clsName = cls?.name ?? "";
    const lw = cls && latest.get(cls.id);
    if (lw) g.weekOf[clsName] = labelOf(lw);
    const memo = (sc.clinic_memo || "").trim();
    const sid = `${sc.week_id}:${sc.student_id}`;
    const cfgItems = normalizeItemConfig(w.item_config).filter((it) => it.active);
    refs[sid] = { weekId: sc.week_id, studentId: sc.student_id, attend: sc.clinic_attend ?? null, items: cfgItems.map((i) => i.key) };
    const hw = sc.homework_rate ?? null;
    const scored = cfgItems
      .map((it) => {
        const raw = itemVal(sc, it.key);
        return { ...it, value: raw === null || raw === undefined || raw === "" ? null : parseFloat(String(raw)) };
      })
      .filter((x) => x.value !== null && !isNaN(x.value));
    const hasCut = cfgItems.some((it) => it.cut !== null && it.cut !== undefined);
    const pass = sc.retest_pass || {};
    const abbrOf: Record<string, string> = {};
    cfgItems.forEach((it) => {
      const label = (it.label || "항목").trim();
      let ab = label.slice(0, 1);
      if (Object.values(abbrOf).includes(ab)) ab = label.slice(0, 2);
      abbrOf[it.key] = ab;
      if (!g.itemOrder.some((o) => o.abbr === ab)) g.itemOrder.push({ abbr: ab, label });
    });
    const items = scored.filter((x) => isBelowCut(x.value, x.cut) && pass[x.key] !== true).map((x) => abbrOf[x.key]);
    const hwOnly = hasCut && scored.length > 0 && items.length === 0;
    const parsed = parseClinicMemo(memo);
    const base = { id: st.id, sid, name: st.name, hw, items, cls: clsName };
    if (hwOnly) {
      const due = clinicHwDeadline(memo);
      if (due) g.hwDue.push({ sid, name: st.name, hw, due });
      if (!parsed.length) return;
    }
    if (parsed.length) parsed.forEach((e) => g.entries.push({ ...e, ...base, hwOnly }));
    else if (sc.clinic_target === true || !/통과/.test(memo)) g.unassigned.push({ ...base, memo });
    else {
      const due = clinicHwDeadline(memo);
      if (due) g.hwDue.push({ sid, name: st.name, hw, due });
    }
  });
  Object.entries(staleByGrade).forEach(([g, list]) => ((data[g] ??= blankGrade()).stale = list));
  return { grades: Object.keys(data).sort(), data, refs };
}

export function clinicColumns(entries: ClinicEntry[]) {
  const keys: ClinicMin[] = [...new Set(entries.filter((e) => e.min !== null).map((e) => e.min))].sort((a, b) => {
    const rank = (v: ClinicMin) => (v === "after_school" ? 1e8 : (v as number));
    return rank(a) - rank(b);
  });
  if (entries.some((e) => e.min === null)) keys.push(null);
  return { keys, days: CLINIC_DAY_ORDER.filter((d) => entries.some((e) => e.day === d)) };
}

// 재시험지 수요: 요일 × 항목. 학생 한 명은 먼저 적힌 요일에만 센다(student_id 기준). 요일 없는 학생은 '요일 미정'.
export function clinicTally(entries: GradeData["entries"], unassigned: GradeData["unassigned"], itemOrder: GradeData["itemOrder"]) {
  const counted = new Set<number>();
  const tally: Record<string, Record<string, number>> = {};
  const bump = (day: string, items: string[]) =>
    items.forEach((ab) => {
      tally[day] ??= {};
      tally[day][ab] = (tally[day][ab] ?? 0) + 1;
    });
  entries.forEach((e) => {
    if (counted.has(e.id)) return;
    counted.add(e.id);
    bump(e.day, e.items);
  });
  unassigned.forEach((u) => bump("요일 미정", u.items));
  const rows = [...CLINIC_DAY_ORDER.filter((d) => tally[d]), ...(tally["요일 미정"] ? ["요일 미정"] : [])];
  const colSum = (ab: string) => rows.reduce((n, d) => n + (tally[d][ab] ?? 0), 0);
  const cols = itemOrder.filter((o) => colSum(o.abbr) > 0);
  if (!rows.length || !cols.length) return null;
  return { rows, cols, cell: (d: string, ab: string) => tally[d][ab] ?? 0, colSum, rowSum: (d: string) => cols.reduce((n, o) => n + (tally[d][o.abbr] ?? 0), 0) };
}

export function clinicTallies(grade: string, g: GradeData) {
  if (!g.itemOrder.length) return [];
  if (!TALLY_SPLIT_BY_CLASS[grade]) return [{ title: "", t: clinicTally(g.entries, g.unassigned, g.itemOrder) }].filter((x) => x.t);
  const groupOf = (cn: string) => TALLY_CLASS_GROUP[cn] || cn;
  const names = [...new Set([...g.entries, ...g.unassigned].map((x) => x.cls || ""))].sort();
  return [...new Set(names.map(groupOf))]
    .map((grp) => {
      const members = names.filter((cn) => groupOf(cn) === grp);
      const extra = members.filter((m) => m !== grp);
      return {
        title: (grp || "반 미지정") + (extra.length ? ` (+ ${extra.join(", ")})` : ""),
        t: clinicTally(
          g.entries.filter((e) => members.includes(e.cls || "")),
          g.unassigned.filter((u) => members.includes(u.cls || "")),
          g.itemOrder,
        ),
      };
    })
    .filter((x) => x.t);
}

// 미인증: 보이는 주차 중 하나라도 과제평가가 있거나 수행률이 비었거나 79% 이하인 학생(점수 행이 있는 주차만).
export function isUncert(rowsOfStudent: (ClinicRow | undefined)[]) {
  return rowsOfStudent.some(
    (sc) => !!sc && ((sc.homework_eval ?? "").trim() !== "" || sc.homework_rate === null || sc.homework_rate === undefined || sc.homework_rate <= 79),
  );
}

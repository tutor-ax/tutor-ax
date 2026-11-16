import { normalizeItemConfig, type ItemConfig } from "./domain";
import { payloadValue, scoreEq } from "./scoreSheet";

// score-system admin.html 변경 이력 · 되돌리기(historyDiff·restoreHistoryEntry·restoreHistoryUpTo)를 옮긴 것.
export type Row = Record<string, unknown>;
export interface HistoryEntry {
  id: number;
  row_id: number;
  op: "UPDATE" | "DELETE";
  old_row: Row | null;
  new_row: Row | null;
  changed_at: string;
}
export interface Change { key: string; label: string; before: unknown; after: unknown }
/** 점수 저장(PUT /roster/scores) 한 번: before = 지금 DB 값, after = 되돌릴 값. */
export interface Revert { student_id: number; no_homework: boolean; before: Row; after: Row; labels: string[] }

const HISTORY_FIELDS: Record<string, string> = {
  homework_rate: "과제%", homework_eval: "과제평가", clinic_memo: "클리닉메모", hw_cert: "잔여인증",
  attendance: "출석", no_homework: "과제없음", retest_pass: "재시험통과",
  word_score: "항목1", reading_score: "항목2", mc_score: "항목3", item4_score: "항목4", item_scores: "추가항목",
};
const COLUMN_ITEMS = ["word_score", "reading_score", "mc_score", "item4_score"];
const SCALARS = ["homework_rate", "homework_eval", "clinic_memo", "hw_cert", "attendance", "no_homework"];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

// 항목1~4는 그 주차의 항목 설정 이름으로 보여 준다.
export function historyLabels(itemConfig?: ItemConfig | null) {
  const labels = { ...HISTORY_FIELDS };
  normalizeItemConfig(itemConfig).forEach((it) => {
    if (it.label && it.key in labels) labels[it.key] = it.label;
  });
  return labels;
}

export function historyDiff(e: HistoryEntry, labels: Record<string, string>): Change[] {
  const out: Change[] = [];
  for (const k of Object.keys(labels)) {
    const b = e.old_row?.[k];
    const a = e.new_row?.[k];
    if (e.op === "DELETE") {
      if (b !== null && b !== undefined && b !== "" && b !== false) out.push({ key: k, label: labels[k], before: b, after: undefined });
    } else if (!same(b, a)) out.push({ key: k, label: labels[k], before: b, after: a });
  }
  return out;
}

export function fmtHistVal(v: unknown) {
  if (v === null || v === undefined || v === "") return "(비어 있음)";
  if (v === true) return "예";
  if (v === false) return "아니요";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function fmtHistTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// target(이력의 이전 값)으로 되돌리는 점수 저장 칸. cur가 없으면(삭제된 줄) 서버가 새로 만드는 줄의 값과 비교한다.
// keys: 이력 칸 이름(word_score·item_scores·retest_pass…) 중 되돌릴 것. 바꿀 칸이 없으면 null.
export function revertFor(target: Row, cur: Row | undefined, keys: string[], labels: Record<string, string>, studentId: number): Revert | null {
  const now: Row = cur ?? { attendance: true, no_homework: target.no_homework, homework_eval: "", clinic_memo: "" };
  const before: Row = {};
  const after: Row = {};
  const changed = new Set<string>();
  const put = (field: string, b: unknown, a: unknown, key: string) => {
    before[field] = b ?? null;
    after[field] = a;
    changed.add(labels[key] ?? key);
  };
  for (const k of keys) {
    if (COLUMN_ITEMS.includes(k)) {
      if (!scoreEq(now[k], target[k])) put(`score:${k}`, now[k], payloadValue("score:", target[k]), k);
    } else if (k === "item_scores") {
      const t = obj(target[k]);
      const n = obj(now[k]);
      for (const ik of new Set([...Object.keys(t), ...Object.keys(n)])) {
        if (!scoreEq(n[ik], t[ik])) put(`score:${ik}`, n[ik], payloadValue("score:", t[ik]), k);
      }
    } else if (k === "retest_pass") {
      const t = obj(target[k]);
      const n = obj(now[k]);
      for (const ik of new Set([...Object.keys(t), ...Object.keys(n)])) {
        if ((n[ik] === true) !== (t[ik] === true)) put(`retest:${ik}`, n[ik] === true, t[ik] === true, k);
      }
    } else if (SCALARS.includes(k) && !scoreEq(now[k], target[k])) {
      const v = target[k];
      // 서버는 출석을 true/false로만 받는다. 옛 줄의 null은 기본값(출석)이었다.
      put(k, now[k], k === "attendance" ? v !== false : k === "homework_rate" ? payloadValue(k, v) : v, k);
    }
  }
  return changed.size ? { student_id: studentId, no_homework: target.no_homework === true, before, after, labels: [...changed] } : null;
}

// 기준 시각(anchor) 직전 상태로 이 주차의 모든 학생을. 각 줄마다 anchor 이후 첫 변경의 old_row가 그 시점의 값이다.
export function planUpTo(entries: HistoryEntry[], anchor: HistoryEntry, current: Row[], labels: Record<string, string>): Revert[] {
  const asc = entries
    .slice()
    .sort((a, b) => (a.changed_at < b.changed_at ? -1 : a.changed_at > b.changed_at ? 1 : a.id - b.id));
  const first = new Map<number, HistoryEntry>();
  for (const e of asc) if (e.changed_at >= anchor.changed_at && !first.has(e.row_id)) first.set(e.row_id, e);
  const plan: Revert[] = [];
  for (const e of first.values()) {
    const sid = Number(e.old_row?.student_id);
    if (!e.old_row || !sid) continue;
    const cur = current.find((r) => Number(r.student_id) === sid);
    // 삭제된 줄인데 그 학생 줄이 다시 생겼으면 그대로 둔다(score-system과 같음).
    if (e.op === "DELETE" && cur) continue;
    const r = revertFor(e.old_row, cur, Object.keys(labels), labels, sid);
    if (r) plan.push(r);
  }
  return plan;
}

import { isBelowCut, itemVal, type Item, type ScoreRow } from "./domain";

// score-system admin.html 점수 입력 탭의 규칙(scoreValEq·scoreFieldsOf·fetchCarriedEvals·scoreDiff)을 옮긴 것.
export type Fields = Record<string, unknown>;
export interface SheetRow extends ScoreRow {
  student_id: number | string;
  week_id: number;
  homework_eval?: string | null;
}

export const SCALAR_LABELS: Record<string, string> = { attendance: "출석", homework_rate: "과제%", homework_eval: "과제평가", clinic_memo: "클리닉메모" };

export const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const numeric = (v: unknown) => typeof v === "number" || /^\s*-?\d+(\.\d+)?\s*$/.test(String(v));

export function scoreEq(a: unknown, b: unknown) {
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (numeric(a) && numeric(b)) return parseFloat(String(a)) === parseFloat(String(b));
  return String(a).trim() === String(b).trim();
}

// 줄이 없으면 서버가 만드는 새 줄과 같은 값(출석, 나머지 빈칸).
export function fieldsOf(row: SheetRow | undefined, items: Item[]): Fields {
  const f: Fields = {
    attendance: row ? row.attendance !== false : true,
    homework_rate: row?.homework_rate ?? null,
    homework_eval: row?.homework_eval ?? null,
    clinic_memo: row?.clinic_memo ?? null,
  };
  for (const it of items) {
    const v = itemVal(row, it.key);
    f[`score:${it.key}`] = blank(v) ? null : parseFloat(String(v));
    // 재시험 통과는 커트 미달 칸에만 보이므로, 커트를 넘긴 칸의 옛 표시는 없는 것으로 본다.
    f[`retest:${it.key}`] = row?.retest_pass?.[it.key] === true && isBelowCut(f[`score:${it.key}`] as number, it.cut);
  }
  return f;
}

const hasScores = (row: SheetRow | undefined) =>
  !!row &&
  (["word_score", "reading_score", "mc_score", "item4_score"].some((k) => !blank(row[k])) ||
    Object.values(row.item_scores ?? {}).some((v) => !blank(v)));

// 이번 주차에 점수도 과제 값도 없으면 가장 가까운 이전 주차의 과제평가·과제%를 미리 채운다(저장하면 이번 주차에 기록).
// prevRows는 이번 주차에 가까운 주차 순서로 정렬해 넘긴다.
export function withCarry(base: Fields, row: SheetRow | undefined, prevRows: SheetRow[], studentId: number): Fields {
  if (hasScores(row)) return { ...base };
  const mine = prevRows.filter((r) => Number(r.student_id) === studentId);
  const screen = { ...base };
  if (blank(row?.homework_eval)) {
    const e = mine.find((r) => !blank(r.homework_eval));
    if (e) screen.homework_eval = String(e.homework_eval).trim();
  }
  if (row?.homework_rate == null) {
    const r = mine.find((x) => x.homework_rate != null);
    if (r) screen.homework_rate = r.homework_rate;
  }
  return screen;
}

export function changedFields(base: Fields, screen: Fields) {
  return Object.keys(screen).filter((k) => (k.startsWith("retest:") ? !!base[k] !== !!screen[k] : !scoreEq(base[k], screen[k])));
}

// 입력칸 문자열을 서버가 받는 값으로: 숫자 칸은 숫자 또는 null.
export function payloadValue(field: string, v: unknown) {
  if (field.startsWith("score:") || field === "homework_rate") return blank(v) ? null : Number(v);
  if (field.startsWith("retest:")) return !!v;
  return v;
}

export function overMax(screen: Fields, items: Item[]) {
  return items.filter((it) => it.max != null && !blank(screen[`score:${it.key}`]) && Number(screen[`score:${it.key}`]) > it.max);
}

export function total(screen: Fields, items: Item[]) {
  const vals = items.map((it) => screen[`score:${it.key}`]).filter((v) => !blank(v));
  return vals.length ? vals.reduce<number>((a, v) => a + Number(v), 0) : null;
}

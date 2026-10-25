export interface Period {
  id: number;
  label?: string;
  test_date?: string;
  exam_date?: string;
  group_id?: string | null;
  item_config?: ItemConfig | null;
}
export function activeItems(period?: Period, mock = false) {
  return normalizeItemConfig(
    period?.item_config,
    mock ? MOCK_ITEMS : DEFAULT_ITEMS,
  ).filter((i) => i.active);
}
export function isBelowCut(value: Value | undefined, cut: Value | undefined) {
  return (
    value != null &&
    value !== "" &&
    cut != null &&
    cut !== "" &&
    parseFloat(String(value)) < parseFloat(String(cut))
  );
}
export function mockTotal(row: ScoreRow, items: Item[]): number | null {
  const vals = items.map((i) => itemVal(row, i.key)).filter((v) => v != null);
  return vals.length
    ? vals.reduce<number>((a, v) => a + parseFloat(String(v)), 0)
    : row.score == null
      ? null
      : parseFloat(String(row.score));
}
export function hasMockScore(row?: ScoreRow) {
  return (
    !!row &&
    (row.score != null ||
      [
        ...MOCK_ITEMS.map((i) => i.key),
        ...Object.keys(row.item_scores ?? {}),
      ].some((k) => itemVal(row, k) != null))
  );
}
export function stats(my: number | null, values: (number | null)[]) {
  const valid = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);
  const position = my === null ? -1 : valid.findIndex((v) => v === my);
  return {
    average: valid.length
      ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1)
      : null,
    rank: position < 0 ? null : position + 1,
    count: valid.length,
  };
}
export function weeklyStats(mine: ScoreRow, peers: ScoreRow[], items: Item[]) {
  const itemBased = [mine, ...peers].every((r) =>
    items.every((i) => itemVal(r, i.key) !== undefined),
  );
  const basis = (r: ScoreRow) =>
    itemBased ? computeTotal(r, items) : (r.total_score ?? null);
  return stats(basis(mine), peers.map(basis));
}
export function summary(weeks: Period[], rows: ScoreRow[]) {
  const values = rows
    .map((r) =>
      computeTotal(r, activeItems(weeks.find((w) => w.id === r.week_id))),
    )
    .filter((v): v is number => v !== null);
  return {
    average: values.length
      ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
      : null,
    best: values.length ? Math.max(...values) : null,
  };
}
export function trend(weeks: Period[], rows: ScoreRow[]) {
  return {
    labels: weeks.map((w) => w.label || w.test_date || ""),
    values: weeks.map((w) =>
      computeTotal(
        rows.find((r) => r.week_id === w.id),
        activeItems(w),
      ),
    ),
    max: Math.max(
      100,
      ...weeks.map((w) => activeItems(w).reduce((a, i) => a + (i.max || 0), 0)),
    ),
  };
}
export function sortByDateDesc<T>(list: T[], dateOf: (item: T) => string): T[] {
  const parsed = list.map((x) =>
    dateOf(x).match(/^\s*(\d{1,2})\s*\.\s*(\d{1,2})/),
  );
  const wraps =
    parsed.some((x) => x && +x[1] >= 11) && parsed.some((x) => x && +x[1] <= 2);
  return list
    .map((item, i) => ({
      item,
      i,
      key: parsed[i]
        ? +parsed[i]![1] * 100 +
          +parsed[i]![2] +
          (wraps && +parsed[i]![1] <= 2 ? 1200 : 0)
        : -Infinity,
    }))
    .sort((a, b) => b.key - a.key || b.i - a.i)
    .map((x) => x.item);
}
export type Value = number | string | null;
export interface Item {
  key: string;
  label: string;
  max: number | null;
  cut: number | null;
  active: boolean;
}
export interface RawItem {
  key: string;
  label?: string;
  max?: Value;
  cut?: Value;
  active?: boolean;
}
export interface ItemConfig {
  items?: RawItem[];
}
export interface ScoreRow {
  [key: string]: unknown;
  week_id?: number;
  exam_id?: number;
  total_score?: number | null;
  score?: Value;
  item_scores?: Record<string, Value> | null;
  retest_pass?: Record<string, boolean>;
  attendance?: boolean;
  absent?: boolean;
  no_homework?: boolean;
  homework_rate?: number | null;
  clinic_memo?: string | null;
  memo?: string | null;
}
export const DEFAULT_ITEMS: Item[] = [
  { key: "word_score", label: "단어", max: 25, cut: null, active: true },
  { key: "reading_score", label: "해석", max: 30, cut: null, active: true },
  { key: "mc_score", label: "객관식", max: 45, cut: null, active: true },
  { key: "item4_score", label: "", max: 20, cut: null, active: false },
];
export const MOCK_ITEMS: Item[] = [1, 2, 3, 4].map((n) => ({
  key: `item${n}_score`,
  label: n === 1 ? "점수" : "",
  max: n === 1 ? 100 : null,
  cut: null,
  active: n === 1,
}));
const legacyKeys = new Set([...DEFAULT_ITEMS, ...MOCK_ITEMS].map((i) => i.key));
export function normalizeItemConfig(
  raw?: ItemConfig | null,
  defaults = DEFAULT_ITEMS,
): Item[] {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const norm = (s: RawItem, d?: Item): Item => ({
    key: d?.key ?? s.key,
    label: String(s.label ?? d?.label ?? ""),
    max:
      s.max == null || s.max === ""
        ? (d?.max ?? null)
        : parseFloat(String(s.max)),
    cut: s.cut == null || s.cut === "" ? null : parseFloat(String(s.cut)),
    active: s.active === undefined ? (d?.active ?? true) : !!s.active,
  });
  const out = defaults.map((d) =>
    norm(items.find((i) => i?.key === d.key) ?? d, d),
  );
  const seen = new Set(out.map((i) => i.key));
  items.forEach((i) => {
    if (i && typeof i.key === "string" && i.key && !seen.has(i.key)) {
      seen.add(i.key);
      out.push(norm(i));
    }
  });
  return out;
}
export function itemVal(
  row: ScoreRow | undefined,
  key: string,
): Value | undefined {
  if (!row) return undefined;
  if (row.item_scores?.[key] !== undefined) return row.item_scores[key];
  if (row[key] !== undefined) return row[key] as Value;
  return row.item_scores === undefined || legacyKeys.has(key)
    ? undefined
    : null;
}
export function computeTotal(
  row: ScoreRow | undefined,
  items: Item[],
): number | null {
  if (!row) return null;
  const vals = items.map((i) => itemVal(row, i.key));
  if (vals.some((v) => v === undefined)) return row.total_score ?? null;
  const entered = vals.filter((v) => v !== null);
  return entered.length
    ? entered.reduce<number>((a, v) => a + parseFloat(String(v)), 0)
    : null;
}

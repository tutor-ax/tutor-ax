import type { AdminWeek } from "./adminApi";
import { DEFAULT_ITEMS, itemVal, normalizeItemConfig, type Item, type ScoreRow } from "./domain";

export const weekLabel = (w: AdminWeek) => w.label || w.test_date || "";

// 한 번 만든 key는 바꾸지 않는다(item_scores·retest_pass의 키). 5번 이상에서 비어 있는 가장 작은 수.
export function nextItemKey(cfg: { key: string }[]) {
  const used = new Set(cfg.map((i) => i.key));
  let n = 5;
  while (used.has(`item${n}_score`)) n++;
  return `item${n}_score`;
}

const sig = (items: Item[]) =>
  items
    .filter((i) => i.active)
    .map((i) => `${i.key}:${i.max}`)
    .join("|");

const itemSum = (r: ScoreRow, items: Item[]) => {
  const vals = items.map((i) => itemVal(r, i.key)).filter((v) => v != null && v !== "");
  return vals.length ? vals.reduce<number>((a, v) => a + parseFloat(String(v)), 0) : null;
};

// 학부모 화면과 같은 기준: 그룹 주차 전체의 점수를 이번 주차 항목 설정으로 합산한다. 모의고사는 기본 항목과 합계(mockTotal)만 다르다.
export function groupStats(
  groupWeeks: AdminWeek[],
  rows: ScoreRow[],
  cfg: Item[],
  nameOf: (w: AdminWeek) => string,
  defaults = DEFAULT_ITEMS,
  totalOf = itemSum,
) {
  const items = cfg.filter((i) => i.active);
  const totals = rows.map((r) => totalOf(r, items)).filter((v): v is number => v !== null);
  const mine = sig(cfg);
  const keys = items.map((i) => i.key);
  const cuts = groupWeeks.map((w) => {
    const cut = Object.fromEntries(normalizeItemConfig(w.item_config, defaults).map((i) => [i.key, i.cut]));
    return { name: nameOf(w), sig: keys.map((k) => cut[k] ?? "–").join("/"), text: items.map((i) => `${i.label || i.key} ${cut[i.key] ?? "–"}`).join(", ") };
  });
  return {
    avg: totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : null,
    count: totals.length,
    totalMax: items.reduce((a, i) => a + (i.max ?? 0), 0),
    mismatched: groupWeeks.filter((w) => sig(normalizeItemConfig(w.item_config, defaults)) !== mine).map(nameOf),
    // 반마다 커트가 다를 때만 반별로 보여준다.
    cutLines: groupWeeks.length > 1 && new Set(cuts.map((c) => c.sig)).size > 1 ? cuts.map((c) => `${c.name} ${c.text}`) : [],
  };
}

// 기본 선택: 이미 같은 그룹인 주차, 없으면 같은 날짜(라벨), 없으면 최신. 편집 중인 반은 항상 포함.
export function groupPicks(byClass: Map<number, AdminWeek[]>, current: AdminWeek, classId: number) {
  const gid = current.group_id;
  const picks: Record<number, { on: boolean; weekId: number }> = {};
  for (const [cid, ofClass] of byClass) {
    if (!ofClass.length) continue;
    const inGroup = gid ? ofClass.find((w) => w.group_id === gid) : undefined;
    const pick = cid === classId ? current : (inGroup ?? ofClass.find((w) => weekLabel(w) === weekLabel(current)) ?? ofClass[0]);
    picks[cid] = { on: cid === classId || !!inGroup, weekId: pick.id };
  }
  return picks;
}

// 다른 그룹에 속한 주차를 데려오면 그 그룹에서 빠진다(경고 대상).
export function movedFrom(all: AdminWeek[], pickedIds: number[], gid: string | null | undefined) {
  return pickedIds.flatMap((id) => {
    const w = all.find((x) => x.id === id);
    if (!w?.group_id || w.group_id === gid) return [];
    const others = all.filter((x) => x.group_id === w.group_id && x.id !== w.id).length;
    return others ? [{ week: w, size: others + 1 }] : [];
  });
}

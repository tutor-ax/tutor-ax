import { describe, it, expect } from "vitest";
import {
  stats,
  normalizeItemConfig,
  computeTotal,
  itemVal,
  weeklyStats,
  mockTotal,
  hasMockScore,
  sortByDateDesc,
  summary,
  trend,
  isBelowCut,
  MOCK_ITEMS,
} from "../src/domain";
it("does not claim rank zero when the comparison population lacks the student", () => {
  expect(stats(80, [])).toEqual({ average: null, rank: null, count: 0 });
  expect(stats(80, [90])).toEqual({ average: "90.0", rank: null, count: 1 });
  expect(stats(80, [90, 80, 80, 0])).toEqual({
    average: "62.5",
    rank: 2,
    count: 4,
  });
});
it("uses shared group basis, raw cumulative points, and input-order chart gaps", () => {
  const items = normalizeItemConfig({
    items: [{ key: "extra", max: 30 }],
  }).filter((i) => i.active);
  const mine = {
    week_id: 1,
    word_score: 0,
    reading_score: 20,
    mc_score: 30,
    item_scores: { extra: 10 },
    total_score: 50,
  };
  expect(
    weeklyStats(mine, [mine, { week_id: 2, total_score: 70 }], items),
  ).toEqual({ average: "60.0", rank: 2, count: 2 });
  const weeks = [
    { id: 1, item_config: { items: [{ key: "extra", max: 30 }] } },
    { id: 2 },
  ];
  expect(summary(weeks, [mine])).toEqual({ average: "60.0", best: 60 });
  expect(trend(weeks, [mine])).toEqual({
    labels: ["", ""],
    values: [60, null],
    max: 130,
  });
  expect(isBelowCut(0, 10)).toBe(true);
  expect(isBelowCut(null, 10)).toBe(false);
});
it("supports dynamic configs, legacy mock scores, zero and date rollover", () => {
  const items = normalizeItemConfig({
    items: [
      { key: "extra", label: "<b>safe</b>", max: "10" },
      { key: "extra", max: 99 },
    ],
  });
  expect(items.filter((i) => i.key === "extra")).toHaveLength(1);
  expect(
    mockTotal(
      { score: 88 },
      MOCK_ITEMS.filter((i) => i.active),
    ),
  ).toBe(88);
  expect(
    mockTotal(
      { score: 88, item1_score: 0 },
      MOCK_ITEMS.filter((i) => i.active),
    ),
  ).toBe(0);
  expect(hasMockScore({ score: 0 })).toBe(true);
  expect(hasMockScore({ score: null, absent: true })).toBe(false);
  expect(sortByDateDesc(["12.30", "1.5", "invalid"], (x) => x)).toEqual([
    "1.5",
    "12.30",
    "invalid",
  ]);
});
describe("legacy weekly calculation", () => {
  it("distinguishes missing columns, null and zero; json bag wins", () => {
    const items = normalizeItemConfig(null).filter((i) => i.active);
    expect(
      computeTotal(
        { word_score: 0, reading_score: null, mc_score: null },
        items,
      ),
    ).toBe(0);
    expect(
      computeTotal(
        { word_score: null, reading_score: null, mc_score: null },
        items,
      ),
    ).toBeNull();
    expect(computeTotal({ word_score: 10, total_score: 73 }, items)).toBe(73);
    expect(
      itemVal({ word_score: 10, item_scores: { word_score: 0 } }, "word_score"),
    ).toBe(0);
    expect(itemVal({ item_scores: {} }, "word_score")).toBeUndefined();
    expect(itemVal({ item_scores: {} }, "extra")).toBeNull();
  });
});

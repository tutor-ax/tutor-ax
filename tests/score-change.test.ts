import { describe, expect, it } from "vitest";
import { scoreChange } from "../src/scoreChange";
describe("honest score comparisons", () => {
  const current = { total: 82, max: 100, absent: false };
  it("compares only like-for-like recorded totals", () => {
    expect(scoreChange(current, { ...current, total: 75 })).toBe("+7점");
    expect(scoreChange(current, { ...current, total: 90 })).toBe("−8점");
    expect(scoreChange(current, current)).toBe("변동 없음");
  });
  it("never calls absent, missing or changed-scale data an improvement", () => {
    expect(scoreChange(current)).toBe("첫 기록");
    expect(scoreChange(current, { ...current, max: 130 })).toBe("만점 다름");
    expect(scoreChange(current, { ...current, absent: true })).toBe(
      "결석 포함",
    );
    expect(scoreChange({ ...current, total: null }, current)).toBe(
      "점수 미기재",
    );
  });
});

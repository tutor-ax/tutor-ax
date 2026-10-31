type RecordedTotal = { total: number | null; max: number; absent: boolean };
/** Raw point changes are meaningful only for recorded, attended, equal-scale tests. */
export function scoreChange(
  current: RecordedTotal,
  previous?: RecordedTotal,
): string {
  if (current.total === null || (previous && previous.total === null))
    return "점수 미기재";
  if (!previous) return "첫 기록";
  if (current.absent || previous.absent) return "결석 포함";
  if (current.max !== previous.max) return "만점 다름";
  const difference = Number((current.total - previous.total!).toFixed(2));
  if (difference === 0) return "변동 없음";
  return `${difference > 0 ? "+" : "−"}${Math.abs(difference)}점`;
}

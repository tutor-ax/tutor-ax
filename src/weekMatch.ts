import type { AdminWeek, RosterClass } from "./adminApi";
import { dateForDay, fmtMD, resolveBaseDate, sortByTestDate } from "./weekDates";
import { weekLabel } from "./weekGroup";

// score-system admin.html weekStartKey·guestMatchWeek·renderMoveMatch·moveNewWeekLabel을 옮긴 것.
export function weekStartKey(label: string) {
  const d = resolveBaseDate(label);
  if (!d) return null;
  const cur = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (cur - 1));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 원래 반에서 '같은 주' 주차: ①같은 비교 그룹 ②같은 주(월~일)
export function guestMatchWeek(host: AdminWeek, weeks: AdminWeek[]) {
  if (host.group_id) {
    const g = weeks.find((w) => w.group_id === host.group_id);
    if (g) return { week: g, how: "같은 비교 그룹" };
  }
  const key = weekStartKey(host.test_date || host.label || "");
  if (key) {
    const same = sortByTestDate(weeks.filter((w) => weekStartKey(w.test_date || w.label || "") === key));
    if (same.length) return { week: same[0], how: "같은 주" };
  }
  return null;
}

// 새로 만들 주차의 날짜: 원래 주차가 속한 주에서 이동할 반의 수업 요일. 요일이나 날짜를 못 읽으면 원래 이름.
export function newWeekLabel(fw: AdminWeek, toClass: RosterClass | undefined) {
  const base = resolveBaseDate(fw.test_date || fw.label || "");
  const d = base && toClass ? dateForDay(base, toClass.day) : null;
  return d ? fmtMD(d) : weekLabel(fw);
}

// 오래된 주차부터 ①같은 비교 그룹 ②같은 날짜 ③같은 주 순서로 짝짓는다. 한 주차는 한 번만 쓴다.
export function matchMoveWeeks(fromWeeks: AdminWeek[], toWeeks: AdminWeek[]) {
  const to = [...toWeeks].reverse();
  const used = new Set<number>();
  return [...fromWeeks].reverse().map((fw) => {
    const free = to.filter((w) => !used.has(w.id));
    const key = weekStartKey(weekLabel(fw));
    let tw: AdminWeek | undefined;
    let how = "";
    if (fw.group_id && (tw = free.find((w) => w.group_id === fw.group_id))) how = "비교 그룹 일치";
    else if ((tw = free.find((w) => weekLabel(w) === weekLabel(fw)))) how = "같은 날짜";
    else if (key && (tw = free.find((w) => weekStartKey(weekLabel(w)) === key))) how = "같은 주";
    if (tw) used.add(tw.id);
    return { fw, tw: tw ?? null, how };
  });
}

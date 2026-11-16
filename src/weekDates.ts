// score-system admin.html의 주차 날짜 규칙을 그대로 옮김: 'M.D'(연도 없음), 반 요일에 맞춘 날짜, 시험 날짜 최신순.
const MD = /^\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*$/;
const DAY_INDEX: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

// 연말에 내년 초, 연초에 작년 말 날짜를 넣는 경우만 연도를 보정한다.
export function resolveBaseDate(md: string, now = new Date()): Date | null {
  const m = md.match(MD);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  if (nowMonth >= 11 && month <= 2) year += 1;
  else if (nowMonth <= 2 && month >= 11) year -= 1;
  const d = new Date(year, month - 1, day);
  return d.getMonth() + 1 === month && d.getDate() === day ? d : null;
}

export const fmtMD = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;

// 기준 날짜가 속한 주(월요일 시작)의 해당 요일. 한 글자 요일이 아니면 null(호출부가 기준 날짜를 씀).
export function dateForDay(base: Date, day: string | null | undefined): Date | null {
  const target = DAY_INDEX[day ?? ""];
  if (!target) return null;
  const cur = base.getDay() === 0 ? 7 : base.getDay();
  const d = new Date(base);
  d.setDate(d.getDate() + (target - cur));
  return d;
}

// 연도가 없으니 등록 시각(created_at)에 가장 가까운 연도로 읽는다. 날짜를 못 읽는 항목은 맨 뒤.
function testDateTime(md: string, createdAt?: string | null): number | null {
  const m = md.match(MD);
  const created = createdAt ? new Date(createdAt) : null;
  if (!m || !created || Number.isNaN(created.getTime())) return resolveBaseDate(md)?.getTime() ?? null;
  const times = [-1, 0, 1].map((dy) => new Date(created.getFullYear() + dy, Number(m[1]) - 1, Number(m[2])).getTime());
  return times.reduce((a, b) => (Math.abs(b - created.getTime()) < Math.abs(a - created.getTime()) ? b : a));
}

export function sortByTestDate<T extends { test_date?: string; label?: string; created_at?: string | null }>(rows: T[]): T[] {
  return rows
    .map((r) => ({ r, t: testDateTime(r.test_date || r.label || "", r.created_at) }))
    .sort((a, b) => Number(a.t === null) - Number(b.t === null) || (b.t ?? 0) - (a.t ?? 0))
    .map((x) => x.r);
}

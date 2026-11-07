// 대면 상담 참고 카드(학원 내부용). DB 모양(scores 행)을 그대로 받으므로 실 API로 바꿔도 이 계산은 그대로 쓴다.
// 숫자는 전부 여기서 계산하고, AI에는 "물어볼 질문"만 맡긴다(counselPrompt).
import {
  isBelowCut,
  itemVal,
  normalizeItemConfig,
  type Item,
  type Period,
  type ScoreRow,
} from "./domain";

export interface CounselRow extends ScoreRow {
  student_id: number | string;
  week_id: number;
  clinic_target?: boolean;
  clinic_attend?: boolean;
}

export interface CounselBrief {
  /** 모델에도 보내는 요약 줄. 이름·연락처·메모 원문은 넣지 않는다. */
  lines: string[];
  /** 화면에만 보이는 클리닉 메모(최근 3개, 최신순). 모델로 보내지 않는다. */
  memos: { week: string; memo: string }[];
  newWeek: number | null;
}

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
};
const signed = (n: number) => (n > 0 ? "+" : "") + Math.round(n * 10) / 10;
const DAY = 86400000;

function totalOf(row: CounselRow, items: Item[]) {
  const vals = items
    .map((i) => num(itemVal(row, i.key)))
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : num(row.total_score);
}

/**
 * weeksAsc: 오래된 → 최근 주차. rows: 그 주차들의 반 전체 행(반 평균 계산용).
 * itemDefaults: item_config가 비었을 때 쓸 기본 항목(실 DB는 DEFAULT_ITEMS, 데모는 []).
 */
export function counselBrief(
  weeksAsc: Period[],
  rows: CounselRow[],
  studentId: number | string,
  createdAt: string | null,
  now = Date.now(),
  itemDefaults?: Item[],
): CounselBrief {
  const label = (w: Period) => w.label || w.test_date || String(w.id);
  const lines: string[] = [];
  const memos: CounselBrief["memos"] = [];
  const diffs: { w: string; d: number }[] = [];
  const hw: number[] = [];
  const absent: string[] = [];
  const missing: string[] = [];
  const below: Record<string, number> = {};
  const fail: Record<string, number> = {};
  let passed = 0;
  let noHw = 0;
  let clinicTarget = 0;
  let clinicCame = 0;

  for (const w of weeksAsc) {
    const items = normalizeItemConfig(w.item_config, itemDefaults).filter(
      (i) => i.active,
    );
    const weekRows = rows.filter((r) => r.week_id === w.id);
    const me = weekRows.find((r) => String(r.student_id) === String(studentId));
    if (!me) {
      missing.push(label(w));
      continue;
    }
    const mine = totalOf(me, items);
    const all = weekRows
      .map((r) => totalOf(r, items))
      .filter((v): v is number => v !== null);
    if (mine !== null && all.length)
      diffs.push({
        w: label(w),
        d: mine - all.reduce((a, b) => a + b, 0) / all.length,
      });
    const pass = me.retest_pass ?? {};
    for (const i of items) {
      const name = i.label || i.key;
      if (isBelowCut(itemVal(me, i.key) ?? null, i.cut))
        below[name] = (below[name] ?? 0) + 1;
      if (pass[i.key] === true) passed++;
      if (pass[i.key] === false) fail[name] = (fail[name] ?? 0) + 1;
    }
    const rate = num(me.homework_rate);
    if (rate !== null) hw.push(rate);
    if (me.no_homework === true) noHw++;
    if (me.attendance === false) absent.push(label(w));
    if (me.clinic_target === true) {
      clinicTarget++;
      if (me.clinic_attend === true) clinicCame++;
    }
    const memo = (me.clinic_memo ?? "").trim();
    if (memo) memos.push({ week: label(w), memo });
  }

  let newWeek: number | null = null;
  const created = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isNaN(created)) {
    const wk = Math.floor((now - created) / (7 * DAY)) + 1;
    if (wk >= 1 && wk <= 4) newWeek = wk;
  }
  if (newWeek) lines.push(`신규생 ${newWeek}주차 (등록 후 4주 이내)`);

  if (diffs.length) {
    let line =
      "총점 반 평균 대비: " +
      diffs.map((x) => `${x.w} ${signed(x.d)}`).join(" → ");
    const t = diffs.slice(-3).map((x) => x.d);
    if (t.length === 3 && t[0] > t[1] && t[1] > t[2])
      line += " (최근 3주 연속 하락)";
    lines.push(line);
  }
  const worst = Object.entries(below)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (worst.length)
    lines.push(
      "커트라인 미달 많은 항목: " +
        worst.map(([k, n]) => `${k} ${n}/${weeksAsc.length}주`).join(", "),
    );
  const failN = Object.values(fail).reduce((a, b) => a + b, 0);
  if (passed || failN)
    lines.push(
      `재시험 기록: 통과 ${passed} · 미통과 ${failN}` +
        (failN
          ? ` (${Object.entries(fail)
              .map(([k, n]) => `${k} ${n}`)
              .join(", ")})`
          : ""),
    );
  if (hw.length) {
    let line = "과제 완료율: " + hw.map((r) => `${r}%`).join(" → ");
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    if (hw.length >= 4 && avg(hw.slice(0, -2)) - avg(hw.slice(-2)) >= 20)
      line += " (최근 2주 급락)";
    if (noHw) line += `, 미제출 ${noHw}회`;
    lines.push(line);
  } else if (noHw) lines.push(`과제 미제출 ${noHw}회`);
  if (clinicTarget)
    lines.push(`클리닉: 대상 ${clinicTarget}주 중 참석 ${clinicCame}주`);
  if (absent.length) lines.push(`결석 ${absent.length}회 (${absent.join(", ")})`);
  if (missing.length) lines.push(`기록 없는 주차: ${missing.join(", ")}`);
  return { lines, memos: memos.reverse().slice(0, 3), newWeek };
}

/** 화면·복사용 카드 본문. 이름은 화면에만 쓰인다. */
export function counselCard(
  head: string,
  weekCount: number,
  brief: CounselBrief,
): string {
  const flow = brief.lines.length
    ? brief.lines.map((l) => ` - ${l}`).join("\n")
    : " - 눈에 띄는 기록 없음";
  const memo = brief.memos.length
    ? brief.memos
        .map((m) => ` - ${m.week}: ${m.memo.replace(/\s*\n\s*/g, " / ")}`)
        .join("\n")
    : " - 없음";
  return `[${head}]  최근 ${weekCount}주차 기준\n\n■ 흐름\n${flow}\n\n■ 클리닉 메모 (최근 3개)\n${memo}`;
}

/**
 * "상담 때 물어볼 질문" 프롬프트. 학생·반 이름과 메모 원문은 넣지 않는다(외부 모델로 개인정보 미전송).
 * shortcut: 모델 호출은 백엔드(운영 전환 1단계 이후)가 한다. 브라우저에는 API 키를 두지 않는다.
 */
export function counselPrompt(brief: CounselBrief, weekCount: number): string {
  const lines = brief.lines.length
    ? brief.lines.map((l) => `- ${l}`).join("\n")
    : "(특이 기록 없음)";
  return `한 학생의 최근 ${weekCount}주차 학원 기록 요약이다.

${lines}

학원 선생님이 이 학생과 대면 상담하기 전에 볼 참고 자료다. 상담 때 학생에게 물어볼 질문을 2~3개 써줘.
- 각 질문 끝에 근거가 된 기록을 괄호로 짧게 붙일 것 (예: "(최근 2주 과제 완료율 하락)")
- 원인을 단정하지 말고 학생에게 묻는 형태로만 쓸 것
- 기록에 없는 숫자는 만들어내지 말 것
- 특이한 기록이 없으면 근황과 수업 난이도를 묻는 질문을 쓸 것
- 번호 목록만 출력 (머리말·꼬리말·설명 없이)`;
}

import { useMemo, useRef, useState } from "react";
import { AdminUnavailable, type AdminWeek, type RosterClass, type RosterStudent } from "../adminApi";
import type { ScoreRow } from "../domain";
import {
  absentText,
  clinicExpected,
  composeScore,
  DEFAULT_TEMPLATES,
  fillSmsTemplate,
  isTestAbsent,
  mockExamName,
  mockScoreTargets,
  scoreWarnings,
  smsBytes,
  smsKey,
  weekScoreTargets,
  type Recipient,
  type Templates,
} from "../sms";
import { sortByTestDate } from "../weekDates";
import { useLivePanel } from "./useLivePanel";

type Kind = "score" | "absent" | "clinic";
const KINDS: [Kind, string][] = [
  ["score", "성적 문자"],
  ["absent", "테스트 미응시 문자"],
  ["clinic", "클리닉 미참석 문자"],
];
const TPL_STORE = "smsTemplates.v1";
const RESULT_TEXT: Record<string, string> = {
  dry_run: "미리보기만 (실제 발송 꺼짐)",
  already_sent: "이미 보낸 문자 — 다시 보내지 않음",
  no_phone: "번호 없음",
  blocked_by_allowlist: "허용 번호가 아님",
};

interface Period { value: string; option: string; label: string; week: AdminWeek; mock: boolean }
interface Loaded { kind: Kind; period: Period; students: RosterStudent[]; rows: ScoreRow[]; group: ScoreRow[] | null }
interface Row { student: RosterStudent; badge: string; text: string; preCheck: boolean }

function readTemplates(): Templates {
  try {
    return { ...DEFAULT_TEMPLATES, ...JSON.parse(localStorage.getItem(TPL_STORE) || "{}") };
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

// 실제 DB 성적 문자(테스트 미응시 포함)·클리닉 미참석 문자. score-system의 세 탭과 같은 대상·문구 규칙.
// 미리보기에서 고른 학생만 보내고, 결과는 학생마다 표시한다. 같은 문자를 다시 눌러도 서버가 한 번만 보낸다.
export default function SmsLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [kind, setKind] = useState<Kind>("score");
  const [classId, setClassId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [data, setData] = useState<Loaded | null>(null);
  const [recipient, setRecipient] = useState<Recipient>("parent");
  const [tpl, setTpl] = useState<Templates>(readTemplates);
  const [absentTpl, setAbsentTpl] = useState("");
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, string>>({});
  const seq = useRef(0);
  const { api, signedIn, busy, error, setError, notice, setNotice, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => setClasses(await a.rosterClasses()),
    invalidMessage: "문자 요청이 거절됐습니다. 다시 불러온 뒤 보내세요.",
  });

  const rcpt: Recipient = kind === "absent" ? "student" : recipient;
  const editTpl = (patch: Partial<Templates>) => {
    const next = { ...tpl, ...patch };
    setTpl(next);
    try {
      localStorage.setItem(TPL_STORE, JSON.stringify(next));
    } catch {
      // 저장이 막힌 브라우저에서도 이번 화면에서는 그대로 쓴다
    }
  };

  // 주차·모의고사를 날짜 최신순으로 섞는다(같은 날짜면 주차 먼저). 클리닉은 주차만.
  const loadPeriods = async (k: Kind, cid: string) => {
    const [weeks, exams] = await Promise.all([api.weeks(Number(cid)), k === "clinic" ? [] : api.mockExams(Number(cid))]);
    return sortByTestDate<AdminWeek & { p: Period }>([
      ...weeks.map((w) => ({ ...w, p: { value: `w${w.id}`, option: w.label || w.test_date || "", label: w.label || w.test_date || "", week: w, mock: false } })),
      ...exams.map((e) => {
        const label = k === "score" ? mockExamName(e) : e.label || e.exam_date || "";
        return { ...e, p: { value: `m${e.id}`, option: `[모의고사] ${label}`, label, week: e, mock: true } };
      }),
    ]).map((x) => x.p);
  };

  const load = async (k: Kind, cid: string, value: string) => {
    const my = ++seq.current;
    const list = await loadPeriods(k, cid);
    const period = list.find((p) => p.value === value) ?? list.find((p) => !p.mock) ?? list[0];
    if (my !== seq.current) return;
    setPeriods(list);
    setResults({});
    if (!period) return setData(null);
    const id = period.week.id;
    const [roster, rows] = await Promise.all([
      api.rosterStudents(Number(cid)),
      period.mock ? api.mockScores([id]) : (api.scores([id]) as Promise<ScoreRow[]>),
    ]);
    // 평균·석차를 못 불러와도 문자는 볼 수 있게 한다(그 줄만 빠지고 경고).
    let group: ScoreRow[] | null = null;
    if (k === "score" && period.mock) {
      try {
        const all = await api.allMockExams();
        const ge = all.filter((e) => (period.week.group_id ? e.group_id === period.week.group_id : e.id === id));
        group = ge.length ? await api.mockScores(ge.map((e) => e.id)) : [];
      } catch {
        group = null;
      }
    }
    if (my !== seq.current) return;
    const students = roster.filter((s) => s.is_active);
    const loaded = { kind: k, period, students, rows, group };
    setData(loaded);
    if (k === "absent") setAbsentTpl(absentText(period.label));
    const to = k === "absent" ? "student" : recipient;
    setChecked(Object.fromEntries(buildRows(loaded, tpl, absentText(period.label), to).rows.map((r) => [r.student.id, r.preCheck])));
  };

  const pickKind = (k: Kind) => {
    setKind(k);
    setData(null);
    if (classId) void run(() => load(k, classId, ""));
  };
  const pickClass = (cid: string) => {
    setClassId(cid);
    setData(null);
    setPeriods([]);
    if (cid) void run(() => load(kind, cid, ""));
  };
  const pickPeriod = (value: string) => void run(() => load(kind, classId, value));

  const built = useMemo(() => (data ? buildRows(data, tpl, absentTpl, rcpt) : null), [data, tpl, absentTpl, rcpt]);
  const hasPhone = (s: RosterStudent) => !!(rcpt === "parent" ? s.phone : s.student_phone)?.trim();
  const sendable = (built?.rows ?? []).filter((r) => hasPhone(r.student));
  const picked = sendable.filter((r) => checked[r.student.id]);

  const send = () => {
    if (!data || !built) return;
    if (!picked.length) return setError("선택된 발송 대상이 없습니다.");
    if (picked.some((r) => !r.text.trim())) return setError("문자 내용을 입력해주세요.");
    const who = rcpt === "parent" ? "학부모님" : "학생";
    const mockHead = data.period.mock && kind === "score" ? `[모의고사] ${data.period.label}\n` : "";
    if (!window.confirm(`${mockHead}${who} ${picked.length}명에게 문자를 발송할까요?${built.detail(picked)}`)) return;
    const source = `${kind}:${data.period.value}`;
    void run(async () => {
      try {
        const res = await api.sendSms(
          picked.map((r) => ({ studentId: r.student.id, recipient: rcpt, text: r.text, key: smsKey(source, r.student.id, rcpt, r.text) })),
        );
        setResults((prev) => ({
          ...prev,
          ...Object.fromEntries(res.results.map((x, i) => [picked[i].student.id, x.ok ? "접수됨" : (RESULT_TEXT[x.msg] ?? `실패: ${x.msg}`)])),
        }));
        setNotice(
          `접수 ${res.success}건 · 실패 ${res.fail}건` +
            (res.dryRun ? ` · 미리보기만 ${res.dryRun}건 (실제 발송은 꺼져 있습니다)` : "") +
            (res.duplicate ? ` · 이미 보낸 문자 ${res.duplicate}건은 다시 보내지 않았습니다` : ""),
        );
      } catch (e) {
        if (!(e instanceof AdminUnavailable)) throw e;
        setError("발송 결과를 받지 못했습니다. 다시 눌러도 이미 나간 문자는 다시 보내지 않습니다.");
      }
    });
  };

  if (!signedIn) return login("실제 DB 문자 발송");

  const mock = !!data?.period.mock;
  const area = (label: string, value: string, onChange: (v: string) => void, rows = 8) => (
    <label>
      {label}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  const allOn = sendable.length > 0 && sendable.every((r) => checked[r.student.id]);

  return (
    <section aria-label="실제 DB 문자 발송">
      <h3>실제 DB · 문자 발송</h3>
      <div role="group" aria-label="문자 종류">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} disabled={busy} onClick={() => pickKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <label>
        실제 반 선택
        <select value={classId} disabled={busy} onChange={(e) => pickClass(e.target.value)}>
          <option value="">반을 선택하세요</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {classId && (
        <label>
          {kind === "clinic" ? "주차 선택" : "주차 · 모의고사 선택"}
          <select value={data?.period.value ?? ""} disabled={busy} onChange={(e) => pickPeriod(e.target.value)}>
            {!data && <option value="">{periods.length ? "선택하세요" : "주차가 없습니다"}</option>}
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.option}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind !== "absent" ? (
        <div role="group" aria-label="발송처">
          {(["parent", "student"] as const).map((r) => (
            <button key={r} type="button" aria-pressed={recipient === r} onClick={() => setRecipient(r)}>
              {r === "parent" ? "학부모" : "학생"}
            </button>
          ))}
        </div>
      ) : (
        <p>발송처: 학생</p>
      )}
      {data && built && (
        <>
          {kind === "score" && !mock && (
            <>
              <label>
                클리닉 일정이 비어 있는 학생에게 넣을 문구 (비우면 그 줄이 통째로 빠집니다)
                <input value={tpl.clinicDefault} placeholder="예) 이번 주 클리닉 대상이 아닙니다." onChange={(e) => editTpl({ clinicDefault: e.target.value })} />
              </label>
              {area("성적 문자 양식 ({이름} {주차} {점수} {총점} {수행률} {과제} {재시험} {클리닉})", tpl.week, (v) => editTpl({ week: v }))}
              {area("미응시 문자 양식 (점수 기록이 전혀 없는 학생 · {이름} {주차})", tpl.weekAbsent, (v) => editTpl({ weekAbsent: v }), 4)}
            </>
          )}
          {kind === "score" && mock && (
            <>
              {area("모의고사 성적 문자 양식 ({이름} {시험명} {점수} {총점} {평균} {석차} {응시인원} {재시험})", tpl.mock, (v) => editTpl({ mock: v }))}
              {area("모의고사 미응시 문자 양식 (점수 입력에서 '미응시'로 체크한 학생 · {이름} {시험명})", tpl.mockAbsent, (v) => editTpl({ mockAbsent: v }), 4)}
            </>
          )}
          {kind === "absent" && area("문자 내용 ({이름} 자동 치환)", absentTpl, setAbsentTpl, 4)}
          {kind === "clinic" && area("문자 내용 ({이름} {주차} {클리닉} 자동 치환)", tpl.clinic, (v) => editTpl({ clinic: v }), 5)}
          {kind !== "absent" && (
            <button
              type="button"
              onClick={() =>
                editTpl(
                  kind === "clinic"
                    ? { clinic: DEFAULT_TEMPLATES.clinic }
                    : mock
                      ? { mock: DEFAULT_TEMPLATES.mock, mockAbsent: DEFAULT_TEMPLATES.mockAbsent }
                      : { week: DEFAULT_TEMPLATES.week, weekAbsent: DEFAULT_TEMPLATES.weekAbsent },
                )
              }
            >
              기본 양식으로 되돌리기
            </button>
          )}
          {built.warnings.length > 0 && (
            <ul aria-label="문자 확인 사항">
              {built.warnings.map((w) => (
                <li key={w}>⚠️ {w}</li>
              ))}
            </ul>
          )}
          <p>{built.title}</p>
          {built.rows.length === 0 ? (
            <p>{kind === "absent" ? "미응시 학생이 없습니다." : "이 반의 재원생이 없습니다."}</p>
          ) : (
            <table aria-label="발송 대상">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={allOn}
                      onChange={() => setChecked((c) => ({ ...c, ...Object.fromEntries(sendable.map((r) => [r.student.id, !allOn])) }))}
                    />
                  </th>
                  <th>이름</th>
                  <th>상태</th>
                  <th>발송될 문구</th>
                  <th>길이</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {built.rows.map((r) => {
                  const ok = hasPhone(r.student);
                  const bytes = smsBytes(r.text);
                  return (
                    <tr key={r.student.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${r.student.name} 선택`}
                          disabled={!ok}
                          checked={ok && !!checked[r.student.id]}
                          onChange={(e) => setChecked((c) => ({ ...c, [r.student.id]: e.target.checked }))}
                        />
                      </td>
                      <td>{r.student.name}</td>
                      <td>{ok ? r.badge : "번호없음"}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{r.text}</td>
                      <td>
                        {bytes}바이트 {bytes > 90 ? "LMS" : "SMS"}
                      </td>
                      <td>{results[r.student.id] ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button type="button" disabled={busy || !picked.length} onClick={send}>
            선택 발송 ({picked.length}명)
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function buildRows({ kind, period, students, rows, group }: Loaded, tpl: Templates, absentTpl: string, rcpt: Recipient) {
  const has = (s: RosterStudent) => !!(rcpt === "parent" ? s.phone : s.student_phone)?.trim();
  const byId = new Map(rows.map((r) => [Number(r.student_id), r]));
  const noDetail = () => "";
  if (kind === "absent") {
    const list = students.filter((s) => isTestAbsent(byId.get(s.id), period.week, period.mock));
    return {
      title: `미응시 학생 — ${list.length}명 (${period.option})`,
      warnings: [] as string[],
      detail: noDetail,
      rows: list.map((student): Row => ({ student, badge: "발송가능", text: fillSmsTemplate(absentTpl, { 이름: student.name }), preCheck: has(student) })),
    };
  }
  if (kind === "clinic") {
    const list = students.map((student) => {
      const sc = byId.get(student.id);
      const expected = clinicExpected(sc, period.week);
      const attended = sc?.clinic_attend === true;
      const text = fillSmsTemplate(tpl.clinic, { 이름: student.name, 주차: period.label, 클리닉: (sc?.clinic_memo || "").trim() });
      return { student, badge: attended ? "✓ 왔음" : expected ? "안 옴" : "대상 아님", text, preCheck: has(student) && expected && !attended };
    });
    const missed = list.filter((r) => r.badge === "안 옴").length;
    return {
      title: missed
        ? `반 전체 ${list.length}명 · 클리닉 미참석 ${missed}명을 체크해 두었어요`
        : `반 전체 ${list.length}명 · 보낼 학생을 체크하세요`,
      warnings: [] as string[],
      detail: noDetail,
      rows: list as Row[],
    };
  }
  const m = period.mock ? mockScoreTargets(students, rows, period.week, group) : null;
  const targets = m ? m.targets : weekScoreTargets(students, rows, period.week, period.label);
  const warnings = m
    ? [
        ...(group === null ? ["평균·석차를 불러오지 못해 그 줄이 빠집니다. 시험을 다시 선택해 보세요."] : m.avg === null ? ["이 시험에 입력된 점수가 없어 평균 줄이 빠집니다."] : []),
        ...(period.week.group_id ? [] : ["이 모의고사는 비교 그룹이 없어 이 반 학생만으로 평균·석차를 냅니다. (모의고사 탭 → 비교 그룹 수정)"]),
        ...(targets.some((t) => t.notTarget)
          ? [`${targets.filter((t) => t.notTarget).length}명은 점수도 미응시 표시도 없어 '대상 아님'으로 분류했습니다. 시험을 봤다면 모의고사 탭에서 점수를 먼저 입력하세요.`]
          : []),
        ...(m.avg === null ? [] : [`평균 ${m.avg}점 · 응시인원 ${m.sample}명 — 학부모 화면과 같은 값입니다.`]),
      ]
    : scoreWarnings(targets, tpl);
  const count = (f: (t: (typeof targets)[number]) => boolean) => targets.filter(f).length;
  const nt = count((t) => t.notTarget);
  return {
    title: `발송 대상 — 성적 ${count((t) => !t.absent && !t.notTarget)}명 / 미응시 ${count((t) => t.absent)}명` + (nt ? ` / 대상 아님 ${nt}명` : ""),
    warnings,
    detail: (picked: Row[]) => {
      const sel = targets.filter((t) => picked.some((r) => r.student.id === t.student.id));
      const a = sel.filter((t) => t.absent).length;
      const n = sel.filter((t) => t.notTarget).length;
      return a || n ? `\n(성적 ${sel.length - a - n}명 · 미응시 ${a}명${n ? ` · 대상 아님 ${n}명(미응시 문구)` : ""})` : "";
    },
    rows: targets.map(
      (t): Row => ({
        student: t.student,
        badge: t.notTarget ? "대상 아님" : t.absent ? `미응시${t.attendanceFalse ? " · 결석" : ""}` : "성적",
        text: composeScore(t, period.mock, tpl),
        preCheck: has(t.student) && !t.absent && !t.notTarget,
      }),
    ),
  };
}

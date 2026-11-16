import { useRef, useState } from "react";
import type { AdminApi } from "../adminApi";
import {
  buildClinicSchedule,
  clinicColLabel,
  clinicColumns,
  clinicTallies,
  recentClinicWeeks,
  type ClinicRef,
  type ClinicRow,
  type ClinicStudent,
  type GradeData,
} from "../clinic";
import { useLivePanel } from "./useLivePanel";

type Schedule = ReturnType<typeof buildClinicSchedule>;
const SCORE_CHUNK = 24; // 서버 점수 조회 한도

async function loadSchedule(api: AdminApi): Promise<Schedule> {
  const [classes, weeks] = await Promise.all([api.classes(), api.allWeeks()]);
  const recent = recentClinicWeeks(weeks);
  const ids = recent.map((w) => w.id);
  const chunks = Array.from({ length: Math.ceil(ids.length / SCORE_CHUNK) }, (_, i) => ids.slice(i * SCORE_CHUNK, (i + 1) * SCORE_CHUNK));
  const [roster, rows] = await Promise.all([
    Promise.all(classes.map(async (c) => (await api.students(c.id)).map((s): ClinicStudent => ({ id: s.id, name: s.name, class_id: c.id })))),
    Promise.all(chunks.map((ch) => api.scores(ch) as unknown as Promise<ClinicRow[]>)),
  ]);
  return buildClinicSchedule(classes, recent, roster.flat(), rows.flat());
}

// 실제 DB 클리닉 배정표. score-system처럼 클리닉 메모에서 요일·시간을 읽어 배치하고, 이름 앞 ✓로 출석을 바로 저장한다.
export default function ClinicLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [refs, setRefs] = useState<Record<string, ClinicRef>>({});
  const [grade, setGrade] = useState("전체");
  const pending = useRef(new Set<string>());
  const { api, signedIn, busy, error, setError, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => {
      const s = await loadSchedule(a);
      setSched(s);
      setRefs(s.refs);
    },
    invalidMessage: "출석을 저장하지 못했습니다. 학생의 반이 바뀌었으면 다시 불러오세요.",
  });

  const reload = () =>
    void run(async () => {
      const s = await loadSchedule(api);
      setSched(s);
      setRefs(s.refs);
      if (grade !== "전체" && !s.grades.includes(grade)) setGrade("전체");
    });

  const toggle = async (sid: string) => {
    const r = refs[sid];
    if (!r || pending.current.has(sid)) return;
    pending.current.add(sid);
    const want = !r.attend;
    setRefs((m) => ({ ...m, [sid]: { ...r, attend: want } })); // 화면은 바로 바꾸고, 저장이 실패하면 되돌린다
    try {
      await api.saveScore({
        week_id: r.weekId,
        student_id: r.studentId,
        items: r.items,
        no_homework: false,
        before: { clinic_attend: r.attend },
        after: { clinic_attend: want },
      });
    } catch {
      setRefs((m) => ({ ...m, [sid]: { ...r } }));
      setError("출석 표시를 저장하지 못했어요. 다시 눌러주세요.");
    } finally {
      pending.current.delete(sid);
    }
  };

  if (!signedIn) return login("실제 DB 클리닉 배정표");

  const on = (sid: string) => !!refs[sid]?.attend;
  const att = (sid: string, name: string) => (
    <button type="button" className={`clinic-att${on(sid) ? " on" : ""}`} aria-pressed={on(sid)} aria-label={`${name} 클리닉 출석`} onClick={() => void toggle(sid)}>
      ✓
    </button>
  );
  const hwTag = (hw: number | null) => (hw === null ? null : <span className="clinic-hw">{hw}%</span>);
  const shown = sched ? sched.grades.filter((g) => grade === "전체" || g === grade) : [];

  const card = (gr: string, g: GradeData) => {
    const { keys, days } = clinicColumns(g.entries);
    const total = new Set(g.entries.map((e) => e.id)).size + g.unassigned.length;
    const sids = [...new Set([...g.entries.map((e) => e.sid), ...g.unassigned.map((u) => u.sid)])];
    const came = sids.filter(on).length;
    const abbr = Object.fromEntries(g.itemOrder.map((o) => [o.abbr, o.label]));
    const weekInfo = Object.entries(g.weekOf).map(([c, w]) => `${c}: ${w}`).join(" · ");
    const tallies = clinicTallies(gr, g);
    return (
      <div key={gr} className="clinic-card" aria-label={`${gr} 클리닉 배정표`}>
        <h4>
          ■ {gr} (클리닉 대상 {total}명{came ? ` · 출석 ${came}명` : ""})
        </h4>
        <p>기준 주차 — {weekInfo || "-"}</p>
        {g.stale.map((s) => (
          <p key={s.name}>
            ⚠️ {s.name}은 이번 주차가 아직 없어 포함하지 않았습니다. (마지막 클리닉 기록: {s.label})
          </p>
        ))}
        <p>▸ 요일별 배정</p>
        {days.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="clinic-grid">
              <thead>
                <tr>
                  <th>요일</th>
                  {keys.map((k) => (
                    <th key={String(k)}>{clinicColLabel(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const row = [...new Set(g.entries.filter((e) => e.day === d).map((e) => e.sid))];
                  return (
                    <tr key={d}>
                      <td>
                        <strong>{d}요일</strong>
                        {row.length > 0 && ` 출석 ${row.filter(on).length}/${row.length}`}
                      </td>
                      {keys.map((k) => (
                        <td key={String(k)} className={k === null ? "clinic-untimed" : undefined}>
                          {g.entries
                            .filter((e) => e.day === d && e.min === k)
                            .map((e) => (
                              <span key={e.sid} className={`clinic-chip${on(e.sid) ? " came" : ""}`}>
                                {att(e.sid, e.name)}
                                {e.name}
                                {e.exact && <span className="clinic-exact">{e.exact}</span>}
                                {hwTag(e.hw)}
                                {e.items.map((ab) => (
                                  <span key={ab} className="clinic-item" title={`${abbr[ab] ?? ab} 재시험 남음`}>
                                    {ab}
                                  </span>
                                ))}
                                {e.hwOnly && <span className="clinic-hwonly">과제</span>}
                                {e.note && <span className="clinic-note">({e.note})</span>}
                              </span>
                            ))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>요일을 읽을 수 있는 클리닉 메모가 없습니다.</p>
        )}
        <p className="clinic-legend">
          00% 과제 수행률
          {g.itemOrder.length > 0 && ` · 재시험 남은 항목 — ${g.itemOrder.map((o) => `${o.abbr} ${o.label}`).join(", ")}`}
          {g.entries.some((e) => e.hwOnly) && " · '과제' 남은 재시험은 없고 메모에 일정만 적힌 학생"}
          {keys.includes(null) && " · '시간 미정' 칸은 요일만 정해진 학생"}
        </p>
        {g.unassigned.length > 0 && (
          <p>
            <strong>요일·시간 미기재 ({g.unassigned.length}명):</strong>{" "}
            {g.unassigned.map((u, i) => (
              <span key={u.sid} className={`clinic-unassigned${on(u.sid) ? " came" : ""}`}>
                {i > 0 && ", "}
                {att(u.sid, u.name)}
                {u.name}
                {hwTag(u.hw)}
                {u.items.map((ab) => (
                  <span key={ab} className="clinic-item">
                    {ab}
                  </span>
                ))}
                {u.memo && <small> ({u.memo.length > 20 ? u.memo.slice(0, 20) + "…" : u.memo})</small>}
              </span>
            ))}
          </p>
        )}
        {tallies.length > 0 && (
          <div aria-label={`${gr} 재시험지 수요`}>
            <p>▸ 재시험지 수요 (장 · 재시험 통과 항목 제외)</p>
            {tallies.map(({ title, t }) => (
              <table key={title || "all"}>
                {title && <caption>{title}</caption>}
                <thead>
                  <tr>
                    <th>요일</th>
                    {t!.cols.map((o) => (
                      <th key={o.abbr} title={o.label}>
                        {o.abbr}
                      </th>
                    ))}
                    <th>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {t!.rows.map((d) => (
                    <tr key={d}>
                      <td>{d === "요일 미정" ? d : `${d}요일`}</td>
                      {t!.cols.map((o) => (
                        <td key={o.abbr}>{t!.cell(d, o.abbr) || ""}</td>
                      ))}
                      <td>{t!.rowSum(d)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>합계</td>
                    {t!.cols.map((o) => (
                      <td key={o.abbr}>{t!.colSum(o.abbr) || ""}</td>
                    ))}
                    <td>{t!.rows.reduce((n, d) => n + t!.rowSum(d), 0)}</td>
                  </tr>
                </tbody>
              </table>
            ))}
          </div>
        )}
      </div>
    );
  };

  const hwGrades = shown.filter((g) => sched!.data[g].hwDue.length);
  return (
    <section aria-label="실제 DB 클리닉 배정표">
      <h3>실제 DB</h3>
      <p>반마다 클리닉 메모가 있는 가장 최근 주차로 배정표를 만듭니다. 메모를 고치려면 점수 입력 탭에서 고치세요.</p>
      <button type="button" disabled={busy} onClick={reload}>
        새로고침
      </button>
      {sched && sched.grades.length > 0 && (
        <div role="group" aria-label="학년 필터">
          {["전체", ...sched.grades].map((g) => (
            <button key={g} type="button" aria-pressed={grade === g} onClick={() => setGrade(g)}>
              {g}
            </button>
          ))}
        </div>
      )}
      {sched && !sched.grades.length && <p>최신 주차에 클리닉 대상 학생이 없습니다.</p>}
      {sched && shown.map((g) => card(g, sched.data[g]))}
      {sched && sched.grades.length > 0 && (
        <div aria-label="과제 인증 기한">
          <h4>과제 인증 기한</h4>
          {hwGrades.length ? (
            hwGrades.map((g) => (
              <table key={g}>
                <caption>
                  ■ {g} ({sched.data[g].hwDue.length}명)
                </caption>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>인증 기한 (메모 기재대로)</th>
                  </tr>
                </thead>
                <tbody>
                  {sched.data[g].hwDue.map((u) => (
                    <tr key={u.sid}>
                      <td>
                        <strong>{u.name}</strong>
                        {u.hw !== null && `(${u.hw}%)`}
                      </td>
                      <td>{u.due}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))
          ) : (
            <p>과제 인증 기한이 적힌 학생이 없습니다.</p>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

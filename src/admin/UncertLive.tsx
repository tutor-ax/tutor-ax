import { useState } from "react";
import type { AdminClass, AdminStudent, AdminWeek } from "../adminApi";
import { isUncert, UNCERT_VISIBLE, type ClinicRow } from "../clinic";
import { activeItems } from "../domain";
import { sortByTestDate } from "../weekDates";
import { useLivePanel } from "./useLivePanel";

const key = (wid: number, sid: number) => `${wid}:${sid}`;

// 실제 DB 미인증 관리. score-system처럼 최근 4주차 중 하나라도 과제평가가 있거나 과제%가 비었거나 79% 이하인 학생을 모아
// 과제%를 고친다. 점수 행이 없는 칸은 score-system도 저장하지 않으므로 잠근다.
export default function UncertLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<AdminClass[]>([]);
  const [classId, setClassId] = useState("");
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Record<string, ClinicRow>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { api, signedIn, busy, error, notice, setNotice, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => setClasses(await a.classes()),
    onConflict: async () => load(weeks, offset),
    invalidMessage: "과제%는 0~100 정수로 입력하세요.",
  });

  const visibleOf = (ws: AdminWeek[], off: number) => ws.slice(off, off + UNCERT_VISIBLE).reverse();
  const load = async (ws: AdminWeek[], off: number) => {
    const vis = visibleOf(ws, off);
    const list = vis.length ? ((await api.scores(vis.map((w) => w.id))) as unknown as ClinicRow[]) : [];
    setRows(Object.fromEntries(list.map((r) => [key(r.week_id, Number(r.student_id)), r])));
    setEdits({});
  };

  const pickClass = (cid: string) => {
    setClassId(cid);
    setWeeks([]);
    setStudents([]);
    setRows({});
    setEdits({});
    setOffset(0);
    if (!cid)
      return;
    void run(async () => {
      const [ws, sts] = await Promise.all([api.weeks(Number(cid)), api.students(Number(cid))]);
      const sorted = sortByTestDate(ws);
      setWeeks(sorted);
      setStudents(sts);
      await load(sorted, 0);
    });
  };

  const move = (by: number) => {
    const next = offset + by;
    if (by > 0 && offset + UNCERT_VISIBLE >= weeks.length) return setNotice("더 이전 주차가 없습니다.");
    if (by < 0 && offset <= 0) return setNotice("가장 최신 주차입니다.");
    setOffset(next);
    void run(() => load(weeks, next));
  };

  const visible = visibleOf(weeks, offset);
  const shown = students.filter((st) => isUncert(visible.map((w) => rows[key(w.id, st.id)])));
  const changed = Object.entries(edits).filter(([k, v]) => {
    const now = rows[k]?.homework_rate;
    return (v.trim() === "" ? null : Number(v)) !== (now ?? null);
  });

  const save = () =>
    void run(async () => {
      for (const [k, v] of changed) {
        const r = rows[k];
        const w = weeks.find((x) => x.id === r.week_id);
        await api.saveScore({
          week_id: r.week_id,
          student_id: Number(r.student_id),
          items: activeItems(w).map((i) => i.key),
          no_homework: false,
          before: { homework_rate: r.homework_rate ?? null },
          after: { homework_rate: v.trim() === "" ? null : Number(v) },
        });
      }
      await load(weeks, offset);
    }, "저장됐어요!");

  if (!signedIn) return login("실제 DB 미인증 관리");

  const className = classes.find((c) => c.id === Number(classId))?.name ?? "";
  const label = (w?: AdminWeek) => w?.label || w?.test_date || "";
  return (
    <section aria-label="실제 DB 미인증 관리">
      <h3>실제 DB</h3>
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
      {classId && !busy && (
        <div aria-label="실제 미인증 명단">
          <h4>
            미인증 — {className}
            {visible.length > 0 && ` (${label(visible[0])} ~ ${label(visible[visible.length - 1])}, ${shown.length}명)`}
          </h4>
          <button type="button" onClick={() => move(1)}>
            ◀ 이전
          </button>
          <button type="button" onClick={() => move(-1)}>
            다음 ▶
          </button>
          {!visible.length ? (
            <p>표시할 주차가 없습니다.</p>
          ) : !shown.length ? (
            <p>미인증 학생이 없습니다. 🎉</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  {visible.map((w) => (
                    <th key={w.id}>{label(w)} 과제%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((st) => (
                  <tr key={st.id}>
                    <td>{st.name}</td>
                    {visible.map((w) => {
                      const k = key(w.id, st.id);
                      const r = rows[k];
                      return (
                        <td key={w.id}>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            aria-label={`${st.name} ${label(w)} 과제%`}
                            disabled={!r}
                            title={r ? undefined : "이 주차에 점수 기록이 없어 여기서는 저장하지 않습니다"}
                            value={edits[k] ?? (r?.homework_rate ?? "")}
                            onChange={(e) => setEdits((m) => ({ ...m, [k]: e.target.value }))}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {shown.length > 0 && (
            <button type="button" disabled={!changed.length} onClick={save}>
              저장
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

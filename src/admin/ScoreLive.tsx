import { useRef, useState } from "react";
import { AdminConflict, type AdminWeek, type RosterClass, type RosterStudent } from "../adminApi";
import { activeItems, isBelowCut, type Item } from "../domain";
import { changedFields, fieldsOf, overMax, payloadValue, total, withCarry, type Fields, type SheetRow } from "../scoreSheet";
import { sortByTestDate } from "../weekDates";
import { useLivePanel } from "./useLivePanel";

const SCALAR_LABELS: Record<string, string> = { attendance: "출석", homework_rate: "과제%", homework_eval: "과제평가", clinic_memo: "클리닉메모" };
// 이전 주차 과제 값 이어오기에 쓰는 최대 주차 수(서버 점수 조회 한도 24 - 이번 주차).
const CARRY_WEEKS = 23;

// 실제 DB 점수 입력. score-system 점수 입력 탭처럼 칸에서 벗어나면 그 학생의 바뀐 칸만 저장한다.
// 항목 설정·비교 그룹 편집, 과제 없음, 주차 메모, 다른 반 학생 입력, 반 이동은 아직 score-system에서 한다.
export default function ScoreLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [classId, setClassId] = useState("");
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [weekId, setWeekId] = useState("");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Record<number, string>>({});
  const [, setTick] = useState(0);
  const base = useRef<Record<number, Fields>>({});
  const screen = useRef<Record<number, Fields>>({});
  const chains = useRef<Record<number, Promise<void>>>({});
  const { api, signedIn, busy, error, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => setClasses(await a.rosterClasses()),
    invalidMessage: "점수는 0 이상 숫자, 과제%는 0~100 정수로 입력하세요.",
  });

  const labelOf = (k: string) => {
    const it = items.find((i) => k.endsWith(`:${i.key}`));
    return SCALAR_LABELS[k] ?? (k.startsWith("retest:") ? `${it?.label ?? "항목"} 재시험` : (it?.label ?? "항목"));
  };
  const mark = (sid: number, s: string) => setStatus((prev) => ({ ...prev, [sid]: s }));
  const flush = () => Promise.all(Object.values(chains.current));

  const pickClass = (cid: string) => {
    setClassId(cid);
    setWeekId("");
    setWeeks([]);
    setStudents([]);
    if (cid) void run(async () => setWeeks(sortByTestDate(await api.weeks(Number(cid)))));
  };

  const pickWeek = (wid: string) => {
    setWeekId(wid);
    setStudents([]);
    if (!wid) return;
    void run(async () => {
      await flush(); // 방금 입력한 칸이 저장된 뒤에 다른 주차를 읽는다
      const idx = weeks.findIndex((w) => w.id === Number(wid));
      const prevIds = weeks.slice(idx + 1, idx + 1 + CARRY_WEEKS).map((w) => w.id);
      const [rows, roster] = await Promise.all([
        api.scores([Number(wid), ...prevIds]) as unknown as Promise<SheetRow[]>,
        api.rosterStudents(Number(classId)),
      ]);
      const its = activeItems(weeks[idx]);
      const mine = rows.filter((r) => r.week_id === Number(wid));
      const prev = rows.filter((r) => r.week_id !== Number(wid)).sort((a, b) => prevIds.indexOf(a.week_id) - prevIds.indexOf(b.week_id));
      const active = roster.filter((s) => s.is_active);
      base.current = {};
      screen.current = {};
      for (const s of active) {
        const row = mine.find((r) => Number(r.student_id) === s.id);
        base.current[s.id] = fieldsOf(row, its);
        screen.current[s.id] = withCarry(base.current[s.id], row, prev, s.id);
      }
      setItems(its);
      setStatus({});
      setStudents(active);
    });
  };

  const saveNow = async (sid: number): Promise<void> => {
    const b = base.current[sid];
    const sc = { ...screen.current[sid] };
    const fields = changedFields(b, sc);
    if (!fields.length) return;
    const over = overMax(sc, items);
    if (over.length) return mark(sid, `만점 초과(${over.map((i) => i.label).join(", ")}) — 저장 안 함`);
    mark(sid, "저장 중");
    try {
      await api.saveScore({
        week_id: Number(weekId),
        student_id: sid,
        items: items.map((i) => i.key),
        before: Object.fromEntries(fields.map((k) => [k, payloadValue(k, b[k])])),
        after: Object.fromEntries(fields.map((k) => [k, payloadValue(k, sc[k])])),
      });
      base.current[sid] = { ...b, ...Object.fromEntries(fields.map((k) => [k, sc[k]])) };
      mark(sid, "저장됨");
    } catch (e) {
      if (!(e instanceof AdminConflict)) {
        mark(sid, "저장 실패");
        throw e;
      }
      // 다른 곳에서 바뀐 칸만 저장된 값으로 되돌리고, 나머지 바뀐 칸은 다시 저장한다(score-system의 [취소]와 같음).
      for (const [k, v] of Object.entries(e.current)) {
        base.current[sid] = { ...base.current[sid], [k]: v };
        screen.current[sid] = { ...screen.current[sid], [k]: v };
      }
      setTick((t) => t + 1);
      const reverted = Object.keys(e.current).map(labelOf).join(", ");
      await saveNow(sid);
      mark(sid, `${reverted}: 다른 곳에서 바뀌어 저장된 값으로 되돌림`);
    }
  };

  // 학생마다 저장을 한 줄로 세운다. 앞 저장이 끝나야 다음 저장(새 줄이 두 번 생기지 않게).
  const save = (sid: number) => {
    chains.current[sid] = (chains.current[sid] ?? Promise.resolve()).then(() => run(() => saveNow(sid)));
  };

  const edit = (sid: number, k: string, v: unknown) => {
    const next = { ...screen.current[sid], [k]: v };
    const it = items.find((i) => k === `score:${i.key}`);
    if (it && !isBelowCut(v as number, it.cut)) next[`retest:${it.key}`] = false; // 커트를 넘기면 재시험 칸이 사라진다
    screen.current[sid] = next;
    setTick((t) => t + 1);
  };

  if (!signedIn) return login("실제 DB 점수 입력");

  const str = (v: unknown) => (v == null ? "" : String(v));
  return (
    <section aria-label="실제 DB 점수 입력">
      <h3>실제 DB</h3>
      <p>실제 학원 기록입니다. 칸에서 벗어나면 그 학생의 바뀐 칸만 바로 저장됩니다.</p>
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
          실제 주차 선택
          <select value={weekId} disabled={busy} onChange={(e) => pickWeek(e.target.value)}>
            <option value="">주차를 선택하세요</option>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label || w.test_date}
              </option>
            ))}
          </select>
        </label>
      )}
      {weekId && students.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>총점 /{items.reduce((a, i) => a + (i.max ?? 0), 0)}</th>
              <th>출석</th>
              {items.map((i) => (
                <th key={i.key}>
                  {i.label || "-"} /{i.max ?? ""}
                </th>
              ))}
              <th>과제%</th>
              <th>과제평가</th>
              <th>클리닉메모</th>
              <th>저장</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const sc = screen.current[s.id];
              const t = total(sc, items);
              return (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.note && <small> {s.note}</small>}
                  </td>
                  <td>{t ?? ""}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${s.name} 출석`}
                      checked={sc.attendance !== false}
                      onChange={(e) => {
                        edit(s.id, "attendance", e.target.checked);
                        save(s.id);
                      }}
                    />
                  </td>
                  {items.map((i) => {
                    const v = sc[`score:${i.key}`];
                    const below = isBelowCut(v as number, i.cut);
                    return (
                      <td key={i.key}>
                        <input
                          type="number"
                          min={0}
                          max={i.max ?? undefined}
                          aria-label={`${s.name} ${i.label}`}
                          aria-invalid={i.max != null && v !== "" && v != null && Number(v) > i.max}
                          value={str(v)}
                          onChange={(e) => edit(s.id, `score:${i.key}`, e.target.value)}
                          onBlur={() => save(s.id)}
                        />
                        {below && (
                          <label>
                            <input
                              type="checkbox"
                              checked={!!sc[`retest:${i.key}`]}
                              onChange={(e) => {
                                edit(s.id, `retest:${i.key}`, e.target.checked);
                                save(s.id);
                              }}
                            />
                            {`${s.name} ${i.label} 재시험 통과`}
                          </label>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      aria-label={`${s.name} 과제%`}
                      value={str(sc.homework_rate)}
                      onChange={(e) => edit(s.id, "homework_rate", e.target.value)}
                      onBlur={() => save(s.id)}
                    />
                  </td>
                  <td>
                    <textarea
                      rows={1}
                      aria-label={`${s.name} 과제평가`}
                      value={str(sc.homework_eval)}
                      onChange={(e) => edit(s.id, "homework_eval", e.target.value)}
                      onBlur={() => save(s.id)}
                    />
                  </td>
                  <td>
                    <textarea
                      rows={1}
                      aria-label={`${s.name} 클리닉메모`}
                      value={str(sc.clinic_memo)}
                      onChange={(e) => edit(s.id, "clinic_memo", e.target.value)}
                      onBlur={() => save(s.id)}
                    />
                  </td>
                  <td role="status" aria-label={`${s.name} 저장 상태`}>
                    {status[s.id] ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {weekId && !busy && students.length === 0 && <p>이 반에 재원 중인 학생이 없습니다.</p>}
      <p>항목 설정·비교 그룹, 과제 없음, 주차 메모, 다른 반 학생 입력, 반 이동은 아직 score-system에서 합니다.</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

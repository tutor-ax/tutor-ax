import { useState } from "react";
import { AdminConflict, AdminUnauthorized, type AdminWeek, type RosterClass } from "../adminApi";
import { activeItems } from "../domain";
import {
  fmtHistTime,
  fmtHistVal,
  historyDiff,
  historyLabels,
  planUpTo,
  revertFor,
  type HistoryEntry,
  type Revert,
  type Row,
} from "../history";
import { sortByTestDate } from "../weekDates";
import { useLivePanel } from "./useLivePanel";

// 실제 DB 변경 이력 · 되돌리기. 되돌리기는 점수 입력과 같은 저장(덮어쓰기 확인)이라 다시 이력에 남는다.
export default function HistoryLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [classId, setClassId] = useState("");
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [weekId, setWeekId] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const { api, signedIn, busy, error, setError, notice, setNotice, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => setClasses(await a.rosterClasses()),
    invalidMessage: "되돌릴 값을 서버가 받지 않았습니다. 새로고침 후 다시 시도하세요.",
  });

  const week = weeks.find((w) => w.id === Number(weekId));
  const labels = historyLabels(week?.item_config);
  const nameOf = (row: Row | null) => names[Number(row?.student_id)] ?? `학생#${row?.student_id ?? "?"}`;

  const load = async (cid: string, wid: string) => {
    const [roster, list] = await Promise.all([api.rosterStudents(Number(cid)), api.history(Number(wid))]);
    setNames(Object.fromEntries(roster.map((s) => [s.id, s.name])));
    setEntries(list);
  };

  const pickWeek = (wid: string, cid = classId) => {
    setWeekId(wid);
    setEntries(null);
    if (wid) void run(() => load(cid, wid));
  };

  const pickClass = (cid: string) => {
    setClassId(cid);
    setWeeks([]);
    setWeekId("");
    setEntries(null);
    if (!cid) return;
    void run(async () => {
      const list = sortByTestDate(await api.weeks(Number(cid)));
      setWeeks(list);
      if (list.length) {
        setWeekId(String(list[0].id));
        await load(cid, String(list[0].id));
      }
    });
  };

  // 한 명씩 차례로 저장한다. 그사이 다른 곳에서 바뀐 학생은 건너뛰고 알려 준다.
  const apply = async (plan: Revert[]) => {
    const items = activeItems(week).map((i) => i.key);
    let conflicts = 0;
    let failed = 0;
    for (const r of plan) {
      try {
        await api.saveScore({ week_id: Number(weekId), student_id: r.student_id, items, no_homework: r.no_homework, before: r.before, after: r.after });
      } catch (e) {
        if (e instanceof AdminUnauthorized) throw e;
        if (e instanceof AdminConflict) conflicts++;
        else failed++;
      }
    }
    await load(classId, weekId);
    const done = plan.length - conflicts - failed;
    setNotice(
      [
        done && `${done}명을 되돌렸습니다.`,
        conflicts && `${conflicts}명은 그사이 다른 곳에서 바뀌어 건너뛰었습니다(새로고침된 이력을 보고 다시 시도하세요).`,
        failed && `${failed}건은 저장하지 못했습니다.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const current = async () => (await api.scores([Number(weekId)])) as unknown as Row[];

  const restoreOne = (e: HistoryEntry) =>
    run(async () => {
      if (!e.old_row) return;
      const name = nameOf(e.old_row);
      const sid = Number(e.old_row.student_id);
      const cur = (await current()).find((r) => Number(r.student_id) === sid);
      if (e.op === "DELETE" && cur) return setError(`${name}의 줄이 이미 다시 있어 되살리지 않았습니다.`);
      const keys = e.op === "DELETE" ? Object.keys(labels) : historyDiff(e, labels).map((d) => d.key);
      const r = revertFor(e.old_row, cur, keys, labels, sid);
      if (!r) return setNotice("되돌릴 변경이 없습니다. 이미 그 값입니다.");
      const question =
        e.op === "DELETE"
          ? `${name}의 삭제된 줄을 되살릴까요?\n(${fmtHistTime(e.changed_at)} 삭제 당시 값으로 복원)`
          : `${name}의 값을 ${fmtHistTime(e.changed_at)} 직전으로 되돌릴까요?\n\n${r.labels.map((l) => `· ${l}`).join("\n")}`;
      if (!confirm(question)) return;
      await apply([r]);
    });

  const restoreUpTo = (anchor: HistoryEntry) =>
    run(async () => {
      const plan = planUpTo(entries ?? [], anchor, await current(), labels);
      if (!plan.length) return setNotice("되돌릴 변경이 없습니다. 이미 그 시점의 값입니다.");
      const lines =
        plan
          .slice(0, 10)
          .map((p) => `· ${names[p.student_id] ?? `학생#${p.student_id}`}: ${p.labels.join(", ")}`)
          .join("\n") + (plan.length > 10 ? `\n… 외 ${plan.length - 10}명` : "");
      if (!confirm(`${fmtHistTime(anchor.changed_at)} 직전 상태로 ${plan.length}명을 되돌릴까요?\n\n${lines}\n\n(되돌리기도 이력에 남아 다시 되돌릴 수 있습니다)`))
        return;
      await apply(plan);
    });

  if (!signedIn) return login("실제 DB 변경 이력");

  const meaningful = (entries ?? []).filter((e) => historyDiff(e, labels).length);
  return (
    <section aria-label="실제 DB 변경 이력">
      <h3>실제 DB</h3>
      <p>
        점수·과제%·과제평가·클리닉 메모가 언제 어떻게 바뀌었는지 보여 주고, 잘못 덮어써진 값을 이전 값으로 되돌립니다. 되돌리기도 이력에 남으므로
        다시 되돌릴 수 있습니다. (이력은 2026-09-06부터 쌓입니다)
      </p>
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
      {entries && (
        <>
          <p>
            변경 {meaningful.length}건{" "}
            <button type="button" disabled={busy} onClick={() => pickWeek(weekId)}>
              새로고침
            </button>
          </p>
          {meaningful.length === 0 ? (
            <p>이 주차에는 기록된 변경이 없습니다.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>학생</th>
                  <th>바뀐 내용 (이전 → 이후)</th>
                  <th>되돌리기</th>
                </tr>
              </thead>
              <tbody>
                {meaningful.map((e) => {
                  const diff = historyDiff(e, labels);
                  const name = nameOf(e.old_row);
                  return (
                    <tr key={e.id}>
                      <td>{fmtHistTime(e.changed_at)}</td>
                      <td>{name}</td>
                      <td>
                        {e.op === "DELETE" ? (
                          <>
                            <strong>행 삭제됨</strong> — {diff.map((d) => `${d.label}: ${fmtHistVal(d.before)}`).join(", ")}
                          </>
                        ) : (
                          diff.map((d) => (
                            <div key={d.key}>
                              <strong>{d.label}</strong>: {fmtHistVal(d.before)} → {fmtHistVal(d.after)}
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        <button type="button" disabled={busy} aria-label={`${name} ${fmtHistTime(e.changed_at)} 이 학생만 되돌리기`} onClick={() => void restoreOne(e)}>
                          이 학생만
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          title="이 시각 직전 상태로 이 주차의 모든 학생을 되돌립니다"
                          aria-label={`${fmtHistTime(e.changed_at)} 이전으로 전체 되돌리기`}
                          onClick={() => void restoreUpTo(e)}
                        >
                          이 시각 이전으로 전체
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

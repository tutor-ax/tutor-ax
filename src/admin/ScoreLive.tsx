import { useRef, useState } from "react";
import { AdminConflict, type AdminWeek, type RosterClass, type RosterStudent } from "../adminApi";
import { activeItems, isBelowCut, normalizeItemConfig, type Item, type ScoreRow } from "../domain";
import { changedFields, fieldsOf, overMax, payloadValue, total, withCarry, type Fields, type SheetRow } from "../scoreSheet";
import { sortByTestDate } from "../weekDates";
import { groupPicks, groupStats, movedFrom, nextItemKey, weekLabel } from "../weekGroup";
import { useLivePanel } from "./useLivePanel";

type CfgRow = { key: string; label: string; max: string; cut: string; active: boolean };
const BASE_KEYS = ["word_score", "reading_score", "mc_score", "item4_score"];
const toRows = (its: Item[]): CfgRow[] => its.map((i) => ({ ...i, max: i.max == null ? "" : String(i.max), cut: i.cut == null ? "" : String(i.cut) }));
const num = (s: string) => (s.trim() === "" ? null : parseFloat(s));
const fromRows = (rows: CfgRow[]): Item[] => rows.map((r) => ({ ...r, label: r.label.trim(), max: num(r.max), cut: num(r.cut) }));
const filled = (v: unknown) => v != null && String(v).trim() !== "";

const SCALAR_LABELS: Record<string, string> = { attendance: "출석", homework_rate: "과제%", homework_eval: "과제평가", clinic_memo: "클리닉메모" };
// 이전 주차 과제 값 이어오기에 쓰는 최대 주차 수(서버 점수 조회 한도 24 - 이번 주차).
const CARRY_WEEKS = 23;

// 실제 DB 점수 입력. score-system 점수 입력 탭처럼 칸에서 벗어나면 그 학생의 바뀐 칸만 저장한다.
// 주차 메모·과제 없음·항목 설정·비교 그룹도 여기서 한다. 다른 반 학생 입력, 반 이동은 아직 score-system에서 한다.
export default function ScoreLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [classId, setClassId] = useState("");
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [weekId, setWeekId] = useState("");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Record<number, string>>({});
  const [, setTick] = useState(0);
  const [memo, setMemo] = useState("");
  const [noHomework, setNoHomework] = useState(false);
  const [cfg, setCfg] = useState<CfgRow[]>([]);
  const [cutAll, setCutAll] = useState(false);
  const [group, setGroup] = useState<{ all: AdminWeek[]; weeks: AdminWeek[]; rows: ScoreRow[] } | "error" | null>(null);
  const [picks, setPicks] = useState<Record<number, { on: boolean; weekId: number }> | null>(null);
  const base = useRef<Record<number, Fields>>({});
  const screen = useRef<Record<number, Fields>>({});
  const chains = useRef<Record<number, Promise<void>>>({});
  const loadSeq = useRef(0);
  const { api, signedIn, busy, error, setError, notice, run, login } = useLivePanel(fetchImpl, {
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

  // 주차를 열 때마다 주차 목록(메모·항목 설정·그룹)도 새로 읽는다. 다른 곳에서 바꾼 설정 위에 저장하지 않도록.
  const load = async (wid: string) => {
    await flush(); // 방금 입력한 칸이 저장된 뒤에 다른 주차를 읽는다
    const seq = ++loadSeq.current;
    const list = sortByTestDate(await api.weeks(Number(classId)));
    setWeeks(list);
    const idx = list.findIndex((w) => w.id === Number(wid));
    if (idx < 0) return setWeekId("");
    const week = list[idx];
    const prevIds = list.slice(idx + 1, idx + 1 + CARRY_WEEKS).map((w) => w.id);
    const [rows, roster] = await Promise.all([
      api.scores([Number(wid), ...prevIds]) as unknown as Promise<SheetRow[]>,
      api.rosterStudents(Number(classId)),
    ]);
    const its = activeItems(week);
    const mine = rows.filter((r) => r.week_id === Number(wid));
    const prev = rows.filter((r) => r.week_id !== Number(wid)).sort((a, b) => prevIds.indexOf(a.week_id) - prevIds.indexOf(b.week_id));
    const noHw = mine.some((r) => r.no_homework === true); // 한 줄이라도 과제 없음이면 그 주차는 과제 없음
    const active = roster.filter((s) => s.is_active);
    base.current = {};
    screen.current = {};
    for (const s of active) {
      const row = mine.find((r) => Number(r.student_id) === s.id);
      base.current[s.id] = fieldsOf(row, its);
      screen.current[s.id] = withCarry(base.current[s.id], row, prev, s.id);
      if (noHw) screen.current[s.id].homework_rate = null;
    }
    setItems(its);
    setMemo(week.memo ?? "");
    setNoHomework(noHw);
    setCfg(toRows(normalizeItemConfig(week.item_config)));
    setPicks(null);
    setStatus({});
    setStudents(active);
    void refreshGroup(week, seq);
  };

  // score-system처럼 그룹 평균은 따로 읽고, 실패해도 점수 입력은 막지 않는다.
  const refreshGroup = async (week: AdminWeek, seq: number) => {
    setGroup(null);
    try {
      const all = await api.allWeeks();
      const gw = all.filter((w) => (week.group_id ? w.group_id === week.group_id : w.id === week.id));
      const rows = gw.length ? await api.scores(gw.map((w) => w.id)) : [];
      if (seq === loadSeq.current) setGroup({ all, weeks: gw, rows });
    } catch {
      if (seq === loadSeq.current) setGroup("error");
    }
  };

  const pickWeek = (wid: string) => {
    setWeekId(wid);
    setStudents([]);
    if (wid) void run(() => load(wid));
  };

  const week = weeks.find((w) => w.id === Number(weekId));
  // 주차 도구가 409를 받으면 최신 값으로 다시 연다.
  const tool = (task: () => Promise<void>, done: string) =>
    run(async () => {
      try {
        await task();
      } catch (e) {
        if (e instanceof AdminConflict) await load(weekId).catch(() => {});
        throw e;
      }
    }, done);

  const saveMemo = () => {
    if (!week || memo.trim() === (week.memo ?? "").trim()) return;
    void tool(async () => {
      await api.saveMemo(week.id, week.memo ?? "", memo);
      setWeeks((ws) => ws.map((w) => (w.id === week.id ? { ...w, memo: memo.trim() } : w)));
      setMemo(memo.trim());
    }, "과제 내용을 저장했습니다.");
  };

  const toggleNoHomework = (want: boolean) => {
    const n = students.filter((s) => filled(screen.current[s.id]?.homework_rate)).length;
    if (want && n && !confirm(`이번 주 과제 없음으로 바꾸면 입력된 과제% ${n}건이 지워집니다.\n계속할까요?`)) return;
    void tool(async () => {
      await flush();
      await api.setNoHomework(Number(weekId), want);
      setNoHomework(want);
      if (want) {
        for (const s of students) {
          base.current[s.id] = { ...base.current[s.id], homework_rate: null };
          screen.current[s.id] = { ...screen.current[s.id], homework_rate: null };
        }
      }
    }, want ? "이번 주 과제 없음으로 저장했습니다." : "과제 없음을 해제했습니다.");
  };

  const editCfg = (key: string, patch: Partial<CfgRow>) => setCfg((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const saveItemConfig = () => {
    if (!week) return;
    const its = fromRows(cfg);
    if (!its.some((i) => i.active)) return setError("최소 한 개 항목은 사용해야 합니다.");
    const noName = its.flatMap((i, n) => (i.active && !i.label ? [`${n + 1}번째`] : []));
    if (noName.length) return setError(`${noName.join(", ")} 항목의 이름을 입력하세요.`);
    const n = group && group !== "error" ? group.weeks.length : 1;
    void tool(
      async () => {
        await flush();
        await api.saveItemConfig(week.id, { before: week.item_config ?? null, group_id: week.group_id ?? null, cut_all: cutAll, items: its });
        await load(weekId);
      },
      week.group_id && n > 1
        ? cutAll
          ? `항목 설정을 저장했습니다. (커트라인 포함 비교 그룹 ${n}개 반 공통 적용)`
          : `항목 설정을 저장했습니다. (항목·만점은 ${n}개 반 공통, 커트라인은 이 반만)`
        : "항목 설정을 저장했습니다.",
    );
  };

  const nameOf = (w: AdminWeek) => classes.find((c) => c.id === w.class_id)?.name ?? `반 #${w.class_id}`;
  const all = group && group !== "error" ? group.all : [];
  const byClass = new Map(classes.map((c) => [c.id, sortByTestDate(all.filter((w) => w.class_id === c.id))]));
  // 편집 중인 주차가 맨 앞, 나머지는 반 순서대로.
  const picked = picks
    ? [Number(weekId), ...classes.filter((c) => c.id !== Number(classId) && picks[c.id]?.on).map((c) => picks[c.id].weekId)]
    : [];
  const pickedWeeks = picked.map((id) => all.find((w) => w.id === id)).filter((w): w is AdminWeek => !!w);
  const moved = picks && week ? movedFrom(all, picked, week.group_id).map((m) => `${nameOf(m.week)}(현재 다른 그룹 ${m.size}개 반)`) : [];

  const saveGroup = () => {
    if (!week) return;
    const names = pickedWeeks.map((w) => ` · ${nameOf(w)} ${weekLabel(w)}`).join("\n");
    const out = moved.length ? `\n⚠️ ${moved.join(", ")}은(는) 기존 비교 그룹에서 빠집니다.\n` : "";
    const msg = `이 주차의 비교 그룹을 ${picked.length}개 반으로 설정합니다.\n${names}\n\n이 반들은 같은 평균·석차를 공유합니다.\n포함된 모든 반의 학부모가 합산된 평균을 보게 됩니다.\n${out}\n계속할까요?`;
    if (!confirm(msg)) return;
    const before = Object.fromEntries(picked.map((id) => [id, all.find((w) => w.id === id)?.group_id ?? null]));
    void tool(async () => {
      await api.saveGroup(week.id, picked, before);
      await load(weekId);
    }, `비교 그룹이 ${picked.length}개 반으로 설정됐습니다.`);
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
        no_homework: noHomework, // 아직 줄이 없는 주차는 첫 줄이 이 값을 가져가야 과제 없음이 남는다
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

  const openGroupEdit = () =>
    void run(async () => {
      if (!week) return;
      const fresh = await api.allWeeks();
      setGroup((g) => (g && g !== "error" ? { ...g, all: fresh } : { all: fresh, weeks: [], rows: [] }));
      const map = new Map(classes.map((c) => [c.id, sortByTestDate(fresh.filter((w) => w.class_id === c.id))]));
      setPicks(groupPicks(map, fresh.find((w) => w.id === week.id) ?? week, Number(classId)));
    });

  if (!signedIn) return login("실제 DB 점수 입력");

  const str = (v: unknown) => (v == null ? "" : String(v));
  const cfgActive = cfg.filter((r) => r.active);
  const stats =
    group && group !== "error" && week && group.weeks.length
      ? groupStats(group.weeks, group.rows, normalizeItemConfig(week.item_config), nameOf)
      : null;
  const tools = week && students.length > 0 && (
    <>
      <label>
        이번 주 과제 내용
        <textarea rows={2} value={memo} placeholder="예: 워크북 p.30~35, 단어 암기 1~30번" onChange={(e) => setMemo(e.target.value)} onBlur={saveMemo} />
      </label>
      <label title="체크하면 학부모 화면에서 과제 수행률과 과제 안내가 표시되지 않습니다">
        <input type="checkbox" checked={noHomework} disabled={busy} onChange={(e) => toggleNoHomework(e.target.checked)} />
        이번 주 과제 없음
      </label>
      <details open>
        <summary>이번 주 채점 항목 설정 (항목명·만점·커트라인)</summary>
        <table aria-label="항목 설정">
          <thead>
            <tr>
              <th>사용</th>
              <th>항목 이름</th>
              <th>만점</th>
              <th>커트라인</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cfg.map((r, n) => (
              <tr key={r.key}>
                <td>
                  <input type="checkbox" aria-label={`${n + 1}번째 항목 사용`} checked={r.active} onChange={(e) => editCfg(r.key, { active: e.target.checked })} />
                </td>
                <td>
                  <input aria-label={`${n + 1}번째 항목 이름`} placeholder={`${n + 1}번째 항목 이름 (예: 단어)`} value={r.label} onChange={(e) => editCfg(r.key, { label: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} aria-label={`${n + 1}번째 항목 만점`} value={r.max} onChange={(e) => editCfg(r.key, { max: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} aria-label={`${n + 1}번째 항목 커트라인`} value={r.cut} onChange={(e) => editCfg(r.key, { cut: e.target.value })} />
                </td>
                <td>
                  {/* 기본 4칸은 DB 열과 1:1이라 끌 수만 있다 */}
                  {!BASE_KEYS.includes(r.key) && (
                    <button type="button" aria-label={`${n + 1}번째 항목 삭제`} onClick={() => setCfg((rows) => rows.filter((x) => x.key !== r.key))}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => setCfg((rows) => [...rows, { key: nextItemKey(rows), label: "", max: "", cut: "", active: true }])}>
          + 항목 추가
        </button>
        <p>항목을 삭제해도 이미 저장된 점수는 지워지지 않아요. 같은 항목을 다시 추가하면 그대로 되살아납니다.</p>
        <button type="button" disabled={busy} onClick={saveItemConfig}>
          항목 설정 저장
        </button>
      </details>
      <p>
        사용 항목 {cfgActive.length}개 · 총점 만점 {cfgActive.reduce((a, r) => a + (num(r.max) || 0), 0)}점
      </p>
      {week.group_id && group && group !== "error" && group.weeks.length > 1 && (
        <label>
          <input type="checkbox" checked={cutAll} onChange={(e) => setCutAll(e.target.checked)} />
          커트라인도 비교 그룹의 모든 반에 똑같이 적용 (끄면 항목·만점만 함께 바뀌고 커트라인은 이 반에만 저장됩니다)
        </label>
      )}
      {group === "error" && <p>비교 그룹 평균을 불러오지 못했습니다.</p>}
      {stats && group && group !== "error" && (
        <div aria-label="비교 그룹">
          <p>
            비교 그룹 {group.weeks.length}개 반 ({group.weeks.map(nameOf).join(", ")}) · 그룹 평균{" "}
            {stats.avg === null ? "–" : `${stats.avg}점 / ${stats.totalMax}점`} · 표본 {stats.count}명 — 학부모 화면에 이 값이 표시됩니다.
          </p>
          {stats.cutLines.length > 0 && <p>반별 커트라인: {stats.cutLines.join(" · ")}</p>}
          {!week.group_id && <p>이 주차는 비교 그룹(group_id)이 없어 이 반만으로 평균이 계산됩니다.</p>}
          {stats.mismatched.length > 0 && (
            <p>
              ⚠️ 항목 구성(활성 항목·만점)이 다른 반: {stats.mismatched.join(", ")} — [항목 설정 저장]을 누르면 그룹 전체의 항목·만점이 현재
              설정으로 통일됩니다.
            </p>
          )}
        </div>
      )}
      {!picks ? (
        <button type="button" disabled={busy} onClick={openGroupEdit}>
          비교 그룹 수정
        </button>
      ) : (
        <fieldset aria-label="비교 그룹 수정">
          <legend>이 주차의 평균을 함께 낼 반 선택 — 체크한 반들이 하나의 비교 그룹이 됩니다</legend>
          {classes.map((c) => {
            const ofClass = byClass.get(c.id) ?? [];
            const p = picks[c.id];
            const cur = c.id === Number(classId);
            if (!ofClass.length || !p)
              return (
                <label key={c.id}>
                  <input type="checkbox" disabled />
                  {c.name} 주차 없음
                </label>
              );
            return (
              <div key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={p.on}
                    disabled={cur}
                    onChange={(e) => setPicks({ ...picks, [c.id]: { ...p, on: e.target.checked } })}
                  />
                  {c.name}
                  {cur && " (현재)"}
                </label>
                <select
                  aria-label={`${c.name} 주차`}
                  value={p.weekId}
                  disabled={cur}
                  onChange={(e) => setPicks({ ...picks, [c.id]: { ...p, weekId: Number(e.target.value) } })}
                >
                  {ofClass.map((w) => (
                    <option key={w.id} value={w.id}>
                      {weekLabel(w) || `#${w.id}`}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <p>
            비교 그룹 {picked.length}개 반 — {pickedWeeks.map((w) => `${nameOf(w)} ${weekLabel(w)}`).join(" · ")}
          </p>
          <p>이 반들은 같은 평균·석차를 공유합니다. 포함된 모든 반의 학부모가 합산된 평균을 보게 됩니다.</p>
          {moved.length > 0 && <p>⚠️ {moved.join(", ")}은 기존 그룹에서 빠져 이 그룹으로 옮겨집니다.</p>}
          <button type="button" disabled={busy} onClick={saveGroup}>
            비교 그룹 저장
          </button>
          <button type="button" onClick={() => setPicks(null)}>
            취소
          </button>
        </fieldset>
      )}
    </>
  );
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
      {tools}
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
                      disabled={noHomework}
                      value={noHomework ? "" : str(sc.homework_rate)}
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
      <p>다른 반 학생 입력, 반 이동은 아직 score-system에서 합니다.</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

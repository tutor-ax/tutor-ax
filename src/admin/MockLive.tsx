import { useRef, useState } from "react";
import { AdminConflict, type AdminWeek, type RosterClass, type RosterStudent } from "../adminApi";
import { activeItems, isBelowCut, MOCK_ITEMS, mockTotal, normalizeItemConfig, type Item, type ScoreRow } from "../domain";
import { blank, changedFields, mockFieldsOf, overMax, payloadValue, SCALAR_LABELS, total, type Fields } from "../scoreSheet";
import { fmtMD, resolveBaseDate, sortByTestDate } from "../weekDates";
import { groupStats } from "../weekGroup";
import GroupEditor from "./GroupEditor";
import ItemConfigEditor, { cfgError, fromRows, toRows, type CfgRow } from "./ItemConfigEditor";
import { useLivePanel } from "./useLivePanel";

const MOCK_KEYS = MOCK_ITEMS.map((i) => i.key);

// 실제 DB 모의고사. score-system 모의고사 탭의 추가·항목 설정·비교 그룹·점수 입력(미응시 포함). 분석지(PDF)는 보류.
// 점수는 점수 입력 탭처럼 칸에서 벗어나면 그 학생의 바뀐 칸만 저장한다.
export default function MockLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newClasses, setNewClasses] = useState<number[]>([]);
  const [classId, setClassId] = useState("");
  const [exams, setExams] = useState<AdminWeek[]>([]);
  const [examId, setExamId] = useState("");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Record<number, string>>({});
  const [, setTick] = useState(0);
  const [cfg, setCfg] = useState<CfgRow[]>([]);
  const [cutAll, setCutAll] = useState(false);
  const [group, setGroup] = useState<{ exams: AdminWeek[]; rows: ScoreRow[] } | "error" | null>(null);
  const base = useRef<Record<number, Fields>>({});
  const screen = useRef<Record<number, Fields>>({});
  const chains = useRef<Record<number, Promise<void>>>({});
  const loadSeq = useRef(0);
  const { api, signedIn, busy, error, setError, notice, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => setClasses(await a.rosterClasses()),
    invalidMessage: "점수는 0 이상 숫자로, 날짜는 11.16 형식으로 입력하세요.",
  });

  const labelOf = (k: string) => {
    const it = items.find((i) => k.endsWith(`:${i.key}`));
    return SCALAR_LABELS[k] ?? (k.startsWith("retest:") ? `${it?.label ?? "항목"} 재시험` : (it?.label ?? "항목"));
  };
  const mark = (sid: number, s: string) => setStatus((prev) => ({ ...prev, [sid]: s }));
  const flush = () => Promise.all(Object.values(chains.current));
  const nameOf = (e: AdminWeek) => classes.find((c) => c.id === e.class_id)?.name ?? `반 #${e.class_id}`;

  const reloadExams = async (cid: string) => setExams(sortByTestDate(await api.mockExams(Number(cid))));

  const pickClass = (cid: string) => {
    setClassId(cid);
    setExamId("");
    setExams([]);
    setStudents([]);
    if (cid) void run(() => reloadExams(cid));
  };

  // 시험을 열 때마다 목록(항목 설정·그룹)도 새로 읽는다. 다른 곳에서 바꾼 설정 위에 저장하지 않도록.
  const load = async (eid: string) => {
    await flush();
    const seq = ++loadSeq.current;
    const list = sortByTestDate(await api.mockExams(Number(classId)));
    setExams(list);
    const exam = list.find((e) => e.id === Number(eid));
    if (!exam) return setExamId("");
    const [rows, roster] = await Promise.all([api.mockScores([exam.id]), api.rosterStudents(Number(classId))]);
    const its = activeItems(exam, true);
    const active = roster.filter((s) => s.is_active);
    base.current = {};
    screen.current = {};
    for (const s of active) {
      base.current[s.id] = mockFieldsOf(
        rows.find((r) => Number(r.student_id) === s.id),
        its,
      );
      screen.current[s.id] = { ...base.current[s.id] };
    }
    setItems(its);
    setCfg(toRows(normalizeItemConfig(exam.item_config, MOCK_ITEMS)));
    setStatus({});
    setStudents(active);
    void refreshGroup(exam, seq);
  };

  // score-system처럼 그룹 평균은 따로 읽고, 실패해도 점수 입력은 막지 않는다.
  const refreshGroup = async (exam: AdminWeek, seq: number) => {
    setGroup(null);
    try {
      const all = await api.allMockExams();
      const ge = all.filter((e) => (exam.group_id ? e.group_id === exam.group_id : e.id === exam.id));
      const rows = ge.length ? await api.mockScores(ge.map((e) => e.id)) : [];
      if (seq === loadSeq.current) setGroup({ exams: ge, rows });
    } catch {
      if (seq === loadSeq.current) setGroup("error");
    }
  };

  const pickExam = (eid: string) => {
    setExamId(eid);
    setStudents([]);
    if (eid) void run(() => load(eid));
  };

  const exam = exams.find((e) => e.id === Number(examId));
  const tool = (task: () => Promise<void>, done: string) =>
    run(async () => {
      try {
        await task();
      } catch (e) {
        if (e instanceof AdminConflict) await load(examId).catch(() => {});
        throw e;
      }
    }, done);

  const addExam = () => {
    const d = resolveBaseDate(newDate);
    // 주차 추가와 같은 검사. 'M.D'가 아니면 성적 발송 드롭다운이 날짜를 못 읽는다.
    if (!d) return setError("날짜 형식이 올바르지 않습니다. (예: 6.10)");
    if (!newClasses.length) return setError("평균을 함께 낼 반을 한 개 이상 체크해주세요.");
    const n = newClasses.length;
    void run(async () => {
      await api.addMockExams(fmtMD(d), newLabel.trim(), classes.filter((c) => newClasses.includes(c.id)).map((c) => c.id));
      setNewDate("");
      setNewLabel("");
      setNewClasses([]);
      if (classId) await reloadExams(classId);
    }, `모의고사가 추가됐습니다. (${n}개 반 공통 그룹)`);
  };

  const saveItemConfig = () => {
    if (!exam) return;
    const its = fromRows(cfg);
    const invalid = cfgError(its);
    if (invalid) return setError(invalid);
    const n = group && group !== "error" ? group.exams.length : 1;
    void tool(
      async () => {
        await flush();
        await api.saveMockItemConfig(exam.id, { before: exam.item_config ?? null, group_id: exam.group_id ?? null, cut_all: cutAll, items: its });
        await load(examId);
      },
      exam.group_id && n > 1
        ? cutAll
          ? `항목 설정을 저장했습니다. (커트라인 포함 비교 그룹 ${n}개 반 공통 적용)`
          : `항목 설정을 저장했습니다. (항목·만점은 ${n}개 반 공통, 커트라인은 이 반만)`
        : "항목 설정을 저장했습니다.",
    );
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
      await api.saveMockScore({
        exam_id: Number(examId),
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

  const save = (sid: number) => {
    chains.current[sid] = (chains.current[sid] ?? Promise.resolve()).then(() => run(() => saveNow(sid)));
  };

  const edit = (sid: number, k: string, v: unknown) => {
    const next = { ...screen.current[sid], [k]: v };
    const it = items.find((i) => k === `score:${i.key}`);
    if (it && !isBelowCut(v as number, it.cut)) next[`retest:${it.key}`] = false;
    // 미응시 = 점수 없음. 점수와 미응시가 함께 남지 않게 칸을 비운다(score-system applyMockAbsentState).
    if (k === "absent" && v === true)
      for (const i of items) {
        next[`score:${i.key}`] = null;
        next[`retest:${i.key}`] = false;
      }
    screen.current[sid] = next;
    setTick((t) => t + 1);
  };

  const setAllAbsent = (on: boolean) => {
    if (on && !confirm("이 반 전원을 미응시로 표시합니다.\n입력된 점수는 지워집니다. 계속할까요?")) return;
    for (const s of students) {
      edit(s.id, "absent", on);
      save(s.id);
    }
  };

  if (!signedIn) return login("실제 DB 모의고사");

  const str = (v: unknown) => (v == null ? "" : String(v));
  const stats =
    group && group !== "error" && exam && group.exams.length
      ? groupStats(group.exams, group.rows, normalizeItemConfig(exam.item_config, MOCK_ITEMS), nameOf, MOCK_ITEMS, mockTotal)
      : null;
  const absentN = students.filter((s) => screen.current[s.id]?.absent === true).length;
  const scoredN = students.filter((s) => screen.current[s.id]?.absent !== true && items.some((i) => !blank(screen.current[s.id]?.[`score:${i.key}`]))).length;
  const hiddenN = students.length - absentN - scoredN;
  const addDate = newDate.trim() ? resolveBaseDate(newDate) : null;

  return (
    <section aria-label="실제 DB 모의고사">
      <h3>실제 DB</h3>
      <p>실제 학원 기록입니다. 칸에서 벗어나면 그 학생의 바뀐 칸만 바로 저장됩니다. 분석지(PDF) 올리기는 아직 score-system에서 합니다.</p>
      <fieldset aria-label="실제 모의고사 추가">
        <legend>모의고사 추가 — 체크한 반들이 하나의 비교 그룹으로 평균을 냅니다</legend>
        {classes.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={newClasses.includes(c.id)}
              onChange={(e) => setNewClasses(e.target.checked ? [...newClasses, c.id] : newClasses.filter((id) => id !== c.id))}
            />
            {c.name}
          </label>
        ))}
        <label>
          시험 날짜
          <input placeholder="6.10" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </label>
        <label>
          모의고사 이름
          <input placeholder="비우면 날짜" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={addExam}>
          실제 모의고사 추가
        </button>
        {addDate && newClasses.length > 0 && (
          <p>
            {fmtMD(addDate)} · 선택된 반 {newClasses.length}개 — 하나의 비교 그룹으로 평균이 계산됩니다.
          </p>
        )}
      </fieldset>
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
          실제 모의고사 선택
          <select value={examId} disabled={busy} onChange={(e) => pickExam(e.target.value)}>
            <option value="">모의고사를 선택하세요</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label || e.exam_date}
              </option>
            ))}
          </select>
        </label>
      )}
      {exam && students.length > 0 && (
        <>
          <ItemConfigEditor title="이 시험의 채점 항목 설정 (항목명·만점·커트라인)" example="듣기" baseKeys={MOCK_KEYS} cfg={cfg} setCfg={setCfg} busy={busy} onSave={saveItemConfig} />
          {exam.group_id && group && group !== "error" && group.exams.length > 1 && (
            <label>
              <input type="checkbox" checked={cutAll} onChange={(e) => setCutAll(e.target.checked)} />
              커트라인도 비교 그룹의 모든 반에 똑같이 적용 (끄면 항목·만점만 함께 바뀌고 커트라인은 이 반에만 저장됩니다)
            </label>
          )}
          {group === "error" && <p>비교 그룹 평균을 불러오지 못했습니다.</p>}
          {stats && group && group !== "error" && (
            <div aria-label="비교 그룹">
              <p>
                비교 그룹 {group.exams.length}개 반 ({group.exams.map(nameOf).join(", ")}) · 그룹 평균{" "}
                {stats.avg === null ? "–" : `${stats.avg}점 / ${stats.totalMax}점`} · 표본 {stats.count}명 — 학부모 화면에 이 값이 표시됩니다.
              </p>
              {stats.cutLines.length > 0 && <p>반별 커트라인: {stats.cutLines.join(" · ")}</p>}
              {!exam.group_id && <p>이 모의고사는 비교 그룹(group_id)이 없어 이 반만으로 평균이 계산됩니다.</p>}
              {stats.mismatched.length > 0 && (
                <p>
                  ⚠️ 항목 구성(활성 항목·만점)이 다른 반: {stats.mismatched.join(", ")} — [항목 설정 저장]을 누르면 그룹 전체의 항목·만점이 현재
                  설정으로 통일됩니다.
                </p>
              )}
            </div>
          )}
          <GroupEditor
            key={exam.id}
            unit="모의고사"
            classes={classes}
            classId={Number(classId)}
            current={exam}
            busy={busy}
            run={tool}
            fetchAll={api.allMockExams}
            save={async (ids, before) => {
              await api.saveMockGroup(exam.id, ids, before);
              await load(examId);
            }}
          />
          <p aria-label="학부모 공개 현황">
            학부모에게 보이는 학생 {scoredN + absentN}명 (점수 {scoredN}명 · 미응시 {absentN}명) / 전체 {students.length}명
            {hiddenN > 0 && ` · ${hiddenN}명은 이 시험이 보이지 않습니다`}
          </p>
          <button type="button" disabled={busy} onClick={() => setAllAbsent(true)}>
            전원 미응시
          </button>
          <button type="button" disabled={busy} onClick={() => setAllAbsent(false)}>
            전원 미응시 해제
          </button>
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>총점 /{items.reduce((a, i) => a + (i.max ?? 0), 0)}</th>
                <th>미응시</th>
                {items.map((i) => (
                  <th key={i.key}>
                    {i.label || "-"} /{i.max ?? ""}
                  </th>
                ))}
                <th>메모</th>
                <th>저장</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const sc = screen.current[s.id];
                const absent = sc.absent === true;
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{absent ? "미응시" : (total(sc, items) ?? "")}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${s.name} 미응시`}
                        title="봐야 했는데 안 본 학생"
                        checked={absent}
                        onChange={(e) => {
                          edit(s.id, "absent", e.target.checked);
                          save(s.id);
                        }}
                      />
                    </td>
                    {items.map((i) => {
                      const v = sc[`score:${i.key}`];
                      const below = !absent && isBelowCut(v as number, i.cut);
                      return (
                        <td key={i.key}>
                          <input
                            type="number"
                            min={0}
                            max={i.max ?? undefined}
                            aria-label={`${s.name} ${i.label}`}
                            aria-invalid={i.max != null && !blank(v) && Number(v) > i.max}
                            disabled={absent}
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
                        aria-label={`${s.name} 메모`}
                        value={str(sc.memo)}
                        onChange={(e) => edit(s.id, "memo", e.target.value)}
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
        </>
      )}
      {examId && !busy && students.length === 0 && <p>이 반에 재원 중인 학생이 없습니다.</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

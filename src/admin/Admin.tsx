import { useEffect, useState } from "react";
import "./admin.css";

type Student = { id: string; name: string };
type ClassRoom = {
  id: string;
  name: string;
  students: Student[];
  exams?: Week[];
};
type Item = { id: string; name: string; max: number; cut: number };
type Mark = { score: string; passed: boolean };
type Clinic = { memo: string; day: string; time: string };
type Tracking = { attendance: boolean; rate: string; evaluation: string };
type Week = {
  tracking?: Record<string, Tracking>;
  date?: string;
  absent?: Record<string, boolean>;
  examMemos?: Record<string, string>;
  clinic?: Record<string, Clinic>;
  id: string;
  name: string;
  items: Item[];
  marks: Record<string, Record<string, Mark>>;
};
const baseItems = (): Item[] => [
  { id: "words", name: "단어", max: 100, cut: 80 },
  { id: "reading", name: "독해", max: 100, cut: 70 },
];
const id = () => crypto.randomUUID();
const seed = (): ClassRoom[] => [
  {
    id: "demo-a",
    name: "데모 A",
    students: [
      { id: "student-a", name: "가상 학생 A" },
      { id: "student-b", name: "가상 학생 B" },
    ],
  },
];
const STORAGE_KEY = "tutor-ax:admin:v1";
type TeacherMemo = {
  id: string;
  author: string;
  content: string;
  time: string;
};
type Snapshot = {
  classes: ClassRoom[];
  weeks: Record<string, Week[]>;
  memos?: TeacherMemo[];
};
type Entry = Snapshot & { id: string; time: string };
const fresh = (): Snapshot => ({
  classes: seed(),
  weeks: {
    "demo-a": [{ id: "week-1", name: "1주차", items: baseItems(), marks: {} }],
  },
});
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
function validSnapshot(v: unknown): v is Snapshot {
  if (!object(v) || !Array.isArray(v.classes) || !object(v.weeks)) return false;
  return (
    (v.memos === undefined ||
      (Array.isArray(v.memos) &&
        v.memos.every(
          (m) =>
            object(m) &&
            text(m.id) &&
            text(m.author) &&
            text(m.content) &&
            text(m.time),
        ))) &&
    v.classes.every(
      (c) =>
        object(c) &&
        text(c.id) &&
        text(c.name) &&
        (c.exams === undefined ||
          validSnapshot({ classes: [], weeks: { exams: c.exams } })) &&
        Array.isArray(c.students) &&
        c.students.every((s) => object(s) && text(s.id) && text(s.name)),
    ) &&
    Object.values(v.weeks).every(
      (ws) =>
        Array.isArray(ws) &&
        ws.every(
          (w) =>
            object(w) &&
            text(w.id) &&
            text(w.name) &&
            (w.date === undefined || text(w.date)) &&
            (w.tracking === undefined ||
              (object(w.tracking) &&
                Object.values(w.tracking).every(
                  (t) =>
                    object(t) &&
                    typeof t.attendance === "boolean" &&
                    text(t.rate) &&
                    (t.rate === "" || Number.isFinite(Number(t.rate))) &&
                    text(t.evaluation),
                ))) &&
            (w.absent === undefined ||
              (object(w.absent) &&
                Object.values(w.absent).every(
                  (x) => typeof x === "boolean",
                ))) &&
            (w.examMemos === undefined ||
              (object(w.examMemos) &&
                Object.values(w.examMemos).every(text))) &&
            Array.isArray(w.items) &&
            w.items.every(
              (i) =>
                object(i) &&
                text(i.id) &&
                text(i.name) &&
                typeof i.max === "number" &&
                Number.isFinite(i.max) &&
                typeof i.cut === "number" &&
                Number.isFinite(i.cut),
            ) &&
            object(w.marks) &&
            Object.values(w.marks).every(
              (m) =>
                object(m) &&
                Object.values(m).every(
                  (x) =>
                    object(x) &&
                    text(x.score) &&
                    (x.score === "" || Number.isFinite(Number(x.score))) &&
                    typeof x.passed === "boolean",
                ),
            ) &&
            (w.clinic === undefined ||
              (object(w.clinic) &&
                Object.values(w.clinic).every(
                  (c) =>
                    object(c) && text(c.memo) && text(c.day) && text(c.time),
                ))),
        ),
    )
  );
}
function load(): Snapshot & { history: Entry[]; preserve?: boolean } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (
      object(v) &&
      v.version === 1 &&
      Array.isArray(v.history) &&
      v.history.every(
        (e: unknown) =>
          object(e) && text(e.id) && text(e.time) && validSnapshot(e),
      ) &&
      validSnapshot(v)
    )
      return { ...v, history: (v as Snapshot & { history: Entry[] }).history };
  } catch {
    /* Private mode, corrupt JSON, or denied storage: use in-memory demo. */
  }
  return { ...fresh(), history: [], preserve: raw !== null };
}
export default function Admin({ onExit }: { onExit?: () => void }) {
  const [initial] = useState(load);
  const [preserveStorage, setPreserveStorage] = useState(
    initial.preserve ?? false,
  );
  const [classes, setClasses] = useState(initial.classes);
  const [history, setHistory] = useState(initial.history);
  const [memos, setMemos] = useState(initial.memos ?? []);
  const [memoAuthor, setMemoAuthor] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [memoError, setMemoError] = useState(false);
  const [deleteMemo, setDeleteMemo] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [selected, setSelected] = useState(initial.classes[0]?.id ?? "");
  const [tab, setTab] = useState("점수 입력");
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [student, setStudent] = useState("");
  const [moving, setMoving] = useState<{ sid: string; from: string } | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState("");
  const [weeks, setWeeks] = useState(initial.weeks);
  useEffect(() => {
    if (preserveStorage) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, classes, weeks, history, memos }),
      );
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [classes, weeks, history, memos, preserveStorage]);
  const [weekId, setWeekId] = useState("week-1");
  const [weekName, setWeekName] = useState("");
  const [itemName, setItemName] = useState("");
  const [examId, setExamId] = useState("");
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState("");
  const mock = tab === "모의고사";
  const current = classes.find((c) => c.id === selected);
  const classWeeks = mock ? (current?.exams ?? []) : (weeks[selected] ?? []);
  const week =
    classWeeks.find((w) => w.id === (mock ? examId : weekId)) ?? classWeeks[0];
  const updateWeek = (next: Week) =>
    mock
      ? setClasses(
          classes.map((c) =>
            c.id === selected
              ? {
                  ...c,
                  exams: classWeeks.map((w) => (w.id === next.id ? next : w)),
                }
              : c,
          ),
        )
      : setWeeks({
          ...weeks,
          [selected]: classWeeks.map((w) => (w.id === next.id ? next : w)),
        });
  const mark = (sid: string, iid: string): Mark =>
    week?.marks[sid]?.[iid] ?? { score: "", passed: false };
  const setMark = (sid: string, iid: string, next: Mark) => {
    if (week)
      updateWeek({
        ...week,
        marks: { ...week.marks, [sid]: { ...week.marks[sid], [iid]: next } },
      });
  };
  const invalid = week?.items.some(
    (i) =>
      i.max <= 0 ||
      i.cut < 0 ||
      i.cut > i.max ||
      Object.values(week.marks).some(
        (m) =>
          m[i.id]?.score !== undefined &&
          m[i.id].score !== "" &&
          (Number(m[i.id].score) < 0 || Number(m[i.id].score) > i.max),
      ),
  );
  const [notice, setNotice] = useState("");
  const update = (next: ClassRoom) =>
    setClasses(classes.map((c) => (c.id === next.id ? next : c)));
  return (
    <div className="admin-app">
      <header>
        <div>
          <h1>영어 학습 관리</h1>
          <span>관리자 · 합성 데이터 데모</span>
        </div>
        {onExit && <button onClick={onExit}>나가기</button>}
      </header>
      <nav aria-label="관리 메뉴">
        {[
          "점수 입력",
          "모의고사",
          "출석·미인증",
          "조교 메모",
          "클리닉 배정표",
          "문자 미리보기",
          "변경 이력",
          "주차 관리",
          "학생 관리",
          "반 관리",
        ].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <main>
        <p>모든 정보는 가상 데이터입니다. 실제 개인정보를 입력하지 마세요.</p>
        <label>
          반 선택
          <select
            aria-label="반 선택"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {mock ? "모의고사 선택" : "주차 선택"}
          <select
            value={week?.id ?? ""}
            onChange={(e) =>
              mock ? setExamId(e.target.value) : setWeekId(e.target.value)
            }
          >
            {classWeeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <section>
          <h2>{tab}</h2>
          {tab === "조교 메모" && (
            <>
              <p>합성 조교 인계 메모 · 모든 반에서 공통으로 조회합니다.</p>
              <label>
                메모 작성자
                <input
                  value={memoAuthor}
                  onChange={(e) => setMemoAuthor(e.target.value)}
                />
              </label>
              <label>
                메모 내용
                <textarea
                  value={memoContent}
                  onChange={(e) => setMemoContent(e.target.value)}
                />
              </label>
              <button
                onClick={() => {
                  if (!memoAuthor.trim() || !memoContent.trim()) {
                    setMemoError(true);
                    return;
                  }
                  setMemos([
                    {
                      id: id(),
                      author: memoAuthor.trim(),
                      content: memoContent.trim(),
                      time: new Date().toISOString(),
                    },
                    ...memos,
                  ]);
                  setMemoContent("");
                  setMemoError(false);
                }}
              >
                메모 등록
              </button>
              {memoError && <p role="alert">작성자와 내용을 입력하세요.</p>}
              <div aria-label="메모 목록">
                {memos.length === 0 && <p>등록된 메모가 없습니다.</p>}
                {memos.map((m) => (
                  <article className="teacher-memo" key={m.id}>
                    <h3>{m.author}</h3>
                    <time dateTime={m.time}>
                      {new Date(m.time).toLocaleString("ko-KR")}
                    </time>
                    <p>{m.content}</p>
                    <button onClick={() => setDeleteMemo(m.id)}>
                      메모 삭제
                    </button>
                  </article>
                ))}
              </div>
              {deleteMemo && (
                <div role="dialog" aria-label="메모 삭제 확인">
                  <p>이 메모를 삭제할까요?</p>
                  <button
                    onClick={() => {
                      setMemos(memos.filter((m) => m.id !== deleteMemo));
                      setDeleteMemo(null);
                    }}
                  >
                    메모 삭제 확인
                  </button>
                  <button onClick={() => setDeleteMemo(null)}>삭제 취소</button>
                </div>
              )}
            </>
          )}
          {tab === "주차 관리" && current && (
            <>
              <label>
                새 주차 이름
                <input
                  value={weekName}
                  onChange={(e) => setWeekName(e.target.value)}
                />
              </label>
              <button
                onClick={() => {
                  if (!weekName.trim()) return;
                  const w = {
                    id: id(),
                    name: weekName.trim(),
                    items: baseItems(),
                    marks: {},
                  };
                  setWeeks({ ...weeks, [selected]: [...classWeeks, w] });
                  setWeekId(w.id);
                  setWeekName("");
                }}
              >
                주차 추가
              </button>
              <ul>
                {classWeeks.map((w) => (
                  <li key={w.id}>{w.name}</li>
                ))}
              </ul>
            </>
          )}
          {tab === "출석·미인증" && current && (
            <>
              <p>
                등록된 주차 기록 중 수행률 미입력 또는 79% 이하, 과제 평가가
                있는 학생을 미인증으로 분류합니다. 기록 없는 학생은 제외합니다.
              </p>
              {classWeeks.some((w) =>
                Object.values(w.tracking ?? {}).some(
                  (t) =>
                    t.rate !== "" &&
                    (Number(t.rate) < 0 || Number(t.rate) > 100),
                ),
              ) && <p role="alert">과제 수행률은 0–100 범위로 입력하세요.</p>}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>학생</th>
                      {classWeeks.map((w) => (
                        <th key={w.id}>{w.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.students.map((s) => (
                      <tr key={s.id}>
                        <th>{s.name}</th>
                        {classWeeks.map((w) => {
                          const t = w.tracking?.[s.id] ?? {
                            attendance: true,
                            rate: "",
                            evaluation: "",
                          };
                          const edit = (next: Tracking) =>
                            updateWeek({
                              ...w,
                              tracking: { ...w.tracking, [s.id]: next },
                            });
                          const label = `${s.name} ${w.name}`;
                          return (
                            <td key={w.id}>
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`${label} 출석`}
                                  checked={t.attendance}
                                  onChange={(e) =>
                                    edit({ ...t, attendance: e.target.checked })
                                  }
                                />
                                출석
                              </label>
                              <label>
                                과제 수행률
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  aria-label={`${label} 과제 수행률`}
                                  value={t.rate}
                                  onChange={(e) =>
                                    edit({ ...t, rate: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                과제 평가
                                <textarea
                                  aria-label={`${label} 과제 평가`}
                                  value={t.evaluation}
                                  onChange={(e) =>
                                    edit({ ...t, evaluation: e.target.value })
                                  }
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {classWeeks.length === 0 && (
                <p>주차 관리에서 주차를 추가하세요.</p>
              )}
              <div aria-label="미인증 명단">
                <h3>미인증 명단</h3>
                <ul>
                  {current.students
                    .filter((s) =>
                      classWeeks.some((w) => {
                        const t = w.tracking?.[s.id];
                        return (
                          t &&
                          (t.rate === "" ||
                            Number(t.rate) <= 79 ||
                            t.evaluation.trim() !== "")
                        );
                      }),
                    )
                    .map((s) => (
                      <li key={s.id}>{s.name}</li>
                    ))}
                </ul>
              </div>
            </>
          )}
          {mock && current && (
            <>
              <label>
                새 모의고사 이름
                <input
                  value={examName}
                  onChange={(e) => setExamName(e.target.value)}
                />
              </label>
              <label>
                모의고사 날짜
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                />
              </label>
              <button
                onClick={() => {
                  if (!examName.trim()) return;
                  const exam: Week = {
                    id: id(),
                    name: examName.trim(),
                    date: examDate,
                    items: baseItems(),
                    marks: {},
                  };
                  update({
                    ...current,
                    exams: [...(current.exams ?? []), exam],
                  });
                  setExamId(exam.id);
                  setExamName("");
                }}
              >
                모의고사 추가
              </button>
              <p>
                주차와 독립된 시험입니다. 미응시 시 점수·재시험 판정을 제외하며,
                해제하면 원래 입력을 복구합니다.
              </p>
              {week?.date && <p>시험 날짜: {week.date}</p>}
            </>
          )}
          {(tab === "점수 입력" || mock) &&
            current &&
            (week ? (
              <>
                <p>재시험 통과를 표시해도 최초 점수는 변경되지 않습니다.</p>
                <details open>
                  <summary>채점 항목 설정</summary>
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="채점 항목 설정 가로 스크롤"
                  >
                    <table
                      className="item-config-table"
                      aria-label="채점 항목 설정"
                    >
                      <colgroup>
                        <col className="config-name" />
                        <col />
                        <col />
                        <col className="config-action" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">항목명</th>
                          <th scope="col">만점</th>
                          <th scope="col">커트라인</th>
                          <th scope="col">관리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {week.items.map((i) => (
                          <tr className="item-config" key={i.id}>
                            <td>
                              <input
                                aria-label={`${i.name} 항목 이름`}
                                value={i.name}
                                onChange={(e) =>
                                  updateWeek({
                                    ...week,
                                    items: week.items.map((x) =>
                                      x.id === i.id
                                        ? { ...x, name: e.target.value }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            {(["max", "cut"] as const).map((k) => (
                              <td key={k}>
                                <input
                                  aria-label={`${i.name} ${k === "max" ? "만점" : "커트라인"}`}
                                  type="number"
                                  value={i[k]}
                                  onChange={(e) =>
                                    updateWeek({
                                      ...week,
                                      items: week.items.map((x) =>
                                        x.id === i.id
                                          ? {
                                              ...x,
                                              [k]: Number(e.target.value),
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                            ))}
                            <td>
                              <button
                                aria-label={`${i.name} 항목 삭제`}
                                onClick={() =>
                                  updateWeek({
                                    ...week,
                                    items: week.items.filter(
                                      (x) => x.id !== i.id,
                                    ),
                                  })
                                }
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="item-add">
                    <label>
                      새 항목 이름
                      <input
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (!itemName.trim()) return;
                        updateWeek({
                          ...week,
                          items: [
                            ...week.items,
                            {
                              id: id(),
                              name: itemName.trim(),
                              max: 100,
                              cut: 80,
                            },
                          ],
                        });
                        setItemName("");
                      }}
                    >
                      항목 추가
                    </button>
                  </div>
                </details>
                {invalid && (
                  <p role="alert">
                    점수 범위 또는 만점/커트라인 설정을 확인하세요.
                  </p>
                )}
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="학생별 점수 가로 스크롤"
                >
                  <table
                    className="score-entry-table"
                    aria-label="학생별 점수 입력"
                    style={{
                      minWidth:
                        320 + week.items.length * 176 + (mock ? 320 : 0),
                    }}
                  >
                    <colgroup>
                      <col style={{ width: 160 }} />
                      {week.items.map((i) => (
                        <col key={i.id} style={{ width: 176 }} />
                      ))}
                      <col style={{ width: 160 }} />
                      {mock && (
                        <>
                          <col style={{ width: 100 }} />
                          <col style={{ width: 220 }} />
                        </>
                      )}
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">학생</th>
                        {week.items.map((i) => (
                          <th scope="col" key={i.id}>
                            {i.name}
                            <span className="score-column-detail">
                              {i.max}점 만점 · 기준 {i.cut}
                            </span>
                          </th>
                        ))}
                        <th scope="col">원점수 합계</th>
                        {mock && (
                          <>
                            <th scope="col">미응시</th>
                            <th scope="col">메모</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {current.students.map((s) => (
                        <tr key={s.id}>
                          <th scope="row">{s.name}</th>
                          {week.items.map((i) => {
                            const m = mark(s.id, i.id);
                            const low =
                              m.score !== "" && Number(m.score) < i.cut;
                            return (
                              <td key={i.id}>
                                <input
                                  type="number"
                                  disabled={mock && week.absent?.[s.id]}
                                  min="0"
                                  max={i.max}
                                  className={low ? "below-cut" : ""}
                                  aria-label={`${s.name} ${i.name} 점수`}
                                  value={m.score}
                                  onChange={(e) =>
                                    setMark(s.id, i.id, {
                                      score: e.target.value,
                                      passed: false,
                                    })
                                  }
                                />
                                {low && !(mock && week.absent?.[s.id]) && (
                                  <label className="retest">
                                    <input
                                      type="checkbox"
                                      aria-label={`${s.name} ${i.name} 재시험 통과`}
                                      checked={m.passed}
                                      onChange={(e) =>
                                        setMark(s.id, i.id, {
                                          ...m,
                                          passed: e.target.checked,
                                        })
                                      }
                                    />
                                    재시험 통과
                                  </label>
                                )}
                              </td>
                            );
                          })}
                          <td aria-label={`${s.name} 원점수 합계`}>
                            {mock && week.absent?.[s.id]
                              ? "미응시"
                              : week.items.some(
                                    (i) => mark(s.id, i.id).score !== "",
                                  )
                                ? week.items.reduce(
                                    (n, i) =>
                                      n + Number(mark(s.id, i.id).score),
                                    0,
                                  )
                                : "미입력"}
                          </td>
                          {mock && (
                            <>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`${s.name} 미응시`}
                                  checked={week.absent?.[s.id] ?? false}
                                  onChange={(e) =>
                                    updateWeek({
                                      ...week,
                                      absent: {
                                        ...week.absent,
                                        [s.id]: e.target.checked,
                                      },
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`${s.name} 모의고사 메모`}
                                  value={week.examMemos?.[s.id] ?? ""}
                                  onChange={(e) =>
                                    updateWeek({
                                      ...week,
                                      examMemos: {
                                        ...week.examMemos,
                                        [s.id]: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>
                {mock
                  ? "모의고사를 추가하세요."
                  : "주차 관리에서 주차를 추가하세요."}
              </p>
            ))}
          {tab === "반 관리" && (
            <>
              <label>
                새 반 이름
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button
                onClick={() => {
                  if (!name.trim()) return;
                  const c = { id: id(), name: name.trim(), students: [] };
                  setClasses([...classes, c]);
                  setSelected(c.id);
                  setName("");
                }}
              >
                반 추가
              </button>
              {current && (
                <>
                  <label>
                    반 이름 수정
                    <input
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() => {
                      if (rename.trim())
                        update({ ...current, name: rename.trim() });
                    }}
                  >
                    반 수정
                  </button>
                  <button
                    onClick={() => {
                      const next = classes.filter((c) => c.id !== selected);
                      setClasses(next);
                      setSelected(next[0]?.id ?? "");
                    }}
                  >
                    반 삭제
                  </button>
                  <p>반 삭제 시 소속 학생도 삭제됩니다.</p>
                </>
              )}
            </>
          )}
          {tab === "학생 관리" && current && (
            <>
              <label>
                새 학생 이름
                <input
                  value={student}
                  onChange={(e) => setStudent(e.target.value)}
                />
              </label>
              <button
                onClick={() => {
                  if (!student.trim()) return;
                  update({
                    ...current,
                    students: [
                      ...current.students,
                      { id: id(), name: student.trim() },
                    ],
                  });
                  setStudent("");
                }}
              >
                학생 추가
              </button>
              {current.students.map((s) => (
                <div key={s.id}>
                  <input
                    aria-label={`${s.name} 이름`}
                    value={s.name}
                    onChange={(e) =>
                      update({
                        ...current,
                        students: current.students.map((x) =>
                          x.id === s.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      update({
                        ...current,
                        students: current.students.filter((x) => x.id !== s.id),
                      })
                    }
                  >
                    {s.name} 삭제
                  </button>
                  <button
                    onClick={() => {
                      setMoving({ sid: s.id, from: current.id });
                      setMoveTarget("");
                    }}
                  >
                    {s.name} 반 이동
                  </button>
                </div>
              ))}
              <button onClick={() => setNotice("학생 변경 저장됨")}>
                학생 변경 저장
              </button>
            </>
          )}
          {tab === "클리닉 배정표" && current && week && (
            <>
              <p>선택한 반·주차의 클리닉 일정</p>
              <p>
                요일·시간 입력으로 묶습니다. 메모에서 일정을 자동 추출하지
                않으며 학생당 한 일정만 지원합니다.
              </p>
              <div aria-label="클리닉 시간별 명단" className="clinic-groups">
                {(() => {
                  const entries = current.students
                    .map((s) => {
                      const c = week.clinic?.[s.id];
                      const pending = week.items
                        .filter((i) => {
                          const m = mark(s.id, i.id);
                          return (
                            m.score !== "" &&
                            Number(m.score) < i.cut &&
                            !m.passed
                          );
                        })
                        .map((i) => i.name);
                      return {
                        s,
                        c,
                        pending,
                        day: c?.day || "일정 미정",
                        time: c?.time || "시간 미정",
                      };
                    })
                    .filter(
                      (e) =>
                        e.pending.length ||
                        e.c?.memo.trim() ||
                        e.c?.day ||
                        e.c?.time,
                    );
                  const keys = [
                    ...new Set(entries.map((e) => `${e.day} · ${e.time}`)),
                  ].sort((a, b) => {
                    const days = [
                      "월",
                      "화",
                      "수",
                      "목",
                      "금",
                      "토",
                      "일",
                      "일정 미정",
                    ];
                    return (
                      days.indexOf(a.split(" · ")[0]) -
                        days.indexOf(b.split(" · ")[0]) || a.localeCompare(b)
                    );
                  });
                  return keys.length ? (
                    keys.map((key) => (
                      <section aria-label={key} key={key}>
                        <h3>{key}</h3>
                        <ul>
                          {entries
                            .filter((e) => `${e.day} · ${e.time}` === key)
                            .map((e) => (
                              <li key={e.s.id}>
                                <strong>{e.s.name}</strong> ·{" "}
                                {e.pending.length
                                  ? `남은 재시험: ${e.pending.join(", ")}`
                                  : "과제·상담 일정"}
                                {e.c?.memo && <p>{e.c.memo}</p>}
                              </li>
                            ))}
                        </ul>
                      </section>
                    ))
                  ) : (
                    <p>배정할 클리닉 대상이 없습니다.</p>
                  );
                })()}
              </div>
              {current.students.map((s) => {
                const c = week.clinic?.[s.id] ?? {
                  memo: "",
                  day: "",
                  time: "",
                };
                const edit = (next: Clinic) =>
                  updateWeek({
                    ...week,
                    clinic: { ...week.clinic, [s.id]: next },
                  });
                return (
                  <fieldset key={s.id}>
                    <legend>{s.name}</legend>
                    <label>
                      요일
                      <select
                        aria-label={`${s.name} 클리닉 요일`}
                        value={c.day}
                        onChange={(e) => edit({ ...c, day: e.target.value })}
                      >
                        {["", "월", "화", "수", "목", "금", "토", "일"].map(
                          (d) => (
                            <option key={d} value={d}>
                              {d || "미정"}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      시간
                      <input
                        type="time"
                        aria-label={`${s.name} 클리닉 시간`}
                        value={c.time}
                        onChange={(e) => edit({ ...c, time: e.target.value })}
                      />
                    </label>
                    <label>
                      메모
                      <textarea
                        aria-label={`${s.name} 클리닉 메모`}
                        value={c.memo}
                        onChange={(e) => edit({ ...c, memo: e.target.value })}
                      />
                    </label>
                    <p>
                      남은 재시험:{" "}
                      {week.items
                        .filter((i) => {
                          const m = mark(s.id, i.id);
                          return (
                            m.score !== "" &&
                            Number(m.score) < i.cut &&
                            !m.passed
                          );
                        })
                        .map((i) => i.name)
                        .join(", ") || "없음"}
                    </p>
                  </fieldset>
                );
              })}
            </>
          )}
          {tab === "문자 미리보기" && (
            <>
              <p className="demo-warning">미리보기 전용 · 실제 발송 불가</p>
              <p>연락처를 수집하지 않으며 메시지를 전송하지 않습니다.</p>
              <textarea
                aria-label="문자 내용"
                readOnly
                rows={12}
                value={(current?.students ?? [])
                  .map((s) => {
                    const c = week?.clinic?.[s.id];
                    return `[가상 학습 안내] ${s.name} · ${week?.name ?? "주차 없음"}\n${week?.items.map((i) => `${i.name}: ${mark(s.id, i.id).score || "미입력"} / ${i.max}`).join(", ") ?? ""}\n클리닉: ${c?.day || "미정"} ${c?.time || ""}\n${c?.memo || ""}`;
                  })
                  .join("\n\n")}
              />
            </>
          )}
          {tab === "변경 이력" && (
            <>
              <p>
                기록 저장 시점의 전체 반·주차 스냅샷을 복원합니다. 최근 20개를
                보관합니다.
              </p>
              {history.length === 0 && <p>저장한 기록이 없습니다.</p>}
              {history.map((h, n) => (
                <div className="history-row" key={h.id}>
                  <time>{h.time}</time>
                  <button
                    onClick={() => {
                      setClasses(h.classes);
                      setWeeks(h.weeks);
                      setMemos(h.memos ?? []);
                      setSelected(h.classes[0]?.id ?? "");
                      setWeekId("");
                      setNotice("기록 복원됨");
                    }}
                  >
                    기록 {n + 1} 복원
                  </button>
                </div>
              ))}
            </>
          )}
          {!current && <p>반을 추가해 시작하세요.</p>}
        </section>
        <div className="toolbar">
          <button
            onClick={() => {
              setHistory(
                [
                  ...history,
                  {
                    id: id(),
                    time: new Date().toLocaleString("ko-KR"),
                    classes,
                    weeks,
                    memos,
                  },
                ].slice(-20),
              );
              setNotice("기록 저장됨");
            }}
          >
            기록 저장
          </button>
          <button onClick={() => setResetPending(true)}>데모 초기화</button>
        </div>
        {moving &&
          (() => {
            const source = classes.find((c) => c.id === moving.from);
            const studentToMove = source?.students.find(
              (s) => s.id === moving.sid,
            );
            const target = classes.find((c) => c.id === moveTarget);
            const safe =
              target &&
              target.id !== moving.from &&
              target.students.length === 0 &&
              !weeks[target.id]?.length &&
              !target.exams?.length;
            return (
              <div role="dialog" aria-label="반 이동 확인">
                <h3>{studentToMove?.name} 반 이동</h3>
                <p>
                  제한: 학생·주차·모의고사가 없는 빈 새 반만 이동 가능합니다.
                  기존 반으로의 주차 매핑은 지원하지 않습니다.
                </p>
                <p>
                  모든 주차·항목 설정과 이 학생의
                  점수·재시험·출석·과제·클리닉·모의고사를 새 반에 복사합니다.
                  원래 반의 기록은 삭제하지 않습니다.
                </p>
                <label>
                  이동할 반
                  <select
                    value={moveTarget}
                    onChange={(e) => setMoveTarget(e.target.value)}
                  >
                    <option value="">선택</option>
                    {classes
                      .filter((c) => c.id !== moving.from)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                {moveTarget && !safe && (
                  <p role="alert">
                    대상 반에 기존 데이터가 있습니다. 빈 새 반을 만들어
                    선택하세요.
                  </p>
                )}
                <button
                  disabled={!safe || !studentToMove}
                  onClick={() => {
                    if (!safe || !target || !source || !studentToMove) return;
                    const only = <T,>(
                      record?: Record<string, T>,
                    ): Record<string, T> =>
                      record && Object.hasOwn(record, moving.sid)
                        ? { [moving.sid]: record[moving.sid] }
                        : {};
                    const copy = (w: Week): Week => ({
                      ...w,
                      id: id(),
                      marks: only(w.marks),
                      tracking: only(w.tracking),
                      clinic: only(w.clinic),
                      absent: only(w.absent),
                      examMemos: only(w.examMemos),
                    });
                    setWeeks({
                      ...weeks,
                      [target.id]: (weeks[source.id] ?? []).map(copy),
                    });
                    setClasses(
                      classes.map((c) =>
                        c.id === source.id
                          ? {
                              ...c,
                              students: c.students.filter(
                                (s) => s.id !== moving.sid,
                              ),
                            }
                          : c.id === target.id
                            ? {
                                ...c,
                                students: [studentToMove],
                                exams: (source.exams ?? []).map(copy),
                              }
                            : c,
                      ),
                    );
                    setSelected(target.id);
                    setWeekId("");
                    setExamId("");
                    setMoving(null);
                    setNotice("반 이동 완료 · 원래 반 기록 보존됨");
                  }}
                >
                  반 이동 확인
                </button>
                <button onClick={() => setMoving(null)}>이동 취소</button>
              </div>
            );
          })()}
        {resetPending && (
          <div role="dialog" aria-label="데모 초기화 확인">
            <p>모든 데모 데이터와 기록을 초기화할까요?</p>
            <button
              onClick={() => {
                const next = fresh();
                setClasses(next.classes);
                setWeeks(next.weeks);
                setHistory([]);
                setMemos([]);
                setPreserveStorage(false);
                setDeleteMemo(null);
                setMoving(null);
                setSelected("demo-a");
                setWeekId("week-1");
                setResetPending(false);
                setNotice("데모 초기화됨");
              }}
            >
              초기화 확인
            </button>
            <button onClick={() => setResetPending(false)}>취소</button>
          </div>
        )}
        <p role="status">
          {preserveStorage
            ? "기존 저장 데이터 보존 · 형식 오류로 임시 데모를 표시합니다. 초기화 확인 전에는 저장하지 않습니다."
            : storageFailed
              ? "브라우저 저장 불가 · 현재 화면에서만 유지됩니다."
              : notice ||
                "브라우저에 자동 저장 · 기록 저장으로 복원 지점을 만드세요."}
        </p>
      </main>
    </div>
  );
}

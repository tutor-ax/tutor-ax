import { useEffect, useState } from "react";
import {
  AdminLocked,
  AdminUnauthorized,
  createAdminApi,
  type AdminClass,
  type AdminStudent,
} from "../adminApi";
import { counselBrief, counselCard } from "../counsel";
import { sortByDateDesc } from "../domain";

// 실제 DB(읽기 전용)로 상담 카드를 만든다. 데모 데이터와 섞지 않도록 별도 구역으로 둔다.
export default function CounselLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [api] = useState(() => createAdminApi(fetchImpl));
  const [signedIn, setSignedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [classes, setClasses] = useState<AdminClass[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [studentId, setStudentId] = useState("");
  const [weekCount, setWeekCount] = useState(6);
  const [card, setCard] = useState("");
  const [questions, setQuestions] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signOutLocally = () => {
    setSignedIn(false);
    setClasses([]);
    setClassId("");
    setStudents([]);
    setStudentId("");
    setCard("");
    setQuestions("");
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      if (e instanceof AdminUnauthorized) {
        signOutLocally();
        setError("관리자 비밀번호가 맞지 않거나 로그인이 만료됐습니다.");
      } else if (e instanceof AdminLocked) {
        setError("로그인 실패가 많아 10분간 잠겼습니다.");
      } else setError("서버에서 기록을 불러오지 못했습니다. 백엔드가 켜져 있는지 확인하세요.");
    } finally {
      setBusy(false);
    }
  };

  // 이미 로그인된 세션(쿠키)이 있으면 비밀번호 없이 이어간다. 없으면(401) 조용히 로그인 화면.
  useEffect(() => {
    api
      .classes()
      .then((list) => {
        setClasses(list);
        setSignedIn(true);
      })
      .catch(() => {});
  }, [api]);

  const login = () =>
    run(async () => {
      await api.login(password);
      setPassword("");
      setClasses(await api.classes());
      setSignedIn(true);
    });

  const logout = () =>
    run(async () => {
      await api.logout();
      signOutLocally();
    });

  const pickClass = (id: string) => {
    setClassId(id);
    setStudentId("");
    setStudents([]);
    setCard("");
    setQuestions("");
    if (id) void run(async () => setStudents(await api.students(Number(id))));
  };

  const build = () =>
    run(async () => {
      const student = students.find((s) => String(s.id) === studentId);
      if (!student) return;
      setCard("");
      setQuestions("");
      setAiNote("");
      const all = await api.weeks(Number(classId));
      const picked = sortByDateDesc(all, (w) => w.test_date || w.label || "").slice(0, weekCount);
      if (!picked.length) {
        setError("이 반에 등록된 주차가 없습니다.");
        return;
      }
      const rows = await api.scores(picked.map((w) => w.id));
      const brief = counselBrief(picked.slice().reverse(), rows, student.id, student.created_at);
      const cls = classes.find((c) => String(c.id) === classId);
      const head = [student.name, cls?.name, brief.newWeek ? `신규 ${brief.newWeek}주차` : ""]
        .filter(Boolean)
        .join(" · ");
      setCard(counselCard(head, picked.length, brief));
      // 질문은 덤이다 — 실패해도 카드는 그대로 쓴다.
      setAiNote("상담 질문을 만드는 중...");
      try {
        setQuestions(await api.questions(brief.lines, picked.length));
        setAiNote("");
      } catch (e) {
        if (e instanceof AdminUnauthorized) throw e;
        setAiNote("AI 질문을 만들지 못했습니다. 카드는 그대로 쓰실 수 있습니다.");
      }
    });

  return (
    <section aria-label="실제 DB 상담 카드">
      <h3>실제 DB (읽기 전용)</h3>
      <p>실제 학생 기록입니다. 화면 밖으로 옮기지 마세요.</p>
      {!signedIn ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <label>
            관리자 비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !password}>
            연결
          </button>
        </form>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => void logout()}>
            로그아웃
          </button>
          <label>
            실제 반 선택
            <select value={classId} onChange={(e) => pickClass(e.target.value)}>
              <option value="">반을 선택하세요</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            실제 학생 선택
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">학생을 선택하세요</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            최근 주차 수
            <input
              type="number"
              min={1}
              max={12}
              value={weekCount}
              onChange={(e) => setWeekCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <button type="button" disabled={busy || !studentId} onClick={() => void build()}>
            상담 카드 만들기
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {card && <textarea aria-label="실제 상담 카드" readOnly rows={14} value={card} />}
      {aiNote && <p role="status">{aiNote}</p>}
      {questions && (
        <label>
          상담 때 물어볼 것 (AI · 단정하지 않는 질문)
          <textarea aria-label="상담 질문" rows={5} defaultValue={questions} key={questions} />
        </label>
      )}
    </section>
  );
}

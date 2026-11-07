import { useState } from "react";
import {
  AdminUnauthorized,
  createAdminApi,
  type AdminApi,
  type AdminClass,
  type AdminStudent,
} from "../adminApi";
import { counselBrief, counselCard } from "../counsel";
import { sortByDateDesc } from "../domain";

// 실제 DB(읽기 전용)로 상담 카드를 만든다. 데모 데이터와 섞지 않도록 별도 구역으로 둔다.
export default function CounselLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [password, setPassword] = useState("");
  const [api, setApi] = useState<AdminApi | null>(null);
  const [classes, setClasses] = useState<AdminClass[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [studentId, setStudentId] = useState("");
  const [weekCount, setWeekCount] = useState(6);
  const [card, setCard] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      if (e instanceof AdminUnauthorized) {
        setApi(null);
        setError("관리자 비밀번호가 맞지 않습니다.");
      } else setError("서버에서 기록을 불러오지 못했습니다. 백엔드가 켜져 있는지 확인하세요.");
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const next = createAdminApi(password, fetchImpl);
      setClasses(await next.classes());
      setApi(next);
    });

  const pickClass = (id: string) => {
    setClassId(id);
    setStudentId("");
    setStudents([]);
    setCard("");
    if (api && id) void run(async () => setStudents(await api.students(Number(id))));
  };

  const build = () =>
    run(async () => {
      const student = students.find((s) => String(s.id) === studentId);
      if (!api || !student) return;
      const all = await api.weeks(Number(classId));
      const picked = sortByDateDesc(all, (w) => w.test_date || w.label || "").slice(0, weekCount);
      if (!picked.length) {
        setCard("");
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
    });

  return (
    <section aria-label="실제 DB 상담 카드">
      <h3>실제 DB (읽기 전용)</h3>
      <p>실제 학생 기록입니다. 화면 밖으로 옮기지 마세요.</p>
      {!api ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
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
    </section>
  );
}

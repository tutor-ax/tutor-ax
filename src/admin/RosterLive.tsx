import { useEffect, useState } from "react";
import {
  AdminConflict,
  AdminInvalid,
  AdminLocked,
  AdminUnauthorized,
  createAdminApi,
  type RosterClass,
  type RosterStudent,
} from "../adminApi";

const GRADES = ["", "고1", "고2"];
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

// 실제 DB의 반·학생 관리. score-system 반 관리·학생 관리 탭과 같은 칸을 같은 규칙으로 고친다.
// 칸에서 벗어나면 저장한다. 삭제는 없다(퇴원으로 대신). 반 이동은 점수까지 옮겨야 해서 3단계에서 붙인다.
export default function RosterLive({ mode, fetchImpl }: { mode: "classes" | "students"; fetchImpl?: typeof fetch }) {
  const [api] = useState(() => createAdminApi(fetchImpl));
  const [signedIn, setSignedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [classes, setClasses] = useState<RosterClass[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [draft, setDraft] = useState({ name: "", grade: "", day: "", time: "", pin: "", phone: "", student_phone: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async (cid = classId) => {
    setClasses(await api.rosterClasses());
    setStudents(cid ? await api.rosterStudents(Number(cid)) : []);
  };

  // shortcut: login/session handling is a near-copy of CounselLive; extract a shared hook when a third live panel appears.
  const run = async (task: () => Promise<void>, done = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (done) setNotice(done);
    } catch (e) {
      if (e instanceof AdminUnauthorized) {
        setSignedIn(false);
        setError("관리자 비밀번호가 맞지 않거나 로그인이 만료됐습니다.");
      } else if (e instanceof AdminLocked) setError("로그인 실패가 많아 10분간 잠겼습니다.");
      else if (e instanceof AdminConflict) {
        setError("다른 곳에서 먼저 수정됐습니다. 최신 내용으로 다시 불러왔으니 확인 후 다시 입력하세요.");
        await reload().catch(() => {});
      } else if (e instanceof AdminInvalid) {
        setError("입력값을 확인하세요. (PIN 4자리 숫자, 연락처는 숫자와 -만)");
        await reload().catch(() => {});
      } else setError("서버에 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  };

  // 이미 로그인된 세션(쿠키)이 있으면 이어간다. 없으면(401) 조용히 로그인 화면.
  useEffect(() => {
    api.rosterClasses().then((list) => {
      setClasses(list);
      setSignedIn(true);
    }).catch(() => {});
  }, [api]);

  const save = <T extends RosterClass | RosterStudent>(kind: "classes" | "students", row: T, field: keyof T, value: unknown) => {
    if ((row[field] ?? "") === (value ?? "")) return;
    void run(async () => {
      await api.patch(kind, row.id, { [field]: row[field] }, { [field]: value });
      await reload();
    }, "저장했습니다.");
  };

  const pickClass = (id: string) => {
    setClassId(id);
    setStudents([]);
    if (id) void run(async () => setStudents(await api.rosterStudents(Number(id))));
  };

  if (!signedIn)
    return (
      <section aria-label="실제 DB 반·학생 관리">
        <h3>실제 DB</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.login(password);
              setPassword("");
              setClasses(await api.rosterClasses());
              setSignedIn(true);
            });
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
        {error && <p role="alert">{error}</p>}
      </section>
    );

  return (
    <section aria-label="실제 DB 반·학생 관리">
      <h3>실제 DB</h3>
      <p>실제 학원 기록입니다. 칸에서 벗어나면 바로 저장됩니다.</p>
      {mode === "classes" ? (
        <>
          <table>
            <thead>
              <tr>
                <th>반 이름</th>
                <th>학년</th>
                <th>요일</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={`${c.id}:${c.name}:${c.grade}:${c.day}:${c.time}`}>
                  <td>
                    <input aria-label={`${c.name} 반 이름`} defaultValue={c.name} onBlur={(e) => save("classes", c, "name", e.target.value.trim())} />
                  </td>
                  <td>
                    <select aria-label={`${c.name} 학년`} value={c.grade ?? ""} onChange={(e) => save("classes", c, "grade", e.target.value || null)}>
                      {GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g || "미지정"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select aria-label={`${c.name} 요일`} value={c.day} onChange={(e) => save("classes", c, "day", e.target.value)}>
                      {DAYS.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input aria-label={`${c.name} 시간`} defaultValue={c.time ?? ""} onBlur={(e) => save("classes", c, "time", e.target.value.trim() || null)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { name, grade, day, time } = draft;
              void run(async () => {
                await api.addClass({ name: name.trim(), grade: grade || null, day, time: time.trim() || null });
                setDraft({ ...draft, name: "", grade: "", day: "", time: "" });
                await reload();
              }, `${name.trim()} 반을 추가했습니다.`);
            }}
          >
            <input aria-label="새 반 이름" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <select aria-label="새 반 학년" value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g || "학년"}
                </option>
              ))}
            </select>
            <select aria-label="새 반 요일" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })}>
              <option value="">요일</option>
              {DAYS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <input aria-label="새 반 시간" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            <button type="submit" disabled={busy || !draft.name.trim() || !draft.day}>
              실제 반 추가
            </button>
          </form>
        </>
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
          {classId && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>PIN</th>
                    <th>학부모 연락처</th>
                    <th>학생 연락처</th>
                    <th>특이사항</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={`${s.id}:${s.name}:${s.pin}:${s.phone}:${s.student_phone}:${s.note}:${s.is_active}`} aria-disabled={!s.is_active}>
                      <td>
                        <input aria-label={`${s.name} 이름`} defaultValue={s.name} onBlur={(e) => save("students", s, "name", e.target.value.trim())} />
                      </td>
                      <td>
                        <input aria-label={`${s.name} PIN`} inputMode="numeric" defaultValue={s.pin} onBlur={(e) => save("students", s, "pin", e.target.value.trim())} />
                      </td>
                      <td>
                        <input aria-label={`${s.name} 학부모 연락처`} defaultValue={s.phone ?? ""} onBlur={(e) => save("students", s, "phone", e.target.value.trim() || null)} />
                      </td>
                      <td>
                        <input aria-label={`${s.name} 학생 연락처`} defaultValue={s.student_phone ?? ""} onBlur={(e) => save("students", s, "student_phone", e.target.value.trim() || null)} />
                      </td>
                      <td>
                        <textarea aria-label={`${s.name} 특이사항`} rows={1} defaultValue={s.note ?? ""} onBlur={(e) => save("students", s, "note", e.target.value)} />
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (s.is_active && !confirm(`${s.name} 학생을 퇴원 처리할까요? 점수 기록은 그대로 남고 언제든 복귀할 수 있습니다.`)) return;
                            save("students", s, "is_active", !s.is_active);
                          }}
                        >
                          {s.is_active ? `${s.name} 퇴원` : `${s.name} 복귀`}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const { name, pin, phone, student_phone } = draft;
                  void run(async () => {
                    await api.addStudent({ name: name.trim(), pin: pin.trim(), class_id: Number(classId), phone: phone.trim(), student_phone: student_phone.trim() });
                    setDraft({ ...draft, name: "", pin: "", phone: "", student_phone: "" });
                    await reload();
                  }, `${name.trim()} 학생을 추가했습니다.`);
                }}
              >
                <input aria-label="새 학생 이름" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input aria-label="새 학생 PIN" inputMode="numeric" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} />
                <input aria-label="새 학생 학부모 연락처" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                <input aria-label="새 학생 학생 연락처" value={draft.student_phone} onChange={(e) => setDraft({ ...draft, student_phone: e.target.value })} />
                <button type="submit" disabled={busy || !draft.name.trim() || !draft.pin.trim()}>
                  실제 학생 추가
                </button>
              </form>
            </>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

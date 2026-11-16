import { useState } from "react";
import type { AdminClass, AdminStudent, AdminWeek } from "../adminApi";
import type { HomeworkPhoto } from "../photoApi";
import { sortByTestDate } from "../weekDates";
import { useLivePanel } from "./useLivePanel";

export default function PhotoLive({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [classes, setClasses] = useState<AdminClass[]>([]);
  const [classId, setClassId] = useState("");
  const [weeks, setWeeks] = useState<AdminWeek[]>([]);
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [weekId, setWeekId] = useState("");
  const [photos, setPhotos] = useState<HomeworkPhoto[] | null>(null);
  const { api, signedIn, busy, error, run, login } = useLivePanel(fetchImpl, {
    onSignedIn: async (a) => setClasses(await a.classes()),
    invalidMessage: "주차를 다시 선택하세요.",
  });

  const pickClass = (cid: string) => {
    setClassId(cid);
    setWeeks([]);
    setStudents([]);
    setWeekId("");
    setPhotos(null);
    if (!cid) return;
    void run(async () => {
      const [ws, sts] = await Promise.all([api.weeks(Number(cid)), api.students(Number(cid))]);
      setWeeks(sortByTestDate(ws));
      setStudents(sts);
    });
  };
  const pickWeek = (wid: string) => {
    setWeekId(wid);
    setPhotos(null);
    if (wid) void run(async () => setPhotos(await api.homeworkPhotos(Number(wid))));
  };

  if (!signedIn) return login("실제 DB 과제 인증 사진");

  const label = (w: AdminWeek) => w.label || w.test_date || "";
  const byStudent = (sid: number) => (photos ?? []).filter((p) => p.student_id === sid);
  return (
    <section aria-label="실제 DB 과제 인증 사진">
      <h3>과제 인증 사진 (실제)</h3>
      <label>
        사진 반 선택
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
          사진 주차 선택
          <select value={weekId} disabled={busy} onChange={(e) => pickWeek(e.target.value)}>
            <option value="">주차를 선택하세요</option>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {label(w)}
              </option>
            ))}
          </select>
        </label>
      )}
      {photos && (
        <>
          <button type="button" disabled={busy} onClick={() => pickWeek(weekId)}>
            새로고침
          </button>
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>사진</th>
              </tr>
            </thead>
            <tbody>
              {students.map((st) => (
                <tr key={st.id}>
                  <td>{st.name}</td>
                  <td>
                    {byStudent(st.id).length === 0
                      ? "사진 없음"
                      : byStudent(st.id).map((p, i) => (
                          <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                            <img src={p.url} alt={`${st.name} 사진 ${i + 1}`} width={80} loading="lazy" />
                          </a>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

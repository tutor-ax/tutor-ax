import { useState } from "react";
import { AdminConflict, type AdminApi, type AdminWeek, type RosterClass } from "../adminApi";
import { activeItems, isBelowCut, type Item } from "../domain";
import { blank, changedFields, fieldsOf, overMax, payloadValue, SCALAR_LABELS, type Fields, type SheetRow } from "../scoreSheet";
import { weekLabel } from "../weekGroup";
import { guestMatchWeek, newWeekLabel } from "../weekMatch";

type Found = { id: number; name: string; class_id: number };
type Pick = { st: Found; cls: RosterClass; target: AdminWeek | null; how: string; items: Item[]; hasRow: boolean };

// score-system '다른 반 학생 입력': 보고 있는 표는 그대로 두고, 학생 한 명의 점수를 그 학생 원래 반의 같은 주 주차에 저장한다.
export default function GuestInput(props: {
  api: AdminApi;
  run: (task: () => Promise<void>, done?: string) => Promise<void>;
  busy: boolean;
  classes: RosterClass[];
  host: AdminWeek;
  hostClassId: number;
}) {
  const { api, run, busy, classes, host, hostClassId } = props;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [base, setBase] = useState<Fields>({});
  const [screen, setScreen] = useState<Fields>({});
  const [status, setStatus] = useState("");
  const hostName = classes.find((c) => c.id === hostClassId)?.name ?? "";

  const search = () =>
    void run(async () => {
      setPick(null);
      setStatus("");
      // 보고 있는 반 학생은 표에 이미 있으므로 뺀다
      setFound((await api.searchStudents(q.trim())).filter((s) => s.class_id !== hostClassId));
    });

  const choose = (st: Found) =>
    void run(async () => {
      setPick(null);
      const cls = classes.find((c) => c.id === st.class_id);
      if (!cls) return setStatus("학생의 반 정보를 찾지 못했어요.");
      const m = guestMatchWeek(host, await api.weeks(cls.id));
      const rows = m ? ((await api.scores([m.week.id])) as unknown as SheetRow[]) : [];
      const row = rows.find((r) => Number(r.student_id) === st.id);
      const items = activeItems(m ? m.week : host);
      const f = fieldsOf(row, items);
      setBase(f);
      setScreen(f);
      setPick({ st, cls, target: m?.week ?? null, how: m?.how ?? "", items, hasRow: !!row });
      setStatus(row ? "이미 저장된 점수를 불러왔어요. 고칠 칸만 바꾸고 저장하세요." : "");
    });

  const edit = (k: string, v: unknown) => {
    const next = { ...screen, [k]: v };
    const it = pick?.items.find((i) => k === `score:${i.key}`);
    if (it && !isBelowCut(v as number, it.cut)) next[`retest:${it.key}`] = false;
    setScreen(next);
  };

  const save = () => {
    if (!pick) return;
    const p = pick;
    const typed = p.items.some((i) => !blank(screen[`score:${i.key}`])) || ["homework_rate", "homework_eval", "clinic_memo"].some((k) => !blank(screen[k]));
    if (!p.hasRow && !typed) return setStatus("입력한 점수가 없어요.");
    const over = overMax(screen, p.items).map((i) => ` · ${i.label} ${screen[`score:${i.key}`]}점 (만점 ${i.max})`);
    if (over.length && !confirm(`⚠️ 만점을 넘는 점수가 있습니다.\n\n${over.join("\n")}\n\n그대로 저장할까요?`)) return;
    void run(async () => {
      let target = p.target;
      let how = p.how;
      if (!target) {
        // 그사이 누가 만들었으면 그 주차를 쓴다
        const again = guestMatchWeek(host, await api.weeks(p.cls.id));
        if (again) {
          target = again.week;
          how = again.how;
        } else {
          const label = newWeekLabel(host, p.cls);
          target = { id: await api.copyWeek({ class_id: p.cls.id, label, from_week_id: host.id }), label, test_date: label };
          how = "새로 만든 주차";
        }
        setPick({ ...p, target, how });
      }
      const fields = changedFields(base, screen);
      if (!fields.length) return setStatus("바뀐 내용이 없어요.");
      const before = Object.fromEntries(fields.map((k) => [k, payloadValue(k, base[k])]));
      const after = Object.fromEntries(fields.map((k) => [k, payloadValue(k, screen[k])]));
      const body = { week_id: target.id, student_id: p.st.id, items: p.items.map((i) => i.key), no_homework: false, before, after };
      try {
        await api.saveScore(body);
      } catch (e) {
        if (!(e instanceof AdminConflict)) throw e;
        const label = (k: string) => SCALAR_LABELS[k] ?? `${p.items.find((i) => k.endsWith(`:${i.key}`))?.label ?? "항목"}${k.startsWith("retest:") ? " 재시험" : ""}`;
        const fmt = (v: unknown) => (blank(v) ? "(빈칸)" : String(v));
        const lines = Object.entries(e.current).map(([k, v]) => ` · ${label(k)}: 지금 저장된 값 ${fmt(v)} / 내가 입력한 값 ${fmt(after[k])}`);
        if (!confirm(`⚠️ ${p.st.name} 학생의 칸을 그사이 다른 곳에서 바꿨어요.\n\n${lines.join("\n")}\n\n[확인] 내가 입력한 값으로 덮어쓰기\n[취소] 저장 중단`))
          return setStatus("저장을 중단했어요.");
        await api.saveScore({ ...body, before: { ...before, ...e.current } });
      }
      setBase(screen);
      setPick({ ...p, target, how, hasRow: true });
      setStatus(`저장됨 — ${p.cls.name} ${weekLabel(target)}`);
    });
  };

  const str = (v: unknown) => (v == null ? "" : String(v));
  return (
    <div aria-label="다른 반 학생 입력">
      <p>
        보고 있는 {hostName} {weekLabel(host)} 표는 그대로 두고, 이 학생 한 명만 원래 반 주차에 저장합니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) search();
        }}
      >
        <label>
          학생 이름
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !q.trim()}>
          찾기
        </button>
      </form>
      {found && !found.length && <p>다른 반에서 찾은 학생이 없어요.</p>}
      {found?.map((s) => (
        <button key={s.id} type="button" aria-pressed={pick?.st.id === s.id} disabled={busy} onClick={() => choose(s)}>
          {s.name} · {classes.find((c) => c.id === s.class_id)?.name ?? "반 미지정"}
        </button>
      ))}
      {pick && (
        <div>
          {pick.target ? (
            <p>
              저장될 주차: {pick.cls.name} {weekLabel(pick.target)} ({pick.how}). 항목·만점·커트는 {pick.cls.name} 주차 설정을 따르고, 학부모 화면·평균·석차도{" "}
              {pick.cls.name} 기준으로 나옵니다.
            </p>
          ) : (
            <p>
              {pick.cls.name}에 이번 주 주차가 없어, 저장할 때 {newWeekLabel(host, pick.cls)} 주차를 새로 만들어 넣습니다. 새 주차의 항목·만점·커트와 비교 그룹은 지금
              보고 있는 {hostName} {weekLabel(host)} 것을 따릅니다. {pick.cls.name}의 다른 학생에게는 점수 없는 주차로 보입니다.
            </p>
          )}
          {pick.items.map((i) => {
            const v = screen[`score:${i.key}`];
            return (
              <label key={i.key}>
                {i.label || "항목"} /{i.max ?? ""}
                {i.cut != null && ` · 커트 ${i.cut}`}
                <input type="number" min={0} aria-label={`${pick.st.name} ${i.label}`} value={str(v)} onChange={(e) => edit(`score:${i.key}`, e.target.value)} />
                {isBelowCut(v as number, i.cut) && (
                  <span>
                    <input
                      type="checkbox"
                      aria-label={`${pick.st.name} ${i.label} 재시험 통과`}
                      checked={!!screen[`retest:${i.key}`]}
                      onChange={(e) => edit(`retest:${i.key}`, e.target.checked)}
                    />
                    재시험 통과
                  </span>
                )}
              </label>
            );
          })}
          <label>
            <input type="checkbox" checked={screen.attendance !== false} onChange={(e) => edit("attendance", e.target.checked)} />
            출석
          </label>
          <label>
            과제%
            <input type="number" min={0} max={100} value={str(screen.homework_rate)} onChange={(e) => edit("homework_rate", e.target.value)} />
          </label>
          <label>
            과제평가
            <textarea rows={1} value={str(screen.homework_eval)} onChange={(e) => edit("homework_eval", e.target.value)} />
          </label>
          <label>
            클리닉메모
            <textarea rows={1} value={str(screen.clinic_memo)} onChange={(e) => edit("clinic_memo", e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={save}>
            {pick.st.name} 점수 저장
          </button>
        </div>
      )}
      {status && <p aria-label="다른 반 학생 저장 상태">{status}</p>}
    </div>
  );
}

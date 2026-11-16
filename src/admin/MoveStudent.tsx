import { useState } from "react";
import { AdminConflict, type AdminApi, type AdminWeek, type MovePlan, type RosterClass, type RosterStudent } from "../adminApi";
import { sortByTestDate } from "../weekDates";
import { weekLabel } from "../weekGroup";
import { matchMoveWeeks, newWeekLabel } from "../weekMatch";

type Preview = { rows: ReturnType<typeof matchMoveWeeks>; toWeeks: AdminWeek[]; taken: Set<number> };

// score-system '반 이동': 점수 있는 주차마다 이동할 반의 주차를 짝지어 보여 주고, 확인하면 서버가 한 번에 옮긴다.
export default function MoveStudent(props: {
  api: AdminApi;
  run: (task: () => Promise<void>, done?: string) => Promise<void>;
  busy: boolean;
  classes: RosterClass[];
  student: RosterStudent;
  fromClassId: number;
  onMoved: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const { api, run, busy, classes, student, fromClassId } = props;
  const [toClassId, setToClassId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const toClass = classes.find((c) => c.id === Number(toClassId));
  const nameOf = (id: number) => classes.find((c) => c.id === id)?.name ?? "";

  const load = async (to: string) => {
    setPreview(null);
    if (!to) return;
    const [fromWeeks, toWeeks, scored] = await Promise.all([api.weeks(fromClassId), api.weeks(Number(to)), api.scoreWeeks(student.id)]);
    const has = new Set(scored);
    const toSorted = sortByTestDate(toWeeks);
    const rows = matchMoveWeeks(sortByTestDate(fromWeeks).filter((w) => has.has(w.id)), toSorted);
    // 대응 주차가 없으면 새 주차를 만들어 옮기는 것이 기본
    setChoice(Object.fromEntries(rows.map((r) => [r.fw.id, r.tw ? String(r.tw.id) : "new"])));
    setPreview({ rows, toWeeks: toSorted, taken: new Set(toSorted.filter((w) => has.has(w.id)).map((w) => w.id)) });
  };

  const pickClass = (to: string) => {
    setToClassId(to);
    void run(() => load(to));
  };

  const plan = preview
    ? preview.rows.map((r) => {
        const fw = r.fw;
        const v = choice[fw.id] ?? "";
        const m: MovePlan = { from_week_id: fw.id };
        if (v === "new") m.new_label = newWeekLabel(fw, toClass);
        else if (v && !preview.taken.has(Number(v))) m.to_week_id = Number(v);
        return { r, fw, v, m };
      })
    : [];
  const picked = plan.flatMap((p) => (p.m.to_week_id ? [p.m.to_week_id] : []));
  const dupes = picked.length !== new Set(picked).size;
  const creates = plan.filter((p) => p.m.new_label);
  const orphans = plan.filter((p) => !p.v).map((p) => weekLabel(p.fw));
  const conflicts = plan.filter((p) => p.v && p.v !== "new" && !p.m.to_week_id).map((p) => weekLabel(p.fw));

  const submit = () => {
    if (!preview || !toClass) return;
    // 같은 주차를 두 번 고르면 점수가 겹쳐 저장되므로 막는다
    if (dupes) return;
    const body = { from_class_id: fromClassId, to_class_id: toClass.id, moves: plan.map((p) => p.m) };
    void run(async () => {
      try {
        const check = await api.moveStudent(student.id, { ...body, dry_run: true });
        let msg = `${student.name} 학생을 ${nameOf(fromClassId)}에서 ${toClass.name}(으)로 옮깁니다. 점수 ${check.moved}건 이전.\n`;
        if (creates.length)
          msg +=
            `\n${toClass.name}에 주차 ${creates.length}개를 새로 만들어 점수를 옮깁니다.\n` +
            creates.map((p) => ` · ${weekLabel(p.fw)} → ${p.m.new_label}`).join("\n") +
            `\n새 주차는 원래 주차의 비교 그룹·채점 항목·과제 내용을 이어받습니다.\n이 반의 다른 학생에게는 점수가 없는 주차로 보입니다.\n`;
        if (orphans.length)
          msg += `\n⚠️ 이전하지 않는 기록 ${orphans.length}건 (${orphans.join(", ")})\n   → 그대로 이동하면 관리자 화면에서 보이지 않게 됩니다.\n`;
        if (conflicts.length)
          msg += `\n⚠️ 이동할 반에 이미 점수가 입력된 주차 ${conflicts.length}건 (${conflicts.join(", ")})\n   → 덮어쓰지 않고 건너뜁니다. 수동 확인이 필요합니다.\n`;
        if (!confirm(`${msg}\n계속할까요?`)) return;
        const done = await api.moveStudent(student.id, { ...body, dry_run: false });
        const tail = done.kept ? ` / 미이전 ${done.kept}건` : "";
        await props.onMoved(`반 이동 완료 — ${done.moved}건 이전${done.created ? ` (새 주차 ${done.created}개 생성)` : ""}${tail}`);
      } catch (e) {
        if (e instanceof AdminConflict) await load(toClassId).catch(() => {});
        throw e;
      }
    });
  };

  return (
    <fieldset aria-label={`${student.name} 반 이동`}>
      <legend>{student.name} — 반 이동</legend>
      <label>
        이동할 반
        <select value={toClassId} disabled={busy} onChange={(e) => pickClass(e.target.value)}>
          <option value="">이동할 반을 선택하세요</option>
          {classes
            .filter((c) => c.id !== fromClassId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      {preview && !preview.rows.length && <p>이전할 점수 데이터가 없습니다.</p>}
      {plan.map(({ r, fw, v }) => {
        const how =
          v === "new"
            ? r.tw
              ? "새 주차 생성"
              : `대응 주차 없음 — 새 주차 ${newWeekLabel(fw, toClass)} 생성`
            : !v
              ? "이전하지 않음"
              : preview!.taken.has(Number(v))
                ? "이미 점수 있음 — 건너뜀"
                : r.tw && String(r.tw.id) === v
                  ? r.how
                  : "직접 선택";
        return (
          <div key={fw.id}>
            {weekLabel(fw)} → <small>{how}</small>
            <select aria-label={`${weekLabel(fw)} 옮길 주차`} value={v} onChange={(e) => setChoice({ ...choice, [fw.id]: e.target.value })}>
              <option value="">— 이전하지 않음 —</option>
              <option value="new">＋ 새 주차 만들어 옮기기 ({newWeekLabel(fw, toClass)})</option>
              {preview!.toWeeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {weekLabel(w) || `#${w.id}`}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {preview && preview.rows.length > 0 && (
        <p>
          이전 {plan.length - orphans.length - conflicts.length}건{creates.length ? ` (새 주차 ${creates.length}개 생성)` : ""} / 제외{" "}
          {orphans.length + conflicts.length}건
          {dupes && " — ⚠️ 같은 주차를 두 번 선택했습니다. 하나만 남겨주세요."}
        </p>
      )}
      <button type="button" disabled={busy || !preview || dupes} onClick={submit}>
        반 이동 확인
      </button>
      <button type="button" onClick={props.onClose}>
        취소
      </button>
    </fieldset>
  );
}

import { useState } from "react";
import type { AdminWeek, RosterClass } from "../adminApi";
import { sortByTestDate } from "../weekDates";
import { groupPicks, movedFrom, weekLabel } from "../weekGroup";

// 주차·모의고사 공용 비교 그룹 편집(score-system GROUP_KINDS). 반마다 하나씩 골라 새 그룹으로 묶는다.
export default function GroupEditor(props: {
  unit: "주차" | "모의고사";
  classes: RosterClass[];
  classId: number;
  current: AdminWeek;
  busy: boolean;
  run: (task: () => Promise<void>, done: string) => Promise<void>;
  fetchAll: () => Promise<AdminWeek[]>;
  save: (ids: number[], before: Record<number, string | null>) => Promise<void>;
}) {
  const { unit, classes, classId, current } = props;
  const [all, setAll] = useState<AdminWeek[]>([]);
  const [picks, setPicks] = useState<Record<number, { on: boolean; weekId: number }> | null>(null);
  const nameOf = (w: AdminWeek) => classes.find((c) => c.id === w.class_id)?.name ?? `반 #${w.class_id}`;
  const byClass = new Map(classes.map((c) => [c.id, sortByTestDate(all.filter((w) => w.class_id === c.id))]));
  // 편집 중인 것이 맨 앞, 나머지는 반 순서대로.
  const picked = picks ? [current.id, ...classes.filter((c) => c.id !== classId && picks[c.id]?.on).map((c) => picks[c.id].weekId)] : [];
  const pickedWeeks = picked.map((id) => all.find((w) => w.id === id)).filter((w): w is AdminWeek => !!w);
  const moved = picks ? movedFrom(all, picked, current.group_id).map((m) => `${nameOf(m.week)}(현재 다른 그룹 ${m.size}개 반)`) : [];

  const open = () =>
    void props.run(async () => {
      const fresh = await props.fetchAll();
      setAll(fresh);
      const map = new Map(classes.map((c) => [c.id, sortByTestDate(fresh.filter((w) => w.class_id === c.id))]));
      setPicks(groupPicks(map, fresh.find((w) => w.id === current.id) ?? current, classId));
    }, "");

  const save = () => {
    const names = pickedWeeks.map((w) => ` · ${nameOf(w)} ${weekLabel(w)}`).join("\n");
    const out = moved.length ? `\n⚠️ ${moved.join(", ")}은(는) 기존 비교 그룹에서 빠집니다.\n` : "";
    const msg = `이 ${unit}의 비교 그룹을 ${picked.length}개 반으로 설정합니다.\n${names}\n\n이 반들은 같은 평균·석차를 공유합니다.\n포함된 모든 반의 학부모가 합산된 평균을 보게 됩니다.\n${out}\n계속할까요?`;
    if (!confirm(msg)) return;
    const before = Object.fromEntries(picked.map((id) => [id, all.find((w) => w.id === id)?.group_id ?? null]));
    void props.run(async () => {
      try {
        await props.save(picked, before);
      } finally {
        setPicks(null);
      }
    }, `비교 그룹이 ${picked.length}개 반으로 설정됐습니다.`);
  };

  if (!picks)
    return (
      <button type="button" disabled={props.busy} onClick={open}>
        비교 그룹 수정
      </button>
    );
  return (
    <fieldset aria-label="비교 그룹 수정">
      <legend>이 {unit}의 평균을 함께 낼 반 선택 — 체크한 반들이 하나의 비교 그룹이 됩니다</legend>
      {classes.map((c) => {
        const ofClass = byClass.get(c.id) ?? [];
        const p = picks[c.id];
        const cur = c.id === classId;
        if (!ofClass.length || !p)
          return (
            <label key={c.id}>
              <input type="checkbox" disabled />
              {c.name} {unit} 없음
            </label>
          );
        return (
          <div key={c.id}>
            <label>
              <input type="checkbox" checked={p.on} disabled={cur} onChange={(e) => setPicks({ ...picks, [c.id]: { ...p, on: e.target.checked } })} />
              {c.name}
              {cur && " (현재)"}
            </label>
            <select
              aria-label={`${c.name} ${unit}`}
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
      <button type="button" disabled={props.busy} onClick={save}>
        비교 그룹 저장
      </button>
      <button type="button" onClick={() => setPicks(null)}>
        취소
      </button>
    </fieldset>
  );
}

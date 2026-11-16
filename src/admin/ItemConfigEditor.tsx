import type { Item } from "../domain";
import { nextItemKey } from "../weekGroup";

export type CfgRow = { key: string; label: string; max: string; cut: string; active: boolean };
export const toRows = (its: Item[]): CfgRow[] => its.map((i) => ({ ...i, max: i.max == null ? "" : String(i.max), cut: i.cut == null ? "" : String(i.cut) }));
const num = (s: string) => (s.trim() === "" ? null : parseFloat(s));
export const fromRows = (rows: CfgRow[]): Item[] => rows.map((r) => ({ ...r, label: r.label.trim(), max: num(r.max), cut: num(r.cut) }));

// score-system saveItemConfig/saveMockItemConfig와 같은 검사. 문제가 없으면 빈 문자열.
export function cfgError(its: Item[]) {
  if (!its.some((i) => i.active)) return "최소 한 개 항목은 사용해야 합니다.";
  const noName = its.flatMap((i, n) => (i.active && !i.label ? [`${n + 1}번째`] : []));
  return noName.length ? `${noName.join(", ")} 항목의 이름을 입력하세요.` : "";
}

// 주차·모의고사 공용 채점 항목 편집기. 기본 4칸(baseKeys)은 DB 열과 1:1이라 끌 수만 있다.
export default function ItemConfigEditor(props: {
  title: string;
  example: string;
  baseKeys: string[];
  cfg: CfgRow[];
  setCfg: (f: (rows: CfgRow[]) => CfgRow[]) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const { cfg, setCfg } = props;
  const edit = (key: string, patch: Partial<CfgRow>) => setCfg((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const active = cfg.filter((r) => r.active);
  return (
    <>
      <details open>
        <summary>{props.title}</summary>
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
                  <input type="checkbox" aria-label={`${n + 1}번째 항목 사용`} checked={r.active} onChange={(e) => edit(r.key, { active: e.target.checked })} />
                </td>
                <td>
                  <input aria-label={`${n + 1}번째 항목 이름`} placeholder={`${n + 1}번째 항목 이름 (예: ${props.example})`} value={r.label} onChange={(e) => edit(r.key, { label: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} aria-label={`${n + 1}번째 항목 만점`} value={r.max} onChange={(e) => edit(r.key, { max: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} aria-label={`${n + 1}번째 항목 커트라인`} value={r.cut} onChange={(e) => edit(r.key, { cut: e.target.value })} />
                </td>
                <td>
                  {!props.baseKeys.includes(r.key) && (
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
        <button type="button" disabled={props.busy} onClick={props.onSave}>
          항목 설정 저장
        </button>
      </details>
      <p>
        사용 항목 {active.length}개 · 총점 만점 {active.reduce((a, r) => a + (num(r.max) || 0), 0)}점
      </p>
    </>
  );
}

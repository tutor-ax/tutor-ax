import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Chart from "chart.js/auto";
import {
  activeItems,
  computeTotal,
  hasMockScore,
  isBelowCut,
  itemVal,
  mockTotal,
  sortByDateDesc,
  stats,
  summary,
  trend,
  weeklyStats,
  type Item,
  type ScoreRow,
} from "./domain";
import type { LoginData } from "./gateway";
import { scoreChange } from "./scoreChange";

function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h2>{title}</h2>
        {aside}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}
function Notice({
  title,
  children,
  last = false,
}: {
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="notice-card warning"
      style={last ? { marginBottom: 0 } : undefined}
    >
      <span className="notice-icon" aria-hidden="true" />
      <div>
        <div className="notice-title">{title}</div>
        <div className="notice-body">{children}</div>
      </div>
    </div>
  );
}
function ItemCell({ item, row }: { item: Item; row: ScoreRow }) {
  const value = itemVal(row, item.key);
  const below = isBelowCut(value, item.cut);
  const passed = below && row.retest_pass?.[item.key] === true;
  return (
    <tr className={`score-item${below && !passed ? " below-cut" : ""}`}>
      <th scope="row" className="score-label">{item.label || "-"}</th>
      <td className="score-value">
        {value ?? "-"}
        <span className="score-max"> / {item.max ?? ""}</span>
      </td>
      <td className="score-status">
        {passed ? <span className="retest-pass">재시험 통과</span> :
          below ? <span className="retest-target">재시험 대상</span> :
          <span>{value == null ? "미기재" : "통과"}</span>}
      </td>
    </tr>
  );
}
function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="meta-item">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{value}</div>
    </div>
  );
}
function Total({
  value,
  max,
}: {
  value: number | null;
  max: number;
}) {
  return (
    <div className="total">
      <span className="total-value">{value ?? "-"}</span>
      <span className="total-max"> / {max}점</span>
    </div>
  );
}
function WeeklyScore({ data, id }: { data: LoginData; id: number }) {
  const row = data.myScores.find((s) => s.week_id === id);
  if (!row)
    return (
      <div className="empty-msg">
        해당 주차 점수가 아직 입력되지 않았습니다.
      </div>
    );
  const week = data.weeks.find((w) => w.id === id);
  const items = activeItems(week);
  const total = computeTotal(row, items);
  const rankIds = (week?.group_id && data.groupWeekMap?.[week.group_id]) || [
    id,
  ];
  const peers = data.rankScores.filter((s) => rankIds.includes(s.week_id!));
  const result = weeklyStats(row, peers, items);
  const rate = row.homework_rate;
  const color =
    rate == null
      ? "#6b6b6b"
      : rate >= 90
        ? "#286246"
        : rate >= 70
          ? "#815316"
          : "#c0392b";

  return (
    <Card
      title={week?.label || "점수 결과"}
      aside={
        <Total value={total} max={items.reduce((a, i) => a + (i.max || 0), 0)} />
      }
    >
      {row.attendance === false && (
        <Notice title="결석">
          이번 주 수업에 결석했습니다.
          {total !== null && (
            <>
              <br />
              아래 점수는 보충·재응시 등으로 기록된 점수입니다.
            </>
          )}
        </Notice>
      )}
      <table className={`score-table items-${items.length}`} aria-label="평가 항목별 점수">
        <thead><tr><th scope="col">평가 항목</th><th scope="col">점수 / 만점</th><th scope="col">확인 사항</th></tr></thead>
        <tbody>{items.map((item) => <ItemCell key={item.key} item={item} row={row} />)}</tbody>
      </table>
      <div className="meta-grid">
        <Meta
          label="평균"
          value={result.average === null ? "-" : `${result.average}점`}
        />
        <Meta
          label="석차"
          value={`${result.rank ?? "-"}등 / ${result.count}명`}
        />
      </div>
      {!row.no_homework && (
        <div className="homework-card">
          <div>
            <div className="homework-label">과제 수행률</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="homework-rate" style={{ color }}>
              {rate == null ? "미기재" : `${rate}%`}
            </div>
          </div>
        </div>
      )}

    </Card>
  );
}
function MockScore({ data, id }: { data: LoginData; id: number }) {
  const row = data.myMockScores.find((s) => s.exam_id === id);
  const exam = data.exams.find((e) => e.id === id);
  if (!row || !hasMockScore(row)) {
    const name =
      exam?.label && exam.exam_date && exam.label !== exam.exam_date
        ? `${exam.label} (${exam.exam_date})`
        : exam?.label || exam?.exam_date || "";
    return row?.absent ? (
      <Card title="모의고사 점수">
        <Notice title="미응시" last>
          {name}
          <br />
          해당 모의고사에 응시하지 않았습니다.
        </Notice>
      </Card>
    ) : (
      <div className="empty-msg">해당 모의고사에 응시하지 않았습니다.</div>
    );
  }
  const items = activeItems(exam, true);
  const ids = (exam?.group_id && data.mockGroupExamMap?.[exam.group_id]) || [
    id,
  ];
  const total = mockTotal(row, items);
  const result = stats(
    total,
    data.mockRankScores
      .filter((s) => ids.includes(s.exam_id!))
      .map((s) => mockTotal(s, items)),
  );
  const showItems =
    items.some((i) => itemVal(row, i.key) != null) &&
    (items.length > 1 ||
      items.some((i) => isBelowCut(itemVal(row, i.key), i.cut)));
  return (
    <Card
      title="모의고사 점수"
      aside={
        <Total value={total} max={items.reduce((a, i) => a + (i.max || 0), 0)} />
      }
    >
      {showItems && (
        <table className={`score-table items-${items.length}`} aria-label="모의고사 항목별 점수">
          <thead><tr><th scope="col">평가 항목</th><th scope="col">점수 / 만점</th><th scope="col">확인 사항</th></tr></thead>
          <tbody>{items.map((item) => <ItemCell key={item.key} item={item} row={row} />)}</tbody>
        </table>
      )}
      <div className="meta-grid">
        <Meta
          label="평균"
          value={result.average === null ? "-" : `${result.average}점`}
        />
        <Meta
          label="석차"
          value={result.rank === null ? "-" : `${result.rank}등`}
        />
        <Meta label="응시 인원" value={`${result.count}명`} />
      </div>
      {row.memo && (
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--gray)" }}>
          {row.memo}
        </div>
      )}
    </Card>
  );
}
function ScoreChart({ data }: { data: LoginData }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const series = trend(data.weeks, data.myScores);
    const chart = new Chart(canvas.current, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [
          {
            label: "총점",
            data: series.values,
            borderColor: "#6236b5",
            backgroundColor: "rgba(98,54,181,0.08)",
            borderWidth: 2.5,
            pointBackgroundColor: "#6236b5",
            pointRadius: 5,
            pointHoverRadius: 7,
            tension: 0,
            fill: false,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        animation: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? false
          : undefined,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}점` } },
        },
        scales: {
          y: {
            min: 0,
            max: series.max,
            ticks: { font: { size: 11 }, color: "#6b6b6b" },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
          x: {
            ticks: { font: { size: 11 }, color: "#6b6b6b" },
            grid: { display: false },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [data]);
  return (
    <div className="card" id="chart-card">
      <div className="card-header">
        <h2>점수 추이</h2>
      </div>
      <div className="chart-wrap">
        <canvas
          id="score-chart"
          ref={canvas}
          role="img"
          aria-label="주차별 총점 추이"
        />
      </div>
    </div>
  );
}
export default function Scores({
  data,
  onLogout,
  onStudy,
}: {
  data: LoginData;
  onLogout: () => void;
  onStudy?: (target: "vocab" | "passage") => void;
}) {
  const periods = useMemo(() => {
    const weeks = sortByDateDesc(
      data.weeks,
      (w) => w.test_date || w.label || "",
    );
    const exams = sortByDateDesc(
      data.exams.filter((e) => {
        const row = data.myMockScores.find((s) => s.exam_id === e.id);
        return hasMockScore(row) || row?.absent === true;
      }),
      (e) => e.exam_date || e.label || "",
    );
    const options = sortByDateDesc(
      [
        ...weeks.map((w) => ({
          value: `w${w.id}`,
          date: w.test_date || w.label || "",
          text: `${w.label || w.test_date}${data.myScores.find((s) => s.week_id === w.id)?.attendance === false ? " — 결석" : ""}`,
        })),
        ...exams.map((e) => ({
          value: `m${e.id}`,
          date: e.exam_date || e.label || "",
          text:
            (e.label && e.exam_date && e.label !== e.exam_date
              ? `${e.label} (${e.exam_date})`
              : `모의고사 (${e.exam_date || e.label})`) +
            (hasMockScore(data.myMockScores.find((s) => s.exam_id === e.id))
              ? ""
              : " — 미응시"),
        })),
      ],
      (p) => p.date,
    );
    return {
      options,
      initial: weeks.length
        ? `w${weeks[0].id}`
        : exams.length
          ? `m${exams[0].id}`
          : "",
    };
  }, [data]);
  const [selected, setSelected] = useState(periods.initial);
  const mock = selected.startsWith("m");
  const id = Number(selected.slice(1));
  const cumulative = summary(data.weeks, data.myScores);
  const clinicMemo = !mock ? data.myScores.find((row) => row.week_id === id)?.clinic_memo?.trim() : undefined;
  const records = sortByDateDesc(
    data.weeks,
    (week) => week.test_date || week.label || "",
  ).map((week) => {
    const row = data.myScores.find((score) => score.week_id === week.id);
    const items = activeItems(week);
    return {
      id: week.id,
      label: week.label || week.test_date || "주차",
      total: row ? computeTotal(row, items) : null,
      max: items.reduce((sum, item) => sum + (item.max || 0), 0),
      absent: row?.attendance === false,
    };
  });
  return (
    <section id="result-section" style={{ display: "block" }}>
      <div className="score-heading">
        <div>
          <h1>나의 성적 기록</h1>
          <p>시험별 결과와 다시 확인할 내용을 살펴보세요.</p>
        </div>
        <select
          className="period-select"
          id="period-select"
          aria-label="주차 선택"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!periods.options.length}
        >
          {periods.options.length ? (
            periods.options.map((p) => (
              <option key={p.value} value={p.value}>
                {p.text}
              </option>
            ))
          ) : (
            <option value="">등록된 주차가 없습니다.</option>
          )}
        </select>
      </div>
      <div className="score-layout">
        <div className="score-detail">
          <div id="score-content" style={{ display: mock ? "none" : "block" }}>
            {selected && !mock ? (
              <WeeklyScore data={data} id={id} />
            ) : (
              <div className="empty-msg">주차를 선택해주세요.</div>
            )}
          </div>
          <div
            id="mock-score-section"
            style={{ display: mock ? "block" : "none" }}
          >
            {mock && <MockScore data={data} id={id} />}
          </div>
        </div>
        <aside className="score-history" aria-label="학습 기록과 다음 공부">
          {clinicMemo && (
            <section className="clinic-section">
              <h2>클리닉 안내</h2>
              {clinicMemo.split("\n").map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </section>
          )}
          {!mock && data.myScores.length > 0 && (
            <>
              <div className="summary-grid" id="summary-grid">
                <div className="summary-item">
                  <div className="summary-label">누적 평균</div>
                  <div className="summary-value" id="cum-avg">
                    {cumulative.average === null
                      ? "-"
                      : `${cumulative.average}점`}
                  </div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">최고 점수</div>
                  <div className="summary-value" id="cum-best">
                    {cumulative.best === null ? "-" : `${cumulative.best}점`}
                  </div>
                </div>
              </div>
              <ScoreChart data={data} />
              <div className="score-records">
                <table>
                  <caption>주차별 기록</caption>
                  <thead>
                    <tr>
                      <th scope="col">주차</th>
                      <th scope="col">점수 / 만점</th>
                      <th scope="col">직전 대비</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record, index) => (
                      <tr key={record.id}>
                        <th scope="row">
                          {record.label}
                          {record.absent && <small>결석 기록</small>}
                        </th>
                        <td>
                          {record.total ?? "—"} / {record.max}
                        </td>
                        <td>{scoreChange(record, records[index + 1])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  결석 기록은 평균에 포함돼요. 만점이 다르거나 결석·미기재
                  기록이 있으면 증감을 비교하지 않아요.
                </p>
              </div>
            </>
          )}
          {onStudy && (
            <section className="next-study">
              <h2>이어서 공부하기</h2>
              <p>결과를 확인했다면 연습으로 이어가요.</p>
              <button onClick={() => onStudy("vocab")}>
                단어 연습하기 <span aria-hidden="true">→</span>
              </button>
              <button onClick={() => onStudy("passage")}>
                지문 읽기 <span aria-hidden="true">→</span>
              </button>
            </section>
          )}
        </aside>
      </div>
      <button className="btn btn-secondary" onClick={onLogout}>
        ← 다른 학생 조회
      </button>
    </section>
  );
}

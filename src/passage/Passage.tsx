import { useState, useEffect } from "react";
import "../styles/learning.css";
const passages = [
  {
    id: "01",
    title: "01 작은 도서관",
    en: [
      "① Our town has a small library.",
      "② People share books and ideas there.",
    ],
    ko: [
      "① 우리 마을에는 작은 도서관이 있다.",
      "② 사람들은 그곳에서 책과 생각을 나눈다.",
    ],
    words: [
      ["library", "도서관"],
      ["share", "나누다"],
    ],
  },
  {
    id: "02",
    title: "02 함께 가꾸는 정원",
    en: [
      "① We grow vegetables in a shared garden.",
      "② Each person brings a different skill.",
    ],
    ko: [
      "① 우리는 공동 정원에서 채소를 기른다.",
      "② 각 사람은 서로 다른 기술을 가져온다.",
    ],
    words: [
      ["vegetable", "채소"],
      ["skill", "기술"],
    ],
  },
];
function params() {
  const url = new URL(location.href);
  return import.meta.env.BASE_URL === "/"
    ? url.searchParams
    : new URL(url.hash.slice(1) || "/", url.origin).searchParams;
}
function initial() {
  const q = params();
  const i = passages.findIndex((p) => p.id === q.get("p"));
  return { group: q.get("g") === "demo-reading", index: i };
}
export default function Passage({ onExit }: { onExit?: () => void }) {
  const [view, setView] = useState(initial);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    const sync = () => {
      setView(initial());
      setRevealed([]);
      setWhole(false);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const selected = view.group && view.index >= 0 ? passages[view.index] : null;
  function select(group: boolean, index = -1) {
    setView({ group, index });
    setRevealed([]);
    setWhole(false);
    const q = new URLSearchParams({ go: "passage" });
    if (group) q.set("g", "demo-reading");
    if (index >= 0) q.set("p", passages[index].id);
    const path = "/vocab/?" + q;
    history.replaceState(
      {},
      "",
      import.meta.env.BASE_URL === "/"
        ? path
        : import.meta.env.BASE_URL + "#" + path,
    );
  }
  return (
    <div className="passage-app">
      <div className="wrap">
        <h1 className="title">지문 공부</h1>
        <ol className="learning-path" aria-label="읽기 순서">
          <li aria-current={!selected ? "step" : undefined}>지문 선택</li>
          <li aria-current={selected && !whole ? "step" : undefined}>
            한 문장씩 읽기
          </li>
          <li aria-current={whole ? "step" : undefined}>해석 · 단어 확인</li>
        </ol>
        <p className="demo-disclosure">
          직접 작성한 데모 지문입니다. 원문·해석만 제공하며 AI 채점이나 서버
          조회는 하지 않습니다.
        </p>
        <div className="study-actions">
          <button className="day-chip" onClick={() => select(false)}>
            시험 범위 목록
          </button>
          {onExit && (
            <button className="day-chip" onClick={onExit}>
              성적 확인으로 돌아가기
            </button>
          )}
        </div>
        {!view.group ? (
          <div className="grid">
            <button className="grade-card" onClick={() => select(true)}>
              <span className="g-eyebrow">지문</span>
              <span className="g-name">데모 읽기</span>
              <span className="g-meta">지문 2개</span>
            </button>
          </div>
        ) : !selected ? (
          <section className="panel">
            <h2>데모 읽기</h2>
            <p>
              번호를 누르면 원문이 열리고, 문장을 누르면 해석을 볼 수 있어요.
            </p>
            <div className="day-grid">
              {passages.map((p, i) => (
                <button
                  key={p.id}
                  className="day-chip"
                  onClick={() => select(true, i)}
                >
                  {p.title}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="panel">
            <h2>{selected.title}</h2>
            <p className="counter">
              데모 읽기 · {view.index + 1}/{passages.length}
            </p>
            <p className="psg-tip">
              영어 문장을 누르면 그 문장의 해석이 펼쳐져요.
            </p>
            <div className="psg-en">
              {selected.en.map((sentence, i) => (
                <span key={sentence}>
                  <button
                    className="sen"
                    aria-expanded={revealed.includes(i)}
                    onClick={() =>
                      setRevealed((prev) =>
                        prev.includes(i)
                          ? prev.filter((n) => n !== i)
                          : [...prev, i],
                      )
                    }
                  >
                    {sentence}
                  </button>
                  {revealed.includes(i) && (
                    <span className="sen-ko">{selected.ko[i]}</span>
                  )}{" "}
                </span>
              ))}
            </div>
            <button
              className="psg-kobtn"
              aria-expanded={whole}
              onClick={() => setWhole(!whole)}
            >
              {whole ? "해석 · 단어 접기" : "해석 · 단어 보기"} ▾
            </button>
            {whole && (
              <div>
                <div className="psg-ko">{selected.ko.join(" ")}</div>
                <h3 className="psg-words-t">WORDS &amp; EXPRESSIONS</h3>
                <div className="psg-words">
                  {selected.words.map(([w, m]) => (
                    <div className="vrow" key={w}>
                      <span className="vw">{w}</span>
                      <span className="vm">{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="study-actions">
              <button
                className="day-chip"
                disabled={view.index === 0}
                onClick={() => select(true, view.index - 1)}
              >
                이전 지문
              </button>
              <button className="day-chip" onClick={() => select(true)}>
                지문 목록
              </button>
              <button
                className="day-chip"
                disabled={view.index === passages.length - 1}
                onClick={() => select(true, view.index + 1)}
              >
                다음 지문
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

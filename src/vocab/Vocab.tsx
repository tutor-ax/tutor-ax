import { useState } from "react";
import {
  WORDS,
  KEY,
  loadProgress,
  recordAnswer,
  type Progress,
  type Word,
} from "./model";
import "../styles/learning.css";
import Quiz, { type QuizMode } from "./Quiz";
type View =
  | "home"
  | "days"
  | "modes"
  | "flash"
  | "favorites"
  | "wrong"
  | "quiz";
export default function Vocab({ onExit }: { onExit?: () => void }) {
  const [view, setView] = useState<View>("home");
  const [days, setDays] = useState<string[]>([]);
  const [scope, setScope] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [flip, setFlip] = useState(false);
  const [progress, setProgress] = useState(loadProgress);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<QuizMode>("type-ko");
  const [confirmReset, setConfirmReset] = useState(false);
  const word = scope[index];
  function save(next: Progress) {
    setProgress(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setNotice("이 브라우저에 저장했습니다.");
    } catch {
      setNotice("브라우저 저장소를 사용할 수 없어 이번 화면에서만 유지됩니다.");
    }
  }
  function favorite(w: Word) {
    save({
      ...progress,
      favorites: progress.favorites.includes(w.id)
        ? progress.favorites.filter((id) => id !== w.id)
        : [...progress.favorites, w.id],
    });
  }
  function start(words: Word[]) {
    setScope(words);
    setIndex(0);
    setFlip(false);
    setView("modes");
  }
  const list =
    view === "favorites"
      ? WORDS.filter((w) => progress.favorites.includes(w.id))
      : WORDS.filter((w) => progress.wrong.includes(w.id));
  return (
    <div className="vocab-app">
      <div className="wrap">
        <h1 className="title">단어 공부</h1>
        <ol className="learning-path" aria-label="학습 순서">
          <li
            aria-current={
              view === "home" || view === "days" ? "step" : undefined
            }
          >
            범위 선택
          </li>
          <li
            aria-current={
              ["modes", "flash", "quiz"].includes(view) ? "step" : undefined
            }
          >
            연습하기
          </li>
          <li
            aria-current={
              view === "favorites" || view === "wrong" ? "step" : undefined
            }
          >
            모아 복습
          </li>
        </ol>
        <p className="demo-disclosure">
          합성 단어 8개 · 이 브라우저에만 기록 · AI/서버 채점 연결 없음
        </p>
        {confirmReset && (
          <section
            className="panel"
            role="alertdialog"
            aria-label="학습 기록 초기화"
          >
            <p>이 브라우저의 단어 즐겨찾기·오답 기록만 지웁니다.</p>
            <button
              className="day-chip"
              onClick={() => {
                save({ favorites: [], wrong: [], streak: {} });
                setConfirmReset(false);
                setView("home");
              }}
            >
              초기화 확인
            </button>
            <button className="day-chip" onClick={() => setConfirmReset(false)}>
              취소
            </button>
          </section>
        )}
        <div className="study-actions">
          <button className="day-chip" onClick={() => setView("home")}>
            단어 홈
          </button>
          <button className="day-chip" onClick={() => setView("favorites")}>
            ★ 즐겨찾기 {progress.favorites.length}
          </button>
          <button className="day-chip" onClick={() => setView("wrong")}>
            오답노트 {progress.wrong.length}
          </button>
          <button className="day-chip" onClick={() => setConfirmReset(true)}>
            학습 기록 초기화
          </button>
          {onExit && (
            <button className="day-chip" onClick={onExit}>
              성적 확인으로 돌아가기
            </button>
          )}
        </div>
        <p role="status">{notice}</p>
        {view === "home" && (
          <>
            <p className="subtitle">오늘의 단어를 시작해요</p>
            <div className="grid">
              <button className="grade-card" onClick={() => setView("days")}>
                <span className="g-eyebrow">단어장</span>
                <span className="g-name">데모 기본 어휘</span>
                <span className="g-meta">2 DAY · 8 단어</span>
              </button>
            </div>
          </>
        )}
        {view === "days" && (
          <section className="panel">
            <h2>범위 선택</h2>
            <div className="day-grid">
              <button
                className="day-chip all"
                onClick={() => setDays(["01", "02"])}
              >
                전체 선택
              </button>
              {["01", "02"].map((day) => (
                <button
                  className={`day-chip ${days.includes(day) ? "on" : ""}`}
                  aria-pressed={days.includes(day)}
                  key={day}
                  onClick={() =>
                    setDays((prev) =>
                      prev.includes(day)
                        ? prev.filter((d) => d !== day)
                        : [...prev, day],
                    )
                  }
                >
                  DAY {day}
                  <span className="d-count"> · 4단어</span>
                </button>
              ))}
            </div>
            <div className="pick-bar">
              <span className="pk-txt">{days.length}개 DAY 선택</span>
              <button
                className="pk-go"
                disabled={!days.length}
                onClick={() => start(WORDS.filter((w) => days.includes(w.day)))}
              >
                선택 범위 학습
              </button>
            </div>
          </section>
        )}
        {view === "modes" && (
          <section className="panel">
            <h2>학습 방법 선택</h2>
            <p className="scope-banner">선택 범위 · {scope.length}단어</p>
            <div className="mode-row">
              <button className="mode-btn" onClick={() => setView("flash")}>
                <span className="m-title">플래시카드</span>
              </button>
              {(
                [
                  ["type-ko", "뜻 쓰기"],
                  ["type-en", "영단어 쓰기"],
                  ["choice-ko", "뜻 고르기"],
                  ["choice-en", "영단어 고르기"],
                ] as const
              ).map(([value, label]) => (
                <button
                  className="mode-btn"
                  key={value}
                  onClick={() => {
                    setMode(value);
                    setView("quiz");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        {view === "quiz" && (
          <Quiz
            words={scope}
            mode={mode}
            onExit={() => setView("modes")}
            onAnswer={(w, correct) => {
              save(recordAnswer(progress, w.id, correct));
            }}
          />
        )}
        {view === "flash" && word && (
          <section className="stage">
            <p className="counter">
              {index + 1} / {scope.length}
            </p>
            <div className="flashcard">
              <div className="fc-face">
                <div className="fc-word">{flip ? word.ko : word.en}</div>
                <span className="fc-pos">{word.pos}</span>
                <button className="day-chip" onClick={() => setFlip(!flip)}>
                  {flip ? "영단어 보기" : "뜻 보기"}
                </button>
              </div>
            </div>
            <div className="study-actions">
              <button
                className="day-chip"
                onClick={() => favorite(word)}
                aria-label={
                  progress.favorites.includes(word.id)
                    ? "즐겨찾기 해제"
                    : "즐겨찾기 추가"
                }
              >
                {progress.favorites.includes(word.id) ? "★" : "☆"}
              </button>
              <button
                className="day-chip"
                disabled={index === 0}
                onClick={() => {
                  setIndex(index - 1);
                  setFlip(false);
                }}
              >
                이전 단어
              </button>
              <button
                className="day-chip"
                disabled={index === scope.length - 1}
                onClick={() => {
                  setIndex(index + 1);
                  setFlip(false);
                }}
              >
                다음 단어
              </button>
              <button className="day-chip" onClick={() => setView("modes")}>
                학습 방법 선택
              </button>
            </div>
          </section>
        )}
        {(view === "favorites" || view === "wrong") && (
          <section className="panel">
            <h2>{view === "favorites" ? "즐겨찾기" : "오답노트"}</h2>
            {!list.length ? (
              <div className="review-empty">
                <p>아직 저장된 단어가 없어요.</p>
                <p>
                  {view === "wrong"
                    ? "문제를 풀면 틀린 단어가 여기에 모여요."
                    : "플래시카드에서 즐겨찾기에 추가한 단어를 여기서 다시 볼 수 있어요."}
                </p>
                <button className="day-chip" onClick={() => setView("days")}>
                  단어 범위 선택하기
                </button>
              </div>
            ) : (
              <>
                <div className="psg-words">
                  {list.map((w) => (
                    <div className="vrow" key={w.id}>
                      <span className="vw">{w.en}</span>
                      <span className="vm">{w.ko}</span>
                      <button
                        aria-label={`${w.en} 즐겨찾기`}
                        onClick={() => favorite(w)}
                      >
                        {progress.favorites.includes(w.id) ? "★" : "☆"}
                      </button>
                    </div>
                  ))}
                </div>
                <button className="day-chip" onClick={() => start(list)}>
                  이 단어들 학습
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { WORDS, type Word } from "./model";
export type QuizMode = "type-ko" | "type-en" | "choice-ko" | "choice-en";
const normalize = (text: string) =>
  text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export default function Quiz({
  words,
  mode,
  onAnswer,
  onExit,
}: {
  words: Word[];
  mode: QuizMode;
  onAnswer: (word: Word, correct: boolean) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0),
    [answer, setAnswer] = useState(""),
    [results, setResults] = useState<boolean[]>([]),
    [done, setDone] = useState(false);
  const word = words[index];
  const english = mode.endsWith("en");
  const expected = english ? word.en : word.ko;
  const locked = results.length > index;
  const options = [
    expected,
    ...WORDS.filter((w) => w.id !== word.id)
      .slice(0, 3)
      .map((w) => (english ? w.en : w.ko)),
  ].sort((a, b) => a.localeCompare(b));
  function submit(value = answer) {
    if (locked || !value.trim()) return;
    const ok = normalize(value) === normalize(expected);
    setAnswer(value);
    setResults((prev) => [...prev, ok]);
    onAnswer(word, ok);
  }
  function next() {
    if (index === words.length - 1) {
      setDone(true);
      return;
    }
    setIndex(index + 1);
    setAnswer("");
  }
  if (done)
    return (
      <section className="panel">
        <h2>학습 결과</h2>
        <p>
          정답 {results.filter(Boolean).length} / {words.length}
        </p>
        <p>틀린 단어는 오답노트에 저장했어요.</p>
        <button
          className="day-chip"
          onClick={() => {
            setIndex(0);
            setAnswer("");
            setResults([]);
            setDone(false);
          }}
        >
          다시 풀기
        </button>
        <button className="day-chip" onClick={onExit}>
          학습 방법 선택
        </button>
      </section>
    );
  return (
    <section className="panel">
      <p className="counter">
        {index + 1} / {words.length}
      </p>
      <h2>{english ? word.ko : word.en}</h2>
      <p>
        정해진 데모 정답과 비교합니다. 동의어·품사 추론·AI 판정은 지원하지
        않습니다.
      </p>
      {mode.startsWith("choice") ? (
        <div className="mode-row">
          {options.map((option) => (
            <button
              className="mode-btn"
              disabled={locked}
              onClick={() => submit(option)}
              key={option}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="quiz-answer">답안</label>
          <input
            id="quiz-answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={locked}
            autoComplete="off"
          />
          <button
            className="day-chip"
            type="submit"
            disabled={locked || !answer.trim()}
          >
            정답 확인
          </button>
        </form>
      )}
      {locked && (
        <div role="status">
          <p>{results[index] ? "정답입니다." : `오답 · 정답: ${expected}`}</p>
          <button className="day-chip" onClick={next}>
            {index === words.length - 1 ? "결과 보기" : "다음 문제"}
          </button>
        </div>
      )}
    </section>
  );
}

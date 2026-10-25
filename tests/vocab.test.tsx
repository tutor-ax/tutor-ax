import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Vocab from "../src/vocab/Vocab";
it("grades the typed demo quiz once per question and records wrong answers", () => {
  render(<Vocab />);
  fireEvent.click(screen.getByRole("button", { name: /데모 기본 어휘/ }));
  fireEvent.click(screen.getByRole("button", { name: /DAY 01/ }));
  fireEvent.click(screen.getByRole("button", { name: "선택 범위 학습" }));
  fireEvent.click(screen.getByRole("button", { name: "뜻 쓰기" }));
  fireEvent.change(screen.getByLabelText("답안"), {
    target: { value: "틀린 답" },
  });
  fireEvent.click(screen.getByRole("button", { name: "정답 확인" }));
  expect(screen.getByText(/오답 · 정답: 사과/)).toBeVisible();
  expect(screen.getByRole("button", { name: "정답 확인" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /오답노트/ }));
  expect(screen.getByText("apple")).toBeVisible();
});
it("clears only vocabulary demo records after explicit confirmation", () => {
  localStorage.setItem("keep-other-app", "untouched");
  localStorage.setItem(
    "tutor-ax.vocab-demo.v1",
    JSON.stringify({
      favorites: ["데모 기본 어휘|01|apple"],
      wrong: [],
      streak: {},
    }),
  );
  render(<Vocab />);
  fireEvent.click(screen.getByRole("button", { name: "학습 기록 초기화" }));
  expect(screen.getByRole("button", { name: /즐겨찾기 1/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "초기화 확인" }));
  expect(screen.getByRole("button", { name: /즐겨찾기 0/ })).toBeVisible();
  expect(localStorage.getItem("keep-other-app")).toBe("untouched");
});
afterEach(cleanup);
beforeEach(() => localStorage.clear());
it("selects chapters, reveals flashcards and retains favorites after reopening", () => {
  const { unmount } = render(<Vocab />);
  fireEvent.click(screen.getByRole("button", { name: /데모 기본 어휘/ }));
  fireEvent.click(screen.getByRole("button", { name: /DAY 01/ }));
  fireEvent.click(screen.getByRole("button", { name: "선택 범위 학습" }));
  fireEvent.click(screen.getByRole("button", { name: /플래시카드/ }));
  expect(screen.getByText("apple")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "뜻 보기" }));
  expect(screen.getByText("사과")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "즐겨찾기 추가" }));
  unmount();
  render(<Vocab />);
  fireEvent.click(screen.getByRole("button", { name: /즐겨찾기/ }));
  expect(screen.getByText("apple")).toBeVisible();
});

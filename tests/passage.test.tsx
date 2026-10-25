import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Passage from "../src/passage/Passage";
afterEach(() => {
  cleanup();
  history.replaceState({}, "", "/");
});
it("opens synthetic passage and reveals individual or whole translations", () => {
  render(<Passage />);
  fireEvent.click(screen.getByRole("button", { name: /데모 읽기/ }));
  fireEvent.click(screen.getByRole("button", { name: "01 작은 도서관" }));
  expect(
    screen.queryByText("① 우리 마을에는 작은 도서관이 있다."),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "① Our town has a small library." }),
  );
  expect(screen.getByText("① 우리 마을에는 작은 도서관이 있다.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /해석 · 단어 보기/ }));
  expect(screen.getByText("library")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다음 지문" }));
  expect(screen.getByText("02 함께 가꾸는 정원")).toBeVisible();
});

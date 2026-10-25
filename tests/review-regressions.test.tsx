import { afterEach, beforeEach, it, expect } from "vitest";
import {
  cleanup,
  render,
  fireEvent,
  screen,
  act,
} from "@testing-library/react";
import Admin from "../src/admin/Admin";
import Passage from "../src/passage/Passage";
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/");
});
it("round-trips a long valid memo without losing access to scores", () => {
  const view = render(<Admin />);
  fireEvent.change(screen.getByLabelText("가상 학생 A 단어 점수"), {
    target: { value: "61" },
  });
  fireEvent.click(screen.getByRole("button", { name: "조교 메모" }));
  fireEvent.change(screen.getByLabelText("메모 작성자"), {
    target: { value: "가상 조교" },
  });
  fireEvent.change(screen.getByLabelText("메모 내용"), {
    target: { value: "가".repeat(10000) },
  });
  fireEvent.click(screen.getByRole("button", { name: "메모 등록" }));
  view.unmount();
  render(<Admin />);
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(61);
});
it("updates the passage when browser history changes within the same route", () => {
  history.replaceState({}, "", "/vocab/?go=passage&g=demo-reading&p=01");
  render(<Passage />);
  expect(screen.getByRole("heading", { name: "01 작은 도서관" })).toBeVisible();
  act(() => {
    history.pushState({}, "", "/vocab/?go=passage&g=demo-reading&p=02");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(
    screen.getByRole("heading", { name: "02 함께 가꾸는 정원" }),
  ).toBeVisible();
});

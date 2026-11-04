import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/App";
import { signedIn, signedOut } from "./fixtures";
vi.mock("chart.js/auto", () => ({
  default: class {
    destroy() {}
  },
}));
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/");
});
it("displays the academy logo in the shared header", () => {
  render(<App gateway={signedOut()} />);
  expect(screen.getByRole("img", { name: "학원 로고" })).toHaveAttribute(
    "src",
    expect.stringContaining("academy-logo"),
  );
});
it("opens administrator directly without asking for a real student identity", async () => {
  history.replaceState({}, "", "/admin.html");
  render(<App gateway={signedIn()} />);
  expect(await screen.findByTestId("admin-workspace")).toBeVisible();
  expect(
    screen.queryByLabelText("학부모 연락처 뒷 4자리"),
  ).not.toBeInTheDocument();
});
it("never looks up a student session on the administrator route", async () => {
  const resume = vi.fn(async () => null);
  history.replaceState({}, "", "/admin.html");
  render(
    <App gateway={{ resume, login: async () => signedIn().login("", ""), logout: async () => {} }} />,
  );
  expect(await screen.findByTestId("admin-workspace")).toBeVisible();
  // Admin is independent of the student login; calling resume here would send
  // a student lookup from an unrelated workspace.
  expect(resume).not.toHaveBeenCalled();
});
it("routes student tabs to working study screens instead of migration placeholders", async () => {
  render(<App gateway={signedIn()} />);
  await screen.findByText("데모 학생");
  fireEvent.click(screen.getByRole("button", { name: "단어 공부" }));
  expect(await screen.findByTestId("vocab-workspace")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "지문 공부" }));
  expect(await screen.findByTestId("passage-workspace")).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "마이그레이션 예정 화면" }),
  ).not.toBeInTheDocument();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import App from "../src/App";
import { createDemoGateway } from "../src/gateway";
import Chart from "chart.js/auto";

vi.mock("chart.js/auto", () => ({
  default: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/");
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
it("respects reduced motion when drawing the score chart", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  render(<App gateway={createDemoGateway(localStorage)} />);
  fireEvent.click(await screen.findByTestId("demo-login"));
  await screen.findByText("데모 학생");
  expect(vi.mocked(Chart).mock.calls[0][1].options?.animation).toBe(false);
});
it("opens the synthetic score screen with dynamic items and original retest scores", async () => {
  render(<App gateway={createDemoGateway(localStorage)} />);
  fireEvent.click(await screen.findByTestId("demo-login"));
  expect(await screen.findByText("데모 학생")).toBeInTheDocument();
  expect(screen.getByText("추가 어휘")).toBeInTheDocument();
  expect(screen.getByText("재시험 통과")).toBeInTheDocument();
  expect(screen.getByText("재시험 대상")).toBeInTheDocument();
  expect(document.querySelector(".score-value")?.textContent).toContain("18");
  expect(document.querySelector("#period-select")).toHaveValue("w103");
  expect(document.querySelector("#cum-avg")).toHaveTextContent("59.3점");
  expect(screen.getByTestId("demo-notice")).toHaveTextContent("운영");
  fireEvent.click(screen.getByRole("button", { name: "← 다른 학생 조회" }));
  await waitFor(() =>
    expect(screen.getByText("학생 로그인")).toBeInTheDocument(),
  );
});

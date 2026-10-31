import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/App";
import { createDemoGateway } from "../src/gateway";
vi.mock("chart.js/auto", () => ({
  default: class {
    destroy() {}
  },
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState({}, "", "/");
});
it("provides an accessible notebook shell with a main-content skip link", async () => {
  render(<App gateway={createDemoGateway(localStorage)} />);
  expect(
    screen.getByRole("link", { name: "본문으로 건너뛰기" }),
  ).toHaveAttribute("href", "#student-main");
  expect(screen.getByRole("heading", { name: "나의 영어 노트" })).toBeVisible();
  fireEvent.click(await screen.findByTestId("demo-login"));
  await screen.findByText("데모 학생");
  expect(screen.getByRole("button", { name: "점수 확인" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("table", { name: "주차별 기록" })).toHaveTextContent(
    "93 / 130",
  );
  fireEvent.click(screen.getByRole("button", { name: "단어 공부" }));
  expect(
    screen.getByLabelText("학습 순서").querySelector('[aria-current="step"]'),
  ).toHaveTextContent("범위 선택");
});
it.each(["/admin", "/admin/", "/admin.html", "/#/admin", "/#/admin/"])(
  "renders %s with only the existing administrator shell",
  async (path) => {
    history.replaceState({}, "", path);
    const { container } = render(
      <App gateway={createDemoGateway(localStorage)} />,
    );
    expect(await screen.findByTestId("admin-workspace")).toBeVisible();
    expect(container.querySelector(".site-header")).toBeNull();
    expect(container.querySelector(".container")).toBeNull();
    expect(container.querySelector(".demo-notice")).toBeNull();
    expect(container.querySelectorAll("header")).toHaveLength(1);
  },
);

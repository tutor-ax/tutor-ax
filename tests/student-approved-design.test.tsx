import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../src/App";
import { createDemoGateway } from "../src/gateway";
vi.mock("chart.js/auto", () => ({ default: class { destroy() {} } }));
afterEach(() => { cleanup(); localStorage.clear(); history.replaceState({}, "", "/"); });
it("aligns dynamic score items in a semantic table and keeps clinic in the supporting column", async () => {
  render(<App gateway={createDemoGateway(localStorage)} />);
  fireEvent.click(await screen.findByTestId("demo-login"));
  await screen.findByText("데모 학생");
  const table = screen.getByRole("table", { name: "평가 항목별 점수" });
  expect(within(table).getByRole("columnheader", { name: "확인 사항" })).toBeVisible();
  expect(table).toHaveTextContent("재시험 통과");
  expect(table).toHaveTextContent("재시험 대상");
  expect(screen.getByRole("complementary", { name: "학습 기록과 다음 공부" })).toHaveTextContent("클리닉 안내");
  expect(screen.getByRole("table", { name: "주차별 기록" })).toHaveTextContent("93 / 130");
  fireEvent.change(screen.getByLabelText("주차 선택"), { target: { value: "w101" } });
  expect(screen.getByRole("table", { name: "평가 항목별 점수" })).toBeVisible();
});
it("hoists the total into the score card heading and the student label into the header", async () => {
  render(<App gateway={createDemoGateway(localStorage)} />);
  fireEvent.click(await screen.findByTestId("demo-login"));
  await screen.findByText("데모 학생");
  // The total belongs beside the exam name, not as another row of the table.
  const card = document.querySelector("#score-content .card") as HTMLElement;
  const header = card.querySelector(".card-header") as HTMLElement;
  expect(header.querySelector(".total-value")?.textContent).toBe("93");
  expect(header.querySelector(".total-max")?.textContent).toContain("130");
  expect(
    within(screen.getByRole("table", { name: "평가 항목별 점수" })).queryByText(
      "총점",
    ),
  ).toBeNull();
  // The student identity sits in the shared header, not inside the score page.
  const banner = screen.getByRole("banner");
  expect(within(banner).getByText("데모 학생")).toBeVisible();
  expect(
    document.querySelector("#result-section .student-info"),
  ).toBeNull();
  // The period picker moved beside the page title; it must still switch periods.
  const select = screen.getByLabelText("주차 선택");
  expect(select.closest(".score-heading")).not.toBeNull();
  fireEvent.change(select, { target: { value: "m201" } });
  const mockCard = document.querySelector(
    "#mock-score-section .card",
  ) as HTMLElement;
  expect(mockCard).not.toBeNull();
  expect(mockCard.querySelector(".card-header")?.textContent).toContain(
    "모의고사 점수",
  );
  expect(mockCard.querySelector(".total-value")?.textContent).not.toBe("");
});

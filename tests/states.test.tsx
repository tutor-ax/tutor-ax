import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import fixture from "../src/data/demo-score.json";
import type { LoginData, ScoreGateway } from "../src/gateway";

vi.mock("chart.js/auto", () => ({
  default: class {
    destroy() {}
  },
}));
afterEach(cleanup);
beforeEach(() => history.replaceState({}, "", "/"));
function gateway(data: LoginData): ScoreGateway {
  return {
    resume: async () => data,
    openDemo: async () => data,
    logout: async () => {},
  };
}
it("handles no periods without inventing scores or a chart", async () => {
  const empty: LoginData = {
    student: { id: 1, name: "빈 기록 데모" },
    weeks: [],
    myScores: [],
    rankScores: [],
    exams: [],
    myMockScores: [],
    mockRankScores: [],
  };
  render(<App gateway={gateway(empty)} />);
  await screen.findByText("빈 기록 데모");
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(screen.getByText("등록된 주차가 없습니다.")).toBeInTheDocument();
  expect(screen.queryByText("점수 추이")).not.toBeInTheDocument();
});
it("shows the input-missing state rather than calculating a zero total", async () => {
  const data = structuredClone(fixture) as LoginData;
  data.myScores = [];
  render(<App gateway={gateway(data)} />);
  expect(
    await screen.findByText("해당 주차 점수가 아직 입력되지 않았습니다."),
  ).toBeInTheDocument();
});
it("escapes student, item and clinic text instead of interpreting HTML", async () => {
  const data = structuredClone(fixture) as LoginData;
  data.student.name = "<img src=x onerror=alert(1)>";
  data.weeks[2].item_config!.items![0].label = "<script>bad()</script>";
  data.myScores[2].clinic_memo = "<b>교사 메모</b>\n둘째 줄";
  render(<App gateway={gateway(data)} />);
  expect(await screen.findByText(data.student.name)).toBeInTheDocument();
  expect(screen.getByText("<script>bad()</script>")).toBeInTheDocument();
  expect(screen.getByText("<b>교사 메모</b>")).toBeInTheDocument();
  expect(
    document.querySelector(
      "#result-section img, #result-section script, .notice-body b",
    ),
  ).toBeNull();
});
it("recovers from a session error and a demo load error without fetching", async () => {
  const failing: ScoreGateway = {
    resume: async () => {
      throw Error("unavailable");
    },
    openDemo: async () => {
      throw Error("unavailable");
    },
    logout: async () => {},
  };
  render(<App gateway={failing} />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("세션"));
  fireEvent.click(await screen.findByTestId("demo-login"));
  expect(
    await screen.findByText(
      "데모 데이터를 불러오지 못했습니다. 다시 시도해주세요.",
    ),
  ).toBeInTheDocument();
});
it("never treats typed names and PINs as production authentication", async () => {
  const openDemo = vi.fn(async () => structuredClone(fixture) as LoginData);
  const api: ScoreGateway = {
    resume: async () => null,
    openDemo,
    logout: async () => {},
  };
  render(<App gateway={api} />);
  const button = await screen.findByRole("button", { name: "점수 확인하기" });
  // Wait for initial session lookup before submitting the preserved form.
  await screen.findByTestId("demo-login");
  fireEvent.submit(button.closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "이름과 PIN을 모두 입력해주세요.",
  );
  fireEvent.change(screen.getByLabelText("학생 이름"), {
    target: { value: "테스트 입력" },
  });
  fireEvent.change(screen.getByLabelText("학부모 연락처 뒷 4자리"), {
    target: { value: "0000" },
  });
  fireEvent.submit(button.closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "운영 로그인이 연결되지 않은 개발본",
  );
  expect(screen.getByLabelText("학부모 연락처 뒷 4자리")).toHaveValue("");
  expect(openDemo).not.toHaveBeenCalled();
});
it("direct passage URL keeps its route after demo session restore", async () => {
  history.replaceState({}, "", "/vocab/?go=passage");
  render(<App gateway={gateway(structuredClone(fixture) as LoginData)} />);
  expect(
    await screen.findByRole("heading", { name: "지문 공부" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("passage-workspace")).toBeVisible();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import fixture from "../src/data/demo-score.json";
import {
  GatewayUnavailable,
  InvalidCredentials,
  type LoginData,
  type ScoreGateway,
} from "../src/gateway";
import { signedIn, signedOut } from "./fixtures";

vi.mock("chart.js/auto", () => ({
  default: class {
    destroy() {}
  },
}));
afterEach(cleanup);
beforeEach(() => history.replaceState({}, "", "/"));
const gateway = (data: LoginData): ScoreGateway => signedIn(data);
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
it("keeps the user on the login screen when the session lookup fails", async () => {
  const failing: ScoreGateway = {
    resume: async () => {
      throw new GatewayUnavailable();
    },
    login: async () => {
      throw new GatewayUnavailable();
    },
    logout: async () => {},
  };
  render(<App gateway={failing} />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("세션"));
  // A failed lookup must not strand the user: the form stays usable.
  expect(screen.getByRole("button", { name: "점수 확인하기" })).toBeEnabled();
});
it("reports a rejected PIN without keeping it in the form", async () => {
  const login = vi.fn(async () => {
    throw new InvalidCredentials();
  });
  const api: ScoreGateway = {
    resume: async () => null,
    login,
    logout: async () => {},
  };
  render(<App gateway={api} />);
  const button = await screen.findByRole("button", { name: "점수 확인하기" });
  fireEvent.submit(button.closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "이름과 PIN을 모두 입력해주세요.",
  );
  expect(login).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("학생 이름"), {
    target: { value: "데모 학생" },
  });
  fireEvent.change(screen.getByLabelText("학부모 연락처 뒷 4자리"), {
    target: { value: "0000" },
  });
  fireEvent.submit(button.closest("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "이름 또는 PIN이 올바르지 않습니다.",
    ),
  );
  expect(login).toHaveBeenCalledWith("데모 학생", "0000");
  // A wrong PIN must never linger in the field for the next person.
  expect(screen.getByLabelText("학부모 연락처 뒷 4자리")).toHaveValue("");
});
it("distinguishes an unreachable server from a wrong PIN", async () => {
  const api: ScoreGateway = {
    resume: async () => null,
    login: async () => {
      throw new GatewayUnavailable();
    },
    logout: async () => {},
  };
  render(<App gateway={api} />);
  const button = await screen.findByRole("button", { name: "점수 확인하기" });
  fireEvent.change(screen.getByLabelText("학생 이름"), {
    target: { value: "데모 학생" },
  });
  fireEvent.change(screen.getByLabelText("학부모 연락처 뒷 4자리"), {
    target: { value: "0000" },
  });
  fireEvent.submit(button.closest("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "로그인하지 못했습니다",
    ),
  );
});
it("opens the score screen after a successful login", async () => {
  render(<App gateway={signedOut()} />);
  const button = await screen.findByRole("button", { name: "점수 확인하기" });
  fireEvent.change(screen.getByLabelText("학생 이름"), {
    target: { value: "데모 학생" },
  });
  fireEvent.change(screen.getByLabelText("학부모 연락처 뒷 4자리"), {
    target: { value: "1234" },
  });
  fireEvent.submit(button.closest("form")!);
  expect(await screen.findByText("데모 학생")).toBeInTheDocument();
});
it("direct passage URL keeps its route after session restore", async () => {
  history.replaceState({}, "", "/vocab/?go=passage");
  render(<App gateway={gateway(structuredClone(fixture) as LoginData)} />);
  expect(
    await screen.findByRole("heading", { name: "지문 공부" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("passage-workspace")).toBeVisible();
});

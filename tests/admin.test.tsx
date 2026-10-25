import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Admin from "../src/admin/Admin";

beforeEach(() => localStorage.clear());
it("keeps weekly scores isolated with configurable items and original retest scores", () => {
  render(<Admin />);
  change("가상 학생 A 단어 점수", "40");
  fireEvent.click(screen.getByLabelText("가상 학생 A 단어 재시험 통과"));
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(40);
  change("새 항목 이름", "가상 평가");
  click("항목 추가");
  change("가상 학생 A 가상 평가 점수", "75");
  change("가상 평가 만점", "50");
  expect(screen.getByRole("alert")).toHaveTextContent("점수 범위");
  change("가상 평가 만점", "100");
  click("주차 관리");
  change("새 주차 이름", "2주차");
  click("주차 추가");
  click("점수 입력");
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(null);
  change("주차 선택", "week-1");
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(40);
  expect(screen.getByLabelText("가상 학생 A 단어 재시험 통과")).toBeChecked();
  click("가상 평가 항목 삭제");
  expect(
    screen.queryByLabelText("가상 학생 A 가상 평가 점수"),
  ).not.toBeInTheDocument();
});
it("edits weekly clinic plans and previews SMS without making network requests", () => {
  const network = vi.spyOn(globalThis, "fetch");
  render(<Admin />);
  click("클리닉 배정표");
  change("가상 학생 A 클리닉 메모", "가상 복습 안내");
  change("가상 학생 A 클리닉 요일", "수");
  change("가상 학생 A 클리닉 시간", "16:30");
  click("문자 미리보기");
  expect(
    (screen.getByLabelText("문자 내용") as HTMLTextAreaElement).value,
  ).toContain("가상 복습 안내");
  expect(
    (screen.getByLabelText("문자 내용") as HTMLTextAreaElement).value,
  ).toContain("수 16:30");
  expect(
    screen.getByText("미리보기 전용 · 실제 발송 불가"),
  ).toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});
it("persists snapshots, restores history and resets only its own storage", () => {
  localStorage.setItem("other-app", "keep");
  const first = render(<Admin />);
  change("가상 학생 A 단어 점수", "61");
  click("기록 저장");
  change("가상 학생 A 단어 점수", "92");
  click("기록 저장");
  first.unmount();
  render(<Admin />);
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(92);
  click("변경 이력");
  click("기록 1 복원");
  click("점수 입력");
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(61);
  click("데모 초기화");
  click("초기화 확인");
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(null);
  expect(localStorage.getItem("other-app")).toBe("keep");
});
it("recovers from malformed storage and unavailable browser storage", () => {
  localStorage.setItem("tutor-ax:admin:v1", '{"version":1,"classes":null}');
  const first = render(<Admin />);
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(null);
  first.unmount();
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  render(<Admin />);
  change("가상 학생 A 단어 점수", "21");
  click("기록 저장");
  expect(screen.getByRole("status")).toHaveTextContent("브라우저 저장 불가");
  read.mockRestore();
  write.mockRestore();
});
it("opens the first surviving class after reloading a deleted initial class", () => {
  const view = render(<Admin />);
  click("반 관리");
  change("새 반 이름", "데모 B");
  click("반 추가");
  change("반 선택", "demo-a");
  click("반 삭제");
  view.unmount();
  render(<Admin />);
  click("학생 관리");
  expect(screen.getByLabelText("새 학생 이름")).toBeInTheDocument();
});
it.each([
  "not-json",
  '{"version":1,"classes":[],"weeks":{"x":[null]},"history":[]}',
])("ignores corrupt persisted data: %s", (value) => {
  localStorage.setItem("tutor-ax:admin:v1", value);
  render(<Admin />);
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(null);
});
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
it("manages synthetic classes and students and supports exit", () => {
  const exit = vi.fn();
  render(<Admin onExit={exit} />);
  click("반 관리");
  change("새 반 이름", "데모 C");
  click("반 추가");
  expect(screen.getByRole("option", { name: "데모 C" })).toBeInTheDocument();
  change("반 이름 수정", "데모 D");
  click("반 수정");
  expect(screen.getByRole("option", { name: "데모 D" })).toBeInTheDocument();
  click("학생 관리");
  change("새 학생 이름", "가상 학생 Z");
  click("학생 추가");
  change("가상 학생 Z 이름", "가상 학생 Y");
  click("학생 변경 저장");
  expect(screen.getByLabelText("가상 학생 Y 이름")).toBeInTheDocument();
  click("가상 학생 Y 삭제");
  expect(screen.queryByLabelText("가상 학생 Y 이름")).not.toBeInTheDocument();
  click("반 관리");
  click("반 삭제");
  expect(
    screen.queryByRole("option", { name: "데모 D" }),
  ).not.toBeInTheDocument();
  click("나가기");
  expect(exit).toHaveBeenCalledOnce();
});

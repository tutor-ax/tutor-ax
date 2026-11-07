import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Admin from "../src/admin/Admin";
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
beforeEach(() => localStorage.clear());
it("does not overwrite malformed saved data while showing a usable isolated demo", () => {
  const raw = JSON.stringify({
    version: 1,
    classes: [],
    weeks: {},
    history: [],
    memos: [null],
  });
  localStorage.setItem("tutor-ax:admin:v1", raw);
  render(<Admin />);
  change("가상 학생 A 단어 점수", "12");
  expect(localStorage.getItem("tutor-ax:admin:v1")).toBe(raw);
  expect(screen.getByRole("status")).toHaveTextContent("기존 저장 데이터 보존");
  click("데모 초기화");
  click("초기화 확인");
  expect(localStorage.getItem("tutor-ax:admin:v1")).not.toBe(raw);
});
it("groups clinic students by explicit day/time with unscheduled, pending retest and memo-only entries", () => {
  render(<Admin />);
  change("가상 학생 A 단어 점수", "0");
  click("클리닉 배정표");
  expect(screen.getByLabelText("일정 미정 · 시간 미정")).toHaveTextContent(
    "가상 학생 A",
  );
  expect(screen.getByLabelText("일정 미정 · 시간 미정")).toHaveTextContent(
    "단어",
  );
  change("가상 학생 A 클리닉 요일", "수");
  change("가상 학생 A 클리닉 시간", "16:30");
  change("가상 학생 B 클리닉 메모", "가상 과제 상담");
  const scheduled = screen.getByLabelText("수 · 16:30");
  expect(scheduled).toHaveTextContent("가상 학생 A");
  expect(scheduled).not.toHaveTextContent("가상 학생 B");
  expect(screen.getByLabelText("일정 미정 · 시간 미정")).toHaveTextContent(
    "가상 과제 상담",
  );
  click("점수 입력");
  fireEvent.click(screen.getByLabelText("가상 학생 A 단어 재시험 통과"));
  click("클리닉 배정표");
  expect(screen.getByLabelText("수 · 16:30")).not.toHaveTextContent(
    "남은 재시험: 단어",
  );
  change("가상 학생 A 클리닉 요일", "");
  change("가상 학생 A 클리닉 시간", "");
  expect(screen.queryByLabelText("수 · 16:30")).not.toBeInTheDocument();
  expect(screen.getByLabelText("클리닉 시간별 명단")).not.toHaveTextContent(
    "가상 학생 A",
  );
});
it("creates timestamped teacher memos with required author/content, reloads, restores and confirms deletion", () => {
  const view = render(<Admin />);
  click("조교 메모");
  click("메모 등록");
  expect(screen.getByRole("alert")).toHaveTextContent("작성자와 내용");
  change("메모 작성자", "가상 조교");
  change("메모 내용", "<b>가상 인계</b>");
  click("메모 등록");
  expect(screen.getByText("<b>가상 인계</b>")).toBeInTheDocument();
  expect(
    screen.getByLabelText("메모 목록").querySelector("time"),
  ).toHaveAttribute("datetime");
  click("기록 저장");
  view.unmount();
  render(<Admin />);
  click("조교 메모");
  expect(screen.getByText("가상 조교")).toBeInTheDocument();
  click("메모 삭제");
  click("삭제 취소");
  expect(screen.getByText("<b>가상 인계</b>")).toBeInTheDocument();
  click("메모 삭제");
  click("메모 삭제 확인");
  expect(screen.queryByText("<b>가상 인계</b>")).not.toBeInTheDocument();
  click("변경 이력");
  click("기록 1 복원");
  click("조교 메모");
  expect(screen.getByText("<b>가상 인계</b>")).toBeInTheDocument();
  click("데모 초기화");
  click("초기화 확인");
  expect(screen.queryByText("<b>가상 인계</b>")).not.toBeInTheDocument();
});
it("moves to an empty new class only, copying all original records without overwriting source or destination", () => {
  const view = render(<Admin />);
  change("가상 학생 A 단어 점수", "0");
  fireEvent.click(screen.getByLabelText("가상 학생 A 단어 재시험 통과"));
  click("출석·미인증");
  change("가상 학생 A 1주차 과제 수행률", "42");
  click("반 관리");
  change("새 반 이름", "빈 새 반");
  click("반 추가");
  const dest = (screen.getByLabelText("반 선택") as HTMLSelectElement).value;
  change("반 선택", "demo-a");
  click("학생 관리");
  click("가상 학생 A 반 이동");
  expect(screen.getByRole("dialog")).toHaveTextContent("빈 새 반만");
  change("이동할 반", dest);
  click("이동 취소");
  expect(screen.getByLabelText("가상 학생 A 이름")).toBeInTheDocument();
  click("가상 학생 A 반 이동");
  change("이동할 반", dest);
  click("반 이동 확인");
  expect(screen.getByLabelText("반 선택")).toHaveValue(dest);
  click("점수 입력");
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(0);
  expect(screen.getByLabelText("가상 학생 A 단어 재시험 통과")).toBeChecked();
  click("출석·미인증");
  expect(screen.getByLabelText("가상 학생 A 1주차 과제 수행률")).toHaveValue(
    42,
  );
  change("반 선택", "demo-a");
  click("학생 관리");
  expect(screen.queryByLabelText("가상 학생 A 이름")).not.toBeInTheDocument();
  click("가상 학생 B 반 이동");
  change("이동할 반", dest);
  expect(screen.getByRole("button", { name: "반 이동 확인" })).toBeDisabled();
  click("이동 취소");
  const saved = JSON.parse(localStorage.getItem("tutor-ax:admin:v1")!);
  expect(saved.weeks["demo-a"][0].marks["student-a"].words.score).toBe("0");
  view.unmount();
  render(<Admin />);
  change("반 선택", dest);
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(0);
});
it("tracks attendance and source-derived non-certification across weeks without treating blank as zero", () => {
  const view = render(<Admin />);
  click("출석·미인증");
  expect(screen.getByLabelText("가상 학생 A 1주차 출석")).toBeChecked();
  expect(screen.getByLabelText("미인증 명단")).not.toHaveTextContent(
    "가상 학생 A",
  );
  fireEvent.click(screen.getByLabelText("가상 학생 A 1주차 출석"));
  change("가상 학생 A 1주차 과제 수행률", "0");
  expect(screen.getByLabelText("미인증 명단")).toHaveTextContent("가상 학생 A");
  change("가상 학생 A 1주차 과제 수행률", "80");
  expect(screen.getByLabelText("미인증 명단")).not.toHaveTextContent(
    "가상 학생 A",
  );
  change("가상 학생 A 1주차 과제 평가", "가상 보충");
  expect(screen.getByLabelText("미인증 명단")).toHaveTextContent("가상 학생 A");
  change("가상 학생 A 1주차 과제 평가", "");
  change("가상 학생 A 1주차 과제 수행률", "");
  expect(screen.getByLabelText("미인증 명단")).toHaveTextContent("가상 학생 A");
  click("주차 관리");
  change("새 주차 이름", "2주차");
  click("주차 추가");
  click("출석·미인증");
  expect(screen.getByLabelText("가상 학생 A 2주차 출석")).toBeChecked();
  change("가상 학생 B 2주차 과제 수행률", "101");
  expect(screen.getByRole("alert")).toHaveTextContent("0–100");
  change("가상 학생 B 2주차 과제 수행률", "79");
  view.unmount();
  render(<Admin />);
  click("출석·미인증");
  expect(screen.getByLabelText("가상 학생 A 1주차 출석")).not.toBeChecked();
  expect(screen.getByLabelText("가상 학생 A 1주차 과제 수행률")).toHaveValue(
    null,
  );
  expect(screen.getByLabelText("가상 학생 B 2주차 과제 수행률")).toHaveValue(
    79,
  );
});
it("creates isolated mock exams with dynamic scores, retests and reversible absent status", () => {
  const view = render(<Admin />);
  change("가상 학생 A 단어 점수", "61");
  click("모의고사");
  change("새 모의고사 이름", "가상 6월");
  change("모의고사 날짜", "2026-06-10");
  click("모의고사 추가");
  expect(screen.getByLabelText("가상 학생 A 원점수 합계")).toHaveTextContent(
    "미입력",
  );
  change("가상 학생 A 단어 점수", "0");
  fireEvent.click(screen.getByLabelText("가상 학생 A 단어 재시험 통과"));
  expect(screen.getByLabelText("가상 학생 A 원점수 합계")).toHaveTextContent(
    "0",
  );
  change("새 항목 이름", "듣기");
  click("항목 추가");
  change("가상 학생 A 듣기 점수", "70");
  change("가상 학생 A 모의고사 메모", "가상 안내");
  fireEvent.click(screen.getByLabelText("가상 학생 A 미응시"));
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toBeDisabled();
  expect(screen.getByLabelText("가상 학생 A 원점수 합계")).toHaveTextContent(
    "미응시",
  );
  expect(
    screen.queryByLabelText("가상 학생 A 단어 재시험 통과"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("가상 학생 A 미응시"));
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(0);
  expect(screen.getByLabelText("가상 학생 A 단어 재시험 통과")).toBeChecked();
  const exam = (screen.getByLabelText("모의고사 선택") as HTMLSelectElement)
    .value;
  change("새 모의고사 이름", "가상 7월");
  click("모의고사 추가");
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(null);
  change("모의고사 선택", exam);
  expect(screen.getByLabelText("가상 학생 A 듣기 점수")).toHaveValue(70);
  view.unmount();
  render(<Admin />);
  expect(screen.getByLabelText("가상 학생 A 단어 점수")).toHaveValue(61);
  click("모의고사");
  change("모의고사 선택", exam);
  expect(screen.getByLabelText("가상 학생 A 모의고사 메모")).toHaveValue(
    "가상 안내",
  );
});
it("builds an internal counsel card from the demo records", () => {
  render(<Admin />);
  change("가상 학생 A 단어 점수", "50");
  change("가상 학생 B 단어 점수", "90");
  click("상담 준비");
  change("학생 선택", "student-a");
  const card = (screen.getByLabelText("상담 카드") as HTMLTextAreaElement).value;
  expect(card).toContain("[가상 학생 A · 데모 A]  최근 1주차 기준");
  expect(card).toContain("총점 반 평균 대비: 1주차 -20");
  expect(card).toContain("커트라인 미달 많은 항목: 단어 1/1주");
  expect(card).toContain("재시험 기록: 통과 0 · 미통과 1 (단어 1)");
  expect(card).not.toContain("클리닉: 대상");
});

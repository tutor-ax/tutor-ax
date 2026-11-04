import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Admin from "../src/admin/Admin";

beforeEach(() => localStorage.clear());
it("keeps editable item configuration in four semantic columns as items change", () => {
  render(<Admin />);
  const table = screen.getByRole("table", { name: "채점 항목 설정" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent),
  ).toEqual(["항목명", "만점", "커트라인", "관리"]);
  const verify = () => {
    for (const row of within(table).getAllByRole("row").slice(1)) {
      const cells = within(row).getAllByRole("cell");
      expect(cells).toHaveLength(4);
      expect(cells[0].querySelector("input")).not.toBeNull();
      expect(cells[1].querySelector('input[type="number"]')).not.toBeNull();
      expect(cells[2].querySelector('input[type="number"]')).not.toBeNull();
      expect(within(cells[3]).getByRole("button")).toBeEnabled();
    }
  };
  verify();
  fireEvent.change(screen.getByLabelText("새 항목 이름"), {
    target: { value: "추가 평가 항목 이름이 긴 경우" },
  });
  fireEvent.click(screen.getByRole("button", { name: "항목 추가" }));
  verify();
  expect(within(table).getAllByRole("row")).toHaveLength(4);
  const scores = screen.getByRole("table", { name: "학생별 점수 입력" });
  const headers = within(scores).getAllByRole("columnheader");
  for (const row of within(scores).getAllByRole("row").slice(1)) {
    expect(row.children).toHaveLength(headers.length);
  }
  fireEvent.click(
    screen.getByRole("button", {
      name: "추가 평가 항목 이름이 긴 경우 항목 삭제",
    }),
  );
  expect(within(table).getAllByRole("row")).toHaveLength(3);
});

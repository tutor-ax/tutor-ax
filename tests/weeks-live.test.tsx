import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RosterLive from "../src/admin/RosterLive";
import { dateForDay, fmtMD, resolveBaseDate, sortByTestDate } from "../src/weekDates";

it("follows score-system date rules: year guess at year end, class day in the base week, no fake dates", () => {
  const nov = new Date(2026, 10, 16);
  expect(resolveBaseDate("1.5", nov)?.getFullYear()).toBe(2027);
  expect(resolveBaseDate("2.30", nov)).toBeNull();
  expect(resolveBaseDate("11/16", nov)).toBeNull();
  const base = resolveBaseDate("11.18", nov) as Date; // 수요일
  expect(fmtMD(dateForDay(base, "월") as Date)).toBe("11.16");
  expect(fmtMD(dateForDay(base, "일") as Date)).toBe("11.22");
  expect(dateForDay(base, "월수")).toBeNull();
  const rows = [
    { id: 1, label: "12.28", created_at: "2026-12-20T00:00:00Z" },
    { id: 2, label: "1.4", created_at: "2026-12-30T00:00:00Z" },
    { id: 3, label: "?" },
  ];
  expect(sortByTestDate(rows).map((r) => r.id)).toEqual([2, 1, 3]);
});

it("adds one week per checked class on its class day, as one request", async () => {
  vi.useFakeTimers({ now: new Date(2026, 10, 16), toFake: ["Date"] });
  const posts: unknown[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/roster/classes")
      return Response.json([
        { id: 3, name: "고2 화", grade: "고2", day: "화", time: null },
        { id: 4, name: "고1 목", grade: "고1", day: "목", time: null },
      ]);
    if (u === "/api/admin/roster/weeks" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ group_id: "grp-11.16-1", ids: [1, 2] });
    }
    return new Response("{}", { status: 404 });
  });
  render(<RosterLive mode="weeks" fetchImpl={fetchImpl as never} />);
  fireEvent.click(await screen.findByLabelText("고2 화 (화)"));
  fireEvent.click(screen.getByLabelText("고1 목 (목)"));
  fireEvent.change(screen.getByLabelText("기준 날짜"), { target: { value: "11.16" } });
  expect(screen.getByLabelText("추가될 주차")).toHaveTextContent("고2 화 11.17 · 고1 목 11.19");
  fireEvent.click(screen.getByRole("button", { name: "실제 주차 추가" }));
  expect(await screen.findByRole("status")).toHaveTextContent("2개 반 주차를 추가했습니다");
  expect(posts).toEqual([{ base: "11.16", weeks: [{ class_id: 3, test_date: "11.17" }, { class_id: 4, test_date: "11.19" }] }]);
  expect(fetchImpl.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  vi.useRealTimers();
});

import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ClinicLive from "../src/admin/ClinicLive";
import UncertLive from "../src/admin/UncertLive";
import { clinicClasses, clinicRows, clinicStudents, clinicWeeks } from "./clinic-fixture";

function fakeServer(failPut = false) {
  const puts: Record<string, unknown>[] = [];
  const rows = clinicRows.map((r) => ({ ...r }));
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/classes") return Response.json(clinicClasses);
    if (u === "/api/admin/roster/weeks") return Response.json(clinicWeeks);
    const st = u.match(/^\/api\/admin\/classes\/(\d+)\/students$/);
    if (st) return Response.json((clinicStudents[Number(st[1])] ?? []).map((s) => ({ ...s, created_at: null })));
    const wk = u.match(/^\/api\/admin\/classes\/(\d+)\/weeks$/);
    if (wk) return Response.json(clinicWeeks.filter((w) => w.class_id === Number(wk[1])));
    if (u.startsWith("/api/admin/scores?weekIds=")) {
      const ids = u.split("=")[1].split(",").map(Number);
      return Response.json(rows.filter((r) => ids.includes(r.week_id)));
    }
    if (u === "/api/admin/roster/scores" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      if (failPut) return new Response(null, { status: 503 });
      const r = rows.find((x) => x.week_id === body.week_id && x.student_id === body.student_id)!;
      Object.assign(r, body.after);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  });
  return { fetchImpl, puts };
}

it("shows the clinic schedule and saves the attendance circle", async () => {
  const { fetchImpl, puts } = fakeServer();
  render(<ClinicLive fetchImpl={fetchImpl} />);
  const g1 = await screen.findByLabelText("고1 클리닉 배정표");
  expect(within(g1).getByText(/클리닉 대상 2명/)).toBeTruthy();
  expect(within(g1).getByText("3시")).toBeTruthy();
  expect(within(g1).getByText(/요일·시간 미기재 \(1명\)/)).toBeTruthy();
  expect(within(screen.getByLabelText("고1 재시험지 수요")).getByText("고1 수요일 상반 (+ 고1 토요일)")).toBeTruthy();
  expect(screen.getByText(/고2 화은 이번 주차가 아직 없어/)).toBeTruthy();
  expect(within(screen.getByLabelText("과제 인증 기한")).getByText("토요일까지")).toBeTruthy();
  expect(screen.getByLabelText("칠번 클리닉 출석").getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(within(g1).getByLabelText("일번 클리닉 출석"));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ week_id: 11, student_id: 1, before: { clinic_attend: false }, after: { clinic_attend: true } });
  await waitFor(() => expect(within(g1).getByText(/출석 1명/)).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "고2" }));
  expect(screen.queryByLabelText("고1 클리닉 배정표")).toBeNull();
  expect(screen.getByLabelText("고2 클리닉 배정표")).toBeTruthy();
});

it("reverts the attendance circle when the save fails", async () => {
  const { fetchImpl } = fakeServer(true);
  render(<ClinicLive fetchImpl={fetchImpl} />);
  const circle = await screen.findByLabelText("일번 클리닉 출석");
  fireEvent.click(circle);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "출석 표시를 저장하지 못했어요. 다시 눌러주세요.");
  expect(screen.getByLabelText("일번 클리닉 출석").getAttribute("aria-pressed")).toBe("false");
});

it("lists uncertified students and saves only changed homework cells that have a score row", async () => {
  const { fetchImpl, puts } = fakeServer();
  render(<UncertLive fetchImpl={fetchImpl} />);
  fireEvent.change(await screen.findByLabelText("실제 반 선택"), { target: { value: "1" } });
  const list = await screen.findByLabelText("실제 미인증 명단");
  expect(within(list).getByText("미인증 — 고1 수요일 상반 (11.5 ~ 11.12, 3명)")).toBeTruthy();
  // 일번은 11.12에 80%라 과제는 됐지만 11.5 줄이 없다 → 칸 잠김. 삼번은 11.5 줄만 있다.
  expect(within(list).queryByText("일번")).toBeNull();
  expect((screen.getByLabelText("삼번 11.12 과제%") as HTMLInputElement).disabled).toBe(true);
  const save = screen.getByRole("button", { name: "저장" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("이번 11.12 과제%"), { target: { value: "90" } });
  fireEvent.click(save);
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]).toMatchObject({ week_id: 11, student_id: 2, before: { homework_rate: null }, after: { homework_rate: 90 } });
  expect(await screen.findByText("미인증 — 고1 수요일 상반 (11.5 ~ 11.12, 2명)")).toBeTruthy();
  expect(fetchImpl.mock.calls.filter(([, i]) => i?.method && i.method !== "GET")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "다음 ▶" }));
  expect(await screen.findByText("가장 최신 주차입니다.")).toBeTruthy();
});

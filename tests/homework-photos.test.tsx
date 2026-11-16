import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HomeworkPhotos from "../src/HomeworkPhotos";
import PhotoLive from "../src/admin/PhotoLive";
import { createHomeworkApi, MAX_PHOTO_BYTES } from "../src/photoApi";

const S3 = "https://bucket.s3.ap-northeast-2.amazonaws.com";

// 서버 흉내: presign은 주차 3만, 사진은 주차당 limit장까지. PUT은 S3 URL로만 받는다.
function fakeServer(limit = 5) {
  const stored: { student_id: number; url: string; uploaded_at: string }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/student/homework-photos" && init?.method === "POST") {
      const b = JSON.parse(String(init.body));
      if (b.week_id !== 3) return Response.json({ error: "not_your_week" }, { status: 403 });
      if (stored.length >= limit) return Response.json({ error: "too_many_photos" }, { status: 409 });
      return Response.json({ url: `${S3}/homework/3/7/${stored.length}.jpg?X-Amz-Signature=x`, content_type: b.content_type });
    }
    if (u.startsWith(S3) && init?.method === "PUT") {
      stored.push({ student_id: 7, url: u.split("?")[0] + "?get", uploaded_at: "2026-11-16T01:00:00Z" });
      return new Response(null, { status: 200 });
    }
    if (u === "/api/student/homework-photos?weekId=3") return Response.json(stored);
    return new Response("{}", { status: 404 });
  });
  return { fetchImpl, stored };
}

const photo = (type = "image/jpeg", size = 1000) => {
  const f = new File(["x"], "hw.jpg", { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

function renderStudent(server = fakeServer(), weekId = 3) {
  render(<HomeworkPhotos weekId={weekId} api={createHomeworkApi(server.fetchImpl as never)} />);
  return server;
}

it("asks nothing of the server until the student acts", () => {
  const server = renderStudent();
  expect(screen.getByRole("button", { name: "올린 사진 보기" })).toBeInTheDocument();
  expect(server.fetchImpl).not.toHaveBeenCalled();
});

it("presigns, puts the file straight to S3 with the signed type and no cookie, then shows it", async () => {
  const server = renderStudent();
  const file = photo();
  fireEvent.change(screen.getByLabelText("사진 올리기"), { target: { files: [file] } });
  expect(await screen.findByText("사진을 올렸어요.")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "올린 사진 1" })).toHaveAttribute("src", `${S3}/homework/3/7/0.jpg?get`);

  const [presign, put] = server.fetchImpl.mock.calls as [string, RequestInit][];
  expect(JSON.parse(String(presign[1].body))).toEqual({ week_id: 3, content_type: "image/jpeg", size: 1000 });
  expect(presign[1].credentials).toBe("same-origin");
  expect(put[0]).toMatch(/^https:\/\/bucket\.s3\./);
  expect(put[1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: file, credentials: "omit" });
});

it("refuses a wrong type or an oversized file before any request", async () => {
  const server = renderStudent();
  for (const f of [photo("image/gif"), photo("image/jpeg", MAX_PHOTO_BYTES + 1), photo("", 10)]) {
    fireEvent.change(screen.getByLabelText("사진 올리기"), { target: { files: [f] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("JPG·PNG·HEIC 사진, 10MB 이하만");
  }
  expect(server.fetchImpl).not.toHaveBeenCalled();
});

it("explains the server's refusals: over the cap, someone else's week", async () => {
  const server = fakeServer(0);
  renderStudent(server);
  fireEvent.change(screen.getByLabelText("사진 올리기"), { target: { files: [photo()] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("5장까지");
  render(<HomeworkPhotos weekId={9} api={createHomeworkApi(server.fetchImpl as never)} />);
  fireEvent.change(screen.getAllByLabelText("사진 올리기")[1], { target: { files: [photo()] } });
  expect(await screen.findByText("이 주차에는 사진을 올릴 수 없어요.")).toBeInTheDocument();
  expect(server.fetchImpl.mock.calls.some(([, init]) => (init as RequestInit).method === "PUT")).toBe(false);
});

it("lists the student's photos on request and says when there are none", async () => {
  renderStudent();
  fireEvent.click(screen.getByRole("button", { name: "올린 사진 보기" }));
  expect(await screen.findByText("아직 올린 사진이 없어요.")).toBeInTheDocument();
});

it("admin sees each student's photos for the chosen week, and who has none", async () => {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/admin/classes") return Response.json([{ id: 1, name: "고2 화목", grade: "고2" }]);
    if (u === "/api/admin/classes/1/weeks") return Response.json([{ id: 3, label: "1주차", test_date: "11.3" }]);
    if (u === "/api/admin/classes/1/students")
      return Response.json([{ id: 7, name: "가상 학생", created_at: null }, { id: 8, name: "가상 둘", created_at: null }]);
    if (u === "/api/admin/homework-photos?weekId=3")
      return Response.json([{ student_id: 7, url: `${S3}/homework/3/7/a.jpg?get`, uploaded_at: "2026-11-16T01:00:00Z" }]);
    return new Response("{}", { status: 404 });
  });
  render(<PhotoLive fetchImpl={fetchImpl as never} />);
  fireEvent.change(await screen.findByLabelText("사진 반 선택"), { target: { value: "1" } });
  await screen.findByRole("option", { name: "1주차" });
  fireEvent.change(screen.getByLabelText("사진 주차 선택"), { target: { value: "3" } });
  expect(await screen.findByRole("img", { name: "가상 학생 사진 1" })).toHaveAttribute("src", `${S3}/homework/3/7/a.jpg?get`);
  expect(screen.getByText("가상 둘").closest("tr")).toHaveTextContent("사진 없음");
  expect(fetchImpl.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true);
});

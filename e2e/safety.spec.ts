import { test, expect } from "@playwright/test";
import { stubSignedIn } from "./session";

test("CSP permits the app's own API and no external data connections occur", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !url.hostname.endsWith("gstatic.com") && !url.hostname.endsWith("googleapis.com"))
      externalRequests.push(request.url());
  });
  await stubSignedIn(page);
  await page.goto("/");
  // Scores arrive over the same-origin /api/parent-login rewrite, so
  // connect-src must allow 'self' — and nothing wider.
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).not.toContain("connect-src *");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  // The session call itself must succeed; a 'none' policy would break login.
  await expect(page.locator("#result-name")).toHaveText("데모 학생");
  expect(externalRequests).toEqual([]);
});

test("study and administrator routes stay local React workspaces", async ({
  page,
}) => {
  // Study screens sit behind the student login, so establish a session first.
  await stubSignedIn(page);
  for (const [path, workspace] of [
    ["/vocab/", "vocab-workspace"],
    ["/vocab/?go=passage", "passage-workspace"],
  ]) {
    await page.goto(path);
    await expect(page.getByTestId(workspace)).toBeVisible();
    await expect(page.getByText(/이 화면은 다음 마이그레이션/)).toHaveCount(0);
    expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  }
  // The administrator shell has its own entry and needs no student session.
  await page.goto("/admin.html");
  await expect(page.getByTestId("admin-workspace")).toBeVisible();
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
});

test("an unauthenticated visitor gets the login form, never someone's scores", async ({
  page,
}) => {
  // No session cookie: the server answers 401 and the app must stay on login.
  await page.route("**/api/parent-login", (route) =>
    route.fulfill({ status: 401, json: { error: "session_expired" } }),
  );
  await page.goto("/scores");
  await expect(page.locator("#login-section")).toBeVisible();
  await expect(page.locator("#result-name")).toHaveCount(0);
});

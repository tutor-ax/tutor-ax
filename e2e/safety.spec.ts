import { test, expect } from "@playwright/test";

test("production preview CSP blocks same-origin and external data connections", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") ||
      request.url().includes("example.invalid")
    )
      apiRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute("content", /connect-src 'none'/);
  const blocked = await page.evaluate(async () => {
    const attempts = [
      "/api/should-never-connect",
      "https://example.invalid/should-never-connect",
    ];
    return Promise.all(
      attempts.map((url) =>
        fetch(url).then(
          () => false,
          () => true,
        ),
      ),
    );
  });
  expect(blocked).toEqual([true, true]);
  // Browsers can emit requestfailed for CSP blocks; no response may complete.
  expect(apiRequests).toEqual([]);
});

test("legacy-style paths are local and explicitly deferred, not external redirects", async ({
  page,
}) => {
  await page.goto("/index.html");
  await page.getByTestId("demo-login").click();
  for (const [path, title] of [
    ["/vocab/", "단어 공부"],
    ["/vocab/?go=passage", "지문 공부"],
    ["/admin.html", "관리자"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/이 화면은 다음 마이그레이션/)).toBeVisible();
    expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  }
  await page.goto("/scores");
  await expect(page.locator("#result-name")).toHaveText("데모 학생");
});

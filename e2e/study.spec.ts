import { test, expect } from "@playwright/test";
import { stubSignedIn } from "./session";
const pages = process.env.PAGES_BUILD === "true";
const entry = pages ? "/tutor-ax/" : "/";
const route = (path: string) => (pages ? entry + "#" + path : path);

test("old admin.html path opens admin demo without student login", async ({
  page,
}) => {
  await page.goto(pages ? entry + "admin.html" : "/admin.html");
  if (pages)
    await page.waitForURL("**/tutor-ax/admin/", {
      waitUntil: "domcontentloaded",
    });
  await expect(page.getByTestId("admin-workspace")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByLabel("학부모 연락처 뒷 4자리")).toHaveCount(0);
  if (pages) expect(new URL(page.url()).pathname).toBe("/tutor-ax/admin/");
});
test("clean admin URL survives reload without hash", async ({ page }) => {
  await page.goto(pages ? entry + "admin/" : "/admin/");
  await expect(page.getByTestId("admin-workspace")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByTestId("admin-workspace")).toBeVisible();
});
test("administrator aliases render one standalone shell and exit cleanly", async ({
  page,
}) => {
  const aliases = pages
    ? [
        entry + "admin",
        entry + "admin/",
        entry + "admin.html",
        entry + "#/admin",
        entry + "#/admin/",
      ]
    : ["/admin", "/admin/", "/admin.html", "/#/admin", "/#/admin/"];
  for (const alias of aliases) {
    await page.goto(alias);
    await expect(page.getByTestId("admin-workspace")).toBeVisible();
    await expect(page.locator("header")).toHaveCount(1);
    await expect(
      page.locator(".site-header, .student-shell, .container, .demo-notice"),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator("header")).toHaveCount(1);
  }
  await page.getByRole("button", { name: "나가기", exact: true }).click();
  await expect(page.locator(".student-shell")).toBeVisible();
  await expect(page.getByTestId("admin-workspace")).toHaveCount(0);
});

for (const width of [390, 1440])
  test(`${width}px learning workflows survive storage and reload`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Scores come from the session endpoint, so that call is expected. Study
    // screens must still be local-only: anything OTHER than parent-login here
    // would mean vocabulary or passages started calling a server.
    const api: string[] = [];
    page.on("request", (r) => {
      if (
        ["fetch", "xhr"].includes(r.resourceType()) &&
        !new URL(r.url()).pathname.endsWith("/api/parent-login")
      )
        api.push(r.url());
    });
    await stubSignedIn(page);
    await page.goto(entry);
    const logo = page.getByRole("img", { name: "학원 로고" });
    await expect(logo).toBeVisible();
    expect(
      await logo.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "단어 공부", exact: true }).click();
    await page.getByRole("button", { name: /데모 기본 어휘/ }).click();
    await page.getByRole("button", { name: /DAY 01/ }).click();
    await page.getByRole("button", { name: "선택 범위 학습" }).click();
    await page.getByRole("button", { name: "플래시카드", exact: true }).click();
    await page.getByRole("button", { name: "뜻 보기", exact: true }).click();
    await expect(page.getByText("사과", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "즐겨찾기 추가" }).click();
    await page.screenshot({
      path: info.outputPath(`vocab-${width}.png`),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("button", { name: /즐겨찾기/ }).click();
    await expect(page.getByText("apple", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "이 단어들 학습" }).click();
    await page.getByRole("button", { name: "뜻 쓰기", exact: true }).click();
    await page.getByLabel("답안").fill("틀린 답");
    await page.getByRole("button", { name: "정답 확인" }).click();
    await expect(page.getByText("오답 · 정답: 사과")).toBeVisible();
    await page.getByRole("button", { name: "결과 보기" }).click();
    await expect(page.getByText("정답 0 / 1")).toBeVisible();
    await page.goto(route("/vocab/?go=passage"));
    await page.getByRole("button", { name: /데모 읽기/ }).click();
    await page.getByRole("button", { name: "01 작은 도서관" }).click();
    await page
      .getByRole("button", { name: "① Our town has a small library." })
      .click();
    await expect(
      page.getByText("① 우리 마을에는 작은 도서관이 있다.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "01 작은 도서관" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`passage-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(api).toEqual([]);
    expect(errors).toEqual([]);
  });

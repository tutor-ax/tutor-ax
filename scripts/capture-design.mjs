import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const phase = process.argv[2] || "after";
const dir = `/tmp/tutor-redesign-evidence/${phase}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chromium" });
for (const width of [390, 1440]) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:4175/");
  await page.getByTestId("demo-login").waitFor();
  await page.screenshot({ path: `${dir}/login-${width}.png`, fullPage: true });
  await page.getByTestId("demo-login").click();
  await page.locator("#result-name").waitFor();
  await page.screenshot({ path: `${dir}/scores-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "단어 공부", exact: true }).click();
  await page.screenshot({ path: `${dir}/vocab-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: /데모 기본 어휘/ }).click();
  await page.getByRole("button", { name: /DAY 01/ }).click();
  await page.getByRole("button", { name: "선택 범위 학습" }).click();
  await page.getByRole("button", { name: "플래시카드", exact: true }).click();
  await page.screenshot({ path: `${dir}/flash-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "지문 공부", exact: true }).click();
  await page.getByRole("button", { name: /데모 읽기/ }).click();
  await page.getByRole("button", { name: "01 작은 도서관" }).click();
  await page
    .getByRole("button", { name: "① Our town has a small library." })
    .click();
  await page.screenshot({
    path: `${dir}/passage-${width}.png`,
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:4175/admin/");
  await page.getByTestId("admin-workspace").waitFor();
  await page.screenshot({ path: `${dir}/admin-${width}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(dir);

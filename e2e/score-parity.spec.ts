import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = JSON.parse(
  readFileSync(resolve("e2e/fixtures/score-response.json"), "utf8"),
);
const legacyHtml = readFileSync(resolve("e2e/legacy/score.html"), "utf8");
const legacyCss = readFileSync(resolve("e2e/legacy/theme.css"), "utf8");
const origin = "http://127.0.0.1:4173";

async function isolate(page: Page, legacy = false, loggedIn = true) {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      // Fonts are deliberately blocked for deterministic, offline comparisons.
      if (!["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname))
        external.push(url.origin);
      return route.abort();
    }
    if (url.pathname === "/__test/legacy")
      return route.fulfill({ contentType: "text/html", body: legacyHtml });
    if (url.pathname === "/__test/theme.css")
      return route.fulfill({ contentType: "text/css", body: legacyCss });
    if (url.pathname === "/__test/chart.js")
      return route.fulfill({
        contentType: "application/javascript",
        body:
          readFileSync(
            resolve("node_modules/chart.js/dist/chart.umd.js"),
            "utf8",
          ) + "\nChart.defaults.animation = false;",
      });
    if (url.pathname === "/__test/parent-login") {
      return route.fulfill({
        status: legacy && loggedIn ? 200 : 401,
        json: legacy && loggedIn ? fixture : {},
      });
    }
    if (url.pathname.startsWith("/api/")) {
      external.push(`Unexpected API call: ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  return { external, errors };
}

async function enterDemo(page: Page) {
  await page.goto("/");
  await page.getByTestId("demo-login").click();
  await expect(page.locator("#result-name")).toHaveText("데모 학생");
}

async function normalizedText(page: Page, selector: string) {
  return (await page.locator(selector).innerText()).replace(/\s+/g, " ").trim();
}

for (const width of [390, 1440]) {
  test.describe(`${width}px offline legacy parity`, () => {
    test.use({ viewport: { width, height: 1000 } });

    test("weekly, absence, no-homework and mock scores match legacy", async ({
      page,
      context,
    }, testInfo) => {
      const current = await isolate(page);
      const legacy = await context.newPage();
      const old = await isolate(legacy, true);
      await legacy.goto("/__test/legacy");
      await expect(legacy.locator("#result-name")).toHaveText("데모 학생");
      await enterDemo(page);

      expect(
        await page.locator("#period-select option").allTextContents(),
      ).toEqual(
        await legacy.locator("#period-select option").allTextContents(),
      );
      await expect(page.locator("#period-select")).toHaveValue("w103");
      for (const value of ["w103", "w102", "w101", "m201", "m202"]) {
        await page.locator("#period-select").selectOption(value);
        await legacy.locator("#period-select").selectOption(value);
        const selector = value.startsWith("w")
          ? "#score-content"
          : "#mock-score-section";
        expect(await normalizedText(page, selector)).toBe(
          await normalizedText(legacy, selector),
        );
        if (value.startsWith("w")) {
          expect(await normalizedText(page, "#summary-grid")).toBe(
            await normalizedText(legacy, "#summary-grid"),
          );
        } else {
          await expect(page.locator("#summary-grid")).not.toBeVisible();
          await expect(page.locator("#chart-card")).not.toBeVisible();
        }
      }
      await page.locator("#period-select").selectOption("w103");
      await legacy.locator("#period-select").selectOption("w103");
      // Allow chart animation to finish before capturing human-inspectable evidence.
      await page.waitForTimeout(1100);
      await page.screenshot({
        path: testInfo.outputPath(`react-${width}.png`),
        fullPage: true,
      });
      await legacy.screenshot({
        path: testInfo.outputPath(`legacy-${width}.png`),
        fullPage: true,
      });
      for (const selector of [
        ".student-info",
        "#period-select",
        "#score-content .card",
        "#summary-grid",
        "#chart-card",
      ]) {
        const currentBox = await page.locator(selector).boundingBox();
        const oldBox = await legacy.locator(selector).boundingBox();
        expect(currentBox).not.toBeNull();
        expect(oldBox).not.toBeNull();
        // Student redesign explicitly supersedes legacy geometry, not data parity.
        expect(currentBox!.width, `${selector} usable width`).toBeGreaterThan(
          200,
        );
        expect(currentBox!.x).toBeGreaterThanOrEqual(0);
        expect(currentBox!.x + currentBox!.width).toBeLessThanOrEqual(width);
        expect(currentBox!.height).toBeGreaterThan(40);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(current.external).toEqual([]);
      expect(old.external).toEqual([]);
      expect(current.errors).toEqual([]);
      expect(old.errors).toEqual([]);
    });

    test("login retains original fields with responsive usable geometry", async ({
      page,
      context,
    }, testInfo) => {
      await isolate(page);
      const legacy = await context.newPage();
      await isolate(legacy, true, false);
      await page.goto("/");
      await legacy.goto("/__test/legacy");
      for (const selector of [
        "#input-name",
        "#input-pin",
        "#login-section .card-header",
      ]) {
        const current = await page.locator(selector).boundingBox();
        const old = await legacy.locator(selector).boundingBox();
        expect(current).not.toBeNull();
        expect(old).not.toBeNull();
        expect(current!.width).toBeGreaterThan(200);
        expect(current!.x).toBeGreaterThanOrEqual(0);
        expect(current!.x + current!.width).toBeLessThanOrEqual(width);
        expect(current!.height).toBeGreaterThan(30);
      }
      await page.screenshot({
        path: testInfo.outputPath(`login-react-${width}.png`),
        fullPage: true,
      });
      await legacy.screenshot({
        path: testInfo.outputPath(`login-legacy-${width}.png`),
        fullPage: true,
      });
    });
  });
}

test("demo session survives refresh, navigation and logout without APIs", async ({
  page,
}) => {
  const safety = await isolate(page);
  await enterDemo(page);
  await page.reload();
  await expect(page.locator("#result-name")).toHaveText("데모 학생");
  await page.getByRole("button", { name: "단어 공부", exact: true }).click();
  await expect(page.getByTestId("vocab-workspace")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#result-name")).toHaveText("데모 학생");
  await page.getByRole("button", { name: "다른 학생 조회" }).click();
  await expect(page.locator("#login-section")).toBeVisible();
  await page.reload();
  await expect(page.locator("#login-section")).toBeVisible();
  expect(safety.external).toEqual([]);
  expect(safety.errors).toEqual([]);
});

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
  let signedOut = false;
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
    // The React app reads scores from /api/student/me (tutor-server) and logs in/out
    // through /api/parent-login. Both are served from the fixture so the comparison stays
    // offline and deterministic; any OTHER /api/ path is unexpected and still fails the test.
    if (url.pathname === "/api/parent-login" || url.pathname === "/api/student/me") {
      // Mirror the real cookie lifecycle: logging out must make later
      // session lookups fail, or "reload after logout" proves nothing.
      if (route.request().method() === "DELETE") {
        signedOut = true;
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      const active = loggedIn && !signedOut;
      return route.fulfill({
        status: active ? 200 : 401,
        json: active ? fixture : { error: "session_expired" },
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
  await expect(page.locator("#result-name")).toHaveText("데모 학생");
}

async function normalizedText(page: Page, selector: string) {
  return (await page.locator(selector).innerText()).replace(/\s+/g, " ").trim();
}

/**
 * The approved student redesign replaces the legacy score markup (stacked
 * `.score-grid` cards, clinic memo inside the score card) with a semantic table
 * plus a supporting column, so raw innerText can no longer match legacy.
 * Parity is therefore asserted on the DATA the screen reports — per-item label,
 * score, maximum, retest state, the total, and the clinic memo wherever it is
 * rendered — which is what must never drift.
 */
async function scoreData(page: Page, selector: string) {
  return page.$eval(selector, (root) => {
    const clean = (node: Element | null | undefined) =>
      (node?.textContent ?? "").replace(/\s+/g, " ").trim();
    const number = (text: string) => {
      const match = text.replace(/[,\s]/g, "").match(/-?\d+(\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const rows = [...root.querySelectorAll(".score-item")].filter(
      (row) => !row.classList.contains("total"),
    );
    const items = rows.map((row) => {
      const text = clean(row);
      return {
        label: clean(row.querySelector(".score-label")),
        value: number(clean(row.querySelector(".score-value"))),
        max: number(clean(row.querySelector(".score-max"))),
        retestPass: /재시험 통과/.test(text),
        retestTarget: /재시험 대상/.test(text),
      };
    });
    // Legacy renders the total as a `.score-item.total`; the redesign hoists it
    // into the card header beside the exam name.
    const legacyTotal = root.querySelector(".score-item.total");
    const header = root.querySelector(".card-header");
    const total = legacyTotal
      ? {
          value: number(clean(legacyTotal.querySelector(".score-value"))),
          max: number(clean(legacyTotal.querySelector(".score-max"))),
        }
      : {
          value: number(clean(header?.querySelector(".total-value"))),
          max: number(clean(header?.querySelector(".total-max"))),
        };
    const notices = [...root.querySelectorAll(".notice-card, .notice")]
      // Whitespace is stripped entirely: legacy and the redesign wrap the same
      // sentences in different block elements, which changes only inter-node
      // spacing in textContent, never the wording.
      .map((node) => clean(node).replace(/\s+/g, ""))
      // The clinic memo moved to the supporting column; compared separately.
      .filter((text) => !/클리닉/.test(text));
    return { items, total, notices };
  });
}

/** Clinic memo moved out of the score card into the supporting column. */
async function clinicMemo(page: Page) {
  return page.evaluate(() => {
    const host =
      document.querySelector(".clinic-section") ??
      [...document.querySelectorAll("#score-content .notice-card")].find((card) =>
        /클리닉/.test(card.textContent ?? ""),
      );
    return (host?.textContent ?? "")
      .replace(/클리닉 안내/, "")
      .replace(/\s+/g, " ")
      .trim();
  });
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
        expect(await scoreData(page, selector), `${value} score data`).toEqual(
          await scoreData(legacy, selector),
        );
        if (value.startsWith("w")) {
          expect(
            (await clinicMemo(page)).replace(/\s+/g, ""),
            `${value} clinic memo`,
          ).toBe((await clinicMemo(legacy)).replace(/\s+/g, ""));
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
      // The redesign explicitly supersedes legacy geometry; these bounds only
      // catch collapsed or off-screen regions. `.student-info` is now an inline
      // header label rather than a legacy block, so it carries its own minimum.
      const regions: [string, { minWidth: number; minHeight: number }][] = [
        [".student-info", { minWidth: 60, minHeight: 14 }],
        ["#period-select", { minWidth: 200, minHeight: 40 }],
        ["#score-content .card", { minWidth: 200, minHeight: 40 }],
        ["#summary-grid", { minWidth: 200, minHeight: 40 }],
        ["#chart-card", { minWidth: 200, minHeight: 40 }],
      ];
      for (const [selector, min] of regions) {
        const currentBox = await page.locator(selector).boundingBox();
        const oldBox = await legacy.locator(selector).boundingBox();
        expect(currentBox, `${selector} present`).not.toBeNull();
        expect(oldBox, `${selector} present in legacy`).not.toBeNull();
        expect(currentBox!.width, `${selector} usable width`).toBeGreaterThan(
          min.minWidth,
        );
        expect(currentBox!.x, `${selector} left edge`).toBeGreaterThanOrEqual(0);
        expect(
          currentBox!.x + currentBox!.width,
          `${selector} right edge`,
        ).toBeLessThanOrEqual(width);
        expect(currentBox!.height, `${selector} usable height`).toBeGreaterThan(
          min.minHeight,
        );
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
      // Both pages must show the signed-out login form, so neither side has
      // a session: loggedIn=false makes parent-login answer 401.
      await isolate(page, false, false);
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

test("the session survives refresh, navigation and logout", async ({
  page,
}) => {
  // The session endpoint is now the expected data source; isolate() still
  // fails the test on any OTHER /api/ path or cross-origin call.
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

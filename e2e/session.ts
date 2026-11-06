import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Synthetic student used by browser tests.
 *
 * Production reads this payload from the live academy database through the
 * same-origin `/api/parent-login` rewrite. Tests stub that endpoint instead,
 * so no browser test ever touches real student records.
 */
export const scoreFixture = JSON.parse(
  readFileSync(resolve("e2e/fixtures/score-response.json"), "utf8"),
);

export const PARENT_LOGIN_GLOB = "**/api/parent-login";

/** Serve the fixture as an established session for every parent-login call. */
export async function stubSignedIn(page: Page, data: unknown = scoreFixture) {
  await page.route(PARENT_LOGIN_GLOB, (route: Route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 200, json: data as never });
  });
}

/** Answer 401 until credentials are posted, then serve the fixture. */
export async function stubSignedOut(page: Page, data: unknown = scoreFixture) {
  await page.route(PARENT_LOGIN_GLOB, (route: Route) => {
    const method = route.request().method();
    if (method === "POST") {
      return route.fulfill({ status: 200, json: data as never });
    }
    if (method === "DELETE") {
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 401, json: { error: "session_expired" } });
  });
}

/** Open the app with a session already established. */
export async function signIn(page: Page, path = "/") {
  await stubSignedIn(page);
  await page.goto(path);
}

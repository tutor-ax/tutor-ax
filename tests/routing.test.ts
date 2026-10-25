import { expect, it } from "vitest";
import { navigationUrl, currentRoute } from "../src/routing";
it("keeps Pages routes inside the repository and reload-safe hash", () => {
  expect(navigationUrl("/vocab/?go=passage", "/tutor-ax/")).toBe(
    "/tutor-ax/#/vocab/?go=passage",
  );
  expect(
    currentRoute(
      new URL("https://example.org/tutor-ax/#/vocab/?go=passage"),
      "/tutor-ax/",
    ),
  ).toBe("passage");
  expect(
    currentRoute(
      new URL("https://example.org/tutor-ax/#/vocab/"),
      "/tutor-ax/",
    ),
  ).toBe("vocab");
  expect(navigationUrl("/scores", "/")).toBe("/scores");
});

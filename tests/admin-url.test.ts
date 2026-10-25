import { expect, it } from "vitest";
import { currentRoute } from "../src/routing";
it("recognizes clean Pages admin paths without hash", () => {
  for (const path of ["/tutor-ax/admin", "/tutor-ax/admin/"])
    expect(
      currentRoute(new URL("https://example.org" + path), "/tutor-ax/"),
    ).toBe("admin");
});

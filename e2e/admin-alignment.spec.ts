import { test, expect } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`${width}px configuration and dynamic score columns stay aligned`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(process.env.PAGES_BUILD === "true" ? "/tutor-ax/admin/" : "/admin/");
    // The shared theme paints a navy bar on bare `header`; the admin shell must
    // stay white, or the heading goes dark-on-dark and becomes unreadable.
    const header = page.locator(".admin-app header");
    await expect(header).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(header.locator("h1")).toBeVisible();
    // The add-item field and its button share one baseline.
    const addField = page.getByLabel("새 항목 이름");
    const addButton = page.getByRole("button", { name: "항목 추가", exact: true });
    const [fieldBox, buttonBox] = await Promise.all([
      addField.boundingBox(),
      addButton.boundingBox(),
    ]);
    expect(
      Math.abs(
        fieldBox!.y + fieldBox!.height - (buttonBox!.y + buttonBox!.height),
      ),
      "add-item control baseline",
    ).toBeLessThan(2);
    for (let i = 0; i < 5; i++) {
      await page.getByLabel("새 항목 이름").fill(`긴 추가 평가 항목 ${i}`);
      await page.getByRole("button", { name: "항목 추가", exact: true }).click();
    }
    await page.getByLabel("가상 학생 A 단어 점수", { exact: true }).fill("40");
    for (const name of ["채점 항목 설정", "학생별 점수 입력"]) {
      const table = page.getByRole("table", { name, exact: true });
      const geometry = await table.evaluate((table) => {
        const rows = [...table.querySelectorAll("tr")];
        return rows.map(row => [...row.children].map(cell => {
          const rect = cell.getBoundingClientRect();
          return { x: rect.x, width: rect.width };
        }));
      });
      for (const row of geometry.slice(1)) {
        expect(row.length).toBe(geometry[0].length);
        row.forEach((cell, i) => {
          expect(Math.abs(cell.x - geometry[0][i].x)).toBeLessThan(1);
          expect(Math.abs(cell.width - geometry[0][i].width)).toBeLessThan(1);
        });
      }
      const controls = await table.locator("tbody tr").first().locator('input:not([type="checkbox"]), button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
      expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scroll = page.getByRole("region", { name: "학생별 점수 가로 스크롤" });
    expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  });
}

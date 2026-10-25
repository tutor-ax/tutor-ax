import { test, expect } from "@playwright/test";
for (const width of [390, 1440])
  test(`${width}px admin edits, retests, mock exams and preview stay local`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [],
      requests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (["fetch", "xhr"].includes(r.resourceType())) requests.push(r.url());
    });
    await page.goto(
      process.env.PAGES_BUILD === "true" ? "/tutor-ax/admin/" : "/admin/",
    );
    await page.getByLabel("가상 학생 A 단어 점수", { exact: true }).fill("55");
    await page.getByLabel("가상 학생 A 단어 재시험 통과").check();
    await page.reload();
    await expect(
      page.getByLabel("가상 학생 A 단어 점수", { exact: true }),
    ).toHaveValue("55");
    await expect(page.getByLabel("가상 학생 A 단어 재시험 통과")).toBeChecked();
    await page.screenshot({
      path: info.outputPath(`admin-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "모의고사", exact: true }).click();
    await page.getByLabel("새 모의고사 이름").fill("브라우저 검증 모의고사");
    await page
      .getByRole("button", { name: "모의고사 추가", exact: true })
      .click();
    await page.getByLabel("가상 학생 A 단어 점수", { exact: true }).fill("0");
    await page.getByLabel("가상 학생 A 미응시").check();
    await expect(page.getByLabel("가상 학생 A 원점수 합계")).toContainText(
      "미응시",
    );
    await page.getByLabel("가상 학생 A 미응시").uncheck();
    await expect(
      page.getByLabel("가상 학생 A 단어 점수", { exact: true }),
    ).toHaveValue("0");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });

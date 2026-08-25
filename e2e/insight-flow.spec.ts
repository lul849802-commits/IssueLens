import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const runId = process.env.E2E_RUN_ID;

test.describe("persisted insight flow", () => {
  test.skip(!runId, "Set E2E_RUN_ID and DATABASE_URL to run persisted-data coverage.");

  test("opens overview, filters, drills into evidence, and stays read-only", async ({ page }) => {
    await page.goto(`/analysis/${runId}/overview`);
    await expect(page.getByRole("heading", { name: "Issue 洞察总览" })).toBeVisible();
    await expect(page.getByText("只读分享")).toBeVisible();
    await expect(page.locator('section[aria-label="关键指标"] article')).toHaveCount(4);
    await expect(page.locator('a[href*="/clusters/"]')).toHaveCount(3);
    await page.getByRole("navigation", { name: "洞察结果视图" }).getByRole("link", { name: /Issues/ }).click();
    await expect(page.getByLabel("Sort by")).toHaveValue("recommended");
    await page.getByLabel("Severity").selectOption("high");
    await page.getByRole("button", { name: "应用筛选" }).click();
    await expect(page).toHaveURL(/view=issues.*severity=high/);
    await page.goto(`/analysis/${runId}/overview?view=issues`);
    await page.locator('#issues a[href*="/issues/"]').first().click();
    await expect(page.getByRole("heading", { name: "GitHub 原文" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "结构化判断" })).toBeVisible();
    await expect(page.getByRole("button", { name: "修正 AI 判断" })).toHaveCount(0);
  });

  test("overview has no serious accessibility violations and no mobile overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/analysis/${runId}/overview`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goto(`/analysis/${runId}/overview?view=issues`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("validates a repository and creates an analysis directly", async ({ page }) => {
  await page.route("**/api/repositories/validate", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { repository: { slug: "openai/openai-node" } } }) }));
  let submittedRepository = "";
  await page.route("**/api/analysis", async (route) => {
    submittedRepository = (await route.request().postDataJSON()).repository;
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { runId: "e2e-run" }, links: { progress: "/?analysis-started=1" } }) });
  });
  await page.goto("/"); await expect(page.locator("form[data-hydrated=true]")).toBeVisible(); await page.getByLabel("公开仓库地址").fill("openai/openai-node"); await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page).toHaveURL(/analysis-started=1/); expect(submittedRepository).toBe("openai/openai-node");
});

test("shows analysis scope without leaving the homepage", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/"); await page.getByRole("button", { name: "Analysis scope" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("heading", { name: "本次会分析什么" })).toBeVisible();
  await page.getByRole("button", { name: "关闭分析范围说明" }).click(); await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("public entry and confirmation have no serious accessibility violations", async ({ page }) => {
  await page.goto("/"); let results=await new AxeBuilder({page}).analyze(); expect(results.violations.filter((item)=>["serious","critical"].includes(item.impact??""))).toEqual([]);
  await page.goto("/analysis/new?repository=openai%2Fopenai-node"); results=await new AxeBuilder({page}).analyze(); expect(results.violations.filter((item)=>["serious","critical"].includes(item.impact??""))).toEqual([]);
});

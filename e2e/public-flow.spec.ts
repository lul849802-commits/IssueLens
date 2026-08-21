import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("validates a repository and reaches scope confirmation", async ({ page }) => {
  await page.route("**/api/repositories/validate", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { repository: { slug: "openai/openai-node" } } }) }));
  await page.goto("/"); await expect(page.locator("form[data-hydrated=true]")).toBeVisible(); await page.getByLabel("公开仓库地址").fill("openai/openai-node"); await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page).toHaveURL(/\/analysis\/new\?repository=openai%2Fopenai-node/); await expect(page.getByRole("heading", { level: 1 })).toHaveText("openai/openai-node");
});

test("public entry and confirmation have no serious accessibility violations", async ({ page }) => {
  await page.goto("/"); let results=await new AxeBuilder({page}).analyze(); expect(results.violations.filter((item)=>["serious","critical"].includes(item.impact??""))).toEqual([]);
  await page.goto("/analysis/new?repository=openai%2Fopenai-node"); results=await new AxeBuilder({page}).analyze(); expect(results.violations.filter((item)=>["serious","critical"].includes(item.impact??""))).toEqual([]);
});

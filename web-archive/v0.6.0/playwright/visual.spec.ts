import path from "node:path";
import { expect, test } from "@playwright/test";

const output = path.resolve(__dirname, "../../docs/screenshots/webui");

test("capture live catalog reference", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop reference only");
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "catalog-desktop.png"), fullPage: true });
});

import path from "node:path";
import { expect, test } from "@playwright/test";

const output = path.resolve(__dirname, "../../docs/screenshots/webui");

test("capture Agent Chat home", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What can I help you analyze?" })).toBeVisible();
  await page.screenshot({ path: path.join(output, `agent-chat-${testInfo.project.name}.png`), fullPage: true });
});

test("capture centered Search dialog", async ({ page }, testInfo) => {
  await page.goto("/");
  const mobileMenu = page.getByRole("button", { name: "Open navigation" });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: path.join(output, `search-dialog-${testInfo.project.name}.png`), fullPage: true });
});

test("capture Settings dialog", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Shennong Agent" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
  await page.screenshot({ path: path.join(output, `settings-dialog-${testInfo.project.name}.png`), fullPage: true });
});

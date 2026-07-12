import path from "node:path";
import { expect, test } from "@playwright/test";

const output = path.resolve(__dirname, "../../docs/screenshots/webui");

test("capture desktop reference pages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop references");
  test.setTimeout(90_000);

  await page.goto("/catalog?demoRole=admin");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "catalog-desktop.png"), fullPage: true });
  await page.getByText("Toil RNA-seq (Homo sapiens)").click();
  await expect(page.getByRole("dialog", { name: "Resource details" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "catalog-resource-drawer.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".profile-button").click();
  await expect(page.getByRole("link", { name: "Administrator Panel" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "catalog-admin-menu.png"), fullPage: true });

  for (const [route, name] of [
    ["/console/api-access", "api-access"],
    ["/console/profile", "profile"],
    ["/console/security", "security"],
    ["/console/uploads/new", "upload"],
    ["/admin/dashboard", "admin-dashboard"],
    ["/admin/users", "admin-users"],
    ["/admin/settings", "admin-settings"],
  ] as const) {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: route !== "/console/uploads/new" });
  }
});

test("capture mobile catalog references", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile references");
  await page.goto("/catalog?demoRole=guest");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "catalog-mobile.png"), fullPage: true });
  await page.getByText("Toil RNA-seq (Homo sapiens)").click();
  await expect(page.getByRole("dialog", { name: "Resource details" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "resource-mobile.png"), fullPage: true });
});

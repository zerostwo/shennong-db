import { expect, test, type Page } from "@playwright/test";

const email = process.env.SHENNONG_E2E_EMAIL;
const password = process.env.SHENNONG_E2E_PASSWORD;

async function signIn(page: Page) {
  test.skip(!email || !password, "SHENNONG_E2E_EMAIL and SHENNONG_E2E_PASSWORD are required");
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(catalog|console|admin)/);
}

test("public catalog is backed by the live API", async ({ page }) => {
  const responses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/resources")) responses.push(response.status());
  });
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect.poll(() => responses.length).toBeGreaterThan(0);
  expect(responses.every((status) => status < 500)).toBeTruthy();
});

test("authenticated product modules load without browser or API errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/") && response.status() >= 500) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await signIn(page);
  for (const route of [
    "/catalog",
    "/catalog/collections",
    "/catalog/relations",
    "/console/my-data",
    "/console/uploads",
    "/console/jobs",
    "/console/usage",
    "/console/api-access",
    "/console/profile",
    "/console/security",
    "/console/sessions",
    "/console/login-history",
    "/admin/dashboard",
    "/admin/users",
    "/admin/grants",
    "/admin/tokens",
    "/admin/providers",
    "/admin/ingestion",
    "/admin/storage",
    "/admin/monitoring",
    "/admin/audit",
    "/admin/security",
    "/admin/backups",
    "/admin/settings",
  ]) {
    await page.goto(route);
    await expect(page.locator("main").getByRole("heading").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

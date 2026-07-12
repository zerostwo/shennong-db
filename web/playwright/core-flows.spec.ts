import { expect, test, type Page } from "@playwright/test";

const email = process.env.SHENNONG_E2E_EMAIL;
const password = process.env.SHENNONG_E2E_PASSWORD;

async function signIn(page: Page) {
  test.skip(!email || !password, "SHENNONG_E2E_EMAIL and SHENNONG_E2E_PASSWORD are required");
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Your secure HttpOnly session is active.")).toBeVisible();
  await page.getByRole("link", { name: "Open admin" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
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

test("authenticated mutations persist and reversible QA changes are cleaned up", async ({ page }) => {
  await signIn(page);

  await page.goto("/console/my-data");
  const addFavorite = page.getByRole("button", { name: /Add .* to favorites/ }).first();
  await addFavorite.click();
  const removeFavorite = page.getByRole("button", { name: /Remove .* from favorites/ }).first();
  await expect(removeFavorite).toBeVisible();
  await removeFavorite.click();
  await expect(addFavorite).toBeVisible();

  const collectionName = `Browser QA ${Date.now()}`;
  await page.goto("/catalog/collections");
  await page.getByRole("button", { name: "Create collection" }).click();
  await page.getByLabel("Name").fill(collectionName);
  await page.getByLabel("Description").fill("Temporary live-browser persistence check");
  await page.getByRole("button", { name: "Create collection" }).last().click();
  await expect(page.getByText(collectionName)).toBeVisible();
  await page.getByRole("button", { name: `Delete ${collectionName}` }).click();
  await expect(page.getByText(collectionName)).toHaveCount(0);

  const tokensLoaded = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/api/v1/auth/tokens"),
  );
  await page.goto("/console/api-access");
  await tokensLoaded;
  const revokeButtons = page.getByRole("button", { name: /^Revoke / });
  const initialTokens = await revokeButtons.count();
  await page.getByRole("button", { name: "Create token" }).click();
  await page.getByLabel("query.execute").check();
  await page.getByRole("button", { name: "Create token" }).last().click();
  await expect(page.getByRole("heading", { name: "Token created" })).toBeVisible();
  await page.getByRole("button", { name: "I saved this token" }).click();
  await expect(revokeButtons).toHaveCount(initialTokens + 1);
  await revokeButtons.first().click();
  await expect(revokeButtons).toHaveCount(initialTokens);

  await page.goto("/admin/settings");
  const instanceName = page.getByLabel("instance name");
  const originalName = await instanceName.inputValue();
  await instanceName.fill(`${originalName} QA`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved to PostgreSQL");
  await page.reload();
  await expect(instanceName).toHaveValue(`${originalName} QA`);
  await instanceName.fill(originalName);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved to PostgreSQL");

  const backupsLoaded = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/api/v1/backups"),
  );
  await page.goto("/admin/backups");
  await backupsLoaded;
  const completed = page.getByRole("cell", { name: "completed" });
  const initialBackups = await completed.count();
  await page.getByRole("button", { name: "Run metadata backup" }).click();
  await expect(completed).toHaveCount(initialBackups + 1);
});

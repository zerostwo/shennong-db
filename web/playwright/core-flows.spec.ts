import { expect, test } from "@playwright/test";

test("guest browses catalog and opens resource details", async ({ page }) => {
  await page.goto("/catalog?demoRole=guest");
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in / Set up" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My Data" })).toHaveCount(0);
  await page.getByText("Toil RNA-seq (Homo sapiens)").click();
  await expect(page).toHaveURL(/resource=toil/);
  await expect(page.getByLabel("Resource details")).toContainText("Integrity & Provenance");
  await page.getByRole("tab", { name: "Schema" }).click();
  await expect(page.getByText("Schema (logical)")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByLabel("API language").selectOption("cURL");
  await expect(page.getByText(/curl --fail/)).toBeVisible();
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copy code" })).toContainText("Copied");
  await page.getByLabel("More resource actions").click();
  await expect(page.getByRole("button", { name: "Delete Resource" })).toHaveCount(0);
  await page.getByLabel("More resource actions").click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/catalog\?.*demoRole=guest/);
  await page.getByRole("button", { name:/Filter/ }).click();
  await page.getByLabel("Backend").selectOption("tiledb");
  await expect(page).toHaveURL(/backend=tiledb/);
  await expect(page.getByText("TCGA survival metadata")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name:/Filter/ }).click();
  await expect(page.getByLabel("Backend")).toHaveValue("tiledb");
  await page.getByLabel("Actions for Toil RNA-seq (Homo sapiens)").click();
  await expect(page.getByRole("button", { name: "Copy ID" })).toBeVisible();
  await page.getByRole("button", { name: "Add to collection" }).click();
  await expect(page.getByRole("status")).toContainText("Added to RNA expression atlas");
});

test("relation table opens evidence details", async ({ page }) => {
  await page.goto("/catalog/relations");
  await page.getByRole("row", { name: /Toil RNA-seq/ }).click();
  await expect(page.getByRole("dialog", { name: "Relation details" })).toContainText("Provider manifest");
  await page.getByRole("dialog", { name: "Relation details" }).getByLabel("Close relation details").click();
});

test("user completes the upload review flow", async ({ page }) => {
  await page.goto("/console/uploads/new");
  for (const heading of ["Describe dataset", "Map artifacts", "Access", "Review", "Upload"]) {
    await page.getByRole("button", { name: /Continue|Use demo files/ }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Uploading multipart data/)).toBeVisible();
  await page.getByRole("button", { name: "Retry failed part" }).click();
  await expect(page.getByText(/84%/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel upload" }).click();
  await expect(page.getByRole("heading", { name: "Cancel Upload" })).toBeVisible();
  await page.getByRole("button", { name: "Keep uploading" }).click();
  await page.getByRole("button", { name: "Open ingestion job" }).click();
  await expect(page).toHaveURL(/\/console\/jobs/);
});

test("user signs in with 2FA and session expiry is explained", async ({ page }) => {
  await page.goto("/auth/sign-in?reason=session-expired");
  await expect(page.getByText("Session Expired", { exact: true })).toBeVisible();
  await page.getByLabel("Email").fill("maya.chen@shennong.org");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  await page.getByLabel("Code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Your secure HttpOnly session is active.")).toBeVisible();
});

test("authorized user opens a private resource without exposing it in guest catalog", async ({ page }) => {
  await page.goto("/catalog?demoRole=user");
  await expect(page.getByText("PBMC 3K TileDB filtered")).toHaveCount(0);
  await page.goto("/catalog/resources/pbmc-3k?demoRole=user");
  await expect(page.getByRole("dialog", { name: "Resource details" })).toContainText("PBMC 3K TileDB filtered");
  await expect(page.getByText("Private", { exact: true }).first()).toBeVisible();
});

test("admin reviews dashboard and saves settings", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("heading", { name: "System Services" })).toBeVisible();
  await expect(page.getByText("PostgreSQL")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.goto("/admin/settings");
  const name = page.getByLabel("Instance name");
  await name.fill("ShennongDB Research");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name:"Storage", exact:true }).click();
  await expect(page.getByLabel("S3 endpoint")).toHaveValue("https://s3.internal");
  await page.getByRole("button", { name:"Advanced", exact:true }).click();
  await expect(page.getByLabel("Audit logs (days)")).toHaveValue("365");
});

test("admin resource deletion requires confirmation", async ({ page }) => {
  await page.goto("/catalog?demoRole=admin");
  await page.getByText("Toil RNA-seq (Homo sapiens)").click();
  await page.getByLabel("More resource actions").click();
  await page.getByRole("button", { name: "Delete Resource" }).click();
  await expect(page.getByRole("heading", { name: "Delete Resource" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("token, collection, and admin destructive dialogs are operable", async ({ page }) => {
  await page.goto("/console/api-access");
  await page.getByRole("button", { name:"Create token" }).click();
  await expect(page.getByRole("heading", { name:"Create API Token" })).toBeVisible();
  await expect(page.getByLabel("Expiration")).toHaveValue("90");
  await page.getByLabel("Token name").fill("Playwright notebook");
  await page.getByRole("button", { name:"Create token" }).last().click();
  await expect(page.getByRole("heading", { name:"Token created" })).toBeVisible();
  await expect(page.getByText("sndb_demo_secret_copy_once")).toBeVisible();
  await page.getByRole("button", { name:"I saved this token" }).click();
  await expect(page.getByRole("row", { name:/Playwright notebook/ })).toBeVisible();
  await page.getByLabel("Revoke Playwright notebook").click();
  await page.getByRole("button", { name:"Revoke token" }).click();
  await expect(page.getByRole("row", { name:/Playwright notebook/ })).toHaveCount(0);
  await page.goto("/catalog/collections");
  await page.getByRole("button", { name:"Create collection" }).click();
  await page.getByLabel("Name").fill("Spatial atlas review");
  await page.getByLabel("Description").fill("Resources selected for spatial transcriptomics review.");
  await page.getByRole("button", { name:"Create collection" }).last().click();
  await expect(page.getByText("Spatial atlas review")).toBeVisible();
  await page.getByRole("button", { name:"Spatial atlas review", exact:true }).click();
  await page.getByRole("button", { name:"Rename" }).click();
  await page.getByLabel("Name").fill("Spatial atlas approved");
  await page.getByRole("button", { name:"Rename" }).last().click();
  await expect(page.getByRole("dialog", { name:"Collection details" })).toContainText("Spatial atlas approved");
  await page.getByRole("button", { name:"Add resource" }).click();
  await expect(page.getByText("GENCODE v44 gene map")).toBeVisible();
  await page.getByLabel("Remove GENCODE v44 gene map").click();
  await page.getByLabel("Share collection").check();
  await page.getByRole("button", { name:"Close collection details" }).click();
  await page.getByLabel("Delete Spatial atlas approved").click();
  await expect(page.getByRole("heading", { name:"Delete collection?" })).toBeVisible();
  await page.getByRole("button", { name:"Cancel" }).click();
  await page.goto("/admin/users");
  await page.getByRole("button", { name:"Disable" }).first().click();
  await expect(page.getByRole("heading", { name:"Confirm destructive action" })).toBeVisible();
  await page.getByRole("button", { name:"Cancel" }).click();
});

test("account profile and security controls are operable", async ({ page }) => {
  await page.goto("/console/profile");
  await page.getByLabel("Display name").fill("Dr. Maya Q. Chen");
  await page.getByRole("button", { name:"Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Profile saved");
  await page.goto("/console/security");
  await page.getByRole("button", { name:"Change password" }).click();
  await expect(page.getByRole("heading", { name:"Change password" })).toBeVisible();
  await page.getByRole("button", { name:"Cancel" }).click();
  await page.getByRole("button", { name:"View codes" }).click();
  await expect(page.getByText("A7KD-2MPQ")).toBeVisible();
  await page.getByRole("button", { name:"Done" }).click();
  await page.goto("/console/sessions");
  await page.getByRole("button", { name:"Revoke" }).last().click();
  await page.getByRole("button", { name:"Revoke session" }).click();
  await expect(page.getByText("Safari · macOS")).toHaveCount(0);
  await page.goto("/console/login-history");
  await page.getByLabel("Result").selectOption("failed");
  await expect(page.getByText("2FA failed")).toBeVisible();
  await expect(page.locator("tbody").getByText("Success")).toHaveCount(0);
});

test("command palette, help, and notifications respond", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop topbar controls");
  await page.goto("/catalog");
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("heading", { name:"Command palette" })).toBeVisible();
  await page.getByPlaceholder("Search resources or open a workspace…").fill("system settings");
  await page.getByRole("link", { name:/Open system settings/ }).click();
  await expect(page).toHaveURL(/admin\/settings/);
  await page.getByRole("button", { name:"Help" }).click();
  await expect(page.getByText("Help & documentation")).toBeVisible();
  await page.getByRole("button", { name:"Help" }).click();
  await page.getByLabel("Notifications").click();
  await expect(page.getByText("Ingestion completed")).toBeVisible();
  await page.getByRole("button", { name:"Mark all as read" }).click();
  await expect(page.getByText("Ingestion completed")).toHaveCount(0);
});

test("admin user detail tabs and security actions work", async ({ page }) => {
  await page.goto("/admin/users");
  await page.getByRole("link", { name:"Dr. Maya Chen" }).click();
  await expect(page).toHaveURL(/admin\/users\/dr.-maya-chen/);
  await expect(page.getByText("Login failures")).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name:"Grants", exact:true }).click();
  await expect(page.getByText("PBMC 3K TileDB filtered")).toBeVisible();
  await page.getByRole("button", { name:"Tokens", exact:true }).click();
  await expect(page.getByText("sndb_7f2a••••")).toBeVisible();
  await page.getByRole("button", { name:"Overview", exact:true }).click();
  await page.getByRole("button", { name:"Reset 2FA" }).click();
  await expect(page.getByRole("heading", { name:"Reset 2FA" })).toBeVisible();
  await page.getByRole("button", { name:"Cancel" }).click();
  await page.getByRole("button", { name:"Disable" }).click();
  await page.getByRole("button", { name:"Confirm" }).click();
  await expect(page.getByText("Disabled")).toBeVisible();
});

test("admin grants resource access with explicit scopes", async ({ page }) => {
  await page.goto("/admin/grants");
  await page.getByRole("button", { name: "Create grant" }).click();
  await page.getByLabel("User").fill("noah@research.net");
  await page.getByRole("textbox", { name: "Resource", exact: true }).fill("TCGA survival metadata");
  await page.getByLabel("query.execute").check();
  await page.getByLabel("Expiration").fill("2026-12-31");
  await page.getByLabel("Reason").fill("Approved survival analysis collaboration");
  await page.getByRole("button", { name: "Create grant" }).last().click();
  await expect(page.getByRole("row", { name: /noah@research.net/ })).toContainText("resource.read, query.execute");
});

test("provider, ingestion, and audit detail drawers expose operational evidence", async ({ page }) => {
  await page.goto("/admin/providers");
  await page.getByRole("row", { name:/TCGA/ }).click();
  await expect(page.getByLabel("Providers details")).toContainText("Manifest valid");
  await page.getByRole("button", { name:"Checksums", exact:true }).click();
  await page.getByRole("button", { name:"Close details" }).click();
  await page.goto("/admin/ingestion");
  await page.getByRole("row", { name:/ing-7842/ }).click();
  await expect(page.getByLabel("Ingestion jobs details")).toContainText("materializing");
  await page.getByRole("button", { name:"Logs", exact:true }).click();
  await expect(page.getByText(/checksum verified/)).toBeVisible();
  await page.getByRole("button", { name:"Close details" }).click();
  await page.goto("/admin/audit");
  await page.getByRole("row", { name:/grant.create/ }).click();
  await expect(page.getByLabel("Audit log details")).toContainText("request_id");
});

test("password recovery keeps account existence private and validates reset", async ({ page }) => {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill("unknown@example.org");
  await page.getByRole("button", { name:"Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  await page.goto("/auth/reset-password");
  await page.getByLabel("New password").fill("correct-horse-battery");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("button", { name:"Reset password" }).click();
  await expect(page.getByText("Passwords do not match")).toBeVisible();
  await page.getByLabel("Confirm password").fill("correct-horse-battery");
  await page.getByRole("button", { name:"Reset password" }).click();
  await expect(page.getByRole("status")).toContainText("Verification complete");
});

test("my data, uploads, and jobs support their primary operations", async ({ page }) => {
  await page.goto("/console/my-data");
  await page.getByRole("tab", { name:"Favorites" }).click();
  await expect(page.getByText("Toil RNA-seq (Homo sapiens)")).toBeVisible();
  await page.getByLabel(/Remove Toil RNA-seq/).click();
  await expect(page.getByText("No favorite resources")).toBeVisible();
  await page.goto("/console/uploads");
  await page.getByRole("button", { name:"View PBMC May snapshot" }).click();
  await expect(page.getByRole("dialog", { name:"Upload details" })).toContainText("Checksum verified");
  await page.getByRole("button", { name:"Close upload details" }).click();
  await page.getByLabel("Retry WGS batch 24").click();
  await expect(page.getByRole("row", { name:/WGS batch 24/ })).toContainText("Validating");
  await page.getByLabel("Cancel PBMC May snapshot").click();
  await page.getByRole("button", { name:"Cancel upload" }).click();
  await expect(page.getByRole("row", { name:/PBMC May snapshot/ })).toContainText("Cancelled");
  await page.goto("/console/jobs");
  await page.getByRole("button", { name:"ing-7842" }).click();
  await expect(page.getByRole("dialog", { name:"Ingestion job details" })).toContainText("materializing");
  await page.getByRole("button", { name:"Logs", exact:true }).click();
  await expect(page.getByText(/checksum verified/)).toBeVisible();
});

test("storage, security, and backup policies save and confirm destructive work", async ({ page }) => {
  await page.goto("/admin/storage");
  await page.getByLabel("Staging retention (days)").fill("14");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name:"Save policy" }).click();
  await expect(page.getByText("Policy saved")).toBeVisible();
  await page.goto("/admin/security");
  await page.getByLabel("Session timeout (hours)").fill("24");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name:"Save policies" }).click();
  await expect(page.getByText("Policies saved")).toBeVisible();
  await page.goto("/admin/backups");
  await page.getByRole("button", { name:"Run backup" }).click();
  await expect(page.getByText("In progress")).toBeVisible();
  await page.getByRole("button", { name:"Restore" }).last().click();
  await expect(page.getByRole("heading", { name:"Restore backup?" })).toBeVisible();
  await expect(page.getByRole("button", { name:"Restore backup" })).toBeDisabled();
  await page.getByLabel("Type RESTORE to confirm").fill("RESTORE");
  await page.getByRole("button", { name:"Restore backup" }).click();
  await expect(page.getByRole("heading", { name:"Restore backup?" })).toHaveCount(0);
});

test("mobile catalog uses navigation sheet and full-screen resource", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only smoke");
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Collections" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.getByText("Toil RNA-seq (Homo sapiens)").click();
  await expect(page.getByLabel("Resource details")).toBeVisible();
});

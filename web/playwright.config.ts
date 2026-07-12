import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "SHENNONG_WEB_DEMO=1 NEXT_PUBLIC_MSW_ENABLED=1 NEXT_PUBLIC_SHENNONG_DEMO_ROLE=admin pnpm dev", url: "http://127.0.0.1:3000/catalog", reuseExistingServer: false, timeout: 120_000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], browserName: "chromium" } }
  ]
});

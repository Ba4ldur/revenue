import { defineConfig } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Dublê determinístico de extração liberado apenas para o E2E local.
    env: { ALLOW_TEST_PROVIDER: "1", AI_PROVIDER: "deterministic-test", NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
  },
});

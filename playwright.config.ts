import { defineConfig } from "@playwright/test";
// Runs against a live dev server (EMAIL_PROVIDER=dev so OTPs can be read from /api/dev/mail).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE ?? "http://localhost:3000", viewport: { width: 1280, height: 800 } },
});

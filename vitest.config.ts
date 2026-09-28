// Local test secrets live in .env.test (gitignored); CI passes real env vars.
try { process.loadEnvFile(".env.test"); } catch { /* optional */ }
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
});

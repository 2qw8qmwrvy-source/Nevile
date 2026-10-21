import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

/**
 * TEST_DATABASE_URL from the shell, or else from the root `.env` (copied from
 * `.env.example`). Only that variable is read, so tests never pick up the dev DATABASE_URL.
 */
function testDatabaseEnv(): Record<string, string> {
  if (process.env.TEST_DATABASE_URL) return {};
  const rootEnv = new URL("../../.env", import.meta.url);
  if (!existsSync(rootEnv)) return {};
  const value = parseEnv(readFileSync(rootEnv, "utf8")).TEST_DATABASE_URL;
  return value ? { TEST_DATABASE_URL: value } : {};
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: testDatabaseEnv(),
    // Test files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

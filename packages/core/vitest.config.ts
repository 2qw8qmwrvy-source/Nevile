import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // A host zone far from Canada: any accidental use of local time breaks the tests.
    env: { TZ: "Asia/Kolkata" },
  },
});

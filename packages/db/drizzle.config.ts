import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  // `generate` works offline; `migrate`/`push`/`studio` need DATABASE_URL.
  ...(url ? { dbCredentials: { url } } : {}),
});

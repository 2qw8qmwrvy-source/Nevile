import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** Fresh database and an empty outbox before every run. */
export default function globalSetup() {
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://nevile:nevile@localhost:5432/nevile_e2e";
  execFileSync("pnpm", ["--filter", "@nevile/db", "run", "reset:e2e"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  const outbox = resolve(import.meta.dirname, ".outbox");
  rmSync(outbox, { recursive: true, force: true });
  mkdirSync(outbox, { recursive: true });
}

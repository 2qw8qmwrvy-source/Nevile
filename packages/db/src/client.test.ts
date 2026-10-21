import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, db, getDb } from "./client.ts";
import { serviceCategories } from "./schema/index.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("client", () => {
  let savedUrl: string | undefined;

  beforeEach(async () => {
    savedUrl = process.env.DATABASE_URL;
    await closeDb();
  });

  afterEach(async () => {
    await closeDb();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it("createDb requires a URL", () => {
    expect(() => createDb("")).toThrow(/connection URL is required/);
  });

  it("getDb throws a clear error when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
    // The lazy handle only resolves on use.
    expect(() => db.select).toThrow(/DATABASE_URL is not set/);
  });

  it.skipIf(!TEST_DATABASE_URL)("db lazily connects to DATABASE_URL and is shared", async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    expect(getDb()).toBe(getDb());
    const rows = await db.select({ id: serviceCategories.id }).from(serviceCategories).limit(1);
    expect(Array.isArray(rows)).toBe(true);
    const viaTransaction = await db.transaction(async (tx) =>
      tx.$count(serviceCategories),
    );
    expect(typeof viaTransaction).toBe("number");
  });
});

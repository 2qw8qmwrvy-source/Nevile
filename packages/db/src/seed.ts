import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_CATEGORIES } from "@nevile/core";
import { sql } from "drizzle-orm";
import { createDb, type DbExecutor } from "./client.ts";
import { serviceCategories } from "./schema/index.ts";

export interface CategorySeed {
  slug: string;
  name: string;
  description: string;
}

/**
 * Inserts missing categories and refreshes name/description of existing ones (matched
 * by slug). `active` and `sort_order` are left alone on existing rows so admin edits
 * survive re-seeding. Returns the number of rows inserted or changed.
 */
export async function seedCategories(
  db: DbExecutor,
  categories: readonly CategorySeed[] = DEFAULT_CATEGORIES,
): Promise<number> {
  if (categories.length === 0) return 0;
  const rows = categories.map((category, index) => ({
    slug: category.slug,
    name: category.name,
    description: category.description,
    sortOrder: index,
  }));
  const changed = await db
    .insert(serviceCategories)
    .values(rows)
    .onConflictDoUpdate({
      target: serviceCategories.slug,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`(${serviceCategories.name}, ${serviceCategories.description}) IS DISTINCT FROM (excluded.name, excluded.description)`,
    })
    .returning({ id: serviceCategories.id });
  return changed.length;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const db = createDb(url, { max: 1 });
  try {
    const changed = await seedCategories(db);
    console.log(
      `Service categories: ${changed} inserted or updated (${DEFAULT_CATEGORIES.length} defined).`,
    );
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  });
}

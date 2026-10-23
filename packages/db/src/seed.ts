import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_CATEGORIES } from "@nevile/core";
import { sql } from "drizzle-orm";
import { createDb, type DbExecutor } from "./client.ts";
import { postalAreas, serviceCategories } from "./schema/index.ts";

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

export interface PostalAreaSeed {
  code: string;
  placeName: string;
  lat: number;
  lng: number;
}

type StarterFile = { source: string; province: "NS"; areas: PostalAreaSeed[] };

/** The approximate Nova Scotia starter list (SPEC §18), from `data/`. */
export function starterPostalAreas(): StarterFile {
  const file = new URL("../data/postal-areas-ns-starter.json", import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as StarterFile;
}

/**
 * Adds starter postal areas that don't exist yet. Never overwrites a row, so data imported
 * from Statistics Canada (`pnpm db:import-postal-areas`) always wins.
 */
export async function seedPostalAreas(
  db: DbExecutor,
  starter: StarterFile = starterPostalAreas(),
): Promise<number> {
  if (starter.areas.length === 0) return 0;
  const inserted = await db
    .insert(postalAreas)
    .values(
      starter.areas.map((area) => ({
        code: area.code,
        province: starter.province,
        placeName: area.placeName,
        lat: area.lat,
        lng: area.lng,
        approximate: true,
        source: starter.source,
      })),
    )
    .onConflictDoNothing({ target: postalAreas.code })
    .returning({ code: postalAreas.code });
  return inserted.length;
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
    const areas = await seedPostalAreas(db);
    console.log(`Postal areas: ${areas} starter rows added (existing rows are never changed).`);
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

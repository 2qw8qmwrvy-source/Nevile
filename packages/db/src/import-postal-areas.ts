import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isProvinceCode, type ProvinceCode, postalCodeProvince } from "@nevile/core";
import { sql } from "drizzle-orm";
import { createDb, type DbExecutor } from "./client.ts";
import { POSTAL_AREA_PATTERN, postalAreas } from "./schema/index.ts";

export type ImportedArea = {
  code: string;
  placeName: string;
  lat: number;
  lng: number;
  province: ProvinceCode;
};

/** Minimal RFC 4180 parser: commas, quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

const areaPattern = new RegExp(POSTAL_AREA_PATTERN);

/**
 * Reads a CSV with a header row containing `code`, `place_name`, `lat`, `lng` and optional
 * `province` (columns in any order). Rows are validated; any bad row stops the import.
 */
export function readAreasCsv(text: string): ImportedArea[] {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) throw new Error("The CSV is empty.");
  const columns = header.map((name) => name.trim().toLowerCase());
  const index = (name: string, required = true) => {
    const position = columns.indexOf(name);
    if (position < 0 && required) throw new Error(`The CSV needs a "${name}" column.`);
    return position;
  };
  const codeAt = index("code");
  const placeAt = index("place_name");
  const latAt = index("lat");
  const lngAt = index("lng");
  const provinceAt = index("province", false);

  return body.map((row, offset) => {
    const line = offset + 2;
    const code = (row[codeAt] ?? "").trim().toUpperCase();
    const placeName = (row[placeAt] ?? "").trim();
    const lat = Number(row[latAt]);
    const lng = Number(row[lngAt]);
    const province =
      (provinceAt >= 0 ? (row[provinceAt] ?? "").trim().toUpperCase() : "") ||
      postalCodeProvince(`${code} 0A0`);
    if (!areaPattern.test(code)) throw new Error(`Line ${line}: "${code}" is not a postal area.`);
    if (!placeName) throw new Error(`Line ${line}: place_name is empty.`);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`Line ${line}: bad lat.`);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error(`Line ${line}: bad lng.`);
    if (!isProvinceCode(province)) throw new Error(`Line ${line}: unknown province "${province}".`);
    return { code, placeName, lat, lng, province };
  });
}

/** Upserts official areas: they replace starter rows and clear the `approximate` flag. */
export async function importPostalAreas(
  db: DbExecutor,
  areas: readonly ImportedArea[],
  source: string,
): Promise<number> {
  if (areas.length === 0) return 0;
  const written = await db
    .insert(postalAreas)
    .values(areas.map((area) => ({ ...area, approximate: false, source })))
    .onConflictDoUpdate({
      target: postalAreas.code,
      set: {
        province: sql`excluded.province`,
        placeName: sql`excluded.place_name`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        approximate: false,
        source: sql`excluded.source`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ code: postalAreas.code });
  return written.length;
}

async function main(): Promise<void> {
  const [file, ...rest] = process.argv.slice(2);
  const sourceFlag = rest.find((arg) => arg.startsWith("--source="));
  const source = sourceFlag?.slice("--source=".length) || "Statistics Canada FSA boundary file";
  const url = process.env.DATABASE_URL;
  if (!file) throw new Error("Usage: pnpm db:import-postal-areas <file.csv> [--source=...]");
  if (!url) throw new Error("DATABASE_URL is not set.");
  const areas = readAreasCsv(readFileSync(resolve(process.cwd(), file), "utf8"));
  const db = createDb(url, { max: 1 });
  try {
    const written = await importPostalAreas(db, areas, source);
    console.log(`Postal areas: ${written} imported from ${file} (source: ${source}).`);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error("Import failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

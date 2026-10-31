import { describe, expect, it } from "vitest";
import { CATEGORY_SLUGS, DEFAULT_CATEGORIES, isCategorySlug } from "./categories.ts";

describe("DEFAULT_CATEGORIES", () => {
  it("lists the eight launch categories from SPEC §3", () => {
    expect(DEFAULT_CATEGORIES.map((category) => [category.slug, category.name])).toEqual([
      ["lawn-mowing", "Lawn Mowing"],
      ["snow-ice-removal", "Snow & Ice Removal"],
      ["house-cleaning", "House Cleaning"],
      ["gutter-cleaning", "Gutter Cleaning"],
      ["leaf-cleanup", "Leaf Cleanup"],
      ["window-washing", "Window Washing"],
      ["pressure-washing", "Pressure Washing"],
      ["yard-cleanup", "Yard Cleanup"],
    ]);
  });

  it("keeps slugs in sync with CATEGORY_SLUGS", () => {
    expect(DEFAULT_CATEGORIES.map((category) => category.slug)).toEqual([...CATEGORY_SLUGS]);
  });

  it("has unique kebab-case slugs and non-empty descriptions", () => {
    const slugs = DEFAULT_CATEGORIES.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(category.description.length).toBeGreaterThan(10);
      expect(category.description.length).toBeLessThanOrEqual(200);
    }
  });

  it("recognises slugs", () => {
    expect(isCategorySlug("lawn-mowing")).toBe(true);
    expect(isCategorySlug("Lawn Mowing")).toBe(false);
    expect(isCategorySlug(7)).toBe(false);
  });
});

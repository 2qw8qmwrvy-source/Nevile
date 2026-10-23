import { describe, expect, it } from "vitest";
import { DEFAULT_API_CONFIG, parseBooleanEnv, readApiConfig } from "./config.ts";

describe("api config", () => {
  it("keeps Nevile Neighbours off unless switched on", () => {
    expect(DEFAULT_API_CONFIG.neighboursEnabled).toBe(false);
    expect(readApiConfig({})).toMatchObject({ neighboursEnabled: false });
    expect(readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: "" })).toMatchObject({
      neighboursEnabled: false,
    });
    expect(readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: " TRUE " })).toMatchObject({
      neighboursEnabled: true,
    });
    expect(readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: "0" })).toMatchObject({
      neighboursEnabled: false,
    });
  });

  it("refuses values that are not clearly true or false", () => {
    expect(() => readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: "maybe" })).toThrow(
      /NEVILE_NEIGHBOURS_ENABLED must be "true" or "false"/,
    );
    expect(parseBooleanEnv("X", "on", false)).toBe(true);
    expect(parseBooleanEnv("X", "no", true)).toBe(false);
    expect(parseBooleanEnv("X", undefined, true)).toBe(true);
  });

  it("reads the site URL for links in emails", () => {
    expect(readApiConfig({})).toMatchObject({ siteUrl: "http://localhost:3000", opsEmail: null });
    expect(
      readApiConfig({
        NEXT_PUBLIC_SITE_URL: "https://nevile.ca/",
        NEVILE_OPS_EMAIL: "ops@nevile.ca",
      }),
    ).toMatchObject({ siteUrl: "https://nevile.ca", opsEmail: "ops@nevile.ca" });
  });
});

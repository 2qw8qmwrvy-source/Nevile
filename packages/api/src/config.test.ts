import { describe, expect, it } from "vitest";
import { DEFAULT_API_CONFIG, parseBooleanEnv, readApiConfig } from "./config.ts";

describe("api config", () => {
  it("keeps Nevile Neighbours off unless switched on", () => {
    expect(DEFAULT_API_CONFIG.neighboursEnabled).toBe(false);
    expect(readApiConfig({})).toEqual({ neighboursEnabled: false });
    expect(readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: "" })).toEqual({ neighboursEnabled: false });
    expect(readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: " TRUE " })).toEqual({
      neighboursEnabled: true,
    });
    expect(readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: "0" })).toEqual({ neighboursEnabled: false });
  });

  it("refuses values that are not clearly true or false", () => {
    expect(() => readApiConfig({ NEVILE_NEIGHBOURS_ENABLED: "maybe" })).toThrow(
      /NEVILE_NEIGHBOURS_ENABLED must be "true" or "false"/,
    );
    expect(parseBooleanEnv("X", "on", false)).toBe(true);
    expect(parseBooleanEnv("X", "no", true)).toBe(false);
    expect(parseBooleanEnv("X", undefined, true)).toBe(true);
  });
});

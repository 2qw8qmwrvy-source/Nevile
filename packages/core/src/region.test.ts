import { describe, expect, it } from "vitest";
import { POSTAL_CODE_INVALID_MESSAGE } from "./contact-formats.ts";
import {
  isLaunchPostalCode,
  isLaunchProvince,
  LAUNCH_PROVINCES,
  OUTSIDE_LAUNCH_REGION_MESSAGE,
  postalCodeProvince,
} from "./launch-region.ts";
import { launchPostalCodeSchema } from "./region.ts";
import { PROVINCE_CODES, type ProvinceCode } from "./tax.ts";

describe("LAUNCH_PROVINCES", () => {
  it("is Nova Scotia only (SPEC §2)", () => {
    expect(LAUNCH_PROVINCES).toEqual(["NS"]);
    expect(OUTSIDE_LAUNCH_REGION_MESSAGE).toBe("Nevile is only in Nova Scotia for now.");
  });

  it("recognises launch provinces", () => {
    expect(isLaunchProvince("NS")).toBe(true);
    for (const code of PROVINCE_CODES.filter((code) => code !== "NS")) {
      expect(isLaunchProvince(code)).toBe(false);
    }
    expect(isLaunchProvince("ns")).toBe(false);
    expect(isLaunchProvince(null)).toBe(false);
    expect(isLaunchProvince("NB", ["NS", "NB"])).toBe(true);
  });
});

describe("postalCodeProvince", () => {
  it.each<[string, ProvinceCode]>([
    ["A1C 5M2", "NL"], // St. John's
    ["B3H 4R2", "NS"], // Halifax
    ["B1P 6L2", "NS"], // Sydney
    ["B4N 1K9", "NS"], // Kentville
    ["C1A 4P3", "PE"], // Charlottetown
    ["E1C 4M3", "NB"], // Moncton
    ["G1R 4P5", "QC"], // Quebec City
    ["H2X 1Y4", "QC"], // Montreal
    ["J8X 3X7", "QC"], // Gatineau
    ["K1A 0B1", "ON"], // Ottawa
    ["L5B 3C2", "ON"], // Mississauga
    ["M5V 3L9", "ON"], // Toronto
    ["N2L 3G1", "ON"], // Waterloo
    ["P3E 2C6", "ON"], // Sudbury
    ["R3C 4T3", "MB"], // Winnipeg
    ["S4P 3V7", "SK"], // Regina
    ["T2P 2V7", "AB"], // Calgary
    ["V6B 4Y8", "BC"], // Vancouver
    ["X1A 2L9", "NT"], // Yellowknife
    ["Y1A 1B2", "YT"], // Whitehorse
  ])("%s is in %s", (postal, province) => {
    expect(postalCodeProvince(postal)).toBe(province);
  });

  it("maps every X code to NT, including Nunavut's (documented ambiguity)", () => {
    expect(postalCodeProvince("X0A 0H0")).toBe("NT"); // Iqaluit, NU
    expect(postalCodeProvince("X0E 0P0")).toBe("NT");
  });

  it("normalizes before reading the first letter", () => {
    expect(postalCodeProvince(" b3h4r2 ")).toBe("NS");
    expect(postalCodeProvince("b3h-4r2")).toBe("NS");
  });

  it.each(["", "B3H", "D1A 1A1", "W1A 1A1", "Z1A 1A1", "90210", "B3H 4R22", "BBB 222"])(
    "returns null for invalid %j",
    (postal) => {
      expect(postalCodeProvince(postal)).toBeNull();
    },
  );
});

describe("isLaunchPostalCode", () => {
  it.each(["B3H 4R2", "b3h4r2", "B0J 2C0", "B2Y 4G8", "B5A 1A1"])(
    "accepts Nova Scotia code %s",
    (postal) => {
      expect(isLaunchPostalCode(postal)).toBe(true);
    },
  );

  it.each(["E1C 4M3", "C1A 4P3", "A1C 5M2", "M5V 3L9", "H2X 1Y4", "V6B 4Y8", "X0A 0H0"])(
    "rejects out-of-region code %s",
    (postal) => {
      expect(isLaunchPostalCode(postal)).toBe(false);
    },
  );

  it.each(["", "not a code", "D3H 4R2", "B3H 4R"])("rejects invalid %j", (postal) => {
    expect(isLaunchPostalCode(postal)).toBe(false);
  });

  it("takes the province list as a setting", () => {
    expect(isLaunchPostalCode("E1C 4M3", ["NS", "NB"])).toBe(true);
    expect(isLaunchPostalCode("B3H 4R2", ["NB"])).toBe(false);
    expect(isLaunchPostalCode("B3H 4R2", [])).toBe(false);
  });
});

describe("launchPostalCodeSchema", () => {
  it.each([
    ["B3H 4R2", "B3H 4R2"],
    ["b3h4r2", "B3H 4R2"],
    ["  b3h-4r2 ", "B3H 4R2"],
    ["B0J2C0", "B0J 2C0"],
  ])("normalizes %j to %s", (input, expected) => {
    expect(launchPostalCodeSchema.parse(input)).toBe(expected);
  });

  it.each(["M5V 3L9", "E1C 4M3", "C1A 4P3", "X0A 0H0"])(
    "rejects %s with the Nova Scotia message",
    (input) => {
      const result = launchPostalCodeSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toHaveLength(1);
      expect(result.error?.issues[0]?.message).toBe("Nevile is only in Nova Scotia for now.");
    },
  );

  it.each(["", "B3H", "D3H 4R2", "12345"])(
    "rejects invalid %j with the format message",
    (input) => {
      const result = launchPostalCodeSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toHaveLength(1);
      expect(result.error?.issues[0]?.message).toBe(POSTAL_CODE_INVALID_MESSAGE);
    },
  );

  it.each([null, undefined, 3412, {}])("rejects non-string %j", (input) => {
    expect(launchPostalCodeSchema.safeParse(input).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  approximateLocation,
  boundingBox,
  formatDistanceKm,
  haversineKm,
  isWithinBounds,
  launchPointSchema,
  postalAreaOf,
} from "./geo.ts";

const halifax = { lat: 44.6488, lng: -63.5752 };
const dartmouth = { lat: 44.6658, lng: -63.5669 };
const sydney = { lat: 46.1368, lng: -60.1942 };
const toronto = { lat: 43.6532, lng: -79.3832 };

describe("haversineKm", () => {
  it("is zero for the same point and symmetric", () => {
    expect(haversineKm(halifax, halifax)).toBe(0);
    expect(haversineKm(halifax, sydney)).toBeCloseTo(haversineKm(sydney, halifax), 9);
  });

  it("matches known distances", () => {
    // Halifax–Dartmouth across the harbour is about 2 km.
    expect(haversineKm(halifax, dartmouth)).toBeGreaterThan(1.5);
    expect(haversineKm(halifax, dartmouth)).toBeLessThan(2.5);
    // Halifax–Sydney is about 310 km as the crow flies.
    expect(haversineKm(halifax, sydney)).toBeGreaterThan(300);
    expect(haversineKm(halifax, sydney)).toBeLessThan(320);
  });
});

describe("boundingBox", () => {
  it("contains every point within the radius", () => {
    const box = boundingBox(halifax, 25);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const radians = (bearing * Math.PI) / 180;
      // A point ~24.9 km away in each direction (small-distance approximation).
      const point = {
        lat: halifax.lat + (24.9 / 111.2) * Math.cos(radians),
        lng:
          halifax.lng +
          (24.9 / (111.2 * Math.cos((halifax.lat * Math.PI) / 180))) * Math.sin(radians),
      };
      expect(haversineKm(halifax, point)).toBeLessThan(25);
      expect(point.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(point.lat).toBeLessThanOrEqual(box.maxLat);
      expect(point.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(point.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it("is clamped to valid coordinates", () => {
    const box = boundingBox({ lat: 89.9, lng: 179.9 }, 500);
    expect(box.maxLat).toBe(90);
    expect(box.maxLng).toBe(180);
  });
});

describe("approximateLocation", () => {
  it("rounds to two decimals (about 1 km)", () => {
    expect(approximateLocation({ lat: 44.64878, lng: -63.57519 })).toEqual({
      lat: 44.65,
      lng: -63.58,
    });
    expect(haversineKm(halifax, approximateLocation(halifax))).toBeLessThan(1);
  });
});

describe("Nova Scotia bounds", () => {
  it("accepts Nova Scotia points and rejects others", () => {
    expect(isWithinBounds(halifax)).toBe(true);
    expect(isWithinBounds(sydney)).toBe(true);
    expect(isWithinBounds({ lat: 43.8374, lng: -66.1174 })).toBe(true); // Yarmouth
    expect(isWithinBounds(toronto)).toBe(false);
    expect(launchPointSchema.safeParse(halifax).success).toBe(true);
    expect(launchPointSchema.safeParse(toronto).success).toBe(false);
    expect(launchPointSchema.safeParse({ lat: Number.NaN, lng: -63 }).success).toBe(false);
  });
});

describe("postalAreaOf", () => {
  it("extracts the forward sortation area", () => {
    expect(postalAreaOf("b3h 1a1")).toBe("B3H");
    expect(postalAreaOf("B3H1A1")).toBe("B3H");
    expect(postalAreaOf(" b2y ")).toBe("B2Y");
  });

  it("rejects things that aren't postal codes or areas", () => {
    for (const value of ["", "B3", "123", "D3H", "B3O", "hello", "B3H 1A", "W1A"]) {
      expect(postalAreaOf(value), value).toBeNull();
    }
  });
});

describe("formatDistanceKm", () => {
  it("rounds and handles small and invalid distances", () => {
    expect(formatDistanceKm(0.3)).toBe("Under 1 km");
    expect(formatDistanceKm(4.4)).toBe("4 km");
    expect(formatDistanceKm(22.6)).toBe("23 km");
    expect(formatDistanceKm(-1)).toBe("");
    expect(formatDistanceKm(Number.NaN)).toBe("");
  });
});

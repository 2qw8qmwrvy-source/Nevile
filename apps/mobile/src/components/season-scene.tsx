import { StyleSheet, View } from "react-native";

import { type Season, seasons } from "@/theme";

type ScenePalette = {
  sun: string;
  hillBack: string;
  hillFront: string;
  trunk: string;
  foliage: readonly [string, string, string];
  dots: string;
};

// Hand-picked from the approved mockup's fall cover, re-keyed per season.
const PALETTES: Record<Season, ScenePalette> = {
  winter: {
    sun: "#FFFFFF",
    hillBack: "#F4F8FB",
    hillFront: "#FFFFFF",
    trunk: "#6B7F8F",
    foliage: ["#9DBBD6", "#B9D0E4", "#CFDFEE"],
    dots: "#FFFFFF",
  },
  spring: {
    sun: "#F8F3DA",
    hillBack: "#CFE3C5",
    hillFront: "#B9D7A9",
    trunk: "#7A6A4F",
    foliage: ["#9CCB8F", "#F3C7D4", "#B7DCA9"],
    dots: "#F3C7D4",
  },
  summer: {
    sun: "#F4C66A",
    hillBack: "#C9E2B4",
    hillFront: "#A9CF95",
    trunk: "#7A5A3A",
    foliage: ["#6FA866", "#8FC07F", "#A9CF95"],
    dots: "#F4C66A",
  },
  fall: {
    sun: "#EDC9B4",
    hillBack: "#CFE3C5",
    hillFront: "#C1DAB4",
    trunk: "#9C6A4B",
    foliage: ["#E2A47F", "#D98E66", "#EDC9B4"],
    dots: "#C9744C",
  },
};

const DOTS = [
  { left: "12%", top: 18 },
  { left: "30%", top: 40 },
  { left: "54%", top: 14 },
  { left: "70%", top: 34 },
  { left: "88%", top: 22 },
  { left: "44%", top: 58 },
] as const;

/** Decorative seasonal landscape drawn with plain Views (no SVG dependency). */
export function SeasonScene({ season, height = 132 }: { season: Season; height?: number }) {
  const p = PALETTES[season];
  return (
    <View
      style={[styles.scene, { height, backgroundColor: seasons[season].tint }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={[styles.sun, { backgroundColor: p.sun }]} />
      {season === "winter" || season === "fall"
        ? DOTS.map((dot) => (
            <View
              key={`${dot.left}-${dot.top}`}
              style={[
                season === "winter" ? styles.flake : styles.leaf,
                { left: dot.left, top: dot.top, backgroundColor: p.dots },
              ]}
            />
          ))
        : null}
      <Tree left="10%" size={58} trunk={p.trunk} color={p.foliage[0]} bottom={30} />
      <Tree left="22%" size={36} trunk={p.trunk} color={p.foliage[1]} bottom={34} />
      <Tree left="74%" size={46} trunk={p.trunk} color={p.foliage[2]} bottom={32} />
      <View style={[styles.hill, styles.hillBack, { backgroundColor: p.hillBack }]} />
      <View style={[styles.hill, styles.hillFront, { backgroundColor: p.hillFront }]} />
    </View>
  );
}

function Tree({
  left,
  size,
  trunk,
  color,
  bottom,
}: {
  left: `${number}%`;
  size: number;
  trunk: string;
  color: string;
  bottom: number;
}) {
  return (
    <View style={[styles.tree, { left, bottom, width: size }]}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
      <View style={[styles.trunk, { backgroundColor: trunk, height: size * 0.45 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { overflow: "hidden", position: "relative" },
  sun: { position: "absolute", width: 64, height: 64, borderRadius: 32, right: 28, top: 18 },
  flake: { position: "absolute", width: 6, height: 6, borderRadius: 3 },
  leaf: { position: "absolute", width: 8, height: 5, borderRadius: 3, transform: [{ rotate: "-20deg" }] },
  tree: { position: "absolute", alignItems: "center" },
  trunk: { width: 6, borderRadius: 2, marginTop: -4 },
  hill: { position: "absolute", height: 160, borderRadius: 400 },
  hillBack: { left: "-20%", right: "10%", bottom: -118 },
  hillFront: { left: "20%", right: "-30%", bottom: -128 },
});

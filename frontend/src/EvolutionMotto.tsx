// Motto AdvisorOS "il CRM che si evolve con te" in stile "evoluzione" (V50.z183):
// • baseline comune (le parole poggiano sulla stessa linea di terra)
// • ogni lettera più grande della precedente e leggermente più in alto (postura sempre più eretta)
// • colore che evolve gradualmente da grigio a blu vivido
// • blocco finale "con te" nettamente più grande, staccato e illuminato (arancio AdvisorOS)
import React, { useState } from "react";
import { View, Text, StyleSheet, Platform, LayoutChangeEvent } from "react-native";

const WORDS = ["il", "CRM", "che", "si", "evolve"];
const FINAL = "con te";

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function hex(n: number) { return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0"); }
function mixColor(from: [number, number, number], to: [number, number, number], t: number) {
  return `#${hex(lerp(from[0], to[0], t))}${hex(lerp(from[1], to[1], t))}${hex(lerp(from[2], to[2], t))}`;
}

const GREY: [number, number, number] = [148, 163, 184];   // #94A3B8 — inizio, attenuato
const BLUE: [number, number, number] = [28, 72, 105];     // #1C4869 — blu AdvisorOS
const VIVID: [number, number, number] = [37, 99, 235];    // #2563EB — blu vivido
const ORANGE = "#F97316";                                  // "OS" AdvisorOS

type Props = { scale?: number; dark?: boolean; testID?: string };

const DESIGN_WIDTH = 372; // larghezza a cui il motto sta su una riga con scale 1

export function EvolutionMotto({ scale = 1, dark = false, testID }: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const fit = w > 0 ? Math.min(1.35, (w - 16) / DESIGN_WIDTH) : 1;
  const sc = scale * fit;
  const letters = WORDS.join(" ").split("");
  const n = letters.filter((c) => c !== " ").length;
  let k = 0;
  const minSize = 12 * sc, maxSize = 27 * sc, lift = 14 * sc;
  return (
    <View style={styles.wrap} testID={testID} accessibilityLabel="Il CRM che si evolve con te" onLayout={onLayout}>
      <View style={styles.row}>
        {letters.map((ch, i) => {
          if (ch === " ") return <View key={i} style={{ width: 6 * sc }} />;
          const t = n > 1 ? k / (n - 1) : 1; k += 1;
          const size = lerp(minSize, maxSize, t);
          const color = t < 0.5 ? mixColor(GREY, dark ? [147, 197, 253] : BLUE, t * 2) : mixColor(dark ? [147, 197, 253] : BLUE, dark ? [96, 165, 250] : VIVID, (t - 0.5) * 2);
          return (
            <Text
              key={i}
              style={[styles.letter, { fontSize: size, lineHeight: size * 1.05, color, fontWeight: t < 0.35 ? "600" : t < 0.7 ? "700" : "800", transform: [{ translateY: -lift * t }] }]}
            >
              {ch}
            </Text>
          );
        })}
        <View style={{ width: 12 * sc }} />
        <Text numberOfLines={1} style={[styles.final, { fontSize: 40 * sc, lineHeight: 42 * sc, transform: [{ translateY: -lift * 1.3 }] }]}>{FINAL}</Text>
      </View>
      <View style={[styles.ground, { backgroundColor: dark ? "rgba(255,255,255,0.25)" : "rgba(28,72,105,0.18)" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", alignSelf: "stretch", paddingHorizontal: 8 },
  row: { flexDirection: "row", alignItems: "flex-end", flexWrap: "nowrap", justifyContent: "center" },
  letter: { includeFontPadding: false, textAlignVertical: "bottom", letterSpacing: 0.2 },
  final: {
    color: ORANGE, fontWeight: "900", includeFontPadding: false, letterSpacing: -0.5,
    textShadowColor: "rgba(249,115,22,0.55)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: Platform.OS === "web" ? 18 : 12,
  },
  ground: { height: 2, alignSelf: "stretch", marginTop: 6, borderRadius: 1 },
});

export default EvolutionMotto;

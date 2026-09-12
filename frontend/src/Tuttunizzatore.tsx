// V50.z191 — Blocco loghi + tagline «Il tuo "Tuttunizzatore"» (modulo isolato).
// Struttura: logo AdvisorOS → logo AxonOS sotto (~60%) → tagline. Le virgolette doppie fanno parte del
// design (termine inventato); "Tutto" in arancione Brain+ per coerenza, resto bianco (o navy su chiaro).
import React from "react";
import { View, Text, Image, StyleSheet, type StyleProp, type ViewStyle, type ImageSourcePropType } from "react-native";

export const TUTTU_ORANGE = "#F97316";
export const TUTTU_TAGLINE_PLAIN = 'Il tuo "Tuttunizzatore"';

type TagProps = { dark?: boolean; size?: number; align?: "left" | "center"; style?: StyleProp<ViewStyle>; testID?: string };

/** Il tuo "Tuttunizzatore" — "Tutto" arancione, virgolette sempre presenti. */
export function TuttunizzatoreTagline({ dark = true, size = 15, align = "center", style, testID }: TagProps) {
  const base = dark ? "#FFFFFF" : "#1B2B4B";
  return (
    <View style={[{ alignItems: align === "center" ? "center" : "flex-start" }, style]} testID={testID}>
      <Text style={{ textAlign: align, color: base, fontSize: size, fontWeight: "700", letterSpacing: 0.3 }} accessibilityLabel={TUTTU_TAGLINE_PLAIN}>
        Il tuo &quot;<Text style={{ color: TUTTU_ORANGE, fontWeight: "900" }}>Tutto</Text>
        <Text style={{ color: base, fontWeight: "900" }}>nizzatore</Text>&quot;
      </Text>
    </View>
  );
}

type LogosProps = {
  advisorLogo: ImageSourcePropType;
  axonLogo: ImageSourcePropType;
  /** larghezza logo AdvisorOS (AxonOS = 60%) */
  width?: number;
  dark?: boolean;
  tagline?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Logo AdvisorOS, sotto AxonOS al 60%, poi la tagline. */
export function BrandLogosBlock({ advisorLogo, axonLogo, width = 150, dark = true, tagline = true, style, testID }: LogosProps) {
  const h = Math.round(width * 0.46);
  const aw = Math.round(width * 0.6);
  return (
    <View style={[styles.block, style]} testID={testID}>
      <Image source={advisorLogo} style={{ width, height: h }} resizeMode="contain" accessibilityLabel="AdvisorOS" />
      <Image source={axonLogo} style={{ width: aw, height: Math.round(aw * 0.3), marginTop: 6 }} resizeMode="contain" accessibilityLabel="AxonOS" />
      {tagline ? <TuttunizzatoreTagline dark={dark} size={15} style={{ marginTop: 10 }} /> : null}
    </View>
  );
}

/** Versione HTML (export PDF del Libretto). */
export function tuttunizzatoreHtml(opts?: { dark?: boolean; size?: number; align?: "left" | "center" }): string {
  const base = (opts?.dark ?? true) ? "#FFFFFF" : "#1B2B4B";
  const size = opts?.size ?? 16;
  return `<div style="text-align:${opts?.align ?? "center"};color:${base};font-size:${size}px;font-weight:700;letter-spacing:.3px;margin:10px 0 0">` +
    `Il tuo &quot;<span style="color:${TUTTU_ORANGE};font-weight:900">Tutto</span><span style="font-weight:900">nizzatore</span>&quot;</div>`;
}

const styles = StyleSheet.create({
  block: { alignItems: "center" },
});

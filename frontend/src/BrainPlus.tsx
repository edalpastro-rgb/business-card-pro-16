// V50.z190 — Claim ufficiale AxonOS "Brain+" (modulo isolato).
// Regole: "AxonOS" è il nome del prodotto, "Brain+" il claim che lo accompagna. Il "+" è SEMPRE
// arancione (CTA primario AdvisorOS #F97316), più grande delle lettere "Brain" e bold; "Brain" bianco
// su sfondo scuro/colorato, blu navy su sfondo chiaro.
import React from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

export const BRAIN_PLUS_ORANGE = "#F97316";
export const BRAIN_PLUS_NAVY = "#1B2B4B";
export const BRAIN_PLUS_CLAIM = "AxonOS — Brain+";
// DO NOT CHANGE - brand copy locked
export const BRAIN_PLUS_TAGLINE = "Il sistema operativo che amplifica le tue capacità.";
export const BRAIN_PLUS_EXAMPLE = "AxonOS Brain+ — Non dimentica nulla, non si stanca mai, conosce la tua vita.";
/** Sezioni del Libretto / Tour dove il claim compare (anche nei libretti personalizzati del Master, per id). */
export const BRAIN_PLUS_SECTION_IDS = new Set(["intro", "perche-diverso", "vantaggio-tempo", "chiusura"]);

type Props = {
  /** true = sfondo scuro/colorato → "Brain" bianco; false = sfondo chiaro → navy */
  dark?: boolean;
  /** dimensione base del testo (il "+" è ×1.45) */
  size?: number;
  /** mostra la tagline estesa sotto il claim */
  tagline?: boolean;
  /** testo che precede il claim (default "AxonOS — ") */
  prefix?: string;
  align?: "left" | "center";
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** "AxonOS — Brain+" con il "+" arancione, più grande e bold. */
export function BrainPlus({ dark = true, size = 22, tagline = false, prefix = "AxonOS — ", align = "left", style, testID }: Props) {
  const base = dark ? "#FFFFFF" : BRAIN_PLUS_NAVY;
  return (
    <View style={[{ alignItems: align === "center" ? "center" : "flex-start" }, style]} testID={testID}>
      <Text style={{ textAlign: align }} accessibilityLabel={`${prefix}Brain+`}>
        {prefix ? <Text style={{ color: base, fontSize: size, fontWeight: "800" }}>{prefix}</Text> : null}
        <Text style={{ color: base, fontSize: size, fontWeight: "900", letterSpacing: 0.3 }}>Brain</Text>
        <Text style={{ color: BRAIN_PLUS_ORANGE, fontSize: Math.round(size * 1.45), fontWeight: "900", lineHeight: Math.round(size * 1.5) }}>+</Text>
      </Text>
      {tagline ? (
        <Text style={[styles.tagline, { color: dark ? "rgba(255,255,255,0.88)" : "#475569", textAlign: align, fontSize: Math.max(12, Math.round(size * 0.58)) }]}>
          {BRAIN_PLUS_TAGLINE}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tagline: { marginTop: 4, fontWeight: "600", lineHeight: 18 },
});

/** Versione HTML per l'export PDF del Libretto (stesse regole visive). */
export function brainPlusHtml(opts?: { dark?: boolean; size?: number; tagline?: boolean; prefix?: string; align?: "left" | "center" }): string {
  const dark = opts?.dark ?? true;
  const size = opts?.size ?? 22;
  const prefix = opts?.prefix ?? "AxonOS — ";
  const base = dark ? "#FFFFFF" : BRAIN_PLUS_NAVY;
  const tag = opts?.tagline
    ? `<div style="color:${dark ? "rgba(255,255,255,0.88)" : "#475569"};font-size:${Math.max(12, Math.round(size * 0.58))}px;margin-top:4px">${BRAIN_PLUS_TAGLINE}</div>`
    : "";
  return `<div class="brainplus" style="text-align:${opts?.align ?? "left"};margin:6px 0 10px">` +
    `<span style="color:${base};font-size:${size}px;font-weight:800">${prefix}</span>` +
    `<span style="color:${base};font-size:${size}px;font-weight:900;letter-spacing:.3px">Brain</span>` +
    `<span style="color:${BRAIN_PLUS_ORANGE};font-size:${Math.round(size * 1.45)}px;font-weight:900;line-height:1">+</span>${tag}</div>`;
}

import React from "react";
import { Image, ImageProps, StyleSheet, View, ViewStyle } from "react-native";

/**
 * V29.e — Brand logos AdvisorOS + AxonOS.
 * Sostituiscono le icone Ionicons generiche in header, login, banner Home,
 * sezione "Insegna ad Axon" e chat AI.
 */

export const ADVISOROS_LOGO_URI =
  "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/fddd4f68234a4dc08c6bfc8db881a018_AdvisorOS App Logo -5-.png";

export const AXONOS_LOGO_URI =
  "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/592863265f614b9bb4273fef7b1b8f1b_AxonOS logo.png";

/** V50.z228 — Nuovo logo AxonOS (orizzontale, per sfondi CHIARI). Aspect 825/302. AxonOS è un componente di AdvisorOS: sempre più piccolo del logo AdvisorOS. */
export const AXONOS_LOGO_LIGHT = require("@/assets/images/axonos-logo-light.png");
export const AXONOS_LOGO_LIGHT_ASPECT = 825 / 302;

type LogoProps = {
  size?: number;
  style?: ViewStyle | ViewStyle[];
  onDark?: boolean; // aggiunge una piccola cornice quando su fondo scuro (utile per AxonOS)
  testID?: string;
};

export function AdvisorOSLogo({ size = 44, style, onDark, testID }: LogoProps) {
  return (
    <View
      testID={testID || "advisor-os-logo"}
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.2),
          // V29.ao — Su fondi scuri usiamo un box trasparente col ring sottile,
          // così il logo (con centro chiaro) resta leggibile senza cornice bianca.
          backgroundColor: onDark ? "rgba(255,255,255,0.06)" : "#FFFFFF",
          borderWidth: onDark ? 1 : 0,
          borderColor: onDark ? "rgba(147,197,253,0.35)" : "transparent",
        },
        style as any,
      ]}
    >
      <Image
        source={{ uri: ADVISOROS_LOGO_URI }}
        style={{ width: size * 0.86, height: size * 0.86 }}
        resizeMode="contain"
      />
    </View>
  );
}

export function AxonOSLogo({ size = 44, style, onDark, testID }: LogoProps) {
  // V50.z228 — nuovo logo orizzontale su pill BIANCA (il logo è pensato per sfondi chiari); su barre scure la pill resta bianca.
  const w = Math.round(size * 1.9);
  const h = Math.round(w / AXONOS_LOGO_LIGHT_ASPECT);
  return (
    <View
      testID={testID || "axon-os-logo"}
      style={[styles.wrap, { width: w, height: h, borderRadius: Math.round(size * 0.2), backgroundColor: "#E6EBEE", overflow: "hidden" }, style as any]}
    >
      <Image source={AXONOS_LOGO_LIGHT} style={{ width: w, height: h }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});

// Named default export for convenience
export default { AdvisorOSLogo, AxonOSLogo, ADVISOROS_LOGO_URI, AXONOS_LOGO_URI };

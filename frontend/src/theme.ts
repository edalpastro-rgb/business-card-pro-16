import { ACTIVE } from "@/src/themes";
import { HT } from "@/src/homeTheme";

// V50.z340 — `theme.color` deriva dal TEMA ATTIVO (Luce · Pearl · Slate · Midnight): tutte le ~150 schermate che lo
// usano ereditano la palette senza modifiche (equivalente RN delle CSS variables). Le chiavi restano invariate.
export const theme = {
  color: {
    surface: ACTIVE.bg,
    bg: ACTIVE.bg,
    background: ACTIVE.bg,
    onSurface: ACTIVE.text,
    surfaceSecondary: ACTIVE.card,
    surfaceTertiary: ACTIVE.card2,
    onSurfaceTertiary: ACTIVE.text2,
    surfaceInverse: ACTIVE.isDark ? ACTIVE.card2 : "#141D26",
    onSurfaceInverse: "#FFFFFF",
    brand: ACTIVE.accent,
    brandPrimary: ACTIVE.accent,
    primary: ACTIVE.accent,
    navy: ACTIVE.accent,
    onBrandPrimary: "#FFFFFF",
    brandSecondary: ACTIVE.accent2,
    brandTertiary: HT.brandTint,
    onBrandTertiary: ACTIVE.text,
    success: HT.success,
    warning: HT.warning,
    error: HT.danger,
    info: ACTIVE.accent2,
    border: ACTIVE.border,
    borderStrong: ACTIVE.borderStrong,
    divider: ACTIVE.border,
    energy: "#C83232",
    network: "#1B6CB0",
    muted: ACTIVE.muted,
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
};

export type Theme = typeof theme;

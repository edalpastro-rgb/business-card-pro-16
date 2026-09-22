export const theme = {
  color: {
    surface: "#F7F8FB",
    // V50.z327 — alias usati da 27 schermate (prima risolvevano a undefined → sfondo trasparente)
    bg: "#F7F8FB",
    background: "#F7F8FB",
    onSurface: "#111820",
    surfaceSecondary: "#FFFFFF",
    surfaceTertiary: "#EAEFF4",
    onSurfaceTertiary: "#293847",
    surfaceInverse: "#141D26",
    onSurfaceInverse: "#FFFFFF",
    brand: "#1C4869",
    brandPrimary: "#1C4869",
    primary: "#1C4869", // alias (GoogleDrivePickerModal, MicroTutorial, OnboardingWizard)
    navy: "#1C4869",
    onBrandPrimary: "#FFFFFF",
    brandSecondary: "#3A739C",
    brandTertiary: "#E6F0F7",
    onBrandTertiary: "#1C4869",
    success: "#2D7A5A",
    warning: "#B77C14",
    error: "#C83232",
    info: "#1B6CB0",
    border: "#E2E8F0",
    borderStrong: "#CBD5E1",
    divider: "#EDF1F5",
    energy: "#C83232",
    network: "#1B6CB0",
    muted: "#6B7A8A",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
};

export type Theme = typeof theme;

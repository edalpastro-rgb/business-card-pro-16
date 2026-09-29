// useResponsive.ts — V50.z409 — Breakpoint desktop/web per l'intera app.
// • isDesktop: finestra ≥ 1024 px (web desktop, tablet landscape): sidebar laterale al posto della bottom nav,
//   contenuti centrati a max CONTENT_MAX_W, griglie a 2 colonne (DesktopGrid).
// • isWide: ≥ 768 px (tablet portrait): solo densità maggiore, nessuna sidebar.
import { useWindowDimensions } from "react-native";

export const BP_WIDE = 768;
export const BP_DESKTOP = 1024;
export const SIDEBAR_W = 232;
export const CONTENT_MAX_W = 1200;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= BP_DESKTOP;
  return { width, height, isDesktop, isWide: width >= BP_WIDE, columns: isDesktop ? 2 : 1 };
}

export function useIsDesktop(): boolean {
  return useWindowDimensions().width >= BP_DESKTOP;
}

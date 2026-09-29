// V46 — Helper hook for bottom-sheet padding.
// Returns a safe bottom padding value that avoids being covered by the Android
// gesture navigation bar or iPhone home indicator. Falls back to a comfortable
// default of 28px when the safe-area inset is 0 (or web).
//
// Usage:
//   const bottomPad = useBottomSheetPadding();
//   <View style={[styles.sheetBox, { paddingBottom: bottomPad }]}>
//
// V49.h — Aggiunto `usePageBottomPadding()` per il contenuto scrollabile delle
// pagine dove è visibile la `PersistentBottomNav` (~60px + safe-area). Rende
// il paddingBottom del ScrollView coerente in modo globale evitando che il
// contenuto finale venga coperto dalla barra di navigazione Android.
//
// ══════════════════════════════════════════════════════════════════════════════
// ⚠️  REGOLA D'ORO (V50.x) — NON DIMENTICARE MAI
// ══════════════════════════════════════════════════════════════════════════════
// OGNI ScrollView / FlatList di una schermata dell'app DEVE usare
// `usePageBottomPadding()` come `paddingBottom` del `contentContainerStyle`.
// Se NON lo fai, il contenuto finale (card, banner, pulsanti) risulterà COPERTO
// dalla PersistentBottomNav (Home/Contatti/Chat/Calendario/Report/Profilo).
//
// ESEMPIO CORRETTO:
//   const bottomPad = usePageBottomPadding();
//   <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: bottomPad }}>
//
// ECCEZIONI (schermate che NASCONDONO la tab bar tramite HIDE_ON_PATHS):
//   - /google-drive-picker
//   - /axon-scripts-import
//   - /libretto-editor
//   In quei casi va bene `Math.max(insets.bottom, 16)`.
// ══════════════════════════════════════════════════════════════════════════════

import { useSafeAreaInsets, initialWindowMetrics } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";

export function useBottomSheetPadding(minPad: number = 28): number {
  const insets = useSafeAreaInsets();
  // V50.z165 — fallback a initialWindowMetrics: dentro i Modal Android insets.bottom è spesso 0
  const bottom = Math.max(insets?.bottom || 0, initialWindowMetrics?.insets?.bottom || 0);
  return Math.max(bottom + 12, minPad);
}

/**
 * V50.a — Restituisce il paddingBottom sicuro per il contenuto scrollabile di
 * una pagina che ha la PersistentBottomNav (o la Tabs nativa) visibile.
 * Include:
 *  - altezza della nav (~60px)
 *  - safe-area bottom (home indicator iOS / gesture bar Android)
 *  - un extraGap opzionale (default 24) per non attaccare l'ultimo elemento
 *    alla barra.
 *  - un minimo di 140px (allineato al setup della sezione Master Z) per
 *    garantire coerenza visiva su tutte le schermate dell'app.
 */
export function usePageBottomPadding(extraGap: number = 24): number {
  const insets = useSafeAreaInsets();
  const isDesktop = useWindowDimensions().width >= 1024; // V50.z409 — desktop: nessuna bottom nav → padding compatto
  const NAV_HEIGHT = 60;
  const bottom = Math.max(insets?.bottom || 0, initialWindowMetrics?.insets?.bottom || 0); // V50.z165
  if (isDesktop) return Math.max(32, bottom + extraGap);
  return Math.max(140, NAV_HEIGHT + bottom + extraGap);
}

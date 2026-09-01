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

import { useSafeAreaInsets } from "react-native-safe-area-context";

export function useBottomSheetPadding(minPad: number = 28): number {
  const insets = useSafeAreaInsets();
  return Math.max((insets?.bottom || 0) + 12, minPad);
}

/**
 * Restituisce il paddingBottom sicuro per il contenuto scrollabile di una
 * pagina che ha la PersistentBottomNav visibile. Include:
 *  - altezza della nav (~60px)
 *  - safe-area bottom (home indicator iOS / gesture bar Android)
 *  - un extraGap opzionale (default 24) per non attaccare l'ultimo elemento
 *    alla barra.
 */
export function usePageBottomPadding(extraGap: number = 24): number {
  const insets = useSafeAreaInsets();
  const NAV_HEIGHT = 60;
  return NAV_HEIGHT + (insets?.bottom || 0) + extraGap;
}

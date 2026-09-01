// V46 — Helper hook for bottom-sheet padding.
// Returns a safe bottom padding value that avoids being covered by the Android
// gesture navigation bar or iPhone home indicator. Falls back to a comfortable
// default of 28px when the safe-area inset is 0 (or web).
//
// Usage:
//   const bottomPad = useBottomSheetPadding();
//   <View style={[styles.sheetBox, { paddingBottom: bottomPad }]}>

import { useSafeAreaInsets } from "react-native-safe-area-context";

export function useBottomSheetPadding(minPad: number = 28): number {
  const insets = useSafeAreaInsets();
  return Math.max((insets?.bottom || 0) + 12, minPad);
}

// V50.z186 — Tastiera Android (modulo isolato).
// Con edge-to-edge (SDK 54) `softwareKeyboardLayoutMode: "resize"` NON ridimensiona più la finestra:
// la tastiera copre i campi e i KeyboardAvoidingView con behavior undefined/"height" non fanno nulla.
// `useAndroidKeyboardHeight()` restituisce l'altezza della tastiera (0 su iOS/web); `AndroidKeyboardPadding`
// applica un paddingBottom dinamico a tutto lo Stack → i campi (e il footer con "Salva") restano visibili.
import React, { useEffect, useState } from "react";
import { Keyboard, Platform, View, ViewStyle } from "react-native";

export function useAndroidKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const s = Keyboard.addListener("keyboardDidShow", (e) => setH(e?.endCoordinates?.height || 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setH(0));
    return () => { s.remove(); hide.remove(); };
  }, []);
  return Platform.OS === "android" ? h : 0;
}

export function AndroidKeyboardPadding({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const kb = useAndroidKeyboardHeight();
  return <View style={[{ flex: 1 }, style, kb > 0 ? { paddingBottom: kb } : null]}>{children}</View>;
}

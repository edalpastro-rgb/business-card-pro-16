// keyboard.tsx — V50.z374 — Tastiera: componenti condivisi basati su react-native-keyboard-controller (KeyboardProvider è in _layout).
// • <KScrollView>  → ScrollView che porta il TextInput attivo sopra la tastiera (scroll automatico, gap 24 px). Sostituisce
//                     la ScrollView di react-native in tutte le schermate con campi di testo.
// • <KModalBody>   → KeyboardAvoidingView behavior "padding" (funziona su iOS e Android grazie al provider): avvolge il
//                     contenuto delle Modal con campi di testo (fogli in basso, dialoghi) così il campo resta visibile.
// • V50.z387 — REGOLA GLOBALE Android: dentro le <Modal> il KeyboardAvoidingView del provider NON riceve gli eventi
//   (finestra separata) → <KModalBody> su Android usa un padding manuale pari all'altezza tastiera, misurata da DUE
//   sorgenti (eventi RN `Keyboard` + `KeyboardEvents` nativi). Vale per tutte le schermate presenti e future che lo usano.
import React, { useEffect, useState } from "react";
import { Keyboard, Platform, View } from "react-native";
import type { ScrollView, ScrollViewProps, ViewProps } from "react-native";
import { KeyboardAwareScrollView, KeyboardAvoidingView, KeyboardEvents } from "react-native-keyboard-controller";

/** Altezza tastiera corrente (0 = chiusa). Robusto anche dentro le Modal Android. */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subs: { remove: () => void }[] = [];
    const show = (v: number) => { if (v > 0) setH(v); };
    const hide = () => setH(0);
    subs.push(Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => show(e.endCoordinates?.height || 0)));
    subs.push(Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", hide));
    try {
      subs.push(KeyboardEvents.addListener("keyboardWillShow", (e: any) => show(Number(e?.height) || 0)));
      subs.push(KeyboardEvents.addListener("keyboardDidShow", (e: any) => show(Number(e?.height) || 0)));
      subs.push(KeyboardEvents.addListener("keyboardDidHide", hide));
    } catch { /* provider assente: bastano gli eventi RN */ }
    return () => { subs.forEach((s) => { try { s.remove(); } catch {} }); };
  }, []);
  return h;
}

export type KScrollViewProps = ScrollViewProps & { bottomOffset?: number; children?: React.ReactNode };

export const KScrollView = React.forwardRef<ScrollView, KScrollViewProps>(function KScrollView(props, ref) {
  // V50.z387 — Android: spazio extra in fondo pari alla tastiera (dentro le Modal lo scroll «aware» non riceve eventi):
  // il campo attivo può sempre essere portato sopra la tastiera.
  const kb = useKeyboardHeight();
  const { contentContainerStyle, ...rest } = props;
  const cc = Platform.OS === "android" && kb > 0 ? [contentContainerStyle, { paddingBottom: kb }] : contentContainerStyle;
  return <KeyboardAwareScrollView ref={ref} bottomOffset={24} keyboardShouldPersistTaps="handled" {...rest} contentContainerStyle={cc} />;
});

export function KModalBody({ children, style, ...rest }: ViewProps & { children?: React.ReactNode }) {
  const kb = useKeyboardHeight();
  if (Platform.OS === "android") {
    // Android: padding manuale = altezza tastiera (il KAV del provider non funziona nelle Modal). Mai i due insieme.
    return (
      <View style={[{ flex: 1 }, style, { paddingBottom: kb }]} {...rest}>
        {children}
      </View>
    );
  }
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={12} style={[{ flex: 1 }, style]} {...rest}>
      {children}
    </KeyboardAvoidingView>
  );
}

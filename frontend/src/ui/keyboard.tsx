// keyboard.tsx — V50.z374 — Tastiera: componenti condivisi basati su react-native-keyboard-controller (KeyboardProvider è in _layout).
// • <KScrollView>  → ScrollView che porta il TextInput attivo sopra la tastiera (scroll automatico, gap 24 px). Sostituisce
//                     la ScrollView di react-native in tutte le schermate con campi di testo.
// • <KModalBody>   → KeyboardAvoidingView behavior "padding" (funziona su iOS e Android grazie al provider): avvolge il
//                     contenuto delle Modal con campi di testo (fogli in basso, dialoghi) così il campo resta visibile.
import React from "react";
import type { ScrollView, ScrollViewProps, ViewProps } from "react-native";
import { KeyboardAwareScrollView, KeyboardAvoidingView } from "react-native-keyboard-controller";

export type KScrollViewProps = ScrollViewProps & { bottomOffset?: number; children?: React.ReactNode };

export const KScrollView = React.forwardRef<ScrollView, KScrollViewProps>(function KScrollView(props, ref) {
  return <KeyboardAwareScrollView ref={ref} bottomOffset={24} keyboardShouldPersistTaps="handled" {...props} />;
});

export function KModalBody({ children, style, ...rest }: ViewProps & { children?: React.ReactNode }) {
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={12} style={[{ flex: 1 }, style]} {...rest}>
      {children}
    </KeyboardAvoidingView>
  );
}

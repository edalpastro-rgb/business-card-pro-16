// ChatShell.tsx — V50.z403 — Contenitore della chat Axon.
// BUG RICORRENTE (settimane): su Android la chat era una <Modal> = FINESTRA SEPARATA. Con edge-to-edge la finestra non si
// ridimensiona con la tastiera e gli eventi tastiera (RN `Keyboard` e keyboard-controller) arrivano solo alla finestra
// principale → paddingBottom restava 0 e la tastiera copriva il campo di testo mentre si scriveva.
// SOLUZIONE: su Android la chat NON è più una Modal ma un overlay a tutto schermo DENTRO la finestra principale
// (position absolute sopra lo Stack, montato in _layout tramite AssistantFAB): stessa finestra dello Stack, quindi gli eventi
// tastiera arrivano e il padding dinamico funziona come in tutte le altre schermate. Tasto Indietro → chiude la chat.
// iOS/web: resta la Modal (il KeyboardAvoidingView del provider funziona correttamente).
import React, { useEffect } from "react";
import { BackHandler, Modal, Platform, StyleSheet, View } from "react-native";

type Props = { visible: boolean; onRequestClose: () => void; children: React.ReactNode };

export function ChatShell({ visible, onRequestClose, children }: Props) {
  useEffect(() => {
    if (Platform.OS !== "android" || !visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onRequestClose(); return true; });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  if (Platform.OS === "android") {
    if (!visible) return null;
    return <View style={styles.overlay} testID="assistant-chat-overlay">{children}</View>;
  }
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onRequestClose}>
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
});

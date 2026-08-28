/**
 * V29.aq — Utility globale per gestire la SafeArea bottom in modo consistente.
 *
 * PROBLEMA (Android APK edge-to-edge):
 *  Modal, bottom sheet, bottoni fissi in fondo, tab bar → tutti finiscono sotto
 *  la gesture bar Android o il notch iOS. `useSafeAreaInsets()` di per sé
 *  restituisce 0 in alcuni casi (Android 3-button nav, web browser) → bottone
 *  ancora tagliato. Serve un minimo di sicurezza.
 *
 * REGOLA UNICA per tutta l'app:
 *   safeBottom = Math.max(insets.bottom, 20)
 *
 * COME USARE:
 *   1) Come padding-bottom (dentro un sheet, un container fisso):
 *        const safeBottom = useSafeBottom();
 *        <View style={{ paddingBottom: safeBottom }}>…</View>
 *
 *   2) Come spacer separato (dentro Modal contents di dimensione fissa):
 *        <BottomSafe />
 *
 *   3) Come marginBottom di un FAB / bottone fluttuante:
 *        <Pressable style={{ marginBottom: safeBottom + 12 }} … />
 *
 * NON usare `insets.bottom` grezzo altrove — usa SEMPRE `useSafeBottom()` per
 * garantire il minimo di 20px anche dove le insets nativa riporta 0.
 */
import React from "react";
import { View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Minimo padding-bottom garantito: 20px. Aggiornabile in un solo punto. */
const MIN_SAFE_BOTTOM = 20;

export function useSafeBottom(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom || 0, MIN_SAFE_BOTTOM);
}

/**
 * Spacer da droppare come ULTIMO child di qualunque container che ha bottoni
 * in fondo (bottom sheet, Modal content, footer di scheda, ecc.). Aggiunge
 * automaticamente lo spazio della gesture bar Android / notch iOS.
 */
export function BottomSafe({ extra = 0, style }: { extra?: number; style?: ViewStyle }) {
  const safeBottom = useSafeBottom();
  return <View style={[{ height: safeBottom + extra }, style]} />;
}

export default useSafeBottom;

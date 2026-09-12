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
import { Platform } from "react-native";
import { useSafeAreaInsets, initialWindowMetrics } from "react-native-safe-area-context";

/** Minimo padding-bottom garantito: 20px (Android 24). Aggiornabile in un solo punto. */
const MIN_SAFE_BOTTOM = Platform.OS === "android" ? 24 : 20;

/**
 * V50.z165 — Dentro un `Modal` nativo (nuova window Android) `useSafeAreaInsets()`
 * spesso riporta bottom=0 → il minimo di 20px non copriva la navigation bar
 * (48dp a 3 tasti, ~24-34dp gesture) e i bottoni in fondo ai modal risultavano
 * tagliati. `initialWindowMetrics` è misurato all'avvio dalla finestra principale
 * ed è affidabile anche dentro i Modal: lo usiamo come fallback globale.
 */
// V50.z187 — Inset bottom "vivo" misurato alla RADICE (dentro SafeAreaProvider, fuori dagli Stack/Tabs
// dove `useSafeAreaInsets().bottom` può valere 0). Aggiornato da `<RootInsetsProbe />` in `_layout.tsx`
// → tutte le barre (Tabs nativa, PersistentBottomNav, footer) usano lo STESSO valore, uniforme su ogni pagina.
let _rootLiveBottom = 0;
const _rootListeners = new Set<(v: number) => void>();
export function RootInsetsProbe() {
  const insets = useSafeAreaInsets();
  React.useEffect(() => {
    const v = insets.bottom || 0;
    if (v !== _rootLiveBottom) { _rootLiveBottom = v; _rootListeners.forEach((l) => l(v)); }
  }, [insets.bottom]);
  return null;
}
function useRootLiveBottom(): number {
  const [v, setV] = React.useState(_rootLiveBottom);
  React.useEffect(() => { _rootListeners.add(setV); return () => { _rootListeners.delete(setV); }; }, []);
  return v;
}

export function safeBottomFallback(): number {
  return Math.max(initialWindowMetrics?.insets?.bottom || 0, _rootLiveBottom);
}

/** Insets con fallback bottom (per componenti che usano `insets.bottom` direttamente, es. dentro Modal). */
export function useInsetsSafe() {
  const insets = useSafeAreaInsets();
  return { ...insets, bottom: Math.max(insets.bottom || 0, safeBottomFallback()) };
}

export function useSafeBottom(): number {
  const insets = useSafeAreaInsets();
  const live = useRootLiveBottom();
  return Math.max(insets.bottom || 0, live, safeBottomFallback(), MIN_SAFE_BOTTOM);
}

/**
 * V50.z167 — UNICO valore di padding-bottom per le due barre di navigazione
 * (Tabs nativa in `(tabs)/_layout.tsx` e `PersistentBottomNav`). Prima ciascuna
 * calcolava `Math.max(insets.bottom, 20)` per conto suo: dentro lo Stack nativo
 * (Home e altri tab) su Android edge-to-edge `insets.bottom` può valere 0 → barra
 * alta solo 20px sotto le label → "attaccata" alla navigation bar del telefono,
 * mentre fuori dallo Stack (scheda anagrafica, Help) l'inset era corretto.
 * Il fallback `initialWindowMetrics` (misurato all'avvio) rende il valore identico ovunque.
 */
const NAV_BAR_MIN_BOTTOM = 20;
export function useNavBarBottomInset(): number {
  const insets = useSafeAreaInsets();
  const live = useRootLiveBottom(); // V50.z187 — stesso inset radice su TUTTE le pagine (riferimento: pagina Help)
  return Math.max(insets.bottom || 0, live, safeBottomFallback(), NAV_BAR_MIN_BOTTOM);
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

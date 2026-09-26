// ViolaHeaderDot.tsx — V50.z376 — TOGGLE ascolto continuo di Axon nell'header della Home (nessun menu, nessuna navigazione):
// un tap ATTIVA (icona colorata + anello pulsante: viola = in ascolto · verde = sta catturando/pensando · rosso = problema
// microfono), un altro tap DISATTIVA (icona grigia). Lo stato è salvato nelle impostazioni ViolaWake sul server (persistente tra
// sessioni e dispositivi). Pressione lunga → schermata Axon completa. Se il Master ha spento il modulo: icona grigia + avviso.
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Animated, Easing, View, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useViolaWakeOptional } from "@/src/violawake/ViolaWakeProvider";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";

export function ViolaHeaderDot() {
  const v = useViolaWakeOptional();
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState(false);
  const state = v?.state || "off";
  const moduleOn = !!v?.module?.enabled;
  const enabled = !!v?.settings?.enabled && moduleOn;
  const listening = state === "listening";
  const active = state === "capturing" || state === "thinking" || state === "speaking";
  const problem = enabled && (state === "no_permission" || state === "error");

  useEffect(() => {
    if (!listening && !active) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: active ? 1.9 : 1.6, duration: active ? 500 : 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: active ? 500 : 1100, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [listening, active, pulse]);

  if (!v || !v.settings) return null;

  const toggle = async () => {
    if (busy) return;
    Animated.sequence([Animated.timing(pop, { toValue: 0.8, duration: 80, useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true })]).start();
    if (!moduleOn && !v.isMaster) { notify("Axon", "Il Master ha disattivato l'ascolto di Axon per l'azienda."); return; }
    setBusy(true);
    try {
      if (enabled) {
        await v.updateSettings({ enabled: false });
      } else {
        if (v.supported && !(await v.askPermission())) { notify("Microfono", "Serve il permesso microfono per l'ascolto continuo. Pressione lunga sull'icona per aprire le impostazioni."); return; }
        if (!moduleOn) await v.setModule(true, "Attivato dal toggle in Home"); // Master: un tap accende anche il modulo azienda
        await v.updateSettings({ enabled: true });
      }
    } catch (e: any) { notify("Axon", e?.message || "Impossibile cambiare lo stato dell'ascolto"); }
    finally { setBusy(false); }
  };

  const color = !enabled ? HT.muted : problem ? HT.danger : active ? HT.success : listening ? HT.violet : HT.violet;
  return (
    <Pressable onPress={toggle} onLongPress={() => router.push("/viola-wake" as any)} hitSlop={8} style={styles.wrap} testID="viola-header-dot"
      accessibilityRole="switch" accessibilityState={{ checked: enabled }} accessibilityLabel={enabled ? "Ascolto Axon attivo: tocca per disattivare" : "Ascolto Axon disattivato: tocca per attivare"}>
      {enabled && (listening || active) ? <Animated.View style={[styles.ring, { borderColor: color, transform: [{ scale: pulse }], opacity: 0.55 }]} /> : null}
      <Animated.View style={[styles.dot, { backgroundColor: enabled ? color : HT.card2, borderColor: enabled ? color : HT.border, transform: [{ scale: pop }] }]} testID={enabled ? "viola-header-dot-on" : "viola-header-dot-off"}>
        {busy ? <ActivityIndicator size="small" color={enabled ? HT.white : HT.muted} /> : <Ionicons name={problem || !enabled ? "mic-off" : "mic"} size={16} color={enabled ? HT.white : HT.muted} />}
      </Animated.View>
      {enabled ? <View style={[styles.badge, { backgroundColor: problem ? HT.danger : HT.success }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 32, height: 32, borderRadius: 16, borderWidth: 1.5 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  badge: { position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: HT.card },
});

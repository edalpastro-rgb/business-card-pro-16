// ViolaHeaderDot.tsx — V50.z367 — Indicatore discreto nell'header della Home: quando ViolaWake è in ascolto mostra
// un'icona microfono con anello pulsante (viola = in ascolto · verde = sta catturando/pensando · rosso = problema:
// permesso microfono / errore). Tap → schermata ViolaWake. Nascosto se il modulo è spento.
import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Animated, Easing, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useViolaWakeOptional } from "@/src/violawake/ViolaWakeProvider";
import { HT } from "@/src/homeTheme";

export function ViolaHeaderDot() {
  const v = useViolaWakeOptional();
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;
  const state = v?.state || "off";
  const enabled = !!v?.settings?.enabled && !!v?.module?.enabled;
  const listening = state === "listening";
  const active = state === "capturing" || state === "thinking" || state === "speaking";
  const problem = state === "no_permission" || state === "error";

  useEffect(() => {
    if (!listening && !active) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: active ? 1.9 : 1.6, duration: active ? 500 : 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: active ? 500 : 1100, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [listening, active, pulse]);

  if (!v || !enabled) return null;
  const color = problem ? HT.danger : active ? HT.success : listening ? HT.violet : HT.muted;
  return (
    <Pressable onPress={() => router.push("/viola-wake" as any)} hitSlop={8} style={styles.wrap} testID="viola-header-dot" accessibilityLabel={listening ? "Axon in ascolto" : problem ? "ViolaWake: problema microfono" : "ViolaWake"}>
      {(listening || active) ? <Animated.View style={[styles.ring, { borderColor: color, transform: [{ scale: pulse }], opacity: 0.55 }]} /> : null}
      <View style={[styles.dot, { backgroundColor: color }]}>
        <Ionicons name={problem ? "mic-off" : "mic"} size={12} color="#FFF" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
});

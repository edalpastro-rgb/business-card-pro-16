// V50.z315 — Pill di stato ViolaWake, sopra ogni schermata quando l'ascolto è attivo
// (listening → «Axon in ascolto», capturing → trascrizione live, thinking, speaking → risposta).
import React, { useEffect } from "react";
import { Text, StyleSheet, Pressable } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, interpolate, FadeInDown, FadeOutUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/src/theme";
import { useViolaWake } from "./ViolaWakeProvider";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const VIOLA = "#8B5CF6"; // colore identità di Viola/Axon (uguale in chiaro e scuro)

export function ViolaStatusPill() {
  const { state, lastTranscript, lastReply, keywordLabel } = useViolaWake();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(0);
  useEffect(() => { pulse.value = withRepeat(withTiming(1, { duration: 1100 }), -1, true); }, [pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.35, 1]), transform: [{ scale: interpolate(pulse.value, [0, 1], [0.8, 1.2]) }] }));

  const visible = state === "listening" || state === "capturing" || state === "thinking" || state === "speaking" || state === "starting";
  if (!visible) return null;

  const label =
    state === "starting" ? "Avvio ascolto…" :
    state === "listening" ? `Di' «${keywordLabel}» per parlare con Axon` :
    state === "capturing" ? (lastTranscript ? `«${lastTranscript}»` : "Ti ascolto…") :
    state === "thinking" ? "Un attimo…" :
    (lastReply ? lastReply.slice(0, 90) : "Sto rispondendo…");
  const icon = state === "capturing" ? "mic" : state === "speaking" ? "volume-high" : state === "thinking" ? "hourglass" : "ear";

  return (
    <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} pointerEvents="box-none" style={[s.wrap, { top: insets.top + 64 }]}>
      <Pressable onPress={() => router.push("/viola-wake" as any)} style={[s.pill, state === "capturing" && s.pillActive]} testID="viola-status-pill" accessibilityRole="button" accessibilityLabel="Stato ViolaWake">
        <Animated.View style={[s.dot, dot, state === "capturing" && { backgroundColor: HT.danger }]} />
        <Ionicons name={icon as any} size={14} color={theme.color.onSurfaceInverse} />
        <Text style={s.txt} numberOfLines={1}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 9999 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "88%", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: VIOLA, shadowColor: VIOLA, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8, minHeight: 36 },
  pillActive: { backgroundColor: '#6D28D9' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.onSurfaceInverse },
  txt: { color: theme.color.onSurfaceInverse, fontSize: 12, fontWeight: "700", flexShrink: 1 },
});

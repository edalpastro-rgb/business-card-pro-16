// V50.z318 — Overlay globale: ONDA DI ENERGIA di attivazione AxonOS (3 s, anelli che si espandono,
// alone pulsante, 24 particelle radiali, palette AdvisorOS) + modalità «TROVA IL MIO TELEFONO»
// (vibrazione ritmica + suono identitario in loop finché non si tocca lo schermo o si dice «stop»).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, DeviceEventEmitter, Vibration, Platform, useWindowDimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing, interpolate, FadeIn, FadeOut } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { theme } from "@/src/theme";
import { AXON_ACTIVATION_EVENT, AXON_ACTIVATION_HIDE_EVENT, AXON_FIND_PHONE_EVENT, AXON_FIND_PHONE_STOP_EVENT, stopFindPhone, type ActivationPayload } from "./events";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)
const CYAN = "#38BDF8";
const ORANGE = "#F97316";
const WAVE_MS = 3000;
const PARTICLES = 24;

async function tts(text: string, voice?: string): Promise<void> {
  try {
    const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text, voice } });
    if (!r?.audio_base64) return;
    await new Promise<void>((res) => { playAudioBase64(r.audio_base64, r.mime || "audio/mpeg", () => res()).catch(() => res()); });
  } catch { /* senza audio */ }
}

/** Due impulsi distinti ravvicinati. */
export async function doubleBuzz() {
  if (Platform.OS === "web") return;
  if (Platform.OS === "android") { Vibration.vibrate([0, 140, 110, 140]); return; }
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); }, 220);
  } catch { /* noop */ }
}

function Ring({ delay, size, color }: { delay: number; size: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }), -1, false)); }, [p, delay]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(p.value, [0, 1], [0.15, 1]) }], opacity: interpolate(p.value, [0, 0.15, 1], [0, 0.9, 0]) }));
  return <Animated.View style={[{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color, shadowColor: color, shadowOpacity: 1, shadowRadius: 24 }, st]} />;
}

function Particle({ i, radius }: { i: number; radius: number }) {
  const p = useSharedValue(0);
  const angle = (i / PARTICLES) * Math.PI * 2;
  useEffect(() => { p.value = withDelay((i % 6) * 90, withRepeat(withTiming(1, { duration: 1300 + (i % 4) * 150, easing: Easing.out(Easing.quad) }), -1, false)); }, [p, i]);
  const st = useAnimatedStyle(() => {
    const d = interpolate(p.value, [0, 1], [20, radius]);
    return { transform: [{ translateX: Math.cos(angle) * d }, { translateY: Math.sin(angle) * d }, { scale: interpolate(p.value, [0, 0.3, 1], [0.4, 1.2, 0.2]) }], opacity: interpolate(p.value, [0, 0.2, 1], [0, 1, 0]) };
  });
  const color = i % 3 === 0 ? CYAN : i % 3 === 1 ? VIOLET : ORANGE;
  return <Animated.View style={[{ position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: color, shadowColor: color, shadowOpacity: 1, shadowRadius: 10 }, st]} />;
}

function Core({ pulseMs = 900 }: { pulseMs?: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: pulseMs, easing: Easing.inOut(Easing.ease) }), -1, true); }, [p, pulseMs]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(p.value, [0, 1], [0.92, 1.12]) }], shadowOpacity: interpolate(p.value, [0, 1], [0.5, 1]) }));
  return (
    <Animated.View style={[{ width: 130, height: 130, borderRadius: 65, shadowColor: CYAN, shadowRadius: 50, shadowOffset: { width: 0, height: 0 }, elevation: 20 }, st]}>
      <LinearGradient colors={[CYAN, VIOLET, "#1E1B4B"]} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, borderRadius: 65, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "#FFFFFF", opacity: 0.95 }} />
      </LinearGradient>
    </Animated.View>
  );
}

/**
 * `mirror`: solo visuale, nessuna vibrazione/voce. Va montato DENTRO i <Modal> (es. chat Axon): un RN Modal è una
 * finestra nativa sopra tutto, quindi l'overlay globale in _layout resterebbe nascosto dietro la chat.
 * Il controller (senza `mirror`, in _layout) gestisce haptics, TTS e loop; i mirror seguono gli stessi eventi.
 */
export function ActivationOverlay({ mirror = false }: { mirror?: boolean }) {
  const { width, height } = useWindowDimensions();
  const [wave, setWave] = useState<ActivationPayload | null>(null);
  const [find, setFind] = useState<{ name: string } | null>(null);
  const findRef = useRef(false);
  const findTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const radius = Math.min(width, height) * 0.48;

  // ONDA DI ENERGIA: vibrazione doppia → 3 s di animazione → voce → chiusura
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(AXON_ACTIVATION_EVENT, (p: ActivationPayload) => {
      setWave(p);
      if (mirror) return;
      void doubleBuzz();
      const greet = p.greet !== false;
      setTimeout(async () => {
        if (greet) await tts(`Ciao, sono ${p.name || "Axon"}. Sono pronto.`, p.voice);
        setWave(null);
        DeviceEventEmitter.emit(AXON_ACTIVATION_HIDE_EVENT, {});
      }, WAVE_MS);
    });
    const hide = DeviceEventEmitter.addListener(AXON_ACTIVATION_HIDE_EVENT, () => { if (mirror) setWave(null); });
    return () => { sub.remove(); hide.remove(); };
  }, [mirror]);

  const stopFind = useCallback(() => {
    findRef.current = false;
    if (findTimer.current) { clearInterval(findTimer.current); findTimer.current = null; }
    Vibration.cancel();
    setFind(null);
  }, []);

  // TROVA IL MIO TELEFONO: pattern ritmico + suono identitario in loop
  useEffect(() => {
    const start = DeviceEventEmitter.addListener(AXON_FIND_PHONE_EVENT, (p: { name?: string }) => {
      if (findRef.current) return;
      findRef.current = true;
      setFind({ name: p?.name || "Axon" });
      if (mirror) return;
      const buzz = () => {
        if (Platform.OS === "android") Vibration.vibrate([0, 200, 100, 200, 100, 500], false);
        else if (Platform.OS === "ios") { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 300); }
      };
      const loop = async () => {
        while (findRef.current) {
          buzz();
          await tts(`Sono qui! Sono qui, ${p?.name ? "sono " + p.name : "sono Axon"}!`);
          if (!findRef.current) break;
          await new Promise((r) => setTimeout(r, 900));
        }
      };
      void loop();
    });
    const stop = DeviceEventEmitter.addListener(AXON_FIND_PHONE_STOP_EVENT, stopFind);
    return () => { start.remove(); stop.remove(); };
  }, [stopFind, mirror]);

  if (!wave && !find) return null;

  return (
    <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(400)} style={styles.full} pointerEvents="auto" testID={mirror ? (wave ? "activation-overlay-chat" : "find-phone-overlay-chat") : (wave ? "activation-overlay" : "find-phone-overlay")}>
      <Pressable style={StyleSheet.absoluteFill} onPress={find ? () => { stopFind(); stopFindPhone(); } : undefined} accessibilityRole="button" accessibilityLabel={find ? "Trovato: ferma" : "Attivazione"}>
        <LinearGradient colors={["#0B1226", "#1E1B4B", "#0B1226"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.center}>
          {[0, 350, 700, 1050].map((d, i) => <Ring key={d} delay={d} size={radius * 2} color={i % 2 ? VIOLET : CYAN} />)}
          {Array.from({ length: PARTICLES }).map((_, i) => <Particle key={i} i={i} radius={radius} />)}
          <Core pulseMs={find ? 500 : 900} />
        </View>
        <View style={styles.caption}>
          {wave ? (
            <>
              <Text style={styles.title}>{wave.name || "Axon"}</Text>
              <Text style={styles.sub}>Attivazione in corso…</Text>
            </>
          ) : (
            <>
              <Ionicons name="location" size={26} color={ORANGE} />
              <Text style={styles.title}>Sono qui!</Text>
              <Text style={styles.sub}>Tocca lo schermo o dì «stop» per fermarmi</Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  full: { ...StyleSheet.absoluteFillObject, zIndex: 99999, elevation: 99999 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  caption: { position: "absolute", left: 0, right: 0, bottom: 90, alignItems: "center", gap: 6 },
  title: { color: C.onSurfaceInverse, fontSize: 30, fontWeight: "900", letterSpacing: -0.8 },
  sub: { color: C.onSurfaceInverse, opacity: 0.8, fontSize: 14 },
});


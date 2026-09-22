// V50.z312 — Effetti visivi della landing (orb Axon, aurora, parola rotante, reveal).
// Tutto con react-native-reanimated: funziona su web, iOS e Android.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  FadeInUp,
  FadeIn,
  FadeOut,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { LP } from "@/src/landing/palette";

/** Sfera luminosa pulsante con anelli concentrici: il «cuore» Axon. */
export function AxonOrb({ size = 220 }: { size?: number }) {
  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, true);
    spin.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.linear }), -1, false);
  }, [pulse, spin]);

  const core = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.96, 1.06]) }],
    shadowOpacity: interpolate(pulse.value, [0, 1], [0.55, 1]),
  }));
  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.35, 0.7]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.18]) }],
  }));
  const ringA = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }, { scaleX: 1.35 }] }));
  const ringB = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * 360 + 60}deg` }, { scaleY: 1.35 }] }));

  const r = size / 2;
  return (
    <View style={{ width: size * 1.6, height: size * 1.6, alignItems: "center", justifyContent: "center" }} testID="landing-axon-orb">
      <Animated.View style={[{ position: "absolute", alignItems: "center", justifyContent: "center" }, halo]}>
        <SoftGlow color={LP.axonLineSoft} size={size * 1.45} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", width: size * 1.25, height: size * 1.25, borderRadius: size, borderWidth: 1, borderColor: LP.axonLine }, ringA]} />
      <Animated.View style={[{ position: "absolute", width: size * 1.25, height: size * 1.25, borderRadius: size, borderWidth: 1, borderColor: LP.axonLineSoft }, ringB]} />
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: r, shadowColor: LP.axon, shadowRadius: 40, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
          core,
        ]}
      >
        <LinearGradient colors={[LP.axon, LP.axonDeep, LP.axonInk]} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, borderRadius: r, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size, backgroundColor: LP.coreWhite, opacity: 0.9 }} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

/** Alone morbido: cerchi concentrici a opacità decrescente (surrogato di un gradiente radiale, ok su web). */
function SoftGlow({ color, size = 520 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {[1, 0.72, 0.44].map((k) => (
        <View key={k} style={{ position: "absolute", width: size * k, height: size * k, borderRadius: size, backgroundColor: color, opacity: 0.28 }} />
      ))}
    </View>
  );
}

/** Macchie di luce che si muovono lentamente sullo sfondo (effetto aurora). */
export function Aurora({ style }: { style?: ViewStyle }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [t]);
  const a = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-40, 60]) }, { translateY: interpolate(t.value, [0, 1], [0, 40]) }, { scale: interpolate(t.value, [0, 1], [1, 1.25]) }],
  }));
  const b = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [50, -60]) }, { translateY: interpolate(t.value, [0, 1], [30, -20]) }, { scale: interpolate(t.value, [0, 1], [1.2, 0.95]) }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]}>
      <Animated.View style={[fx.blob, { top: "-10%", left: "-20%" }, a]}>
        <SoftGlow color={LP.auroraA} />
      </Animated.View>
      <Animated.View style={[fx.blob, { bottom: "-15%", right: "-25%" }, b]}>
        <SoftGlow color={LP.auroraB} />
      </Animated.View>
      <View style={fx.grid}>
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={`h${i}`} style={[fx.gridLine, { top: `${(i + 1) * 12.5}%` }]} />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={`v${i}`} style={[fx.gridLineV, { left: `${(i + 1) * 12.5}%` }]} />
        ))}
      </View>
    </View>
  );
}

/** Parola che cambia ogni 1,8 s con dissolvenza («compila», «ricorda», …). */
export function RotatingWord({ words, style }: { words: string[]; style?: any }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setI((x) => (x + 1) % words.length), 1800);
    return () => clearInterval(iv);
  }, [words.length]);
  return (
    <View style={{ minWidth: 10 }}>
      <Animated.Text key={words[i]} entering={FadeInUp.duration(380)} exiting={FadeOut.duration(220)} style={style} testID="landing-rotating-word">
        {words[i]}
      </Animated.Text>
    </View>
  );
}

/** Blocco che appare dal basso con ritardo (reveal). */
export function Reveal({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <Animated.View entering={FadeInUp.duration(650).delay(delay)} style={style}>
      {children}
    </Animated.View>
  );
}

/** Linea di scansione che scorre su un «documento». */
export function ScanLine({ height }: { height: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withSequence(withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.ease) }), withDelay(300, withTiming(0, { duration: 0 }))), -1, false);
  }, [y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(y.value, [0, 1], [0, height - 4]) }], opacity: interpolate(y.value, [0, 0.05, 0.95, 1], [0, 1, 1, 0]) }));
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, height: 3, backgroundColor: LP.axon, shadowColor: LP.axon, shadowRadius: 12, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }, st]} />;
}

/** Campo modulo che si «riempie» da solo (larghezza animata + testo). */
export function AutoField({ label, value, delay }: { label: string; value: string; delay: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withRepeat(withSequence(withDelay(delay, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })), withDelay(3200 - delay, withTiming(0, { duration: 0 }))), -1, false);
  }, [w, delay]);
  const bar = useAnimatedStyle(() => ({ width: `${interpolate(w.value, [0, 1], [0, 100])}%` }));
  const txt = useAnimatedStyle(() => ({ opacity: interpolate(w.value, [0, 0.7, 1], [0, 0, 1]) }));
  return (
    <View style={fx.field}>
      <Text style={fx.fieldLbl}>{label}</Text>
      <View style={fx.fieldBox}>
        <Animated.View style={[fx.fieldBar, bar]} />
        <Animated.Text style={[fx.fieldVal, txt]} numberOfLines={1}>{value}</Animated.Text>
      </View>
    </View>
  );
}

/** Pallino luminoso che pulsa (indicatore «Axon acceso»). */
export function LiveDot({ color = LP.axon }: { color?: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
  }, [p]);
  const st = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.4, 1]), transform: [{ scale: interpolate(p.value, [0, 1], [0.85, 1.15]) }] }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, shadowColor: color, shadowRadius: 8, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }, st]} />;
}

export { FadeIn };

const fx = StyleSheet.create({
  blob: { position: "absolute", width: 520, height: 520 },
  grid: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  gridLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: LP.gridLine },
  gridLineV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: LP.gridLine },
  field: { gap: 4 },
  fieldLbl: { color: LP.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  fieldBox: { height: 34, borderRadius: 8, backgroundColor: LP.surface3, borderWidth: 1, borderColor: LP.border, overflow: "hidden", justifyContent: "center", paddingHorizontal: 10 },
  fieldBar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: LP.axonTint },
  fieldVal: { color: LP.onSurface, fontSize: 13, fontWeight: "700" },
});

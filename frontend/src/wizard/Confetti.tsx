// src/wizard/Confetti.tsx — V50.z216 — BLOCCO 5: pioggia di coriandoli (react-native-reanimated, nessuna dipendenza nuova, 100% offline).
import React, { useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const COLORS = ["#F97316", "#7C3AED", "#2563EB", "#10B981", "#FACC15", "#EC4899", "#FFFFFF"];

type Piece = { x: number; delay: number; dur: number; size: number; color: string; drift: number; spin: number; round: boolean };

function PieceView({ p, height }: { p: Piece; height: number }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(p.delay, withTiming(1, { duration: p.dur, easing: Easing.out(Easing.quad) })); }, [p.delay, p.dur, t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.1, 0.85, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: p.x + Math.sin(t.value * Math.PI * 2) * p.drift },
      { translateY: interpolate(t.value, [0, 1], [-40, height + 40]) },
      { rotate: `${t.value * p.spin}deg` },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[styles.piece, { width: p.size, height: p.round ? p.size : p.size * 0.55, borderRadius: p.round ? p.size / 2 : 2, backgroundColor: p.color }, style]} />;
}

export function Confetti({ count = 46 }: { count?: number }) {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo<Piece[]>(() => Array.from({ length: count }, (_, i) => ({
    x: Math.random() * width, delay: Math.random() * 1400, dur: 2600 + Math.random() * 2200, size: 8 + Math.random() * 8,
    color: COLORS[i % COLORS.length], drift: 20 + Math.random() * 50, spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720), round: i % 4 === 0,
  })), [count, width]);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="setup-confetti">{pieces.map((p, i) => <PieceView key={i} p={p} height={height} />)}</View>;
}

const styles = StyleSheet.create({ piece: { position: "absolute", top: 0, left: 0 } });

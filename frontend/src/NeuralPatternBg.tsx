/**
 * V29.x + V29.ap — Filigrana "rete neurale" per il container header della Home.
 *
 * V29.ap: reimplementato usando VIEW + Animated.View invece di react-native-svg
 * `AnimatedCircle`. Su APK Android con new architecture (Fabric) alcuni build
 * ignoravano l'animazione SVG (o non mostravano nulla) → l'utente vedeva il
 * fondo dark ma senza pattern. Con questo approccio a `View` puri l'animazione
 * gira SEMPRE (Hermes-safe, senza reflow SVG).
 *
 * Cosa cambia:
 *  - Punti = piccole `View` con `borderRadius: r` e `backgroundColor` con alpha
 *  - Impulso = `Animated.View` posizionato assoluto, spostato via `translateX`
 *    / `translateY` (native driver = true → fluido a 60 fps anche in APK)
 *  - Le "linee" di connessione fra nodi sono state rimosse (SVG-only) → il
 *    pattern ora sono pure "stelle" pulsanti, che comunque danno l'idea
 *    tecnologica cercata dall'utente.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

// Nodi normalizzati in coordinate 0..1 (poi scalati a width×height).
type NodeXY = { x: number; y: number };
const NODES: NodeXY[] = [
  { x: 0.05, y: 0.25 },
  { x: 0.16, y: 0.72 },
  { x: 0.28, y: 0.18 },
  { x: 0.40, y: 0.82 },
  { x: 0.60, y: 0.20 },
  { x: 0.72, y: 0.78 },
  { x: 0.84, y: 0.30 },
  { x: 0.95, y: 0.70 },
];

// Percorso dell'impulso (indici in NODES) — loop
const PULSE_PATH = [0, 2, 4, 6, 7, 5, 3, 1, 0];

type Props = {
  width: number;
  height: number;
  color?: string;
  opacity?: number;
  pulseColor?: string;
};

export function NeuralPatternBg({
  width,
  height,
  color = "#93C5FD",
  opacity = 0.10,
  pulseColor = "#7DD3FC",
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const totalMs = 8000;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: PULSE_PATH.length - 1,
        duration: totalMs,
        easing: Easing.inOut(Easing.linear),
        useNativeDriver: true, // V29.ap — native driver: garanzia 60fps su APK
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress, width, height]);

  // Coordinate pixel dei nodi (assolute)
  const nodes = useMemo(
    () => NODES.map((n) => ({ x: n.x * width - 3, y: n.y * height - 3 })),
    [width, height],
  );

  // Interpolazione della posizione dell'impulso (translateX/Y) lungo PULSE_PATH
  const inputRange = PULSE_PATH.map((_, i) => i);
  const outputX = PULSE_PATH.map((idx) => NODES[idx].x * width - 4);
  const outputY = PULSE_PATH.map((idx) => NODES[idx].y * height - 4);
  const tX = progress.interpolate({ inputRange, outputRange: outputX });
  const tY = progress.interpolate({ inputRange, outputRange: outputY });

  // Costruiamo il color con alpha manuale (React Native Android non sempre
  // legge fillOpacity separato — meglio applicare alpha direttamente al colore).
  const nodeAlpha = Math.max(0.05, opacity + 0.15);
  const nodeColorWithAlpha = applyAlpha(color, nodeAlpha);
  const pulseCoreColor = applyAlpha(pulseColor, 0.85);
  const pulseHaloColor = applyAlpha(pulseColor, 0.28);

  if (width <= 0 || height <= 0) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { width, height }]}
      testID="neural-pattern-bg"
    >
      {/* Nodi statici */}
      {nodes.map((n, i) => (
        <View
          key={`node-${i}`}
          style={[
            styles.node,
            {
              left: n.x,
              top: n.y,
              backgroundColor: nodeColorWithAlpha,
            },
          ]}
        />
      ))}
      {/* Alone impulso (grande, sfumato) */}
      <Animated.View
        style={[
          styles.pulseHalo,
          {
            backgroundColor: pulseHaloColor,
            transform: [{ translateX: tX }, { translateY: tY }],
          },
        ]}
      />
      {/* Core impulso (piccolo, vivace) */}
      <Animated.View
        style={[
          styles.pulseCore,
          {
            backgroundColor: pulseCoreColor,
            transform: [{ translateX: tX }, { translateY: tY }],
          },
        ]}
      />
    </View>
  );
}

/**
 * Converte un colore #RRGGBB (o qualsiasi valido) in `rgba(r,g,b,alpha)`.
 * Se il colore non è nel formato hex noto, fallback a #FFFFFF con alpha.
 */
function applyAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color?.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgba(255,255,255,${a})`;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
  },
  node: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pulseCore: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pulseHalo: {
    position: "absolute",
    top: -4,
    left: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
  },
});

export default NeuralPatternBg;

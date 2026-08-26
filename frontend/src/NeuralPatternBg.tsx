import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

/**
 * V29.x — Filigrana "rete neurale" per il container header della Home.
 * Renderizza nodi circolari collegati da linee sottili, opacità 0.10 (appena
 * percettibile) + un piccolo punto luminoso che scorre lentamente lungo alcune
 * connessioni, simulando un impulso elettrico.
 *
 * L'effetto è puramente decorativo: il componente occupa l'intero container
 * padre con `position: absolute` e `pointerEvents: "none"` così non intercetta
 * mai i tocchi.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Nodi normalizzati in coordinate 0..1 (poi scalati a width×height).
// Distribuiti su una griglia irregolare, evitando la banda centrale
// dove viene renderizzato il logo AdvisorOS.
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

// Connessioni (indici in NODES). Solo le linee "belle" — non tutte
// le combinazioni — per un layout più elegante e leggibile.
const EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 5],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

// Percorso dell'impulso: sequenza di indici di nodi da attraversare.
// L'animazione interpola linearmente da un nodo al successivo, in loop.
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
  color = "#93C5FD",     // azzurro chiaro
  opacity = 0.10,
  pulseColor = "#7DD3FC", // pulse leggermente più chiaro/vivace
}: Props) {
  // Progress 0..PULSE_PATH.length-1 → si azzera in loop
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const totalMs = 8000; // giro completo dell'impulso su tutto il percorso
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: PULSE_PATH.length - 1,
        duration: totalMs,
        easing: Easing.inOut(Easing.linear),
        useNativeDriver: false, // interpola cx/cy (non supportati native driver)
      })
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [progress]);

  // Precalcola coordinate pixel dei nodi
  const nodes = NODES.map((n) => ({ x: n.x * width, y: n.y * height }));

  // Interpolazione della posizione dell'impulso (cx, cy) lungo i segmenti
  // definiti da PULSE_PATH.
  const cxRanges = PULSE_PATH.map((idx) => nodes[idx].x);
  const cyRanges = PULSE_PATH.map((idx) => nodes[idx].y);
  const inputRange = PULSE_PATH.map((_, i) => i);

  const pulseCx = progress.interpolate({
    inputRange,
    outputRange: cxRanges,
  });
  const pulseCy = progress.interpolate({
    inputRange,
    outputRange: cyRanges,
  });

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { width, height }]}
      testID="neural-pattern-bg"
    >
      <Svg width={width} height={height}>
        {/* Linee tra i nodi */}
        {EDGES.map(([a, b], i) => (
          <Line
            key={`edge-${i}`}
            x1={nodes[a].x}
            y1={nodes[a].y}
            x2={nodes[b].x}
            y2={nodes[b].y}
            stroke={color}
            strokeOpacity={opacity}
            strokeWidth={0.8}
          />
        ))}
        {/* Nodi */}
        {nodes.map((n, i) => (
          <Circle
            key={`node-${i}`}
            cx={n.x}
            cy={n.y}
            r={2.2}
            fill={color}
            fillOpacity={opacity + 0.05}
          />
        ))}
        {/* Impulso luminoso animato */}
        <AnimatedCircle
          cx={pulseCx as any}
          cy={pulseCy as any}
          r={2.8}
          fill={pulseColor}
          fillOpacity={0.75}
        />
        {/* Alone soft dell'impulso (più grande, meno opaco) */}
        <AnimatedCircle
          cx={pulseCx as any}
          cy={pulseCy as any}
          r={5.5}
          fill={pulseColor}
          fillOpacity={0.22}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
  },
});

export default NeuralPatternBg;

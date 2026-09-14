// LockKeyIcon.tsx — V50.z237 — Icona vettoriale flat «lucchetto con chiave» per Spazio Personale.
// Uso: <LockKeyIcon size={18} color="#FFF" />. `MenuIcon` è un drop-in per i menu che usano Ionicons
// per nome: se name === LOCK_KEY_ICON renderizza questo SVG, altrimenti l'Ionicon normale.
import React from "react";
import Svg, { Path, Rect, Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

export const LOCK_KEY_ICON = "lock-key" as const;

export function LockKeyIcon({ size = 20, color = "#FFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Corpo lucchetto */}
      <Rect x={3} y={10} width={13} height={11} rx={2.5} fill={color} />
      {/* Arco lucchetto */}
      <Path d="M6 10V7.5a3.5 3.5 0 0 1 7 0V10" stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      {/* Foro serratura */}
      <Circle cx={9.5} cy={15} r={1.6} fill="rgba(0,0,0,0.28)" />
      <Rect x={8.9} y={15.6} width={1.2} height={2.6} rx={0.6} fill="rgba(0,0,0,0.28)" />
      {/* Chiave (in basso a destra) */}
      <Circle cx={17.6} cy={13.4} r={2.6} stroke={color} strokeWidth={1.9} fill="none" />
      <Path d="M19.4 15.3l3 3M20.9 16.8l1-1M22 17.9l1-1" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

type IoniconName = keyof typeof Ionicons.glyphMap;
export type MenuIconName = IoniconName | typeof LOCK_KEY_ICON;

export function MenuIcon({ name, size, color, style }: { name: MenuIconName; size: number; color: string; style?: any }) {
  if (name === LOCK_KEY_ICON) return <LockKeyIcon size={size} color={color} />;
  return <Ionicons name={name as IoniconName} size={size} color={color} style={style} />;
}

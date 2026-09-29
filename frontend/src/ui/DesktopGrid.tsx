// DesktopGrid.tsx — V50.z409 — Distribuisce i figli su N colonne affiancate quando la finestra è desktop (≥ 1024 px);
// su mobile li rende impilati (fragment, nessun wrapper extra). Le sezioni vengono alternate tra le colonne
// (1ª → sinistra, 2ª → destra, …) così le pagine lunghe a una sola colonna sfruttano la larghezza orizzontale.
//   <DesktopGrid gap={16}> <CardA/> <CardB/> {cond ? <CardC/> : null} </DesktopGrid>
import React from "react";
import { View, StyleSheet } from "react-native";
import { useResponsive } from "@/src/hooks/useResponsive";

type Props = { children: React.ReactNode; gap?: number; columns?: number; style?: any };

export function DesktopGrid({ children, gap = 16, columns, style }: Props) {
  const { isDesktop } = useResponsive();
  const items = React.Children.toArray(children).filter(Boolean);
  const cols = isDesktop ? Math.max(1, columns ?? 2) : 1;
  if (cols === 1) return <>{items}</>;
  const buckets: React.ReactNode[][] = Array.from({ length: cols }, () => []);
  items.forEach((it, i) => buckets[i % cols].push(it));
  return (
    <View style={[styles.row, { gap }, style]} testID="desktop-grid">
      {buckets.map((b, i) => (
        <View key={i} style={[styles.col, { gap }]}>{b}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0 },
});

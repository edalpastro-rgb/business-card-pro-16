// DesktopGrid.tsx — V50.z409 — Distribuisce i figli su N colonne affiancate quando la finestra è desktop (≥ 1024 px);
// su mobile li rende impilati (fragment, nessun wrapper extra). Le sezioni vengono alternate tra le colonne
// (1ª → sinistra, 2ª → destra, …) così le pagine lunghe a una sola colonna sfruttano la larghezza orizzontale.
//   <DesktopGrid gap={16}> <CardA/> <CardB/> {cond ? <CardC/> : null} </DesktopGrid>
import React from "react";
import { View, StyleSheet } from "react-native";
import { useResponsive } from "@/src/hooks/useResponsive";

type Props = { children: React.ReactNode; gap?: number; columns?: number; style?: any; assign?: number[] };

export function DesktopGrid({ children, gap = 16, columns, style, assign }: Props) {
  const { isDesktop } = useResponsive();
  const items = React.Children.toArray(children).filter(Boolean);
  const cols = isDesktop ? Math.max(1, columns ?? 2) : 1;
  if (cols === 1) return <>{items}</>;
  const buckets: React.ReactNode[][] = Array.from({ length: cols }, () => []);
  // V50.z479 — `assign` (opzionale): colonna esplicita per ogni figlio (es. [0,1,0,1,1]); altrimenti alternanza per indice.
  items.forEach((it, i) => buckets[Math.min(cols - 1, Math.max(0, assign?.[i] ?? i % cols))].push(it));
  // V50.z479 — Le colonne si estendono alla stessa altezza (stretch) e l'ULTIMA sezione di ogni colonna cresce (flexGrow)
  // fino al fondo: niente spazio bianco a destra quando la colonna sinistra è più lunga (Home web).
  const grow = (it: React.ReactNode) => (React.isValidElement(it) ? React.cloneElement(it as React.ReactElement<any>, { style: [(it as React.ReactElement<any>).props.style, styles.grow] }) : it);
  return (
    <View style={[styles.row, { gap }, style]} testID="desktop-grid">
      {buckets.map((b, i) => (
        <View key={i} style={[styles.col, { gap }]}>{b.map((it, j) => (j === b.length - 1 ? grow(it) : it))}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  col: { flex: 1, minWidth: 0 },
  grow: { flexGrow: 1 },
});

// HomeBlocksGrid.tsx — V50.z505 — Rende i blocchi della Home secondo il layout salvato (GET /home/layout).
// Desktop (≥1024 px): righe a pari altezza; blocchi «left»/«right» affiancati, «full» a tutta larghezza.
// Mobile: tutto impilato nell'ordine scelto (la posizione sinistra/destra non ha effetto).
import React from "react";
import { View, StyleSheet } from "react-native";
import { useResponsive } from "@/src/hooks/useResponsive";
import { HomeBlock, buildHomeRows } from "@/src/home/homeLayout";

type Props = { blocks: HomeBlock[]; render: Record<string, () => React.ReactNode>; gap?: number };

export function HomeBlocksGrid({ blocks, render, gap = 16 }: Props) {
  const { isDesktop } = useResponsive();
  const paint = (b: HomeBlock) => (render[b.id] ? render[b.id]() : null);

  if (!isDesktop) {
    // Wrapper View senza flex: i blocchi con flex:1 (pensati per le righe desktop a pari altezza) prendono l'altezza del contenuto
    return <>{blocks.filter((b) => b.visible).map((b) => <View key={b.id} testID={`home-block-${b.id}`}>{paint(b)}</View>)}</>;
  }

  const rows = buildHomeRows(blocks);
  return (
    <View style={{ gap }} testID="home-blocks-grid">
      {rows.map((row, r) => {
        const cells = row.map((b) => (b ? paint(b) : null));
        if (cells.every((c) => c === null || c === undefined || c === false)) return null; // tutti i renderer vuoti (es. Beta non attivo) → niente riga
        return (
          <View key={row.map((b) => b?.id || "_").join("+") + r} style={[styles.row, { gap }]} testID={`home-row-${r}`}>
            {row.map((b, c) => (
              <View key={b?.id || `empty-${c}`} style={styles.cell} testID={b ? `home-block-${b.id}` : undefined}>
                {cells[c]}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  cell: { flex: 1, minWidth: 0, flexDirection: "column" },
});

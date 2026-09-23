// FormPageView.tsx — V50.z268 — Pagina PDF (immagine renderizzata dal server) con i riquadri dei campi sovrapposti.
// Coordinate 0-1000 relative alla pagina. onTap restituisce il punto toccato (0-1000) per spostare campi / aggiungere testi.
import React, { useState } from "react";
import { View, Image, Pressable, Text, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type PageInfo = { data_url: string; width: number; height: number };
export type Box = { id: string; bbox: number[]; label?: string; color?: string; filled?: boolean };

export function FormPageView({ page, boxes, selectedId, onSelect, onTap, showLabels }: {
  page: PageInfo | null; boxes: Box[]; selectedId?: string | null; onSelect?: (id: string) => void; onTap?: (x: number, y: number) => void; showLabels?: boolean;
}) {
  const win = useWindowDimensions();
  const [wl, setW] = useState(0);
  const w = wl || Math.max(200, Math.min(win.width, 900) - 24); // fallback: larghezza finestra − padding (onLayout su web può non scattare)
  if (!page) return <View style={[s.wrap, { height: 220, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color="#7C3AED" /></View>;
  const h = w > 0 ? (w * page.height) / page.width : 0;
  return (
    <View style={s.wrap} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID="form-page-view">
      {w > 0 ? (
        <Pressable onPress={(e) => { if (!onTap) return; const { locationX, locationY } = e.nativeEvent; onTap(Math.round((locationX / w) * 1000), Math.round((locationY / h) * 1000)); }} style={{ width: w, height: h }}>
          <Image source={{ uri: page.data_url }} style={{ width: w, height: h }} resizeMode="contain" />
          {boxes.map((b) => {
            const [x0, y0, x1, y1] = b.bbox;
            const sel = b.id === selectedId;
            const color = b.color || (b.filled ? "#10B981" : "#7C3AED");
            return (
              <Pressable key={b.id} onPress={() => onSelect?.(b.id)} style={[s.box, { left: (x0 / 1000) * w, top: (y0 / 1000) * h, width: Math.max(6, ((x1 - x0) / 1000) * w), height: Math.max(6, ((y1 - y0) / 1000) * h), borderColor: color, backgroundColor: sel ? color + "55" : color + "22", borderWidth: sel ? 2 : 1 }]} testID={`form-box-${b.id}`}>
                {showLabels && b.label && ((y1 - y0) / 1000) * h >= 9 ? <Text numberOfLines={1} style={[s.lbl, { color, fontSize: Math.max(6, Math.min(10, (((y1 - y0) / 1000) * h) * 0.6)) }]}>{b.label}</Text> : null}
              </Pressable>
            );
          })}
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: "100%", borderRadius: 10, overflow: "hidden", backgroundColor: HT.border, borderWidth: 1, borderColor: HT.borderStrong },
  box: { position: "absolute", borderRadius: 2, justifyContent: "center" },
  lbl: { fontWeight: "800", paddingHorizontal: 2 },
});

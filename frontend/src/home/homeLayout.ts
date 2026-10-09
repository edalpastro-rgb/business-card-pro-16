// homeLayout.ts — V50.z505 — Home personalizzabile: tipi, default e hook di lettura di GET /home/layout.
// Il registro dei blocchi vive nel backend (routes/home_layout.py); qui solo i default usati prima della risposta del server.
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";

export type HomeBlockPos = "left" | "right" | "full";
export type HomeBlock = { id: string; label: string; hint?: string; visible: boolean; pos: HomeBlockPos; order: number };
export type HomeLayout = { allowed: boolean; customized: boolean; blocks: HomeBlock[] };

export const HOME_LAYOUT_DEFAULT_BLOCKS: HomeBlock[] = [
  { id: "master", label: "Interfaccia Master", visible: true, pos: "full", order: 0 },
  { id: "pun", label: "PUN energia", visible: true, pos: "full", order: 1 },
  { id: "callbacks", label: "Ritelefonate di oggi", visible: true, pos: "left", order: 2 },
  { id: "appointments", label: "Appuntamenti di oggi", visible: true, pos: "right", order: 3 },
  { id: "calls", label: "Call di oggi", visible: true, pos: "full", order: 4 },
  { id: "calendar", label: "Calendario", visible: true, pos: "full", order: 4 },
  { id: "stats", label: "Statistiche", visible: true, pos: "full", order: 5 },
  { id: "deadlines", label: "Scadenze", visible: true, pos: "full", order: 6 },
  { id: "company", label: "Comunica con l'azienda", visible: true, pos: "full", order: 7 },
  { id: "beta", label: "Programma Beta", visible: true, pos: "full", order: 8 },
];

export function useHomeLayout(): HomeLayout {
  const [layout, setLayout] = useState<HomeLayout>({ allowed: false, customized: false, blocks: HOME_LAYOUT_DEFAULT_BLOCKS });
  const load = useCallback(() => {
    api<HomeLayout>("/home/layout").then((r) => { if (r?.blocks?.length) setLayout(r); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return layout;
}

/** Raggruppa i blocchi visibili in righe per il desktop: «full» = riga intera; «left»/«right» = coppie affiancate
 *  (una metà sola resta sul suo lato con l'altra metà vuota). Ogni cella è `null` se vuota. */
export function buildHomeRows(blocks: HomeBlock[]): (HomeBlock | null)[][] {
  const rows: (HomeBlock | null)[][] = [];
  const list = blocks.filter((b) => b.visible);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.pos === "full") { rows.push([b]); continue; }
    const next = list[i + 1];
    if (next && next.pos !== "full") {
      i++;
      if (b.pos === "right" && next.pos === "left") rows.push([next, b]);
      else rows.push([b, next]);
    } else {
      rows.push(b.pos === "right" ? [null, b] : [b, null]);
    }
  }
  return rows;
}

// areaIcons.ts — V50.z408 — LIBRERIA ICONE per le aree del Corporate Gym (Ionicons, colori accattivanti): scelta rapida per aree
// presenti e future — trattativa, obiezioni, telefono, energia, contratti, formazione, team, analisi… In alternativa il Master
// può caricare un'immagine (galleria / file / Drive tramite il selettore di sistema).
import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type AreaIcon = { icon: ComponentProps<typeof Ionicons>["name"]; label: string; color: string };

export const AREA_ICON_LIBRARY: AreaIcon[] = [
  { icon: "barbell", label: "Allenamento", color: "#7C3AED" },
  { icon: "chatbubbles", label: "Obiezioni", color: "#DC2626" },
  { icon: "handshake" as any, label: "Accordo", color: "#0F9D58" },
  { icon: "people", label: "Cliente", color: "#0EA5E9" },
  { icon: "call", label: "Telefonata", color: "#2563EB" },
  { icon: "calendar", label: "Appuntamento", color: "#F59E0B" },
  { icon: "flash", label: "Energia", color: "#F97316" },
  { icon: "bulb", label: "Luce", color: "#FACC15" },
  { icon: "flame", label: "Gas", color: "#EF4444" },
  { icon: "leaf", label: "Green", color: "#16A34A" },
  { icon: "document-text", label: "Contratto", color: "#6366F1" },
  { icon: "receipt", label: "Bolletta", color: "#0891B2" },
  { icon: "calculator", label: "Analisi", color: "#334155" },
  { icon: "trending-up", label: "Vendita", color: "#059669" },
  { icon: "trophy", label: "Obiettivo", color: "#D97706" },
  { icon: "school", label: "Formazione", color: "#7C3AED" },
  { icon: "mic", label: "Voce", color: "#DB2777" },
  { icon: "headset", label: "Ascolto", color: "#4F46E5" },
  { icon: "shield-checkmark", label: "Fiducia", color: "#0D9488" },
  { icon: "heart", label: "Rapport", color: "#E11D48" },
  { icon: "rocket", label: "Chiusura", color: "#EA580C" },
  { icon: "git-branch", label: "Percorso", color: "#64748B" },
  { icon: "business", label: "Azienda", color: "#1D4ED8" },
  { icon: "home", label: "Domestico", color: "#0284C7" },
  { icon: "storefront", label: "Negozio", color: "#9333EA" },
  { icon: "car", label: "Visita", color: "#475569" },
  { icon: "cash", label: "Prezzo", color: "#15803D" },
  { icon: "pie-chart", label: "Report", color: "#B45309" },
  { icon: "ribbon", label: "Premium", color: "#BE185D" },
  { icon: "sparkles", label: "Axon", color: "#8B5CF6" },
];

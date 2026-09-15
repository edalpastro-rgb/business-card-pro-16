// V50.z259 — Navigatore AxonOS: marker [[NAV:route|label]] e [[ACTION:id|label|json]]
// nei messaggi di Axon → pulsanti (deep link / azione confermabile). + card suggerimento proattivo.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";

export type NavChip = { kind: "nav"; route: string; label: string };
export type ActionChip = { kind: "action"; action: string; label: string; payload: Record<string, any> };
export type Chip = NavChip | ActionChip;

const NAV_RX = /\[\[NAV:([^|\]]+)\|([^\]]+)\]\]/g;
const ACT_RX = /\[\[ACTION:([a-z_]+)\|([^|\]]+)\|(\{[\s\S]*?\})\]\]/g;

/** Estrae i marker dal testo e restituisce il contenuto pulito + i chip. */
export function extractNavChips(content: string): { clean: string; chips: Chip[] } {
  if (!content || content.indexOf("[[") === -1) return { clean: content, chips: [] };
  const chips: Chip[] = [];
  let clean = content.replace(ACT_RX, (_m, action, label, json) => {
    let payload: Record<string, any> = {};
    try { payload = JSON.parse(json); } catch { payload = {}; }
    chips.push({ kind: "action", action, label: label.trim(), payload });
    return "";
  });
  clean = clean.replace(NAV_RX, (_m, route, label) => {
    chips.push({ kind: "nav", route: route.trim(), label: label.trim() });
    return "";
  });
  // Rimuove righe rimaste vuote dai marker
  clean = clean.split("\n").filter((l, i, arr) => !(l.trim() === "" && (i === arr.length - 1 || (arr[i + 1] || "").trim() === ""))).join("\n").trimEnd();
  return { clean, chips };
}

/** Versione "parlabile": rimuove i marker (per il TTS). */
export function stripNavMarkers(content: string): string {
  return (content || "").replace(ACT_RX, "").replace(NAV_RX, "");
}

export function NavChips({ chips, onNavigate, onAction }: {
  chips: Chip[];
  onNavigate: (route: string) => void;
  onAction: (action: string, payload: Record<string, any>) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (!chips.length) return null;
  return (
    <View style={styles.wrap} testID="nav-chips">
      {chips.map((c, i) => {
        if (c.kind === "nav") {
          return (
            <Pressable key={`n-${i}`} onPress={() => onNavigate(c.route)} style={styles.navBtn} testID={`nav-chip-${i}`} accessibilityRole="button">
              <Text style={styles.navTxt} numberOfLines={2}>{c.label}</Text>
              <Ionicons name="arrow-forward-circle" size={18} color="#7C3AED" />
            </Pressable>
          );
        }
        const key = `${c.action}-${i}`;
        const isDone = done.has(key);
        return (
          <Pressable
            key={`a-${i}`}
            disabled={busy !== null || isDone}
            onPress={async () => {
              setBusy(key);
              try { await onAction(c.action, c.payload); setDone((s) => new Set(s).add(key)); }
              finally { setBusy(null); }
            }}
            style={[styles.actBtn, isDone && styles.actBtnDone]}
            testID={`action-chip-${c.action}`}
            accessibilityRole="button"
          >
            {busy === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={isDone ? "checkmark-circle" : "flash"} size={16} color="#FFF" />}
            <Text style={styles.actTxt} numberOfLines={2}>{isDone ? "Fatto" : c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type ProactiveHint = { id: string; text: string; route: string; label: string };

/** Card «Axon ha notato…»: suggerimento proattivo (PARTE 4) con Apri / Non ora. */
export function NavProactiveCard({ visible, onNavigate }: { visible: boolean; onNavigate: (route: string) => void }) {
  const [hint, setHint] = useState<ProactiveHint | null>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    api<{ hints: ProactiveHint[] }>("/axon/nav/proactive")
      .then((r) => { if (alive) setHint(r?.hints?.[0] || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [visible]);
  if (!hint) return null;
  const dismiss = () => {
    const id = hint.id;
    setHint(null);
    api("/axon/nav/proactive/dismiss", { method: "POST", body: { id } }).catch(() => {});
  };
  return (
    <View style={styles.card} testID={`nav-proactive-${hint.id}`}>
      <View style={styles.cardHead}>
        <Ionicons name="bulb" size={16} color="#7C3AED" />
        <Text style={styles.cardTitle}>Axon ha notato</Text>
      </View>
      <Text style={styles.cardTxt}>{hint.text}</Text>
      <View style={styles.cardRow}>
        <Pressable onPress={() => { dismiss(); onNavigate(hint.route); }} style={styles.cardOpen} testID="nav-proactive-open">
          <Text style={styles.cardOpenTxt}>{hint.label}</Text>
        </Pressable>
        <Pressable onPress={dismiss} style={styles.cardLater} testID="nav-proactive-dismiss" hitSlop={8}>
          <Text style={styles.cardLaterTxt}>Non ora</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 4 },
  navBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: "#F5F3FF", borderColor: "#DDD6FE", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  navTxt: { flex: 1, color: "#4C1D95", fontWeight: "800", fontSize: 13.5 },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#7C3AED", borderRadius: 12, paddingHorizontal: 14, minHeight: 44 },
  actBtnDone: { backgroundColor: "#16A34A" },
  actTxt: { flex: 1, color: "#FFF", fontWeight: "900", fontSize: 13.5 },
  card: { marginHorizontal: 12, marginBottom: 8, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E9D5FF", padding: 12, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { fontSize: 12, fontWeight: "900", color: "#7C3AED", letterSpacing: 0.3 },
  cardTxt: { fontSize: 14, color: "#1F2937", lineHeight: 20 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  cardOpen: { flex: 1, backgroundColor: "#7C3AED", borderRadius: 10, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  cardOpenTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  cardLater: { minHeight: 40, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  cardLaterTxt: { color: "#6B7280", fontWeight: "700", fontSize: 13 },
});

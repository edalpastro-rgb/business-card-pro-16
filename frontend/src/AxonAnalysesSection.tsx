import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { AxonOSLogo } from "@/src/BrandLogos";

/**
 * V29.g — "Analisi Axon" per contatto.
 * Timeline delle analisi automatiche generate da Axon dopo ogni interazione
 * (chiamata, nota, messaggio). Le entry si accumulano nel tempo — nessuna
 * sovrascrittura. Nessuna azione manuale richiesta dall'utente.
 */

type AxonAnalysis = {
  analysis_id: string;
  contact_id: string;
  interaction_type: "call" | "note" | "message";
  interaction_ref_id?: string | null;
  interaction_snippet?: string | null;
  tone: "positive" | "neutral" | "skeptical" | "interested" | "negative";
  topics: string[];
  objections: string[];
  next_step?: string | null;
  summary?: string | null;
  created_at: string;
};

const C = {
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  bg: "#FFFFFF",
  cardBg: "#FBFCFD",
  navy: "#1B2B4B",
};

const TONE_META: Record<string, { label: string; fg: string; bg: string; icon: any }> = {
  positive:    { label: "Positivo",   fg: "#166534", bg: "#DCFCE7", icon: "happy" },
  interested:  { label: "Interessato",fg: "#7C3AED", bg: "#F5F3FF", icon: "flame" },
  neutral:     { label: "Neutro",     fg: "#475569", bg: "#F1F5F9", icon: "remove-circle" },
  skeptical:   { label: "Scettico",   fg: "#B45309", bg: "#FEF3C7", icon: "help-circle" },
  negative:    { label: "Negativo",   fg: "#B91C1C", bg: "#FEE2E2", icon: "sad" },
};

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  call:    { label: "Chiamata", icon: "call",              color: "#EA580C" },
  note:    { label: "Nota",     icon: "document-text",     color: "#0891B2" },
  message: { label: "Messaggio",icon: "chatbubble-ellipses", color: "#7C3AED" },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} · ${hh}:${mi}`;
  } catch {
    return iso;
  }
}

export function AxonAnalysesSection({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<AxonAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<{ items: AxonAnalysis[] }>(`/contacts/${contactId}/axon-analyses`);
      setItems(r?.items || []);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
    // V29.g — Poll leggero per catturare l'analisi generata in background (~5-15s)
    // Interroghiamo 3 volte a intervalli crescenti, poi ci fermiamo.
    const timers: any[] = [];
    [4000, 10000, 20000].forEach((t) => {
      timers.push(setTimeout(load, t));
    });
    return () => timers.forEach(clearTimeout);
  }, [load]);

  if (loading && items.length === 0) {
    return (
      <View style={styles.wrap}>
        <View style={styles.header}>
          <AxonOSLogo size={26} />
          <Text style={styles.title}>Analisi Axon</Text>
        </View>
        <View style={{ paddingVertical: 14, alignItems: "center" }}>
          <ActivityIndicator color="#7C3AED" />
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.wrap}>
        <View style={styles.header}>
          <AxonOSLogo size={26} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Analisi Axon</Text>
            <Text style={styles.sub}>Riassunti automatici per ogni interazione</Text>
          </View>
        </View>
        <View style={styles.emptyBox}>
          <Ionicons name="sparkles" size={18} color={C.muted} />
          <Text style={styles.emptyTxt}>
            Non appena registri una chiamata o aggiungi una nota, Axon genera qui un riassunto
            con tono, argomenti, obiezioni e il prossimo passo consigliato.
          </Text>
        </View>
      </View>
    );
  }

  const visible = showAll ? items : items.slice(0, expanded ? items.length : 3);

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="axon-analyses-toggle"
        onPress={() => setExpanded((v) => !v)}
        style={styles.header}
        hitSlop={6}
      >
        <AxonOSLogo size={26} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Analisi Axon</Text>
          <Text style={styles.sub}>{items.length} {items.length === 1 ? "analisi" : "analisi"} generate</Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={C.muted} />
      </Pressable>

      {expanded && (
        <View style={{ marginTop: 12 }}>
          {visible.map((a, idx) => {
            const tm = TONE_META[a.tone] || TONE_META.neutral;
            const ym = TYPE_META[a.interaction_type] || TYPE_META.call;
            return (
              <View key={a.analysis_id} style={[styles.card, idx > 0 && { marginTop: 10 }]}>
                <View style={styles.cardHead}>
                  <View style={[styles.typePill, { backgroundColor: ym.color + "1A" }]}>
                    <Ionicons name={ym.icon} size={12} color={ym.color} />
                    <Text style={[styles.typePillTxt, { color: ym.color }]}>{ym.label}</Text>
                  </View>
                  <View style={[styles.tonePill, { backgroundColor: tm.bg }]}>
                    <Ionicons name={tm.icon} size={12} color={tm.fg} />
                    <Text style={[styles.tonePillTxt, { color: tm.fg }]}>{tm.label}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.date}>{formatDate(a.created_at)}</Text>
                </View>

                {a.summary ? <Text style={styles.summaryTxt}>{a.summary}</Text> : null}

                {a.topics.length > 0 && (
                  <View style={styles.chipsRow}>
                    {a.topics.map((t, ti) => (
                      <View key={`t-${ti}`} style={styles.topicChip}>
                        <Text style={styles.topicChipTxt}>{t}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {a.objections.length > 0 && (
                  <View style={styles.objBlock}>
                    <Text style={styles.blockLabel}>Obiezioni</Text>
                    {a.objections.map((o, oi) => (
                      <View key={`o-${oi}`} style={styles.objRow}>
                        <Ionicons name="alert-circle" size={14} color="#B45309" />
                        <Text style={styles.objTxt}>{o}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {a.next_step ? (
                  <View style={styles.nextBlock}>
                    <View style={styles.nextHead}>
                      <MaterialCommunityIcons name="arrow-right-bold-circle" size={14} color="#7C3AED" />
                      <Text style={styles.nextLabel}>Prossimo passo</Text>
                    </View>
                    <Text style={styles.nextTxt}>{a.next_step}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}

          {items.length > 3 && !showAll && (
            <Pressable
              testID="axon-analyses-showall"
              onPress={() => setShowAll(true)}
              style={styles.moreBtn}
            >
              <Text style={styles.moreBtnTxt}>Mostra tutte le {items.length} analisi</Text>
              <Ionicons name="chevron-down" size={14} color="#7C3AED" />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: { fontSize: 15, fontWeight: "800", color: C.text, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 1 },
  emptyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTxt: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },
  card: {
    backgroundColor: C.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  typePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  typePillTxt: { fontSize: 10.5, fontWeight: "800" },
  tonePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  tonePillTxt: { fontSize: 10.5, fontWeight: "800" },
  date: { fontSize: 10.5, color: C.muted, fontWeight: "600" },
  summaryTxt: { fontSize: 13, color: C.text, lineHeight: 19, marginBottom: 8 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 4 },
  topicChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" },
  topicChipTxt: { fontSize: 10.5, fontWeight: "700", color: "#3730A3" },
  objBlock: { marginTop: 8, padding: 8, borderRadius: 10, backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#FDE68A" },
  blockLabel: { fontSize: 10.5, fontWeight: "800", color: "#78350F", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  objRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  objTxt: { flex: 1, fontSize: 12, color: "#92400E", fontWeight: "600" },
  nextBlock: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: "#F5F3FF", borderLeftWidth: 3, borderLeftColor: "#7C3AED" },
  nextHead: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 },
  nextLabel: { fontSize: 10.5, fontWeight: "800", color: "#5B21B6", textTransform: "uppercase", letterSpacing: 0.3 },
  nextTxt: { fontSize: 12.5, color: "#4C1D95", fontWeight: "600", lineHeight: 18 },
  moreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, marginTop: 8 },
  moreBtnTxt: { fontSize: 12, color: "#7C3AED", fontWeight: "800" },
});

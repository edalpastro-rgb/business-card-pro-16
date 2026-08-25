import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { AxonOSLogo } from "@/src/BrandLogos";

/**
 * V29.i — "Profilo Axon" (Fase 2)
 * Aggrega tutte le analisi di interazione (Fase 1) e mostra un profilo
 * comportamentale sintetico: stile di comunicazione, livello interesse,
 * obiezioni ricorrenti, momento migliore di contatto, suggerimento strategico.
 *
 * Il profilo si aggiorna automaticamente ad ogni nuova interazione (nessun input
 * manuale dall'utente). Sul frontend usiamo un polling leggero per catturarlo.
 */

type AxonProfile = {
  profile_id?: string;
  contact_id: string;
  communication_style: "analitico" | "emotivo" | "diretto" | "cauto" | "espansivo" | "riservato" | "pragmatico";
  style_reason?: string;
  interest_level: "high" | "medium" | "low";
  interest_trend?: "up" | "flat" | "down";
  recurring_objections: string[];
  best_contact_time?: "mattina" | "pranzo" | "pomeriggio" | "sera" | "weekend" | null;
  best_contact_time_reason?: string;
  strategic_suggestion?: string;
  key_topics?: string[];
  based_on_count?: number;
  updated_at?: string;
};

const C = {
  bg: "#FFFFFF",
  cardBg: "#FBFCFD",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  primary: "#7C3AED",
  primarySoft: "#F5F3FF",
  navy: "#1B2B4B",
};

const STYLE_META: Record<string, { label: string; icon: any; fg: string; bg: string; desc: string }> = {
  analitico:   { label: "Analitico",   icon: "calculator",       fg: "#3730A3", bg: "#EEF2FF", desc: "Vuole dati e confronti precisi" },
  emotivo:     { label: "Emotivo",     icon: "heart",            fg: "#B91C1C", bg: "#FEE2E2", desc: "Decide con l'istinto e la relazione" },
  diretto:     { label: "Diretto",     icon: "flash",            fg: "#B45309", bg: "#FEF3C7", desc: "Va dritto al punto, poche parole" },
  cauto:       { label: "Cauto",       icon: "shield-checkmark", fg: "#166534", bg: "#DCFCE7", desc: "Valuta con attenzione, senza fretta" },
  espansivo:   { label: "Espansivo",   icon: "chatbubbles",      fg: "#7C3AED", bg: "#F5F3FF", desc: "Socievole, ama dialogare" },
  riservato:   { label: "Riservato",   icon: "lock-closed",      fg: "#475569", bg: "#F1F5F9", desc: "Poche parole, spazi personali" },
  pragmatico:  { label: "Pragmatico",  icon: "briefcase",        fg: "#0369A1", bg: "#DBEAFE", desc: "Concreto, orientato ai risultati" },
};

const INTEREST_META: Record<string, { label: string; fg: string; bg: string; ratio: number }> = {
  high:   { label: "Alto",  fg: "#166534", bg: "#DCFCE7", ratio: 1.0 },
  medium: { label: "Medio", fg: "#B45309", bg: "#FEF3C7", ratio: 0.55 },
  low:    { label: "Basso", fg: "#B91C1C", bg: "#FEE2E2", ratio: 0.22 },
};

const TREND_META: Record<string, { icon: any; color: string; label: string }> = {
  up:   { icon: "trending-up",   color: "#16A34A", label: "in crescita" },
  flat: { icon: "remove",        color: "#64748B", label: "stabile" },
  down: { icon: "trending-down", color: "#DC2626", label: "in calo" },
};

const TIME_META: Record<string, { label: string; icon: any }> = {
  mattina:    { label: "Mattina",    icon: "sunny" },
  pranzo:     { label: "Pranzo",     icon: "restaurant" },
  pomeriggio: { label: "Pomeriggio", icon: "partly-sunny" },
  sera:       { label: "Sera",       icon: "moon" },
  weekend:    { label: "Weekend",    icon: "calendar" },
};

export function AxonProfileCard({ contactId }: { contactId: string }) {
  const [profile, setProfile] = useState<AxonProfile | null>(null);
  const [hasAnalyses, setHasAnalyses] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<{ profile: AxonProfile | null; has_analyses: boolean }>(`/contacts/${contactId}/axon-profile`);
      setProfile(r?.profile || null);
      setHasAnalyses(!!r?.has_analyses);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
    // Polling breve per catturare l'update background dopo una nuova interazione
    const timers: any[] = [];
    [7000, 15000, 25000].forEach((t) => timers.push(setTimeout(load, t)));
    return () => timers.forEach(clearTimeout);
  }, [load]);

  // Loading state (only if we have nothing yet)
  if (loading && !profile) {
    return (
      <View style={styles.wrap}>
        <View style={styles.header}>
          <AxonOSLogo size={28} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Profilo Axon</Text>
            <Text style={styles.sub}>Sintesi comportamentale del cliente</Text>
          </View>
        </View>
        <View style={{ paddingVertical: 16, alignItems: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      </View>
    );
  }

  // No profile yet — show placeholder
  if (!profile) {
    return (
      <View style={styles.wrap}>
        <View style={styles.header}>
          <AxonOSLogo size={28} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Profilo Axon</Text>
            <Text style={styles.sub}>Sintesi comportamentale del cliente</Text>
          </View>
        </View>
        <View style={styles.placeholder}>
          <Ionicons name="hourglass-outline" size={18} color={C.muted} />
          <Text style={styles.placeholderTxt}>
            {hasAnalyses
              ? "Axon sta costruendo il profilo dalle prime interazioni. Ricarica tra qualche istante."
              : "Il profilo apparirà qui dopo la prima chiamata o nota registrata."}
          </Text>
        </View>
      </View>
    );
  }

  const styleMeta = STYLE_META[profile.communication_style] || STYLE_META.pragmatico;
  const intMeta = INTEREST_META[profile.interest_level] || INTEREST_META.medium;
  const trendMeta = TREND_META[profile.interest_trend || "flat"];
  const timeKey = profile.best_contact_time;
  const timeMeta = timeKey ? TIME_META[timeKey] : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <AxonOSLogo size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Profilo Axon</Text>
          <Text style={styles.sub}>
            Basato su {profile.based_on_count || 0} interazion{(profile.based_on_count || 0) === 1 ? "e" : "i"}
          </Text>
        </View>
      </View>

      {/* Stile di comunicazione */}
      <View style={[styles.rowCard, { backgroundColor: styleMeta.bg }]}>
        <View style={[styles.rowIcon, { backgroundColor: styleMeta.fg }]}>
          <Ionicons name={styleMeta.icon} size={16} color="#FFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Stile di comunicazione</Text>
          <View style={styles.rowValueRow}>
            <Text style={[styles.rowValue, { color: styleMeta.fg }]}>{styleMeta.label}</Text>
          </View>
          <Text style={styles.rowHint}>{profile.style_reason || styleMeta.desc}</Text>
        </View>
      </View>

      {/* Livello di interesse + trend */}
      <View style={styles.interestCard}>
        <View style={styles.interestHead}>
          <View style={styles.rowIconMuted}>
            <Ionicons name="flame" size={16} color={intMeta.fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Livello di interesse</Text>
          </View>
          <View style={[styles.trendPill, { borderColor: trendMeta.color + "40" }]}>
            <Ionicons name={trendMeta.icon} size={12} color={trendMeta.color} />
            <Text style={[styles.trendPillTxt, { color: trendMeta.color }]}>{trendMeta.label}</Text>
          </View>
        </View>
        <View style={styles.meterBg}>
          <View style={[styles.meterFill, { width: `${Math.round(intMeta.ratio * 100)}%`, backgroundColor: intMeta.fg }]} />
        </View>
        <View style={styles.meterLabels}>
          <Text style={styles.meterEdge}>Basso</Text>
          <Text style={[styles.meterActive, { color: intMeta.fg }]}>{intMeta.label}</Text>
          <Text style={styles.meterEdge}>Alto</Text>
        </View>
      </View>

      {/* Obiezioni ricorrenti */}
      {profile.recurring_objections.length > 0 && (
        <View style={styles.objCard}>
          <View style={styles.rowLabelInline}>
            <Ionicons name="alert-circle" size={15} color="#B45309" />
            <Text style={styles.objLabel}>Obiezioni ricorrenti</Text>
          </View>
          <View style={styles.chipsRow}>
            {profile.recurring_objections.map((o, i) => (
              <View key={`ro-${i}`} style={styles.objChip}>
                <Text style={styles.objChipTxt}>{o}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Best contact time */}
      <View style={styles.timeCard}>
        <View style={[styles.rowIconMuted, { backgroundColor: "#E0F2FE" }]}>
          <Ionicons name={timeMeta?.icon || "time"} size={16} color="#0369A1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Momento migliore per contattarlo</Text>
          {timeMeta ? (
            <>
              <Text style={[styles.rowValue, { color: "#0369A1" }]}>{timeMeta.label}</Text>
              {profile.best_contact_time_reason ? (
                <Text style={styles.rowHint}>{profile.best_contact_time_reason}</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.rowHintItalic}>Non ancora rilevabile — servono più interazioni</Text>
          )}
        </View>
      </View>

      {/* Suggerimento strategico */}
      {profile.strategic_suggestion ? (
        <View style={styles.suggestCard}>
          <View style={styles.suggestHead}>
            <MaterialCommunityIcons name="lightbulb-on" size={16} color={C.primary} />
            <Text style={styles.suggestLabel}>Suggerimento strategico Axon</Text>
          </View>
          <Text style={styles.suggestTxt}>{profile.strategic_suggestion}</Text>
        </View>
      ) : null}
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
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  title: { fontSize: 15, fontWeight: "800", color: C.text, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 1 },

  placeholder: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: C.border,
  },
  placeholderTxt: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },

  rowCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  rowIcon: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  rowIconMuted: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  rowLabelInline: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  rowValueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  rowValue: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  rowHint: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  rowHintItalic: { fontSize: 12, color: C.muted, marginTop: 4, fontStyle: "italic" },

  interestCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.cardBg,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  interestHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  trendPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1,
  },
  trendPillTxt: { fontSize: 10.5, fontWeight: "800" },
  meterBg: {
    height: 10, borderRadius: 6, backgroundColor: "#E2E8F0", overflow: "hidden",
  },
  meterFill: { height: "100%", borderRadius: 6 },
  meterLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meterEdge: { fontSize: 10, color: C.muted, fontWeight: "700" },
  meterActive: { fontSize: 11, fontWeight: "800" },

  objCard: {
    padding: 12, borderRadius: 12, backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#FDE68A",
  },
  objLabel: { fontSize: 11, fontWeight: "800", color: "#78350F", textTransform: "uppercase", letterSpacing: 0.3 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  objChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#FDE68A" },
  objChipTxt: { fontSize: 11, fontWeight: "700", color: "#92400E" },

  timeCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 12, borderRadius: 12,
    backgroundColor: "#F0F9FF", borderWidth: 1, borderColor: "#BAE6FD",
  },

  suggestCard: {
    padding: 12, borderRadius: 12,
    backgroundColor: C.primarySoft,
    borderLeftWidth: 4, borderLeftColor: C.primary,
  },
  suggestHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  suggestLabel: { fontSize: 11, fontWeight: "800", color: "#5B21B6", textTransform: "uppercase", letterSpacing: 0.4 },
  suggestTxt: { fontSize: 13.5, color: "#4C1D95", fontWeight: "600", lineHeight: 19 },
});

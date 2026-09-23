import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { LinearGradient } from "expo-linear-gradient";
import { AxonOSLogo } from "@/src/BrandLogos";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

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

// V50.z335 — Card premium dark: bordo ciano/viola, accenti vivaci, barra interesse a gradiente rosso → giallo → verde
const C = {
  bg: HT.card,
  cardBg: HT.card2,
  text: HT.text,
  muted: HT.muted,
  border: HT.border,
  primary: HT.violet,
  primarySoft: HT.violetTint,
  navy: HT.axon,
};

const STYLE_META: Record<string, { label: string; icon: any; fg: string; bg: string; desc: string }> = {
  analitico:   { label: "Analitico",   icon: "calculator",       fg: "#818CF8", bg: "rgba(129,140,248,0.14)", desc: "Vuole dati e confronti precisi" },
  emotivo:     { label: "Emotivo",     icon: "heart",            fg: HT.danger,  bg: HT.dangerTint,  desc: "Decide con l'istinto e la relazione" },
  diretto:     { label: "Diretto",     icon: "flash",            fg: HT.warning, bg: HT.warningTint, desc: "Va dritto al punto, poche parole" },
  cauto:       { label: "Cauto",       icon: "shield-checkmark", fg: HT.success, bg: HT.successTint, desc: "Valuta con attenzione, senza fretta" },
  espansivo:   { label: "Espansivo",   icon: "chatbubbles",      fg: HT.violet,  bg: HT.violetTint,  desc: "Socievole, ama dialogare" },
  riservato:   { label: "Riservato",   icon: "lock-closed",      fg: HT.text2,   bg: HT.glassStrong, desc: "Poche parole, spazi personali" },
  pragmatico:  { label: "Pragmatico",  icon: "briefcase",        fg: HT.axon,    bg: HT.axonTint,    desc: "Concreto, orientato ai risultati" },
};

const INTEREST_META: Record<string, { label: string; fg: string; bg: string; ratio: number }> = {
  high:   { label: "Alto",  fg: HT.success, bg: HT.successTint, ratio: 1.0 },
  medium: { label: "Medio", fg: HT.warning, bg: HT.warningTint, ratio: 0.55 },
  low:    { label: "Basso", fg: HT.danger,  bg: HT.dangerTint,  ratio: 0.22 },
};

const TREND_META: Record<string, { icon: any; color: string; label: string }> = {
  up:   { icon: "trending-up",   color: HT.success, label: "in crescita" },
  flat: { icon: "remove",        color: HT.muted,   label: "stabile" },
  down: { icon: "trending-down", color: HT.danger,  label: "in calo" },
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
    <View style={styles.wrap} testID="axon-profile-card">
      <LinearGradient colors={[HT.axon, HT.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.wrapTopLine} />
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
        <View style={styles.meterBg} testID="axon-interest-meter">
          <LinearGradient colors={[HT.danger, HT.warning, HT.success]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
          {/* maschera scura sulla parte non raggiunta → il gradiente «si accende» fino al livello */}
          <View style={[styles.meterMask, { width: `${Math.round((1 - intMeta.ratio) * 100)}%` }]} />
          <View style={[styles.meterKnob, { left: `${Math.round(intMeta.ratio * 100)}%`, backgroundColor: intMeta.fg }]} />
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
            <Ionicons name="alert-circle" size={15} color={HT.warning} />
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
        <View style={[styles.rowIconMuted, { backgroundColor: HT.axonTint }]}>
          <Ionicons name={timeMeta?.icon || "time"} size={16} color={HT.axon} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Momento migliore per contattarlo</Text>
          {timeMeta ? (
            <>
              <Text style={[styles.rowValue, { color: HT.axon }]}>{timeMeta.label}</Text>
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
  wrap: { ...HT.cardShadow,
    backgroundColor: C.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HT.axonLine,
    padding: 12,
    marginBottom: 12,
    gap: 10,
    overflow: "hidden",
    position: "relative",
  },
  wrapTopLine: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
    marginTop: 2,
  },
  title: { fontSize: 15, fontWeight: "800", color: C.text, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 1 },

  placeholder: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.cardBg,
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
    borderWidth: 1,
    borderColor: HT.border,
  },
  rowIcon: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  rowIconMuted: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: HT.glassStrong,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  rowLabelInline: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  rowValueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  rowValue: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  rowHint: { fontSize: 12, color: HT.text2, marginTop: 4, lineHeight: 17 },
  rowHintItalic: { fontSize: 12, color: C.muted, marginTop: 4, fontStyle: "italic" },

  interestCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.cardBg,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  interestHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  trendPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, backgroundColor: HT.glass,
  },
  trendPillTxt: { fontSize: 10.5, fontWeight: "800" },
  // V50.z335 — barra a gradiente (rosso → giallo → verde) con maschera + indicatore
  meterBg: { height: 12, borderRadius: 6, backgroundColor: HT.glassStrong, overflow: "hidden", position: "relative" },
  meterMask: { position: "absolute", right: 0, top: 0, bottom: 0, backgroundColor: "rgba(11,22,38,0.82)" },
  meterKnob: { position: "absolute", top: -1, width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: HT.card },
  meterLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meterEdge: { fontSize: 10, color: C.muted, fontWeight: "700" },
  meterActive: { fontSize: 11, fontWeight: "800" },

  objCard: {
    padding: 12, borderRadius: 12, backgroundColor: HT.warningTint, borderWidth: 1, borderColor: HT.warning + "55",
  },
  objLabel: { fontSize: 11, fontWeight: "800", color: HT.warning, textTransform: "uppercase", letterSpacing: 0.3 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  objChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: HT.glass, borderWidth: 1, borderColor: HT.warning + "55" },
  objChipTxt: { fontSize: 11, fontWeight: "700", color: "#FDE68A" },

  timeCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 12, borderRadius: 12,
    backgroundColor: HT.axonTint, borderWidth: 1, borderColor: HT.axonLine,
  },

  suggestCard: {
    padding: 12, borderRadius: 12,
    backgroundColor: C.primarySoft,
    borderLeftWidth: 4, borderLeftColor: C.primary,
  },
  suggestHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  suggestLabel: { fontSize: 11, fontWeight: "800", color: HT.violet, textTransform: "uppercase", letterSpacing: 0.4 },
  suggestTxt: { fontSize: 13.5, color: HT.text, fontWeight: "600", lineHeight: 19 },
});

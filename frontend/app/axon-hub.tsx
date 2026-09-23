// V50.z16 — Axon Center: hub che raggruppa tutte le funzioni Axon.
// Accessibile dal bottone "INSEGNA AD AXON" nell'area Master.
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Card = {
  id: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  sub: string;
};

const CARDS: Card[] = [
  // V50.z34 — Palette semantica AdvisorOS Pro (categorie: AI/Axon viola, Comunicazioni arancione, Documenti verde)
  // AI & Axon
  // V50.z249 — spostato qui da Profilo & Impostazioni (nome/voce/tono assistente, header tabelle, memoria «cosa sa di me», Le mie aree)
  { id: "axon-settings", href: "/impostazioni?section=axon", icon: "settings", color: "#7C3AED",
    title: "⚙️ Assistente & Header tabella", sub: "Nome, voce, tono di AxonOS · intestazione tabelle · memoria personale · Le mie aree" },
  { id: "ai-teach", href: "/ai-teach", icon: "sparkles", color: "#7C3AED",
    title: "✨ Insegna ad Axon", sub: "Regole per categoria + fonti URL con aggiornamento Tavily" },
  { id: "documenti-axon", href: "/documenti-axon", icon: "library", color: "#7C3AED",
    title: "📄 Documenti Axon", sub: "PDF (contratti, listini, brochure) letti da Axon" },
  { id: "axon-brain", href: "/axon-brain", icon: "sparkles", color: "#7C3AED",
    title: "🧠 Cervello Axon", sub: "Memoria distillata e profilo appreso dalle chat" },
  { id: "axon-memory", href: "/axon-memory", icon: "eye", color: "#7C3AED",
    title: "👁️ Cosa sa Axon di me", sub: "La tua memoria personale: vedi, correggi o cancella ogni voce" },
  { id: "axon-insights", href: "/axon-insights", icon: "school", color: "#7C3AED",
    title: "🎓 Autoapprendimento", sub: "Insight anonimizzati dalle conversazioni · revisione e cancellazione" },
  { id: "axon-scripts", href: "/axon-scripts", icon: "library", color: "#7C3AED",
    title: "📚 Playbook Script", sub: "Libreria script vincenti · modello di Axon" },
  { id: "axon-cheatsheet", href: "/axon-cheatsheet", icon: "analytics", color: "#7C3AED",
    title: "📊 Cheat Sheet Fornitori", sub: "Prezzi medi visti nelle tue bollette" },
  { id: "neo-memory", href: "/neo-memory", icon: "hardware-chip", color: "#7C3AED",
    title: "💾 Memoria Assistente", sub: "Consulta o cancella cosa ricorda l'assistente" },
  { id: "wake-word", href: "/wake-word", icon: "mic", color: "#7C3AED",
    title: "🎙️ Wake Word \"Axon\"", sub: "Ascolto continuo per attivare Axon a voce" },
  { id: "axon-alarms", href: "/axon-alarms", icon: "alarm", color: "#7C3AED",
    title: "⏰ Timer & Sveglie", sub: "Sveglie, timer e promemoria in-app" },
  { id: "axon-homeassistant", href: "/axon-homeassistant", icon: "home", color: "#7C3AED",
    title: "🏠 Home Assistant", sub: "Controlla luci, tapparelle, serrature" },
  { id: "axon-system", href: "/axon-system", icon: "pulse", color: "#7C3AED",
    title: "🛰️ Stato sistema", sub: "Cosa vede Axon del backend: versioni app, novità, eventi, job, errori" },
  // Comunicazioni
  { id: "outlook", href: "/outlook", icon: "mail", color: "#F97316",
    title: "📧 Outlook (Microsoft)", sub: "Collega la casella e leggi le mail con Axon" },
  { id: "email-accounts", href: "/email-accounts", icon: "mail-unread", color: "#F97316",
    title: "📧 Caselle Email (IMAP)", sub: "Aruba, Gmail, Register, Libero, Yahoo · multi-account" },
  { id: "mail-crm-proposals", href: "/mail-crm-proposals", icon: "sparkles", color: "#F97316",
    title: "🤖 Auto-CRM da Mail", sub: "Axon riconosce clienti, salva allegati, aggiorna anagrafica" },
  // Amministrazione
  { id: "help-center", href: "/help-center", icon: "shield-checkmark", color: HT.text2,
    title: "🛡️ HELP CENTER", sub: "Termini d'uso · richiedi cancellazione dei tuoi dati" },
];

export default function AxonHubScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  // V50.z20 — Badge campanellino: contatore avvisi Axon non letti
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const r = await api<{ unread: number }>("/axon-alerts/unread-count");
        setUnreadAlerts(r?.unread || 0);
      } catch { /* ignore */ }
    })();
  }, []));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="axon-hub-back">
          <Ionicons name="chevron-back" size={24} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Axon Center</Text>
        {/* V50.z20 — Campanellino con badge unread */}
        <Pressable
          onPress={() => router.push("/axon-alerts" as any)}
          hitSlop={10}
          style={styles.bellBtn}
          testID="axon-alerts-bell"
        >
          <Ionicons name="notifications" size={22} color={HT.text} />
          {unreadAlerts > 0 ? (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeTxt}>{unreadAlerts > 9 ? "9+" : String(unreadAlerts)}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: pagePad }}>
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <Ionicons name="sparkles" size={22} color="#FF6B35" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Il centro di comando di Axon</Text>
            <Text style={styles.introSub}>
              Tutte le funzioni per insegnare, personalizzare e usare Axon: regole, documenti,
              script, memoria, sveglie e domotica.
            </Text>
          </View>
        </View>
        {(() => {
          // V50.z34 — Raggruppa le card per colore/categoria con header visivi.
          const groups: { label: string; icon: any; color: string; items: Card[] }[] = [
            { label: "AI & Axon",       icon: "sparkles",         color: "#7C3AED", items: CARDS.filter(c => c.color === "#7C3AED") },
            { label: "Comunicazioni",   icon: "mail",             color: "#F97316", items: CARDS.filter(c => c.color === "#F97316") },
            { label: "Amministrazione", icon: "shield-checkmark", color: HT.text2, items: CARDS.filter(c => c.color === HT.text2) },
          ];
          return groups.filter(g => g.items.length > 0).map((g) => (
            <View key={g.label}>
              <View style={styles.catHeader}>
                <View style={[styles.catBadge, { backgroundColor: g.color + "22" }]}>
                  <Ionicons name={g.icon} size={13} color={g.color} />
                </View>
                <Text style={[styles.catLabel, { color: g.color }]}>{g.label}</Text>
                <View style={[styles.catLine, { backgroundColor: g.color + "33" }]} />
              </View>
              {g.items.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(c.href as any)}
                  style={styles.card}
                  testID={`hub-${c.id}`}
                >
                  <View style={[styles.iconBox, { backgroundColor: `${c.color}20` }]}>
                    <Ionicons name={c.icon} size={24} color={c.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <Text style={styles.cardSub} numberOfLines={2}>{c.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={HT.muted} />
                </Pressable>
              ))}
            </View>
          ));
        })()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: HT.border,
    backgroundColor: HT.card,
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  // V50.z20 — Campanellino notifiche
  bellBtn: {
    width: 34, height: 34, alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  bellBadge: {
    position: "absolute", top: 2, right: 0,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#DC2626', alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4, borderWidth: 2, borderColor: HT.card,
  },
  bellBadgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  intro: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: HT.brandTint, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: HT.brandLine, marginBottom: 6,
  },
  introIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center",
  },
  introTitle: { fontSize: 14, fontWeight: "800", color: "#FDBA74" },
  introSub: { fontSize: 12, color: "#FDBA74", marginTop: 4, lineHeight: 18 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: HT.card, padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: HT.border,
  },
  iconBox: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  cardSub: { fontSize: 12, color: HT.muted, marginTop: 3, lineHeight: 17 },
  // V50.z34 — Header categoria (badge + label + linea)
  catHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, marginBottom: 8, paddingHorizontal: 4 },
  catBadge: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  catLine: { flex: 1, height: 2, borderRadius: 1, marginLeft: 4 },
});

// V50.z106 — PROMPT 29: Schermata Sicurezza AdvisorOS (informativa)
// Accessibile da Menu Master → area Help e durante il tour di onboarding.

import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";

type Item = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; iconColor: string };

const PROTECTION_ITEMS: Item[] = [
  { icon: "lock-closed", iconColor: "#3B82F6", title: "Connessione sempre cifrata", body: "Tutti i dati viaggiano protetti da HTTPS in ogni momento, su qualsiasi dispositivo." },
  { icon: "server", iconColor: "#3B82F6", title: "Dati cifrati sul server", body: "Tutte le informazioni dei tuoi clienti sono protette con standard bancario AES-256." },
  { icon: "cloud-done", iconColor: "#10B981", title: "Backup automatici", body: "Il database viene salvato automaticamente ogni ora, ogni giorno, ogni settimana e ogni mese. Recovery possibile fino a 7 giorni indietro al minuto esatto." },
  { icon: "key", iconColor: "#F59E0B", title: "Credenziali protette", body: "Le integrazioni esterne sono cifrate con chiave unica dedicata e monitoraggio manomissioni attivo." },
  { icon: "shield-checkmark", iconColor: "#8B5CF6", title: "Server sempre aggiornato", body: "L'infrastruttura si aggiorna automaticamente contro le nuove minacce senza interruzioni del servizio." },
  { icon: "checkmark-done", iconColor: "#10B981", title: "Avvio verificato", body: "Il sistema parte solo da software certificato e non manomesso." },
];

const USAGE_ITEMS: Item[] = [
  { icon: "finger-print", iconColor: "#EA580C", title: "Password robusta e unica", body: "Usa una password diversa e forte per il tuo account AdvisorOS. Non riutilizzarla su altri servizi." },
  { icon: "people", iconColor: "#EA580C", title: "Non condividere mai le credenziali master", body: "Crea un account separato per ogni agente o collaboratore. Ogni persona deve avere il proprio accesso." },
  { icon: "document-lock", iconColor: "#EA580C", title: "Attenzione a documenti di terzi in AxonOS", body: "Non caricare in AxonOS documenti con dati sensibili di terzi senza aver informato i tuoi clienti nel contratto di servizio." },
  { icon: "log-out", iconColor: "#EA580C", title: "Esci quando usi dispositivi condivisi", body: "Su tablet, PC o telefoni condivisi ricordati sempre di fare logout al termine dell'uso." },
  { icon: "warning", iconColor: "#DC2626", title: "Segnala comportamenti anomali", body: "Accessi non riconosciuti o messaggi sospetti vanno segnalati subito tramite il bottone Assistenza. Meglio una segnalazione in più che una in meno." },
];

export default function SecurityInfoPage() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="sec-back">
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Ionicons name="shield-checkmark" size={20} color="#3B82F6" />
          <Text style={styles.title}>Sicurezza AdvisorOS</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={36} color="#3B82F6" />
          </View>
          <Text style={styles.heroTitle}>La tua sicurezza,{"\n"}la nostra priorità.</Text>
          <Text style={styles.heroSub}>
            Ogni giorno lavoriamo per proteggere i tuoi dati e quelli dei tuoi clienti secondo gli standard più alti del settore bancario.
          </Text>
        </View>

        <SectionHeader accent="#3B82F6" icon="lock-closed" title="Come proteggiamo i tuoi dati" />
        {PROTECTION_ITEMS.map((it, i) => <SecCard key={i} item={it} testID={`prot-${i}`} />)}

        <SectionHeader accent="#EA580C" icon="bulb" title="Come usare AdvisorOS in sicurezza" style={{ marginTop: 20 }} />
        {USAGE_ITEMS.map((it, i) => <SecCard key={i} item={it} testID={`use-${i}`} />)}

        <View style={styles.footNote}>
          <Ionicons name="information-circle" size={18} color={theme.color.muted} />
          <Text style={styles.footNoteTxt}>
            Hai dubbi o vuoi segnalare qualcosa? Contattaci dal bottone Assistenza sempre disponibile nel menu principale.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, icon, accent, style }: { title: string; icon: any; accent: string; style?: any }) {
  return (
    <View style={[styles.sectionHead, style]}>
      <View style={[styles.sectionHeadIcon, { backgroundColor: accent + "22" }]}>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <Text style={styles.sectionHeadTxt}>{title}</Text>
    </View>
  );
}

function SecCard({ item, testID }: { item: Item; testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={[styles.cardIcon, { backgroundColor: item.iconColor + "18", borderColor: item.iconColor + "44" }]}>
        <Ionicons name={item.icon} size={22} color={item.iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardBody}>{item.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
    backgroundColor: theme.color.surfaceSecondary,
  },
  iconBtn: { padding: 8, width: 40 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  hero: {
    alignItems: "center", padding: 20, borderRadius: 16,
    backgroundColor: "#3B82F615", borderWidth: 1, borderColor: "#3B82F633",
    marginBottom: 16,
  },
  heroIcon: {
    width: 64, height: 64, borderRadius: 16,
    backgroundColor: "#3B82F625", alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  heroTitle: { fontSize: 20, fontWeight: "900", color: theme.color.onSurface, textAlign: "center", lineHeight: 26 },
  heroSub: { fontSize: 13, color: theme.color.muted, textAlign: "center", marginTop: 8, lineHeight: 19 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 10 },
  sectionHeadIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionHeadTxt: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface, flex: 1 },
  card: {
    flexDirection: "row", gap: 12,
    padding: 14, borderRadius: 12,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.divider,
    marginBottom: 8,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginBottom: 4 },
  cardBody: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  footNote: {
    marginTop: 20, padding: 12, borderRadius: 10,
    backgroundColor: theme.color.surfaceTertiary,
    flexDirection: "row", gap: 8, alignItems: "flex-start",
  },
  footNoteTxt: { flex: 1, fontSize: 12, color: theme.color.muted, lineHeight: 17 },
});

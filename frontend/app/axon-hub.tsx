// V50.z16 — Axon Center: hub che raggruppa tutte le funzioni Axon.
// Accessibile dal bottone "INSEGNA AD AXON" nell'area Master.
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Card = {
  id: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  sub: string;
};

const CARDS: Card[] = [
  { id: "ai-teach", href: "/ai-teach", icon: "sparkles", color: "#FF6B35",
    title: "✨ Insegna ad Axon", sub: "Regole per categoria + fonti URL con aggiornamento Tavily" },
  { id: "documenti-axon", href: "/documenti-axon", icon: "library", color: "#7C3AED",
    title: "📄 Documenti Axon", sub: "PDF (contratti, listini, brochure) letti da Axon" },
  { id: "axon-brain", href: "/axon-brain", icon: "sparkles", color: "#7C3AED",
    title: "🧠 Cervello Axon", sub: "Memoria distillata e profilo appreso dalle chat" },
  { id: "axon-scripts", href: "/axon-scripts", icon: "library", color: "#FBBF24",
    title: "📚 Playbook Script", sub: "Libreria script vincenti · modello di Axon" },
  { id: "axon-cheatsheet", href: "/axon-cheatsheet", icon: "analytics", color: "#F59E0B",
    title: "📊 Cheat Sheet Fornitori", sub: "Prezzi medi visti nelle tue bollette" },
  { id: "neo-memory", href: "/neo-memory", icon: "hardware-chip", color: "#8B5CF6",
    title: "💾 Memoria Assistente", sub: "Consulta o cancella cosa ricorda l'assistente" },
  { id: "wake-word", href: "/wake-word", icon: "mic", color: "#EA580C",
    title: "🎙️ Wake Word \"Axon\"", sub: "Ascolto continuo per attivare Axon a voce" },
  { id: "axon-alarms", href: "/axon-alarms", icon: "alarm", color: "#22C55E",
    title: "⏰ Timer & Sveglie", sub: "Sveglie, timer e promemoria in-app" },
  { id: "axon-homeassistant", href: "/axon-homeassistant", icon: "home", color: "#3B82F6",
    title: "🏠 Home Assistant", sub: "Controlla luci, tapparelle, serrature" },
  { id: "help-center", href: "/help-center", icon: "shield-checkmark", color: "#7C3AED",
    title: "🛡️ HELP CENTER", sub: "Termini d'uso · richiedi cancellazione dei tuoi dati" },
];

export default function AxonHubScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="axon-hub-back">
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Axon Center</Text>
        <View style={{ width: 30 }} />
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
        {CARDS.map((c) => (
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
            <Ionicons name="chevron-forward" size={20} color={theme.color.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
    backgroundColor: "#FFF",
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  intro: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#FFF7ED", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#FED7AA", marginBottom: 6,
  },
  introIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#FFEDD5", alignItems: "center", justifyContent: "center",
  },
  introTitle: { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  introSub: { fontSize: 12, color: "#9A3412", marginTop: 4, lineHeight: 18 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#FFF", padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: theme.color.border,
  },
  iconBox: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  cardSub: { fontSize: 12, color: theme.color.muted, marginTop: 3, lineHeight: 17 },
});

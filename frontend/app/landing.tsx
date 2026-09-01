/**
 * V49.c — Landing / Onboarding page pubblica.
 *
 * Redesign completo: mostra i loghi AdvisorOS e AxonOS in evidenza, presenta
 * il pitch aziendale (CRM + AxonOS AI) e termina con un CTA prominente "ENTRA"
 * che porta alla schermata di login. Il layout è single-column, responsive,
 * pensato sia per desktop (max-width 900) che per mobile.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
  Platform,
  Linking,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

// Loghi ufficiali (asset già presenti nel bucket customer-assets)
const ADVISOROS_LOGO_URI =
  "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/b7768fd1220b4979bff6466c01714e12_AdvisorOS_App_Logo__5_-fotor-20260826112335-removebg-preview%20-1-.png";
const AXONOS_LOGO_URI =
  "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/eaad7f8d5fbe44b196a4fb03d5a181c9_AxonOS_logo-cropped-removebg-preview.png";

// Card blocchi feature (icona, titolo, corpo)
const FEATURE_BLOCKS: Array<{
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  tint: string;
  bg: string;
}> = [
  {
    icon: "people",
    title: "GESTISCI I TUOI CLIENTI COME UN PROFESSIONISTA",
    body:
      "Schede cliente complete con contatti, note, aree di appartenenza, referenze e storico di tutte le interazioni. Tutto in un tap, sempre con te.",
    tint: "#FF6B35",
    bg: "#FFF1E9",
  },
  {
    icon: "chatbubbles",
    title: "COMUNICA PIÙ VELOCE",
    body:
      "Script di chiamata pronti all'uso, messaggi WhatsApp precompilati con il numero del cliente, biglietto da visita digitale condivisibile via QR code. Ogni interazione diventa più efficace.",
    tint: "#16A34A",
    bg: "#DCFCE7",
  },
  {
    icon: "git-network",
    title: "ORGANIZZA IL TUO TEAM",
    body:
      "Invita collaboratori e clienti con ruoli definiti. Chat nativa per conversazioni sicure. Monitora le performance con report e statistiche in tempo reale. La tua rete sotto controllo, ovunque tu sia.",
    tint: "#0EA5E9",
    bg: "#DBEAFE",
  },
];

export default function LandingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 720;

  const openMail = () => {
    const url = "mailto:info@advisoros.it";
    if (Platform.OS === "web") {
      try {
        (globalThis as any).window.open(url, "_blank");
      } catch {
        /* noop */
      }
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const goLogin = () => router.push("/login" as any);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* ─────────────── HERO: loghi + titolo ─────────────── */}
      <View style={styles.hero}>
        <View style={styles.container}>
          <View style={[styles.logosWrap, isCompact && styles.logosWrapCompact]}>
            <Image
              source={{ uri: ADVISOROS_LOGO_URI }}
              style={[styles.brandLogo, isCompact && styles.brandLogoSmall]}
              resizeMode="contain"
              accessibilityLabel="AdvisorOS"
            />
            <View style={[styles.logoDivider, isCompact && styles.logoDividerH]} />
            <Image
              source={{ uri: AXONOS_LOGO_URI }}
              style={[styles.brandLogoAxon, isCompact && styles.brandLogoAxonSmall]}
              resizeMode="contain"
              accessibilityLabel="AxonOS"
            />
          </View>

          <Text
            style={[styles.heroTitle, isCompact && styles.heroTitleSmall]}
            accessibilityRole="header"
          >
            AdvisorOS
          </Text>
          <Text style={[styles.heroTagline, isCompact && styles.heroTaglineSmall]}>
            Il CRM che si evolve con te
          </Text>
          <View style={styles.heroBadge}>
            <Ionicons name="rocket" size={14} color="#FF6B35" />
            <Text style={styles.heroBadgeTxt}>
              La nostra risposta: prepararci al futuro
            </Text>
          </View>
        </View>
      </View>

      {/* ─────────────── INTRO paragrafo ─────────────── */}
      <View style={styles.section}>
        <View style={styles.container}>
          <Text style={styles.intro}>
            Dimentica i fogli Excel, le note sparse, le cento app esterne e i CRM
            complicati pensati in modo verticale, dove sei sempre tu ad adeguarti.
          </Text>
          <Text style={styles.intro}>
            <Text style={{ fontWeight: "800", color: "#0F2438" }}>AdvisorOS</Text>{" "}
            è stato costruito per chi vende, chi consulta, per agenzie e per chi
            gestisce una rete di persone ogni giorno, dal telefono, dal tablet o
            dal PC. Su tutti i sistemi operativi.
          </Text>
        </View>
      </View>

      {/* ─────────────── Feature blocks ─────────────── */}
      <View style={[styles.section, styles.featSection]}>
        <View style={styles.container}>
          {FEATURE_BLOCKS.map((f) => (
            <View key={f.title} style={styles.featCard}>
              <View style={[styles.featIcon, { backgroundColor: f.bg }]}>
                <Ionicons name={f.icon} size={22} color={f.tint} />
              </View>
              <Text style={[styles.featTitle, { color: f.tint }]}>{f.title}</Text>
              <Text style={styles.featBody}>{f.body}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ─────────────── AxonOS deep dive ─────────────── */}
      <View style={[styles.section, styles.axonSection]}>
        <View style={styles.container}>
          <View style={styles.axonHeader}>
            <Image
              source={{ uri: AXONOS_LOGO_URI }}
              style={[styles.axonLogo, isCompact && styles.axonLogoSmall]}
              resizeMode="contain"
              accessibilityLabel="AxonOS"
            />
            <Text style={styles.axonTitle}>
              L&apos;ASSISTENTE AI CHE CONOSCE IL TUO BUSINESS
            </Text>
          </View>
          <Text style={styles.axonBody}>
            Non è un chatbot generico. È un assistente virtuale che addestri tu,
            con le tue regole, i tuoi documenti, il tuo linguaggio. Adattivo e
            responsivo. Profila clienti e collaboratori, impara dal tuo modo di
            lavorare e risponde come lo faresti tu, 24 ore su 24.
          </Text>
        </View>
      </View>

      {/* ─────────────── Sempre connesso ─────────────── */}
      <View style={styles.section}>
        <View style={styles.container}>
          <View style={styles.pillHdr}>
            <Ionicons name="cloud-done" size={18} color="#7C3AED" />
            <Text style={styles.pillHdrTxt}>SEMPRE CONNESSO AL TUO LAVORO</Text>
          </View>
          <Text style={styles.intro}>
            AdvisorOS ti permette di collegare i tuoi servizi cloud preferiti,
            tenendo AxonOS sempre sincronizzato con i tuoi documenti di lavoro.
            Risposte sempre più precise, aggiornate e veloci, perché il tuo
            assistente cresce insieme a te.
          </Text>
        </View>
      </View>

      {/* ─────────────── Chiusura + CTA ENTRA ─────────────── */}
      <View style={[styles.section, styles.ctaBand]}>
        <View style={styles.container}>
          <Text style={styles.closingBig}>
            Per consulenti, agenzie e network che vogliono crescere.
          </Text>
          <Text style={styles.closingAccent}>
            Non un CRM come gli altri.
          </Text>
          <Text style={styles.closingHighlight}>Il tuo CRM.</Text>

          <Pressable
            onPress={goLogin}
            style={({ pressed }) => [
              styles.enterBtn,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
            testID="landing-enter-btn"
            accessibilityRole="button"
            accessibilityLabel="Entra in AdvisorOS"
          >
            <Text style={styles.enterBtnTxt}>ENTRA</Text>
            <Ionicons name="arrow-forward" size={26} color="#FFF" />
          </Pressable>

          <Text style={styles.enterSub}>
            Accedi al tuo account o richiedi una demo gratuita.
          </Text>
        </View>
      </View>

      {/* ─────────────── Footer ─────────────── */}
      <View style={styles.footer}>
        <View style={styles.container}>
          <Text style={styles.footerBrand}>AdvisorOS · AxonOS</Text>
          <Text style={styles.footerTxt}>
            © 2026 AdvisorOS — CRM per consulenti, agenzie e network
          </Text>
          <View style={styles.footerLinks}>
            <Pressable onPress={openMail}>
              <Text style={styles.footerLink}>info@advisoros.it</Text>
            </Pressable>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={goLogin}>
              <Text style={styles.footerLink}>Accedi</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" },
  scroll: { flexGrow: 1 },

  section: { paddingVertical: 32 },
  container: {
    maxWidth: 900,
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 22,
  },

  // ── Hero ──
  hero: {
    paddingTop: 48,
    paddingBottom: 24,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  logosWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginBottom: 20,
  },
  logosWrapCompact: {
    flexDirection: "column",
    gap: 14,
  },
  brandLogo: { width: 240, height: 68 },
  brandLogoSmall: { width: 220, height: 62 },
  brandLogoAxon: { width: 200, height: 56 },
  brandLogoAxonSmall: { width: 200, height: 56 },
  logoDivider: {
    width: 1,
    height: 46,
    backgroundColor: "#CBD5E1",
  },
  logoDividerH: {
    width: 60,
    height: 1,
  },
  heroTitle: {
    fontSize: 44,
    fontWeight: "900",
    color: "#0F2438",
    letterSpacing: -1.2,
    textAlign: "center",
  },
  heroTitleSmall: { fontSize: 34, letterSpacing: -0.8 },
  heroTagline: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FF6B35",
    letterSpacing: -0.3,
    textAlign: "center",
    marginTop: 4,
  },
  heroTaglineSmall: { fontSize: 18 },
  heroBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#FFF1E9",
    marginTop: 14,
  },
  heroBadgeTxt: {
    color: "#FF6B35",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.2,
  },

  // ── Intro / paragraphs ──
  intro: {
    fontSize: 16,
    color: "#334155",
    lineHeight: 26,
    marginBottom: 14,
    textAlign: "left",
  },

  // ── Feature cards ──
  featSection: {
    backgroundColor: "#F8FAFC",
    borderTopWidth: 1,
    borderTopColor: "#EEF0F4",
    borderBottomWidth: 1,
    borderBottomColor: "#EEF0F4",
  },
  featCard: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 22,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#EEF0F4",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  featIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  featTitle: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  featBody: { fontSize: 15, color: "#475569", lineHeight: 22 },

  // ── AxonOS section ──
  axonSection: {
    backgroundColor: "#0F2438",
  },
  axonHeader: {
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  axonLogo: { width: 220, height: 60 },
  axonLogoSmall: { width: 160, height: 42 },
  axonTitle: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.4,
    color: "#FFF",
    textAlign: "center",
  },
  axonBody: {
    fontSize: 15,
    color: "rgba(255,255,255,0.85)",
    lineHeight: 24,
    textAlign: "center",
  },

  // ── Pill header (Sempre connesso) ──
  pillHdr: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#EDE9FE",
    marginBottom: 14,
  },
  pillHdrTxt: {
    color: "#7C3AED",
    fontWeight: "900",
    letterSpacing: 0.4,
    fontSize: 13,
  },

  // ── CTA finale ──
  ctaBand: {
    backgroundColor: "#FFF1E9",
    borderTopWidth: 1,
    borderTopColor: "#FBD5B5",
    paddingBottom: 44,
    paddingTop: 40,
  },
  closingBig: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F2438",
    textAlign: "center",
    lineHeight: 28,
  },
  closingAccent: {
    fontSize: 18,
    fontWeight: "700",
    color: "#475569",
    textAlign: "center",
    marginTop: 10,
  },
  closingHighlight: {
    fontSize: 28,
    fontWeight: "900",
    color: "#FF6B35",
    textAlign: "center",
    letterSpacing: -0.5,
    marginTop: 6,
    marginBottom: 26,
  },
  enterBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    minWidth: 260,
    paddingHorizontal: 34,
    paddingVertical: 20,
    borderRadius: 999,
    backgroundColor: "#FF6B35",
    shadowColor: "#FF6B35",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  enterBtnTxt: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 3,
  },
  enterSub: {
    color: "#64748B",
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },

  // ── Footer ──
  footer: { backgroundColor: "#0F2438", paddingVertical: 30 },
  footerBrand: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  footerTxt: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
  },
  footerLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  footerLink: { color: "#FF6B35", fontWeight: "800", fontSize: 13 },
  footerDot: { color: "rgba(255,255,255,0.4)" },
});

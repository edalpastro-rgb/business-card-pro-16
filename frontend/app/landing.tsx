/**
 * V29.ak — Landing page pubblica per advisoros.it
 *
 * Vetrina marketing separata dall'app, accessibile via /landing (o direttamente
 * dal dominio radice per utenti non autenticati). Presenta AdvisorOS con:
 *  - Hero: brand + tagline + CTA Play Store / App Store / "Prova su web"
 *  - Feature grid (4 punti chiave: CRM, AI Axon, Google Drive, Multi-tenant)
 *  - Screenshot mock (device-frame) delle schermate principali
 *  - Footer con contatti / policy
 *
 * Layout responsive: max-width 1180px centrato su desktop, single-column su mobile.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, Image, ScrollView, Platform, Linking, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const ADVISOROS_LOGO_URI = "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/b7768fd1220b4979bff6466c01714e12_AdvisorOS_App_Logo__5_-fotor-20260826112335-removebg-preview%20-1-.png";
const AXONOS_LOGO_URI = "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/eaad7f8d5fbe44b196a4fb03d5a181c9_AxonOS_logo-cropped-removebg-preview.png";

// URL Store — sostituire con quelli reali una volta pubblicati
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.advisoros";
const APP_STORE_URL = "https://apps.apple.com/app/advisoros";

const FEATURES = [
  {
    icon: "people" as const,
    title: "CRM per consulenti & network",
    body: "Gestisci contatti, referenze, appuntamenti e scadenze in un'unica app pensata per la vendita porta-a-porta e la rete di collaboratori.",
  },
  {
    icon: "sparkles" as const,
    title: "Axon, assistente AI integrato",
    body: "Chiedi ad Axon script di chiamata, analisi PUN, riassunti bollette. Le azioni rapide sono in cache e sempre aggiornate dalle tue regole.",
  },
  {
    icon: "cloud" as const,
    title: "Google Drive collegato",
    body: "Allega documenti, tariffari e file di supporto direttamente dal tuo Drive personale. Sincronizzazione sicura e crittografata.",
  },
  {
    icon: "shield-checkmark" as const,
    title: "Multi-tenant sicuro",
    body: "Ogni collaboratore ha il suo spazio isolato. Il Master vede tutto, gli agenti solo i propri clienti. Ruoli e permessi granulari.",
  },
];

export default function LandingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;

  const openUrl = (url: string) => {
    if (Platform.OS === "web") { try { (globalThis as any).window.open(url, "_blank"); } catch { /* noop */ } }
    else Linking.openURL(url).catch(() => {});
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Nav top */}
      <View style={styles.nav}>
        <View style={styles.navInner}>
          <Image source={{ uri: ADVISOROS_LOGO_URI }} style={styles.navLogo} resizeMode="contain" />
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.push("/login" as any)} style={styles.navLink}>
            <Text style={styles.navLinkTxt}>Accedi</Text>
          </Pressable>
        </View>
      </View>

      {/* Hero */}
      <View style={[styles.section, styles.hero]}>
        <View style={[styles.container, isDesktop && styles.heroRow]}>
          <View style={{ flex: 1, gap: 20 }}>
            <View style={styles.heroBadge}>
              <Ionicons name="sparkles" size={13} color="#FF6B35" />
              <Text style={styles.heroBadgeTxt}>Nuova versione 2026</Text>
            </View>
            <Text style={styles.heroTitle}>
              Il CRM smart per {"\n"}
              <Text style={{ color: "#FF6B35" }}>consulenti e network</Text>
            </Text>
            <Text style={styles.heroSub}>
              Contatti, agenda, script telefonici, referenze, scadenze e un assistente AI
              che ti fa risparmiare ore ogni giorno. Tutto in mano, sempre.
            </Text>
            <View style={styles.ctaRow}>
              <Pressable onPress={() => openUrl(PLAY_STORE_URL)} style={styles.storeBtn}>
                <Ionicons name="logo-google-playstore" size={22} color="#FFF" />
                <View>
                  <Text style={styles.storeSmall}>Scarica su</Text>
                  <Text style={styles.storeBig}>Google Play</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => openUrl(APP_STORE_URL)} style={styles.storeBtn}>
                <Ionicons name="logo-apple" size={22} color="#FFF" />
                <View>
                  <Text style={styles.storeSmall}>Scaricala dall&apos;</Text>
                  <Text style={styles.storeBig}>App Store</Text>
                </View>
              </Pressable>
            </View>
            <Pressable onPress={() => router.push("/login" as any)} style={styles.webCta}>
              <Text style={styles.webCtaTxt}>Oppure prova subito da browser →</Text>
            </Pressable>
          </View>
          {isDesktop && (
            <View style={styles.heroArtWrap}>
              <View style={styles.phoneFrame}>
                <Image source={{ uri: ADVISOROS_LOGO_URI }} style={styles.phoneLogo} resizeMode="contain" />
                <Text style={styles.phoneLbl}>AdvisorOS</Text>
                <Text style={styles.phoneSub}>CRM per consulenti e network</Text>
                <View style={styles.phonePreviewCard}>
                  <View style={styles.phoneRow}><View style={styles.phoneAvatar} /><View style={{ flex: 1, gap: 4 }}><View style={styles.phoneLine} /><View style={[styles.phoneLine, { width: "60%" }]} /></View></View>
                  <View style={styles.phoneRow}><View style={styles.phoneAvatar} /><View style={{ flex: 1, gap: 4 }}><View style={styles.phoneLine} /><View style={[styles.phoneLine, { width: "45%" }]} /></View></View>
                  <View style={styles.phoneRow}><View style={styles.phoneAvatar} /><View style={{ flex: 1, gap: 4 }}><View style={styles.phoneLine} /><View style={[styles.phoneLine, { width: "70%" }]} /></View></View>
                </View>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Feature grid */}
      <View style={styles.section}>
        <View style={styles.container}>
          <Text style={styles.sectionTitle}>Tutto quello che ti serve, in tasca</Text>
          <Text style={styles.sectionSub}>Progettato per chi vive sul campo</Text>
          <View style={[styles.featGrid, isDesktop && styles.featGridDesktop]}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[styles.featCard, isDesktop && { width: "48%" }]}>
                <View style={styles.featIcon}><Ionicons name={f.icon} size={22} color="#FF6B35" /></View>
                <Text style={styles.featTitle}>{f.title}</Text>
                <Text style={styles.featBody}>{f.body}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Screenshots band */}
      <View style={[styles.section, { backgroundColor: "#0F2438" }]}>
        <View style={styles.container}>
          <Text style={[styles.sectionTitle, { color: "#FFF" }]}>Uno sguardo dentro</Text>
          <Text style={[styles.sectionSub, { color: "rgba(255,255,255,0.7)" }]}>
            Home, contatti, Axon chat, scadenze — tutto pensato per il thumb-first
          </Text>
          <View style={[styles.shotsRow, isDesktop && { flexDirection: "row", justifyContent: "center", gap: 22 }]}>
            {[
              { title: "Home", sub: "Saluto, Master, scadenze" },
              { title: "Contatti", sub: "Filtri, ricerca, tag" },
              { title: "Axon AI", sub: "Chat + azioni rapide" },
            ].map((s) => (
              <View key={s.title} style={styles.mockShot}>
                <View style={styles.mockNotch} />
                <View style={styles.mockScreen}>
                  <Text style={styles.mockTitle}>{s.title}</Text>
                  <Text style={styles.mockSub}>{s.sub}</Text>
                  {[1, 2, 3, 4].map((k) => (
                    <View key={k} style={styles.mockLine}>
                      <View style={styles.mockCircle} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={styles.mockBar} />
                        <View style={[styles.mockBar, { width: "60%", opacity: 0.6 }]} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Powered by AxonOS */}
      <View style={styles.section}>
        <View style={[styles.container, { alignItems: "center", gap: 14 }]}>
          <Image source={{ uri: AXONOS_LOGO_URI }} style={{ width: 180, height: 40 }} resizeMode="contain" />
          <Text style={styles.poweredTxt}>
            AxonOS è il motore AI conversazionale che alimenta l&apos;assistente Axon dentro AdvisorOS.
            Analizza, consiglia, agisce — senza mai chiederti di caricare nulla.
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.container}>
          <Text style={styles.footerBrand}>AdvisorOS</Text>
          <Text style={styles.footerTxt}>© 2026 AdvisorOS — CRM per consulenti e network</Text>
          <View style={styles.footerLinks}>
            <Pressable onPress={() => openUrl("mailto:info@advisoros.it")}>
              <Text style={styles.footerLink}>info@advisoros.it</Text>
            </Pressable>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => router.push("/login" as any)}>
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
  nav: { backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#EEF0F4" },
  navInner: { maxWidth: 1180, alignSelf: "center", width: "100%", paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", alignItems: "center" },
  navLogo: { width: 140, height: 28 },
  navLink: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#FFF1E9" },
  navLinkTxt: { color: "#FF6B35", fontWeight: "800" },
  section: { paddingVertical: 40 },
  container: { maxWidth: 1180, alignSelf: "center", width: "100%", paddingHorizontal: 20 },
  hero: { paddingVertical: 60 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 40 },
  heroBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#FFF1E9" },
  heroBadgeTxt: { color: "#FF6B35", fontWeight: "800", fontSize: 12, letterSpacing: 0.2 },
  heroTitle: { fontSize: 44, fontWeight: "900", color: "#0F2438", letterSpacing: -1, lineHeight: 52 },
  heroSub: { fontSize: 16, color: "#475569", lineHeight: 24, maxWidth: 520 },
  ctaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6 },
  storeBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: "#0F2438" },
  storeSmall: { color: "rgba(255,255,255,0.7)", fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" },
  storeBig: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  webCta: { alignSelf: "flex-start", marginTop: 6 },
  webCtaTxt: { color: "#FF6B35", fontWeight: "800", fontSize: 14 },
  heroArtWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  phoneFrame: { width: 300, aspectRatio: 9 / 17, borderRadius: 34, backgroundColor: "#0F2438", padding: 22, alignItems: "center", justifyContent: "flex-start", gap: 8, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
  phoneLogo: { width: 180, height: 40, marginTop: 6 },
  phoneLbl: { color: "#FFF", fontWeight: "900", fontSize: 20, letterSpacing: -0.4 },
  phoneSub: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "700" },
  phonePreviewCard: { width: "100%", marginTop: 16, backgroundColor: "#FFF", borderRadius: 16, padding: 12, gap: 10 },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  phoneAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#FFF1E9" },
  phoneLine: { height: 8, borderRadius: 4, backgroundColor: "#E2E8F0", width: "80%" },
  sectionTitle: { fontSize: 30, fontWeight: "900", color: "#0F2438", letterSpacing: -0.6, textAlign: "center" },
  sectionSub: { fontSize: 14, color: "#64748B", textAlign: "center", marginTop: 8, marginBottom: 26 },
  featGrid: { gap: 14 },
  featGridDesktop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  featCard: { padding: 20, borderRadius: 16, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#EEF0F4", gap: 10 },
  featIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#FFF1E9", alignItems: "center", justifyContent: "center" },
  featTitle: { fontSize: 17, fontWeight: "900", color: "#0F2438", letterSpacing: -0.2 },
  featBody: { fontSize: 14, color: "#475569", lineHeight: 20 },
  shotsRow: { gap: 20, alignItems: "center", marginTop: 10 },
  mockShot: { width: 240, aspectRatio: 9 / 18, backgroundColor: "#0B1220", borderRadius: 30, padding: 12 },
  mockNotch: { width: 90, height: 6, backgroundColor: "#334155", borderRadius: 3, alignSelf: "center", marginBottom: 8 },
  mockScreen: { flex: 1, backgroundColor: "#FFF", borderRadius: 20, padding: 14, gap: 10 },
  mockTitle: { fontSize: 18, fontWeight: "900", color: "#0F2438" },
  mockSub: { fontSize: 11, color: "#64748B", marginTop: -6 },
  mockLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  mockCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFF1E9" },
  mockBar: { height: 6, borderRadius: 3, backgroundColor: "#E2E8F0" },
  poweredTxt: { color: "#475569", fontSize: 14, textAlign: "center", maxWidth: 600, lineHeight: 22 },
  footer: { backgroundColor: "#0F2438", paddingVertical: 30 },
  footerBrand: { color: "#FFF", fontSize: 20, fontWeight: "900", letterSpacing: -0.4, textAlign: "center" },
  footerTxt: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", marginTop: 6 },
  footerLinks: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 14 },
  footerLink: { color: "#FF6B35", fontWeight: "800", fontSize: 13 },
  footerDot: { color: "rgba(255,255,255,0.4)" },
});

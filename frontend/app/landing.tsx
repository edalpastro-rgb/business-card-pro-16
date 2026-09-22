/**
 * V50.z312 — Landing pubblica (redesign totale, design_guidelines.json «Glass / Luxe DARK»).
 *
 * Header senza loghi né titoli: resta SOLO la frase «La nostra risposta: prepararci al futuro»,
 * 2 slogan, il cuore Axon animato e il CTA ENTRA. Poi: mantra «IA aggiunta vs Axon NEL CRM»
 * (privacy: i dati restano solo tuoi), Modulistica (autocompilazione da foto/PDF),
 * Pronto all'uso (OS proprietario, aree preconfigurate su richiesta), Modularità (blocchi
 * attivabili), CTA finale, footer. Effetti: src/landing/LandingFx.tsx.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Linking, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { LP } from "@/src/landing/palette";
import { AxonOrb, Aurora, RotatingWord, Reveal, LiveDot } from "@/src/landing/LandingFx";
import { AppDemoPlayer } from "@/src/landing/AppDemoPlayer";
import { DemoRequestForm } from "@/src/landing/DemoRequestForm";

import { LANDING_SEEN_KEY } from "@/src/landing/landingSeen";
// V50.z330 — URL pubblico di AxonOS Lite (configurabile da .env; default alla pagina Lite del sito)
const LITE_URL = process.env.EXPO_PUBLIC_LITE_URL || "https://advisoros.it/lite"; // V50.z314 — su telefono la landing si mostra solo al primo avvio

type IonName = React.ComponentProps<typeof Ionicons>["name"];

const ROTATING = ["compila", "ricorda", "risponde", "protegge", "esegue"];

const STD_AI = [
  "Vede solo quello che le incolli",
  "I tuoi dati viaggiano verso server di terzi",
  "Risponde in generale, non sa chi è il tuo cliente",
  "Un'app in più da aprire",
];
const AXON_AI = [
  "Conosce ogni schermata, ogni cliente, ogni contratto",
  "I dati restano solo ed esclusivamente tuoi",
  "Agisce: compila, apre, ricorda, esegue",
  "È già dentro: chat e voce, anche a mani libere",
];

const DOC_INPUTS: { icon: IonName; label: string; out: string }[] = [
  { icon: "document-text", label: "Bolletta", out: "POD, consumi, fornitore, potenza" },
  { icon: "card", label: "Documento d'identità", out: "Anagrafica completa del cliente" },
  { icon: "create", label: "Contratto firmato", out: "Archiviato nella scheda cliente" },
];

const STEPS = [
  { n: "01", t: "Ci racconti come lavori", d: "Regole, documenti, modulistica, aree che ti servono." },
  { n: "02", t: "Prepariamo Axon per la tua azienda", d: "Addestrato sulle tue regole, aree già configurate e testate." },
  { n: "03", t: "Parti operativo dal primo giorno", d: "Nessun bug da scoprire, nessuna configurazione. Solo lavoro." },
];

const MODULES: { key: string; icon: IonName; label: string; on: boolean }[] = [
  { key: "clienti", icon: "people", label: "Clienti", on: true },
  { key: "agenda", icon: "calendar", label: "Agenda & richiamate", on: true },
  { key: "contratti", icon: "document-text", label: "Contratti", on: true },
  { key: "bollette", icon: "scan", label: "Bollette OCR", on: true },
  { key: "corsi", icon: "school", label: "Area Corsi", on: false },
  { key: "gym", icon: "barbell", label: "Palestra aziendale", on: false },
  { key: "team", icon: "podium", label: "Team & KPI", on: false },
  { key: "cloud", icon: "cloud", label: "Drive / Dropbox", on: false },
];

export default function LandingScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const compact = width < 720;
  const [mods, setMods] = useState<Record<string, boolean>>(() => Object.fromEntries(MODULES.map((m) => [m.key, m.on])));
  const activeCount = Object.values(mods).filter(Boolean).length;

  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const demoY = useRef(0);
  useEffect(() => { AsyncStorage.setItem(LANDING_SEEN_KEY, "1").catch(() => {}); }, []);
  const goLogin = () => router.push("/login" as any);
  const goDemo = () => scrollRef.current?.scrollTo({ y: Math.max(0, demoY.current - 12), animated: true });
  const openLite = () => {
    if (Platform.OS === "web") {
      try { (globalThis as any).window.open(LITE_URL, "_blank"); return; } catch { /* noop */ }
    }
    Linking.openURL(LITE_URL).catch(() => {});
  };
  const openMail = () => {
    const url = "mailto:info@advisoros.it";
    if (Platform.OS === "web") {
      try { (globalThis as any).window.open(url, "_blank"); } catch { /* noop */ }
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <ScrollView ref={scrollRef} style={s.root} contentContainerStyle={[s.scroll, { paddingTop: insets.top, paddingBottom: insets.bottom }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* ───────────── HERO ───────────── */}
      <View style={[s.hero, { minHeight: Math.max(620, height * 0.92) }]} testID="landing-hero">
        <Aurora />
        <LinearGradient colors={[LP.scrim, LP.scrim, LP.scrimEnd]} locations={[0, 0.7, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={s.container}>
          <Reveal delay={100} style={{ alignItems: "center" }}>
            <View style={s.eyebrow} testID="landing-eyebrow">
              <LiveDot />
              <Text style={s.eyebrowTxt}>La nostra risposta: prepararci al futuro</Text>
            </View>
          </Reveal>

          <Reveal delay={250} style={{ alignItems: "center" }}>
            <AxonOrb size={compact ? 170 : 230} />
          </Reveal>

          <Reveal delay={400} style={{ alignItems: "center" }}>
            <Text style={[s.h1, compact && s.h1Compact]} testID="landing-slogan-1">
              Il CRM che pensa con te.
            </Text>
            <View style={s.rotRow}>
              <Text style={[s.h2, compact && s.h2Compact]}>Dentro c&apos;è Axon, e </Text>
              <RotatingWord words={ROTATING} style={[s.h2, s.h2Accent, compact && s.h2Compact]} />
              <Text style={[s.h2, compact && s.h2Compact]}> per te.</Text>
            </View>
          </Reveal>

          <Reveal delay={600} style={{ alignItems: "center", gap: 14 }}>
            <Pressable onPress={goLogin} style={({ pressed }) => [s.cta, pressed && s.pressed]} testID="landing-enter-btn" accessibilityRole="button" accessibilityLabel="Entra in AdvisorOS">
              <Text style={s.ctaTxt}>ENTRA</Text>
              <Ionicons name="arrow-forward" size={22} color={LP.onBrand} />
            </Pressable>
            <Text style={s.ctaHint}>Clicca. E guarda cosa c&apos;è dietro.</Text>
          </Reveal>
        </View>
        <View style={s.scrollCue} pointerEvents="none">
          <Ionicons name="chevron-down" size={22} color={LP.axon} />
        </View>
      </View>

      {/* ───────────── MANTRA: IA aggiunta vs Axon NEL CRM ───────────── */}
      <View style={s.section} testID="landing-mantra">
        <View style={s.container}>
          <Reveal>
            <Text style={s.kicker}>IL MANTRA</Text>
            <Text style={[s.title, compact && s.titleCompact]}>
              Non un&apos;IA aggiunta.{"\n"}<Text style={s.titleAccent}>Un&apos;IA nata nel CRM.</Text>
            </Text>
            <Text style={s.lead}>
              AdvisorOS è la casa. Axon è il cervello. Non un assistente incollato sopra, ma il sistema che tiene insieme clienti, contratti, agenda e documenti — e li protegge.
            </Text>
          </Reveal>

          <View style={[s.compareRow, compact && s.compareCol]}>
            <Reveal delay={100} style={{ flex: 1 }}>
              <View style={[s.card, s.cardOff]} testID="landing-compare-std">
                <View style={s.cardHead}>
                  <View style={[s.badge, s.badgeOff]}><Text style={[s.badgeTxt, { color: LP.errorText }]}>IA STANDARD</Text></View>
                  <Text style={s.cardTitle}>Aggiunta al CRM</Text>
                </View>
                <View style={s.diagram}>
                  <View style={s.crmBox}><Text style={s.crmBoxTxt}>CRM</Text></View>
                  <View style={s.dashed} />
                  <View style={s.plugBox}><Ionicons name="hardware-chip-outline" size={18} color={LP.errorText} /><Text style={s.plugTxt}>AI esterna</Text></View>
                </View>
                {STD_AI.map((t) => (
                  <View key={t} style={s.li}><Ionicons name="close-circle" size={16} color={LP.errorText} /><Text style={s.liTxt}>{t}</Text></View>
                ))}
              </View>
            </Reveal>
            <Reveal delay={250} style={{ flex: 1 }}>
              <View style={[s.card, s.cardOn]} testID="landing-compare-axon">
                <View style={s.cardHead}>
                  <View style={[s.badge, s.badgeOn]}><LiveDot /><Text style={[s.badgeTxt, { color: LP.axon }]}>AXON</Text></View>
                  <Text style={s.cardTitle}>Nel CRM</Text>
                </View>
                <View style={s.diagram}>
                  <View style={[s.crmBox, s.crmBoxOn]}>
                    <View style={s.coreDot} />
                    <Text style={[s.crmBoxTxt, { color: LP.axon }]}>CRM + Axon</Text>
                    <View style={s.nodes}>
                      {["Clienti", "Contratti", "Agenda", "Corsi"].map((n) => (
                        <View key={n} style={s.node}><Text style={s.nodeTxt}>{n}</Text></View>
                      ))}
                    </View>
                  </View>
                </View>
                {AXON_AI.map((t) => (
                  <View key={t} style={s.li}><Ionicons name="checkmark-circle" size={16} color={LP.axon} /><Text style={s.liTxt}>{t}</Text></View>
                ))}
              </View>
            </Reveal>
          </View>

          <Reveal delay={150}>
            <View style={s.privacyBand} testID="landing-privacy">
              <Ionicons name="shield-checkmark" size={26} color={LP.axon} />
              <View style={{ flex: 1 }}>
                <Text style={s.privacyTitle}>I tuoi dati restano solo ed esclusivamente tuoi.</Text>
                <Text style={s.privacyTxt}>Isolati per azienda. Mai usati per addestrare modelli. Axon lavora dentro il tuo perimetro, non fuori.</Text>
              </View>
            </View>
          </Reveal>
        </View>
      </View>

      {/* ───────────── MODULISTICA ───────────── */}
      <View style={[s.section, s.sectionAlt]} testID="landing-modulistica">
        <Aurora style={{ opacity: 0.5 }} />
        <View style={s.container}>
          <Reveal>
            <Text style={s.kicker}>MODULISTICA</Text>
            <Text style={[s.title, compact && s.titleCompact]}>
              Zero digitazione.{"\n"}<Text style={s.titleAccent}>Solo azione.</Text>
            </Text>
            <Text style={s.lead}>
              Scatta una foto o carica un PDF. Axon legge, capisce e compila contratti, moduli e schede cliente al posto tuo. Da minuti di trascrizione a secondi.
            </Text>
          </Reveal>

          <View style={[s.compareRow, compact && s.compareCol, { alignItems: "center" }]}>
            <Reveal delay={100} style={compact ? { width: "100%", alignItems: "center" } : { flex: 1, alignItems: "center" }}>
              <AppDemoPlayer width={compact ? Math.min(300, width - 56) : 300} />
            </Reveal>
            <Reveal delay={250} style={compact ? { width: "100%", marginTop: 8 } : { flex: 1, alignSelf: "stretch" }}>
              <View style={[s.card, s.cardOn]} testID="landing-autofill">
                <Text style={s.smallCaps}>15 SECONDI · L&apos;APP IN AZIONE</Text>
                <Text style={s.cardTitle}>Da una foto al contratto firmabile.</Text>
                {DOC_INPUTS.map((d) => (
                  <View key={d.label} style={s.li}>
                    <Ionicons name={d.icon} size={16} color={LP.axon} />
                    <Text style={s.liTxt}><Text style={{ color: LP.onSurface, fontWeight: "800" }}>{d.label}</Text>  →  {d.out}</Text>
                  </View>
                ))}
                <View style={[s.li, { marginTop: 4 }]}><Ionicons name="flash" size={16} color={LP.brand} /><Text style={s.liTxt}>Contratto pronto per la firma, già archiviato nella scheda cliente. Zero errori di trascrizione.</Text></View>
              </View>
            </Reveal>
          </View>
        </View>
      </View>

      {/* ───────────── PRONTO ALL'USO ───────────── */}
      <View style={s.section} testID="landing-ready">
        <View style={s.container}>
          <Reveal>
            <Text style={s.kicker}>PRONTO ALL&apos;USO · SU RICHIESTA</Text>
            <Text style={[s.title, compact && s.titleCompact]}>
              Arrivi.{"\n"}<Text style={s.titleAccent}>E lavori.</Text>
            </Text>
            <Text style={s.lead}>
              Tutto gira dentro un sistema operativo proprietario: nessun problema di compatibilità, niente da installare o configurare. Su richiesta ti consegniamo Axon e le aree che ti servono già preparate per la tua azienda.
            </Text>
          </Reveal>
          <View style={[s.stepsRow, compact && s.compareCol]}>
            {STEPS.map((st, i) => (
              <Reveal key={st.n} delay={100 + i * 120} style={{ flex: 1 }}>
                <View style={s.step}>
                  <Text style={s.stepN}>{st.n}</Text>
                  <Text style={s.stepT}>{st.t}</Text>
                  <Text style={s.stepD}>{st.d}</Text>
                </View>
              </Reveal>
            ))}
          </View>
        </View>
      </View>

      {/* ───────────── MODULARITÀ ───────────── */}
      <View style={[s.section, s.sectionAlt]} testID="landing-modules">
        <View style={s.container}>
          <Reveal>
            <Text style={s.kicker}>MODULARITÀ</Text>
            <Text style={[s.title, compact && s.titleCompact]}>
              Costruisci{"\n"}<Text style={s.titleAccent}>il tuo ecosistema.</Text>
            </Text>
            <Text style={s.lead}>
              Attiva solo i blocchi che servono alla tua azienda. Il resto resta spento finché non ti serve. Provalo qui sotto.
            </Text>
          </Reveal>
          <Reveal delay={100}>
            <View style={s.axonAlways}>
              <LiveDot />
              <Text style={s.axonAlwaysTxt}>Axon è sempre acceso · {activeCount} blocchi attivi</Text>
            </View>
          </Reveal>
          <View style={s.modGrid}>
            {MODULES.map((m, i) => {
              const on = mods[m.key];
              return (
                <Reveal key={m.key} delay={100 + i * 60} style={{ width: compact ? "48%" : "23.5%" }}>
                  <Pressable
                    onPress={() => setMods((p) => ({ ...p, [m.key]: !p[m.key] }))}
                    style={({ pressed }) => [s.mod, on ? s.modOn : s.modOff, pressed && s.pressed]}
                    testID={`landing-module-${m.key}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                  >
                    <View style={s.modTop}>
                      <Ionicons name={m.icon} size={20} color={on ? LP.axon : LP.muted} />
                      <View style={[s.toggle, on && s.toggleOn]}>
                        <View style={[s.knob, on && s.knobOn]} />
                      </View>
                    </View>
                    <Text style={[s.modLbl, !on && { color: LP.muted }]}>{m.label}</Text>
                    <Text style={[s.modState, on && { color: LP.axon }]}>{on ? "ATTIVO" : "SPENTO"}</Text>
                  </Pressable>
                </Reveal>
              );
            })}
          </View>
        </View>
      </View>

      {/* ───────────── CTA FINALE ───────────── */}
      <View style={[s.section, s.ctaBand]} testID="landing-cta">
        <Aurora />
        <View style={[s.container, { alignItems: "center" }]}>
          <Reveal>
            <Text style={[s.title, { textAlign: "center" }, compact && s.titleCompact]}>
              Pronto a vedere{"\n"}<Text style={s.titleAccent}>cosa c&apos;è dietro?</Text>
            </Text>
          </Reveal>
          <Reveal delay={150} style={{ alignItems: "center", gap: 14 }}>
            <Pressable onPress={goLogin} style={({ pressed }) => [s.cta, s.ctaBig, pressed && s.pressed]} testID="landing-enter-btn-bottom" accessibilityRole="button">
              <Text style={[s.ctaTxt, { fontSize: 20 }]}>ENTRA</Text>
              <Ionicons name="arrow-forward" size={24} color={LP.onBrand} />
            </Pressable>
            <Pressable onPress={goDemo} hitSlop={8} testID="landing-goto-demo">
              <Text style={s.ctaHint}>Oppure <Text style={{ color: LP.brand, fontWeight: "800" }}>richiedi una demo gratuita ↓</Text></Text>
            </Pressable>
          </Reveal>
        </View>
      </View>

      {/* ───────────── RICHIEDI UNA DEMO ───────────── */}
      <View style={[s.section, s.sectionAlt]} testID="landing-demo" onLayout={(e) => { demoY.current = e.nativeEvent.layout.y; }}>
        <View style={s.container}>
          <Reveal>
            <Text style={s.kicker}>RICHIEDI UNA DEMO</Text>
            <Text style={[s.title, compact && s.titleCompact]}>
              Vuoi vederlo{"\n"}<Text style={s.titleAccent}>sul tuo lavoro?</Text>
            </Text>
            <Text style={s.lead}>
              Lasciaci nome, azienda e telefono: ti richiamiamo per una demo di AdvisorOS con Axon sui tuoi casi reali. Senza impegno.
            </Text>
          </Reveal>
          <View style={{ marginTop: 28 }}>
            <DemoRequestForm />
          </View>
        </View>
      </View>

      {/* ───────────── FOOTER ───────────── */}
      <View style={s.footer}>
        <View style={[s.container, { alignItems: "center", gap: 6 }]}>
          {/* V50.z330 — Rimando ad AxonOS Lite (famiglie e studenti) */}
          <Pressable onPress={openLite} style={({ pressed }) => [s.liteCard, pressed && { opacity: 0.9 }]} testID="landing-lite-link" accessibilityRole="link">
            <View style={s.liteIcon}><Ionicons name="sparkles" size={20} color={LP.axon} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.liteTitle}>Non sei un professionista? Scopri <Text style={{ color: LP.axon }}>AxonOS Lite</Text></Text>
              <Text style={s.liteTxt}>Lo stesso cervello Axon, pensato per famiglie e studenti: memoria personale, promemoria, note e calendario. Semplice e gratuito da provare.</Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={26} color={LP.axon} />
          </Pressable>
          <Text style={s.footerBrand}>AdvisorOS <Text style={{ color: LP.muted }}>·</Text> <Text style={{ color: LP.brand }}>powered by Axon</Text></Text>
          <Text style={s.footerTxt}>© 2026 AdvisorOS</Text>
          <View style={s.footerLinks}>
            <Pressable onPress={openMail}><Text style={s.footerLink}>info@advisoros.it</Text></Pressable>
            <Text style={s.footerTxt}>·</Text>
            <Pressable onPress={goLogin}><Text style={s.footerLink}>Accedi</Text></Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: LP.surface },
  scroll: { flexGrow: 1 },
  container: { width: "100%", maxWidth: 1000, alignSelf: "center", paddingHorizontal: 20 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },

  // Hero
  hero: { justifyContent: "center", alignItems: "center", paddingVertical: 48, overflow: "hidden", backgroundColor: LP.surface },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonGlow },
  eyebrowTxt: { color: LP.axon, fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },
  h1: { color: LP.onSurface, fontSize: 56, fontWeight: "900", letterSpacing: -2, textAlign: "center", lineHeight: 60, marginTop: 4 },
  h1Compact: { fontSize: 38, lineHeight: 42, letterSpacing: -1.2 },
  rotRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", flexWrap: "wrap", marginTop: 10, marginBottom: 28 },
  h2: { color: LP.onSurface2, fontSize: 24, fontWeight: "600", letterSpacing: -0.4 },
  h2Compact: { fontSize: 18 },
  h2Accent: { color: LP.axon, fontWeight: "900" },
  cta: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 34, paddingVertical: 16, borderRadius: 999, backgroundColor: LP.brand, shadowColor: LP.brand, shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 10, minHeight: 56 },
  ctaBig: { paddingHorizontal: 44, paddingVertical: 20 },
  ctaTxt: { color: LP.onBrand, fontSize: 17, fontWeight: "900", letterSpacing: 2 },
  ctaHint: { color: LP.onSurface2, fontSize: 14, textAlign: "center" },
  scrollCue: { position: "absolute", bottom: 14, alignSelf: "center", opacity: 0.8 },

  // Sections
  section: { paddingVertical: 72, overflow: "hidden" },
  sectionAlt: { backgroundColor: LP.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LP.border },
  kicker: { color: LP.brand, fontSize: 12, fontWeight: "800", letterSpacing: 2.4, marginBottom: 12 },
  title: { color: LP.onSurface, fontSize: 44, fontWeight: "900", letterSpacing: -1.6, lineHeight: 50 },
  titleCompact: { fontSize: 32, lineHeight: 37, letterSpacing: -1 },
  titleAccent: { color: LP.brand },
  lead: { color: LP.onSurface2, fontSize: 17, lineHeight: 26, marginTop: 16, maxWidth: 720 },

  compareRow: { flexDirection: "row", gap: 16, marginTop: 36, alignItems: "flex-start" },
  compareCol: { flexDirection: "column", alignItems: "stretch" }, // V50.z332 — su telefono le card a tutta larghezza (prima si stringevano e il testo usciva)
  card: { backgroundColor: LP.surface2, borderRadius: 20, borderWidth: 1, borderColor: LP.border, padding: 20, gap: 12 },
  cardOff: { opacity: 0.9 },
  cardOn: { borderColor: LP.axonLine, backgroundColor: LP.surface3, shadowColor: LP.axon, shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } },
  cardHead: { gap: 8 },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  badgeOff: { borderColor: LP.errorText, backgroundColor: LP.offRed },
  badgeOn: { borderColor: LP.axonLine, backgroundColor: LP.axonTint },
  badgeTxt: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  cardTitle: { color: LP.onSurface, fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  diagram: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, minHeight: 96 },
  crmBox: { flex: 1, minHeight: 76, borderRadius: 14, borderWidth: 1, borderColor: LP.borderStrong, backgroundColor: LP.surface, alignItems: "center", justifyContent: "center", padding: 10, gap: 8 },
  crmBoxOn: { borderColor: LP.axonLine, backgroundColor: LP.axonTint },
  crmBoxTxt: { color: LP.onSurface2, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  coreDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: LP.axon, shadowColor: LP.axon, shadowRadius: 14, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } },
  nodes: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  node: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: LP.axonLineSoft },
  nodeTxt: { color: LP.axon, fontSize: 10, fontWeight: "700" },
  dashed: { width: 34, height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: LP.errorText },
  plugBox: { alignItems: "center", gap: 4, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: LP.errorText, backgroundColor: LP.offRed },
  plugTxt: { color: LP.errorText, fontSize: 10, fontWeight: "800" },
  li: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  liTxt: { flex: 1, color: LP.onSurface2, fontSize: 14, lineHeight: 20 },

  privacyBand: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 24, padding: 20, borderRadius: 20, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonTint },
  privacyTitle: { color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: -0.4 },
  privacyTxt: { color: LP.onSurface2, fontSize: 14, lineHeight: 20, marginTop: 4 },

  smallCaps: { color: LP.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2 },

  stepsRow: { flexDirection: "row", gap: 16, marginTop: 36 },
  step: { flex: 1, padding: 22, borderRadius: 20, borderWidth: 1, borderColor: LP.border, backgroundColor: LP.surface2, gap: 8 },
  stepN: { color: LP.brand, fontSize: 32, fontWeight: "900", letterSpacing: -1 },
  stepT: { color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  stepD: { color: LP.onSurface2, fontSize: 14, lineHeight: 20 },

  axonAlways: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start", marginTop: 24, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonTint },
  axonAlwaysTxt: { color: LP.axon, fontSize: 13, fontWeight: "800" },
  modGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16, justifyContent: "space-between" },
  mod: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10, minHeight: 120, justifyContent: "space-between" },
  modOn: { borderColor: LP.axonLine, backgroundColor: LP.surface3, shadowColor: LP.axon, shadowOpacity: 0.35, shadowRadius: 22, shadowOffset: { width: 0, height: 0 } },
  modOff: { borderColor: LP.border, backgroundColor: LP.surface },
  modTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggle: { width: 38, height: 22, borderRadius: 11, backgroundColor: LP.border, padding: 2, justifyContent: "center" },
  toggleOn: { backgroundColor: LP.axon },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: LP.muted },
  knobOn: { backgroundColor: LP.onSurface, alignSelf: "flex-end" },
  modLbl: { color: LP.onSurface, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  modState: { color: LP.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },

  ctaBand: { alignItems: "center", paddingVertical: 96 },
  footer: { paddingVertical: 28, borderTopWidth: 1, borderTopColor: LP.border, backgroundColor: LP.surface },
  liteCard: { flexDirection: "row", alignItems: "center", gap: 12, width: "100%", maxWidth: 720, backgroundColor: LP.axonTint, borderWidth: 1, borderColor: LP.axonLineSoft, borderRadius: 16, padding: 14, marginBottom: 18 },
  liteIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: LP.axonGlow, alignItems: "center", justifyContent: "center" },
  liteTitle: { color: LP.onSurface, fontSize: 14, fontWeight: "800" },
  liteTxt: { color: LP.onSurface2, fontSize: 12, lineHeight: 17, marginTop: 2 },
  footerBrand: { color: LP.onSurface, fontSize: 14, fontWeight: "800" },
  footerTxt: { color: LP.muted, fontSize: 12 },
  footerLinks: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  footerLink: { color: LP.onSurface2, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
});

// AxonCoreLanding.tsx — V50.z530 — Landing pubblica «Axon Core» (sostituisce la precedente su /landing).
// Contenuti e prezzi arrivano da GET /public/landing (default + override del CMS admin) con i posti Founder rimasti in tempo reale.
// Sezioni: Hero · I due mondi · Manifesto privacy · Piani Founder · Richiedi demo · Footer. Animazioni leggere (Reveal/Aurora/Orb).
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Linking, useWindowDimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { BACKEND_URL } from "@/src/api";
import { LP } from "@/src/landing/palette";
import { AxonOrb, Aurora, Reveal, LiveDot } from "@/src/landing/LandingFx";
import { DemoRequestForm } from "@/src/landing/DemoRequestForm";
import { LANDING_SEEN_KEY, PENDING_PLAN_KEY } from "@/src/landing/landingSeen";
import { VideoEmbed } from "@/src/landing/VideoEmbed"; // V50.z547 — video Vimeo dei due mondi (link dal CMS)
import { trackLanding } from "@/src/landing/landingTrack"; // V50.z551 — statistiche landing

type Plan = { badge: string; name: string; price_old: number; price: number; limit: number; features: string[]; cta: string };
type Seats = { limit: number; taken: number; left: number };
type LandingData = {
  content: {
    hero: { badge: string; title: string; subtitle: string; cta_primary: string; cta_secondary: string; stats?: { n: string; label: string; accent?: boolean }[] };
    worlds: { title: string; left_kicker: string; left_title: string; left_text: string; right_kicker: string; right_title: string; right_text: string; left_video_url?: string; right_video_url?: string };
    manifesto: { title: string; pillars: { icon: string; title: string; text: string }[] };
    plans: { title: string; subtitle: string; builder: Plan; professional: Plan; seats_label: string; sold_out_label: string };
    footer: { text: string };
  };
  seats: { builder: Seats; professional: Seats };
};

const fmtPrice = (n: number) => (Number.isInteger(n) ? `${n}€` : `${n.toFixed(2).replace(".", ",")}€`);

// V50.z545 — fascia numeri hero (CMS: hero.stats); fallback se il backend non la espone ancora
const HERO_STATS_FALLBACK = [
  { n: "186", label: "funzioni integrate tra AdvisorOS e AxonOS", accent: true },
  { n: "2", label: "mondi, un solo cervello italiano", accent: false },
  { n: "100%", label: "dati su server in Italia · GDPR", accent: false },
];

export function AxonCoreLanding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [data, setData] = useState<LandingData | null>(null);
  const [failed, setFailed] = useState(false);

  // ?ref=<codice agente> → «Ti ha invitato: Nome» (endpoint pubblico, solo il nome)
  const params = useLocalSearchParams<{ ref?: string }>();
  const refCode = typeof params.ref === "string" ? params.ref.trim() : "";
  const [inviter, setInviter] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${BACKEND_URL}/api/public/landing`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) { setData(j); setFailed(false); } }).catch(() => { if (alive && !data) setFailed(true); });
    load();
    const t = setInterval(load, 60_000); // contatori posti «in tempo reale»
    AsyncStorage.setItem(LANDING_SEEN_KEY, "1").catch(() => {});
    return () => { alive = false; clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!refCode || !/^[A-Za-z0-9_\-.]{2,64}$/.test(refCode)) { setInviter(null); return; }
    let alive = true;
    fetch(`${BACKEND_URL}/api/public/advisor/${encodeURIComponent(refCode)}`).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setInviter(j?.name || null); }).catch(() => { if (alive) setInviter(null); });
    return () => { alive = false; };
  }, [refCode]);

  const goRegister = (plan: "builder" | "professional") => {
    AsyncStorage.setItem(PENDING_PLAN_KEY, plan).catch(() => {});
    router.push({ pathname: "/login", params: { plan, mode: "register", ...(refCode ? { ref: refCode } : {}) } } as any);
  };
  // V50.z546 — «Attiva AxonLite» e «19€» → approfondimento AxonOS; «Scopri AdvisorOS» → approfondimento AdvisorOS (testi dal CMS)
  const goPage = (slug: "axonos" | "advisoros") => { trackLanding("home", slug === "axonos" ? "cta_axonos" : "cta_advisoros"); router.push({ pathname: `/landing/${slug}`, params: refCode ? { ref: refCode } : {} } as any); };
  useEffect(() => { trackLanding("home", "view"); }, []); // V50.z551
  const goLogin = () => router.push("/login" as any);
  const openMail = () => {
    const url = "mailto:info@advisoros.it";
    if (Platform.OS === "web") { try { (globalThis as any).window.open(url, "_blank"); } catch { /* noop */ } } else Linking.openURL(url).catch(() => {});
  };

  const c = data?.content;

  const heroStats: { n: string; label: string; accent?: boolean }[] = Array.isArray(c?.hero?.stats) && c.hero.stats.length ? c.hero.stats : HERO_STATS_FALLBACK; // V50.z545
  const seats = data?.seats;
  const pillarsIcons = useMemo(() => ["shield-checkmark", "wallet", "infinite"], []);

  if (!c) {
    return (
      <View style={[s.root, { alignItems: "center", justifyContent: "center", padding: 24 }]} testID="landing-loading">
        {failed ? (
          <>
            <Ionicons name="cloud-offline-outline" size={40} color={LP.muted} />
            <Text style={[s.p, { textAlign: "center", marginTop: 10 }]}>Servizio momentaneamente non raggiungibile.</Text>
            <Pressable onPress={goLogin} style={[s.btnPrimary, { marginTop: 16 }]} testID="landing-login-fallback"><Text style={s.btnPrimaryTxt}>Accedi</Text></Pressable>
          </>
        ) : <ActivityIndicator color={LP.axon} size="large" />}
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={[s.scroll, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" testID="landing-root">
      {/* ───────────── 1 · HERO ───────────── */}
      <View style={s.hero} testID="landing-hero">
        <Aurora style={StyleSheet.absoluteFillObject as any} />
        <View style={s.topbar}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <LiveDot />
            <Text style={s.brand}>Axon <Text style={{ color: LP.brand }}>Core</Text></Text>
          </View>
          <Pressable onPress={goLogin} hitSlop={8} style={s.loginLink} testID="landing-login-link"><Text style={s.loginLinkTxt}>Accedi</Text><Ionicons name="arrow-forward" size={14} color={LP.onSurface2} /></Pressable>
        </View>
        <Reveal delay={0} style={{ alignItems: "center" }}>
          <AxonOrb size={compact ? 150 : 190} />
        </Reveal>
        <Reveal delay={120} style={{ alignItems: "center" }}>
          <View style={s.heroBadge} testID="landing-hero-badge"><Text style={s.heroBadgeTxt}>{c.hero.badge}</Text></View>
        </Reveal>
        <Reveal delay={220}>
          <Text style={[s.h1, compact && { fontSize: 34, lineHeight: 40 }]} testID="landing-hero-title">{c.hero.title}</Text>
        </Reveal>
        <Reveal delay={320}>
          <Text style={s.lead}>{c.hero.subtitle}</Text>
          {inviter ? <Text style={s.inviter} testID="landing-inviter">🤝 Ti ha invitato: <Text style={{ color: LP.onSurface, fontWeight: "900" }}>{inviter}</Text></Text> : null}
        </Reveal>
        <Reveal delay={420} style={StyleSheet.flatten([s.ctaRow, compact && { flexDirection: "column" as const }])}>
          <Pressable onPress={() => goPage("axonos")} style={[s.btnPrimary, compact && { alignSelf: "stretch" }]} testID="landing-cta-lite">
            <Ionicons name="rocket" size={18} color={LP.onBrand} /><Text style={s.btnPrimaryTxt}>{c.hero.cta_primary}</Text>
          </Pressable>
          <Pressable onPress={() => goPage("advisoros")} style={[s.btnGhost, compact && { alignSelf: "stretch" }]} testID="landing-cta-advisor">
            <Text style={s.btnGhostTxt}>{c.hero.cta_secondary}</Text><Ionicons name="arrow-forward" size={16} color={LP.axon} />
          </Pressable>
        </Reveal>
        {heroStats.length ? (
          <Reveal delay={520} style={StyleSheet.flatten([s.statsRow, compact && { gap: 8 }])}>
            {heroStats.map((st: any, i: number) => (
              <View key={i} style={[s.stat, st.accent && s.statMain, compact && { minWidth: "46%" as any }]} testID={`landing-stat-${i}`}>
                <Text style={[s.statN, st.accent && { color: LP.brand }]}>{st.n}</Text>
                <Text style={s.statL}>{st.label}</Text>
              </View>
            ))}
          </Reveal>
        ) : null}
      </View>

      {/* ───────────── 2 · I DUE MONDI ───────────── */}
      <View style={s.section} testID="landing-worlds">
        <Text style={s.kicker}>{c.worlds.title}</Text>
        <View style={[s.cols, compact && { flexDirection: "column" }]}>
          <Reveal delay={80} style={s.col}>
            <LinearGradient colors={[LP.surface2, LP.surface3]} style={s.worldCard}>
              <View style={[s.worldIcon, { backgroundColor: LP.brandGlow, borderColor: LP.brandLineSoft }]}><Ionicons name="briefcase" size={22} color={LP.brand} /></View>
              <Text style={[s.worldKicker, { color: LP.brand }]}>{c.worlds.left_kicker}</Text>
              <Text style={s.h2}>{c.worlds.left_title}</Text>
              <Text style={s.p}>{c.worlds.left_text}</Text>
              <VideoEmbed url={c.worlds.left_video_url} accent={LP.brand} line={LP.brandLine} testID="landing-video-advisor" />
            </LinearGradient>
          </Reveal>
          <Reveal delay={180} style={s.col}>
            <LinearGradient colors={[LP.surface2, LP.axonTint]} style={s.worldCard}>
              <View style={[s.worldIcon, { backgroundColor: LP.axonGlow, borderColor: LP.axonLineSoft }]}><Ionicons name="heart-circle" size={22} color={LP.axon} /></View>
              <Text style={[s.worldKicker, { color: LP.axon }]}>{c.worlds.right_kicker}</Text>
              <Text style={s.h2}>{c.worlds.right_title}</Text>
              <Text style={s.p}>{c.worlds.right_text}</Text>
              <VideoEmbed url={c.worlds.right_video_url} accent={LP.axon} line={LP.axonLine} testID="landing-video-axon" />
            </LinearGradient>
          </Reveal>
        </View>
      </View>

      {/* ───────────── 3 · MANIFESTO PRIVACY ───────────── */}
      <View style={[s.section, s.sectionAlt]} testID="landing-manifesto">
        <Reveal><Text style={[s.h1, { fontSize: compact ? 28 : 36, lineHeight: compact ? 34 : 42 }]}>{c.manifesto.title}</Text></Reveal>
        <View style={[s.cols, compact && { flexDirection: "column" }, { marginTop: 18 }]}>
          {c.manifesto.pillars.map((p, i) => (
            <Reveal key={i} delay={100 + i * 100} style={s.col}>
              <View style={s.pillar} testID={`landing-pillar-${i}`}>
                <View style={s.pillarIcon}><Ionicons name={(p.icon || pillarsIcons[i] || "shield-checkmark") as any} size={22} color={LP.axon} /></View>
                <Text style={s.h3}>{p.title}</Text>
                <Text style={s.p}>{p.text}</Text>
              </View>
            </Reveal>
          ))}
        </View>
      </View>

      {/* ───────────── 4 · PIANI FOUNDER ───────────── */}
      <View style={s.section} testID="landing-plans">
        <Text style={s.kicker}>{c.plans.title}</Text>
        <Text style={[s.p, { textAlign: "center", marginBottom: 16 }]}>{c.plans.subtitle}</Text>
        <View style={[s.cols, compact && { flexDirection: "column" }]}>
          <PlanCard plan={c.plans.builder} seats={seats?.builder} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLine} seatsLabel={c.plans.seats_label} soldOut={c.plans.sold_out_label} onPress={() => goPage("axonos")} testID="landing-plan-builder" delay={80} />
          <PlanCard plan={c.plans.professional} seats={seats?.professional} accent={LP.brand} glow={LP.brandGlow} line={LP.brandLine} seatsLabel={c.plans.seats_label} soldOut={c.plans.sold_out_label} onPress={() => goRegister("professional")} testID="landing-plan-professional" delay={180} featured />
        </View>
      </View>

      {/* ───────────── Richiedi demo ───────────── */}
      <View style={[s.section, s.sectionAlt]} testID="landing-demo-form">
        <Text style={s.kicker}>Vuoi vederlo in azione?</Text>
        <Text style={[s.p, { textAlign: "center", marginBottom: 12 }]}>Richiedi una demo guidata: ti ricontattiamo noi.</Text>
        <DemoRequestForm />
      </View>

      {/* ───────────── Footer ───────────── */}
      <View style={s.footer} testID="landing-footer">
        <Text style={s.footerTxt}>{c.footer.text}</Text>
        <View style={{ flexDirection: "row", gap: 18, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <Pressable onPress={goLogin} hitSlop={8}><Text style={s.footerLink}>Accedi</Text></Pressable>
          <Pressable onPress={openMail} hitSlop={8}><Text style={s.footerLink}>info@advisoros.it</Text></Pressable>
          <Pressable onPress={() => router.push("/security-info" as any)} hitSlop={8}><Text style={s.footerLink}>Sicurezza & GDPR</Text></Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function PlanCard({ plan, seats, accent, glow, line, seatsLabel, soldOut, onPress, testID, delay, featured }: {
  plan: Plan; seats?: Seats; accent: string; glow: string; line: string; seatsLabel: string; soldOut: string; onPress: () => void; testID: string; delay: number; featured?: boolean;
}) {
  const limit = seats?.limit ?? plan.limit;
  const left = seats?.left ?? limit;
  const pct = limit > 0 ? Math.max(0, Math.min(1, left / limit)) : 0;
  const isSoldOut = left <= 0;
  return (
    <Reveal delay={delay} style={s.col}>
      <View style={[s.plan, { borderColor: line }, featured && { backgroundColor: LP.surface3 }]} testID={testID}>
        <View style={[s.planBadge, { backgroundColor: glow, borderColor: line }]}><Text style={[s.planBadgeTxt, { color: accent }]}>{plan.badge}</Text></View>
        <Text style={s.h3}>{plan.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 6 }}>
          <Text style={s.priceOld}>{fmtPrice(plan.price_old)}</Text>
          <Text style={[s.price, { color: accent }]}>{fmtPrice(plan.price)}</Text>
          <Text style={s.priceUnit}>/mese</Text>
        </View>
        <View style={s.seatsBox} testID={`${testID}-seats`}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[s.seatsTxt, isSoldOut && { color: LP.errorText }]}>
              {isSoldOut ? soldOut : <><Text style={{ color: accent, fontWeight: "900", fontSize: 16 }}>{left}</Text> {seatsLabel.replace("{limit}", String(limit))}</>}
            </Text>
            <LiveDot color={isSoldOut ? LP.error : accent} />
          </View>
          <View style={s.seatsTrack}><View style={[s.seatsFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: accent }]} /></View>
        </View>
        <View style={{ gap: 8, marginTop: 12 }}>
          {plan.features.map((f, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Ionicons name="checkmark-circle" size={18} color={accent} style={{ marginTop: 1 }} />
              <Text style={[s.p, { flex: 1 }]}>{f}</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={onPress} disabled={isSoldOut} style={[s.planBtn, { backgroundColor: accent }, isSoldOut && { opacity: 0.45 }]} testID={`${testID}-cta`}>
          <Ionicons name="lock-closed" size={16} color={LP.surface} />
          <Text style={s.planBtnTxt}>{isSoldOut ? soldOut : plan.cta}</Text>
        </Pressable>
      </View>
    </Reveal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: LP.surface },
  scroll: { flexGrow: 1 },
  hero: { paddingHorizontal: 20, paddingBottom: 36, gap: 14, overflow: "hidden" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  brand: { color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  loginLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: LP.border },
  loginLinkTxt: { color: LP.onSurface2, fontWeight: "800", fontSize: 13 },
  heroBadge: { alignSelf: "center", backgroundColor: LP.brandGlow, borderWidth: 1, borderColor: LP.brandLine, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  heroBadgeTxt: { color: LP.brand, fontWeight: "800", fontSize: 12.5, textAlign: "center" },
  h1: { color: LP.onSurface, fontSize: 44, lineHeight: 50, fontWeight: "900", letterSpacing: -1.2, textAlign: "center", maxWidth: 920, alignSelf: "center" },
  h2: { color: LP.onSurface, fontSize: 24, lineHeight: 30, fontWeight: "900", letterSpacing: -0.5, marginTop: 6 },
  h3: { color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  lead: { color: LP.onSurface2, fontSize: 16, lineHeight: 24, textAlign: "center", maxWidth: 760, alignSelf: "center" },
  inviter: { color: LP.onSurface2, textAlign: "center", marginTop: 10, fontWeight: "700" },
  p: { color: LP.onSurface2, fontSize: 14.5, lineHeight: 22 },
  kicker: { color: LP.axon, fontSize: 12, fontWeight: "800", letterSpacing: 2.5, textTransform: "uppercase", textAlign: "center", marginBottom: 12 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 22 }, // V50.z545
  stat: { minWidth: 150, flexGrow: 1, maxWidth: 220, alignItems: "center", gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: LP.surface2, borderWidth: 1, borderColor: LP.border },
  statMain: { backgroundColor: LP.brandTint, borderColor: LP.brand + "77" },
  statN: { color: LP.onSurface, fontSize: 32, lineHeight: 36, fontWeight: "900", letterSpacing: -1 },
  statL: { color: LP.onSurface2, fontSize: 12.5, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  ctaRow: { flexDirection: "row", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 6 },
  btnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: LP.brand, borderRadius: 999, minHeight: 52, paddingHorizontal: 22 },
  btnPrimaryTxt: { color: LP.onBrand, fontWeight: "900", fontSize: 15 },
  btnGhost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, minHeight: 52, paddingHorizontal: 20, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonGlow },
  btnGhostTxt: { color: LP.axon, fontWeight: "800", fontSize: 15 },
  section: { paddingHorizontal: 20, paddingVertical: 40, maxWidth: 1100, alignSelf: "stretch", width: "100%", marginHorizontal: "auto" as any },
  sectionAlt: { backgroundColor: LP.surface2, maxWidth: undefined, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LP.border },
  cols: { flexDirection: "row", gap: 16, alignItems: "stretch" },
  col: { flex: 1 },
  worldCard: { flex: 1, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: LP.border, gap: 8 },
  worldIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  worldKicker: { fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 },
  pillar: { flex: 1, backgroundColor: LP.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: LP.border, gap: 8, maxWidth: 1100, alignSelf: "stretch" },
  pillarIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: LP.axonGlow, borderWidth: 1, borderColor: LP.axonLineSoft, alignItems: "center", justifyContent: "center" },
  plan: { flex: 1, backgroundColor: LP.surface2, borderRadius: 22, padding: 22, borderWidth: 1.5, gap: 6 },
  planBadge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, marginBottom: 8 },
  planBadgeTxt: { fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  priceOld: { color: LP.muted, fontSize: 18, fontWeight: "700", textDecorationLine: "line-through", marginBottom: 6 },
  price: { fontSize: 44, fontWeight: "900", letterSpacing: -1.5, lineHeight: 48 },
  priceUnit: { color: LP.onSurface2, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  seatsBox: { marginTop: 10, gap: 8, backgroundColor: LP.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: LP.border },
  seatsTxt: { color: LP.onSurface2, fontSize: 13.5, fontWeight: "700" },
  seatsTrack: { height: 8, borderRadius: 4, backgroundColor: LP.surface3, overflow: "hidden" },
  seatsFill: { height: "100%", borderRadius: 4 },
  planBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, minHeight: 50, marginTop: 16 },
  planBtnTxt: { color: LP.surface, fontWeight: "900", fontSize: 15 },
  footer: { paddingHorizontal: 20, paddingVertical: 28, alignItems: "center" },
  footerTxt: { color: LP.muted, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  footerLink: { color: LP.onSurface2, fontSize: 13, fontWeight: "700" },
});

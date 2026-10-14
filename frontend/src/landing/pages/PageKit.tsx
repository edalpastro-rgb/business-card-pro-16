// PageKit.tsx — V50.z546 — Mattoni condivisi delle pagine di approfondimento (stessa palette LP della landing Axon Core).
import React from "react";
import { View, Text, StyleSheet, Pressable, Platform, Linking, useWindowDimensions, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LP } from "@/src/landing/palette";
import { Aurora, Reveal, LiveDot } from "@/src/landing/LandingFx";
import { PENDING_PLAN_KEY } from "@/src/landing/landingSeen";
import type { Seats } from "@/src/landing/pages/usePageContent";

export const useCompact = () => useWindowDimensions().width < 760;

export function goRegister(router: ReturnType<typeof useRouter>, plan: "builder" | "professional") {
  AsyncStorage.setItem(PENDING_PLAN_KEY, plan).catch(() => {});
  router.push({ pathname: "/login", params: { plan, mode: "register" } } as any);
}

export function openMail(email: string, subject?: string) {
  const url = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  if (Platform.OS === "web") { try { (globalThis as any).window.open(url, "_blank"); } catch { /* noop */ } } else Linking.openURL(url).catch(() => {});
}

export function PageTopBar({ accent }: { accent: string }) {
  const router = useRouter();
  return (
    <View style={k.topbar}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/landing" as any))} hitSlop={8} style={k.backLink} testID="page-back">
        <Ionicons name="chevron-back" size={18} color={LP.onSurface2} /><Text style={k.backTxt}>Home</Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LiveDot color={accent} />
        <Text style={k.brand}>Axon <Text style={{ color: LP.brand }}>Core</Text></Text>
      </View>
      <Pressable onPress={() => router.push("/login" as any)} hitSlop={8} style={k.backLink} testID="page-login"><Text style={k.backTxt}>Accedi</Text><Ionicons name="arrow-forward" size={14} color={LP.onSurface2} /></Pressable>
    </View>
  );
}

export function PageHero({ kicker, title, subtitle, videoLabel, accent, glow, line, children }: { kicker: string; title: string; subtitle: string; videoLabel?: string; accent: string; glow: string; line: string; children?: React.ReactNode }) {
  const compact = useCompact();
  return (
    <View style={k.hero} testID="page-hero">
      <Aurora style={StyleSheet.absoluteFillObject as any} />
      <PageTopBar accent={accent} />
      <Reveal delay={60} style={{ alignItems: "center" }}>
        <View style={[k.badge, { backgroundColor: glow, borderColor: line }]}><Text style={[k.badgeTxt, { color: accent }]}>{kicker}</Text></View>
      </Reveal>
      <Reveal delay={160}><Text style={[k.h1, compact && { fontSize: 30, lineHeight: 36 }]} testID="page-title">{title}</Text></Reveal>
      <Reveal delay={260}><Text style={k.lead}>{subtitle}</Text></Reveal>
      {videoLabel ? (
        <Reveal delay={340} style={{ alignItems: "center" }}>
          <View style={[k.video, { borderColor: line }]} testID="page-video">
            <Ionicons name="play-circle" size={48} color={accent} />
            <Text style={k.videoLbl}>{videoLabel}</Text>
          </View>
        </Reveal>
      ) : null}
      <Reveal delay={420} style={{ alignItems: "center", gap: 8 }}>{children}</Reveal>
    </View>
  );
}

export function Section({ kicker, title, alt, kickerColor, children, testID }: { kicker?: string; title?: string; alt?: boolean; kickerColor?: string; children: React.ReactNode; testID?: string }) {
  const compact = useCompact();
  return (
    <View style={[k.section, alt && k.sectionAlt]} testID={testID}>
      <View style={k.inner}>
        {kicker ? <Text style={[k.kicker, kickerColor ? { color: kickerColor } : null]}>{kicker}</Text> : null}
        {title ? <Reveal><Text style={[k.h2, compact && { fontSize: 26, lineHeight: 32 }]}>{title}</Text></Reveal> : null}
        {children}
      </View>
    </View>
  );
}

export function Cols({ children }: { children: React.ReactNode }) {
  const compact = useCompact();
  return <View style={[k.cols, compact && { flexDirection: "column" }]}>{children}</View>;
}

export function EmojiCard({ emoji, title, text, accent, glow, line, delay, testID }: { emoji: string; title: string; text: string; accent: string; glow: string; line: string; delay: number; testID?: string }) {
  return (
    <Reveal delay={delay} style={k.col}>
      <View style={k.card} testID={testID}>
        <View style={[k.cardIcon, { backgroundColor: glow, borderColor: line }]}><Text style={{ fontSize: 22 }}>{emoji}</Text></View>
        <Text style={[k.h3, { color: LP.onSurface }]}>{title}</Text>
        <Text style={k.p}>{text}</Text>
        <View style={[k.cardBar, { backgroundColor: accent }]} />
      </View>
    </Reveal>
  );
}

export function FounderPill({ text, seats }: { text: string; seats?: Seats }) {
  const sold = !!seats && seats.left <= 0;
  return (
    <View style={[k.pill, sold && { backgroundColor: LP.offRed, borderColor: LP.error }]} testID="page-founder-pill">
      <Text style={[k.pillTxt, sold && { color: LP.errorText }]}>{text}</Text>
      <LiveDot color={sold ? LP.error : LP.brand} />
    </View>
  );
}

export function PriceRow({ priceOld, price, accent }: { priceOld: string; price: string; accent: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 6 }}>
      <Text style={k.priceOld}>{priceOld}</Text>
      <Text style={[k.price, { color: accent }]}>{price}</Text>
      <Text style={k.priceUnit}>/mese</Text>
    </View>
  );
}

export function Bullets({ items, accent }: { items: string[]; accent: string }) {
  return (
    <View style={{ gap: 8, marginTop: 10 }}>
      {items.map((f, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Ionicons name="checkmark-circle" size={18} color={accent} style={{ marginTop: 1 }} />
          <Text style={[k.p, { flex: 1 }]}>{f}</Text>
        </View>
      ))}
    </View>
  );
}

export function BigButton({ label, onPress, color, textColor, outline, icon, testID }: { label: string; onPress: () => void; color: string; textColor?: string; outline?: boolean; icon?: keyof typeof Ionicons.glyphMap; testID?: string }) {
  const compact = useCompact();
  return (
    <Pressable onPress={onPress} style={[k.btn, outline ? { borderWidth: 1, borderColor: color, backgroundColor: LP.transparent } : { backgroundColor: color }, compact && { alignSelf: "stretch" }]} testID={testID}>
      {icon ? <Ionicons name={icon} size={17} color={outline ? color : textColor || LP.onBrand} /> : null}
      <Text style={[k.btnTxt, { color: outline ? color : textColor || LP.onBrand }]}>{label}</Text>
    </Pressable>
  );
}

export function PageFooter({ text }: { text?: string }) {
  const router = useRouter();
  return (
    <View style={k.footer}>
      <Text style={k.footerTxt}>{text || "Axon Core · AdvisorOS · AxonOS — Infrastruttura dedicata in Italia, GDPR europeo."}</Text>
      <View style={{ flexDirection: "row", gap: 18, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Pressable onPress={() => router.replace("/landing" as any)} hitSlop={8}><Text style={k.footerLink}>Home</Text></Pressable>
        <Pressable onPress={() => router.push("/login" as any)} hitSlop={8}><Text style={k.footerLink}>Accedi</Text></Pressable>
        <Pressable onPress={() => router.push("/security-info" as any)} hitSlop={8}><Text style={k.footerLink}>Sicurezza & GDPR</Text></Pressable>
      </View>
    </View>
  );
}

export function PageLoading({ failed }: { failed: boolean }) {
  const router = useRouter();
  return (
    <View style={[k.root, { alignItems: "center", justifyContent: "center", padding: 24 }]} testID="page-loading">
      {failed ? (
        <>
          <Ionicons name="cloud-offline-outline" size={40} color={LP.muted} />
          <Text style={[k.p, { textAlign: "center", marginTop: 10 }]}>Servizio momentaneamente non raggiungibile.</Text>
          <Pressable onPress={() => router.push("/login" as any)} style={[k.btn, { backgroundColor: LP.brand, marginTop: 16 }]}><Text style={k.btnTxt}>Accedi</Text></Pressable>
        </>
      ) : <ActivityIndicator color={LP.axon} size="large" />}
    </View>
  );
}

export const k = StyleSheet.create({
  root: { flex: 1, backgroundColor: LP.surface },
  hero: { paddingHorizontal: 20, paddingBottom: 36, gap: 14, overflow: "hidden" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  brand: { color: LP.onSurface, fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },
  backLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: LP.border },
  backTxt: { color: LP.onSurface2, fontWeight: "800", fontSize: 13 },
  badge: { alignSelf: "center", borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  badgeTxt: { fontWeight: "800", fontSize: 12.5, textAlign: "center", letterSpacing: 0.5 },
  h1: { color: LP.onSurface, fontSize: 40, lineHeight: 46, fontWeight: "900", letterSpacing: -1.1, textAlign: "center", maxWidth: 920, alignSelf: "center" },
  h2: { color: LP.onSurface, fontSize: 32, lineHeight: 38, fontWeight: "900", letterSpacing: -0.8, textAlign: "center", maxWidth: 860, alignSelf: "center", marginBottom: 18 },
  h3: { fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  lead: { color: LP.onSurface2, fontSize: 16, lineHeight: 24, textAlign: "center", maxWidth: 760, alignSelf: "center" },
  p: { color: LP.onSurface2, fontSize: 14.5, lineHeight: 22 },
  video: { width: "100%", maxWidth: 820, aspectRatio: 16 / 9, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", backgroundColor: LP.surfaceInk, alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 },
  videoLbl: { color: LP.muted, fontSize: 13, fontWeight: "700", textAlign: "center", paddingHorizontal: 16 },
  kicker: { color: LP.axon, fontSize: 12, fontWeight: "800", letterSpacing: 2.5, textTransform: "uppercase", textAlign: "center", marginBottom: 12 },
  section: { paddingHorizontal: 20, paddingVertical: 40, width: "100%" },
  sectionAlt: { backgroundColor: LP.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LP.border },
  inner: { maxWidth: 1100, width: "100%", alignSelf: "center" },
  cols: { flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "stretch" },
  col: { flex: 1, minWidth: 280 },
  card: { flex: 1, backgroundColor: LP.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: LP.border, gap: 8, overflow: "hidden" },
  cardIcon: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cardBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, opacity: 0.8 },
  pill: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, paddingHorizontal: 18, minHeight: 44, borderRadius: 999, backgroundColor: LP.brandGlow, borderWidth: 1, borderColor: LP.brandLine },
  pillTxt: { color: LP.brand, fontWeight: "900", fontSize: 15, textAlign: "center" },
  priceOld: { color: LP.muted, fontSize: 18, fontWeight: "700", textDecorationLine: "line-through", marginBottom: 6 },
  price: { fontSize: 44, fontWeight: "900", letterSpacing: -1.5, lineHeight: 48 },
  priceUnit: { color: LP.onSurface2, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, minHeight: 52, paddingHorizontal: 22 },
  btnTxt: { color: LP.onBrand, fontWeight: "900", fontSize: 15, textAlign: "center" },
  footer: { paddingHorizontal: 20, paddingVertical: 28, alignItems: "center" },
  footerTxt: { color: LP.muted, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  footerLink: { color: LP.onSurface2, fontSize: 13, fontWeight: "700" },
});

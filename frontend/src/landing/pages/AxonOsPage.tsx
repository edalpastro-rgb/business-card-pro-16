// AxonOsPage.tsx — V50.z546 — Pagina di approfondimento AxonOS (/landing/axonos). Testi dal CMS: pages.axon (/admin/landing-cms › 5).
// CTA → registrazione con piano builder. Ponte finale → /landing/advisoros.
import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LP } from "@/src/landing/palette";
import { Reveal } from "@/src/landing/LandingFx";
import { usePageContent, fillVars } from "@/src/landing/pages/usePageContent";
import { PageHero, Section, Cols, EmojiCard, FounderPill, PriceRow, Bullets, BigButton, PageFooter, PageLoading, goRegister, useCompact, k } from "@/src/landing/pages/PageKit";

type AxonPage = {
  hero: { kicker: string; title: string; subtitle: string; video_label: string; cta: string; cta_note: string };
  concept: { kicker: string; title: string; text1: string; text2: string };
  scenarios: { kicker: string; title: string; items: { emoji: string; title: string; text: string }[] };
  onboarding: { kicker: string; title: string; text: string; bullets: string[] };
  founders: { kicker: string; title: string; text: string; highlight: string };
  pricing: { badge: string; title: string; text: string; bullets: string[]; cta: string };
  bridge: { kicker: string; title: string; text: string; cta: string };
};

export function AxonOsPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const compact = useCompact();
  const { data, failed } = usePageContent<AxonPage>("axon");
  if (!data) return <PageLoading failed={failed} />;
  const p = data.page, plan = data.plans.builder, seats = data.seats.builder;
  const register = () => goRegister(router, "builder");

  return (
    <ScrollView style={k.root} contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false} testID="axonos-page">
      <PageHero kicker={p.hero.kicker} title={p.hero.title} subtitle={p.hero.subtitle} videoLabel={p.hero.video_label} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLine}>
        <BigButton label={p.hero.cta} onPress={register} color={LP.axon} textColor={LP.surface} icon="rocket" testID="axonos-hero-cta" />
        {p.hero.cta_note ? <Text style={s.note}>{p.hero.cta_note}</Text> : null}
      </PageHero>

      <Section kicker={p.concept.kicker} title={p.concept.title} testID="axonos-concept">
        <Reveal delay={80}>
          <View style={s.conceptBox}>
            <Text style={s.art}>🗂️ 📌 🧾 📅 📎 → 🧠</Text>
            <Text style={k.p}>{p.concept.text1}</Text>
            <Text style={[k.p, { color: LP.onSurface, fontWeight: "800" }]}>{p.concept.text2}</Text>
          </View>
        </Reveal>
      </Section>

      <Section kicker={p.scenarios.kicker} title={p.scenarios.title} alt testID="axonos-scenarios">
        <Cols>
          {p.scenarios.items.map((it, i) => <EmojiCard key={i} emoji={it.emoji} title={it.title} text={it.text} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLineSoft} delay={80 + i * 90} testID={`axonos-scenario-${i}`} />)}
        </Cols>
      </Section>

      <Section kicker={p.onboarding.kicker} title={p.onboarding.title} testID="axonos-onboarding">
        <Text style={[k.p, { textAlign: "center", marginBottom: 16 }]}>{p.onboarding.text}</Text>
        <View style={{ gap: 10, maxWidth: 620, width: "100%", alignSelf: "center" }}>
          {p.onboarding.bullets.map((b, i) => (
            <Reveal key={i} delay={80 + i * 80}>
              <View style={s.step}><View style={s.stepNum}><Text style={s.stepNumTxt}>{i + 1}</Text></View><Text style={[k.p, { flex: 1, color: LP.onSurface, fontWeight: "600" }]}>{b}</Text></View>
            </Reveal>
          ))}
        </View>
      </Section>

      <Section kicker={p.founders.kicker} title={p.founders.title} alt kickerColor={LP.brand} testID="axonos-founders">
        <Text style={[k.p, { textAlign: "center", maxWidth: 760, alignSelf: "center" }]}>{p.founders.text}</Text>
        <FounderPill text={fillVars(p.founders.highlight, seats, plan)} seats={seats} />
      </Section>

      <Section testID="axonos-pricing">
        <Reveal>
          <View style={s.priceBox}>
            <View style={s.badge}><Text style={s.badgeTxt}>{p.pricing.badge}</Text></View>
            <Text style={[k.h3, { color: LP.onSurface, fontSize: 20 }]}>{p.pricing.title}</Text>
            <PriceRow priceOld={fillVars("{price_old}", seats, plan)} price={fillVars("{price}", seats, plan)} accent={LP.axon} />
            <Text style={k.p}>{p.pricing.text}</Text>
            <Bullets items={p.pricing.bullets} accent={LP.axon} />
            <View style={{ marginTop: 18 }}><BigButton label={p.pricing.cta} onPress={register} color={LP.axon} textColor={LP.surface} icon="lock-closed" testID="axonos-pricing-cta" /></View>
          </View>
        </Reveal>
      </Section>

      <Section alt testID="axonos-bridge">
        <Reveal>
          <View style={s.bridge}>
            <Text style={[k.kicker, { color: LP.brand, textAlign: "left", marginBottom: 4 }]}>{p.bridge.kicker}</Text>
            <Text style={[k.h3, { color: LP.onSurface, fontSize: compact ? 22 : 26, lineHeight: compact ? 28 : 32 }]}>{p.bridge.title}</Text>
            <Text style={k.p}>{p.bridge.text}</Text>
            <View style={{ marginTop: 10, alignSelf: compact ? "stretch" : "flex-start" }}><BigButton label={p.bridge.cta} onPress={() => router.push("/landing/advisoros" as any)} color={LP.brand} icon="briefcase" testID="axonos-bridge-cta" /></View>
          </View>
        </Reveal>
      </Section>

      <PageFooter />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  note: { color: LP.muted, fontSize: 13, fontWeight: "700", textAlign: "center" },
  conceptBox: { backgroundColor: LP.surface2, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: LP.border, gap: 12, maxWidth: 860, width: "100%", alignSelf: "center" },
  art: { fontSize: 24, letterSpacing: 4, textAlign: "center", color: LP.onSurface2, paddingVertical: 4 },
  step: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: LP.surface2, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: LP.border },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: LP.axon, alignItems: "center", justifyContent: "center" },
  stepNumTxt: { color: LP.surface, fontWeight: "900", fontSize: 15 },
  priceBox: { backgroundColor: LP.surface2, borderRadius: 22, padding: 22, borderWidth: 1.5, borderColor: LP.axonLine, gap: 8, maxWidth: 560, width: "100%", alignSelf: "center" },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonGlow, marginBottom: 6 },
  badgeTxt: { color: LP.axon, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  bridge: { borderRadius: 20, padding: 24, borderWidth: 1, borderColor: LP.brandLine, backgroundColor: LP.surface3, gap: 8, maxWidth: 860, width: "100%", alignSelf: "center" },
});

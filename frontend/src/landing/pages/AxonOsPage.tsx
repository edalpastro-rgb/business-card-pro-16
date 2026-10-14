// AxonOsPage.tsx — V50.z549 — Pagina di approfondimento AxonOS (/landing/axonos). Testi dal CMS: pages.axon (/admin/landing-cms › 5).
// Struttura: hero · dolore (svuotatasche) · 4 pilastri · Axon Drive & Domotica · onboarding guidato (modal interno) · tariffa + Founder · ponte AdvisorOS.
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LP } from "@/src/landing/palette";
import { Reveal } from "@/src/landing/LandingFx";
import { usePageContent, fillVars } from "@/src/landing/pages/usePageContent";
import { PageHero, Section, Cols, EmojiCard, InfoBlock, FounderPill, PriceRow, Bullets, BigButton, PageFooter, PageLoading, goRegister, useCompact, k } from "@/src/landing/pages/PageKit";
import { ModalShell } from "@/src/landing/pages/CompareModal";

type Item = { emoji: string; title: string; text: string };
type AxonPage = {
  hero: { kicker: string; title: string; subtitle: string; video_label: string; video_url?: string; cta: string; cta_note: string };
  // blocchi opzionali: il web può essere aggiornato prima del core (contenuti con struttura precedente) → la pagina non deve rompersi
  pain?: { kicker: string; title: string; items: Item[] };
  pillars?: { kicker: string; title: string; items: Item[] };
  drive?: { kicker: string; title: string; intro: string; items: Item[] };
  onboarding?: { kicker: string; title: string; text: string; cta?: string; modal?: { title: string; steps: Item[]; close: string } };
  pricing: { kicker?: string; badge: string; title: string; text: string; bullets: string[]; founders_text?: string; highlight?: string; cta: string };
  bridge: { kicker: string; title: string; text: string; cta: string };
};

export function AxonOsPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const compact = useCompact();
  const [onbOpen, setOnbOpen] = useState(false);
  const { data, failed } = usePageContent<AxonPage>("axon");
  if (!data) return <PageLoading failed={failed} />;
  const p = data.page, plan = data.plans.builder, seats = data.seats.builder;
  const register = () => goRegister(router, "builder");

  return (
    <ScrollView style={k.root} contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false} testID="axonos-page">
      <PageHero kicker={p.hero.kicker} title={p.hero.title} subtitle={p.hero.subtitle} videoLabel={p.hero.video_label} videoUrl={p.hero.video_url} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLine}>
        <BigButton label={p.hero.cta} onPress={register} color={LP.axon} textColor={LP.surface} icon="rocket" testID="axonos-hero-cta" />
        {p.hero.cta_note ? <Text style={s.note}>{p.hero.cta_note}</Text> : null}
      </PageHero>

      {/* IL DOLORE */}
      {p.pain ? (
        <Section kicker={p.pain.kicker} title={p.pain.title} testID="axonos-pain">
          <Reveal delay={60}><Text style={s.art}>🗂️ 📌 🧾 📅 💊 → 🧠</Text></Reveal>
          <Cols>
            {p.pain.items.map((it, i) => <EmojiCard key={i} emoji={it.emoji} title={it.title} text={it.text} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLineSoft} delay={80 + i * 90} testID={`axonos-pain-${i}`} />)}
          </Cols>
        </Section>
      ) : null}

      {/* I QUATTRO PILASTRI */}
      {p.pillars ? (
        <Section kicker={p.pillars.kicker} title={p.pillars.title} alt testID="axonos-pillars">
          <Cols>
            {p.pillars.items.map((it, i) => <EmojiCard key={i} emoji={it.emoji} title={it.title} text={it.text} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLineSoft} delay={80 + i * 90} testID={`axonos-pillar-${i}`} />)}
          </Cols>
        </Section>
      ) : null}

      {/* AXON DRIVE & DOMOTICA */}
      {p.drive ? (
        <Section testID="axonos-drive-section">
          <InfoBlock {...p.drive} accent={LP.axon} glow={LP.axonGlow} line={LP.axonLine} testID="axonos-drive" />
        </Section>
      ) : null}

      {/* ONBOARDING GUIDATO + MODAL */}
      {p.onboarding ? (
      <Section kicker={p.onboarding.kicker} title={p.onboarding.title} alt testID="axonos-onboarding">
        <Text style={[k.p, { textAlign: "center", maxWidth: 760, alignSelf: "center" }]}>{p.onboarding.text}</Text>
        {p.onboarding.modal && p.onboarding.cta ? (
        <Reveal delay={200} style={{ alignItems: "center", marginTop: 20 }}>
          <BigButton label={p.onboarding.cta} onPress={() => setOnbOpen(true)} color={LP.axon} outline testID="axonos-onb-cta" />
        </Reveal>
        ) : null}
        {p.onboarding.modal ? (
        <ModalShell visible={onbOpen} onClose={() => setOnbOpen(false)} title={p.onboarding.modal.title} closeLabel={p.onboarding.modal.close} testID="axonos-onb-modal">
          <View style={{ gap: 10 }}>
            {p.onboarding.modal.steps.map((st, i) => (
              <View key={i} style={s.step} testID={`axonos-onb-step-${i}`}>
                <View style={s.stepNum}><Text style={s.stepNumTxt}>{i + 1}</Text></View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[k.h3, { color: LP.onSurface, fontSize: 16.5 }]}>{st.emoji} {st.title}</Text>
                  <Text style={k.p}>{st.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </ModalShell>
        ) : null}
      </Section>
      ) : null}

      {/* PACCHETTI E OFFERTA SOCI FONDATORI */}
      <Section kicker={p.pricing.kicker} kickerColor={LP.brand} testID="axonos-pricing">
        <Reveal>
          <View style={s.priceBox}>
            <View style={s.badge}><Text style={s.badgeTxt}>{p.pricing.badge}</Text></View>
            <Text style={[k.h3, { color: LP.onSurface, fontSize: 20 }]}>{p.pricing.title}</Text>
            <PriceRow priceOld={fillVars("{price_old}", seats, plan)} price={fillVars("{price}", seats, plan)} accent={LP.axon} />
            <Text style={k.p}>{p.pricing.text}</Text>
            <Bullets items={p.pricing.bullets} accent={LP.axon} />
            {p.pricing.founders_text ? (
              <View style={s.founderBox}>
                <Text style={[k.p, { color: LP.onSurface, fontWeight: "700" }]}>{p.pricing.founders_text}</Text>
                {p.pricing.highlight ? <View style={{ alignSelf: "flex-start" }}><FounderPill text={fillVars(p.pricing.highlight, seats, plan)} seats={seats} /></View> : null}
              </View>
            ) : null}
            <View style={{ marginTop: 18 }}><BigButton label={p.pricing.cta} onPress={register} color={LP.axon} textColor={LP.surface} icon="rocket" testID="axonos-pricing-cta" /></View>
          </View>
        </Reveal>
      </Section>

      {/* PONTE VERSO ADVISOROS */}
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
  art: { fontSize: 24, letterSpacing: 4, textAlign: "center", color: LP.onSurface2, paddingVertical: 4, marginBottom: 14 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: LP.surface2, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: LP.border },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: LP.axon, alignItems: "center", justifyContent: "center" },
  stepNumTxt: { color: LP.surface, fontWeight: "900", fontSize: 15 },
  priceBox: { backgroundColor: LP.surface2, borderRadius: 22, padding: 22, borderWidth: 1.5, borderColor: LP.axonLine, gap: 8, maxWidth: 600, width: "100%", alignSelf: "center" },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonGlow, marginBottom: 6 },
  badgeTxt: { color: LP.axon, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  founderBox: { marginTop: 14, gap: 8, backgroundColor: LP.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: LP.brandLine },
  bridge: { borderRadius: 20, padding: 24, borderWidth: 1, borderColor: LP.brandLine, backgroundColor: LP.surface3, gap: 8, maxWidth: 860, width: "100%", alignSelf: "center" },
});

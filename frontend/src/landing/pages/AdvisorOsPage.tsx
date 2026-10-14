// AdvisorOsPage.tsx — V50.z546 — Pagina di approfondimento AdvisorOS (/landing/advisoros). Testi dal CMS: pages.advisor (/admin/landing-cms › 6).
// CTA prova → registrazione con piano professional · CTA preventivo → email (pricing.quote_email, configurabile dal CMS).
import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LP } from "@/src/landing/palette";
import { Reveal } from "@/src/landing/LandingFx";
import { usePageContent, fillVars } from "@/src/landing/pages/usePageContent";
import { PageHero, Section, Cols, EmojiCard, FounderPill, PriceRow, BigButton, PageFooter, PageLoading, goRegister, openMail, useCompact, k } from "@/src/landing/pages/PageKit";

type AdvisorPage = {
  hero: { kicker: string; title: string; subtitle: string; video_label: string; cta: string };
  pain: { kicker: string; title: string; text1: string; text2: string };
  compare: { kicker: string; title: string; col_need: string; col_us: string; col_them: string; rows: { need: string; us: string; them: string }[] };
  features: { kicker: string; title: string; items: { emoji: string; title: string; text: string }[] };
  pricing: { kicker: string; title: string; founders_title: string; founders_text: string; founders_highlight: string; tiers: { emoji: string; name: string; text: string }[]; cta_trial: string; cta_quote: string; quote_email: string; quote_subject?: string };
};

const SUCCESS = "#4ADE80"; // verde «✅» identico su web statico e app (non dipende dal tema)
const statusColor = (t: string) => (t.startsWith("✅") ? SUCCESS : t.startsWith("🟡") ? LP.brand : t.startsWith("❌") ? LP.errorText : LP.onSurface2);

export function AdvisorOsPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const compact = useCompact();
  const { data, failed } = usePageContent<AdvisorPage>("advisor");
  if (!data) return <PageLoading failed={failed} />;
  const p = data.page, plan = data.plans.professional, seats = data.seats.professional;
  const register = () => goRegister(router, "professional");

  return (
    <ScrollView style={k.root} contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false} testID="advisoros-page">
      <PageHero kicker={p.hero.kicker} title={p.hero.title} subtitle={p.hero.subtitle} videoLabel={p.hero.video_label} accent={LP.brand} glow={LP.brandGlow} line={LP.brandLine}>
        <BigButton label={p.hero.cta} onPress={register} color={LP.brand} icon="rocket" testID="advisoros-hero-cta" />
      </PageHero>

      <Section kicker={p.pain.kicker} title={p.pain.title} kickerColor={LP.brand} testID="advisoros-pain">
        <Reveal delay={80}>
          <View style={s.painBox}>
            <Text style={s.art}>🚗 🗺️ 💬 📊 🗄️ → 🎙️</Text>
            <Text style={k.p}>{p.pain.text1}</Text>
            <Text style={[k.p, { color: LP.onSurface, fontWeight: "800" }]}>{p.pain.text2}</Text>
          </View>
        </Reveal>
      </Section>

      <Section kicker={p.compare.kicker} title={p.compare.title} alt testID="advisoros-compare">
        <Reveal delay={60}>
          <View style={s.table}>
            {!compact ? (
              <View style={[s.tr, s.thead]}>
                <Text style={[s.th, { flex: 1.2 }]}>{p.compare.col_need}</Text>
                <Text style={[s.th, { flex: 1, color: LP.brand }]}>{p.compare.col_us}</Text>
                <Text style={[s.th, { flex: 1.2 }]}>{p.compare.col_them}</Text>
              </View>
            ) : null}
            {p.compare.rows.map((r, i) => (
              <View key={i} style={[s.tr, compact && { flexDirection: "column", gap: 6 }, i === p.compare.rows.length - 1 && { borderBottomWidth: 0 }]} testID={`advisoros-cmp-row-${i}`}>
                <Text style={[s.need, { flex: compact ? undefined : 1.2 }]}>{r.need}</Text>
                <View style={[s.cell, s.cellUs, { flex: compact ? undefined : 1 }]}><Text style={[s.cellTxt, { color: statusColor(r.us), fontWeight: "800" }]}>{compact ? `${p.compare.col_us}: ` : ""}{r.us}</Text></View>
                <View style={[s.cell, { flex: compact ? undefined : 1.2 }]}><Text style={[s.cellTxt, { color: statusColor(r.them) }]}>{compact ? "Giganti: " : ""}{r.them}</Text></View>
              </View>
            ))}
          </View>
        </Reveal>
      </Section>

      <Section kicker={p.features.kicker} title={p.features.title} kickerColor={LP.brand} testID="advisoros-features">
        <Cols>
          {p.features.items.map((it, i) => <EmojiCard key={i} emoji={it.emoji} title={it.title} text={it.text} accent={LP.brand} glow={LP.brandGlow} line={LP.brandLineSoft} delay={80 + i * 90} testID={`advisoros-feature-${i}`} />)}
        </Cols>
      </Section>

      <Section kicker={p.pricing.kicker} title={p.pricing.title} alt testID="advisoros-pricing">
        <Reveal>
          <View style={s.founderBox}>
            <View style={s.badge}><Text style={s.badgeTxt}>{p.pricing.founders_title}</Text></View>
            <PriceRow priceOld={fillVars("{price_old}", seats, plan)} price={fillVars("{price}", seats, plan)} accent={LP.brand} />
            <Text style={k.p}>{p.pricing.founders_text}</Text>
            <View style={{ alignSelf: "flex-start" }}><FounderPill text={fillVars(p.pricing.founders_highlight, seats, plan)} seats={seats} /></View>
          </View>
        </Reveal>
        <View style={{ height: 16 }} />
        <Cols>
          {p.pricing.tiers.map((t, i) => (
            <Reveal key={i} delay={80 + i * 80} style={k.col}>
              <View style={s.tier} testID={`advisoros-tier-${i}`}>
                <View style={s.tierIcon}><Text style={{ fontSize: 22 }}>{t.emoji}</Text></View>
                <View style={{ flex: 1, gap: 4 }}><Text style={[k.h3, { color: LP.onSurface, fontSize: 16.5 }]}>{t.name}</Text><Text style={k.p}>{t.text}</Text></View>
              </View>
            </Reveal>
          ))}
        </Cols>
        <View style={[s.ctaRow, compact && { flexDirection: "column" }]}>
          <BigButton label={p.pricing.cta_trial} onPress={register} color={LP.brand} icon="rocket" testID="advisoros-cta-trial" />
          <BigButton label={p.pricing.cta_quote} onPress={() => openMail(p.pricing.quote_email, p.pricing.quote_subject)} color={LP.brand} outline icon="mail" testID="advisoros-cta-quote" />
        </View>
      </Section>

      <PageFooter />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  painBox: { backgroundColor: LP.surface2, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: LP.border, gap: 12, maxWidth: 860, width: "100%", alignSelf: "center" },
  art: { fontSize: 24, letterSpacing: 4, textAlign: "center", color: LP.onSurface2, paddingVertical: 4 },
  table: { borderRadius: 18, borderWidth: 1, borderColor: LP.border, backgroundColor: LP.surface, overflow: "hidden" },
  thead: { backgroundColor: LP.surface3 },
  tr: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderColor: LP.border, paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  th: { color: LP.muted, fontSize: 11.5, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  need: { color: LP.onSurface, fontWeight: "800", fontSize: 14.5, lineHeight: 20 },
  cell: { justifyContent: "center" },
  cellUs: { backgroundColor: LP.brandGlow, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  cellTxt: { fontSize: 14, lineHeight: 20 },
  founderBox: { backgroundColor: LP.surface3, borderRadius: 22, padding: 22, borderWidth: 1.5, borderColor: LP.brandLine, gap: 8, maxWidth: 560, width: "100%", alignSelf: "center" },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: LP.brandLine, backgroundColor: LP.brandGlow, marginBottom: 6 },
  badgeTxt: { color: LP.brand, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  tier: { flex: 1, flexDirection: "row", gap: 14, alignItems: "flex-start", backgroundColor: LP.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: LP.border },
  tierIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: LP.brandGlow, borderWidth: 1, borderColor: LP.brandLine, alignItems: "center", justifyContent: "center" },
  ctaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 24 },
});

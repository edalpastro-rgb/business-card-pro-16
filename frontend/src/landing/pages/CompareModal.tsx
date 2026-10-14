// CompareModal.tsx — V50.z548 — «Perché i consulenti scelgono AdvisorOS» + modal con tabella comparativa configurabile dal CMS
// (pages.advisor.why.modal: colonne/righe/celle in array → nessun dato fisso nel codice). ModalShell (V50.z549) riusato dall'onboarding AxonOS.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LP } from "@/src/landing/palette";
import { Reveal } from "@/src/landing/LandingFx";
import { Section, Cols, EmojiCard, BigButton, k } from "@/src/landing/pages/PageKit";

export type WhyBlock = {
  kicker: string; title: string; items: { emoji: string; title: string; text: string }[]; cta: string;
  modal: { title: string; col_need: string; columns: string[]; rows: { need: string; cells: string[] }[]; note: string; close: string };
};

const SUCCESS = "#4ADE80"; // verde «✅» identico su web statico e app
const cellColor = (t: string) => (t.startsWith("✅") || t.startsWith("⏱️") ? SUCCESS : t.startsWith("🟡") ? LP.brand : t.startsWith("❌") ? LP.errorText : LP.onSurface);

export function WhySection({ why }: { why: WhyBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <Section kicker={why.kicker} title={why.title} kickerColor={LP.brand} testID="advisoros-why">
      <Cols>
        {why.items.map((it, i) => <EmojiCard key={i} emoji={it.emoji} title={it.title} text={it.text} accent={LP.brand} glow={LP.brandGlow} line={LP.brandLineSoft} delay={80 + i * 90} testID={`advisoros-why-${i}`} />)}
      </Cols>
      <Reveal delay={320} style={{ alignItems: "center", marginTop: 22 }}>
        <BigButton label={why.cta} onPress={() => setOpen(true)} color={LP.brand} outline testID="advisoros-why-cta" />
      </Reveal>
      <CompareModal visible={open} onClose={() => setOpen(false)} modal={why.modal} />
    </Section>
  );
}

/** V50.z549 — contenitore modal riusabile (overlay scuro, X grande, scroll interno, pulsante chiudi): confronto tecnico, onboarding AxonOS. */
export function ModalShell({ visible, onClose, title, closeLabel, children, testID }: { visible: boolean; onClose: () => void; title: string; closeLabel: string; children: React.ReactNode; testID: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={m.overlay} testID={testID}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Chiudi" />
        <View style={[m.sheet, { marginTop: insets.top + 12, marginBottom: insets.bottom + 12 }]}>
          <View style={m.head}>
            <Text style={m.title} numberOfLines={2}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={m.x} accessibilityLabel="Chiudi" testID={`${testID}-x`}><Ionicons name="close" size={34} color={LP.onSurface} /></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }} showsVerticalScrollIndicator>
            {children}
            <BigButton label={closeLabel} onPress={onClose} color={LP.brand} testID={`${testID}-close`} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CompareModal({ visible, onClose, modal }: { visible: boolean; onClose: () => void; modal: WhyBlock["modal"] }) {
  const { width } = useWindowDimensions();
  const colW = Math.max(150, Math.min(190, (width - 40) / 3));
  const needW = Math.max(170, colW + 20);
  return (
    <ModalShell visible={visible} onClose={onClose} title={modal.title} closeLabel={modal.close} testID="advisoros-compare-modal">
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 6 }}>
        <View style={m.table}>
          <View style={[m.tr, m.thead]}>
            <Text style={[m.th, { width: needW }]}>{modal.col_need}</Text>
            {modal.columns.map((c, i) => <Text key={i} style={[m.th, { width: colW }, i === 0 && { color: LP.brand }]}>{c}</Text>)}
          </View>
          {modal.rows.map((r, ri) => (
            <View key={ri} style={[m.tr, ri === modal.rows.length - 1 && { borderBottomWidth: 0 }]} testID={`advisoros-compare-row-${ri}`}>
              <Text style={[m.need, { width: needW }]}>{r.need}</Text>
              {modal.columns.map((_, ci) => {
                const t = r.cells[ci] || "—";
                return <View key={ci} style={[m.td, { width: colW }, ci === 0 && m.tdUs]}><Text style={[m.tdTxt, { color: cellColor(t) }, ci === 0 && { fontWeight: "800" }]}>{t}</Text></View>;
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={k.note}>{modal.note}</Text>
    </ModalShell>
  );
}

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(4,10,20,0.86)", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  sheet: { flex: 1, width: "100%", maxWidth: 1240, backgroundColor: LP.surface, borderRadius: 22, borderWidth: 1, borderColor: LP.borderStrong, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 18, paddingRight: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: LP.border, backgroundColor: LP.surface2 },
  title: { flex: 1, color: LP.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  x: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: LP.surface3, borderWidth: 1, borderColor: LP.borderStrong },
  table: { borderRadius: 16, borderWidth: 1, borderColor: LP.border, backgroundColor: LP.surface, overflow: "hidden" },
  thead: { backgroundColor: LP.surface3 },
  tr: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderColor: LP.border },
  th: { color: LP.muted, fontSize: 11.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", paddingHorizontal: 12, paddingVertical: 12 },
  need: { color: LP.onSurface, fontWeight: "800", fontSize: 13.5, lineHeight: 19, paddingHorizontal: 12, paddingVertical: 12 },
  td: { paddingHorizontal: 12, paddingVertical: 12, justifyContent: "center" },
  tdUs: { backgroundColor: LP.brandGlow },
  tdTxt: { fontSize: 13.5, lineHeight: 19 },
});

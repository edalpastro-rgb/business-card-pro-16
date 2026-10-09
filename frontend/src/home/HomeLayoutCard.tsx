// HomeLayoutCard.tsx — V50.z505 — Impostazioni › Preferenze generali: «Personalizza la Home» (solo Super Master).
// Per ogni blocco: mostra/nascondi, sposta sopra/sotto, posizione (Sinistra · Destra · Intera). Salvataggio immediato su
// PUT /home/layout; «Ripristina» = DELETE /home/layout. La card non compare se il server risponde allowed=false.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { HomeBlock, HomeBlockPos, HomeLayout } from "@/src/home/homeLayout";

const POS: { key: HomeBlockPos; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "left", label: "Sinistra", icon: "chevron-back" },
  { key: "right", label: "Destra", icon: "chevron-forward" },
  { key: "full", label: "Intera", icon: "remove" },
];

export function HomeLayoutCard() {
  const [data, setData] = useState<HomeLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<HomeLayout>("/home/layout").then(setData).catch(() => setFailed(true));
  }, []);

  const persist = async (blocks: HomeBlock[]) => {
    if (!data || saving) return;
    const prev = data;
    setData({ ...data, blocks, customized: true });
    setSaving(true);
    try {
      const r = await api<HomeLayout>("/home/layout", { method: "PUT", body: { blocks: blocks.map((b) => ({ id: b.id, visible: b.visible, pos: b.pos })) } });
      setData(r);
    } catch (e: any) {
      setData(prev);
      notify("Errore", e?.message || "Impossibile salvare il layout della Home");
    } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!data || saving) return;
    setSaving(true);
    try { setData(await api<HomeLayout>("/home/layout", { method: "DELETE" })); }
    catch (e: any) { notify("Errore", e?.message || "Impossibile ripristinare"); }
    finally { setSaving(false); }
  };

  if (failed || (data && !data.allowed)) return null;
  if (!data) return <View style={s.card}><ActivityIndicator color={HT.brand} /></View>;

  const blocks = data.blocks;
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  return (
    <View style={s.card} testID="home-layout-card">
      <View style={s.head}>
        <View style={s.orb}><Ionicons name="grid" size={18} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Personalizza la Home</Text>
          <Text style={s.sub}>Scegli quali blocchi vedere, l&apos;ordine e la posizione (sinistra, destra, larghezza intera). Su telefono i blocchi sono impilati nell&apos;ordine scelto.</Text>
        </View>
        {saving ? <ActivityIndicator color={HT.brand} /> : <Ionicons name="checkmark-circle" size={20} color={HT.brand} />}
      </View>

      {blocks.map((b, i) => (
        <View key={b.id} style={[s.row, !b.visible && s.rowOff]} testID={`hl-row-${b.id}`}>
          <View style={s.rowTop}>
            <Pressable onPress={() => persist(blocks.map((x) => (x.id === b.id ? { ...x, visible: !x.visible } : x)))} style={s.eye} hitSlop={6} testID={`hl-toggle-${b.id}`} accessibilityLabel={b.visible ? `Nascondi ${b.label}` : `Mostra ${b.label}`}>
              <Ionicons name={b.visible ? "eye" : "eye-off"} size={20} color={b.visible ? HT.brand : HT.muted} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.label, !b.visible && { color: HT.muted }]} numberOfLines={1}>{i + 1}. {b.label}</Text>
              {b.hint ? <Text style={s.hint} numberOfLines={2}>{b.hint}</Text> : null}
            </View>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} style={[s.arrow, i === 0 && { opacity: 0.3 }]} hitSlop={4} testID={`hl-up-${b.id}`} accessibilityLabel="Sposta sopra">
              <Ionicons name="arrow-up" size={18} color={HT.text} />
            </Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === blocks.length - 1} style={[s.arrow, i === blocks.length - 1 && { opacity: 0.3 }]} hitSlop={4} testID={`hl-down-${b.id}`} accessibilityLabel="Sposta sotto">
              <Ionicons name="arrow-down" size={18} color={HT.text} />
            </Pressable>
          </View>
          <View style={s.posRow}>
            {POS.map((p) => (
              <Pressable key={p.key} onPress={() => persist(blocks.map((x) => (x.id === b.id ? { ...x, pos: p.key } : x)))} style={[s.posChip, b.pos === p.key && s.posChipOn]} testID={`hl-pos-${b.id}-${p.key}`}>
                <Ionicons name={p.icon} size={13} color={b.pos === p.key ? "#FFFFFF" : HT.text2} />
                <Text style={[s.posTxt, b.pos === p.key && s.posTxtOn]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <Pressable onPress={reset} style={[s.resetBtn, !data.customized && { opacity: 0.5 }]} disabled={!data.customized} testID="hl-reset">
        <Ionicons name="refresh" size={16} color={HT.text2} />
        <Text style={s.resetTxt}>Ripristina il layout predefinito</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { ...HT.cardShadow, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 16, padding: 14, gap: 10, marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  orb: { width: 36, height: 36, borderRadius: 12, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  title: { color: HT.text, fontWeight: "800", fontSize: 15 },
  sub: { color: HT.muted, fontSize: 12, marginTop: 2 },
  row: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 10, gap: 8, backgroundColor: HT.card2 },
  rowOff: { opacity: 0.75, borderStyle: "dashed" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  eye: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  label: { color: HT.text, fontWeight: "800", fontSize: 14 },
  hint: { color: HT.muted, fontSize: 11, marginTop: 1 },
  arrow: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  posRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  posChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  posChipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  posTxt: { color: HT.text2, fontSize: 12, fontWeight: "700" },
  posTxtOn: { color: "#FFFFFF" },
  resetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, minHeight: 44 },
  resetTxt: { color: HT.text2, fontWeight: "700", fontSize: 13 },
});

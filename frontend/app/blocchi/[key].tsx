// app/blocchi/[key].tsx — tag 2026-10-19 (blocchi) — Pagina d'ingresso di un BLOCCO (o di una sua sottovoce, es. Energia → Fotovoltaico).
// Mostra titolo, descrizione, stato licenza e le sottovoci navigabili. Pronta a ospitare le funzioni dedicate del blocco.
// Blocco non abilitato per l'organizzazione → messaggio «non incluso nella licenza» (nessun dead-end: link alla Home).
import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { HT } from "@/src/homeTheme";
import { MENU_CATEGORIES } from "@/src/menuCategories";
import { useBlocks, type Block, type BlockChild } from "@/src/useBlocks";

export default function BlockScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { blocks, loading } = useBlocks();
  const cat = MENU_CATEGORIES.blocks;

  const found = useMemo((): { block: Block; child: BlockChild | null } | null => {
    for (const b of blocks) {
      if (b.key === key) return { block: b, child: null };
      const c = (b.children || []).find((x) => x.key === key);
      if (c) return { block: b, child: c };
    }
    return null;
  }, [blocks, key]);

  const title = found ? (found.child ? found.child.label : found.block.label) : "Blocco";
  const icon = (found ? (found.child ? found.child.icon : found.block.icon) : "cube") as any;
  const color = found?.block.color || cat.color;
  const enabled = !!found?.block.enabled;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="block-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={[s.hIcon, { backgroundColor: color + "22" }]}><Ionicons name={icon} size={18} color={color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{cat.label}{found?.child ? ` · ${found.block.label}` : ""}</Text>
          <Text style={s.hTitle} testID="block-title">{title}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {loading && !found ? <ActivityIndicator color={color} style={{ marginTop: 30 }} /> : !found || !enabled ? (
          <View style={s.card} testID="block-disabled">
            <Ionicons name="lock-closed-outline" size={26} color={HT.muted} />
            <Text style={s.cardTitle}>Blocco non incluso nella tua licenza</Text>
            <Text style={s.body}>Questo modulo non è attivo per la tua organizzazione. Per attivarlo chiedi al SuperMaster: lo accende dal pannello «Blocchi per licenza» senza aggiornamenti dell&apos;app.</Text>
            <Pressable onPress={() => router.replace("/(tabs)/home" as any)} style={[s.btn, { backgroundColor: color }]} testID="block-go-home"><Text style={s.btnTxt}>Torna alla Home</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={s.card} testID="block-card">
              <View style={s.statusRow}>
                <View style={[s.dot, { backgroundColor: HT.success }]} />
                <Text style={s.status}>Attivo per la tua organizzazione</Text>
              </View>
              <Text style={s.body}>{found.child ? found.child.description : found.block.description}</Text>
              <Text style={s.hint}>Punto d&apos;ingresso del blocco: le funzioni dedicate verranno aggiunte qui. Intanto puoi chiedere ad Axon in chat («apri {title}», «cosa posso fare in {title}?»).</Text>
            </View>
            {!found.child && found.block.children?.length ? (
              <View style={{ gap: 8 }} testID="block-children">
                <Text style={s.section}>Sottovoci</Text>
                {found.block.children.map((c) => (
                  <Pressable key={c.key} onPress={() => router.push(c.route as any)} style={s.childRow} testID={`block-child-${c.key}`}>
                    <View style={[s.hIcon, { backgroundColor: color + "22" }]}><Ionicons name={c.icon as any} size={18} color={color} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.childLbl}>{c.label}</Text>
                      <Text style={s.childSub} numberOfLines={2}>{c.description}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={HT.muted} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {found.child ? (
              <Pressable onPress={() => router.push(found.block.route as any)} style={s.childRow} testID="block-parent">
                <Ionicons name="arrow-up-circle-outline" size={20} color={color} />
                <Text style={[s.childLbl, { flex: 1 }]}>Torna a {found.block.label}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  hIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: HT.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  hTitle: { color: HT.text, fontSize: 18, fontWeight: "900" },
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 16, gap: 10 },
  cardTitle: { color: HT.text, fontSize: 16, fontWeight: "900" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { color: HT.text2, fontSize: 12.5, fontWeight: "700" },
  body: { color: HT.text, fontSize: 14.5, lineHeight: 21 },
  hint: { color: HT.muted, fontSize: 12.5, lineHeight: 18 },
  section: { color: HT.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  childRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, minHeight: 60 },
  childLbl: { color: HT.text, fontWeight: "800", fontSize: 14.5 },
  childSub: { color: HT.muted, fontSize: 12 },
  btn: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 16, minHeight: 44, justifyContent: "center" },
  btnTxt: { color: "#FFFFFF", fontWeight: "900" },
});

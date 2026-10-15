// admin/app-map.tsx — V50.z561 — MAPPA COMPLETA DELL'APP (Master / Super Master).
// Elenco aggiornato di TUTTE le funzioni in un unico posto: nome, descrizione breve, come si usa, percorso di menu e link
// diretto, raggruppate per categoria con conteggi. Fonte: GET /api/public/manual (axon_manual_data.py) — la stessa che
// alimenta /manuale e il contesto di Axon, quindi si aggiorna da sola a ogni nuova funzione (regola permanente).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { KScrollView } from "@/src/ui/keyboard";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { resolveNavRoute } from "@/src/navRoutes";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { notify } from "@/src/utils/notify";
import type { ManualArticle } from "@/src/ManualBrowser";

type Resp = { items: ManualArticle[]; categories: string[]; total: number };

export default function AppMapScreen() {
  const router = useRouter();
  const bottomPad = usePageBottomPadding();
  const [data, setData] = useState<Resp | null>(null);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try { setData(await api<Resp>("/public/manual")); } catch (e: any) { notify("Errore", e?.message || "Impossibile caricare la mappa"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => (data?.items || []).filter((a) => a.kind === "manual"), [data]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((a) => [a.title, a.path, a.body, a.how || "", a.route || ""].join(" ").toLowerCase().includes(n));
  }, [items, q]);
  const byCat = useMemo(() => {
    const m = new Map<string, ManualArticle[]>();
    for (const a of filtered) { const arr = m.get(a.category) || []; arr.push(a); m.set(a.category, arr); }
    const order = data?.categories || [];
    return [...m.entries()].sort((x, y) => (order.indexOf(x[0]) - order.indexOf(y[0])));
  }, [filtered, data]);

  const copyAll = useCallback(async () => {
    const txt = byCat.map(([cat, arr]) => `## ${cat} (${arr.length})\n` + arr.map((a) =>
      `• ${a.title}\n  Percorso: ${a.path}${a.route ? `\n  Link: ${a.route}` : ""}\n  Cosa fa: ${a.desc || a.body}\n  Come si usa: ${a.how || "—"}`).join("\n")).join("\n\n");
    try { await Clipboard.setStringAsync(txt); notify("Copiato", `${filtered.length} funzioni copiate come testo`); } catch { notify("Errore", "Copia non riuscita"); }
  }, [byCat, filtered.length]);

  const open = (a: ManualArticle) => { const r = a.route ? resolveNavRoute(a.route) : null; if (r) router.push(r as any); };

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="app-map-screen">
      <View style={s.head}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/master" as any))} hitSlop={10} style={s.back} testID="app-map-back"><Ionicons name="chevron-back" size={22} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{"Mappa completa dell'app"}</Text>
          <Text style={s.sub}>{data ? `${items.length} funzioni · ${byCat.length} categorie` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={copyAll} hitSlop={8} style={s.iconBtn} testID="app-map-copy" accessibilityLabel="Copia elenco"><Ionicons name="copy-outline" size={20} color={HT.brand} /></Pressable>
      </View>
      <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={s.searchRow}>
          <Ionicons name="search" size={18} color={HT.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Filtra per nome, percorso, testo…" placeholderTextColor={HT.muted} style={s.input} autoCorrect={false} testID="app-map-search" />
          {q ? <Pressable onPress={() => setQ("")} hitSlop={8} testID="app-map-search-clear"><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
        </View>
        {!data ? <ActivityIndicator color={HT.brand} style={{ marginTop: 24 }} /> : null}
        {data && !filtered.length ? <Text style={s.empty}>Nessuna funzione corrisponde a «{q}».</Text> : null}
        {byCat.map(([cat, arr]) => {
          const isCollapsed = !!collapsed[cat] && !q;
          return (
            <View key={cat} style={s.catCard} testID={`app-map-cat-${cat}`}>
              <Pressable onPress={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))} style={s.catHead}>
                <Ionicons name={isCollapsed ? "chevron-forward" : "chevron-down"} size={18} color={HT.brand} />
                <Text style={s.catTitle}>{cat}</Text>
                <Text style={s.catCount}>{arr.length}</Text>
              </Pressable>
              {!isCollapsed ? arr.map((a) => {
                const canOpen = !!(a.route && resolveNavRoute(a.route));
                return (
                  <View key={a.id} style={s.item} testID={`app-map-item-${a.id}`}>
                    <Text style={s.itemTitle}>{a.title}</Text>
                    <Text style={s.itemPath}>📍 {a.path}{a.route ? `  ·  ${a.route}` : ""}</Text>
                    <Text style={s.itemBody}>{a.desc || a.body}</Text>
                    {a.how ? (<><Text style={s.howLabel}>Come si usa</Text><Text style={s.itemBody}>{a.how}</Text></>) : null}
                    {canOpen ? (
                      <Pressable onPress={() => open(a)} style={s.openBtn} testID={`app-map-open-${a.id}`}>
                        <Ionicons name="open-outline" size={14} color={HT.bg} /><Text style={s.openTxt}>Apri</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              }) : null}
            </View>
          );
        })}
      </KScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: HT.text, fontWeight: "800", fontSize: 18 },
  sub: { color: HT.muted, fontSize: 12.5 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 12, paddingHorizontal: 12, minHeight: 46, borderWidth: 1, borderColor: HT.border },
  input: { flex: 1, color: HT.text, fontSize: 15, paddingVertical: Platform.OS === "web" ? 10 : 8 },
  empty: { color: HT.muted, textAlign: "center", marginTop: 16 },
  catCard: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  catHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, minHeight: 48 },
  catTitle: { flex: 1, color: HT.text, fontWeight: "800", fontSize: 15 },
  catCount: { color: HT.brand, fontWeight: "800", fontSize: 13, backgroundColor: HT.brandTint, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: "hidden" },
  item: { paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HT.border, gap: 3 },
  itemTitle: { color: HT.text, fontWeight: "700", fontSize: 14.5 },
  itemPath: { color: HT.brand, fontSize: 12.5 },
  itemBody: { color: HT.text2, fontSize: 13.5, lineHeight: 19 },
  howLabel: { color: HT.brand, fontSize: 11.5, fontWeight: "800", marginTop: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  openBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.brand, paddingHorizontal: 12, minHeight: 36, borderRadius: 10, marginTop: 6 },
  openTxt: { color: HT.bg, fontWeight: "800", fontSize: 13 },
});

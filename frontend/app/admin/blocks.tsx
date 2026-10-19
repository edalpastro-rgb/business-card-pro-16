// app/admin/blocks.tsx — tag 2026-10-19 (blocchi) — Pannello SuperMaster: BLOCCHI per organizzazione (licenza).
// Lista delle organizzazioni (Master radice) × catalogo blocchi, con uno switch per abilitare/disabilitare ciascun blocco
// senza deploy (PUT /admin/blocks/{tenant_id}/{key}). Spento = sparisce dal menu di TUTTI gli utenti dell'organizzazione.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Switch, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { MENU_CATEGORIES } from "@/src/menuCategories";
import { notify } from "@/src/utils/notify";
import type { Block } from "@/src/useBlocks";

type Org = { tenant_id: string; name: string; email: string; company: string; tier: string; enabled_keys: string[] };

export default function AdminBlocksScreen() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Block[]>([]);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cat = MENU_CATEGORIES.blocks;

  const load = useCallback(async () => {
    try { const r = await api<{ catalog: Block[]; orgs: Org[] }>("/admin/blocks"); setCatalog(r.catalog || []); setOrgs(r.orgs || []); setErr(null); }
    catch (e: any) { setErr(e?.message || "Accesso riservato al SuperMaster"); setOrgs([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (org: Org, key: string, enabled: boolean) => {
    const id = `${org.tenant_id}:${key}`;
    setBusy(id);
    try {
      const r = await api<{ enabled_keys: string[] }>(`/admin/blocks/${org.tenant_id}/${key}`, { method: "PUT", body: { enabled } });
      setOrgs((prev) => (prev || []).map((o) => (o.tenant_id === org.tenant_id ? { ...o, enabled_keys: r.enabled_keys } : o)));
    } catch (e: any) { notify("Errore", e?.message || "Modifica non salvata"); }
    finally { setBusy(null); }
  };

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (orgs || []).filter((o) => !t || `${o.name} ${o.email} ${o.company}`.toLowerCase().includes(t));
  }, [orgs, q]);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="admin-blocks-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={[s.hIcon, { backgroundColor: cat.soft }]}><Ionicons name={cat.icon as any} size={18} color={cat.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Blocchi per licenza</Text>
          <Text style={s.hSub}>{orgs ? `${orgs.length} organizzazioni · ${catalog.length} blocchi disponibili` : "Caricamento…"}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }} testID="admin-blocks-list">
        <View style={s.info}>
          <Ionicons name="information-circle-outline" size={16} color={cat.color} />
          <Text style={s.infoTxt}>Ogni switch accende o spegne il blocco per TUTTI gli utenti dell&apos;organizzazione, subito e senza deploy. Blocco spento = non compare nel menu «BLOCCHI» (nemmeno al Master).</Text>
        </View>
        <View style={s.catalog} testID="admin-blocks-catalog">
          <Text style={s.catTitle}>Catalogo</Text>
          {catalog.map((b) => (
            <View key={b.key} style={s.catRow}>
              <Ionicons name={b.icon as any} size={16} color={b.color} />
              <Text style={s.catName}>{b.label}</Text>
              {b.children?.length ? <Text style={s.catSub}>{b.children.map((c) => c.label).join(" · ")}</Text> : null}
            </View>
          ))}
        </View>
        <View style={s.searchBox}>
          <Ionicons name="search" size={16} color={HT.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Cerca organizzazione (nome, email, azienda)" placeholderTextColor={HT.muted} style={s.searchInput} autoCorrect={false} testID="admin-blocks-search" />
        </View>
        {err ? <Text style={s.err} testID="admin-blocks-error">{err}</Text> : null}
        {!orgs ? <ActivityIndicator color={cat.color} style={{ marginTop: 20 }} /> : visible.length === 0 ? (
          <Text style={s.empty}>Nessuna organizzazione trovata.</Text>
        ) : visible.map((o) => (
          <View key={o.tenant_id} style={s.org} testID={`admin-blocks-org-${o.tenant_id}`}>
            <View style={s.orgHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.orgName}>{o.name}{o.company ? ` · ${o.company}` : ""}</Text>
                <Text style={s.orgMail}>{o.email} · {o.tier}</Text>
              </View>
              <View style={s.pill}><Text style={s.pillTxt}>{o.enabled_keys.length}/{catalog.length}</Text></View>
            </View>
            {catalog.map((b) => {
              const on = o.enabled_keys.includes(b.key);
              const id = `${o.tenant_id}:${b.key}`;
              return (
                <View key={b.key} style={s.row}>
                  <Ionicons name={b.icon as any} size={18} color={on ? b.color : HT.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowLbl, !on && { color: HT.muted }]}>{b.label}</Text>
                    {b.children?.length ? <Text style={s.rowSub}>{b.children.map((c) => c.label).join(" · ")}</Text> : null}
                  </View>
                  {busy === id ? <ActivityIndicator size="small" color={b.color} /> : (
                    <Switch value={on} onValueChange={(v) => toggle(o, b.key, v)} trackColor={{ true: b.color, false: HT.border }} thumbColor="#FFFFFF" testID={`admin-blocks-switch-${o.tenant_id}-${b.key}`} />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  hIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  hTitle: { color: HT.text, fontSize: 17, fontWeight: "900" },
  hSub: { color: HT.muted, fontSize: 12 },
  info: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: HT.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.border },
  infoTxt: { flex: 1, color: HT.text2, fontSize: 12.5, lineHeight: 18 },
  catalog: { backgroundColor: HT.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.border, gap: 6 },
  catTitle: { color: HT.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  catName: { color: HT.text, fontWeight: "800", fontSize: 13.5 },
  catSub: { color: HT.muted, fontSize: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, color: HT.text, fontSize: 14, paddingVertical: 8 },
  err: { color: HT.danger, fontSize: 13 },
  empty: { color: HT.muted, textAlign: "center", marginTop: 20 },
  org: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 6 },
  orgHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border },
  orgName: { color: HT.text, fontWeight: "900", fontSize: 14.5 },
  orgMail: { color: HT.muted, fontSize: 12 },
  pill: { backgroundColor: HT.card2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillTxt: { color: HT.text2, fontSize: 11.5, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  rowLbl: { color: HT.text, fontWeight: "800", fontSize: 14 },
  rowSub: { color: HT.muted, fontSize: 11.5 },
});

// app/axon-lab/business.tsx — V50.z343 — AXON LAB · AREA CONSULENTE: pratiche di compilazione (cliente CRM o nuovo)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";
import type { LabPractice } from "@/src/axonlab/labApi";

type Contact = { contact_id: string; first_name?: string; last_name?: string; company?: string; city?: string; address_city?: string };
const STATUS: Record<string, { label: string; color: string }> = { docs: { label: "Documenti", color: HT.warning }, review: { label: "In revisione", color: HT.brand }, done: { label: "Completata", color: HT.success } };

export default function AxonLabBusiness() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<LabPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState(""); const [found, setFound] = useState<Contact[]>([]); const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<{ items: LabPractice[] }>("/lab/practices"); setItems(r.items || []); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!creating || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { const r = await api<{ items: Contact[] }>(`/contacts?q=${encodeURIComponent(q.trim())}`); setFound((r.items || []).slice(0, 8)); } catch { setFound([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, creating]);

  const start = async (c: Contact) => {
    try {
      const p = await api<LabPractice>("/lab/practices", { method: "POST", body: { contact_id: c.contact_id } });
      setCreating(false); setQ("");
      router.push(`/axon-lab/practice/${p.practice_id}` as any);
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader icon="document-text" title="Compilazione CRT" sub="Step 1 · Scegli il cliente: i suoi documenti compaiono subito"
        right={<Pressable onPress={() => setCreating((v) => !v)} style={s.newBtn} testID="lab-practice-new"><Ionicons name={creating ? "close" : "add"} size={20} color={HT.white} /></Pressable>} testID="lab-business" />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
        {creating ? (
          <View style={L.card} testID="lab-practice-create">
            <Text style={L.cardTitle}>Step 1 · Selezione cliente</Text>
            <Text style={L.cardSub}>Scegli un cliente esistente dal CRM: i documenti già nel suo profilo appariranno in verde, quelli mancanti in rosso.</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Cerca cliente (nome, azienda…)" placeholderTextColor={HT.muted} style={L.input} autoFocus testID="lab-contact-search" />
            {searching ? <ActivityIndicator size="small" color={HT.brand} /> : null}
            {found.map((c) => (
              <Pressable key={c.contact_id} onPress={() => start(c)} style={s.contactRow} testID={`lab-contact-${c.contact_id}`}>
                <View style={s.avatar}><Text style={s.avatarTxt}>{`${(c.first_name || c.company || "?")[0]}${(c.last_name || "")[0] || ""}`.toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cName}>{`${c.first_name || ""} ${c.last_name || ""}`.trim() || c.company}</Text>
                  {c.company ? <Text style={L.muted}>{c.company}{c.address_city ? ` · ${c.address_city}` : ""}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={HT.muted} />
              </Pressable>
            ))}
            {q.trim().length >= 2 && !searching && found.length === 0 ? <Text style={L.muted}>Nessun cliente trovato.</Text> : null}
            <Pressable onPress={() => router.push("/contact/new" as any)} style={[L.btn, L.btnGhost]} testID="lab-contact-create"><Ionicons name="person-add" size={16} color={HT.brand} /><Text style={[L.btnTxt, { color: HT.brand }]}>Crea nuovo cliente</Text></Pressable>
          </View>
        ) : null}

        {!loading && items.length === 0 && !creating ? (
          <View style={L.card}><Text style={L.cardTitle}>Nessuna pratica</Text><Text style={L.cardSub}>Tocca + e scegli un cliente dal CRM per iniziare la compilazione.</Text></View>
        ) : null}
        {items.map((p) => {
          const st = STATUS[p.status] || STATUS.docs;
          return (
            <Pressable key={p.practice_id} onPress={() => router.push(`/axon-lab/practice/${p.practice_id}` as any)} style={[L.card, s.row]} testID={`lab-practice-${p.practice_id}`}>
              <View style={[s.avatar, { backgroundColor: HT.brandTint }]}><Ionicons name="document-text" size={18} color={HT.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={L.cardTitle} numberOfLines={1}>{p.contact_name}{p.company ? ` · ${p.company}` : ""}</Text>
                <Text style={L.cardSub}>{(p.form_ids || []).length} moduli · {p.updated_at ? new Date(p.updated_at).toLocaleDateString("it-IT") : ""}</Text>
              </View>
              <View style={[s.pill, { backgroundColor: `${st.color}22` }]}><Text style={[s.pillTxt, { color: st.color }]}>{st.label}</Text></View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: HT.border, minHeight: 50 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: HT.text, fontWeight: "900", fontSize: 13 },
  cName: { color: HT.text, fontWeight: "800", fontSize: 14 },
  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },
});

// crt/index.tsx — V50.z282 — COMPILAZIONE CRT: elenco pratiche + nuova pratica (cliente + servizi multi) + zona esempi (Master)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CrtFilePick } from "@/src/CrtFilePick";

type Practice = { practice_id: string; title: string; contact_name: string; services: string[]; status: string; updated_at: string; merged_pdf?: { name: string } | null };
type Contact = { contact_id: string; first_name: string; last_name: string; company?: string };
export const SVC = { luce: { label: "Luce", icon: "flash", color: "#F59E0B" }, gas: { label: "Gas", icon: "flame", color: "#EF4444" }, telco: { label: "Telco", icon: "call", color: "#0EA5E9" } } as const;
export const STATUS_LABEL: Record<string, string> = { bozza: "Bozza", completa: "Completa", inviata: "Inviata", attivata: "Attivata", ko: "KO" };

export default function CrtListScreen() {
  const router = useRouter();
  const { contact_id } = useLocalSearchParams<{ contact_id?: string }>();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Practice[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(!!contact_id);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Contact | null>(null);
  const [services, setServices] = useState<string[]>(["luce"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [order, setOrder] = useState<{ doc_order: string[]; labels: Record<string, string>; from_example: boolean; example_name?: string } | null>(null);
  const isMaster = (user as any)?.role === "owner" || (user as any)?.is_owner;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Practice[] }>("/crt"); setItems(r.items);
      const c = await api<{ items: Contact[] }>("/contacts"); setContacts(c.items || []);
      if (contact_id) setSel((c.items || []).find((x) => x.contact_id === contact_id) || null);
      try { setOrder(await api("/crt/settings/order")); } catch { /* noop */ }
    } catch (e: any) { notify("CRT", e?.message || ""); } finally { setLoading(false); }
  }, [contact_id]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!sel) { notify("CRT", "Seleziona il cliente"); return; }
    setBusy("create");
    try { const p = await api<Practice>("/crt", { method: "POST", body: { contact_id: sel.contact_id, services } }); router.push(`/crt/${p.practice_id}` as any); }
    catch (e: any) { notify("CRT", e?.message || ""); } finally { setBusy(null); }
  };
  const uploadOrderExample = async (f: { name: string; data_base64: string }) => {
    setBusy("order");
    try { const r = await api<any>("/crt/dossier-example", { method: "POST", body: { name: f.name, data_base64: f.data_base64 } }); setOrder({ doc_order: r.doc_order, labels: r.labels, from_example: true, example_name: f.name }); notify("Esempio pratica", `Ordine appreso: ${r.doc_order.map((k: string) => r.labels[k]).join(" → ")}`); }
    catch (e: any) { notify("Esempio pratica", e?.message || ""); } finally { setBusy(null); }
  };
  const filtered = contacts.filter((c) => `${c.first_name} ${c.last_name} ${c.company || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.surface }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="crt-back"><Ionicons name="chevron-back" size={24} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Compilazione CRT</Text><Text style={s.sub}>Pratiche contratto: dossier, fatture, moduli compilati da Axon, PDF unico</Text></View>
        <Pressable onPress={() => setCreating((v) => !v)} style={s.newBtn} testID="crt-new"><Ionicons name={creating ? "close" : "add"} size={20} color="#FFF" /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {creating ? (
          <View style={s.card} testID="crt-create">
            <Text style={s.section}>Nuova pratica</Text>
            <Text style={s.label}>Cliente</Text>
            {sel ? <Pressable onPress={() => setSel(null)} style={s.selRow} testID="crt-selected-contact"><Ionicons name="person" size={16} color={theme.color.brandPrimary} /><Text style={{ flex: 1, fontWeight: "800", color: theme.color.onSurface }}>{sel.first_name} {sel.last_name}{sel.company ? ` · ${sel.company}` : ""}</Text><Ionicons name="close" size={16} color={theme.color.muted} /></Pressable> : (
              <>
                <TextInput value={q} onChangeText={setQ} placeholder="Cerca cliente…" placeholderTextColor={theme.color.muted} style={s.input} testID="crt-contact-search" />
                {q ? filtered.map((c) => <Pressable key={c.contact_id} onPress={() => { setSel(c); setQ(""); }} style={s.selRow} testID={`crt-pick-${c.contact_id}`}><Text style={{ color: theme.color.onSurface }}>{c.first_name} {c.last_name}{c.company ? ` · ${c.company}` : ""}</Text></Pressable>) : null}
              </>
            )}
            <Text style={s.label}>Servizi (anche più di uno)</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(Object.keys(SVC) as (keyof typeof SVC)[]).map((k) => { const on = services.includes(k); return (
                <Pressable key={k} onPress={() => setServices((l) => (on ? l.filter((x) => x !== k) : [...l, k]))} style={[s.chip, on && { backgroundColor: SVC[k].color, borderColor: SVC[k].color }]} testID={`crt-svc-${k}`}><Ionicons name={SVC[k].icon as any} size={14} color={on ? "#FFF" : SVC[k].color} /><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{SVC[k].label}</Text></Pressable>
              ); })}
            </View>
            <Pressable onPress={create} disabled={busy === "create" || !services.length} style={[s.btn, { backgroundColor: theme.color.brandPrimary }]} testID="crt-create-submit">{busy === "create" ? <ActivityIndicator color="#FFF" /> : <Text style={s.btnTxt}>Crea pratica</Text>}</Pressable>
          </View>
        ) : null}

        {items.length === 0 && !loading ? <Text style={s.hint}>Nessuna pratica: tocca + per iniziare una Compilazione CRT.</Text> : null}
        {items.map((p) => (
          <Pressable key={p.practice_id} onPress={() => router.push(`/crt/${p.practice_id}` as any)} style={s.card} testID={`crt-item-${p.practice_id}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.section, { flex: 1 }]} numberOfLines={1}>{p.title}</Text>
              <Text style={[s.badge, p.status === "bozza" ? { backgroundColor: "#FEF3C7", color: "#92400E" } : { backgroundColor: "#DCFCE7", color: "#166534" }]}>{STATUS_LABEL[p.status] || p.status}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              {p.services.map((k) => <Ionicons key={k} name={(SVC as any)[k]?.icon || "document"} size={14} color={(SVC as any)[k]?.color || theme.color.muted} />)}
              <Text style={s.hint}>{p.contact_name} · {new Date(p.updated_at).toLocaleDateString("it-IT")}{p.merged_pdf ? " · 📎 PDF unico pronto" : ""}</Text>
            </View>
          </Pressable>
        ))}

        {isMaster ? (
          <View style={s.card} testID="crt-order-example">
            <Text style={s.section}>📚 Esempio pratica completa (ordine documenti)</Text>
            <Text style={s.hint}>Carica un contratto completo già organizzato: Axon riconosce la sequenza dei documenti e la usa come ordine standard del PDF unico.</Text>
            {order ? <Text style={[s.hint, { color: theme.color.onSurface }]}>{order.from_example ? `Ordine appreso da «${order.example_name}»` : "Ordine predefinito"}: {order.doc_order.map((k) => order.labels[k] || k).join(" → ")}</Text> : null}
            {busy === "order" ? <ActivityIndicator color={theme.color.brandPrimary} /> : <CrtFilePick label="Carica esempio" compact onPicked={(f) => void uploadOrderExample(f)} testID="crt-order-pick" />}
            <Text style={s.hint}>I moduli vuoti e gli esempi compilati dei fornitori si caricano in «Modelli moduli» (non vengono memorizzati oltre il necessario: ricaricali quando il fornitore li aggiorna).</Text>
            <Pressable onPress={() => router.push("/form-templates" as any)} style={[s.btn, s.ghost]} testID="crt-goto-templates"><Ionicons name="document-attach-outline" size={16} color={theme.color.brandPrimary} /><Text style={[s.btnTxt, { color: theme.color.brandPrimary }]}>Apri Modelli moduli</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export const crtStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF" },
  hBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, title: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface }, sub: { fontSize: 12, color: theme.color.muted },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 14, gap: 10 },
  section: { fontSize: 14, fontWeight: "900", color: theme.color.onSurface }, label: { fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 12, color: theme.color.muted, lineHeight: 17 }, badge: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  input: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, fontSize: 14, color: theme.color.onSurface },
  selRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 10, borderRadius: 10, backgroundColor: theme.color.surface },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" }, chipTxt: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12, paddingHorizontal: 14 }, ghost: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  btnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
});
const s = crtStyles;

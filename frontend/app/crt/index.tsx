// crt/index.tsx — V50.z282 — COMPILAZIONE CRT: elenco pratiche + nuova pratica (cliente + servizi multi) + zona esempi (Master)
// V50.z332 — Redesign elenco: riepilogo, CTA «Nuova pratica», card pratica (servizi/stato/PDF), blocco Master «Modelli e ordine documenti» con drag & drop
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CrtFilePick } from "@/src/CrtFilePick";
import { CrtDocOrder } from "@/src/CrtDocOrder"; // V50.z286
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

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
  type OrderInfo = { doc_order: string[]; excluded: string[]; custom_types: Record<string, string>; labels: Record<string, string>; source: string; from_example: boolean; example_name?: string };
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [orderDirty, setOrderDirty] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
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
    try { const r = await api<any>("/crt/dossier-example", { method: "POST", body: { name: f.name, data_base64: f.data_base64 } }); setOrder(await api<OrderInfo>("/crt/settings/order")); setOrderDirty(false); notify("Esempio pratica", `Ordine appreso: ${r.doc_order.map((k: string) => r.labels[k]).join(" → ")}`); }
    catch (e: any) { notify("Esempio pratica", e?.message || ""); } finally { setBusy(null); }
  };
  // V50.z286 — ordine predefinito modificabile a mano: salva / ripristina / tipologie personalizzate
  const saveOrder = async () => {
    if (!order) return;
    setBusy("order-save");
    try { setOrder(await api<OrderInfo>("/crt/settings/order", { method: "PUT", body: { doc_order: order.doc_order, excluded: order.excluded, custom_types: order.custom_types } })); setOrderDirty(false); notify("Ordine documenti", "Ordine predefinito salvato: vale per tutte le nuove pratiche"); }
    catch (e: any) { notify("Ordine documenti", e?.message || ""); } finally { setBusy(null); }
  };
  const resetOrder = async () => {
    setBusy("order-save");
    try { setOrder(await api<OrderInfo>("/crt/settings/order", { method: "DELETE" })); setOrderDirty(false); notify("Ordine documenti", "Ordine predefinito ripristinato"); }
    catch (e: any) { notify("Ordine documenti", e?.message || ""); } finally { setBusy(null); }
  };
  const addCustom = (label: string) => {
    if (!order) return;
    const id = "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
    if (order.doc_order.includes(id)) return;
    setOrder({ ...order, doc_order: [...order.doc_order, id], custom_types: { ...order.custom_types, [id]: label }, labels: { ...order.labels, [id]: label } }); setOrderDirty(true);
  };
  const filtered = contacts.filter((c) => `${c.first_name} ${c.last_name} ${c.company || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

  const nBozza = items.filter((p) => p.status === "bozza").length;
  const nPdf = items.filter((p) => !!p.merged_pdf).length;
  const STATUS_STYLE: Record<string, { bg: string; fg: string }> = { bozza: { bg: HT.warningTint, fg: "#FDBA74" }, completa: { bg: HT.successTint, fg: HT.success }, inviata: { bg: HT.axonTint, fg: HT.axon }, attivata: { bg: HT.successTint, fg: HT.success }, ko: { bg: HT.dangerTint, fg: HT.danger } };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="crt-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Compilazione CRT</Text><Text style={s.sub}>Axon compila i moduli, tu controlli e firmi</Text></View>
        <Pressable onPress={() => setCreating((v) => !v)} style={s.newBtn} testID="crt-new"><Ionicons name={creating ? "close" : "add"} size={20} color="#FFF" /></Pressable>
      </View>
      <KScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {/* Riepilogo */}
        <View style={s.statRow} testID="crt-stats">
          <View style={s.stat}><Text style={s.statN}>{items.length}</Text><Text style={s.statL}>Pratiche</Text></View>
          <View style={s.stat}><Text style={[s.statN, { color: HT.warning }]}>{nBozza}</Text><Text style={s.statL}>In bozza</Text></View>
          <View style={s.stat}><Text style={[s.statN, { color: HT.success }]}>{nPdf}</Text><Text style={s.statL}>PDF unico pronto</Text></View>
        </View>

        {/* Nuova pratica */}
        {creating ? (
          <View style={s.card} testID="crt-create">
            <Text style={s.section}>NUOVA PRATICA</Text>
            <Text style={s.label}>Cliente</Text>
            {sel ? <Pressable onPress={() => setSel(null)} style={s.selRow} testID="crt-selected-contact"><Ionicons name="person" size={16} color={HT.brand} /><Text style={{ flex: 1, fontWeight: "800", color: HT.text }}>{sel.first_name} {sel.last_name}{sel.company ? ` · ${sel.company}` : ""}</Text><Ionicons name="close" size={16} color={HT.muted} /></Pressable> : (
              <>
                <TextInput value={q} onChangeText={setQ} placeholder="Cerca cliente…" placeholderTextColor={HT.muted} style={s.input} testID="crt-contact-search" />
                {q ? filtered.map((c) => <Pressable key={c.contact_id} onPress={() => { setSel(c); setQ(""); }} style={s.selRow} testID={`crt-pick-${c.contact_id}`}><Text style={{ color: HT.text }}>{c.first_name} {c.last_name}{c.company ? ` · ${c.company}` : ""}</Text></Pressable>) : null}
                {q && !filtered.length ? <Pressable onPress={() => router.push("/contact/new" as any)} style={s.selRow} testID="crt-new-contact"><Ionicons name="person-add-outline" size={16} color={HT.brand} /><Text style={{ color: HT.brand, fontWeight: "800" }}>Nessun risultato · crea nuovo contatto</Text></Pressable> : null}
              </>
            )}
            <Text style={s.label}>Servizi (anche più di uno)</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(Object.keys(SVC) as (keyof typeof SVC)[]).map((k) => { const on = services.includes(k); return (
                <Pressable key={k} onPress={() => setServices((l) => (on ? l.filter((x) => x !== k) : [...l, k]))} style={[s.chip, on && { backgroundColor: SVC[k].color, borderColor: SVC[k].color }]} testID={`crt-svc-${k}`}><Ionicons name={SVC[k].icon as any} size={14} color={on ? "#FFF" : SVC[k].color} /><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{SVC[k].label}</Text></Pressable>
              ); })}
            </View>
            <Pressable onPress={create} disabled={busy === "create" || !services.length} style={[s.btn, { backgroundColor: HT.brand }]} testID="crt-create-submit">{busy === "create" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={s.btnTxt}>Crea pratica e apri i 4 blocchi</Text></>}</Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setCreating(true)} style={s.ctaCard} testID="crt-new-cta">
            <View style={s.ctaIcon}><Ionicons name="add" size={26} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.ctaTitle}>Nuova pratica</Text>
              <Text style={s.hint}>Scegli il cliente e i servizi: Axon prepara dossier, moduli e PDF unico in 4 blocchi.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
        )}

        {/* Pratiche */}
        <Text style={s.section}>PRATICHE</Text>
        {items.length === 0 && !loading ? (
          <View style={[s.card, { alignItems: "center", paddingVertical: 22 }]} testID="crt-empty">
            <Ionicons name="folder-open-outline" size={30} color={HT.muted} />
            <Text style={[s.hint, { textAlign: "center" }]}>Nessuna pratica ancora. Tocca «Nuova pratica» per iniziare la prima Compilazione CRT.</Text>
          </View>
        ) : null}
        {items.map((p) => {
          const st = STATUS_STYLE[p.status] || STATUS_STYLE.bozza;
          return (
            <Pressable key={p.practice_id} onPress={() => router.push(`/crt/${p.practice_id}` as any)} style={s.pratica} testID={`crt-item-${p.practice_id}`}>
              <View style={s.svcCol}>
                {p.services.map((k) => <View key={k} style={[s.svcDot, { backgroundColor: (SVC as any)[k]?.color || HT.muted }]}><Ionicons name={(SVC as any)[k]?.icon || "document"} size={13} color="#FFF" /></View>)}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.praticaTitle} numberOfLines={1}>{p.contact_name || p.title}</Text>
                <Text style={s.hint} numberOfLines={1}>{p.services.map((k) => (SVC as any)[k]?.label || k).join(" + ")} · agg. {new Date(p.updated_at).toLocaleDateString("it-IT")}</Text>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Text style={[s.badge, { backgroundColor: st.bg, color: st.fg }]}>{STATUS_LABEL[p.status] || p.status}</Text>
                  <Text style={[s.badge, p.merged_pdf ? { backgroundColor: HT.successTint, color: HT.success } : { backgroundColor: HT.card2, color: HT.muted }]}>{p.merged_pdf ? "📎 PDF unico pronto" : "PDF unico da comporre"}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={HT.muted} />
            </Pressable>
          );
        })}

        {/* Master: modelli e ordine documenti */}
        {isMaster ? (
          <>
            <Text style={[s.section, { marginTop: 6 }]}>MODELLI E ORDINE DOCUMENTI · Master</Text>
            <View style={s.card} testID="crt-order-example">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={[s.blockIcon, { backgroundColor: HT.violetTint }]}><Ionicons name="school-outline" size={20} color="#7C3AED" /></View>
                <View style={{ flex: 1 }}><Text style={s.cardTitle}>Esempio pratica completa</Text><Text style={s.hint}>Axon impara la sequenza dei documenti e la usa come ordine standard del PDF unico.</Text></View>
              </View>
              {busy === "order" ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator color="#7C3AED" /><Text style={s.hint}>Axon sta leggendo l&apos;esempio…</Text></View> : <CrtFilePick label="Carica esempio" compact dropZone dropHint="Trascina qui la pratica completa (PDF) oppure" onPicked={(f) => void uploadOrderExample(f)} testID="crt-order-pick" />}
              {order ? (
                <View style={{ gap: 8 }}>
                  <Pressable onPress={() => setOrderOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }} testID="crt-order-toggle">
                    <Ionicons name="swap-vertical" size={16} color={HT.brand} />
                    <Text style={[s.hint, { color: HT.text, flex: 1 }]} numberOfLines={orderOpen ? undefined : 2}>{order.source === "example" ? `Ordine appreso da «${order.example_name}»` : order.source === "manual" ? "Ordine personalizzato" : "Ordine predefinito"}: {order.doc_order.filter((k) => !order.excluded.includes(k)).map((k) => order.labels[k] || k).join(" → ")}</Text>
                    <Ionicons name={orderOpen ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
                  </Pressable>
                  {orderOpen ? (
                    <>
                      <CrtDocOrder order={order.doc_order} excluded={order.excluded} labels={order.labels} onChange={(o, e) => { setOrder({ ...order, doc_order: o, excluded: e }); setOrderDirty(true); }} onAddCustom={addCustom} testID="crt-order" />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable onPress={saveOrder} disabled={!orderDirty || busy === "order-save"} style={[s.btn, { flex: 1, backgroundColor: HT.brand }, !orderDirty && { opacity: 0.5 }]} testID="crt-order-save">{busy === "order-save" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="save-outline" size={16} color="#FFF" /><Text style={s.btnTxt}>Salva come predefinito</Text></>}</Pressable>
                        <Pressable onPress={resetOrder} disabled={busy === "order-save"} style={[s.btn, s.ghost]} testID="crt-order-reset"><Ionicons name="refresh" size={16} color={HT.brand} /><Text style={[s.btnTxt, { color: HT.brand }]}>Ripristina</Text></Pressable>
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
            <Pressable onPress={() => router.push("/form-templates" as any)} style={s.card} testID="crt-goto-templates">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={[s.blockIcon, { backgroundColor: HT.brandTint }]}><Ionicons name="document-attach-outline" size={20} color={HT.brand} /></View>
                <View style={{ flex: 1 }}><Text style={s.cardTitle}>Modelli moduli dei fornitori</Text><Text style={s.hint}>Moduli vuoti ed esempi compilati per Luce, Gas e Telco. Ricaricali quando il fornitore li aggiorna.</Text></View>
                <Ionicons name="chevron-forward" size={18} color={HT.muted} />
              </View>
            </Pressable>
          </>
        ) : null}
      </KScrollView>
    </SafeAreaView>
  );
}

export const crtStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  hBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  section: { fontSize: 14, fontWeight: "900", color: HT.text }, label: { fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 }, badge: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, fontSize: 14, color: HT.text },
  selRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 10, borderRadius: 10, backgroundColor: HT.card2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card }, chipTxt: { fontSize: 13, fontWeight: "800", color: HT.text },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 12, paddingHorizontal: 14 }, ghost: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  btnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  // V50.z332 — elenco ridisegnato (stesso linguaggio dei 4 blocchi)
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 10, alignItems: "center", gap: 2 },
  statN: { fontSize: 20, fontWeight: "900", color: HT.text }, statL: { fontSize: 10, fontWeight: "700", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "center" },
  ctaCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 16, borderWidth: 1.5, borderColor: HT.brand, padding: 14, minHeight: 72 },
  ctaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  ctaTitle: { fontSize: 16, fontWeight: "900", color: HT.brand },
  pratica: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12 },
  praticaTitle: { fontSize: 15, fontWeight: "900", color: HT.text },
  svcCol: { gap: 4 }, svcDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  blockIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 14, fontWeight: "900", color: HT.text },
});
const s = crtStyles;

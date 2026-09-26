// crt/[id].tsx — V50.z282 — Pratica CRT: servizi · dossier documenti (Axon estrae) · per servizio: fatture → forniture (una per POD/PDR,
// consumo 12 mesi stimato) → modelli → compila (replica automatica) → verifica · PDF unico + condivisione (WhatsApp/mail/QR code)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, Image, Modal } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CrtFilePick, PickedFile } from "@/src/CrtFilePick";
import { CrtDocOrder } from "@/src/CrtDocOrder"; // V50.z286
import { CrtTrainingBlock } from "@/src/CrtTrainingBlock"; // V50.z326 — BLOCCO 1
import { CrtSaveShareBlock } from "@/src/CrtSaveShareBlock"; // V50.z326 — BLOCCO 4
import { useAuth } from "@/src/auth";
import { SVC, STATUS_LABEL, crtStyles as s } from "./index";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Supply = { supply_id: string; pod: string; pdr: string; line_number: string; supply_address: string; meter_power_kw: string; voltage: string; current_supplier: string; months_count: number; annual: number | null; annual_method: string; unit: string; bill_name: string; overrides: Record<string, any> };
type Svc = { bill_ids: string[]; supplies: Supply[]; template_ids: string[]; filled_form_ids: string[]; reuse_dossier: boolean; totals?: { supplies_count: number; annual_sum: number; estimated_count: number; insufficient_count: number } };
type Practice = {
  practice_id: string; title: string; contact_name: string; contact_id: string; services: string[]; status: string; dossier: Record<string, { extracted?: Record<string, string>; manual?: Record<string, string>; files?: { name: string }[]; confirmed?: boolean }>;
  per_service: Record<string, Svc>; merged_pdf?: { name: string; size: number; pages: number; too_big?: boolean } | null; doc_types: Record<string, string>;
  available_identity_docs: { doc_id: string; doc_type: string; expiry_date?: string }[]; available_bills: { bill_id: string; bill_type: string; file_name: string; extracted?: { pod?: string; pdr?: string; fornitore?: string } }[];
  filled_forms: { form_id: string; name: string; service: string; part: number; parts: number; missing: any[] }[];
  // V50.z286 — ordine documenti effettivo + data/luogo firma
  doc_order_effective: string[]; doc_excluded_effective: string[]; doc_order_labels: Record<string, string>; doc_order_is_override: boolean;
  sign_date?: string; sign_place?: string; sign_place_suggested: string; sign_date_effective: string;
};
const METHOD: Record<string, string> = { real: "reale 12 mesi", declared: "dichiarato in fattura", insufficient: "storico insufficiente (<4 mesi)" };
const fmtMethod = (m: string) => METHOD[m] || (m.startsWith("estimated_") ? `stimato su ${m.replace("estimated_", "").replace("m", "")} mesi` : m);

export default function CrtPracticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const { user } = useAuth();
  const isMaster = (user as any)?.role === "owner" || (user as any)?.is_owner;
  const [p, setP] = useState<Practice | null>(null);
  const [templates, setTemplates] = useState<{ template_id: string; name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [pickBills, setPickBills] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; qr_png_base64: string; expires_at: string } | null>(null);
  // V50.z286 — ordine documenti solo per questa pratica (bozza locale) + luogo firma
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderDraft, setOrderDraft] = useState<{ order: string[]; excluded: string[] } | null>(null);

  const load = useCallback(async () => {
    try { setP(await api<Practice>(`/crt/${id}`)); const t = await api<any>("/form-templates"); setTemplates(t.items || t || []); } catch (e: any) { notify("CRT", e?.message || ""); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!p) return <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={HT.brand} /></SafeAreaView>;

  const run = async (key: string, fn: () => Promise<void>, okMsg?: string) => { setBusy(key); try { await fn(); await load(); if (okMsg) notify("CRT", okMsg); } catch (e: any) { notify("CRT", e?.message || "Errore"); } finally { setBusy(null); } };
  const uploadDoc = (dt: string, f: PickedFile) => run(`doc-${dt}`, async () => { await api(`/crt/${id}/dossier/${dt}`, { method: "POST", body: { name: f.name, mime: f.mime, data_base64: f.data_base64 } }); }, `${p.doc_types[dt]}: dati estratti da Axon`);
  const saveManual = (dt: string) => run(`man-${dt}`, async () => { await api(`/crt/${id}/dossier/${dt}`, { method: "POST", body: { manual }, }); setOpenDoc(null); setManual({}); });
  const reuseId = (dt: string, doc_id: string) => run(`doc-${dt}`, async () => { await api(`/crt/${id}/dossier/${dt}`, { method: "POST", body: { reuse_identity_doc_id: doc_id } }); }, "Documento della scheda riutilizzato");
  const toggleBill = (svc: string, bid: string) => { const cur = p.per_service[svc]?.bill_ids || []; const next = cur.includes(bid) ? cur.filter((x) => x !== bid) : [...cur, bid]; void run(`bills-${svc}`, async () => { await api(`/crt/${id}/services/${svc}`, { method: "PUT", body: { bill_ids: next } }); }); };
  const selectAllBills = (svc: string) => run(`bills-${svc}`, async () => { await api(`/crt/${id}/services/${svc}`, { method: "PUT", body: { bill_ids: p.available_bills.filter((b) => b.bill_type === svc).map((b) => b.bill_id) } }); });
  const setAnnual = (svc: string, sid: string, v: string) => run(`ann-${sid}`, async () => { await api(`/crt/${id}/services/${svc}`, { method: "PUT", body: { supply_overrides: { [sid]: { annual: v ? Number(v.replace(/\D/g, "")) : null } } } }); });
  const fill = (svc: string, tid: string) => run(`fill-${svc}`, async () => { const r = await api<any>(`/crt/${id}/services/${svc}/fill`, { method: "POST", body: { template_id: tid } }); notify("Axon", `${r.supplies} forniture su ${r.copies} ${r.copies > 1 ? "copie del modulo" : "modulo"} (${r.rows_per_form} righe per modulo)`); });
  const merge = () => run("merge", async () => { await api<any>(`/crt/${id}/merge`, { method: "POST", body: { include_dossier: true } }); }, "Documento unico composto e salvato negli allegati del cliente");
  const qr = () => run("qr", async () => { setShare(await api<any>(`/crt/${id}/share-link`, { method: "POST" })); });
  const setStatus = (st: string) => run("status", async () => { await api(`/crt/${id}`, { method: "PUT", body: { status: st } }); });
  const setSignDate = (iso: string) => run("sign", async () => { await api(`/crt/${id}`, { method: "PUT", body: { sign_date: iso } }); }, iso ? "Data firma impostata: vale per tutti i moduli (ricompila per aggiornarli)" : "Data firma: data di compilazione");
  const savePlace = (v: string) => run("sign", async () => { await api(`/crt/${id}`, { method: "PUT", body: { sign_place: v } }); }, "Luogo firma salvato: vale per tutti i moduli (ricompila per aggiornarli)");
  const saveOrder = () => run("order", async () => { if (!orderDraft) return; await api(`/crt/${id}`, { method: "PUT", body: { doc_order: orderDraft.order, doc_excluded: orderDraft.excluded } }); setOrderDraft(null); setOrderOpen(false); }, "Ordine documenti salvato solo per questa pratica");
  const resetOrder = () => run("order", async () => { await api(`/crt/${id}`, { method: "PUT", body: { doc_order: [], doc_excluded: [] } }); setOrderDraft(null); setOrderOpen(false); }, "Questa pratica usa l’ordine predefinito");
  const DOSSIER_ORDER = Object.keys(p.doc_types);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="crt-detail-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title} numberOfLines={1}>{p.title}</Text><Text style={s.sub}>Autocompilazione CRT · {p.contact_name} · {STATUS_LABEL[p.status] || p.status}</Text></View>
      </View>
      <KScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }}>
        {/* V50.z326 — BLOCCO 1 · Modelli di addestramento */}
        <CrtTrainingBlock isMaster={!!isMaster} signDate={p.sign_date || ""} signDateEffective={p.sign_date_effective} signPlace={p.sign_place || ""} signPlaceSuggested={p.sign_place_suggested}
          onSignDate={(iso) => void setSignDate(iso)} onSignPlace={(v) => void savePlace(v)} busy={busy === "sign"} />

        {/* BLOCCO 2 · Documenti del cliente */}
        <View style={s.card} testID="crt-dossier">
          <Text style={s.section}>BLOCCO 2 · Documenti del cliente</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: HT.violetTint }} testID="crt-client-docs-cta">
            <Ionicons name="cloud-upload-outline" size={28} color="#7C3AED" />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: "900", color: HT.text, fontSize: 15 }}>Carica documenti cliente</Text><Text style={s.hint}>Telefono, Drive o Dropbox: apri un documento qui sotto e carica il file. Axon estrae i dati e li mostra in anteprima per la verifica.</Text></View>
          </View>
          {DOSSIER_ORDER.map((dt) => {
            const d = p.dossier?.[dt]; const vals = { ...(d?.extracted || {}), ...(d?.manual || {}) }; const n = Object.keys(vals).length; const open = openDoc === dt;
            const idDocs = dt === "id_card" ? p.available_identity_docs.filter((x) => /ident|carta/i.test(x.doc_type)) : dt === "tax_code" ? p.available_identity_docs.filter((x) => /fisc|sanit/i.test(x.doc_type)) : [];
            return (
              <View key={dt} style={[s.selRow, { flexDirection: "column", alignItems: "stretch", gap: 6, paddingVertical: 8, borderWidth: 1, borderColor: n || d?.files?.length ? "#86EFAC" : HT.border }]} testID={`crt-doc-${dt}`}>
                <Pressable onPress={() => { setOpenDoc(open ? null : dt); setManual({}); }} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name={n || d?.files?.length ? "checkmark-circle" : "ellipse-outline"} size={20} color={n || d?.files?.length ? HT.success : HT.muted} />
                  <Text style={{ flex: 1, fontWeight: "800", color: HT.text }}>{p.doc_types[dt]}</Text>
                  <Text style={s.hint}>{n ? `${n} dati` : d?.files?.length ? "file caricato" : "mancante"}</Text>
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
                </Pressable>
                {open ? (
                  <View style={{ gap: 6 }}>
                    {busy === `doc-${dt}` ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator color={HT.brand} /><Text style={s.hint}>Axon sta leggendo il documento…</Text></View> : dt !== "referent" ? <CrtFilePick compact dropZone dropHint="Trascina qui il documento del cliente oppure" label="Telefono" onPicked={(f) => void uploadDoc(dt, f)} testID={`crt-doc-pick-${dt}`} /> : null}
                    {d?.files?.length ? <Text style={s.hint}>📎 {d.files[d.files.length - 1].name}{p.doc_excluded_effective.includes(dt) ? " · escluso dal PDF unico" : ""}</Text> : null}
                    {idDocs.map((x) => <Pressable key={x.doc_id} onPress={() => void reuseId(dt, x.doc_id)} style={[s.btn, s.ghost, { minHeight: 38 }]}><Ionicons name="folder-open-outline" size={14} color={HT.brand} /><Text style={[s.btnTxt, { color: HT.brand, fontSize: 12 }]}>Usa {x.doc_type} già in scheda{x.expiry_date ? ` (scad. ${x.expiry_date})` : ""}</Text></Pressable>)}
                    {Object.entries(vals).map(([k, v]) => (
                      <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Text style={[s.hint, { width: 120 }]} numberOfLines={1}>{k}</Text><TextInput defaultValue={String(v)} onChangeText={(t) => setManual((m) => ({ ...m, [k]: t }))} style={[s.input, { flex: 1, minHeight: 38, fontSize: 13 }]} testID={`crt-doc-${dt}-${k}`} /></View>
                    ))}
                    {dt === "referent" && !vals.referent_phone ? ["referent_name", "referent_phone", "referent_email"].map((k) => <TextInput key={k} placeholder={{ referent_name: "Nome referente", referent_phone: "Cellulare referente", referent_email: "Email referente" }[k]} placeholderTextColor={HT.muted} onChangeText={(t) => setManual((m) => ({ ...m, [k]: t }))} style={[s.input, { minHeight: 40 }]} testID={`crt-doc-referent-${k}`} />) : null}
                    {dt !== "referent" && !n ? <TextInput placeholder="Oppure inserisci i dati a mano: es. vat_number=04128120260" placeholderTextColor={HT.muted} onChangeText={(t) => { const m: Record<string, string> = {}; t.split(/[;\n]/).forEach((kv) => { const [k, ...r] = kv.split("="); if (k && r.length) m[k.trim()] = r.join("=").trim(); }); setManual(m); }} style={[s.input, { minHeight: 40 }]} /> : null}
                    {Object.keys(manual).length ? <Pressable onPress={() => void saveManual(dt)} style={[s.btn, { backgroundColor: HT.brand, minHeight: 40 }]} testID={`crt-doc-save-${dt}`}>{busy === `man-${dt}` ? <ActivityIndicator color="#FFF" /> : <Text style={s.btnTxt}>Salva correzioni</Text>}</Pressable> : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* 2 · SERVIZI */}
        {p.services.map((svc, si) => {
          const sv = p.per_service[svc] || { bill_ids: [], supplies: [], template_ids: [], filled_form_ids: [] }; const meta = (SVC as any)[svc];
          const bills = p.available_bills.filter((b) => b.bill_type === svc); const forms = p.filled_forms.filter((f) => f.service === svc);
          return (
            <View key={svc} style={[s.card, { borderColor: meta.color }]} testID={`crt-svc-${svc}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Ionicons name={meta.icon} size={18} color={meta.color} /><Text style={s.section}>BLOCCO 3 · Composizione · Servizio {meta.label}</Text></View>
              <Text style={s.label}>Fatture del cliente ({sv.bill_ids.length}/{bills.length} selezionate) → una fornitura per POD/PDR</Text>
              {bills.length === 0 ? <Text style={s.hint}>Nessuna fattura {meta.label} analizzata per questo cliente: caricale prima dal caricatore fatture della scheda cliente.</Text> : (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setPickBills(svc)} style={[s.btn, s.ghost, { flex: 1 }]} testID={`crt-bills-pick-${svc}`}><Ionicons name="receipt-outline" size={16} color={HT.brand} /><Text style={[s.btnTxt, { color: HT.brand }]}>Scegli fatture</Text></Pressable>
                  <Pressable onPress={() => void selectAllBills(svc)} style={[s.btn, s.ghost]} testID={`crt-bills-all-${svc}`}><Text style={[s.btnTxt, { color: HT.brand }]}>Tutte</Text></Pressable>
                </View>
              )}
              {sv.supplies.map((x, i) => {
                const a = x.overrides?.annual ?? x.annual; const bad = x.annual_method === "insufficient" && !x.overrides?.annual;
                return (
                  <View key={x.supply_id} style={[s.selRow, { flexDirection: "column", alignItems: "stretch", gap: 4, paddingVertical: 8, borderLeftWidth: 3, borderLeftColor: bad ? "#F59E0B" : "#86EFAC" }]} testID={`crt-supply-${svc}-${i}`}>
                    <Text style={{ fontWeight: "800", color: HT.text }}>{i + 1}. {x.pod || x.pdr || x.line_number || "—"} <Text style={s.hint}>· {x.bill_name}</Text></Text>
                    <Text style={s.hint}>{x.supply_address || "indirizzo n.d."}{x.meter_power_kw ? ` · ${x.meter_power_kw} kW` : ""}{x.voltage ? ` · ${x.voltage}` : ""}{x.current_supplier ? ` · ${x.current_supplier}` : ""}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[s.hint, { flex: 1, color: bad ? HT.warning : HT.text }]}>Consumo 12 mesi: {a ? `${a} ${x.unit}` : "—"} · {fmtMethod(x.annual_method)} ({x.months_count} mesi)</Text>
                      <TextInput placeholder="correggi" placeholderTextColor={HT.muted} keyboardType="numeric" defaultValue={x.overrides?.annual ? String(x.overrides.annual) : ""} onEndEditing={(e) => void setAnnual(svc, x.supply_id, e.nativeEvent.text)} style={[s.input, { width: 90, minHeight: 36, fontSize: 12 }]} testID={`crt-supply-annual-${svc}-${i}`} />
                    </View>
                  </View>
                );
              })}
              {sv.totals?.supplies_count ? <Text style={s.hint}>Totale servizio (informativo): {sv.totals.supplies_count} forniture · {sv.totals.annual_sum} {sv.supplies[0]?.unit} · {sv.totals.estimated_count} stimate · {sv.totals.insufficient_count} da completare</Text> : null}
              <Text style={s.label}>Modello del fornitore → Compila con Axon (replica automatica del modulo)</Text>
              {templates.length === 0 ? <Text style={s.hint}>Nessun modello: il Master li carica in Modelli moduli.</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {templates.map((t) => <Pressable key={t.template_id} onPress={() => void fill(svc, t.template_id)} disabled={!!busy} style={[s.chip, sv.template_ids?.includes(t.template_id) && { borderColor: meta.color }]} testID={`crt-fill-${svc}-${t.template_id}`}>{busy === `fill-${svc}` ? <ActivityIndicator size="small" color={meta.color} /> : <Ionicons name="sparkles" size={14} color={meta.color} />}<Text style={s.chipTxt} numberOfLines={1}>{t.name}</Text></Pressable>)}
              </View>
              {forms.map((f) => (
                <Pressable key={f.form_id} onPress={() => router.push(`/filled-form/${f.form_id}` as any)} style={[s.selRow, { borderWidth: 1, borderColor: HT.border }]} testID={`crt-form-${f.form_id}`}>
                  <Ionicons name="document-text" size={18} color={meta.color} /><Text style={{ flex: 1, fontWeight: "700", color: HT.text }} numberOfLines={1}>{f.name}</Text>
                  {f.missing?.length ? <Text style={[s.badge, { backgroundColor: HT.warningTint, color: "#FDBA74" }]}>{f.missing.length} mancanti</Text> : <Text style={[s.badge, { backgroundColor: HT.successTint, color: HT.success }]}>completo</Text>}
                  <Ionicons name="create-outline" size={18} color={HT.muted} />
                </Pressable>
              ))}
            </View>
          );
        })}

        {/* V50.z326 — BLOCCO 3 · Composizione documento finale */}
        <View style={s.card} testID="crt-final">
          <Text style={s.section}>BLOCCO 3 · Composizione documento finale</Text>
          <Text style={s.hint}>Axon assembla il documento unico (moduli compilati + documenti del cliente) con indice iniziale. Ordine pagine modificabile qui sotto o predefinito dal Master. Ogni sezione è correggibile prima di salvare (Blocco 2 e servizi).</Text>
          <Pressable onPress={() => { setOrderOpen((v) => !v); if (!orderDraft) setOrderDraft({ order: p.doc_order_effective, excluded: p.doc_excluded_effective }); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }} testID="crt-practice-order-toggle">
            <Ionicons name="swap-vertical" size={16} color={HT.brand} />
            <Text style={[s.hint, { color: HT.text, flex: 1 }]}>Ordine pagine {p.doc_order_is_override ? "(personalizzato per questa pratica)" : "(predefinito Master)"}: {p.doc_order_effective.filter((k) => !p.doc_excluded_effective.includes(k)).map((k) => p.doc_order_labels[k] || k).join(" → ")}</Text>
            <Ionicons name={orderOpen ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
          </Pressable>
          {orderOpen && orderDraft ? (
            <>
              <CrtDocOrder order={orderDraft.order} excluded={orderDraft.excluded} labels={p.doc_order_labels} onChange={(o, e) => setOrderDraft({ order: o, excluded: e })} testID="crt-practice-order" />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={saveOrder} disabled={busy === "order"} style={[s.btn, { flex: 1, backgroundColor: HT.brand }]} testID="crt-practice-order-save">{busy === "order" ? <ActivityIndicator color="#FFF" /> : <Text style={s.btnTxt}>Salva ordine per questa pratica</Text>}</Pressable>
                {p.doc_order_is_override ? <Pressable onPress={resetOrder} style={[s.btn, s.ghost]} testID="crt-practice-order-reset"><Text style={[s.btnTxt, { color: HT.brand }]}>Usa predefinito</Text></Pressable> : null}
              </View>
            </>
          ) : null}
          {p.merged_pdf ? <Text style={[s.hint, { color: HT.text }]}>📎 {p.merged_pdf.name} · {p.merged_pdf.pages} sezioni · {(p.merged_pdf.size / 1024).toFixed(0)} KB{p.merged_pdf.too_big ? " · ⚠️ oltre 10 MB: valuta invio per servizio" : ""}</Text> : null}
          <Pressable onPress={merge} disabled={busy === "merge"} style={[s.btn, { backgroundColor: '#7C3AED', minHeight: 56 }]} testID="crt-merge">{busy === "merge" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="albums-outline" size={20} color="#FFF" /><Text style={[s.btnTxt, { fontSize: 15 }]}>{p.merged_pdf ? "Rigenera documento unico" : "Componi documento unico"}</Text></>}</Pressable>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <Pressable key={k} onPress={() => void setStatus(k)} style={[s.chip, p.status === k && { backgroundColor: HT.brand, borderColor: HT.brand }]} testID={`crt-status-${k}`}><Text style={[s.chipTxt, p.status === k && { color: "#FFF" }]}>{l}</Text></Pressable>)}
          </View>
        </View>

        {/* V50.z326 — BLOCCO 4 · Salvataggio e condivisione */}
        <CrtSaveShareBlock practiceId={p.practice_id} contactName={p.contact_name} hasPdf={!!p.merged_pdf} busy={busy} run={run} onQr={qr} onMerge={() => void merge()} />
      </KScrollView>

      {/* scelta fatture */}
      <Modal visible={!!pickBills} transparent animationType="slide" onRequestClose={() => setPickBills(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={() => setPickBills(null)} />
        <View style={{ backgroundColor: HT.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70%", gap: 8 }}>
          <Text style={s.section}>Fatture {pickBills ? (SVC as any)[pickBills]?.label : ""} del cliente</Text>
          <KScrollView contentContainerStyle={{ gap: 6 }}>
            {p.available_bills.filter((b) => b.bill_type === pickBills).map((b) => { const on = pickBills ? (p.per_service[pickBills]?.bill_ids || []).includes(b.bill_id) : false; return (
              <Pressable key={b.bill_id} onPress={() => pickBills && toggleBill(pickBills, b.bill_id)} style={[s.selRow, on && { backgroundColor: HT.violetTint }]} testID={`crt-bill-${b.bill_id}`}><Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={HT.brand} /><Text style={{ flex: 1, color: HT.text }} numberOfLines={1}>{b.file_name}</Text><Text style={s.hint}>{b.extracted?.pod || b.extracted?.pdr || ""}</Text></Pressable>
            ); })}
          </KScrollView>
          <Pressable onPress={() => setPickBills(null)} style={[s.btn, { backgroundColor: HT.brand }]} testID="crt-bills-done"><Text style={s.btnTxt}>Fatto</Text></Pressable>
        </View>
      </Modal>
      {/* QR */}
      <Modal visible={!!share} transparent animationType="fade" onRequestClose={() => setShare(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 }} onPress={() => setShare(null)}>
          <View style={[s.card, { alignItems: "center", width: "100%" }]} testID="crt-qr-modal">
            <Text style={s.section}>Scansiona per scaricare il contratto</Text>
            {share ? <Image source={{ uri: `data:image/png;base64,${share.qr_png_base64}` }} style={{ width: 240, height: 240 }} /> : null}
            <Text style={s.hint}>Il cliente inquadra il QR e scarica il PDF senza login. Link valido fino al {share ? new Date(share.expires_at).toLocaleDateString("it-IT") : ""}.</Text>
            <Pressable onPress={() => share && void shareDataUri(`data:image/png;base64,${share.qr_png_base64}`, "qr-contratto.png", "image/png")} style={[s.btn, s.ghost, { alignSelf: "stretch" }]}><Ionicons name="share-social-outline" size={16} color={HT.brand} /><Text style={[s.btnTxt, { color: HT.brand }]}>Invia QR / link</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

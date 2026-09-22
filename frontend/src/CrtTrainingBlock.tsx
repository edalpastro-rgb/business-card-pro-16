// CrtTrainingBlock.tsx — V50.z326 — BLOCCO 1 «Modelli di addestramento» della pagina Autocompilazione CRT.
// Carica contratto compilato di esempio (Axon impara l'ordine/campi) · Carica modulo vuoto (template da riempire) ·
// elenco file con nome/data/elimina · campi da estrarre (spuntabili + personalizzati) · data e luogo firma.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { CrtFilePick, PickedFile } from "@/src/CrtFilePick";
import { CrtSignDate } from "@/src/CrtSignDate";
import { crtStyles as s } from "@/app/crt/index";

type Tpl = { template_id: string; name: string; created_at?: string; is_filled_example?: boolean; pages?: number };
type Extract = { presets: { key: string; label: string }[]; fields: string[]; custom_fields: string[]; sign_place_date_everywhere: boolean; notes: string };
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("it-IT") : "");

export function CrtTrainingBlock({ isMaster, signDate, signDateEffective, signPlace, signPlaceSuggested, onSignDate, onSignPlace, busy }: {
  isMaster: boolean; signDate: string; signDateEffective: string; signPlace: string; signPlaceSuggested: string;
  onSignDate: (iso: string) => void; onSignPlace: (v: string) => void; busy: boolean;
}) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [example, setExample] = useState<{ example_name?: string | null } | null>(null);
  const [ex, setEx] = useState<Extract | null>(null);
  const [custom, setCustom] = useState("");
  const [place, setPlace] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const load = async () => {
    const [t, o, e] = await Promise.all([api<any>("/form-templates").catch(() => ({ items: [] })), api<any>("/crt/settings/order").catch(() => null), api<Extract>("/crt/settings/extract").catch(() => null)]);
    setTpls(t.items || []); setExample(o); setEx(e);
  };
  useEffect(() => { void load(); }, []);

  const run = async (k: string, fn: () => Promise<void>, ok?: string) => { setLoading(k); try { await fn(); await load(); if (ok) notify("Axon", ok); } catch (er: any) { notify("CRT", er?.message || "Errore"); } finally { setLoading(null); } };
  const uploadExample = (f: PickedFile) => run("ex", async () => { await api("/crt/dossier-example", { method: "POST", body: { name: f.name, data_base64: f.data_base64 } }); }, "Contratto di esempio letto: ordine documenti e campi appresi");
  const uploadBlank = (f: PickedFile) => run("tpl", async () => { await api("/form-templates", { method: "POST", body: { name: f.name.replace(/\.pdf$/i, ""), pdf_base64: f.data_base64, is_filled_example: false } }); }, "Modulo vuoto pronto: Axon lo compilerà con i dati del cliente");
  const delTpl = async (t: Tpl) => { if (!(await confirmAsync("Eliminare il modulo?", t.name))) return; void run("del", async () => { await api(`/form-templates/${t.template_id}`, { method: "DELETE" }); }); };
  const saveEx = (patch: Partial<Extract>) => { if (!ex) return; const next = { ...ex, ...patch }; setEx(next); void run("exs", async () => { await api("/crt/settings/extract", { method: "PUT", body: { fields: next.fields, custom_fields: next.custom_fields, sign_place_date_everywhere: next.sign_place_date_everywhere, notes: next.notes } }); }); };
  const toggleField = (k: string) => { if (!ex) return; saveEx({ fields: ex.fields.includes(k) ? ex.fields.filter((x) => x !== k) : [...ex.fields, k] }); };

  const blanks = tpls.filter((t) => !t.is_filled_example);
  return (
    <View style={s.card} testID="crt-block-training">
      <Text style={s.section}>BLOCCO 1 · Modelli di addestramento</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 6, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface }} testID="crt-train-example">
          <Ionicons name="school-outline" size={26} color="#7C3AED" />
          <Text style={{ fontWeight: "800", color: theme.color.onSurface }}>Carica contratto compilato di esempio</Text>
          <Text style={s.hint}>Axon impara da documenti già compilati come riferimento</Text>
          {isMaster ? (loading === "ex" ? <ActivityIndicator color="#7C3AED" /> : <CrtFilePick compact dropZone dropHint="Trascina qui il contratto compilato oppure" label="Carica" onPicked={(f) => void uploadExample(f)} testID="crt-train-example-pick" />) : <Text style={s.hint}>Solo Master</Text>}
          {example?.example_name ? <Text style={s.hint} numberOfLines={1}>📎 {example.example_name}</Text> : null}
        </View>
        <View style={{ flex: 1, gap: 6, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface }} testID="crt-train-blank">
          <Ionicons name="document-outline" size={26} color={theme.color.brandPrimary} />
          <Text style={{ fontWeight: "800", color: theme.color.onSurface }}>Carica modulo vuoto da compilare</Text>
          <Text style={s.hint}>Il template che Axon riempirà con i dati del cliente</Text>
          {loading === "tpl" ? <ActivityIndicator color={theme.color.brandPrimary} /> : <CrtFilePick compact dropZone dropHint="Trascina qui il modulo vuoto oppure" label="Carica" onPicked={(f) => void uploadBlank(f)} testID="crt-train-blank-pick" />}
        </View>
      </View>
      {blanks.length ? blanks.map((t) => (
        <View key={t.template_id} style={[s.selRow, { alignItems: "center" }]} testID={`crt-tpl-${t.template_id}`}>
          <Ionicons name="document-text-outline" size={18} color={theme.color.brandPrimary} />
          <View style={{ flex: 1 }}><Text style={{ color: theme.color.onSurface, fontWeight: "700" }} numberOfLines={1}>{t.name}</Text><Text style={s.hint}>Caricato il {fmtDate(t.created_at)}{t.pages ? ` · ${t.pages} pagine` : ""}</Text></View>
          <Pressable onPress={() => void delTpl(t)} hitSlop={8} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }} testID={`crt-tpl-del-${t.template_id}`}><Ionicons name="trash-outline" size={18} color={theme.color.error} /></Pressable>
        </View>
      )) : <Text style={s.hint}>Nessun modulo vuoto caricato.</Text>}

      <Text style={s.label}>Indica ad Axon quali informazioni deve estrarre dai documenti del cliente</Text>
      {ex ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {ex.presets.map((p) => { const on = ex.fields.includes(p.key); return (
              <Pressable key={p.key} onPress={() => isMaster && toggleField(p.key)} style={[s.chip, on && { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary }]} testID={`crt-extract-${p.key}`}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={14} color={on ? "#FFF" : theme.color.brandPrimary} /><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{p.label}</Text>
              </Pressable>
            ); })}
            {ex.custom_fields.map((c) => <Pressable key={c} onPress={() => isMaster && saveEx({ custom_fields: ex.custom_fields.filter((x) => x !== c) })} style={[s.chip, { backgroundColor: "#EDE9FE" }]}><Text style={s.chipTxt}>{c} ✕</Text></Pressable>)}
          </View>
          {isMaster ? <View style={{ flexDirection: "row", gap: 6 }}>
            <TextInput value={custom} onChangeText={setCustom} placeholder="Altro dato da estrarre (es. codice ATECO)" placeholderTextColor={theme.color.muted} style={[s.input, { flex: 1, minHeight: 42 }]} testID="crt-extract-custom" />
            <Pressable onPress={() => { if (custom.trim()) { saveEx({ custom_fields: [...ex.custom_fields, custom.trim()] }); setCustom(""); } }} style={[s.btn, { backgroundColor: theme.color.brandPrimary, minHeight: 42, paddingHorizontal: 12 }]} testID="crt-extract-custom-add"><Text style={s.btnTxt}>Aggiungi</Text></Pressable>
          </View> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[s.hint, { flex: 1, color: theme.color.onSurface }]}>Inserire data e luogo in tutti i campi dove è necessario?</Text>
            <Switch value={ex.sign_place_date_everywhere} onValueChange={(v) => saveEx({ sign_place_date_everywhere: v })} disabled={!isMaster} testID="crt-extract-signswitch" />
          </View>
          {ex.sign_place_date_everywhere ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>Luogo</Text>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <TextInput value={place ?? signPlace} onChangeText={setPlace} placeholder={signPlaceSuggested ? `Proposto: ${signPlaceSuggested}` : "Es. Treviso"} placeholderTextColor={theme.color.muted} style={[s.input, { flex: 1 }]} testID="crt-sign-place" />
                {place !== null && place !== signPlace ? <Pressable onPress={() => { onSignPlace(place); setPlace(null); }} style={[s.btn, { backgroundColor: theme.color.brandPrimary, minHeight: 44, paddingHorizontal: 12 }]} testID="crt-sign-place-save">{busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.btnTxt}>Salva</Text>}</Pressable> : null}
              </View>
              {!signPlace && signPlaceSuggested ? <Pressable onPress={() => onSignPlace(signPlaceSuggested)} style={[s.chip, { alignSelf: "flex-start" }]} testID="crt-sign-place-suggest"><Ionicons name="sparkles" size={14} color={theme.color.brandPrimary} /><Text style={s.chipTxt}>Usa «{signPlaceSuggested}»</Text></Pressable> : null}
              <Text style={s.label}>Data (calendario · anche retroattiva)</Text>
              <CrtSignDate value={signDate} effective={signDateEffective} onChange={onSignDate} busy={busy} />
            </View>
          ) : null}
        </>
      ) : <ActivityIndicator color={theme.color.brandPrimary} />}
    </View>
  );
}

// ContractFormsSection.tsx — V50.z268 — Sezione «Modulo precompilato» nella pagina Nuovo Contratto:
// scegli un modello (Modelli moduli del Master) → Axon compila con anagrafica, documento d'identità, fatture (POD/PDR/fornitura),
// allegati (visura camerale…) → apre il modulo compilato (/filled-form/[id]). Elenca anche i moduli già compilati per il cliente.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Tpl = { template_id: string; name: string; field_count: number; page_count: number };
type Filled = { form_id: string; name: string; template_name: string; missing: any[]; created_at: string };

export function ContractFormsSection({ contactId }: { contactId: string | null }) {
  const router = useRouter();
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [filled, setFilled] = useState<Filled[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ items: Tpl[]; is_master: boolean }>("/form-templates").then((r) => { setTpls(r.items || []); setIsMaster(!!r.is_master); }).catch((e: any) => notify("Modelli moduli", e?.message || "Impossibile caricare i modelli")); }, []);
  const loadFilled = useCallback(async () => { if (!contactId) { setFilled([]); return; } try { const r = await api<{ items: Filled[] }>(`/contacts/${contactId}/forms`); setFilled(r.items || []); } catch { /* ignore */ } }, [contactId]);
  useEffect(() => { void loadFilled(); }, [loadFilled]);

  const compile = async () => {
    if (!contactId) { notify("Modulo", "Seleziona prima il cliente"); return; }
    if (!sel) { notify("Modulo", "Scegli il modello da compilare"); return; }
    setBusy(true);
    try {
      const r = await api<{ form_id: string; missing: any[] }>(`/contacts/${contactId}/forms`, { method: "POST", body: { template_id: sel } });
      await loadFilled();
      router.push(`/filled-form/${r.form_id}` as any);
    } catch (e: any) { notify("Modulo", e?.message || "Compilazione non riuscita"); } finally { setBusy(false); }
  };

  return (
    <View style={s.card} testID="contract-forms-section">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="document-attach" size={18} color="#7C3AED" />
        <Text style={s.title}>Modulo precompilato da Axon</Text>
        {isMaster ? <Pressable onPress={() => router.push("/form-templates" as any)} style={s.linkBtn} testID="contract-forms-manage"><Ionicons name="settings-outline" size={14} color="#7C3AED" /><Text style={s.linkTxt}>Modelli</Text></Pressable> : null}
      </View>
      <Text style={s.hint}>Axon compila il PDF del modulo con anagrafica, documento d'identità, visura/allegati e dati fattura (POD, PDR, indirizzo di fornitura). Verifichi, correggi e stampi per la firma.</Text>
      {tpls.length === 0 ? (
        <Text style={s.hint} testID="contract-forms-empty">{isMaster ? "Nessun modello caricato: tocca «Modelli» per aggiungere il PDF di un modulo." : "Il Master non ha ancora caricato modelli di moduli."}</Text>
      ) : (
        <View style={{ gap: 6 }}>
          {tpls.map((t) => (
            <Pressable key={t.template_id} onPress={() => setSel(t.template_id)} style={[s.tpl, sel === t.template_id && s.tplOn]} testID={`contract-form-tpl-${t.template_id}`}>
              <Ionicons name={sel === t.template_id ? "radio-button-on" : "radio-button-off"} size={18} color="#7C3AED" />
              <View style={{ flex: 1 }}><Text style={s.tplName}>{t.name}</Text><Text style={s.hint}>{t.page_count} pag. · {t.field_count} campi</Text></View>
            </Pressable>
          ))}
          <Pressable onPress={compile} disabled={busy || !sel || !contactId} style={[s.primary, (busy || !sel || !contactId) && { opacity: 0.5 }]} testID="contract-form-compile">
            {busy ? <><ActivityIndicator color="#FFF" size="small" /><Text style={s.primaryTxt}>Axon compila il modulo…</Text></> : <><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={s.primaryTxt}>{contactId ? "Compila con Axon" : "Seleziona il cliente per compilare"}</Text></>}
          </Pressable>
        </View>
      )}
      {filled.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={s.sub}>Moduli compilati per questo cliente</Text>
          {filled.map((x) => (
            <Pressable key={x.form_id} onPress={() => router.push(`/filled-form/${x.form_id}` as any)} style={s.row} testID={`contract-filled-${x.form_id}`}>
              <Ionicons name="document-text" size={18} color="#059669" />
              <View style={{ flex: 1 }}><Text style={s.tplName} numberOfLines={1}>{x.template_name}</Text><Text style={s.hint}>{new Date(x.created_at).toLocaleDateString("it-IT")} · {(x.missing || []).length ? `${x.missing.length} campi da completare` : "completo"}</Text></View>
              <Ionicons name="chevron-forward" size={16} color={HT.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 18, backgroundColor: '#FAF5FF', borderRadius: 14, borderWidth: 1, borderColor: '#E9D5FF', padding: 12, gap: 10 },
  title: { flex: 1, fontSize: 14, fontWeight: "900", color: HT.text },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#F3E8FF' }, linkTxt: { fontSize: 12, fontWeight: "800", color: "#7C3AED" },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 }, sub: { fontSize: 12, fontWeight: "800", color: HT.text },
  tpl: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 48 },
  tplOn: { borderColor: '#7C3AED', backgroundColor: HT.violetTint }, tplName: { fontSize: 13, fontWeight: "800", color: HT.text },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: '#7C3AED', borderRadius: 12, minHeight: 46 }, primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: '#A7F3D0', minHeight: 48 },
});

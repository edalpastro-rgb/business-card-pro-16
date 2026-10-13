// admin/org-plans.tsx — V50.z541 — CMS SUPERMASTER «Piani e prezzi»: etichetta, prezzo mensile, max utenti, badge, flag preventivo.
// Modifiche immediate su: modulo di registrazione (/public/org-plans), paywall (/billing/plans → Stripe), limiti utenti (inviti/team).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { KScrollView } from "@/src/ui/keyboard";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

type Plan = { id: string; label: string; price_month: number | null; max_users: number | null; quote: boolean; order: number; desc?: string | null; badge?: string | null };

export default function AdminOrgPlansScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Plan[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<{ items: Plan[] }>("/admin/org-plans"); setItems(r.items); setDirty(false); }
    catch (e: any) { if (/super-admin|403/i.test(String(e?.message))) setDenied(true); else notify("Errore", e?.message || ""); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upd = (i: number, patch: Partial<Plan>) => { setItems((arr) => (arr || []).map((p, k) => (k === i ? { ...p, ...patch } : p))); setDirty(true); };
  const add = () => { setItems((arr) => [...(arr || []), { id: `piano_${Date.now().toString(36)}`, label: "Nuovo piano", price_month: 0, max_users: 1, quote: false, order: ((arr || []).length + 1), desc: "", badge: null }]); setDirty(true); };
  const remove = (i: number) => { setItems((arr) => (arr || []).filter((_, k) => k !== i)); setDirty(true); };
  const save = async () => {
    if (!items) return;
    setBusy(true);
    try {
      const r = await api<{ items: Plan[] }>("/admin/org-plans", { method: "PUT", body: { items: items.map((p) => ({ ...p, price_month: p.quote ? null : Number(p.price_month ?? 0), max_users: p.quote ? null : (p.max_users ? Number(p.max_users) : null), desc: p.desc || null, badge: p.badge || null })) } });
      setItems(r.items); setDirty(false); notify("Piani salvati", "Attivi subito su registrazione, paywall e limiti utenti ✅");
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setBusy(false); }
  };
  const reset = async () => { setBusy(true); try { const r = await api<{ items: Plan[] }>("/admin/org-plans/reset", { method: "POST" }); setItems(r.items); setDirty(false); notify("Ripristinati", "Piani predefiniti"); } catch (e: any) { notify("Errore", e?.message || ""); } finally { setBusy(false); } };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="org-plans-back"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Piani e prezzi</Text><Text style={s.sub}>Nuovi iscritti · limite utenti per organizzazione</Text></View>
        {!denied ? <Pressable onPress={() => void save()} disabled={!dirty || busy} style={[s.saveBtn, (!dirty || busy) && { opacity: 0.5 }]} testID="org-plans-save">{busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="save-outline" size={16} color="#FFF" />}<Text style={s.saveTxt}>Salva</Text></Pressable> : null}
      </View>
      {denied ? <View style={s.center}><Ionicons name="lock-closed" size={36} color={HT.muted} /><Text style={s.help} testID="org-plans-denied">Sezione riservata al Supermaster.</Text></View> : !items ? <ActivityIndicator color={HT.violet} style={{ marginTop: 40 }} /> : (
        <KScrollView contentContainerStyle={s.list}>
          <Text style={s.help}>Il piano del Master radice fissa il totale di utenti dell&apos;organizzazione (Master + Manager + Collaboratori). «Preventivo» = nessun prezzo, nessun limite finché non assegni un piano da Utenti registrati.</Text>
          {items.map((p, i) => (
            <View key={p.id} style={s.card} testID={`org-plan-${p.id}`}>
              <View style={s.row}>
                <TextInput value={p.label} onChangeText={(v) => upd(i, { label: v })} style={[s.input, { flex: 1, fontWeight: "800" }]} placeholder="Nome piano" placeholderTextColor={HT.muted} testID={`org-plan-label-${p.id}`} />
                <Pressable onPress={() => remove(i)} hitSlop={8} testID={`org-plan-remove-${p.id}`}><Ionicons name="trash-outline" size={20} color={HT.danger} /></Pressable>
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}><Text style={s.label}>Prezzo €/mese</Text><TextInput value={p.quote ? "" : String(p.price_month ?? "")} editable={!p.quote} onChangeText={(v) => upd(i, { price_month: v === "" ? null : Number(v.replace(",", ".")) })} keyboardType="decimal-pad" style={[s.input, p.quote && { opacity: 0.4 }]} placeholder={p.quote ? "preventivo" : "19"} placeholderTextColor={HT.muted} testID={`org-plan-price-${p.id}`} /></View>
                <View style={{ flex: 1 }}><Text style={s.label}>Max utenti</Text><TextInput value={p.quote ? "" : String(p.max_users ?? "")} editable={!p.quote} onChangeText={(v) => upd(i, { max_users: v === "" ? null : Number(v) })} keyboardType="number-pad" style={[s.input, p.quote && { opacity: 0.4 }]} placeholder={p.quote ? "∞" : "10"} placeholderTextColor={HT.muted} testID={`org-plan-max-${p.id}`} /></View>
                <View style={{ width: 70 }}><Text style={s.label}>Ordine</Text><TextInput value={String(p.order ?? "")} onChangeText={(v) => upd(i, { order: Number(v) || 0 })} keyboardType="number-pad" style={s.input} testID={`org-plan-order-${p.id}`} /></View>
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}><Text style={s.label}>Badge (opzionale)</Text><TextInput value={p.badge || ""} onChangeText={(v) => upd(i, { badge: v })} style={s.input} placeholder="Più scelto" placeholderTextColor={HT.muted} testID={`org-plan-badge-${p.id}`} /></View>
                <View style={{ alignItems: "center", gap: 4 }}><Text style={s.label}>Preventivo</Text><Switch value={p.quote} onValueChange={(v) => upd(i, { quote: v })} trackColor={{ true: HT.violet }} testID={`org-plan-quote-${p.id}`} /></View>
              </View>
              <Text style={s.label}>Descrizione</Text>
              <TextInput value={p.desc || ""} onChangeText={(v) => upd(i, { desc: v })} multiline style={[s.input, { minHeight: 60, textAlignVertical: "top" }]} placeholder="Cosa include" placeholderTextColor={HT.muted} testID={`org-plan-desc-${p.id}`} />
              <Text style={s.idTxt}>id: {p.id}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={add} style={s.ghostBtn} testID="org-plans-add"><Ionicons name="add" size={18} color={HT.violet} /><Text style={s.ghostTxt}>Aggiungi piano</Text></Pressable>
            <Pressable onPress={() => void reset()} disabled={busy} style={s.ghostBtn} testID="org-plans-reset"><Ionicons name="refresh" size={18} color={HT.violet} /><Text style={s.ghostTxt}>Ripristina predefiniti</Text></Pressable>
          </View>
        </KScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  title: { color: HT.text, fontSize: 18, fontWeight: "800" },
  sub: { color: HT.muted, fontSize: 11.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.violet, paddingHorizontal: 14, minHeight: 40, borderRadius: 10 },
  saveTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  list: { padding: 12, gap: 12, paddingBottom: 40 },
  help: { color: HT.muted, fontSize: 12.5, lineHeight: 17 },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 8 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  label: { color: HT.muted, fontSize: 11.5, fontWeight: "700", marginBottom: 4 },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, color: HT.text, fontSize: 14 },
  idTxt: { color: HT.muted, fontSize: 10.5 },
  ghostBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint },
  ghostTxt: { color: HT.violet, fontWeight: "700", fontSize: 13 },
});

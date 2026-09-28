// V50.z320 — Codici Promozionali (Super Admin): crea codici (settimane/mesi gratuiti, premium, crediti),
// scadenza, max utilizzi, attiva/disattiva, elimina, elenco utilizzi (chi e quando).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, TextInput, Switch } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { DateField } from "@/src/ui/DateField"; // V50.z388 — calendario nativo su ogni campo data

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)

type BenefitType = "free_weeks" | "free_months" | "premium" | "credits";
type Promo = {
  code_id: string; code: string; description: string; benefit_type: BenefitType; benefit_label: string; benefit_value: number;
  premium_days: number | null; benefit_summary: string; expires_at: string | null; max_uses: number | null; uses_count: number;
  active: boolean; status: "active" | "disabled" | "expired" | "exhausted"; created_at: string; last_used_at: string | null;
};
type Redemption = { redemption_id: string; email: string; name: string; benefit_summary: string; redeemed_at: string; invited_by_email?: string | null; subscription?: { status: string; days_left?: number | null } | null };

const BENEFITS: { id: BenefitType; label: string; icon: keyof typeof Ionicons.glyphMap; valueLabel: string }[] = [
  { id: "free_weeks", label: "Settimane gratuite", icon: "calendar-outline", valueLabel: "Numero di settimane" },
  { id: "free_months", label: "Mesi gratuiti", icon: "calendar", valueLabel: "Numero di mesi" },
  { id: "premium", label: "Funzioni premium", icon: "star", valueLabel: "Giorni di premium (vuoto = senza scadenza)" },
  { id: "credits", label: "Crediti AxonOS", icon: "diamond", valueLabel: "Numero di crediti" },
];
const STATUS_META: Record<Promo["status"], { label: string; color: string }> = {
  active: { label: "Attivo", color: C.success },
  disabled: { label: "Disattivato", color: C.muted },
  expired: { label: "Scaduto", color: C.error },
  exhausted: { label: "Esaurito", color: C.warning },
};

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("it-IT") : "—");
const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default function PromoCodesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Promo[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Promo | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Promo[] }>("/admin/promo-codes");
      setItems(r.items);
    } catch (e: any) {
      notify("Accesso negato", e?.message || "Solo super-admin");
      router.back();
    }
  }, [router]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (p: Promo) => {
    try {
      await api(`/admin/promo-codes/${p.code_id}`, { method: "PATCH", body: { active: !p.active } });
      load();
    } catch (e: any) { notify("Errore", e?.message); }
  };
  const remove = async (p: Promo) => {
    if (!(await confirmAsync("Eliminare il codice?", `${p.code} · ${p.uses_count} utilizzi registrati. L'operazione non è reversibile.`))) return;
    try {
      await api(`/admin/promo-codes/${p.code_id}`, { method: "DELETE" });
      setDetail(null);
      load();
    } catch (e: any) { notify("Errore", e?.message); }
  };

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="promo-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Codici Promozionali</Text>
          <Text style={s.hSub}>{items ? `${items.length} codici · ${items.reduce((a, p) => a + p.uses_count, 0)} utilizzi` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={() => setCreateOpen(true)} style={s.addBtn} testID="promo-add"><Ionicons name="add" size={20} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Nuovo</Text></Pressable>
      </View>

      {items === null ? <ActivityIndicator style={{ marginTop: 40 }} color={VIOLET} /> : (
        <ScrollView contentContainerStyle={s.list}>
          {items.length === 0 ? (
            <View style={s.empty}><Ionicons name="pricetags-outline" size={40} color={C.muted} /><Text style={s.emptyT}>Nessun codice ancora</Text><Text style={s.emptyS}>Crea il primo codice, ad es. LANCIO2026, e decidi il beneficio, la scadenza e quante volte può essere usato.</Text></View>
          ) : items.map((p) => {
            const st = STATUS_META[p.status];
            return (
              <Pressable key={p.code_id} onPress={() => setDetail(p)} style={s.card} testID={`promo-row-${p.code}`}>
                <View style={s.cardTop}>
                  <Text style={s.code}>{p.code}</Text>
                  <View style={[s.badge, { backgroundColor: st.color + "22" }]}><Text style={[s.badgeTxt, { color: st.color }]}>{st.label}</Text></View>
                </View>
                <Text style={s.benefit}>{p.benefit_summary}</Text>
                {p.description ? <Text style={s.desc}>{p.description}</Text> : null}
                <View style={s.meta}>
                  <Text style={s.metaTxt}><Ionicons name="people" size={12} color={C.muted} /> {p.uses_count}{p.max_uses ? ` / ${p.max_uses}` : " · illimitato"}</Text>
                  <Text style={s.metaTxt}><Ionicons name="time-outline" size={12} color={C.muted} /> {p.expires_at ? `scade ${fmtDate(p.expires_at)}` : "nessuna scadenza"}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <CreatePromoModal visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />
      <PromoDetailModal promo={detail} onClose={() => setDetail(null)} onToggle={toggle} onDelete={remove} />
    </SafeAreaView>
  );
}

function CreatePromoModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [benefit, setBenefit] = useState<BenefitType>("free_weeks");
  const [value, setValue] = useState("2");
  const [expires, setExpires] = useState("");
  const [usesMode, setUsesMode] = useState<"once" | "n" | "unlimited">("unlimited");
  const [maxUses, setMaxUses] = useState("100");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (visible) { setCode(""); setDesc(""); setBenefit("free_weeks"); setValue("2"); setExpires(""); setUsesMode("unlimited"); setMaxUses("100"); } }, [visible]);

  const bm = BENEFITS.find((b) => b.id === benefit)!;
  const numVal = parseInt(value, 10);
  const valid = code.trim().length >= 3 && (benefit === "premium" ? (value.trim() === "" || numVal > 0) : numVal > 0) && (usesMode !== "n" || parseInt(maxUses, 10) > 0) && (expires === "" || expires.length === 10);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await api("/admin/promo-codes", {
        method: "POST",
        body: {
          code: code.trim(), description: desc.trim(), benefit_type: benefit,
          benefit_value: benefit === "premium" ? 1 : numVal,
          premium_days: benefit === "premium" && value.trim() ? numVal : null,
          expires_at: expires || null,
          max_uses: usesMode === "once" ? 1 : usesMode === "n" ? parseInt(maxUses, 10) : null,
        },
      });
      notify("Codice creato ✅", `${code.trim().toUpperCase()} è pronto per essere condiviso.`);
      onCreated();
    } catch (e: any) { notify("Errore", e?.message || "Impossibile creare il codice"); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={s.backdrop}>
        <View style={s.sheet} testID="promo-create-modal">
          <View style={s.sheetHead}><Text style={s.sheetTitle}>Nuovo codice promozionale</Text><Pressable onPress={onClose} style={s.iconBtn} testID="promo-create-close"><Ionicons name="close" size={22} color={C.onSurface} /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24, gap: 12 }}>
            <Text style={s.lbl}>Codice</Text>
            <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="LANCIO2026" placeholderTextColor={C.muted} style={[s.input, { fontWeight: "800", letterSpacing: 1 }]} autoCapitalize="characters" autoCorrect={false} maxLength={32} testID="promo-code-name" />
            <Text style={s.lbl}>Descrizione (interna)</Text>
            <TextInput value={desc} onChangeText={setDesc} placeholder="Es. Promo lancio · primi 100 clienti" placeholderTextColor={C.muted} style={s.input} maxLength={200} testID="promo-desc" />

            <Text style={s.lbl}>Beneficio</Text>
            <View style={s.chips}>
              {BENEFITS.map((b) => {
                const on = b.id === benefit;
                return (
                  <Pressable key={b.id} onPress={() => { setBenefit(b.id); setValue(b.id === "premium" ? "" : b.id === "credits" ? "50" : b.id === "free_months" ? "1" : "2"); }} style={[s.chip, on && s.chipOn]} testID={`promo-benefit-${b.id}`}>
                    <Ionicons name={b.icon} size={15} color={on ? C.onSurfaceInverse : VIOLET} /><Text style={[s.chipTxt, on && s.chipTxtOn]}>{b.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.lbl}>{bm.valueLabel}</Text>
            <TextInput value={value} onChangeText={(t) => setValue(t.replace(/\D/g, ""))} keyboardType="number-pad" placeholder={benefit === "premium" ? "Senza scadenza" : "1"} placeholderTextColor={C.muted} style={s.input} testID="promo-value" />

            <Text style={s.lbl}>Scadenza del codice (vuoto = mai)</Text>
            <DateField value={expires} onChange={setExpires} format="it" placeholder="Nessuna scadenza" testID="promo-expires" />

            <Text style={s.lbl}>Numero massimo di utilizzi</Text>
            <View style={s.chips}>
              {([["once", "Una volta sola"], ["n", "N volte"], ["unlimited", "Illimitato"]] as const).map(([k, l]) => (
                <Pressable key={k} onPress={() => setUsesMode(k)} style={[s.chip, usesMode === k && s.chipOn]} testID={`promo-uses-${k}`}><Text style={[s.chipTxt, usesMode === k && s.chipTxtOn]}>{l}</Text></Pressable>
              ))}
            </View>
            {usesMode === "n" ? <TextInput value={maxUses} onChangeText={(t) => setMaxUses(t.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="100" placeholderTextColor={C.muted} style={s.input} testID="promo-max-uses" /> : null}

            <Pressable onPress={save} disabled={!valid || saving} style={[s.primary, (!valid || saving) && { opacity: 0.45 }]} testID="promo-create-save">
              {saving ? <ActivityIndicator color={C.onSurfaceInverse} /> : <Text style={s.primaryTxt}>Crea codice</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PromoDetailModal({ promo, onClose, onToggle, onDelete }: { promo: Promo | null; onClose: () => void; onToggle: (p: Promo) => void; onDelete: (p: Promo) => void }) {
  const [rows, setRows] = useState<Redemption[] | null>(null);
  const [cur, setCur] = useState<Promo | null>(promo);
  useEffect(() => {
    setCur(promo);
    setRows(null);
    if (promo) api<{ code: Promo; items: Redemption[] }>(`/admin/promo-codes/${promo.code_id}/redemptions`).then((r) => { setRows(r.items); setCur(r.code); }).catch(() => setRows([]));
  }, [promo]);
  if (!promo) return null;
  const p = cur || promo;
  const st = STATUS_META[p.status];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet} testID="promo-detail-modal">
          <View style={s.sheetHead}>
            <View style={{ flex: 1 }}><Text style={[s.sheetTitle, { letterSpacing: 1 }]}>{p.code}</Text><Text style={s.desc}>{p.benefit_summary}{p.description ? ` · ${p.description}` : ""}</Text></View>
            <Pressable onPress={onClose} style={s.iconBtn} testID="promo-detail-close"><Ionicons name="close" size={22} color={C.onSurface} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={s.kv}><Text style={s.k}>Stato</Text><Text style={[s.v, { color: st.color }]}>{st.label}</Text></View>
          <View style={s.kv}><Text style={s.k}>Utilizzi</Text><Text style={s.v}>{p.uses_count}{p.max_uses ? ` su ${p.max_uses}` : " · illimitato"}</Text></View>
          <View style={s.kv}><Text style={s.k}>Scadenza</Text><Text style={s.v}>{p.expires_at ? fmtDate(p.expires_at) : "nessuna"}</Text></View>
          <View style={s.kv}><Text style={s.k}>Creato il</Text><Text style={s.v}>{fmtDate(p.created_at)}</Text></View>
          <View style={[s.kv, { borderBottomWidth: 0 }]}>
            <Text style={s.k}>Codice attivo</Text>
            <Switch value={p.active} onValueChange={() => { onToggle(p); setCur({ ...p, active: !p.active }); }} trackColor={{ true: VIOLET }} testID="promo-toggle-active" />
          </View>

          <Text style={[s.lbl, { marginTop: 8 }]}>Chi l&apos;ha usato</Text>
          {rows === null ? <ActivityIndicator color={VIOLET} style={{ marginVertical: 12 }} /> : rows.length === 0 ? <Text style={s.desc}>Nessun utilizzo finora.</Text> : (
            <View testID="promo-redemptions">
              {rows.map((r) => (
                <View key={r.redemption_id} style={s.redRow}>
                  <Ionicons name="person-circle-outline" size={22} color={VIOLET} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.redName}>{r.name || r.email}</Text>
                    <Text style={s.redSub}>{r.email} · {fmtDateTime(r.redeemed_at)}</Text>
                    {r.invited_by_email ? <Text style={s.redSub}>👥 Arrivato da invito di {r.invited_by_email}</Text> : null}
                    {r.subscription?.status === "trial" && r.subscription.days_left != null ? <Text style={s.redSub}>⏳ Prova: {r.subscription.days_left} gg residui</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          )}
          </ScrollView>
          <Pressable onPress={() => onDelete(p)} style={s.deleteBtn} testID="promo-delete"><Ionicons name="trash-outline" size={16} color={C.error} /><Text style={s.deleteTxt}>Elimina codice</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: VIOLET, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 10, paddingBottom: 140 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 60, paddingHorizontal: 24 },
  emptyT: { fontSize: 17, fontWeight: "800", color: C.onSurface },
  emptyS: { fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  code: { fontSize: 18, fontWeight: "900", color: VIOLET, letterSpacing: 1.2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeTxt: { fontSize: 11, fontWeight: "800" },
  benefit: { fontSize: 14, fontWeight: "700", color: C.onSurface },
  desc: { fontSize: 12.5, color: C.muted },
  meta: { flexDirection: "row", gap: 14, marginTop: 4 },
  metaTxt: { fontSize: 12, color: C.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, maxHeight: "92%", paddingBottom: 32 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { fontSize: 19, fontWeight: "800", color: C.onSurface },
  lbl: { fontSize: 12, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: C.divider, borderRadius: 12, paddingHorizontal: 12, color: C.onSurface, backgroundColor: C.surfaceSecondary, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: VIOLET, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: VIOLET },
  chipTxt: { color: VIOLET, fontWeight: "700", fontSize: 13 },
  chipTxtOn: { color: C.onSurfaceInverse },
  primary: { marginTop: 8, minHeight: 50, borderRadius: 14, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center" },
  primaryTxt: { color: C.onSurfaceInverse, fontWeight: "800", fontSize: 16 },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider },
  k: { fontSize: 13, color: C.muted, fontWeight: "600" },
  v: { fontSize: 14, color: C.onSurface, fontWeight: "700" },
  redRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.divider },
  redName: { fontSize: 14, fontWeight: "700", color: C.onSurface },
  redSub: { fontSize: 12, color: C.muted },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: C.error },
  deleteTxt: { color: C.error, fontWeight: "800" },
});

// coach-panel.tsx — V50.z203 — Pannello Master Coach: personalizzazione dei blocchi role-play e delle fasi di sessione.
// Ogni campo è modificabile (testo, immagine, durata, interventi, checklist obiettivi, cliente simulato, manuale Drive);
// se il Master non modifica nulla il consulente vede i default. Le fasi si aggiungono/rimuovono/rinominano/riordinano,
// ognuna con un riferimento Drive (cartella o file) opzionale come manuale.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Image } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { notify, confirmAsync } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { api } from "@/src/api";
import { CGYM_ORANGE } from "@/src/corporate-gym/api";
import { CgymManualRef } from "@/src/corporate-gym/manualsApi";
import { CgymDrivePicker } from "@/src/corporate-gym/CgymDrivePicker";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Phase = { id?: string; name: string; minutes_to?: number | null; manual_ref?: CgymManualRef | null };
type Scenario = {
  key: string; area: "obiezioni" | "winwin"; label: string; description: string; image_url: string | null; duration_min: number; max_turns: number;
  tips: string[]; customer: { name?: string; role?: string; company?: string }; manual_ref: CgymManualRef | null; phases: Phase[];
  is_customized: boolean; customized_fields: string[]; defaults?: Scenario;
  is_custom?: boolean; objection?: string; persona?: string; opening_hint?: string; eval_criteria?: string; voice?: string;
};
const VOICES = ["onyx", "nova", "alloy", "echo", "fable", "shimmer"];

export default function CgymCoachPanel() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Scenario[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [sel, setSel] = useState<Scenario | null>(null);
  const [form, setForm] = useState<Scenario | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<{ target: "scenario" | number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ area: "obiezioni" | "winwin"; label: string; objection: string; persona: string; customer: { name: string; role: string; company: string } }>({ area: "obiezioni", label: "", objection: "", persona: "", customer: { name: "", role: "", company: "" } });

  const createScenario = async () => {
    if (draft.label.trim().length < 3) { notify("Titolo", "Inserisci un titolo di almeno 3 caratteri."); return; }
    setSaving(true);
    try {
      const r = await api<Scenario>("/cgym/config/custom", { method: "POST", body: { area: draft.area, label: draft.label, objection: draft.objection, persona: draft.persona, customer: draft.customer } });
      setCreating(false); setDraft({ area: "obiezioni", label: "", objection: "", persona: "", customer: { name: "", role: "", company: "" } });
      await load();
      setSel(r); setForm({ ...r, tips: [...r.tips], phases: r.phases.map((p) => ({ ...p })) });
      notify("Creato", "Il nuovo role-play è già visibile ai consulenti nella sua sezione. Completa i dettagli qui sotto.");
    } catch (e: any) { notify("Creazione", e?.message || "Errore"); } finally { setSaving(false); }
  };

  const load = useCallback(async () => {
    try { const r = await api<{ items: Scenario[]; can_edit: boolean }>("/cgym/config/scenarios"); setItems(r.items); setCanEdit(r.can_edit); }
    catch (e: any) { notify("Pannello Coach", e?.message || "Errore"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openScenario = async (s: Scenario) => {
    try { const full = await api<Scenario>(`/cgym/config/scenarios/${s.key}`); setSel(full); setForm({ ...full, tips: [...full.tips], phases: full.phases.map((p) => ({ ...p })) }); }
    catch (e: any) { notify("Pannello Coach", e?.message || "Errore"); }
  };

  const save = async () => {
    if (!form || !sel) return;
    setSaving(true);
    try {
      const r = await api<Scenario>(`/cgym/config/scenarios/${sel.key}`, { method: "PUT", body: {
        label: form.label, description: form.description, image_url: form.image_url || "", duration_min: Number(form.duration_min) || sel.defaults?.duration_min,
        max_turns: Number(form.max_turns) || sel.defaults?.max_turns, tips: form.tips, customer: form.customer,
        manual_ref: form.manual_ref || undefined, clear_manual_ref: !form.manual_ref,
        ...(form.is_custom ? { objection: form.objection, persona: form.persona, opening_hint: form.opening_hint, eval_criteria: form.eval_criteria, voice: form.voice, area: form.area } : {}),
        phases: form.phases.map((p) => ({ id: p.id, name: p.name, minutes_to: p.minutes_to ?? null, manual_ref: p.manual_ref || null })),
      } });
      setSel(r); setForm({ ...r, tips: [...r.tips], phases: r.phases.map((p) => ({ ...p })) });
      notify("Salvato", "I consulenti vedranno subito la versione personalizzata.");
      await load();
    } catch (e: any) { notify("Salvataggio", e?.message || "Errore"); } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!sel) return;
    if (sel.is_custom) {
      if (!(await confirmAsync("Eliminare il role-play?", "Sparirà dalla sezione Gym per tutti i consulenti."))) return;
      setSaving(true);
      try { await api(`/cgym/config/scenarios/${sel.key}`, { method: "DELETE" }); setSel(null); setForm(null); await load(); } catch (e: any) { notify("Eliminazione", e?.message || "Errore"); } finally { setSaving(false); }
      return;
    }
    if (!(await confirmAsync("Ripristinare i default?", "Tutte le personalizzazioni di questo role-play (fasi incluse) verranno rimosse."))) return;
    setSaving(true);
    try { const r = await api<Scenario>(`/cgym/config/scenarios/${sel.key}`, { method: "DELETE" }); setSel(r); setForm({ ...r, tips: [...r.tips], phases: r.phases.map((p) => ({ ...p })) }); await load(); }
    catch (e: any) { notify("Ripristino", e?.message || "Errore"); } finally { setSaving(false); }
  };

  const up = (patch: Partial<Scenario>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const movePhase = (i: number, dir: -1 | 1) => {
    if (!form) return;
    const ph = [...form.phases]; const j = i + dir; if (j < 0 || j >= ph.length) return;
    [ph[i], ph[j]] = [ph[j], ph[i]]; up({ phases: ph });
  };

  const field = (label: string, value: string, onChange: (v: string) => void, opts?: { multiline?: boolean; keyboard?: "numeric" | "default"; testID?: string; placeholder?: string }) => (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} multiline={opts?.multiline} keyboardType={opts?.keyboard || "default"} placeholder={opts?.placeholder} placeholderTextColor={HT.muted}
        style={[styles.input, opts?.multiline && { minHeight: 80, textAlignVertical: "top" }]} editable={canEdit} testID={opts?.testID} />
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => (form ? (setForm(null), setSel(null)) : router.back())} hitSlop={10} testID="cgym-coach-back"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <Text style={styles.title} numberOfLines={1}>{form ? `Role-play · ${form.label}` : "Pannello Master Coach"}</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad + 40, gap: 12 }} keyboardShouldPersistTaps="handled">
        {!items ? <ActivityIndicator color={CGYM_ORANGE} style={{ marginTop: 30 }} /> : !form ? (
          <>
            <Text style={styles.hint}>{canEdit ? "Tocca un role-play per personalizzare testo, immagine, durata, interventi, checklist obiettivi, cliente simulato, manuale Drive e fasi di sessione." : "Solo il Master Coach può modificare i role-play. Qui vedi la configurazione attiva."}</Text>
            {canEdit && !creating && (
              <Pressable onPress={() => setCreating(true)} style={[styles.card, { borderStyle: "dashed", alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "center" }]} testID="cgym-coach-new">
                <Ionicons name="add-circle" size={22} color={CGYM_ORANGE} /><Text style={[styles.cardTitle, { color: CGYM_ORANGE }]}>Nuovo role-play</Text>
              </Pressable>
            )}
            {creating && (
              <View style={styles.card} testID="cgym-coach-create">
                <Text style={styles.section}>Nuovo role-play</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["obiezioni", "winwin"] as const).map((a) => (
                    <Pressable key={a} onPress={() => setDraft({ ...draft, area: a })} style={[styles.smallBtn, draft.area !== a && styles.ghost, { flex: 1, alignItems: "center" }]} testID={`cgym-coach-new-area-${a}`}>
                      <Text style={[styles.smallBtnTxt, draft.area !== a && { color: HT.muted }]}>{a === "obiezioni" ? "Gym Obiezioni" : "Gym WIN-WIN"}</Text>
                    </Pressable>
                  ))}
                </View>
                {field("Titolo *", draft.label, (v) => setDraft({ ...draft, label: v }), { placeholder: "es. Obiezione FIDUCIA", testID: "cgym-coach-new-label" })}
                {field("Obiezione / tema (una riga)", draft.objection, (v) => setDraft({ ...draft, objection: v }), { placeholder: "es. Non vi conosco, perché dovrei fidarmi?", testID: "cgym-coach-new-objection" })}
                {field("Come si comporta il cliente (istruzioni all'AI)", draft.persona, (v) => setDraft({ ...draft, persona: v }), { multiline: true, placeholder: "Chi è, cosa vuole davvero, come reagisce, cosa lo convince…", testID: "cgym-coach-new-persona" })}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>{field("Nome cliente", draft.customer.name, (v) => setDraft({ ...draft, customer: { ...draft.customer, name: v } }), { testID: "cgym-coach-new-cust" })}</View>
                  <View style={{ flex: 1 }}>{field("Ruolo", draft.customer.role, (v) => setDraft({ ...draft, customer: { ...draft.customer, role: v } }))}</View>
                </View>
                {field("Azienda", draft.customer.company, (v) => setDraft({ ...draft, customer: { ...draft.customer, company: v } }))}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={createScenario} disabled={saving} style={[styles.primaryBtn, { flex: 1 }]} testID="cgym-coach-new-save">{saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryTxt}>Crea</Text>}</Pressable>
                  <Pressable onPress={() => setCreating(false)} style={[styles.smallBtn, styles.ghost, { minHeight: 48 }]}><Text style={[styles.smallBtnTxt, { color: HT.muted }]}>Annulla</Text></Pressable>
                </View>
              </View>
            )}
            {items.map((s) => (
              <Pressable key={s.key} onPress={() => openScenario(s)} style={styles.card} testID={`cgym-coach-scenario-${s.key}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name={s.area === "winwin" ? "briefcase" : "chatbubbles"} size={22} color={s.area === "winwin" ? "#0F9D58" : CGYM_ORANGE} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{s.label}</Text>
                    <Text style={styles.sub}>{s.customer?.name} · {s.duration_min} min · {s.max_turns} interventi · {s.phases.length} fasi{s.manual_ref ? " · manuale collegato" : ""}</Text>
                  </View>
                  {s.is_custom ? <Text style={[styles.badge, { backgroundColor: '#7C3AED' }]}>Nuovo</Text> : s.is_customized ? <Text style={styles.badge}>Personalizzato</Text> : <Text style={[styles.badge, { backgroundColor: HT.card2, color: HT.muted }]}>Default</Text>}
                  <Ionicons name="chevron-forward" size={18} color={HT.muted} />
                </View>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            {form.is_customized && form.customized_fields.length > 0 && <Text style={styles.hint}>Campi personalizzati: {form.customized_fields.join(", ")}. Gli altri usano i default.</Text>}
            {form.is_custom && <Text style={styles.hint}>Role-play creato dal Master Coach: visibile nella sezione {form.area === "winwin" ? "Gym WIN-WIN" : "Gym Obiezioni"} per tutti i consulenti.</Text>}
            <View style={styles.card} testID="cgym-coach-form">
              <Text style={styles.section}>Blocco role-play</Text>
              {field("Titolo", form.label, (v) => up({ label: v }), { testID: "cgym-coach-label" })}
              {field("Testo descrittivo", form.description, (v) => up({ description: v }), { multiline: true, testID: "cgym-coach-description" })}
              {field("Immagine (URL)", form.image_url || "", (v) => up({ image_url: v }), { placeholder: "https://… (vuoto = icona di default)", testID: "cgym-coach-image" })}
              {!!form.image_url && <Image source={{ uri: form.image_url }} style={styles.preview} resizeMode="cover" />}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>{field("Durata (minuti)", String(form.duration_min ?? ""), (v) => up({ duration_min: Number(v.replace(",", ".")) || 0 }), { keyboard: "numeric", testID: "cgym-coach-duration" })}</View>
                <View style={{ flex: 1 }}>{field("Max interventi", String(form.max_turns ?? ""), (v) => up({ max_turns: parseInt(v, 10) || 0 }), { keyboard: "numeric", testID: "cgym-coach-turns" })}</View>
              </View>
            </View>

            {form.is_custom && (
              <View style={styles.card} testID="cgym-coach-custom-fields">
                <Text style={styles.section}>Comportamento del cliente AI</Text>
                {field("Obiezione / tema", form.objection || "", (v) => up({ objection: v }))}
                {field("Istruzioni al cliente simulato", form.persona || "", (v) => up({ persona: v }), { multiline: true })}
                {field("Come apre la conversazione", form.opening_hint || "", (v) => up({ opening_hint: v }), { multiline: true, placeholder: "vuoto = apertura automatica sul tema" })}
                {field("Criteri di valutazione finale", form.eval_criteria || "", (v) => up({ eval_criteria: v }), { multiline: true, placeholder: "vuoto = criteri standard" })}
                <Text style={styles.fieldLabel}>Voce</Text>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {VOICES.map((v) => <Pressable key={v} onPress={() => up({ voice: v })} style={[styles.smallBtn, form.voice !== v && styles.ghost]}><Text style={[styles.smallBtnTxt, form.voice !== v && { color: HT.muted }]}>{v}</Text></Pressable>)}
                </View>
              </View>
            )}
            <View style={styles.card}>
              <Text style={styles.section}>Cliente simulato</Text>
              {field("Nome", form.customer?.name || "", (v) => up({ customer: { ...form.customer, name: v } }), { testID: "cgym-coach-cust-name" })}
              {field("Ruolo", form.customer?.role || "", (v) => up({ customer: { ...form.customer, role: v } }), { testID: "cgym-coach-cust-role" })}
              {field("Azienda", form.customer?.company || "", (v) => up({ customer: { ...form.customer, company: v } }), { testID: "cgym-coach-cust-company" })}
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Checklist obiettivi</Text>
              {form.tips.map((t, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <TextInput value={t} onChangeText={(v) => { const tips = [...form.tips]; tips[i] = v; up({ tips }); }} style={[styles.input, { flex: 1 }]} editable={canEdit} testID={`cgym-coach-tip-${i}`} />
                  {canEdit && <Pressable onPress={() => up({ tips: form.tips.filter((_, j) => j !== i) })} hitSlop={8} style={styles.iconBtn}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>}
                </View>
              ))}
              {canEdit && <Pressable onPress={() => up({ tips: [...form.tips, ""] })} style={styles.addBtn} testID="cgym-coach-add-tip"><Ionicons name="add" size={16} color={CGYM_ORANGE} /><Text style={styles.addTxt}>Aggiungi obiettivo</Text></Pressable>}
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Manuale di riferimento (Drive)</Text>
              <Text style={styles.sub}>{form.manual_ref ? `${form.manual_ref.kind === "folder" ? "📁" : "📄"} ${form.manual_ref.name || form.manual_ref.id}` : "Nessun manuale collegato (avviso soft per i consulenti)"}</Text>
              {canEdit && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setPicker({ target: "scenario" })} style={styles.smallBtn} testID="cgym-coach-pick-manual"><Text style={styles.smallBtnTxt}>{form.manual_ref ? "Cambia" : "Scegli cartella o file"}</Text></Pressable>
                  {form.manual_ref && <Pressable onPress={() => up({ manual_ref: null })} style={[styles.smallBtn, styles.ghost]}><Text style={[styles.smallBtnTxt, { color: HT.muted }]}>Rimuovi</Text></Pressable>}
                </View>
              )}
            </View>

            <View style={styles.card} testID="cgym-coach-phases">
              <Text style={styles.section}>Fasi di sessione ({form.phases.length})</Text>
              <Text style={styles.sub}>Ordine = ordine di lista. «Fino al minuto» indica quando finisce la fase (vuoto = suddivisione automatica). Ogni fase può avere un manuale Drive.</Text>
              {form.phases.map((p, i) => (
                <View key={p.id || i} style={styles.phase} testID={`cgym-coach-phase-${i}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.phaseNum}>{i + 1}</Text>
                    <TextInput value={p.name} onChangeText={(v) => { const ph = [...form.phases]; ph[i] = { ...p, name: v }; up({ phases: ph }); }} placeholder="Nome fase" placeholderTextColor={HT.muted} style={[styles.input, { flex: 1 }]} editable={canEdit} testID={`cgym-coach-phase-name-${i}`} />
                    <TextInput value={p.minutes_to != null ? String(p.minutes_to) : ""} onChangeText={(v) => { const ph = [...form.phases]; ph[i] = { ...p, minutes_to: v.trim() ? Number(v.replace(",", ".")) : null }; up({ phases: ph }); }} placeholder="min" placeholderTextColor={HT.muted} keyboardType="numeric" style={[styles.input, { width: 62, textAlign: "center" }]} editable={canEdit} />
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>{p.manual_ref ? `${p.manual_ref.kind === "folder" ? "📁" : "📄"} ${p.manual_ref.name || p.manual_ref.id}` : "Nessun manuale collegato"}</Text>
                    {canEdit && (
                      <>
                        <Pressable onPress={() => setPicker({ target: i })} hitSlop={6} style={styles.iconBtn} testID={`cgym-coach-phase-manual-${i}`}><Ionicons name="link" size={18} color={HT.brand} /></Pressable>
                        <Pressable onPress={() => movePhase(i, -1)} hitSlop={6} style={styles.iconBtn} testID={`cgym-coach-phase-up-${i}`}><Ionicons name="arrow-up" size={18} color={HT.text} /></Pressable>
                        <Pressable onPress={() => movePhase(i, 1)} hitSlop={6} style={styles.iconBtn} testID={`cgym-coach-phase-down-${i}`}><Ionicons name="arrow-down" size={18} color={HT.text} /></Pressable>
                        <Pressable onPress={() => up({ phases: form.phases.filter((_, j) => j !== i) })} hitSlop={6} style={styles.iconBtn} testID={`cgym-coach-phase-del-${i}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
                      </>
                    )}
                  </View>
                </View>
              ))}
              {canEdit && <Pressable onPress={() => up({ phases: [...form.phases, { name: `Fase ${form.phases.length + 1}`, minutes_to: null, manual_ref: null }] })} style={styles.addBtn} testID="cgym-coach-add-phase"><Ionicons name="add" size={16} color={CGYM_ORANGE} /><Text style={styles.addTxt}>Aggiungi fase</Text></Pressable>}
            </View>

            {canEdit && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={save} disabled={saving} style={[styles.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]} testID="cgym-coach-save">
                  {saving ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="save" size={18} color="#FFF" /><Text style={styles.primaryTxt}>Salva</Text></>}
                </Pressable>
                <Pressable onPress={reset} disabled={saving} style={[styles.smallBtn, styles.ghost, { minHeight: 48 }]} testID="cgym-coach-reset"><Text style={[styles.smallBtnTxt, { color: form.is_custom ? "#DC2626" : HT.muted }]}>{form.is_custom ? "Elimina role-play" : "Ripristina default"}</Text></Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      <CgymDrivePicker
        visible={!!picker}
        title={picker?.target === "scenario" ? "Manuale del role-play" : `Manuale fase ${typeof picker?.target === "number" ? picker.target + 1 : ""}`}
        onClose={() => setPicker(null)}
        onPick={(ref) => {
          if (!form || !picker) return;
          if (picker.target === "scenario") up({ manual_ref: ref });
          else { const ph = [...form.phases]; ph[picker.target] = { ...ph[picker.target], manual_ref: ref }; up({ phases: ph }); }
          setPicker(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800", color: HT.text },
  hint: { fontSize: 12.5, color: HT.muted, lineHeight: 18 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  section: { fontSize: 12, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  sub: { fontSize: 12, color: HT.muted, lineHeight: 16 },
  badge: { fontSize: 10.5, fontWeight: "800", color: "#FFF", backgroundColor: CGYM_ORANGE, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: HT.text },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: HT.text, minHeight: 42, backgroundColor: HT.card },
  preview: { width: "100%", height: 140, borderRadius: 12, backgroundColor: HT.border },
  iconBtn: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40 },
  addTxt: { color: CGYM_ORANGE, fontWeight: "800", fontSize: 13 },
  phase: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 8, gap: 6, backgroundColor: HT.card2 },
  phaseNum: { width: 22, textAlign: "center", fontWeight: "900", color: CGYM_ORANGE },
  smallBtn: { backgroundColor: CGYM_ORANGE, borderRadius: 12, paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
  smallBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12.5 },
  ghost: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: CGYM_ORANGE, borderRadius: 14, minHeight: 48 },
  primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
});

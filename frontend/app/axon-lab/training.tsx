// app/axon-lab/training.tsx — V50.z343 — AXON LAB · AREA MASTER: Fase 1 cliente tipo (checklist 12 documenti + campi liberi)
// e Fase 2 addestramento moduli (modulo vuoto + esempio compilato facoltativo → regole di mapping campo per campo).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CrtFilePick, type PickedFile } from "@/src/CrtFilePick";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";
import { LabDocChecklist } from "@/src/axonlab/LabDocChecklist";
import { LabDocSheet } from "@/src/axonlab/LabDocSheet";
import { LabExtractionTest } from "@/src/axonlab/LabExtractionTest"; // V50.z375 — test estrazione completa
import { confirmAsync } from "@/src/utils/notify";
import { useLabDossier } from "@/src/axonlab/useLabDossier";
import type { LabDocSpec, LabDocEntry, LabDossier, LabModule } from "@/src/axonlab/labApi";

type LabProfile = { profile_id: string; name: string; completion: { confirmed: number; total: number; percent: number } };
type Training = LabDossier & { docs_spec: LabDocSpec[]; key_labels: Record<string, string>; profile_id: string; name: string; profiles: LabProfile[] };

export default function AxonLabTraining() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [tr, setTr] = useState<Training | null>(null);
  const [modules, setModules] = useState<LabModule[]>([]);
  const [loading, setLoading] = useState(true);
  const params = useLocalSearchParams<{ phase?: string }>(); // V50.z356 — apertura diretta della Fase 2 dall'hub
  const [phase, setPhase] = useState<1 | 2>(params.phase === "2" ? 2 : 1);
  const [extraLabel, setExtraLabel] = useState(""); const [extraValue, setExtraValue] = useState("");
  const [modName, setModName] = useState(""); const [blank, setBlank] = useState<PickedFile | null>(null); const [example, setExample] = useState<PickedFile | null>(null);
  const [creating, setCreating] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null); // V50.z375 — clienti tipo multipli
  const [newProfile, setNewProfile] = useState(""); const [renaming, setRenaming] = useState(false); const [renameVal, setRenameVal] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([api<Training>(`/lab/training${profileId ? `?profile=${profileId}` : ""}`), api<{ items: LabModule[] }>("/lab/modules")]);
      setTr(t); setModules(m.items || []); if (!profileId) setProfileId(t.profile_id);
    } catch (e: any) { notify("Axon Lab", e?.message || "Accesso non consentito"); router.back(); }
    finally { setLoading(false); }
  }, [router, profileId]);
  useEffect(() => { load(); }, [load]);

  const q = profileId ? `?profile=${profileId}` : "";
  const addProfile = async () => {
    if (!newProfile.trim()) return;
    try { const p = await api<LabProfile>("/lab/training/profiles", { method: "POST", body: { name: newProfile.trim() } }); setNewProfile(""); setProfileId(p.profile_id); }
    catch (e: any) { notify("Cliente tipo", e?.message || "Creazione non riuscita"); }
  };
  const renameProfile = async () => {
    if (!renameVal.trim() || !profileId) return;
    try { await api(`/lab/training/profiles/${profileId}`, { method: "PATCH", body: { name: renameVal.trim() } }); setRenaming(false); await load(); }
    catch (e: any) { notify("Cliente tipo", e?.message || "Rinomina non riuscita"); }
  };
  const deleteProfile = async () => {
    if (!tr || !profileId) return;
    if (!(await confirmAsync("Elimina cliente tipo", `Eliminare «${tr.name}» con tutti i suoi documenti? Axon non lo userà più come riferimento.`))) return;
    try { await api(`/lab/training/profiles/${profileId}`, { method: "DELETE" }); setProfileId(null); }
    catch (e: any) { notify("Cliente tipo", e?.message || "Eliminazione non riuscita"); }
  };

  const onDocs = useCallback((docs: Record<string, LabDocEntry>, completion: Training["completion"]) => setTr((t) => (t ? { ...t, docs, completion } : t)), []);
  const dossier = useLabDossier("/lab/training", onDocs, q);

  const addExtra = async () => {
    if (!extraLabel.trim()) return;
    const r = await api<{ extra: Training["extra"] }>(`/lab/training/extra${q}`, { method: "POST", body: { label: extraLabel, value: extraValue } });
    setTr((t) => (t ? { ...t, extra: r.extra } : t)); setExtraLabel(""); setExtraValue("");
  };
  const delExtra = async (id: string) => {
    const r = await api<{ extra: Training["extra"] }>(`/lab/training/extra/${id}${q}`, { method: "DELETE" });
    setTr((t) => (t ? { ...t, extra: r.extra } : t));
  };

  const createModule = async () => {
    if (!blank) { notify("Modulo vuoto", "Carica il PDF del modulo vuoto."); return; }
    setCreating(true);
    try {
      const m = await api<LabModule>("/lab/modules", { method: "POST", body: { name: modName.trim() || blank.name.replace(/\.pdf$/i, ""), pdf_base64: blank.data_base64, example_pdf_base64: example?.data_base64 || null } });
      setModName(""); setBlank(null); setExample(null);
      setModules((ms) => [m, ...ms]);
      router.push(`/axon-lab/module/${m.template_id}` as any);
    } catch (e: any) { notify("Analisi modulo non riuscita", e?.message || ""); }
    finally { setCreating(false); }
  };
  const delModule = async (id: string) => {
    try { await api(`/lab/modules/${id}`, { method: "DELETE" }); setModules((ms) => ms.filter((m) => m.template_id !== id)); } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader title="Axon Lab · Addestramento" sub="Area Master · il modello vale per tutti i consulenti" testID="lab-training" />
      <View style={s.tabs}>
        {([1, 2] as const).map((p) => (
          <Pressable key={p} onPress={() => setPhase(p)} style={[s.tab, phase === p && s.tabOn]} testID={`lab-phase-${p}`}>
            <Text style={[s.tabTxt, phase === p && { color: HT.white }]}>{p === 1 ? "Fase 1 · Cliente tipo" : "Fase 2 · Moduli"}</Text>
          </Pressable>
        ))}
      </View>
      {loading || !tr ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.axon} /> : (
        <KScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
          {phase === 1 ? (
            <>
              <Text style={L.cardSub}>{"Carica i documenti di uno o più clienti d'esempio. Axon legge ogni documento e mostra i dati campo per campo: approva, correggi o scarta prima di procedere. Più clienti tipo (azienda con timbro, privato, …) coprono situazioni e documenti diversi: Axon li usa tutti come riferimento."}</Text>
              {/* V50.z375 — selettore clienti tipo */}
              <View style={L.card} testID="lab-profiles">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[L.cardTitle, { flex: 1 }]}>Clienti tipo ({tr.profiles.length})</Text>
                  <Pressable onPress={() => { setRenameVal(tr.name); setRenaming((v) => !v); }} hitSlop={8} testID="lab-profile-rename"><Ionicons name="pencil" size={18} color={HT.axon} /></Pressable>
                  {tr.profiles.length > 1 ? <Pressable onPress={deleteProfile} hitSlop={8} testID="lab-profile-delete"><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable> : null}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {tr.profiles.map((p) => { const on = p.profile_id === tr.profile_id; return (
                    <Pressable key={p.profile_id} onPress={() => setProfileId(p.profile_id)} style={[s.pChip, on && s.pChipOn]} testID={`lab-profile-${p.profile_id}`}>
                      <Text style={[s.pChipTxt, on && { color: HT.white }]} numberOfLines={1}>{p.name}</Text><Text style={[s.pChipPct, on && { color: HT.white }]}>{p.completion.percent}%</Text>
                    </Pressable>
                  ); })}
                </View>
                {renaming ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput value={renameVal} onChangeText={setRenameVal} placeholder="Nome cliente tipo" placeholderTextColor={HT.muted} style={[L.input, { flex: 1 }]} testID="lab-profile-rename-input" />
                    <Pressable onPress={renameProfile} style={[L.btn, L.btnPrimary, { paddingHorizontal: 14 }]} testID="lab-profile-rename-save"><Text style={L.btnTxt}>Salva</Text></Pressable>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput value={newProfile} onChangeText={setNewProfile} placeholder="Es. Cliente tipo 2 - Privato" placeholderTextColor={HT.muted} style={[L.input, { flex: 1 }]} testID="lab-profile-new-name" />
                  <Pressable onPress={addProfile} disabled={!newProfile.trim()} style={[L.btn, L.btnGhost, { paddingHorizontal: 12 }, !newProfile.trim() && { opacity: 0.5 }]} testID="lab-profile-add"><Ionicons name="person-add" size={16} color={HT.axon} /><Text style={[L.btnTxt, { color: HT.axon }]}>Aggiungi</Text></Pressable>
                </View>
              </View>
              <LabDocChecklist specs={tr.docs_spec} docs={tr.docs} busy={dossier.busy} completion={tr.completion} onPress={(sp) => dossier.setOpen(sp)} title={`Anagrafica · ${tr.name}`} />
              <View style={L.card} testID="lab-extra">
                <Text style={L.cardTitle}>Campi aggiuntivi liberi</Text>
                <Text style={L.cardSub}>Ripetibili · diventano fonti disponibili per il mapping dei moduli</Text>
                {tr.extra.map((x) => (
                  <View key={x.id} style={s.extraRow}>
                    <View style={{ flex: 1 }}><Text style={s.extraLbl}>{x.label}</Text><Text style={s.extraVal}>{x.value || "—"}</Text></View>
                    <Pressable onPress={() => delExtra(x.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable>
                  </View>
                ))}
                <TextInput value={extraLabel} onChangeText={setExtraLabel} placeholder="Nome del campo (es. Codice agente)" placeholderTextColor={HT.muted} style={L.input} testID="lab-extra-label" />
                <TextInput value={extraValue} onChangeText={setExtraValue} placeholder="Valore d'esempio" placeholderTextColor={HT.muted} style={L.input} testID="lab-extra-value" />
                <Pressable onPress={addExtra} style={[L.btn, L.btnGhost]} testID="lab-extra-add"><Ionicons name="add" size={18} color={HT.axon} /><Text style={[L.btnTxt, { color: HT.axon }]}>Aggiungi campo</Text></Pressable>
              </View>
              <LabExtractionTest profileId={tr.profile_id} profileName={tr.name} />
              <Pressable onPress={() => setPhase(2)} style={[L.btn, L.btnPrimary]} testID="lab-go-phase2"><Text style={L.btnTxt}>Avanti · Fase 2 · Addestra i moduli</Text><Ionicons name="arrow-forward" size={16} color={HT.white} /></Pressable>
            </>
          ) : (
            <>
              <View style={L.card} testID="lab-module-new">
                <Text style={L.cardTitle}>Nuovo modulo da addestrare</Text>
                <Text style={L.cardSub}>Carica il modulo VUOTO. Facoltativo: lo stesso modulo COMPILATO come esempio → Axon propone il mapping, tu confermi campo per campo.</Text>
                <TextInput value={modName} onChangeText={setModName} placeholder="Nome modulo (es. Proposta di adesione luce)" placeholderTextColor={HT.muted} style={L.input} testID="lab-module-name" />
                <View style={s.pickRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.pickLbl}>Modulo vuoto *</Text>
                    <CrtFilePick onPicked={setBlank} label={blank ? "Cambia" : "Carica PDF"} testID="lab-module-blank" />
                    {blank ? <Text style={L.muted} numberOfLines={1}>📄 {blank.name}</Text> : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.pickLbl}>Esempio compilato</Text>
                    <CrtFilePick onPicked={setExample} label={example ? "Cambia" : "Carica PDF"} testID="lab-module-example" />
                    {example ? <Text style={L.muted} numberOfLines={1}>📄 {example.name}</Text> : null}
                  </View>
                </View>
                <Pressable onPress={createModule} disabled={creating || !blank} style={[L.btn, L.btnPrimary, (creating || !blank) && { opacity: 0.5 }]} testID="lab-module-create">
                  {creating ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="flask" size={16} color={HT.white} />}
                  <Text style={L.btnTxt}>{creating ? "Axon analizza il modulo…" : "Analizza e inizia il mapping"}</Text>
                </Pressable>
              </View>

              <Text style={L.sectionTitle}>Moduli ({modules.length})</Text>
              {modules.length === 0 ? <Text style={L.cardSub}>Nessun modulo ancora. Carica il primo modulo vuoto qui sopra.</Text> : null}
              {modules.map((m) => (
                <Pressable key={m.template_id} onPress={() => router.push(`/axon-lab/module/${m.template_id}` as any)} style={[L.card, { flexDirection: "row", alignItems: "center", gap: 10 }]} testID={`lab-module-${m.template_id}`}>
                  <View style={[s.modIcon, { backgroundColor: m.trained ? HT.successTint : HT.warningTint }]}><Ionicons name={m.trained ? "checkmark-done" : "construct"} size={20} color={m.trained ? HT.success : HT.warning} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={L.cardTitle} numberOfLines={1}>{m.name}</Text>
                    <Text style={L.cardSub}>{m.field_count} campi · {m.mapping_count} regole · {m.trained ? "Addestrato" : "Da completare"}{m.lab_has_example ? " · con esempio" : ""}</Text>
                  </View>
                  <Pressable onPress={() => delModule(m.template_id)} hitSlop={8} testID={`lab-module-del-${m.template_id}`}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable>
                </Pressable>
              ))}
              <View style={[L.card, { backgroundColor: HT.axonTint, borderColor: HT.axonLine }]}>
                <Text style={[L.cardSub, { color: HT.text }]}>Regola data e luogo: non vengono mai estratti. Alla fine di ogni compilazione il consulente li inserisce a mano; se non li inserisce, restano vuoti.</Text>
              </View>
            </>
          )}
        </KScrollView>
      )}
      {dossier.open ? (
        <LabDocSheet spec={dossier.open} entry={tr?.docs[dossier.open.id]} keyLabels={tr?.key_labels || {}} busy={!!dossier.busy[dossier.open.id]}
          onClose={() => dossier.setOpen(null)} onUpload={(b) => dossier.upload(dossier.open!, b)} onConfirm={(v, st) => dossier.confirm(dossier.open!, v, st)} />
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  pChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingHorizontal: 12, maxWidth: "100%" },
  pChipOn: { backgroundColor: HT.axon, borderColor: HT.axon }, pChipTxt: { fontSize: 13, fontWeight: "800", color: HT.text, flexShrink: 1 }, pChipPct: { fontSize: 11, fontWeight: "800", color: HT.muted },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  tab: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  tabOn: { backgroundColor: HT.axon, borderColor: HT.axon },
  tabTxt: { color: HT.text2, fontWeight: "800", fontSize: 12.5 },
  extraRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HT.border },
  extraLbl: { color: HT.text, fontWeight: "700", fontSize: 13 },
  extraVal: { color: HT.muted, fontSize: 12 },
  pickRow: { flexDirection: "row", gap: 10 },
  pickLbl: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  modIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});

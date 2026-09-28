// src/AreaMiniWizard.tsx — V50.z227 — Mini-wizard contestuale per area (max 3 passi, mai un form lungo).
// REGOLA TRASVERSALE: prima opzione SEMPRE «Carica foto, file o PDF» → AxonOS estrae i dati (OCR/AI) → campi precompilati →
// conferma/correzione solo di ciò che manca. Digitazione manuale disponibile ma mai per prima. Ogni file: «Dove lo salvo?»
// Personale / Lavoro / Famiglia (un tap). Passi: upload | choice | link | custom (aree personalizzate).
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, Switch, Platform } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { uploadAreaExtract } from "@/src/utils/upload";
import { launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import { notify } from "@/src/utils/notify";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { DateField } from "@/src/ui/DateField"; // V50.z388 — calendario nativo su ogni campo data

export type AreaField = { key: string; label: string; type?: "date" | "text"; deadline?: string };
export type AreaStep = { id: string; kind: "upload" | "choice" | "link" | "custom"; title: string; hint?: string; extract?: string; fields?: AreaField[]; extra_fields?: AreaField[]; field?: string; options?: { value: string; label: string }[]; route?: string; cta?: string };
export type AreaCustom = { area_key: string; name: string; desc?: string; sites?: string[]; track_deadlines?: boolean; deadlines?: { label: string; date: string; recurring?: boolean }[] };
export type AreaCfg = { key: string; title: string; icon: string; desc: string; on: boolean; custom: boolean; future: boolean; status: "complete" | "incomplete" | "na"; wizard?: { steps: AreaStep[]; done_note?: string } | null; profile?: { data?: Record<string, any> } | null; custom_area?: AreaCustom | null };
export type Folder = "personale" | "lavoro" | "famiglia";

const PURPLE = "#7C3AED";
const FOLDERS: { key: Folder; label: string; icon: string }[] = [{ key: "personale", label: "Personale", icon: "person" }, { key: "lavoro", label: "Lavoro", icon: "briefcase" }, { key: "famiglia", label: "Famiglia", icon: "home" }];

export function AreaMiniWizard({ area, visible, onClose, onDone }: { area: AreaCfg | null; visible: boolean; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const bottomPad = useBottomSheetPadding();
  const steps = useMemo(() => area?.wizard?.steps || [], [area]);
  const [idx, setIdx] = useState(0);
  const [data, setData] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [phase, setPhase] = useState<"pick" | "fields">("pick");
  const [folder, setFolder] = useState<Folder>("personale");
  const [busy, setBusy] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [recurring, setRecurring] = useState<Record<string, boolean>>({}); // V50.z228 — ripeti ogni anno per campo scadenza
  // custom area
  const [cName, setCName] = useState(""); const [cDesc, setCDesc] = useState(""); const [cSites, setCSites] = useState(["", "", ""]);
  const [cTrack, setCTrack] = useState(false); const [cDeadlines, setCDeadlines] = useState<{ label: string; date: string; recurring?: boolean }[]>([{ label: "", date: "" }]);

  useEffect(() => {
    if (!visible) return;
    const prof = area?.profile?.data || {};
    // riparte dal primo passo non ancora completato (dati già confermati → precompilati)
    const stepsArr = area?.wizard?.steps || [];
    const firstOpen = stepsArr.findIndex((s) => s.kind === "upload" ? [...(s.fields || []), ...(s.extra_fields || [])].some((f) => !prof[f.key]) : s.kind === "choice" ? !prof[s.field!] : true);
    setIdx(firstOpen < 0 ? 0 : firstOpen); setPhase("pick"); setMissing([]); setBusy(""); setFileName("");
    setData(Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, String(v ?? "")])));
    const rec = (area?.profile as any)?.recurring || {};
    setRecurring(Object.fromEntries(stepsArr.flatMap((s) => [...(s.fields || []), ...(s.extra_fields || [])]).filter((f) => f.deadline).map((f) => [f.key, rec[f.key] ?? true])));
    const ca = area?.custom_area;
    setCName(ca?.name || ""); setCDesc(ca?.desc || ""); setCSites([ca?.sites?.[0] || "", ca?.sites?.[1] || "", ca?.sites?.[2] || ""]);
    setCTrack(!!ca?.track_deadlines); setCDeadlines(ca?.deadlines?.length ? ca.deadlines : [{ label: "", date: "" }]);
  }, [visible, area]);

  const step = steps[idx];
  const isLast = idx >= steps.length - 1;
  const fields: AreaField[] = [...(step?.fields || []), ...(step?.extra_fields || [])];

  const saveProfile = async (patch: Record<string, string>, complete?: boolean) => {
    const r = await api<{ status: string; missing: string[]; reminders_created: number }>(`/axon/areas/${area!.key}/profile`, { method: "PUT", body: { data: patch, complete, recurring } });
    return r;
  };
  const advance = async (r?: { reminders_created?: number }) => {
    if (isLast) {
      notify("Area configurata ✅", `${area?.title}${r?.reminders_created ? ` · ${r.reminders_created} avvisi scadenza creati` : ""}${area?.wizard?.done_note ? `\n${area.wizard.done_note}` : ""}`);
      onDone(); onClose();
    } else { setIdx((i) => i + 1); setPhase("pick"); setMissing([]); setFileName(""); }
  };

  const runExtract = async (src: { uri: string; name: string; mime: string }) => {
    setBusy("AxonOS sta leggendo il documento…");
    try {
      const r = await uploadAreaExtract(area!.key, src, step.extract || "generic", folder);
      setData((d) => ({ ...d, ...r.fields, ...((r as any).expense_id ? { expense_id: (r as any).expense_id } : {}) }));
      setMissing(r.missing || []);
      setFileName(`${r.file.name} → ${r.file.folder_label}`);
      setPhase("fields");
      if (!r.ocr_ok) notify("Non sono riuscito a leggere tutto", "Il file è salvato: completa i campi a mano.");
    } catch (e: any) { notify("Caricamento non riuscito", e?.message || String(e)); }
    finally { setBusy(""); }
  };
  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      await runExtract({ uri: a.uri, name: a.name || `file-${Date.now()}`, mime: a.mimeType || "application/octet-stream" });
    } catch (e: any) { notify("Errore", e?.message || String(e)); }
  };
  const takePhoto = async () => {
    try {
      const res = await launchCameraUniversal({ mediaTypes: "images", quality: 0.8 });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const a = res.assets[0];
      await runExtract({ uri: a.uri, name: a.fileName || `foto-${Date.now()}.jpg`, mime: a.mimeType || "image/jpeg" });
    } catch (e: any) { notify("Errore fotocamera", e?.message || String(e)); }
  };
  const confirmFields = async () => {
    setBusy("Salvo…");
    try {
      const patch: Record<string, string> = Object.fromEntries(fields.map((f) => [f.key, data[f.key] || ""]));
      if (data.expense_id) patch.expense_id = data.expense_id; // V50.z229 — aggiorna la riga nello storico spese
      const r = await saveProfile(patch, isLast ? true : undefined);
      await advance(r);
    } catch (e: any) { notify("Salvataggio non riuscito", e?.message || String(e)); }
    finally { setBusy(""); }
  };
  const choose = async (value: string) => {
    setBusy("Salvo…");
    try { const r = await saveProfile({ [step.field!]: value }, isLast ? true : undefined); setData((d) => ({ ...d, [step.field!]: value })); await advance(r); }
    catch (e: any) { notify("Salvataggio non riuscito", e?.message || String(e)); } finally { setBusy(""); }
  };
  const openLink = async () => {
    try { await saveProfile({ linked_at: new Date().toISOString() }, true); } catch {}
    onDone(); onClose();
    setTimeout(() => router.push(step.route as any), 150);
  };
  const saveCustom = async () => {
    if (cName.trim().length < 2) { notify("Nome mancante", "Dai un nome all'area."); return; }
    setBusy("Salvo…");
    try {
      const body = { name: cName.trim(), desc: cDesc.trim(), sites: cSites.map((s) => s.trim()).filter(Boolean), track_deadlines: cTrack, deadlines: cDeadlines.filter((d) => d.date.trim()) };
      const r = await api<{ reminders_created: number }>(area?.custom_area ? `/axon/areas/custom/${area.key}` : "/axon/areas/custom", { method: area?.custom_area ? "PUT" : "POST", body });
      notify("Area salvata ✅", r.reminders_created ? `${r.reminders_created} avvisi scadenza creati (30, 15, 7 giorni e il giorno stesso).` : "AxonOS la userà nelle sue risposte.");
      onDone(); onClose();
    } catch (e: any) { notify("Salvataggio non riuscito", e?.message || String(e)); }
    finally { setBusy(""); }
  };

  if (!area || !step) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.back} behavior="padding">
        <View style={[styles.card, { paddingBottom: bottomPad }]} testID="area-mini-wizard">
          <View style={styles.hdr}>
            <View style={[styles.hdrIcon]}><Ionicons name={area.icon as any} size={20} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hTitle} numberOfLines={1}>{area.title}</Text>
              <Text style={styles.hSub}>Passo {idx + 1} di {steps.length} · {step.title}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} testID="area-wizard-close"><Ionicons name="close" size={22} color={HT.text} /></Pressable>
          </View>
          <View style={styles.progress}>{steps.map((s, i) => <View key={s.id} style={[styles.bar, i <= idx && { backgroundColor: PURPLE }]} />)}</View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            {!!busy && <View style={styles.busyRow}><ActivityIndicator color={HT.violet} /><Text style={styles.busyTxt}>{busy}</Text></View>}

            {step.kind === "upload" && phase === "pick" && !busy && (
              <>
                <Text style={styles.title}>{step.title}</Text>
                {!!step.hint && <Text style={styles.hint}>{step.hint}</Text>}
                <Text style={styles.lbl}>Dove lo salvo?</Text>
                <View style={styles.chips}>
                  {FOLDERS.map((f) => (
                    <Pressable key={f.key} onPress={() => setFolder(f.key)} style={[styles.chip, folder === f.key && styles.chipOn]} testID={`area-folder-${f.key}`}>
                      <Ionicons name={f.icon as any} size={14} color={folder === f.key ? "#FFF" : PURPLE} /><Text style={[styles.chipTxt, folder === f.key && { color: "#FFF" }]}>{f.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={pickFile} style={styles.primary} testID="area-upload-file"><Ionicons name="cloud-upload" size={20} color="#FFF" /><Text style={styles.primaryTxt}>Carica foto, file o PDF</Text></Pressable>
                <Pressable onPress={takePhoto} style={styles.secondary} testID="area-upload-camera"><Ionicons name="camera" size={20} color={HT.violet} /><Text style={styles.secondaryTxt}>Scatta una foto</Text></Pressable>
                <Pressable onPress={() => setPhase("fields")} style={styles.linkBtn} testID="area-manual"><Text style={styles.linkTxt}>Preferisco inserire i dati a mano</Text></Pressable>
              </>
            )}

            {step.kind === "upload" && phase === "fields" && !busy && (
              <>
                {!!fileName && <View style={styles.fileRow}><Ionicons name="checkmark-circle" size={16} color="#16A34A" /><Text style={styles.fileTxt} numberOfLines={1}>{fileName}</Text></View>}
                <Text style={styles.title}>{fileName ? "Controlla e conferma" : "Inserisci i dati"}</Text>
                {missing.length > 0 && <Text style={styles.warn}>Non sono riuscito a leggere: {missing.join(", ")}. Completa tu.</Text>}
                {fields.map((f) => {
                  const miss = !data[f.key];
                  return (
                    <View key={f.key} style={{ gap: 4 }}>
                      <Text style={[styles.lbl, miss && { color: HT.warning }]}>{f.label}{miss ? " · da completare" : ""}</Text>
                      {f.type === "date" ? (
                        <DateField value={data[f.key] || ""} onChange={(t) => setData((d) => ({ ...d, [f.key]: t }))} placeholder="Scegli la data" style={miss ? { borderColor: "#F59E0B" } : undefined} testID={`area-field-${f.key}`} />
                      ) : (
                      <TextInput value={data[f.key] || ""} onChangeText={(t) => setData((d) => ({ ...d, [f.key]: t }))} placeholder={f.label} placeholderTextColor={HT.muted}
                        style={[styles.input, miss && { borderColor: '#F59E0B' }]} testID={`area-field-${f.key}`} />
                      )}
                      {!!f.deadline && (
                        <View style={styles.switchRow}>
                          <Text style={styles.recTxt}>↻ Ripeti ogni anno · al rinnovo AxonOS ricrea da solo gli avvisi (30, 15, 7 gg e il giorno stesso)</Text>
                          <Switch value={recurring[f.key] ?? true} onValueChange={(v) => setRecurring((r) => ({ ...r, [f.key]: v }))} trackColor={{ true: PURPLE, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? "#FFF" : undefined} testID={`area-recurring-${f.key}`} />
                        </View>
                      )}
                    </View>
                  );
                })}
                <Pressable onPress={confirmFields} style={styles.primary} testID="area-confirm"><Ionicons name="checkmark" size={20} color="#FFF" /><Text style={styles.primaryTxt}>{isLast ? "Conferma e salva" : "Conferma, avanti"}</Text></Pressable>
                <Pressable onPress={() => setPhase("pick")} style={styles.linkBtn} testID="area-back-upload"><Text style={styles.linkTxt}>Carica un altro file</Text></Pressable>
              </>
            )}

            {step.kind === "choice" && !busy && (
              <>
                <Text style={styles.title}>{step.title}</Text>
                <View style={styles.chips}>
                  {(step.options || []).map((o) => (
                    <Pressable key={o.value} onPress={() => choose(o.value)} style={[styles.bigChip, data[step.field!] === o.value && styles.chipOn]} testID={`area-choice-${o.value}`}>
                      <Text style={[styles.bigChipTxt, data[step.field!] === o.value && { color: "#FFF" }]}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {step.kind === "link" && !busy && (
              <>
                <Text style={styles.title}>{step.title}</Text>
                <Text style={styles.hint}>Nessuna domanda intermedia: ti porto direttamente alla schermata giusta.</Text>
                <Pressable onPress={openLink} style={styles.primary} testID="area-open-link"><Ionicons name="open-outline" size={20} color="#FFF" /><Text style={styles.primaryTxt}>{step.cta || "Apri"}</Text></Pressable>
              </>
            )}

            {step.kind === "custom" && !busy && (
              <>
                <Text style={styles.lbl}>Nome area</Text>
                <TextInput value={cName} onChangeText={setCName} placeholder="Es. Fotovoltaico, Palestra, Condominio…" placeholderTextColor={HT.muted} style={styles.input} testID="area-custom-name" />
                <Text style={styles.lbl}>Cosa vuoi che AxonOS sappia su questa area?</Text>
                <TextInput value={cDesc} onChangeText={setCDesc} multiline placeholder="Descrizione libera…" placeholderTextColor={HT.muted} style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} testID="area-custom-desc" />
                <Text style={styles.lbl}>Siti web di riferimento (max 3) · AxonOS li usa come fonti</Text>
                {cSites.map((s, i) => <TextInput key={i} value={s} onChangeText={(t) => setCSites((arr) => arr.map((x, j) => (j === i ? t : x)))} placeholder={`https://sito-${i + 1}.it`} placeholderTextColor={HT.muted} autoCapitalize="none" keyboardType="url" style={styles.input} testID={`area-custom-site-${i}`} />)}
                <View style={styles.switchRow}>
                  <Text style={[styles.lbl, { flex: 1, marginBottom: 0 }]}>Vuoi monitorare scadenze? Avvisi a 30, 15, 7 giorni e il giorno stesso</Text>
                  <Switch value={cTrack} onValueChange={setCTrack} trackColor={{ true: PURPLE, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? "#FFF" : undefined} testID="area-custom-track" />
                </View>
                {cTrack && (
                  <>
                    {cDeadlines.map((d, i) => (
                      <View key={i} style={{ flexDirection: "row", gap: 6 }}>
                        <TextInput value={d.label} onChangeText={(t) => setCDeadlines((arr) => arr.map((x, j) => (j === i ? { ...x, label: t } : x)))} placeholder="Cosa scade" placeholderTextColor={HT.muted} style={[styles.input, { flex: 1 }]} testID={`area-custom-dl-label-${i}`} />
                        <DateField value={d.date} onChange={(t) => setCDeadlines((arr) => arr.map((x, j) => (j === i ? { ...x, date: t } : x)))} placeholder="Data" style={{ width: 138 }} testID={`area-custom-dl-date-${i}`} />
                        <Pressable onPress={() => setCDeadlines((arr) => arr.map((x, j) => (j === i ? { ...x, recurring: !x.recurring } : x)))} style={[styles.recPill, d.recurring && styles.chipOn]} testID={`area-custom-dl-rec-${i}`} accessibilityLabel="Ripeti ogni anno">
                          <Ionicons name="repeat" size={16} color={d.recurring ? "#FFF" : PURPLE} />
                        </Pressable>
                      </View>
                    ))}
                    <Text style={styles.recTxt}>↻ = ripeti ogni anno: alla scadenza AxonOS sposta la data di un anno e ricrea gli avvisi</Text>
                    <Pressable onPress={() => setCDeadlines((arr) => [...arr, { label: "", date: "" }])} style={styles.linkBtn} testID="area-custom-dl-add"><Text style={styles.linkTxt}>+ Aggiungi scadenza</Text></Pressable>
                  </>
                )}
                <Pressable onPress={saveCustom} style={styles.primary} testID="area-custom-save"><Ionicons name="checkmark" size={20} color="#FFF" /><Text style={styles.primaryTxt}>Salva area</Text></Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "92%" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 8 },
  hdrIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 16, fontWeight: "900", color: HT.text },
  hSub: { fontSize: 12, color: HT.muted, fontWeight: "700", marginTop: 2 },
  progress: { flexDirection: "row", gap: 4, paddingHorizontal: 16 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: HT.violetTint },
  title: { fontSize: 17, fontWeight: "900", color: HT.text },
  hint: { fontSize: 13, color: HT.muted, lineHeight: 18 },
  lbl: { fontSize: 11.5, fontWeight: "800", color: HT.text2, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: HT.violet + '66', backgroundColor: HT.violetTint },
  chipOn: { backgroundColor: PURPLE, borderColor: HT.violet },
  chipTxt: { fontSize: 13, fontWeight: "800", color: HT.violet },
  bigChip: { flex: 1, minWidth: 96, minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: 1.5, borderColor: HT.violet + '66', backgroundColor: HT.violetTint },
  bigChipTxt: { fontSize: 15, fontWeight: "900", color: HT.violet },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 14, backgroundColor: PURPLE },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: HT.violet + '66', backgroundColor: HT.card },
  secondaryTxt: { color: HT.violet, fontWeight: "800", fontSize: 14 },
  linkBtn: { minHeight: 40, alignItems: "center", justifyContent: "center" },
  linkTxt: { color: HT.muted, fontWeight: "700", fontSize: 13 },
  input: { borderWidth: 1.5, borderColor: HT.border, borderRadius: 12, padding: 12, fontSize: 14.5, color: HT.text, backgroundColor: HT.card2 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, backgroundColor: HT.violetTint },
  busyTxt: { color: HT.violet, fontWeight: "800", flex: 1 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.successTint, borderRadius: 10, padding: 8 },
  fileTxt: { color: HT.success, fontWeight: "700", fontSize: 12.5, flex: 1 },
  warn: { color: HT.warning, fontWeight: "700", fontSize: 12.5, backgroundColor: HT.warningTint, borderRadius: 10, padding: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  recTxt: { flex: 1, fontSize: 11.5, color: HT.muted, fontWeight: "700", lineHeight: 15 },
  recPill: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: HT.violet + '66', backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
});

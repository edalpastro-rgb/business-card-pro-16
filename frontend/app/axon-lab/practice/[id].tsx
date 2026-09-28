// app/axon-lab/practice/[id].tsx — V50.z354 — COMPILAZIONE CRT · pratica cliente (flusso consulente):
// 1 documenti verde/rosso → 2 sorgenti di caricamento (foglio documento) → 3 moduli con checkbox (non addestrati = avviso)
// → 4 «Compila con Axon» fase unica parallela (compressione + dati + compilazione, una sola barra) → 5 revisione campo per campo
// → 6 luogo + data da calendario libero (unico inserimento) → 7 anteprima PDF → 8 salvataggio → 9 condivisione.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal, RefreshControl } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { FileViewer } from "@/src/FileViewer";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";
import { LabDocChecklist } from "@/src/axonlab/LabDocChecklist";
import { LabDocSheet } from "@/src/axonlab/LabDocSheet";
import { useLabDossier } from "@/src/axonlab/useLabDossier";
import { DatePickerSheet } from "@/src/axonlab/DatePickerSheet"; // V50.z354 — Step 6 calendario libero
import { type LabDocSpec, type LabDocEntry, type LabPractice, type LabForm, type LabField, fetchFormPdf, sharePdfBase64, printPdfBase64 } from "@/src/axonlab/labApi";
import { KModalBody } from "@/src/ui/keyboard"; // V50.z397 — tastiera: campo attivo sempre visibile nelle Modal

type FormDetail = LabForm & { fields: LabField[] };

export default function AxonLabPractice() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pagePad = usePageBottomPadding();
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<LabPractice | null>(null);
  const [specs, setSpecs] = useState<LabDocSpec[]>([]); const [keyLabels, setKeyLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  const [filling, setFilling] = useState(false);
  const [liveForms, setLiveForms] = useState<LabForm[]>([]);
  const [review, setReview] = useState<FormDetail | null>(null); const [reviewVals, setReviewVals] = useState<Record<string, string>>({}); const [savingReview, setSavingReview] = useState(false);
  const [signDate, setSignDate] = useState(""); const [signPlace, setSignPlace] = useState(""); const [signing, setSigning] = useState(false);
  const [viewer, setViewer] = useState<{ name: string; b64: string } | null>(null); const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [datePick, setDatePick] = useState(false);
  const [fillProgress, setFillProgress] = useState(0); // V50.z354 — barra unica «Preparazione documenti e compilazione in corso…»
  useEffect(() => {
    if (!filling) { setFillProgress(0); return; }
    setFillProgress(0.06);
    const t = setInterval(() => setFillProgress((v) => Math.min(0.93, v + (0.93 - v) * 0.09)), 350);
    return () => clearInterval(t);
  }, [filling]);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api<{ docs: LabDocSpec[]; key_labels: Record<string, string> }>("/lab/access"), api<LabPractice>(`/lab/practices/${id}`)]);
      setSpecs(a.docs); setKeyLabels(a.key_labels); setP(r); setLiveForms(r.forms || []);
      setSel((s) => (s.length ? s : (r.template_ids?.length ? r.template_ids : (r.modules || []).filter((m) => m.trained).map((m) => m.template_id))));
      const d = r.sign_date ? r.sign_date.split("-").reverse().join("/") : ""; setSignDate(d); setSignPlace(r.sign_place || "");
    } catch (e: any) { notify("Pratica", e?.message || ""); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const onDocs = useCallback((docs: Record<string, LabDocEntry>, completion: LabPractice["completion"]) => setP((old) => (old ? { ...old, docs, completion } : old)), []);
  const dossier = useLabDossier(`/lab/practices/${id}`, onDocs);
  const trainedModules = useMemo(() => (p?.modules || []).filter((m) => m.trained), [p]);

  // 3 — compilazione in parallelo con anteprima live: i moduli appaiono «in elaborazione» e si riempiono al ritorno
  const fill = async () => {
    if (!sel.length) { notify("Moduli", "Seleziona almeno un modulo."); return; }
    setFilling(true);
    setLiveForms(sel.map((tid) => ({ form_id: `tmp_${tid}`, template_id: tid, template_name: trainedModules.find((m) => m.template_id === tid)?.name || "Modulo", name: "", values: {}, sources: {}, missing: [] })));
    try {
      const r = await api<{ forms: LabForm[]; errors?: { name?: string; error: string }[]; compression?: { docs: number; saved_bytes: number } }>(`/lab/practices/${id}/fill`, { method: "POST", body: { template_ids: sel } });
      setFillProgress(1);
      setLiveForms(r.forms);
      setP((old) => (old ? { ...old, forms: r.forms, form_ids: r.forms.map((f) => f.form_id), status: "review" } : old));
      if (r.errors?.length) notify("Alcuni moduli non compilati", r.errors.map((e) => `${e.name || "Modulo"}: ${e.error}`).join("\n"));
    } catch (e: any) { notify("Compilazione non riuscita", e?.message || ""); setLiveForms(p?.forms || []); }
    finally { setFilling(false); }
  };

  // 4 — revisione campo per campo
  const openReview = async (f: LabForm) => {
    try { const d = await api<FormDetail>(`/filled-forms/${f.form_id}`); setReview(d); setReviewVals(d.values || {}); } catch (e: any) { notify("Modulo", e?.message || ""); }
  };
  const saveReview = async () => {
    if (!review) return;
    setSavingReview(true);
    try {
      const r = await api<LabForm>(`/filled-forms/${review.form_id}`, { method: "PUT", body: { values: reviewVals } });
      setLiveForms((fs) => fs.map((f) => (f.form_id === r.form_id ? { ...f, values: r.values, missing: r.missing } : f)));
      setReview(null);
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setSavingReview(false); }
  };

  // 5 — data e luogo: unico inserimento per tutti i moduli
  const sign = async () => {
    setSigning(true);
    try {
      const r = await api<{ sign_date: string; sign_place: string; forms_updated: number }>(`/lab/practices/${id}/sign`, { method: "PUT", body: { sign_date: signDate, sign_place: signPlace } });
      notify("Data e luogo applicati", `${r.forms_updated} moduli aggiornati.`);
      const pr = await api<LabPractice>(`/lab/practices/${id}`); setP(pr); setLiveForms(pr.forms || []);
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setSigning(false); }
  };

  // 6 — PDF
  const printPdf = async (f: LabForm) => {
    setPdfBusy(f.form_id);
    try { const r = await fetchFormPdf(f.form_id); await printPdfBase64(r.name, r.data_base64); }
    catch (e: any) { notify("Stampa", e?.message || "Stampa non disponibile"); }
    finally { setPdfBusy(null); }
  };
  const openPdf = async (f: LabForm, share = false) => {
    setPdfBusy(f.form_id);
    try { const r = await fetchFormPdf(f.form_id); if (share) await sharePdfBase64(r.name, r.data_base64); else setViewer({ name: r.name, b64: r.data_base64 }); }
    catch (e: any) { notify("PDF", e?.message || ""); }
    finally { setPdfBusy(null); }
  };
  const archive = async () => {
    setArchiving(true);
    try { const r = await api<{ saved: { name: string }[] }>(`/lab/practices/${id}/archive`, { method: "POST" }); notify("Archiviati ✅", `${r.saved.length} PDF salvati in I miei file e nella scheda cliente.`); load(); }
    catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setArchiving(false); }
  };

  const realForms = liveForms.filter((f) => !f.form_id.startsWith("tmp_"));
  const fieldsFor = (d: FormDetail) => d.fields.filter((f) => !f.skip && f.key !== "signature" && (d.rules?.[f.id] || "") !== "empty" && (d.rules?.[f.id] || "") !== "stamp.image");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader icon="document-text" title={p?.contact_name || "Pratica"} sub={p?.company ? `${p.company} · Autocompilazione CRT` : "Compilazione CRT"} testID="lab-practice" />
      {loading || !p ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} /> : (
        <KScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: pagePad + 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
          {/* 1 · Documenti */}
          <Step n={1} title="Documenti del cliente" sub={`${p.completion.percent}% completato · verde = presente · rosso = mancante`} />
          <LabDocChecklist specs={specs} docs={p.docs} busy={dossier.busy} completion={p.completion} onPress={(sp) => dossier.setOpen(sp)} title="Checklist documenti" />

          {/* 2 · Moduli */}
          <Step n={2} title="Moduli da compilare" sub="Selezione multipla" />
          <View style={L.card} testID="lab-modules-select">
            {(p.modules || []).length === 0 ? <Text style={L.cardSub}>Nessun modulo disponibile per la compilazione.</Text> : null}
            {(p.modules || []).map((m) => {
              const on = sel.includes(m.template_id);
              const ready = !!m.trained;
              return (
                <Pressable key={m.template_id} disabled={!ready || filling} onPress={() => setSel((s) => (on ? s.filter((x) => x !== m.template_id) : [...s, m.template_id]))} style={[s.modRow, !ready && { opacity: 0.55 }]} testID={`lab-select-${m.template_id}`}>
                  <Ionicons name={!ready ? "lock-closed-outline" : on ? "checkbox" : "square-outline"} size={22} color={on && ready ? HT.brand : HT.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.modName}>{m.name}</Text>
                    {ready ? <Text style={L.muted}>{m.field_count} campi · pronto</Text> : <Text style={[L.muted, { color: HT.warning }]}>⚠️ Modulo non ancora addestrato · non selezionabile</Text>}
                  </View>
                </Pressable>
              );
            })}
            {filling ? (
              <View style={s.progressBox} testID="lab-fill-progress">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator size="small" color={HT.axon} />
                  <Text style={s.progressTxt}>Preparazione documenti e compilazione in corso…</Text>
                </View>
                <View style={s.track}><View style={[s.fill, { width: `${Math.round(fillProgress * 100)}%` }]} /></View>
                <Text style={L.muted}>Compressione documenti · estrazione dati · compilazione di {sel.length} {sel.length === 1 ? "modulo" : "moduli"} — tutto in parallelo</Text>
              </View>
            ) : (
              <Pressable onPress={fill} disabled={!sel.length} style={[L.btn, L.btnBrand, !sel.length && { opacity: 0.5 }]} testID="lab-fill">
                <Ionicons name="flash" size={16} color={HT.white} />
                <Text style={L.btnTxt}>Compila con Axon{sel.length ? ` (${sel.length})` : ""}</Text>
              </Pressable>
            )}
          </View>

          {/* 3/4 · Anteprima live + revisione */}
          {liveForms.length > 0 ? (
            <>
              <Step n={3} title="Compilazione e revisione" sub="Anteprima in tempo reale · tocca un modulo per correggere i campi" />
              {liveForms.map((f) => {
                const tmp = f.form_id.startsWith("tmp_");
                const n = Object.keys(f.values || {}).length; const miss = (f.missing || []).length;
                return (
                  <Pressable key={f.form_id} onPress={() => (!tmp ? openReview(f) : null)} style={[L.card, s.formCard]} testID={`lab-form-${f.template_id}`}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={[s.formIcon, { backgroundColor: tmp ? HT.warningTint : miss ? HT.warningTint : HT.successTint }]}>
                        {tmp ? <ActivityIndicator size="small" color={HT.warning} /> : <Ionicons name={miss ? "alert-circle" : "checkmark-done"} size={20} color={miss ? HT.warning : HT.success} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={L.cardTitle} numberOfLines={1}>{f.template_name}</Text>
                        <Text style={L.cardSub}>{tmp ? "Axon sta compilando…" : `${n} campi compilati${miss ? ` · ${miss} da inserire` : " · completo"}`}</Text>
                      </View>
                      {!tmp ? <Ionicons name="create-outline" size={20} color={HT.muted} /> : null}
                    </View>
                    {!tmp && miss ? <Text style={s.missTxt} numberOfLines={2}>Mancano: {f.missing.map((m) => m.label).join(", ")}</Text> : null}
                    {!tmp ? (
                      <View style={s.pdfRow}>
                        <Pressable onPress={() => openPdf(f)} style={[L.btn, L.btnGhost, { flex: 1, minHeight: 40 }]} testID={`lab-pdf-${f.template_id}`}>
                          {pdfBusy === f.form_id ? <ActivityIndicator size="small" color={HT.text} /> : <Ionicons name="eye" size={15} color={HT.text} />}<Text style={[L.btnTxt, { color: HT.text, fontSize: 12.5 }]}>Anteprima PDF</Text>
                        </Pressable>
                        <Pressable onPress={() => openPdf(f, true)} style={[L.btn, L.btnGhost, { flex: 1, minHeight: 40 }]} testID={`lab-share-${f.template_id}`}>
                          <Ionicons name="share-social" size={15} color={HT.brand} /><Text style={[L.btnTxt, { color: HT.brand, fontSize: 12.5 }]}>Condividi</Text>
                        </Pressable>
                        <Pressable onPress={() => printPdf(f)} style={[L.btn, L.btnGhost, { flex: 1, minHeight: 40 }]} testID={`lab-print-${f.template_id}`}>
                          <Ionicons name="print" size={15} color={HT.text} /><Text style={[L.btnTxt, { color: HT.text, fontSize: 12.5 }]}>Stampa</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* 5 · Data e luogo */}
          {realForms.length > 0 ? (
            <>
              <Step n={4} title="Data e luogo" sub="Unico inserimento per tutti i moduli aperti · data libera: passata, odierna o futura" />
              <View style={L.card} testID="lab-sign">
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable onPress={() => setDatePick(true)} style={[L.input, { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }]} testID="lab-sign-date">
                    <Ionicons name="calendar-outline" size={18} color={HT.brand} />
                    <Text style={{ color: signDate ? HT.text : HT.muted, fontWeight: "700" }}>{signDate || "Scegli la data"}</Text>
                  </Pressable>
                  <TextInput value={signPlace} onChangeText={setSignPlace} placeholder="Luogo (es. Milano)" placeholderTextColor={HT.muted} style={[L.input, { flex: 1.3 }]} testID="lab-sign-place" />
                </View>
                <Pressable onPress={sign} disabled={signing} style={[L.btn, L.btnBrand, signing && { opacity: 0.5 }]} testID="lab-sign-apply">
                  {signing ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="calendar" size={16} color={HT.white} />}<Text style={L.btnTxt}>Applica a tutti i moduli</Text>
                </Pressable>
                <Text style={L.muted}>Se lasci vuoto, i campi data/luogo restano vuoti nel PDF.</Text>
              </View>

              <Step n={5} title="PDF pronti" sub="Condividi dai singoli moduli oppure archivia tutto" />
              <Pressable onPress={archive} disabled={archiving} style={[L.btn, L.btnPrimary, archiving && { opacity: 0.5 }]} testID="lab-archive">
                {archiving ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="archive" size={16} color={HT.white} />}<Text style={L.btnTxt}>Salva tutti i PDF in I miei file e nella scheda cliente</Text>
              </Pressable>
              {p.archived_at ? <Text style={[L.muted, { textAlign: "center" }]}>Archiviati il {new Date(p.archived_at).toLocaleString("it-IT")}</Text> : null}
            </>
          ) : null}
        </KScrollView>
      )}

      <DatePickerSheet visible={datePick} value={signDate} onClose={() => setDatePick(false)} onPick={(v) => { setSignDate(v); setDatePick(false); }} />

      {dossier.open ? (
        <LabDocSheet spec={dossier.open} entry={p?.docs[dossier.open.id]} keyLabels={keyLabels} contactId={p?.contact_id} busy={!!dossier.busy[dossier.open.id]}
          onClose={() => dossier.setOpen(null)} onUpload={(b) => dossier.upload(dossier.open!, b)} onConfirm={(v, st) => dossier.confirm(dossier.open!, v, st)} />
      ) : null}

      {/* Revisione modulo */}
      <Modal visible={!!review} transparent animationType="slide" onRequestClose={() => setReview(null)}><KModalBody>
        <View style={s.backdrop}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} testID="lab-review">
            <View style={s.handle} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.sheetTitle, { flex: 1 }]} numberOfLines={1}>{review?.template_name}</Text>
              <Pressable onPress={() => setReview(null)} hitSlop={10} testID="lab-review-close"><Ionicons name="close" size={22} color={HT.text2} /></Pressable>
            </View>
            <KScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 8, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
              {review ? fieldsFor(review).map((f) => {
                const rule = review.rules?.[f.id] || "";
                const isSign = rule === "sign_date" || rule === "sign_place";
                return (
                  <View key={f.id} style={s.revRow}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={s.revLbl} numberOfLines={1}>{f.label || keyLabels[f.key] || f.key}</Text>
                      <Text style={[s.revSrc, !reviewVals[f.id] && { color: HT.warning }]}>{isSign ? "da data/luogo" : review.sources?.[f.id] || (reviewVals[f.id] ? "" : "mancante")}</Text>
                    </View>
                    <TextInput value={reviewVals[f.id] ?? ""} onChangeText={(t) => setReviewVals((v) => ({ ...v, [f.id]: t }))} editable={!isSign} placeholder={isSign ? "Si compila con Data e luogo" : "—"} placeholderTextColor={HT.muted}
                      style={[L.input, { minHeight: 40, paddingVertical: 8 }, isSign && { opacity: 0.6 }]} testID={`lab-review-${f.id}`} />
                  </View>
                );
              }) : null}
            </KScrollView>
            <Pressable onPress={saveReview} disabled={savingReview} style={[L.btn, L.btnBrand, { marginTop: 10 }]} testID="lab-review-save">
              {savingReview ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="save" size={16} color={HT.white} />}<Text style={L.btnTxt}>Salva correzioni</Text>
            </Pressable>
          </View>
        </View>
      </KModalBody></Modal>

      <FileViewer visible={!!viewer} fileName={viewer?.name || "modulo.pdf"} mime="application/pdf" dataBase64={viewer?.b64 || ""} onClose={() => setViewer(null)} onShare={viewer ? () => sharePdfBase64(viewer.name, viewer.b64) : undefined} />
    </SafeAreaView>
  );
}

function Step({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <View style={s.step}>
      <View style={s.stepN}><Text style={s.stepNTxt}>{n}</Text></View>
      <View style={{ flex: 1 }}><Text style={s.stepT}>{title}</Text>{sub ? <Text style={L.muted}>{sub}</Text> : null}</View>
    </View>
  );
}

const s = StyleSheet.create({
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepN: { width: 26, height: 26, borderRadius: 13, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  stepNTxt: { color: HT.white, fontWeight: "900", fontSize: 12 },
  stepT: { color: HT.text, fontWeight: "900", fontSize: 15 },
  modRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, minHeight: 48 },
  modName: { color: HT.text, fontWeight: "800", fontSize: 13.5 },
  formCard: { gap: 10 },
  formIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  missTxt: { color: HT.warning, fontSize: 12 },
  progressBox: { backgroundColor: HT.card2, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: HT.border },
  progressTxt: { color: HT.text, fontWeight: "800", fontSize: 13 },
  track: { height: 8, borderRadius: 999, backgroundColor: HT.bg, overflow: "hidden" },
  fill: { height: 8, borderRadius: 999, backgroundColor: HT.axon },
  pdfRow: { flexDirection: "row", gap: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 8, borderWidth: 1, borderColor: HT.border },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.border, marginBottom: 10 },
  sheetTitle: { color: HT.text, fontWeight: "900", fontSize: 16 },
  revRow: { gap: 4 },
  revLbl: { color: HT.text2, fontWeight: "800", fontSize: 12, flex: 1 },
  revSrc: { color: HT.muted, fontSize: 11, fontStyle: "italic" },
});

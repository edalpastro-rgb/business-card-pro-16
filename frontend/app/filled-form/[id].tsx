// filled-form/[id].tsx — V50.z268 — Modulo compilato per il cliente: anteprima del PDF originale con i dati scritti sopra,
// campi mancanti da completare, correzione di ogni valore (tocca il riquadro sulla pagina o la riga), testo libero aggiunto
// toccando un punto della pagina, poi Stampa / Condividi / Email. Ogni modifica rigenera il PDF.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, Platform, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { FormPageView, PageInfo } from "@/src/FormPageView";

type Field = { id: string; key: string; label: string; kind: string; page: number; bbox: number[]; order: number };
type ExtraText = { id?: string; page: number; x: number; y: number; text: string; font_size: number };
type Form = { form_id: string; name: string; contact_id: string; contact_name: string; template_name: string; values: Record<string, string>; sources: Record<string, string>; missing: { field_id: string; key: string; label: string }[]; extra_texts: ExtraText[]; fields: Field[]; pages: { index: number }[]; semantic_keys: Record<string, string> };

async function printPdfBase64(b64: string, name: string) {
  const uri = `data:application/pdf;base64,${b64}`;
  if (Platform.OS === "web" || Platform.OS === "ios") { await Print.printAsync({ uri }); return; }
  const path = `${FileSystem.cacheDirectory}${name.replace(/[^\w.-]+/g, "_")}`;
  await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
  await Print.printAsync({ uri: path });
}

export default function FilledFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [f, setF] = useState<Form | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<ExtraText[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [pages, setPages] = useState<Record<number, PageInfo>>({});
  const [pageCount, setPageCount] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ fieldId: string } | null>(null);
  const [addText, setAddText] = useState<{ x: number; y: number; text: string } | null>(null);

  const loadPage = useCallback(async (n: number) => {
    try { const p = await api<PageInfo & { page_count: number }>(`/filled-forms/${id}/page/${n}`); setPages((m) => ({ ...m, [n]: p })); setPageCount(p.page_count || 1); } catch { /* ignore */ }
  }, [id]);
  useEffect(() => { (async () => { try { const r = await api<Form>(`/filled-forms/${id}`); setF(r); setValues(r.values || {}); setExtras(r.extra_texts || []); void loadPage(0); } catch (e: any) { notify("Modulo", e?.message || ""); } })(); }, [id, loadPage]);
  useEffect(() => { if (f && !pages[pageIdx]) void loadPage(pageIdx); }, [pageIdx, f, pages, loadPage]);

  const save = async () => {
    setSaving(true);
    try { const r = await api<Form>(`/filled-forms/${id}`, { method: "PUT", body: { values, extra_texts: extras } }); setF((o) => (o ? { ...o, ...r } : o)); setDirty(false); setPages({}); await loadPage(pageIdx); }
    catch (e: any) { notify("Modulo", e?.message || "Salvataggio non riuscito"); } finally { setSaving(false); }
  };
  const getPdf = async () => { if (dirty) await save(); return api<{ name: string; data_base64: string }>(`/filled-forms/${id}/pdf`); };
  const doPrint = async () => { setBusy("Preparo la stampa…"); try { const p = await getPdf(); await printPdfBase64(p.data_base64, p.name); } catch (e: any) { notify("Stampa", e?.message || "Stampa non riuscita"); } finally { setBusy(null); } };
  const doShare = async () => { setBusy("Preparo il PDF…"); try { const p = await getPdf(); await shareDataUri(`data:application/pdf;base64,${p.data_base64}`, p.name, "application/pdf"); } catch (e: any) { notify("Condividi", e?.message || ""); } finally { setBusy(null); } };
  const doEmail = async () => {
    setBusy("Preparo il PDF…");
    try {
      const p = await getPdf();
      if (Platform.OS === "web") { await shareDataUri(`data:application/pdf;base64,${p.data_base64}`, p.name, "application/pdf"); notify("Email", "PDF scaricato: allegalo alla mail dal tuo client di posta."); }
      else { await shareDataUri(`data:application/pdf;base64,${p.data_base64}`, p.name, "application/pdf"); }
      Linking.openURL(`mailto:?subject=${encodeURIComponent(f?.name || "Modulo")}&body=${encodeURIComponent("In allegato il modulo compilato. Cordiali saluti")}`).catch(() => {});
    } catch (e: any) { notify("Email", e?.message || ""); } finally { setBusy(null); }
  };

  if (!f) return <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface }}><ActivityIndicator color="#059669" /></SafeAreaView>;
  const keys = f.semantic_keys || {};
  const ordered = [...f.fields].sort((a, b) => a.order - b.order);
  const missingIds = new Set(ordered.filter((x) => x.key !== "other" && x.key !== "signature" && x.kind !== "checkbox" && !(values[x.id] || "").trim()).map((x) => x.id));
  const pageFields = ordered.filter((x) => x.page === pageIdx);
  const editField = edit ? ordered.find((x) => x.id === edit.fieldId) : null;
  const srcLabel = (fid: string) => ({ scheda: "scheda cliente", documento: "documento d'identità", fattura: "fattura", allegato: "allegato (visura…)", auto: "automatico" } as Record<string, string>)[f.sources?.[fid] || ""] || "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title} numberOfLines={1}>{f.template_name}</Text><Text style={s.sub}>{f.contact_name} · {missingIds.size === 0 ? "✅ completo" : `${missingIds.size} campi da completare`}</Text></View>
        <Pressable onPress={save} disabled={saving || !dirty} style={[s.saveBtn, (!dirty || saving) && { opacity: 0.5 }]} testID="ff-save">{saving ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.saveTxt}>Salva</Text>}</Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: pagePad + 70 }}>
        {pageCount > 1 ? <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>{Array.from({ length: pageCount }).map((_, i) => <Pressable key={i} onPress={() => setPageIdx(i)} style={[s.chip, i === pageIdx && s.chipOn]} testID={`ff-page-${i}`}><Text style={[s.chipTxt, i === pageIdx && { color: "#FFF" }]}>Pag. {i + 1}</Text></Pressable>)}</View> : null}
        <Text style={s.hint}>Tocca un riquadro per correggere il valore · tocca un punto libero della pagina per aggiungere un testo.</Text>
        <FormPageView page={pages[pageIdx] || null} boxes={pageFields.map((x) => ({ id: x.id, bbox: x.bbox, filled: !!(values[x.id] || "").trim(), color: missingIds.has(x.id) ? "#F59E0B" : "#10B981" }))}
          onSelect={(fid) => setEdit({ fieldId: fid })} onTap={(x, y) => setAddText({ x, y, text: "" })} />

        {missingIds.size > 0 ? (
          <View style={[s.card, { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" }]} testID="ff-missing">
            <Text style={s.section}>⚠️ Dati mancanti ({missingIds.size})</Text>
            <Text style={s.hint}>Non trovati in scheda, documenti o fatture: inseriscili qui.</Text>
            {ordered.filter((x) => missingIds.has(x.id)).map((x) => (
              <View key={x.id} style={{ gap: 3 }}>
                <Text style={s.lbl}>{keys[x.key] || x.label}{x.label && keys[x.key] && x.label !== keys[x.key] ? ` · «${x.label}»` : ""}</Text>
                <TextInput value={values[x.id] || ""} onChangeText={(v) => { setValues((m) => ({ ...m, [x.id]: v })); setDirty(true); }} placeholder={keys[x.key] || x.label} placeholderTextColor={theme.color.muted} style={s.input} testID={`ff-missing-${x.id}`} />
              </View>
            ))}
          </View>
        ) : null}

        <Text style={s.section}>Tutti i campi ({ordered.length})</Text>
        {ordered.map((x, i) => (
          <Pressable key={x.id} onPress={() => setEdit({ fieldId: x.id })} style={[s.row, missingIds.has(x.id) && { borderColor: "#FDE68A" }]} testID={`ff-row-${x.id}`}>
            <Text style={s.rowNum}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowMeta}>{keys[x.key] || x.label} · pag. {x.page + 1}{srcLabel(x.id) ? ` · da ${srcLabel(x.id)}` : ""}</Text>
              <Text style={[s.rowVal, !(values[x.id] || "").trim() && { color: theme.color.muted, fontStyle: "italic" }]}>{x.kind === "checkbox" ? ((values[x.id] || "").trim() ? "☑ selezionato" : "☐ non selezionato") : (values[x.id] || "").trim() || "— vuoto —"}</Text>
            </View>
            <Ionicons name="create-outline" size={18} color="#059669" />
          </Pressable>
        ))}
        {extras.length ? (<>
          <Text style={s.section}>Testi aggiunti ({extras.length})</Text>
          {extras.map((e, i) => (
            <View key={e.id || i} style={s.row}>
              <Ionicons name="text" size={16} color="#7C3AED" />
              <Text style={{ flex: 1, color: theme.color.onSurface }} numberOfLines={2}>{e.text} <Text style={s.rowMeta}>(pag. {e.page + 1})</Text></Text>
              <Pressable onPress={() => { setExtras((l) => l.filter((_, k) => k !== i)); setDirty(true); }} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
            </View>
          ))}
        </>) : null}
      </ScrollView>

      <View style={[s.actions, { paddingBottom: Math.max(pagePad, 12) }]}>
        {busy ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flex: 1, justifyContent: "center" }}><ActivityIndicator color="#059669" /><Text style={s.hint}>{busy}</Text></View> : (<>
          <Pressable onPress={doPrint} style={s.act} testID="ff-print"><Ionicons name="print" size={20} color="#059669" /><Text style={s.actTxt}>Stampa</Text></Pressable>
          <Pressable onPress={doShare} style={s.act} testID="ff-share"><Ionicons name="share-social" size={20} color="#059669" /><Text style={s.actTxt}>Condividi</Text></Pressable>
          <Pressable onPress={doEmail} style={s.act} testID="ff-email"><Ionicons name="mail" size={20} color="#059669" /><Text style={s.actTxt}>Email</Text></Pressable>
        </>)}
      </View>

      <Modal visible={!!editField} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        <Pressable style={s.backdrop} onPress={() => setEdit(null)}>
          <View style={s.sheet} onStartShouldSetResponder={() => true}>
            {editField ? (<>
              <Text style={s.section}>{keys[editField.key] || editField.label}</Text>
              {editField.label ? <Text style={s.hint}>Etichetta sul modulo: «{editField.label}»</Text> : null}
              {editField.kind === "checkbox" ? (
                <Pressable onPress={() => { setValues((m) => ({ ...m, [editField.id]: (m[editField.id] || "").trim() ? "" : "X" })); setDirty(true); }} style={s.input} testID="ff-edit-check"><Text style={{ color: theme.color.onSurface, fontWeight: "800" }}>{(values[editField.id] || "").trim() ? "☑ Selezionato (tocca per togliere)" : "☐ Non selezionato (tocca per selezionare)"}</Text></Pressable>
              ) : (
                <TextInput autoFocus value={values[editField.id] || ""} onChangeText={(v) => { setValues((m) => ({ ...m, [editField.id]: v })); setDirty(true); }} style={s.input} placeholder="Valore" placeholderTextColor={theme.color.muted} testID="ff-edit-input" />
              )}
              <Pressable onPress={() => setEdit(null)} style={s.primary} testID="ff-edit-done"><Text style={s.primaryTxt}>Fatto</Text></Pressable>
            </>) : null}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!addText} transparent animationType="fade" onRequestClose={() => setAddText(null)}>
        <Pressable style={s.backdrop} onPress={() => setAddText(null)}>
          <View style={s.sheet} onStartShouldSetResponder={() => true}>
            <Text style={s.section}>Aggiungi testo sulla pagina {pageIdx + 1}</Text>
            <TextInput autoFocus value={addText?.text || ""} onChangeText={(v) => setAddText((a) => (a ? { ...a, text: v } : a))} style={s.input} placeholder="Testo da scrivere nel punto toccato" placeholderTextColor={theme.color.muted} testID="ff-extra-input" />
            <Pressable onPress={() => { if (addText?.text.trim()) { setExtras((l) => [...l, { page: pageIdx, x: addText.x, y: addText.y, text: addText.text.trim(), font_size: 10 }]); setDirty(true); } setAddText(null); }} style={s.primary} testID="ff-extra-add"><Text style={s.primaryTxt}>Aggiungi</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "900", color: theme.color.onSurface }, sub: { fontSize: 11, color: theme.color.muted },
  saveBtn: { backgroundColor: "#059669", borderRadius: 10, paddingHorizontal: 14, minHeight: 40, alignItems: "center", justifyContent: "center" }, saveTxt: { color: "#FFF", fontWeight: "900" },
  chip: { paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.color.border, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF" },
  chipOn: { backgroundColor: "#059669", borderColor: "#059669" }, chipTxt: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface },
  hint: { fontSize: 12, color: theme.color.muted, lineHeight: 17 },
  card: { backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 12, gap: 8 },
  section: { fontSize: 14, fontWeight: "900", color: theme.color.onSurface },
  lbl: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  input: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: "center", fontSize: 14, color: theme.color.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, minHeight: 52 },
  rowNum: { width: 24, textAlign: "center", fontWeight: "900", color: "#059669" }, rowMeta: { fontSize: 11, color: theme.color.muted }, rowVal: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, marginTop: 2 },
  actions: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 8, padding: 10, backgroundColor: theme.color.surface, borderTopWidth: 1, borderTopColor: theme.color.border },
  act: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 52, borderRadius: 12, backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" }, actTxt: { fontSize: 11, fontWeight: "900", color: "#059669" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30, gap: 10 },
  primary: { backgroundColor: "#059669", borderRadius: 12, minHeight: 46, alignItems: "center", justifyContent: "center" }, primaryTxt: { color: "#FFF", fontWeight: "900" },
});

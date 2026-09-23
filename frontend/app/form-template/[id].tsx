// form-template/[id].tsx — V50.z268 — Editor modello modulo (Master): anteprima pagina + riquadri campi, correzione chiave/etichetta,
// spostamento (tocca il campo, poi tocca sulla pagina dove deve iniziare), ridimensionamento, ordine, aggiunta/eliminazione campi.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { FormPageView, PageInfo } from "@/src/FormPageView";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Field = { id: string; key: string; label: string; kind: "text" | "checkbox" | "date"; page: number; bbox: number[]; font_size?: number | null; order: number; acro_name?: string | null; example_value?: string };
type Template = { template_id: string; name: string; notes?: string; page_count: number; pages: { index: number; width: number; height: number }[]; fields: Field[]; semantic_keys: Record<string, string>; field_source: string };

export default function FormTemplateEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [t, setT] = useState<Template | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [pages, setPages] = useState<Record<number, PageInfo>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [keyPicker, setKeyPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { (async () => { try { const r = await api<Template>(`/form-templates/${id}`); setT(r); setFields([...(r.fields || [])].sort((a, b) => a.order - b.order)); } catch (e: any) { notify("Modello", e?.message || ""); } })(); }, [id]);
  useEffect(() => { if (!t || pages[pageIdx]) return; api<PageInfo>(`/form-templates/${id}/page/${pageIdx}`).then((p) => setPages((m) => ({ ...m, [pageIdx]: p }))).catch(() => {}); }, [t, pageIdx, id, pages]);

  const upd = useCallback((fid: string, patch: Partial<Field>) => { setFields((fs) => fs.map((f) => (f.id === fid ? { ...f, ...patch } : f))); setDirty(true); }, []);
  const selected = useMemo(() => fields.find((f) => f.id === sel) || null, [fields, sel]);
  const pageFields = fields.filter((f) => f.page === pageIdx);

  const onTapPage = (x: number, y: number) => {
    if (moving && selected) { const [x0, y0, x1, y1] = selected.bbox; upd(selected.id, { bbox: [x, y, x + (x1 - x0), y + (y1 - y0)] }); setMoving(false); return; }
    if (!sel) { const nf: Field = { id: `f_${Date.now().toString(36)}`, key: "other", label: "Nuovo campo", kind: "text", page: pageIdx, bbox: [x, y, Math.min(1000, x + 250), Math.min(1000, y + 18)], order: fields.length }; setFields((fs) => [...fs, nf]); setSel(nf.id); setDirty(true); }
  };
  const resize = (dw: number, dh: number) => { if (!selected) return; const [x0, y0, x1, y1] = selected.bbox; upd(selected.id, { bbox: [x0, y0, Math.max(x0 + 10, Math.min(1000, x1 + dw)), Math.max(y0 + 6, Math.min(1000, y1 + dh))] }); };
  const nudge = (dx: number, dy: number) => { if (!selected) return; upd(selected.id, { bbox: selected.bbox.map((v, i) => Math.max(0, Math.min(1000, v + (i % 2 === 0 ? dx : dy)))) }); };
  const move = (dir: -1 | 1) => { if (!selected) return; const i = fields.findIndex((f) => f.id === selected.id); const j = i + dir; if (j < 0 || j >= fields.length) return; const fs = [...fields]; [fs[i], fs[j]] = [fs[j], fs[i]]; setFields(fs.map((f, k) => ({ ...f, order: k }))); setDirty(true); };
  const remove = () => { if (!selected) return; setFields((fs) => fs.filter((f) => f.id !== selected.id).map((f, k) => ({ ...f, order: k }))); setSel(null); setDirty(true); };
  const save = async () => {
    setSaving(true);
    try { const r = await api<Template>(`/form-templates/${id}`, { method: "PUT", body: { fields: fields.map((f, k) => ({ ...f, order: k })) } }); setFields([...(r.fields || [])].sort((a, b) => a.order - b.order)); setDirty(false); notify("Modello", "Campi salvati"); }
    catch (e: any) { notify("Modello", e?.message || "Salvataggio non riuscito"); } finally { setSaving(false); }
  };

  if (!t) return <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 }}><ActivityIndicator color="#7C3AED" /></SafeAreaView>;
  const keys = t.semantic_keys || {};
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title} numberOfLines={1}>{t.name}</Text><Text style={s.sub}>{fields.length} campi · {t.page_count} pagine · {t.field_source === "acroform" ? "campi PDF nativi" : "rilevati da Axon"}</Text></View>
        <Pressable onPress={save} disabled={saving || !dirty} style={[s.saveBtn, (!dirty || saving) && { opacity: 0.5 }]} testID="fte-save">{saving ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.saveTxt}>Salva</Text>}</Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: pagePad }}>
        {t.page_count > 1 ? (
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {Array.from({ length: Math.min(t.page_count, 8) }).map((_, i) => <Pressable key={i} onPress={() => { setPageIdx(i); setSel(null); }} style={[s.pageChip, i === pageIdx && s.pageChipOn]} testID={`fte-page-${i}`}><Text style={[s.pageChipTxt, i === pageIdx && { color: "#FFF" }]}>Pag. {i + 1}</Text></Pressable>)}
          </View>
        ) : null}
        <Text style={s.hint}>{moving ? "👉 Tocca sulla pagina il punto in cui deve INIZIARE il campo selezionato." : sel ? "Campo selezionato: correggi chiave, etichetta, posizione e dimensione qui sotto." : "Tocca un riquadro per selezionarlo. Tocca un punto vuoto della pagina per aggiungere un campo."}</Text>
        <FormPageView page={pages[pageIdx] || null} boxes={pageFields.map((f) => ({ id: f.id, bbox: f.bbox, label: keys[f.key] || f.label }))} selectedId={sel} onSelect={(fid) => { setSel(fid); setMoving(false); }} onTap={onTapPage} showLabels />

        {selected ? (
          <View style={s.card} testID="fte-field-editor">
            <Text style={s.section}>Campo</Text>
            <Pressable onPress={() => setKeyPicker(true)} style={s.input} testID="fte-key"><Text style={{ color: HT.text, fontWeight: "700" }}>{keys[selected.key] || selected.key}</Text><Text style={s.hint}>Dato del cliente da inserire · tocca per cambiare</Text></Pressable>
            <TextInput value={selected.label} onChangeText={(v) => upd(selected.id, { label: v })} placeholder="Etichetta stampata sul modulo" placeholderTextColor={HT.muted} style={s.input} testID="fte-label" />
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(["text", "date", "checkbox"] as const).map((k) => <Pressable key={k} onPress={() => upd(selected.id, { kind: k })} style={[s.pageChip, selected.kind === k && s.pageChipOn]}><Text style={[s.pageChipTxt, selected.kind === k && { color: "#FFF" }]}>{k === "text" ? "Testo" : k === "date" ? "Data" : "Casella ✓"}</Text></Pressable>)}
              <View style={{ flex: 1 }} />
              <TextInput value={selected.font_size ? String(selected.font_size) : ""} onChangeText={(v) => upd(selected.id, { font_size: v ? parseFloat(v.replace(",", ".")) || null : null })} placeholder="pt auto" placeholderTextColor={HT.muted} keyboardType="decimal-pad" style={[s.input, { width: 78, textAlign: "center" }]} testID="fte-font" />
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Pressable onPress={() => setMoving(true)} style={[s.tool, moving && { backgroundColor: '#7C3AED' }]} testID="fte-move"><Ionicons name="move" size={16} color={moving ? "#FFF" : "#7C3AED"} /><Text style={[s.toolTxt, moving && { color: "#FFF" }]}>Sposta</Text></Pressable>
              <Pressable onPress={() => nudge(-5, 0)} style={s.tool}><Ionicons name="arrow-back" size={16} color="#7C3AED" /></Pressable>
              <Pressable onPress={() => nudge(5, 0)} style={s.tool}><Ionicons name="arrow-forward" size={16} color="#7C3AED" /></Pressable>
              <Pressable onPress={() => nudge(0, -4)} style={s.tool}><Ionicons name="arrow-up" size={16} color="#7C3AED" /></Pressable>
              <Pressable onPress={() => nudge(0, 4)} style={s.tool}><Ionicons name="arrow-down" size={16} color="#7C3AED" /></Pressable>
              <Pressable onPress={() => resize(-20, 0)} style={s.tool}><Text style={s.toolTxt}>− largh.</Text></Pressable>
              <Pressable onPress={() => resize(20, 0)} style={s.tool}><Text style={s.toolTxt}>+ largh.</Text></Pressable>
              <Pressable onPress={() => resize(0, -3)} style={s.tool}><Text style={s.toolTxt}>− alt.</Text></Pressable>
              <Pressable onPress={() => resize(0, 3)} style={s.tool}><Text style={s.toolTxt}>+ alt.</Text></Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable onPress={() => move(-1)} style={s.tool}><Ionicons name="chevron-up" size={16} color="#7C3AED" /><Text style={s.toolTxt}>Ordine su</Text></Pressable>
              <Pressable onPress={() => move(1)} style={s.tool}><Ionicons name="chevron-down" size={16} color="#7C3AED" /><Text style={s.toolTxt}>Ordine giù</Text></Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={remove} style={[s.tool, { borderColor: '#FCA5A5' }]} testID="fte-delete"><Ionicons name="trash-outline" size={16} color="#DC2626" /><Text style={[s.toolTxt, { color: "#DC2626" }]}>Elimina</Text></Pressable>
            </View>
          </View>
        ) : null}

        <Text style={s.section}>Ordine di compilazione ({fields.length})</Text>
        {fields.map((f, i) => (
          <Pressable key={f.id} onPress={() => { setSel(f.id); setPageIdx(f.page); setMoving(false); }} style={[s.row, f.id === sel && { borderColor: '#7C3AED', backgroundColor: '#FAF5FF' }]} testID={`fte-row-${f.id}`}>
            <Text style={s.rowNum}>{i + 1}</Text>
            <View style={{ flex: 1 }}><Text style={s.rowTitle}>{keys[f.key] || f.key}</Text><Text style={s.rowMeta} numberOfLines={1}>{f.label || "—"} · pag. {f.page + 1}{f.example_value ? ` · es. «${f.example_value}»` : ""}</Text></View>
            {f.key === "other" ? <Ionicons name="help-circle" size={18} color="#F59E0B" /> : <Ionicons name="checkmark-circle" size={18} color="#10B981" />}
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={keyPicker} transparent animationType="slide" onRequestClose={() => setKeyPicker(false)}>
        <Pressable style={s.backdrop} onPress={() => setKeyPicker(false)}>
          <View style={s.sheet} onStartShouldSetResponder={() => true}>
            <Text style={s.section}>Quale dato del cliente va in questo campo?</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {Object.entries(keys).map(([k, l]) => (
                <Pressable key={k} onPress={() => { if (selected) upd(selected.id, { key: k, label: selected.label || l }); setKeyPicker(false); }} style={[s.keyRow, selected?.key === k && { backgroundColor: '#FAF5FF' }]} testID={`fte-key-${k}`}>
                  <Text style={{ flex: 1, color: HT.text, fontWeight: selected?.key === k ? "900" : "600" }}>{l}</Text><Text style={s.rowMeta}>{k}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "900", color: HT.text }, sub: { fontSize: 11, color: HT.muted },
  saveBtn: { backgroundColor: '#7C3AED', borderRadius: 10, paddingHorizontal: 14, minHeight: 40, alignItems: "center", justifyContent: "center" }, saveTxt: { color: "#FFF", fontWeight: "900" },
  pageChip: { paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", backgroundColor: HT.card },
  pageChipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }, pageChipTxt: { fontSize: 12, fontWeight: "800", color: HT.text },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: '#E9D5FF', padding: 12, gap: 8 },
  section: { fontSize: 14, fontWeight: "900", color: HT.text },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: "center", fontSize: 14, color: HT.text },
  tool: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#E9D5FF', backgroundColor: HT.card }, toolTxt: { fontSize: 12, fontWeight: "800", color: "#7C3AED" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 52 },
  rowNum: { width: 24, textAlign: "center", fontWeight: "900", color: "#7C3AED" }, rowTitle: { fontSize: 13, fontWeight: "800", color: HT.text }, rowMeta: { fontSize: 11, color: HT.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30, gap: 10 },
  keyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: HT.border, minHeight: 44 },
});

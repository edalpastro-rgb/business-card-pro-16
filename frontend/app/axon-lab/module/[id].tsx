// app/axon-lab/module/[id].tsx — V50.z343 — AXON LAB · Fase 2: mapping campo per campo «Da dove prendo questo dato?»
// Il Master sceglie la FONTE (documento.chiave, campo aggiuntivo, speciali) per ogni campo del modulo vuoto → regola generale salvata.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal, Image, useWindowDimensions } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { LabHeader, labStyles as L } from "@/src/axonlab/LabHeader";
import { type LabModule, type LabSource, type LabField, specialLabel } from "@/src/axonlab/labApi";
import { LabExamplesCard } from "@/src/axonlab/LabExamplesCard"; // V50.z375 — esempi compilati multipli

export default function AxonLabModule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [m, setM] = useState<LabModule | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<LabField | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<{ index: number; data_url: string; width: number; height: number } | null>(null);
  const [pageIdx, setPageIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api<LabModule>(`/lab/modules/${id}`);
      setM(r); setMapping(r.mapping || {});
    } catch (e: any) { notify("Modulo", e?.message || ""); router.back(); }
  }, [id, router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try { setPage(await api(`/form-templates/${id}/page/${pageIdx}`)); } catch { setPage(null); }
    })();
  }, [id, pageIdx]);

  const sources = useMemo(() => m?.sources || [], [m]);
  const fields = useMemo(() => (m?.fields || []).filter((f) => !f.skip).sort((a, b) => a.page - b.page), [m]);
  const done = fields.filter((f) => mapping[f.id]).length;
  const grouped = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = sources.filter((s) => !qq || s.label.toLowerCase().includes(qq) || (s.sample || "").toLowerCase().includes(qq));
    const g: Record<string, LabSource[]> = {};
    for (const s of list) (g[s.group] = g[s.group] || []).push(s);
    return g;
  }, [sources, q]);

  const save = async (trained: boolean) => {
    setSaving(true);
    try {
      const r = await api<LabModule>(`/lab/modules/${id}/mapping`, { method: "PUT", body: { mapping, trained } });
      setM((old) => (old ? { ...old, ...r, sources: old.sources, fields: old.fields } : r));
      notify(trained ? "Modulo addestrato ✅" : "Regole salvate", trained ? "Axon applicherà queste regole a tutti i clienti dei consulenti collegati." : `${Object.keys(mapping).length} regole salvate.`);
      if (trained) router.back();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setSaving(false); }
  };

  const ruleColor = (r?: string) => (!r ? HT.warning : r === "empty" ? HT.muted : r === "manual" ? HT.brand : HT.success);
  const pageW = width - 28;
  const pageH = page ? pageW * (page.height / page.width) : 0;
  const pageFields = fields.filter((f) => f.page === pageIdx);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <LabHeader title={m?.name || "Modulo"} sub={`Regole ${done}/${fields.length}${m?.mapping_source === "example" || (m?.mapping_source || "").startsWith("examples:") ? ` · proposte da ${m?.examples?.length || 1} ${(m?.examples?.length || 1) === 1 ? "esempio compilato" : "esempi compilati"}` : ""}`} testID="lab-module" />
      {!m ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.axon} /> : (
        <KScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 90 }}>
          <View style={s.track}><View style={[s.fill, { width: `${fields.length ? Math.round((done / fields.length) * 100) : 0}%` }]} /></View>
          <LabExamplesCard templateId={String(id)} examples={m.examples || []} onUpdated={(r) => { setM((old) => (old ? { ...old, ...r, fields: r.fields || old.fields, sources: r.sources || old.sources } : r)); setMapping(r.mapping || {}); }} />
          {/* Anteprima pagina con i campi evidenziati */}
          {page ? (
            <View style={[L.card, { padding: 6 }]}>
              <View style={{ position: "relative", width: pageW, height: pageH, alignSelf: "center" }}>
                <Image source={{ uri: page.data_url }} style={{ width: pageW, height: pageH, borderRadius: 8 }} resizeMode="contain" />
                {pageFields.map((f) => (
                  <Pressable key={f.id} onPress={() => setPick(f)} style={{ position: "absolute", left: (f.bbox[0] / 1000) * pageW, top: (f.bbox[1] / 1000) * pageH, width: Math.max(8, ((f.bbox[2] - f.bbox[0]) / 1000) * pageW), height: Math.max(8, ((f.bbox[3] - f.bbox[1]) / 1000) * pageH), borderWidth: 1.5, borderColor: ruleColor(mapping[f.id]), backgroundColor: `${ruleColor(mapping[f.id])}33`, borderRadius: 3 }} />
                ))}
              </View>
              {(m.page_count || 1) > 1 ? (
                <View style={s.pager}>
                  <Pressable onPress={() => setPageIdx((p) => Math.max(0, p - 1))} hitSlop={8}><Ionicons name="chevron-back" size={20} color={HT.text} /></Pressable>
                  <Text style={L.muted}>Pagina {pageIdx + 1} di {m.page_count}</Text>
                  <Pressable onPress={() => setPageIdx((p) => Math.min((m.page_count || 1) - 1, p + 1))} hitSlop={8}><Ionicons name="chevron-forward" size={20} color={HT.text} /></Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={L.sectionTitle}>Campi del modulo</Text>
          {fields.map((f, i) => {
            const r = mapping[f.id];
            return (
              <Pressable key={f.id} onPress={() => setPick(f)} style={[L.card, s.fieldRow]} testID={`lab-field-${i}`}>
                <View style={[s.dot, { backgroundColor: ruleColor(r) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLbl} numberOfLines={1}>{f.label || f.key} <Text style={L.muted}>· pag. {f.page + 1}{f.kind === "checkbox" ? " · casella" : ""}</Text></Text>
                  <Text style={[s.ruleTxt, { color: ruleColor(r) }]} numberOfLines={1}>{r ? specialLabel(r, sources) : "Da dove prendo questo dato?"}</Text>
                </View>
                <Ionicons name="swap-horizontal" size={18} color={HT.muted} />
              </Pressable>
            );
          })}
        </KScrollView>
      )}
      {m ? (
        <View style={[s.footer, { paddingBottom: insets.bottom + 10 }]}>
          <Pressable onPress={() => save(false)} disabled={saving} style={[L.btn, L.btnGhost, { flex: 1 }]} testID="lab-mapping-save"><Text style={[L.btnTxt, { color: HT.text }]}>Salva</Text></Pressable>
          <Pressable onPress={() => save(true)} disabled={saving || done === 0} style={[L.btn, L.btnPrimary, { flex: 1.6 }, (saving || done === 0) && { opacity: 0.5 }]} testID="lab-mapping-train">
            {saving ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="school" size={16} color={HT.white} />}<Text style={L.btnTxt}>Conferma addestramento</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Picker fonte */}
      <Modal visible={!!pick} transparent animationType="slide" onRequestClose={() => setPick(null)}>
        <View style={s.backdrop}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} testID="lab-source-picker">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Da dove prendo «{pick?.label || pick?.key}»?</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Cerca fonte o valore…" placeholderTextColor={HT.muted} style={L.input} testID="lab-source-search" />
            <KScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 4, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
              {Object.entries(grouped).map(([g, list]) => (
                <View key={g}>
                  <Text style={s.group}>{g}</Text>
                  {list.map((src) => {
                    const on = pick && mapping[pick.id] === src.id;
                    return (
                      <Pressable key={src.id} onPress={() => { if (pick) setMapping((mm) => ({ ...mm, [pick.id]: src.id })); setPick(null); setQ(""); }} style={[s.srcRow, on && { backgroundColor: HT.axonTint }]} testID={`lab-source-${src.id.replace(/\W/g, "_")}`}>
                        <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? HT.axon : HT.muted} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.srcLbl}>{src.label}</Text>
                          {src.sample ? <Text style={s.srcSample} numberOfLines={1}>es. {src.sample}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </KScrollView>
            <Pressable onPress={() => setPick(null)} style={[L.btn, L.btnGhost, { marginTop: 8 }]} testID="lab-source-close"><Text style={[L.btnTxt, { color: HT.text }]}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  track: { height: 6, borderRadius: 999, backgroundColor: HT.card, overflow: "hidden" },
  fill: { height: 6, borderRadius: 999, backgroundColor: HT.axon },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 6 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fieldLbl: { color: HT.text, fontWeight: "800", fontSize: 13.5 },
  ruleTxt: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 10, padding: 12, backgroundColor: HT.card, borderTopWidth: 1, borderTopColor: HT.border },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 8, borderWidth: 1, borderColor: HT.border },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.border, marginBottom: 10 },
  sheetTitle: { color: HT.text, fontWeight: "900", fontSize: 16, marginBottom: 10 },
  group: { color: HT.axon, fontWeight: "900", fontSize: 11, letterSpacing: 0.5, paddingVertical: 6, textTransform: "uppercase" },
  srcRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, minHeight: 46 },
  srcLbl: { color: HT.text, fontWeight: "700", fontSize: 13.5 },
  srcSample: { color: HT.muted, fontSize: 11.5 },
});

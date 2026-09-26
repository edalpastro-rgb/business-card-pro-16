// LabExtractionTest.tsx — V50.z375 — Axon Lab · Fase 1 · «Test estrazione completa»: carica TUTTI i documenti insieme → Axon
// riconosce il tipo di ogni file ed estrae i dati standard in un'unica passata → tabella di confronto campo per campo con i valori
// confermati singolarmente (ok / non trovato / diverso / conflitto tra documenti / nuovo). Modalità: cliente tipo corrente o tutti insieme.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { HT } from "@/src/homeTheme";
import { labStyles as L } from "@/src/axonlab/LabHeader";

type Row = { field: string; doc_label: string; label: string; expected: Record<string, string>; expected_disagree: boolean; extracted: { file: string; value: string }[]; status: "ok" | "mismatch" | "not_found" | "conflict" | "new" };
type TestResult = { at: string; mode: "single" | "all"; profile_names: Record<string, string>; files: { name: string; doc_type: string; error?: string }[]; unknown_files: string[]; rows: Row[]; summary: Record<string, number> };
type Picked = { name: string; mime: string; data_base64: string };

const STATUS: Record<Row["status"], { label: string; color: string; icon: any }> = {
  ok: { label: "Coincide", color: HT.success, icon: "checkmark-circle" },
  mismatch: { label: "Diverso", color: HT.danger, icon: "alert-circle" },
  not_found: { label: "Non trovato", color: HT.warning, icon: "help-circle" },
  conflict: { label: "Conflitto", color: HT.danger, icon: "git-compare" },
  new: { label: "Nuovo", color: HT.axon, icon: "sparkles" },
};

export function LabExtractionTest({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [mode, setMode] = useState<"single" | "all">("single");
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  const [filter, setFilter] = useState<Row["status"] | null>(null);

  useEffect(() => {
    setRes(null); setFiles([]);
    api<{ last_test: TestResult | null }>(`/lab/training/test-extract?profile=${mode === "all" ? "all" : profileId}`).then((r) => setRes(r.last_test)).catch(() => {});
  }, [profileId, mode]);

  const pick = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return;
      const out: Picked[] = [];
      for (const a of r.assets.slice(0, 14)) {
        const mime = a.mimeType || (a.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        out.push({ name: a.name || "documento", mime, data_base64: await uriToBase64DataUrl(a.uri, mime) });
      }
      setFiles((f) => [...f, ...out].slice(0, 14));
    } catch (e: any) { notify("Documenti", e?.message || "Selezione non riuscita"); }
  };

  const run = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      const r = await api<TestResult>("/lab/training/test-extract", { method: "POST", body: { profile: mode === "all" ? "all" : profileId, files } });
      setRes(r); setFiles([]); setFilter(null);
    } catch (e: any) { notify("Test estrazione", e?.message || "Estrazione non riuscita"); }
    finally { setBusy(false); }
  };

  const rows = (res?.rows || []).filter((r) => !filter || r.status === filter);
  return (
    <View style={L.card} testID="lab-test-extract">
      <Text style={L.cardTitle}>Test estrazione completa</Text>
      <Text style={L.cardSub}>Carica tutti i documenti disponibili insieme: Axon riconosce ogni file ed estrae tutti i dati standard in una sola passata. Poi confronta campo per campo con i dati confermati singolarmente.</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["single", "all"] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[s.chip, mode === m && s.chipOn]} testID={`lab-test-mode-${m}`}>
            <Text style={[s.chipTxt, mode === m && { color: HT.white }]} numberOfLines={1}>{m === "single" ? `Solo «${profileName}»` : "Tutti i clienti tipo insieme"}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={pick} style={[L.btn, L.btnGhost, { flex: 1 }]} testID="lab-test-pick"><Ionicons name="documents" size={18} color={HT.axon} /><Text style={[L.btnTxt, { color: HT.axon }]}>{files.length ? `Aggiungi (${files.length})` : "Scegli documenti"}</Text></Pressable>
        <Pressable onPress={run} disabled={!files.length || busy} style={[L.btn, L.btnPrimary, { flex: 1 }, (!files.length || busy) && { opacity: 0.5 }]} testID="lab-test-run">
          {busy ? <ActivityIndicator color={HT.white} /> : <><Ionicons name="flask" size={18} color={HT.white} /><Text style={L.btnTxt}>Estrai tutto</Text></>}
        </Pressable>
      </View>
      {files.length ? <View style={{ gap: 4 }}>{files.map((f, i) => (
        <View key={i} style={s.fileRow}><Ionicons name="document-text-outline" size={14} color={HT.muted} /><Text style={[L.muted, { flex: 1 }]} numberOfLines={1}>{f.name}</Text><Pressable onPress={() => setFiles((x) => x.filter((_, j) => j !== i))} hitSlop={8}><Ionicons name="close-circle" size={16} color={HT.muted} /></Pressable></View>
      ))}</View> : null}
      {busy ? <Text style={L.muted}>Axon sta leggendo {files.length} documenti in parallelo…</Text> : null}

      {res ? (
        <View style={{ gap: 8 }} testID="lab-test-result">
          <Text style={s.small}>Ultimo test: {new Date(res.at).toLocaleString("it-IT")} · {res.files.length} file{res.mode === "all" ? " · confronto con tutti i clienti tipo" : ""}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(Object.keys(STATUS) as Row["status"][]).map((k) => (
              <Pressable key={k} onPress={() => setFilter(filter === k ? null : k)} style={[s.sum, { borderColor: STATUS[k].color }, filter === k && { backgroundColor: STATUS[k].color }]} testID={`lab-test-sum-${k}`}>
                <Text style={[s.sumTxt, { color: filter === k ? HT.white : STATUS[k].color }]}>{res.summary[k] || 0} · {STATUS[k].label}</Text>
              </Pressable>
            ))}
          </View>
          {res.unknown_files.length ? <Text style={[L.muted, { color: HT.warning }]}>Non riconosciuti: {res.unknown_files.join(", ")}</Text> : null}
          {res.mode === "all" && res.summary.profiles_disagree ? <Text style={[L.muted, { color: HT.warning }]}>⚠️ {res.summary.profiles_disagree} campi hanno valori confermati diversi tra i clienti tipo (atteso se rappresentano casi diversi).</Text> : null}
          <View style={s.table}>
            <View style={[s.tr, s.th]}><Text style={[s.td, s.thTxt, { flex: 1.3 }]}>Campo</Text><Text style={[s.td, s.thTxt]}>Confermato</Text><Text style={[s.td, s.thTxt]}>Estratto · fonte</Text><Text style={[s.td, s.thTxt, { flex: 0.9 }]}>Stato</Text></View>
            {rows.map((r) => {
              const st = STATUS[r.status];
              return (
                <View key={r.field} style={s.tr} testID={`lab-test-row-${r.field}`}>
                  <View style={[s.td, { flex: 1.3 }]}><Text style={s.fieldLbl}>{r.label}</Text><Text style={s.small}>{r.doc_label}</Text></View>
                  <View style={s.td}>{Object.keys(r.expected).length ? Object.entries(r.expected).map(([pid, v]) => <Text key={pid} style={s.val} numberOfLines={2}>{res.mode === "all" ? `${res.profile_names[pid] || pid}: ` : ""}{v}</Text>) : <Text style={s.small}>—</Text>}</View>
                  <View style={s.td}>{r.extracted.length ? r.extracted.map((x, i) => <Text key={i} style={s.val} numberOfLines={2}>{x.value}<Text style={s.small}> · {x.file}</Text></Text>) : <Text style={s.small}>—</Text>}</View>
                  <View style={[s.td, { flex: 0.9, flexDirection: "row", alignItems: "center", gap: 4 }]}><Ionicons name={st.icon} size={14} color={st.color} /><Text style={[s.small, { color: st.color, fontWeight: "800", flex: 1 }]}>{st.label}</Text></View>
                </View>
              );
            })}
            {!rows.length ? <Text style={[L.muted, { padding: 10 }]}>Nessun campo in questa categoria.</Text> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  chip: { flex: 1, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  chipOn: { backgroundColor: HT.axon, borderColor: HT.axon }, chipTxt: { fontSize: 12, fontWeight: "800", color: HT.text },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  small: { fontSize: 11, color: HT.muted }, val: { fontSize: 12, color: HT.text, fontWeight: "600" }, fieldLbl: { fontSize: 12, fontWeight: "800", color: HT.text },
  sum: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 32, justifyContent: "center" }, sumTxt: { fontSize: 11, fontWeight: "800" },
  table: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, overflow: "hidden" },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: HT.border, paddingVertical: 8, paddingHorizontal: 6, gap: 6 },
  th: { borderTopWidth: 0, backgroundColor: HT.card2 }, thTxt: { fontSize: 11, fontWeight: "900", color: HT.muted, textTransform: "uppercase" },
  td: { flex: 1, gap: 2 },
});

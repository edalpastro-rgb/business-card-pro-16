import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

/**
 * V50.z66 — Import contatti da CSV/Excel con mappatura colonne.
 * Flusso: 1) Upload → 2) Mappatura colonne (auto-mapping + scelte custom/ignora)
 * → 3) Import → 4) Report finale.
 */
type CFDef = { key: string; name: string; type: string; required: boolean };

type Preview = {
  headers: string[];
  row_count: number;
  preview_rows: Record<string, string>[];
  auto_mapping: Record<string, string | null>;
  unmapped_columns: string[];
  standard_fields: string[];
  custom_fields: CFDef[];
  rows: Record<string, string>[];
};

type Report = {
  ok: boolean;
  imported: number;
  ignored_columns: string[];
  custom_columns: string[];
  errors: { row: number; error: string }[];
  total_rows: number;
  contact_ids?: string[]; // V50.z491
  merged?: number;
  skipped_duplicates?: number;
};
type DupStrategy = "create" | "skip" | "merge"; // V50.z491
type DupRow = { row: number; index: number; label: string; existing: { contact_id: string; name: string; contact_code: string }; match: string[] };
const DUP_MATCH_LABEL: Record<string, string> = { vat_number: "P.IVA", fiscal_code: "CF", email: "email", pec: "PEC", email_alt: "email", phone: "telefono", company: "ragione sociale", name: "nome" };

export default function ContactsImportScreen() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "report">("upload");
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [report, setReport] = useState<Report | null>(null);

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setUploading(true);
      const form = new FormData();
      if (Platform.OS === "web") {
        const b = await fetch(asset.uri).then((r) => r.blob());
        form.append("file", new File([b], asset.name || "import.csv", { type: asset.mimeType || "text/csv" }));
      } else {
        form.append("file", { uri: asset.uri, name: asset.name || "import.csv", type: asset.mimeType || "text/csv" } as any);
      }
      const p = await api<Preview>("/contacts/import/preview", { method: "POST", body: form, isFormData: true } as any);
      setPreview(p);
      // Inizializza mapping con auto + "ignore" per non mappati
      const initMap: Record<string, string> = {};
      p.headers.forEach((h) => {
        initMap[h] = p.auto_mapping[h] || "ignore";
      });
      setMapping(initMap);
      setStep("map");
      void checkDuplicates(p.rows, initMap);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere il file");
    } finally {
      setUploading(false);
    }
  };

  const setColTarget = (col: string, target: string) => {
    setMapping((prev) => ({ ...prev, [col]: target }));
  };

  // V50.z491 — Anteprima duplicati: righe che combaciano con contatti già in rubrica + strategia (crea / salta / unisci)
  const [dupRows, setDupRows] = useState<DupRow[] | null>(null);
  const [dupStrategy, setDupStrategy] = useState<DupStrategy>("merge");
  const buildFinalMap = (m: Record<string, string>) => {
    const finalMap: Record<string, string> = {};
    Object.entries(m).forEach(([col, target]) => {
      if (target === "custom") {
        const name = customNames[col]?.trim() || col;
        finalMap[col] = `custom:${name}`;
      } else {
        finalMap[col] = target;
      }
    });
    return finalMap;
  };
  const checkDuplicates = async (rows: Record<string, string>[], m: Record<string, string>) => {
    try {
      const r = await api<{ duplicates: DupRow[] }>("/contacts/import/check-duplicates", { method: "POST", body: { rows, mapping: buildFinalMap(m) } });
      setDupRows(r.duplicates || []);
    } catch { setDupRows([]); }
  };
  useEffect(() => {
    if (!preview || step !== "map") return;
    const t = setTimeout(() => { void checkDuplicates(preview.rows, mapping); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping]);

  const runImport = async () => {
    if (!preview) return;
    const finalMap = buildFinalMap(mapping);
    setImporting(true);
    try {
      const r = await api<Report>("/contacts/import/execute", {
        method: "POST",
        body: { rows: preview.rows, mapping: finalMap, default_area: "energy", duplicate_strategy: dupRows && dupRows.length ? dupStrategy : "create" },
      });
      setReport(r);
      setStep("report");
      // V50.z491 — Ritorno al contatto: un solo contatto creato/unito → apri subito la sua scheda
      if ((r.contact_ids || []).length === 1) {
        notify(r.merged ? "Contatto aggiornato" : "Contatto importato", "Apro la scheda…");
        setTimeout(() => router.replace(`/contact/${r.contact_ids![0]}` as any), 500);
      }
    } catch (e: any) {
      notify("Errore import", e?.message || "Import non riuscito");
    } finally {
      setImporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Importa Contatti</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={styles.stepBar}>
        {["upload", "map", "report"].map((s, i) => (
          <View key={s} style={[styles.stepPill, step === s && styles.stepPillActive]}>
            <Text style={[styles.stepTxt, step === s && styles.stepTxtActive]}>
              {i + 1}. {s === "upload" ? "File" : s === "map" ? "Mappatura" : "Report"}
            </Text>
          </View>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        {step === "upload" && (
          <View style={{ gap: 16, alignItems: "center", padding: 20 }}>
            <Ionicons name="cloud-upload" size={72} color={HT.brand} />
            <Text style={styles.uploadTitle}>Carica un file CSV o Excel</Text>
            <Text style={styles.uploadSub}>
              Formati supportati: .csv, .xlsx, .xls · Max 5 MB, 500 righe
            </Text>
            <Pressable onPress={pickFile} disabled={uploading} style={[styles.btnPrimary, uploading && { opacity: 0.6 }]}>
              {uploading ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <Ionicons name="document-attach" size={18} color="#FFF" />
                  <Text style={styles.btnPrimaryTxt}>Scegli file</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {step === "map" && preview && (
          <View style={{ gap: 12 }}>
            <View style={styles.infoBox}>
              <Text style={styles.infoTxt}>
                📊 Trovate <Text style={{ fontWeight: "800" }}>{preview.row_count} righe</Text> e{" "}
                <Text style={{ fontWeight: "800" }}>{preview.headers.length} colonne</Text>.
                {preview.unmapped_columns.length > 0 ? (
                  <Text>{"\n"}⚠️ {preview.unmapped_columns.length} colonne non riconosciute: scegli se creare un campo personalizzato o ignorarle.</Text>
                ) : null}
              </Text>
            </View>
            {preview.headers.map((col) => {
              const cur = mapping[col] || "ignore";
              const isCustom = cur === "custom";
              const isUnmapped = !preview.auto_mapping[col];
              return (
                <View key={col} style={[styles.mapRow, isUnmapped && styles.mapRowUnmapped]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={styles.mapColName} numberOfLines={1}>{col}</Text>
                    {isUnmapped ? <Text style={styles.mapWarn}>⚠️ non riconosciuto</Text> : <Text style={styles.mapOk}>✓ auto</Text>}
                  </View>
                  <Text style={styles.mapSample} numberOfLines={1}>
                    es: {preview.preview_rows[0]?.[col] || "—"}
                  </Text>
                  <View style={styles.chipRow}>
                    {/* Ignora + custom generico + campi standard + campi personalizzati definiti dal Master */}
                    {["ignore", "custom", ...preview.standard_fields].map((opt) => (
                      <Pressable
                        key={opt}
                        onPress={() => setColTarget(col, opt)}
                        style={[styles.chip, cur === opt && styles.chipActive, opt === "ignore" && cur === "ignore" && styles.chipIgnore]}
                      >
                        <Text style={[styles.chipTxt, cur === opt && styles.chipTxtActive]}>
                          {opt === "ignore" ? "Ignora" : opt === "custom" ? "Campo personalizzato" : opt}
                        </Text>
                      </Pressable>
                    ))}
                    {(preview.custom_fields || []).map((cf) => {
                      const target = `cf:${cf.key}`;
                      const active = cur === target;
                      return (
                        <Pressable
                          key={target}
                          onPress={() => setColTarget(col, target)}
                          style={[styles.chip, styles.chipCf, active && styles.chipCfActive]}
                          testID={`chip-cf-${cf.key}`}
                        >
                          <Ionicons
                            name="options-outline"
                            size={11}
                            color={active ? "#FFF" : "#7C3AED"}
                          />
                          <Text style={[styles.chipTxt, active ? { color: "#FFF" } : { color: "#7C3AED" }]}>
                            {cf.name}{cf.required ? " *" : ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {isCustom ? (
                    <View style={styles.customBox}>
                      <Text style={styles.customLbl}>Nome campo personalizzato:</Text>
                      <Text style={styles.customVal}>{customNames[col] || col}</Text>
                      <Text style={styles.customHint}>(usa il nome della colonna come default, salvato in custom_fields)</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {/* V50.z491 — Anteprima duplicati */}
            {dupRows && dupRows.length > 0 && (
              <View style={styles.dupCard} testID="csv-duplicates">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="git-merge-outline" size={18} color={HT.warning} />
                  <Text style={styles.dupTitle}>{dupRows.length} {dupRows.length === 1 ? "riga corrisponde a un contatto" : "righe corrispondono a contatti"} già in rubrica</Text>
                </View>
                {dupRows.slice(0, 6).map((d) => (
                  <Text key={d.row} style={styles.dupLine} numberOfLines={1}>Riga {d.row}: «{d.label}» → {d.existing.name}{d.existing.contact_code ? ` (${d.existing.contact_code})` : ""} · {d.match.map((m) => DUP_MATCH_LABEL[m] || m).join(", ")}</Text>
                ))}
                {dupRows.length > 6 && <Text style={styles.dupLine}>…e altre {dupRows.length - 6}</Text>}
                <Text style={[styles.dupLine, { marginTop: 6, fontWeight: "800" }]}>Cosa fare con i duplicati?</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {([["merge", "Unisci ai contatti esistenti"], ["skip", "Salta le righe duplicate"], ["create", "Crea comunque"]] as [DupStrategy, string][]).map(([k, lbl]) => (
                    <Pressable key={k} onPress={() => setDupStrategy(k)} style={[styles.dupChoice, dupStrategy === k && styles.dupChoiceOn]} testID={`csv-dup-${k}`}>
                      <Ionicons name={dupStrategy === k ? "radio-button-on" : "radio-button-off"} size={16} color={dupStrategy === k ? HT.brand : HT.muted} />
                      <Text style={[styles.dupChoiceTxt, dupStrategy === k && { color: HT.brand }]}>{lbl}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.dupHint}>«Unisci» compila solo i campi vuoti della scheda esistente: quanto c'è già non viene sovrascritto.</Text>
              </View>
            )}
            <Pressable onPress={runImport} disabled={importing} style={[styles.btnPrimary, importing && { opacity: 0.6 }]} testID="csv-run-import">
              {importing ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                  <Text style={styles.btnPrimaryTxt}>Importa {preview.rows.length} contatti</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {step === "report" && report && (
          <View style={{ gap: 14 }}>
            <View style={[styles.reportCard, { backgroundColor: HT.successTint, borderColor: '#16A34A' }]}>
              <Ionicons name="checkmark-circle" size={32} color="#16A34A" />
              <Text style={styles.reportBig}>{report.imported}</Text>
              <Text style={styles.reportLbl}>Contatti importati su {report.total_rows}</Text>
              {!!report.merged && <Text style={styles.reportLbl}>{report.merged} uniti a schede esistenti</Text>}
              {!!report.skipped_duplicates && <Text style={styles.reportLbl}>{report.skipped_duplicates} duplicati saltati</Text>}
            </View>
            {report.ignored_columns.length > 0 && (
              <View style={styles.reportRow}>
                <Text style={styles.reportRowLbl}>Colonne ignorate ({report.ignored_columns.length}):</Text>
                <Text style={styles.reportRowVal}>{report.ignored_columns.join(", ")}</Text>
              </View>
            )}
            {report.custom_columns.length > 0 && (
              <View style={styles.reportRow}>
                <Text style={styles.reportRowLbl}>Campi personalizzati creati ({report.custom_columns.length}):</Text>
                <Text style={styles.reportRowVal}>{report.custom_columns.join(", ")}</Text>
              </View>
            )}
            {report.errors.length > 0 && (
              <View style={[styles.reportRow, { backgroundColor: HT.dangerTint, borderColor: '#FCA5A5' }]}>
                <Text style={[styles.reportRowLbl, { color: "#DC2626" }]}>Errori ({report.errors.length}):</Text>
                {report.errors.slice(0, 20).map((e, i) => (
                  <Text key={i} style={styles.reportErr}>Riga {e.row}: {e.error}</Text>
                ))}
              </View>
            )}
            <Pressable onPress={() => router.replace("/contatti" as any)} style={styles.btnPrimary}>
              <Ionicons name="people" size={18} color="#FFF" />
              <Text style={styles.btnPrimaryTxt}>Vai ai Contatti</Text>
            </Pressable>
            <Pressable onPress={() => { setStep("upload"); setPreview(null); setReport(null); setMapping({}); }} style={styles.btnGhost}>
              <Text style={styles.btnGhostTxt}>Nuova importazione</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: HT.border },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  stepBar: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: HT.card2 },
  stepPill: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: HT.border, alignItems: "center" },
  stepPillActive: { backgroundColor: HT.brand },
  stepTxt: { fontSize: 11, fontWeight: "700", color: HT.muted },
  stepTxtActive: { color: "#FFF" },
  uploadTitle: { fontSize: 18, fontWeight: "800", color: HT.text, marginTop: 12 },
  uploadSub: { fontSize: 13, color: HT.muted, textAlign: "center" },
  btnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.brand, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, marginTop: 12 },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  btnGhost: { alignItems: "center", padding: 12 },
  btnGhostTxt: { color: HT.brand, fontWeight: "700" },
  infoBox: { backgroundColor: HT.axonTint, borderRadius: 12, borderWidth: 1, borderColor: '#93C5FD', padding: 12 },
  infoTxt: { fontSize: 13, color: HT.text, lineHeight: 18 },
  mapRow: { backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12 },
  mapRowUnmapped: { borderColor: '#FBBF24', backgroundColor: HT.warningTint },
  mapColName: { fontSize: 14, fontWeight: "800", color: HT.text, flex: 1 },
  mapWarn: { fontSize: 11, color: "#D97706", fontWeight: "700" },
  mapOk: { fontSize: 11, color: "#16A34A", fontWeight: "700" },
  mapSample: { fontSize: 11, color: HT.muted, marginBottom: 8, fontStyle: "italic" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: HT.card2 },
  chipActive: { backgroundColor: HT.brand },
  chipIgnore: { backgroundColor: HT.border },
  chipCf: { backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66', flexDirection: "row", alignItems: "center", gap: 4 },
  chipCfActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipTxt: { fontSize: 11, fontWeight: "700", color: HT.text },
  chipTxtActive: { color: "#FFF" },
  customBox: { marginTop: 8, padding: 10, backgroundColor: HT.axonTint, borderRadius: 8, borderWidth: 1, borderColor: '#7DD3FC' },
  customLbl: { fontSize: 11, fontWeight: "700", color: HT.axon },
  customVal: { fontSize: 13, fontWeight: "800", color: HT.axon, marginTop: 2 },
  customHint: { fontSize: 10, color: HT.muted, marginTop: 2, fontStyle: "italic" },
  reportCard: { alignItems: "center", padding: 20, borderRadius: 14, borderWidth: 2, gap: 6 },
  reportBig: { fontSize: 42, fontWeight: "900", color: HT.success },
  dupCard: { backgroundColor: HT.warningTint, borderWidth: 1, borderColor: HT.warning, borderRadius: 12, padding: 12, gap: 6, marginTop: 12 },
  dupTitle: { color: HT.text, fontWeight: "800", fontSize: 13.5, flex: 1 },
  dupLine: { color: HT.text2, fontSize: 12 },
  dupChoice: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 40, backgroundColor: HT.card },
  dupChoiceOn: { borderColor: HT.brand },
  dupChoiceTxt: { color: HT.text2, fontWeight: "700", fontSize: 12.5 },
  dupHint: { color: HT.muted, fontSize: 11.5 },
  reportLbl: { fontSize: 13, color: HT.success, fontWeight: "700" },
  reportRow: { backgroundColor: HT.card2, borderRadius: 10, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 4 },
  reportRowLbl: { fontSize: 12, fontWeight: "800", color: HT.text },
  reportRowVal: { fontSize: 12, color: HT.muted },
  reportErr: { fontSize: 11, color: "#DC2626" },
});

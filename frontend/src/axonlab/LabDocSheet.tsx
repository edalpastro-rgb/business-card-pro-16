/**
 * V50.z343 — Axon Lab · Scheda documento: carica (foto/PDF) o inserisci a mano → Axon analizza (barra di avanzamento)
 * → dati estratti mostrati CAMPO PER CAMPO, modificabili → Conferma / Scarta.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HT } from "@/src/homeTheme";
import { CrtFilePick, type PickedFile } from "@/src/CrtFilePick";
import { type LabDocSpec, type LabDocEntry, STATUS_LABEL } from "@/src/axonlab/labApi";
import { statusColor } from "@/src/axonlab/LabDocChecklist";

type Props = {
  spec: LabDocSpec | null;
  entry: LabDocEntry | undefined;
  keyLabels: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onUpload: (body: { name?: string; mime?: string; data_base64?: string; manual?: Record<string, string> }) => Promise<void>;
  onConfirm: (values: Record<string, string>, status: "confirmed" | "discarded") => Promise<void>;
};

export function LabDocSheet({ spec, entry, keyLabels, busy, onClose, onUpload, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);

  const st = entry?.status || "none";
  const extracted = useMemo(() => ({ ...(entry?.extracted || {}), ...(entry?.values || {}) }), [entry]);
  useEffect(() => { setVals(extracted); setManual({}); }, [extracted, spec?.id]);

  // barra di avanzamento «finta ma onesta»: avanza mentre Axon legge, completa al ritorno
  useEffect(() => {
    if (!busy) { setProgress(0); return; }
    setProgress(0.08);
    const t = setInterval(() => setProgress((p) => Math.min(0.92, p + (0.92 - p) * 0.12)), 400);
    return () => clearInterval(t);
  }, [busy]);

  if (!spec) return null;
  const manualKeys = spec.manual_keys || [];
  const canManual = spec.mode !== "upload";
  const canUpload = spec.mode !== "manual";
  const keys = Object.keys(vals).filter((k) => !k.endsWith("_uncertain") && k !== "iban_valid");

  const pick = async (f: PickedFile) => { await onUpload({ name: f.name, mime: f.mime, data_base64: f.data_base64 }); };
  const submitManual = async () => {
    const m = Object.fromEntries(Object.entries(manual).filter(([, v]) => v.trim()));
    if (!Object.keys(m).length) return;
    await onUpload({ manual: m });
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} testID="lab-doc-sheet">
            <View style={s.handle} />
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{spec.label}</Text>
                <Text style={s.sub}>{spec.hint}</Text>
              </View>
              <View style={[s.pill, { backgroundColor: st === "confirmed" ? HT.successTint : st === "uploaded" ? HT.warningTint : HT.card2 }]}>
                <Text style={[s.pillTxt, { color: statusColor(st) }]}>{STATUS_LABEL[st]}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10} testID="lab-doc-close"><Ionicons name="close" size={22} color={HT.text2} /></Pressable>
            </View>

            <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
              {busy ? (
                <View style={s.progressBox} testID="lab-doc-progress">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={HT.axon} />
                    <Text style={s.progressTxt}>Axon sta analizzando il documento…</Text>
                  </View>
                  <View style={s.track}><View style={[s.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
                </View>
              ) : null}

              {/* Sorgenti */}
              {!busy ? (
                <View style={s.srcRow}>
                  {canUpload ? <CrtFilePick onPicked={pick} label={spec.mode === "stamp" ? "Foto del timbro" : "Carica foto / PDF"} testID="lab-doc-upload" /> : null}
                  {entry?.files?.length ? <Text style={s.fileTxt} numberOfLines={1}>📎 {entry.files[entry.files.length - 1].name}</Text> : null}
                </View>
              ) : null}

              {canManual && !busy ? (
                <View style={s.box}>
                  <Text style={s.boxTitle}>{spec.mode === "stamp" ? "Oppure scrivi il testo del timbro" : "Inserimento manuale"}</Text>
                  {manualKeys.map((k) => (
                    <TextInput
                      key={k}
                      value={manual[k] ?? ""}
                      onChangeText={(t) => setManual((m) => ({ ...m, [k]: t }))}
                      placeholder={keyLabels[k] || k}
                      placeholderTextColor={HT.muted}
                      style={[s.input, k === "stamp_text" && { minHeight: 70 }]}
                      multiline={k === "stamp_text"}
                      autoCapitalize={k.includes("email") || k === "pec" ? "none" : "characters"}
                      keyboardType={k.includes("phone") || k === "mobile" ? "phone-pad" : k.includes("email") || k === "pec" ? "email-address" : "default"}
                      testID={`lab-doc-manual-${k}`}
                    />
                  ))}
                  <Pressable onPress={submitManual} style={[s.btn, s.btnGhost]} testID="lab-doc-manual-save">
                    <Ionicons name="create-outline" size={16} color={HT.axon} /><Text style={[s.btnTxt, { color: HT.axon }]}>Usa questi dati</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Dati campo per campo */}
              {keys.length > 0 && !busy ? (
                <View style={s.box} testID="lab-doc-fields">
                  <Text style={s.boxTitle}>{entry?.reused_from ? `Ripreso da: ${entry.reused_from} · controlla e conferma` : entry?.derived_from ? "Proposto da Axon · controlla e conferma" : "Dati letti da Axon · correggi se serve"}</Text>
                  {keys.map((k) => (
                    <View key={k} style={s.fieldRow}>
                      <Text style={s.fieldLbl}>{keyLabels[k] || k}</Text>
                      <TextInput value={vals[k] ?? ""} onChangeText={(t) => setVals((v) => ({ ...v, [k]: t }))} style={s.fieldInput} placeholderTextColor={HT.muted} testID={`lab-doc-field-${k}`} />
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>

            {!busy ? (
              <View style={s.actions}>
                {st !== "none" ? (
                  <Pressable onPress={() => onConfirm({}, "discarded")} style={[s.btn, s.btnGhost]} testID="lab-doc-discard">
                    <Ionicons name="trash-outline" size={16} color={HT.danger} /><Text style={[s.btnTxt, { color: HT.danger }]}>Scarta</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => onConfirm(vals, "confirmed")} disabled={!keys.length} style={[s.btn, s.btnPrimary, !keys.length && { opacity: 0.4 }]} testID="lab-doc-confirm">
                  <Ionicons name="checkmark-circle" size={16} color={HT.white} /><Text style={[s.btnTxt, { color: HT.white }]}>{st === "confirmed" ? "Aggiorna conferma" : "Approva e conferma"}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: HT.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 8, borderWidth: 1, borderColor: HT.border },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.border, marginBottom: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  title: { color: HT.text, fontWeight: "900", fontSize: 17 },
  sub: { color: HT.muted, fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  pillTxt: { fontSize: 10.5, fontWeight: "800" },
  progressBox: { backgroundColor: HT.card, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: HT.border },
  progressTxt: { color: HT.text2, fontWeight: "700", fontSize: 13 },
  track: { height: 6, borderRadius: 999, backgroundColor: HT.card2, overflow: "hidden" },
  fill: { height: 6, borderRadius: 999, backgroundColor: HT.axon },
  srcRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  fileTxt: { color: HT.muted, fontSize: 12, flex: 1 },
  box: { backgroundColor: HT.card, borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: HT.border },
  boxTitle: { color: HT.text2, fontWeight: "800", fontSize: 12.5 },
  input: { backgroundColor: HT.card2, color: HT.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: HT.border, minHeight: 44 },
  fieldRow: { gap: 3 },
  fieldLbl: { color: HT.muted, fontSize: 11, fontWeight: "700" },
  fieldInput: { backgroundColor: HT.card2, color: HT.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, borderWidth: 1, borderColor: HT.border, minHeight: 42 },
  actions: { flexDirection: "row", gap: 10, marginTop: 10 },
  btn: { flex: 1, minHeight: 46, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  btnPrimary: { backgroundColor: HT.axon, flex: 1.6 },
  btnTxt: { fontWeight: "900", fontSize: 13.5 },
});

// LabExamplesCard.tsx — V50.z375 — Axon Lab · Fase 2: ESEMPI COMPILATI MULTIPLI per modulo (azienda vs privato, fornitore A vs B…).
// «Aggiungi esempio» / sostituisci / elimina: a ogni modifica Axon ri-propone il mapping imparando da TUTTI gli esempi combinati.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify, confirmAsync } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { labStyles as L } from "@/src/axonlab/LabHeader";
import { CrtFilePick, type PickedFile } from "@/src/CrtFilePick";
import type { LabModule } from "@/src/axonlab/labApi";

export type LabExample = { id: string; name?: string | null; fields: number; uploaded_at?: string };

export function LabExamplesCard({ templateId, examples, onUpdated }: { templateId: string; examples: LabExample[]; onUpdated: (m: LabModule) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [replaceId, setReplaceId] = useState<string | null>(null);

  const upload = async (f: PickedFile) => {
    setBusy(replaceId || "new");
    try {
      const m = await api<LabModule>(`/lab/modules/${templateId}/examples`, { method: "POST", body: { name: name.trim() || undefined, pdf_base64: f.data_base64, replace_id: replaceId || undefined } });
      onUpdated(m); setName(""); setReplaceId(null);
      notify("Esempio aggiunto", `Axon ha ri-proposto le regole imparando da ${m.examples?.length || 1} esempi.`);
    } catch (e: any) { notify("Esempio compilato", e?.message || "Caricamento non riuscito"); }
    finally { setBusy(null); }
  };
  const remove = async (ex: LabExample) => {
    if (!(await confirmAsync("Elimina esempio", `Rimuovere «${ex.name || ex.id}»? Le regole verranno ri-proposte dagli esempi rimanenti.`))) return;
    setBusy(ex.id);
    try { onUpdated(await api<LabModule>(`/lab/modules/${templateId}/examples/${ex.id}`, { method: "DELETE" })); }
    catch (e: any) { notify("Esempio compilato", e?.message || "Eliminazione non riuscita"); }
    finally { setBusy(null); }
  };

  return (
    <View style={L.card} testID="lab-examples">
      <Text style={L.cardTitle}>Esempi compilati ({examples.length})</Text>
      <Text style={L.cardSub}>Ogni esempio rappresenta una situazione diversa (azienda vs privato, fornitore A vs B). Axon impara le regole generali da tutti gli esempi combinati, non solo dall'ultimo.</Text>
      {examples.map((ex, i) => (
        <View key={ex.id} style={s.row} testID={`lab-example-${ex.id}`}>
          <Ionicons name="document-text" size={18} color={HT.axon} />
          <View style={{ flex: 1 }}><Text style={s.name}>{ex.name || `Esempio ${i + 1}`}</Text><Text style={L.muted}>{ex.fields} valori compilati{ex.uploaded_at ? ` · ${new Date(ex.uploaded_at).toLocaleDateString("it-IT")}` : ""}</Text></View>
          {busy === ex.id ? <ActivityIndicator color={HT.axon} /> : (
            <>
              <Pressable onPress={() => { setReplaceId(replaceId === ex.id ? null : ex.id); setName(ex.name || ""); }} hitSlop={8} style={[s.iconBtn, replaceId === ex.id && { backgroundColor: HT.axonTint }]} testID={`lab-example-replace-${ex.id}`}><Ionicons name="swap-horizontal" size={18} color={HT.axon} /></Pressable>
              <Pressable onPress={() => remove(ex)} hitSlop={8} style={s.iconBtn} testID={`lab-example-delete-${ex.id}`}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable>
            </>
          )}
        </View>
      ))}
      {!examples.length ? <Text style={L.muted}>Nessun esempio: le regole sono quelle predefinite. Carica un modulo compilato per farle proporre ad Axon.</Text> : null}
      <View style={{ gap: 8 }}>
        {replaceId ? <Text style={[L.muted, { color: HT.axon, fontWeight: "800" }]}>Sostituzione di «{examples.find((x) => x.id === replaceId)?.name || replaceId}»: carica il nuovo PDF.</Text> : null}
        <TextInput value={name} onChangeText={setName} placeholder="Nome esempio (es. Azienda con timbro · fornitore A)" placeholderTextColor={HT.muted} style={L.input} testID="lab-example-name" />
        {busy === "new" || (busy && busy === replaceId) ? <View style={[L.btn, L.btnGhost]}><ActivityIndicator color={HT.axon} /><Text style={[L.btnTxt, { color: HT.axon }]}>Axon legge l'esempio e ri-propone le regole…</Text></View>
          : <CrtFilePick onPicked={upload} label={replaceId ? "Carica sostituto (PDF)" : "Aggiungi esempio (PDF compilato)"} testID="lab-example-add" />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderTopWidth: 1, borderTopColor: HT.border, paddingTop: 8 },
  name: { fontSize: 14, fontWeight: "800", color: HT.text },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});

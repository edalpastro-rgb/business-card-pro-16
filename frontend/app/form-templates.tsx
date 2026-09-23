// form-templates.tsx — V50.z268 — «Modelli moduli» (Master): carica il PDF del modulo (dispositivo / Google Drive / Dropbox),
// Axon rileva i campi (o usa i campi compilabili del PDF) → lista modelli → editor campi (/form-template/[id]).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DropboxPickerModal } from "@/src/DropboxPickerModal";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type FormTemplate = { template_id: string; name: string; notes?: string; page_count: number; field_count: number; field_source: string; created_at: string };

export default function FormTemplatesScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<FormTemplate[]>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<{ name: string; data_base64: string } | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [isExample, setIsExample] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drive, setDrive] = useState(false);
  const [dropbox, setDropbox] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<{ items: FormTemplate[]; is_master: boolean }>("/form-templates"); setItems(r.items || []); setIsMaster(!!r.is_master); }
    catch (e: any) { notify("Modelli", e?.message || ""); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fromDevice = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const dataUrl = await uriToBase64DataUrl(a.uri, "application/pdf");
      setPicked({ name: a.name || "modulo.pdf", data_base64: dataUrl });
      if (!name) setName((a.name || "Modulo").replace(/\.pdf$/i, ""));
    } catch (e: any) { notify("File", e?.message || "Impossibile leggere il file"); }
  };
  const fromCloud = (info: { name: string; mime: string; data_base64: string }) => {
    if (!/pdf/i.test(info.mime) && !/\.pdf$/i.test(info.name)) { notify("Modelli", "Seleziona un file PDF"); return; }
    setPicked({ name: info.name, data_base64: info.data_base64 }); if (!name) setName(info.name.replace(/\.pdf$/i, "")); setDrive(false); setDropbox(false);
  };
  const create = async () => {
    if (!picked) { notify("Modelli", "Carica prima il PDF del modulo"); return; }
    setBusy("Axon analizza il modulo e rileva i campi… (può richiedere fino a un minuto)");
    try {
      const t = await api<FormTemplate>("/form-templates", { method: "POST", body: { name: name.trim() || picked.name, notes, pdf_base64: picked.data_base64, is_filled_example: isExample } });
      setPicked(null); setName(""); setNotes(""); setIsExample(false);
      await load();
      notify("Modello creato", `${t.field_count} campi rilevati. Controlla e correggi le posizioni nell'editor.`);
      router.push(`/form-template/${t.template_id}` as any);
    } catch (e: any) { notify("Modelli", e?.message || "Analisi non riuscita"); } finally { setBusy(null); }
  };
  const remove = async (t: FormTemplate) => { try { await api(`/form-templates/${t.template_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Modelli", e?.message || ""); } };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Modelli moduli</Text><Text style={s.sub}>PDF da compilare automaticamente con i dati del cliente</Text></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: pagePad }}>
        {isMaster ? (
          <View style={s.card} testID="ft-upload-card">
            <Text style={s.section}>Nuovo modello</Text>
            <Text style={s.hint}>Carica il PDF del modulo (vuoto o un esempio già compilato: Axon impara dove vanno i dati). Poi potrai correggere campi e posizioni.</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={fromDevice} style={s.srcBtn} testID="ft-src-device"><Ionicons name="phone-portrait-outline" size={18} color="#7C3AED" /><Text style={s.srcTxt}>Dispositivo</Text></Pressable>
              <Pressable onPress={() => setDrive(true)} style={s.srcBtn} testID="ft-src-drive"><Ionicons name="logo-google" size={18} color="#2563EB" /><Text style={s.srcTxt}>Drive</Text></Pressable>
              <Pressable onPress={() => setDropbox(true)} style={s.srcBtn} testID="ft-src-dropbox"><Ionicons name="cube-outline" size={18} color="#0061FF" /><Text style={s.srcTxt}>Dropbox</Text></Pressable>
            </View>
            {picked ? <View style={s.pickedRow} testID="ft-picked"><Ionicons name="document" size={18} color="#DC2626" /><Text style={{ flex: 1, fontWeight: "700", color: HT.text }} numberOfLines={1}>{picked.name}</Text><Pressable onPress={() => setPicked(null)} hitSlop={8}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable></View> : null}
            <TextInput value={name} onChangeText={setName} placeholder="Nome del modello (es. Contratto luce Enel)" placeholderTextColor={HT.muted} style={s.input} testID="ft-name" />
            <TextInput value={notes} onChangeText={setNotes} placeholder="Note / regole di compilazione (opzionale)" placeholderTextColor={HT.muted} style={[s.input, { minHeight: 60 }]} multiline testID="ft-notes" />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Switch value={isExample} onValueChange={setIsExample} testID="ft-example-switch" />
              <Text style={{ flex: 1, fontSize: 13, color: HT.text }}>Il PDF è un <Text style={{ fontWeight: "800" }}>esempio già compilato</Text> (Axon usa i valori scritti come regola di posizione)</Text>
            </View>
            {busy ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator color="#7C3AED" /><Text style={s.hint}>{busy}</Text></View> : null}
            <Pressable onPress={create} disabled={!!busy || !picked} style={[s.primary, (!picked || !!busy) && { opacity: 0.5 }]} testID="ft-create"><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={s.primaryTxt}>Analizza con Axon e crea modello</Text></Pressable>
          </View>
        ) : <Text style={s.hint}>Solo il Master può caricare e modificare i modelli. Puoi usarli dalla pagina Nuovo Contratto.</Text>}

        <Text style={s.section}>Modelli disponibili ({items.length})</Text>
        {loading ? <ActivityIndicator color="#7C3AED" /> : items.length === 0 ? <Text style={[s.hint, { textAlign: "center" }]} testID="ft-empty">Nessun modello caricato</Text> : items.map((t) => (
          <Pressable key={t.template_id} onPress={() => router.push(`/form-template/${t.template_id}` as any)} style={s.row} testID={`ft-item-${t.template_id}`}>
            <View style={s.rowIcon}><Ionicons name="document-text" size={20} color="#7C3AED" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{t.name}</Text>
              <Text style={s.rowMeta}>{t.page_count} pag. · {t.field_count} campi · {t.field_source === "acroform" ? "campi PDF" : "rilevati da Axon"}</Text>
            </View>
            {isMaster ? <Pressable onPress={() => remove(t)} hitSlop={8} style={{ padding: 6 }} testID={`ft-del-${t.template_id}`}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable> : null}
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
        ))}
      </ScrollView>
      <GoogleDrivePickerModal visible={drive} onClose={() => setDrive(false)} onFilePicked={fromCloud} />
      <DropboxPickerModal visible={dropbox} onClose={() => setDropbox(false)} onFilePicked={fromCloud} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  card: { backgroundColor: '#FAF5FF', borderRadius: 16, borderWidth: 1, borderColor: '#E9D5FF', padding: 14, gap: 10 },
  section: { fontSize: 14, fontWeight: "900", color: HT.text },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  srcBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  srcTxt: { fontSize: 12, fontWeight: "800", color: HT.text },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: HT.border },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 14, color: HT.text },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: '#7C3AED', borderRadius: 12, minHeight: 48 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 60 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3E8FF', alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "800", color: HT.text }, rowMeta: { fontSize: 12, color: HT.muted, marginTop: 2 },
});

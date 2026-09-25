/**
 * V50.z354 — Sorgenti di caricamento per un documento del dossier (cliente tipo o pratica):
 * Google Drive · Fotocamera · Scanner integrato · Memoria del telefono · Testo manuale · Dettatura vocale.
 * Ogni sorgente restituisce {name, mime, data_base64} (o testo) al foglio documento; nessuna compressione qui (velocità).
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { pickImages } from "@/src/image-picker";
import { pickCommonFile } from "@/src/utils/filePicker";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DocumentScannerModal } from "@/src/DocumentScannerModal";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import type { PickedFile } from "@/src/CrtFilePick";

type Props = {
  docLabel: string;
  contactId?: string;
  canUpload: boolean;
  canManual: boolean;
  manualOpen: boolean;
  onPicked: (f: PickedFile) => Promise<void> | void;
  onToggleManual: () => void;
  onDictation: (text: string) => void;
  testID?: string;
};

export function LabDocSources({ docLabel, contactId, canUpload, canManual, manualOpen, onPicked, onToggleManual, onDictation, testID }: Props) {
  const [drive, setDrive] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const camera = async () => {
    setBusy("camera");
    try {
      const [a] = await pickImages({ fromCamera: true, quality: 0.85 });
      if (!a) return;
      const mime = a.mimeType || "image/jpeg";
      const data_base64 = a.base64 ? `data:${mime};base64,${a.base64}` : await uriToBase64DataUrl(a.uri, mime);
      await onPicked({ name: a.fileName || `${docLabel.replace(/\s+/g, "_")}_foto.jpg`, mime, data_base64 });
    } catch (e: any) { notify("Fotocamera", e?.message || "Impossibile scattare la foto"); }
    finally { setBusy(null); }
  };
  const memory = async () => {
    setBusy("memory");
    try {
      const r = await pickCommonFile();
      if (r.error) { notify("File", r.error); return; }
      if (!r.asset) return;
      const mime = r.asset.mimeType || (r.asset.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const data_base64 = r.base64 ? (r.base64.startsWith("data:") ? r.base64 : `data:${mime};base64,${r.base64}`) : await uriToBase64DataUrl(r.asset.uri, mime);
      await onPicked({ name: r.asset.name || "documento", mime, data_base64 });
    } catch (e: any) { notify("File", e?.message || "Impossibile leggere il file"); }
    finally { setBusy(null); }
  };

  const Src = ({ id, icon, label, onPress, disabled, on }: { id: string; icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; disabled?: boolean; on?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled || !!busy} style={[s.src, on && s.srcOn, (disabled || (busy && busy !== id)) && { opacity: 0.4 }]} testID={`lab-src-${id}`}>
      {busy === id ? <ActivityIndicator size="small" color={HT.axon} /> : <Ionicons name={icon} size={20} color={on ? HT.white : HT.axon} />}
      <Text style={[s.srcTxt, on && { color: HT.white }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.wrap} testID={testID}>
      <Text style={s.title}>Da dove carichi «{docLabel}»?</Text>
      <View style={s.grid}>
        {canUpload ? <Src id="drive" icon="logo-google" label="Google Drive" onPress={() => setDrive(true)} /> : null}
        {canUpload ? <Src id="camera" icon="camera" label="Fotocamera" onPress={camera} /> : null}
        {canUpload ? <Src id="scanner" icon="scan" label="Scanner" onPress={() => setScanner(true)} disabled={Platform.OS === "web"} /> : null}
        {canUpload ? <Src id="memory" icon="folder-open" label="Memoria" onPress={memory} /> : null}
        {canManual ? <Src id="manual" icon="create-outline" label="Testo" onPress={onToggleManual} on={manualOpen} /> : null}
        <View style={[s.src, { paddingVertical: 0, justifyContent: "center" }]} testID="lab-src-voice">
          <VoiceDictationButton compact label="Dettatura" onTranscript={onDictation} testID="lab-src-voice-btn" />
        </View>
      </View>
      <Text style={s.note}>Il documento si salva automaticamente nel profilo del cliente per le prossime pratiche.</Text>

      <GoogleDrivePickerModal visible={drive} onClose={() => setDrive(false)} onFilePicked={(f) => { setDrive(false); void onPicked(f); }} />
      <DocumentScannerModal visible={scanner} onClose={() => setScanner(false)} defaultName={docLabel} hintTitle={`Scansiona: ${docLabel}`} contactId={contactId} source="dossier"
        onSaved={async (r) => { setScanner(false); await onPicked({ name: r.name || `${docLabel}.pdf`, mime: r.mime || "application/pdf", data_base64: r.pdf_base64.startsWith("data:") ? r.pdf_base64 : `data:${r.mime || "application/pdf"};base64,${r.pdf_base64}` }); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  title: { color: HT.text2, fontWeight: "800", fontSize: 12.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  src: { width: "31%", flexGrow: 1, minHeight: 64, borderRadius: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 6 },
  srcOn: { backgroundColor: HT.axon, borderColor: HT.axon },
  srcTxt: { color: HT.text, fontWeight: "800", fontSize: 11.5 },
  note: { color: HT.muted, fontSize: 11 },
});

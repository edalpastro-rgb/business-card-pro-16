/**
 * V50.z344 — Knowledge Base Axon · «Carica file»: bottom sheet con scelta della sorgente
 * (Telefono · Google Drive · Dropbox) e SELEZIONE MULTIPLA: i file scelti si accumulano in una coda
 * (dal telefono anche più file in un colpo; da Drive/Dropbox uno per volta, ripetibile) e si caricano insieme.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { folderPickAvailable, folderFileDataUrl } from "@/src/utils/folderPicker";
import { useFolderImport } from "@/src/FolderImportSheet";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DropboxPickerModal } from "@/src/DropboxPickerModal";

export type KbPicked = { name: string; mime: string; data_base64: string };
const ACCEPT_RX = /\.(pdf|txt|md|csv)$/i;

function accepted(name: string, mime: string) {
  const m = (mime || "").toLowerCase();
  return m.includes("pdf") || m.startsWith("text/") || ACCEPT_RX.test(name || "");
}

export function KbUploadSourceSheet({ visible, onClose, onUpload, uploading }: { visible: boolean; onClose: () => void; onUpload: (files: KbPicked[]) => Promise<void>; uploading: boolean }) {
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<KbPicked[]>([]);
  const [drive, setDrive] = useState(false);
  const [dropbox, setDropbox] = useState(false);
  const [reading, setReading] = useState(false);

  const add = (files: KbPicked[]) => {
    const ok = files.filter((f) => accepted(f.name, f.mime));
    if (ok.length < files.length) notify("Formato non supportato", "Sono accettati PDF, TXT, MD e CSV.");
    setQueue((q) => [...q, ...ok.filter((f) => !q.some((x) => x.name === f.name && x.data_base64.length === f.data_base64.length))]);
  };

  const fromDevice = async () => {
    setReading(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "text/*", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], multiple: true, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const files: KbPicked[] = [];
      for (const a of res.assets) {
        const mime = a.mimeType || (a.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain");
        files.push({ name: a.name || "documento", mime, data_base64: await uriToBase64DataUrl(a.uri, mime) });
      }
      add(files);
    } catch (e: any) { notify("File", e?.message || "Impossibile leggere i file"); }
    finally { setReading(false); }
  };
  // V50.z479/z482 — «Carica cartella» (Android + desktop): anteprima con spunte + barra; i file letti vanno in coda
  const folderImport = useFolderImport({
    extRe: /\.(pdf|txt|md|csv)$/i,
    uploadOne: async (f) => { add([{ name: f.name, mime: f.mime, data_base64: await folderFileDataUrl(f) }]); },
    title: "Cartella → Knowledge Base",
    emptyHint: "Nella cartella scelta non ci sono PDF, TXT, MD o CSV.",
  });
  const cloud = (info: KbPicked) => { setDrive(false); setDropbox(false); add([info]); };

  const done = async () => { await onUpload(queue); setQueue([]); };
  const close = () => { if (!uploading) { setQueue([]); onClose(); } };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {folderImport.sheet}
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 14 }]} onPress={() => {}} testID="kb-upload-sheet">
          <View style={s.handle} />
          <Text style={s.title}>Carica file nella Knowledge Base</Text>
          <Text style={s.sub}>Scegli la sorgente · puoi selezionare più file (PDF, TXT, MD, CSV)</Text>

          <View style={s.sources}>
            <Source icon="phone-portrait-outline" label="Telefono" hint="File manager locale · selezione multipla" onPress={fromDevice} testID="kb-src-device" busy={reading} />
            {folderPickAvailable() ? <Source icon="folder-open-outline" label="Cartella" hint="Tutti i file di una cartella (e sottocartelle)" onPress={folderImport.pick} testID="kb-src-folder" busy={reading} /> : null}
            <Source icon="logo-google" label="Google Drive" hint="Scegli dal tuo Drive" onPress={() => setDrive(true)} testID="kb-src-drive" />
            <Source icon="logo-dropbox" label="Dropbox" hint="Scegli da Dropbox" onPress={() => setDropbox(true)} testID="kb-src-dropbox" />
          </View>

          {queue.length > 0 ? (
            <View style={s.queue} testID="kb-upload-queue">
              <Text style={s.queueTitle}>{queue.length} file selezionati</Text>
              <ScrollView style={{ maxHeight: 150 }}>
                {queue.map((f, i) => (
                  <View key={`${f.name}_${i}`} style={s.qRow}>
                    <Ionicons name={f.mime.includes("pdf") ? "document-text" : "document-outline"} size={16} color={HT.brand} />
                    <Text style={s.qName} numberOfLines={1}>{f.name}</Text>
                    <Pressable onPress={() => setQueue((q) => q.filter((_, j) => j !== i))} hitSlop={8} testID={`kb-queue-remove-${i}`}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Pressable onPress={close} disabled={uploading} style={[s.btn, s.btnGhost]} testID="kb-upload-cancel"><Text style={[s.btnTxt, { color: HT.text }]}>Annulla</Text></Pressable>
            <Pressable onPress={done} disabled={uploading || !queue.length} style={[s.btn, s.btnPrimary, (uploading || !queue.length) && { opacity: 0.45 }]} testID="kb-upload-confirm">
              {uploading ? <ActivityIndicator size="small" color={HT.white} /> : <Ionicons name="cloud-upload" size={16} color={HT.white} />}
              <Text style={[s.btnTxt, { color: HT.white }]}>{uploading ? "Caricamento…" : `Carica ${queue.length || ""} file`.replace("  ", " ")}</Text>
            </Pressable>
          </View>
          <GoogleDrivePickerModal visible={drive} onClose={() => setDrive(false)} onFilePicked={cloud} />
          <DropboxPickerModal visible={dropbox} onClose={() => setDropbox(false)} onFilePicked={cloud} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Source({ icon, label, hint, onPress, testID, busy }: { icon: any; label: string; hint: string; onPress: () => void; testID: string; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} style={s.src} testID={testID}>
      <View style={s.srcIcon}>{busy ? <ActivityIndicator size="small" color={HT.brand} /> : <Ionicons name={icon} size={22} color={HT.brand} />}</View>
      <View style={{ flex: 1 }}><Text style={s.srcLbl}>{label}</Text><Text style={s.srcHint}>{hint}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={HT.muted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 8, borderWidth: 1, borderColor: HT.border },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.border, marginBottom: 10 },
  title: { color: HT.text, fontWeight: "900", fontSize: 17 },
  sub: { color: HT.muted, fontSize: 12.5, marginTop: 2, marginBottom: 12 },
  sources: { gap: 8 },
  src: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 12, minHeight: 60 },
  srcIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  srcLbl: { color: HT.text, fontWeight: "800", fontSize: 14.5 },
  srcHint: { color: HT.muted, fontSize: 12 },
  queue: { marginTop: 12, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 10, gap: 6 },
  queueTitle: { color: HT.text2, fontWeight: "800", fontSize: 12.5 },
  qRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  qName: { color: HT.text, fontSize: 13, flex: 1 },
  btn: { flex: 1, minHeight: 46, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  btnPrimary: { backgroundColor: HT.brand, flex: 1.5 },
  btnTxt: { fontWeight: "900", fontSize: 13.5 },
});

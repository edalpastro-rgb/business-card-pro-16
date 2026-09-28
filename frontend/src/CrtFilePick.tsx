// CrtFilePick.tsx — V50.z282 — Scelta sorgente file (telefono / Google Drive / Dropbox) → {name, mime, data_base64}
// V50.z332 — `dropZone`: su web/desktop area «Trascina qui i file» (drag & drop dal PC, PDF/JPG/PNG, anche più file);
// su telefono resta il tap (Android/iOS non hanno drag & drop dal file system).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DropboxPickerModal } from "@/src/DropboxPickerModal";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { notify } from "@/src/utils/notify";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type PickedFile = { name: string; mime: string; data_base64: string };

const ACCEPT = /^(application\/pdf|image\/(jpeg|jpg|png|webp|heic|heif))$/i;

export function CrtFilePick({ onPicked, label = "Carica", compact, testID, dropZone, dropHint }: { onPicked: (f: PickedFile) => void; label?: string; compact?: boolean; testID?: string; dropZone?: boolean; dropHint?: string }) {
  const [drive, setDrive] = useState(false);
  const [dropbox, setDropbox] = useState(false);
  const [over, setOver] = useState(false);
  const zoneRef = useRef<any>(null);
  const pickedRef = useRef(onPicked);
  pickedRef.current = onPicked;
  const webDrop = dropZone && Platform.OS === "web";

  useEffect(() => {
    if (!webDrop) return;
    const el = zoneRef.current as (HTMLElement & { addEventListener: any; removeEventListener: any }) | null;
    if (!el || typeof el.addEventListener !== "function") return;
    const stop = (e: any) => { e.preventDefault(); e.stopPropagation(); };
    const onEnter = (e: any) => { stop(e); setOver(true); };
    const onLeave = (e: any) => { stop(e); setOver(false); };
    const onDrop = (e: any) => {
      stop(e); setOver(false);
      const files: File[] = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const ok = files.filter((f) => ACCEPT.test(f.type) || /\.(pdf|jpe?g|png|webp|heic)$/i.test(f.name));
      if (!ok.length) { notify("File non supportato", "Trascina PDF o immagini (JPG, PNG)"); return; }
      if (ok.length < files.length) notify("Alcuni file ignorati", "Accettati solo PDF e immagini");
      ok.forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => pickedRef.current({ name: f.name, mime: f.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"), data_base64: String(reader.result || "") });
        reader.onerror = () => notify("File", `Impossibile leggere ${f.name}`);
        reader.readAsDataURL(f);
      });
    };
    el.addEventListener("dragenter", onEnter); el.addEventListener("dragover", onEnter); el.addEventListener("dragleave", onLeave); el.addEventListener("drop", onDrop);
    return () => { el.removeEventListener("dragenter", onEnter); el.removeEventListener("dragover", onEnter); el.removeEventListener("dragleave", onLeave); el.removeEventListener("drop", onDrop); };
  }, [webDrop]);
  const fromDevice = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0]; const mime = a.mimeType || (a.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      onPicked({ name: a.name || "documento", mime, data_base64: await uriToBase64DataUrl(a.uri, mime) });
    } catch (e: any) { notify("File", e?.message || "Impossibile leggere il file"); }
  };
  const cloud = (info: { name: string; mime: string; data_base64: string }) => { setDrive(false); setDropbox(false); onPicked(info); };
  const buttons = (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      <Pressable onPress={fromDevice} style={[s.btn, compact && s.compact]} testID={testID ? `${testID}-device` : undefined}><Ionicons name="phone-portrait-outline" size={15} color={HT.brand} /><Text style={s.txt}>{label}</Text></Pressable>
      <Pressable onPress={() => setDrive(true)} style={[s.btn, compact && s.compact]}><Ionicons name="logo-google" size={15} color={HT.brand} /><Text style={s.txt}>Drive</Text></Pressable>
      <Pressable onPress={() => setDropbox(true)} style={[s.btn, compact && s.compact]}><Ionicons name="logo-dropbox" size={15} color={HT.brand} /><Text style={s.txt}>Dropbox</Text></Pressable>
      <GoogleDrivePickerModal visible={drive} onClose={() => setDrive(false)} onFilePicked={cloud} />
      <DropboxPickerModal visible={dropbox} onClose={() => setDropbox(false)} onFilePicked={cloud} />
    </View>
  );
  if (!webDrop) return buttons;
  return (
    <View ref={zoneRef} style={[s.zone, over && s.zoneOver]} testID={testID ? `${testID}-dropzone` : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={over ? "cloud-download" : "cloud-upload-outline"} size={18} color={over ? theme.color.brandSecondary : HT.muted} />
        <Text style={[s.zoneTxt, over && { color: theme.color.brandSecondary }]}>{over ? "Rilascia per caricare" : dropHint || "Trascina qui i file (PDF, JPG, PNG) oppure"}</Text>
      </View>
      {buttons}
    </View>
  );
}
const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 38, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  compact: { minHeight: 34, paddingHorizontal: 8 }, txt: { fontSize: 12, fontWeight: "800", color: HT.brand },
  zone: { gap: 8, padding: 10, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: HT.border, backgroundColor: HT.card2 },
  zoneOver: { borderColor: theme.color.brandSecondary, backgroundColor: HT.brandTint },
  zoneTxt: { fontSize: 12, color: HT.muted, fontWeight: "600", flex: 1 },
});

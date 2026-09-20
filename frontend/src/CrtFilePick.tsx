// CrtFilePick.tsx — V50.z282 — Scelta sorgente file (telefono / Google Drive / Dropbox) → {name, mime, data_base64}
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { GoogleDrivePickerModal } from "@/src/GoogleDrivePickerModal";
import { DropboxPickerModal } from "@/src/DropboxPickerModal";
import { uriToBase64DataUrl } from "@/src/utils/media";
import { notify } from "@/src/utils/notify";
import { theme } from "@/src/theme";

export type PickedFile = { name: string; mime: string; data_base64: string };

export function CrtFilePick({ onPicked, label = "Carica", compact, testID }: { onPicked: (f: PickedFile) => void; label?: string; compact?: boolean; testID?: string }) {
  const [drive, setDrive] = useState(false);
  const [dropbox, setDropbox] = useState(false);
  const fromDevice = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0]; const mime = a.mimeType || (a.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      onPicked({ name: a.name || "documento", mime, data_base64: await uriToBase64DataUrl(a.uri, mime) });
    } catch (e: any) { notify("File", e?.message || "Impossibile leggere il file"); }
  };
  const cloud = (info: { name: string; mime: string; data_base64: string }) => { setDrive(false); setDropbox(false); onPicked(info); };
  return (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      <Pressable onPress={fromDevice} style={[s.btn, compact && s.compact]} testID={testID ? `${testID}-device` : undefined}><Ionicons name="phone-portrait-outline" size={15} color={theme.color.brandPrimary} /><Text style={s.txt}>{label}</Text></Pressable>
      <Pressable onPress={() => setDrive(true)} style={[s.btn, compact && s.compact]}><Ionicons name="logo-google" size={15} color={theme.color.brandPrimary} /><Text style={s.txt}>Drive</Text></Pressable>
      <Pressable onPress={() => setDropbox(true)} style={[s.btn, compact && s.compact]}><Ionicons name="logo-dropbox" size={15} color={theme.color.brandPrimary} /><Text style={s.txt}>Dropbox</Text></Pressable>
      <GoogleDrivePickerModal visible={drive} onClose={() => setDrive(false)} onFilePicked={cloud} />
      <DropboxPickerModal visible={dropbox} onClose={() => setDropbox(false)} onFilePicked={cloud} />
    </View>
  );
}
const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 38, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, backgroundColor: "#FFF" },
  compact: { minHeight: 34, paddingHorizontal: 8 }, txt: { fontSize: 12, fontWeight: "800", color: theme.color.brandPrimary },
});

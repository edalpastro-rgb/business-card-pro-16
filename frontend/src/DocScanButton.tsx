// DocScanButton.tsx — V50.z487 — «Scansiona documento» universale: fotografa / galleria / file (anche Drive) / scanner di sistema
// → POST /documents/ocr-fields (carta d'identità, CIE, patente, passaporto, tessera sanitaria, biglietto da visita, visura, bolletta…)
// → `onExtracted(fields)` compila i campi del form che lo ospita (Set Up and Go › Chi sei, Nuovo contatto, Anagrafica…).
// Stessa logica e stesse sorgenti di IdentityDocsSection (V50.z462): fotocamera live expo-camera su nativo, nessun ImagePicker.launchCameraAsync.
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { ensureDevicePermission } from "@/src/permissions/devicePermissions";
import { LiveCameraScanner, type LiveScannedPage } from "@/src/LiveCameraScanner";
import { isNativeScannerAvailable } from "@/src/NativeDocScanner";
import { DOC_SOURCES, shootLegacy, pickFromGallery, pickFromFiles, pickFromScanner, type DocSource } from "@/src/IdentityDocsSection";

export type DocFields = Record<string, string> & { doc_kind?: string };
export type DocScanResult = { fields: DocFields; filled: string[]; doc_kind: string; image: string };

type Props = {
  onExtracted: (r: DocScanResult) => void;
  /** «identity» = documento d'identità; «business_card» = biglietto da visita; «any» = riconosci da solo (default) */
  hint?: "identity" | "business_card" | "any";
  label?: string;
  sublabel?: string;
  compact?: boolean;
  testID?: string;
};

export const DOC_KIND_LABEL: Record<string, string> = {
  id_card: "Carta d'identità", driving_license: "Patente", passport: "Passaporto", health_card: "Tessera sanitaria", business_card: "Biglietto da visita",
  company_doc: "Documento aziendale", bill: "Bolletta", other: "Documento",
};

export function DocScanButton({ onExtracted, hint = "any", label = "Scansiona documento", sublabel = "Carta d'identità, passaporto, patente o biglietto da visita: compilo io i campi", compact, testID = "doc-scan-btn" }: Props) {
  const [pick, setPick] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const scannerOk = Platform.OS !== "web" && isNativeScannerAvailable();

  const runOcr = async (img: string) => {
    setBusy("Axon legge il documento…");
    try {
      const r = await api<{ document: DocFields; filled: string[]; doc_kind: string }>("/documents/ocr-fields", { method: "POST", body: { image_base64: img, hint: hint === "any" ? undefined : hint } });
      const filled = r.filled || [];
      if (!filled.length) { notify("Documento", "Non ho trovato dati leggibili: prova con una foto più nitida o compila a mano."); return; }
      onExtracted({ fields: r.document || {}, filled, doc_kind: r.doc_kind || "other", image: img });
      notify("Documento letto", `${DOC_KIND_LABEL[r.doc_kind] || "Documento"}: ${filled.length} campi compilati. Controlla e correggi se serve.`);
    } catch (e: any) { notify("Lettura documento", e?.message || "Non sono riuscito a leggere il documento: puoi compilare a mano."); }
    finally { setBusy(null); }
  };

  const acquire = async (source: DocSource) => {
    setPick(false);
    try {
      if (source === "camera") {
        if (!(await ensureDevicePermission("camera"))) return;
        if (Platform.OS !== "web") { setCamOpen(true); return; }
      }
      const img = source === "camera" ? await shootLegacy() : source === "gallery" ? await pickFromGallery() : source === "files" ? await pickFromFiles() : await pickFromScanner();
      if (img) await runOcr(img);
    } catch (e: any) { notify("Documento", e?.message || "Impossibile acquisire l'immagine"); }
  };

  const onLiveShot = async (pages: LiveScannedPage[]) => {
    setCamOpen(false);
    if (!pages[0]) return;
    await runOcr(pages[0].preview_uri || `data:${pages[0].mime};base64,${pages[0].data_base64}`);
  };

  return (
    <View style={{ gap: 8 }} testID={`${testID}-wrap`}>
      {Platform.OS !== "web" ? <LiveCameraScanner visible={camOpen} singleShot onClose={() => setCamOpen(false)} onDone={(p) => void onLiveShot(p)} /> : null}
      <Pressable onPress={() => setPick((v) => !v)} disabled={!!busy} style={({ pressed }) => [styles.btn, compact && styles.btnCompact, pressed && { opacity: 0.85 }]} testID={testID} accessibilityRole="button">
        <View style={styles.icon}>{busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="id-card" size={compact ? 16 : 20} color="#FFF" />}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.lbl, compact && { fontSize: 13 }]} numberOfLines={compact ? 1 : 2}>{busy || label}</Text>
          {!compact && !busy ? <Text style={styles.sub} numberOfLines={2}>{sublabel}</Text> : null}
        </View>
        <Ionicons name={pick ? "chevron-up" : "chevron-down"} size={18} color="rgba(255,255,255,0.85)" />
      </Pressable>
      {pick ? (
        <View style={styles.srcRow} testID={`${testID}-sources`}>
          {DOC_SOURCES.filter((o) => o.id !== "scanner" || scannerOk).map((o) => (
            <Pressable key={o.id} onPress={() => acquire(o.id)} style={({ pressed }) => [styles.src, pressed && { opacity: 0.8 }]} testID={`${testID}-src-${o.id}`} accessibilityRole="button">
              <Ionicons name={o.icon} size={18} color={HT.violet} />
              <Text style={styles.srcTxt} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.violet, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  btnCompact: { minHeight: 44, paddingVertical: 8, borderRadius: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  lbl: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 11.5, lineHeight: 15, marginTop: 1 },
  srcRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  src: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, flexGrow: 1, flexBasis: "45%" },
  srcTxt: { fontWeight: "800", fontSize: 13, color: HT.violet },
});

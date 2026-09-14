import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, Image, ActivityIndicator, TextInput, Platform, Keyboard, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { LiveCameraScanner, type LiveScannedPage } from "@/src/LiveCameraScanner";
import { ManualCropEditor } from "@/src/ManualCropEditor";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
/**
 * V27 — Document Scanner (multi-page + auto-crop + PDF merge).
 *
 * Usage:
 *   <DocumentScannerModal
 *     visible={open}
 *     onClose={() => setOpen(false)}
 *     defaultName={suggestName()}  // e.g. `Enel-Luce-Ottobre-2026`
 *     onSaved={({ pdf_base64, name }) => uploadTo(...)}
 *   />
 *
 * Features:
 *   - Multi-page acquisition: camera one-by-one OR multi-select from gallery/documents
 *   - Preview grid with reorder (up/down) + delete
 *   - Toggle Autocrop + Enhance + Grayscale
 *   - Custom name input (prefilled with `defaultName`)
 *   - Backend does auto-crop (OpenCV Canny + 4-point warp), CLAHE contrast,
 *     unsharp mask, optional grayscale, and merges into a single PDF.
 */
export type ScannedPage = { data_base64: string; mime: string; preview_uri: string; original_base64?: string; manual_crop?: boolean; auto_cropped?: boolean };

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultName?: string;
  hintTitle?: string;
  /** V50.z226 — Contatto di origine: il PDF viene salvato ANCHE nei file del cliente (oltre a I miei file › Scanner). */
  contactId?: string;
  /** V50.z226 — Canale di provenienza (widget, contact, bills, chat) salvato sul Master File. */
  source?: string;
  onSaved: (result: { pdf_base64: string; name: string; page_count: number; mime: string }) => void | Promise<void>;
};

/**
 * V50.z226 — Sposta la card sopra la tastiera dentro il Modal nativo. Su Android il Modal può già
 * ridimensionare la finestra (adjustResize): si applica solo la parte di tastiera NON già assorbita.
 */
function useKeyboardLift() {
  const [kb, setKb] = useState(0);
  const { height: winH } = useWindowDimensions();
  const maxH = useRef(winH);
  if (winH > maxH.current) maxH.current = winH;
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEv, (e) => setKb(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(hideEv, () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const absorbed = Math.max(0, maxH.current - winH);
  return { lift: Math.max(0, kb - absorbed), keyboardOpen: kb > 0 };
}

export function DocumentScannerModal({ visible, onClose, defaultName, hintTitle, contactId, source, onSaved }: Props) {
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const bottomPad = useBottomSheetPadding();
  const { lift, keyboardOpen } = useKeyboardLift();
  const nameInputRef = useRef<TextInput>(null);
  const [autocrop, setAutocrop] = useState(true);
  const [enhance, setEnhance] = useState(true);
  const [grayscale, setGrayscale] = useState(false);
  const [name, setName] = useState(defaultName || "");
  const [busy, setBusy] = useState(false);
  const [savingLbl, setSavingLbl] = useState<string>("");
  const [liveScanOpen, setLiveScanOpen] = useState<false | "multi" | "single">(false); // Bug 11 — modalità continua / V50.z139 foto singola
  const [cropIdx, setCropIdx] = useState<number | null>(null); // ritaglio manuale pagina
  const nameSyncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (visible) {
      if (nameSyncedFor.current !== (defaultName || "")) {
        setName(defaultName || "");
        nameSyncedFor.current = defaultName || "";
      }
    } else {
      // Reset when closed
      setPages([]);
      setBusy(false);
      setSavingLbl("");
    }
  }, [visible, defaultName]);

  const addFromCamera = useCallback(() => {
    // V50.z139 — "Foto singola" usa la fotocamera in-app (expo-camera CameraView): autofocus
    // continuo, rilevamento bordi live e ritaglio automatico PRIMA di restituire l'immagine,
    // con gestione permessi robusta (niente loop "Serve l'accesso alla fotocamera").
    // Sostituisce ImagePicker.launchCameraAsync (nessun autofocus/crop, permessi in loop su Android 16).
    setLiveScanOpen("single");
  }, []);

  const addFromGallery = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify("Permesso mancante", "Serve l'accesso alla galleria.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.85,
        base64: true,
        exif: false,
        selectionLimit: 20,
      });
      if (res.canceled || !res.assets?.length) return;
      const additions: ScannedPage[] = res.assets
        .filter((a) => !!a.base64)
        .map((a) => ({
          data_base64: a.base64!,
          mime: a.mimeType || "image/jpeg",
          preview_uri: a.uri || `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`,
        }));
      setPages((p) => [...p, ...additions]);
    } catch (e: any) {
      notify("Errore galleria", e?.message || "");
    }
  }, []);

  const addFromPdf = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const additions: ScannedPage[] = [];
      for (const a of res.assets) {
        try {
          let b64: string | undefined;
          if (a.uri && Platform.OS === "web" && a.uri.startsWith("blob:")) {
            const resp = await fetch(a.uri);
            const blob = await resp.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const fr = new FileReader();
              fr.onloadend = () => resolve(fr.result as string);
              fr.onerror = () => reject(new Error("read failed"));
              fr.readAsDataURL(blob);
            });
            b64 = dataUrl.split(",")[1];
          } else if (a.uri && a.uri.startsWith("data:")) {
            b64 = a.uri.split(",")[1];
          } else if (a.uri) {
            const FS: any = await import("expo-file-system").then((m) => m as any).catch(() => null);
            if (FS?.readAsStringAsync) {
              b64 = await FS.readAsStringAsync(a.uri, { encoding: "base64" });
            }
          }
          if (b64) {
            additions.push({
              data_base64: b64,
              mime: a.mimeType || (a.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
              preview_uri: a.mimeType === "application/pdf" || (a.name || "").toLowerCase().endsWith(".pdf")
                ? "pdf" : (a.uri || `data:${a.mimeType || "image/jpeg"};base64,${b64}`),
            });
          }
        } catch (e: any) {
          console.warn("read asset fail", e?.message);
        }
      }
      if (additions.length) setPages((p) => [...p, ...additions]);
    } catch (e: any) {
      notify("Errore selezione", e?.message || "");
    }
  }, []);

  const moveUp = (idx: number) => setPages((p) => {
    if (idx <= 0) return p; const q = [...p]; [q[idx - 1], q[idx]] = [q[idx], q[idx - 1]]; return q;
  });
  const moveDown = (idx: number) => setPages((p) => {
    if (idx >= p.length - 1) return p; const q = [...p]; [q[idx], q[idx + 1]] = [q[idx + 1], q[idx]]; return q;
  });
  const removePage = (idx: number) => setPages((p) => p.filter((_, i) => i !== idx));

  // Bug 11 — Import pages from continuous LiveCameraScanner into the modal.
  // Each live-scan page is already an image (already cropped by the backend
  // preview when possible), so we can drop it into `pages` directly.
  const onLiveScanDone = useCallback((livePages: LiveScannedPage[]) => {
    if (!livePages?.length) {
      setLiveScanOpen(false);
      return;
    }
    const additions: ScannedPage[] = livePages.map((p) => ({
      data_base64: p.data_base64,
      mime: p.mime || "image/jpeg",
      preview_uri: p.preview_uri || `data:${p.mime || "image/jpeg"};base64,${p.data_base64}`,
      original_base64: p.original_base64,
      manual_crop: p.manual,
      auto_cropped: p.cropped && !p.manual,
    }));
    setPages((prev) => [...prev, ...additions]);
    setLiveScanOpen(false);
  }, []);

  const doSave = async () => {
    if (!pages.length) { notify("Nessuna pagina", "Aggiungi almeno una pagina."); return; }
    const finalName = (name || defaultName || "Scansione").trim() || "Scansione";
    try {
      setBusy(true);
      setSavingLbl(`Elaborazione ${pages.length} pagine…`);
      const payload = {
        pages: pages.map((p) => ({ data_base64: p.data_base64, mime: p.mime, already_cropped: !!(p.manual_crop || p.auto_cropped) })),
        enhance,
        autocrop,
        grayscale,
        name: finalName,
      };
      const r = await api<{ pdf_base64: string; name: string; page_count: number }>("/scanner/merge-pdf", { method: "POST", body: payload });
      // V50.z226 — Il PDF viene salvato SUBITO, prima di qualsiasi flusso successivo (analisi, allegato…):
      // I miei file › Scanner sempre; se c'è un contatto di origine anche nei file del cliente. Mai perso se l'utente chiude.
      setSavingLbl("Salvataggio in I miei file…");
      const fname = r.name.toLowerCase().endsWith(".pdf") ? r.name : `${r.name}.pdf`;
      const bytes = Math.floor((r.pdf_base64.length * 3) / 4);
      const saves: Promise<unknown>[] = [
        api("/master-files", { method: "POST", body: { category: "scanner", name: fname, mime: "application/pdf", data_base64: r.pdf_base64, size: bytes, source: source || (contactId ? "contact" : "widget"), source_contact_id: contactId || null } }),
      ];
      if (contactId) {
        saves.push(api(`/contacts/${contactId}/files`, { method: "POST", body: { name: fname, mime: "application/pdf", data_base64: r.pdf_base64, size: bytes } }));
      }
      const results = await Promise.allSettled(saves);
      const failed = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) notify("Salvataggio parziale", failed.map((f) => String((f.reason as any)?.message || f.reason)).join(" · "));
      else notify("PDF salvato ✅", contactId ? "In I miei file › Scanner e nei file del cliente" : "In I miei file › Scanner");
      await onSaved({ pdf_base64: r.pdf_base64, name: r.name, page_count: r.page_count, mime: "application/pdf" });
      onClose();
    } catch (e: any) {
      notify("Errore scansione", e?.message || "");
    } finally {
      setBusy(false);
      setSavingLbl("");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.back}>
        <View style={[styles.card, { paddingBottom: keyboardOpen ? 8 : bottomPad, marginBottom: lift }]}>
          {/* Header */}
          <View style={styles.hdr}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Scanner documenti</Text>
              {!!hintTitle && <Text style={styles.sub}>{hintTitle}</Text>}
              {!hintTitle && <Text style={styles.sub}>Acquisisci più pagine, riordinale e crea un PDF.</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={10} testID="scanner-close">
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>

          {/* Sources */}
          <View style={styles.sourceRow}>
            <Pressable onPress={() => setLiveScanOpen("multi")} style={styles.sourceBtn} testID="scanner-live">
              <View style={[styles.sourceIcon, { backgroundColor: "#DC2626" }]}>
                <Ionicons name="scan" size={20} color="#FFF" />
              </View>
              <Text style={styles.sourceTxt}>Scan continuo</Text>
            </Pressable>
            <Pressable onPress={addFromCamera} style={styles.sourceBtn} testID="scanner-camera">
              <View style={[styles.sourceIcon, { backgroundColor: "#FF6B35" }]}><Ionicons name="camera" size={20} color="#FFF" /></View>
              <Text style={styles.sourceTxt}>Foto singola</Text>
            </Pressable>
            <Pressable onPress={addFromGallery} style={styles.sourceBtn} testID="scanner-gallery">
              <View style={[styles.sourceIcon, { backgroundColor: "#0891B2" }]}><Ionicons name="images" size={20} color="#FFF" /></View>
              <Text style={styles.sourceTxt}>Galleria</Text>
            </Pressable>
            <Pressable onPress={addFromPdf} style={styles.sourceBtn} testID="scanner-pdf">
              <View style={[styles.sourceIcon, { backgroundColor: "#7C3AED" }]}><Ionicons name="document" size={20} color="#FFF" /></View>
              <Text style={styles.sourceTxt}>PDF / File</Text>
            </Pressable>
          </View>

          {/* Enhancement toggles */}
          <View style={styles.togglesRow}>
            <ToggleChip label="Autocrop" active={autocrop} onToggle={() => setAutocrop((v) => !v)} testID="tg-autocrop" />
            <ToggleChip label="Migliora" active={enhance} onToggle={() => setEnhance((v) => !v)} testID="tg-enhance" />
            <ToggleChip label="B/N" active={grayscale} onToggle={() => setGrayscale((v) => !v)} testID="tg-bw" />
          </View>

          {/* Pages preview */}
          <ScrollView style={{ maxHeight: keyboardOpen ? 120 : 300 }} contentContainerStyle={{ padding: 12, gap: 8 }} keyboardShouldPersistTaps="handled">
            {pages.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="scan" size={36} color={theme.color.muted} />
                <Text style={styles.emptyTxt}>Nessuna pagina · usa Fotocamera / Galleria / PDF</Text>
              </View>
            ) : pages.map((p, i) => (
              <View key={i} style={styles.pageRow} testID={`scanner-page-${i}`}>
                <View style={styles.pageBadge}><Text style={styles.pageBadgeTxt}>{i + 1}</Text></View>
                {p.preview_uri === "pdf" ? (
                  <View style={[styles.thumb, styles.thumbPdf]}>
                    <Ionicons name="document" size={22} color="#DC2626" />
                    <Text style={styles.thumbPdfTxt}>PDF</Text>
                  </View>
                ) : (
                  <Image source={{ uri: p.preview_uri }} style={styles.thumb} resizeMode="cover" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.pageMeta} numberOfLines={1}>
                    {p.mime.startsWith("image/") ? "Immagine" : p.mime === "application/pdf" ? "PDF" : p.mime}
                  </Text>
                </View>
                {p.mime.startsWith("image/") && (
                  <Pressable onPress={() => setCropIdx(i)} style={styles.iconBtn} testID={`scanner-page-crop-${i}`}><Ionicons name="crop" size={17} color="#FF6B35" /></Pressable>
                )}
                <Pressable onPress={() => moveUp(i)} disabled={i === 0} style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]}><Ionicons name="chevron-up" size={18} color={theme.color.onSurface} /></Pressable>
                <Pressable onPress={() => moveDown(i)} disabled={i === pages.length - 1} style={[styles.iconBtn, i === pages.length - 1 && { opacity: 0.3 }]}><Ionicons name="chevron-down" size={18} color={theme.color.onSurface} /></Pressable>
                <Pressable onPress={() => removePage(i)} style={styles.iconBtn} testID={`scanner-page-remove-${i}`}><Ionicons name="trash-outline" size={17} color="#DC2626" /></Pressable>
              </View>
            ))}
          </ScrollView>

          {/* Name */}
          <View style={styles.nameWrap}>
            <Text style={styles.lbl}>Nome file</Text>
            <TextInput
              ref={nameInputRef}
              value={name}
              onChangeText={setName}
              placeholder="Es. Enel-Luce-Ottobre-2026"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              testID="scanner-name"
            />
            <Text style={styles.hint}>Verrà salvato come PDF in «I miei file › Scanner»{contactId ? " e nei file del cliente" : ""} (.pdf aggiunto in automatico)</Text>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: "#F1F5F9" }]}>
              <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
            </Pressable>
            <Pressable
              onPress={doSave}
              disabled={busy || pages.length === 0}
              style={[styles.btn, { backgroundColor: pages.length && !busy ? "#FF6B35" : "#94A3B8", flex: 2 }]}
              testID="scanner-save"
            >
              {busy ? (
                <>
                  <ActivityIndicator color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "800", marginLeft: 8 }}>{savingLbl || "Elaboro…"}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="save" size={17} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "800", marginLeft: 8 }}>Salva PDF ({pages.length} pag.)</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      {/* Bug 11 — Live camera in-app (modalità continua + autofocus + auto-crop); V50.z139 anche per "Foto singola" */}
      <LiveCameraScanner
        visible={liveScanOpen !== false}
        singleShot={liveScanOpen === "single"}
        onClose={() => setLiveScanOpen(false)}
        onDone={onLiveScanDone}
        enhance={enhance}
        grayscale={grayscale}
      />
      {cropIdx !== null && pages[cropIdx] && (
        <ManualCropEditor
          visible
          imageBase64={pages[cropIdx].original_base64 || pages[cropIdx].data_base64}
          enhance={enhance}
          grayscale={grayscale}
          onCancel={() => setCropIdx(null)}
          onDone={(r) => {
            setPages((prev) => prev.map((p, i) => (i === cropIdx ? {
              ...p,
              original_base64: p.original_base64 || p.data_base64,
              data_base64: r.data_base64,
              mime: r.mime,
              preview_uri: r.preview_uri,
              manual_crop: true,
            } : p)));
            setCropIdx(null);
          }}
        />
      )}
    </Modal>
  );
}

function ToggleChip({ label, active, onToggle, testID }: { label: string; active: boolean; onToggle: () => void; testID?: string }) {
  return (
    <Pressable onPress={onToggle} testID={testID} style={[styles.tgChip, active && { backgroundColor: "#FF6B35", borderColor: "#FF6B35" }]}>
      <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={14} color={active ? "#FFF" : theme.color.muted} />
      <Text style={[styles.tgChipTxt, active && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );
}

/** Smart suggestion for bill scans — used by BillsSection to prefill the filename. */
export function suggestBillScanName(billType?: "luce" | "gas" | "telco" | string, supplier?: string): string {
  const now = new Date();
  const months = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  const parts: string[] = [];
  const sup = (supplier || "").trim();
  if (sup) parts.push(sup.replace(/\s+/g, "-"));
  const typeLabel = billType === "luce" ? "Luce" : billType === "gas" ? "Gas" : billType === "telco" ? "Telco" : "Bolletta";
  parts.push(typeLabel);
  parts.push(months[now.getMonth()]);
  parts.push(String(now.getFullYear()));
  return parts.join("-");
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "94%", overflow: "hidden" },
  hdr: { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  title: { fontSize: 17, fontWeight: "800", color: "#1B2B4B" },
  sub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  sourceRow: { flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  sourceBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 10, backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: theme.color.border },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sourceTxt: { fontSize: 11, fontWeight: "700", color: "#1B2B4B" },
  togglesRow: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 12, flexWrap: "wrap" },
  tgChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: theme.color.border },
  tgChipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: theme.color.muted, fontStyle: "italic", textAlign: "center" },
  pageRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 8, borderWidth: 1, borderColor: theme.color.border },
  pageBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#FF6B35", alignItems: "center", justifyContent: "center" },
  pageBadgeTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#EEF0F4" },
  thumbPdf: { alignItems: "center", justifyContent: "center", backgroundColor: "#FEE2E2" },
  thumbPdfTxt: { fontSize: 9, color: "#DC2626", fontWeight: "800", marginTop: 2 },
  pageMeta: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  iconBtn: { padding: 6 },
  nameWrap: { padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border },
  lbl: { fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface },
  hint: { fontSize: 10, color: theme.color.muted, fontStyle: "italic", marginTop: 4 },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10 },
});

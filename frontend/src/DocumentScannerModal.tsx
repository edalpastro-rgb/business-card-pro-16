import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Image, ActivityIndicator, TextInput, Platform, Keyboard, useWindowDimensions } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { LiveCameraScanner, type LiveScannedPage } from "@/src/LiveCameraScanner";
import { isNativeScannerAvailable, scanWithNativeScanner } from "@/src/NativeDocScanner"; // V50.z246 — scanner di sistema (VisionKit / ML Kit)
import { ManualCropEditor } from "@/src/ManualCropEditor";
import { ScanPagesPreview } from "@/src/ScanPagesPreview"; // V50.z337 — anteprima piena schermata + «Scarta e rifai»
import { savePendingScan, isNetworkError, type PendingScanJob } from "@/src/scannerOffline"; // V50.z337 — ripresa automatica offline

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { KModalBody } from "@/src/ui/keyboard"; // V50.z397 — tastiera: campo attivo sempre visibile nelle Modal
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
export type ScannedPage = {
  id: string;
  data_base64: string; mime: string; preview_uri: string; original_base64?: string; manual_crop?: boolean; auto_cropped?: boolean;
  /** V50.z337 — risultato di /scanner/process-page (crop+enhance+compressione ≤500 KB+OCR) calcolato in background */
  processed_base64?: string; processed_ocr?: any | null; processed_key?: string;
};

let _pageSeq = 0;
export const newPageId = () => `pg_${Date.now().toString(36)}_${(_pageSeq++).toString(36)}`;

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
  const [previewIdx, setPreviewIdx] = useState<number | null>(null); // V50.z337 — anteprima piena schermata
  const retakeIdxRef = useRef<number | null>(null); // V50.z337 — posizione in cui reinserire la pagina rifatta
  const [progress, setProgress] = useState<number | null>(null); // V50.z337 — 0..1 durante la generazione del PDF
  const nameSyncedFor = useRef<string | null>(null);

  // V50.z337 — ELABORAZIONE IN BACKGROUND, una pagina alla volta: appena una pagina entra nella lista viene
  // inviata a /scanner/process-page (crop + enhance + compressione ≤ 500 KB + OCR). Al «Salva» resta solo
  // l'assemblaggio del PDF (≈1 s). Se cambiano i toggle, le pagine vengono rielaborate con le nuove opzioni.
  const optsKey = `${autocrop ? 1 : 0}${enhance ? 1 : 0}${grayscale ? 1 : 0}`;
  const processingRef = useRef(false);
  const aliveRef = useRef(true);
  const pagesRefForSave = useRef<ScannedPage[]>(pages);
  pagesRefForSave.current = pages;
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const processedCount = pages.filter((p) => !p.mime.startsWith("image/") || p.processed_key === optsKey).length;
  useEffect(() => {
    if (!visible || processingRef.current) return;
    const next = pages.find((p) => p.mime.startsWith("image/") && p.processed_key !== optsKey);
    if (!next) return;
    processingRef.current = true;
    const id = next.id;
    const key = optsKey;
    (async () => {
      try {
        const r = await api<{ data_base64: string; mime: string; ocr: any | null }>("/scanner/process-page", {
          method: "POST",
          body: { data_base64: next.data_base64, mime: next.mime, enhance, autocrop, grayscale, already_cropped: !!(next.manual_crop || next.auto_cropped), ocr: true },
        });
        if (aliveRef.current) setPages((prev) => prev.map((p) => (p.id === id ? { ...p, processed_base64: r.data_base64, processed_ocr: r.ocr ?? null, processed_key: key } : p)));
      } catch {
        // pagina non elaborabile in background (rete/errore): verrà elaborata dal server al momento del merge
        if (aliveRef.current) setPages((prev) => prev.map((p) => (p.id === id ? { ...p, processed_key: key, processed_base64: undefined, processed_ocr: null } : p)));
      } finally {
        processingRef.current = false;
        // il setPages sopra fa ripartire l'effetto → pagina successiva
      }
    })();
  }, [visible, pages, optsKey, enhance, autocrop, grayscale]);

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

  // V50.z246 — Scanner NATIVO di sistema (iOS VisionKit / Android ML Kit): bordi in tempo reale, HDR/autofocus/stabilizzazione
  // hardware, ritaglio + raddrizzamento istantanei. Disponibile solo nella build nativa; in Expo Go/web resta LiveCameraScanner.
  const nativeScanner = isNativeScannerAvailable();
  const [nativeBusy, setNativeBusy] = useState(false);
  // V50.z337 — Inserisce le pagine acquisite: in coda, oppure nella posizione della pagina «scartata e rifatta».
  const insertPages = useCallback((additions: ScannedPage[]) => {
    const at = retakeIdxRef.current;
    retakeIdxRef.current = null;
    setPages((prev) => {
      if (at == null || at < 0 || at > prev.length) return [...prev, ...additions];
      const q = [...prev]; q.splice(at, 0, ...additions); return q;
    });
  }, []);

  const openNativeScanner = useCallback(async (mode: "multi" | "single") => {
    setNativeBusy(true);
    try {
      const got = await scanWithNativeScanner(mode === "single" ? 1 : undefined);
      if (!got.length) { retakeIdxRef.current = null; return; }
      const additions: ScannedPage[] = got.map((p) => ({
        id: newPageId(), data_base64: p.data_base64, mime: p.mime, preview_uri: `data:${p.mime};base64,${p.data_base64}`, auto_cropped: true,
      }));
      insertPages(additions);
    } catch (e: any) {
      // Fallback: fotocamera in-app con autocrop server
      notify("Scanner di sistema non disponibile", e?.message || "Uso la fotocamera in-app.");
      setLiveScanOpen(mode);
    } finally {
      setNativeBusy(false);
    }
  }, [insertPages]);

  const addFromCamera = useCallback(() => {
    // V50.z139 — "Foto singola" usa la fotocamera in-app (expo-camera CameraView): autofocus
    // continuo, rilevamento bordi live e ritaglio automatico PRIMA di restituire l'immagine,
    // con gestione permessi robusta (niente loop "Serve l'accesso alla fotocamera").
    // Sostituisce ImagePicker.launchCameraAsync (nessun autofocus/crop, permessi in loop su Android 16).
    if (nativeScanner) { void openNativeScanner("single"); return; }
    setLiveScanOpen("single");
  }, [nativeScanner, openNativeScanner]);

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
          id: newPageId(),
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
              id: newPageId(),
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
      retakeIdxRef.current = null;
      setLiveScanOpen(false);
      return;
    }
    const additions: ScannedPage[] = livePages.map((p) => ({
      id: newPageId(),
      data_base64: p.data_base64,
      mime: p.mime || "image/jpeg",
      preview_uri: p.preview_uri || `data:${p.mime || "image/jpeg"};base64,${p.data_base64}`,
      original_base64: p.original_base64,
      manual_crop: p.manual,
      auto_cropped: p.cropped && !p.manual,
    }));
    insertPages(additions);
    setLiveScanOpen(false);
  }, [insertPages]);

  // V50.z337 — «Scarta e rifai» dall'anteprima: elimina la pagina e riapre la fotocamera (foto singola);
  // la nuova pagina viene reinserita nella stessa posizione dell'ordine.
  const retakePage = useCallback((idx: number) => {
    setPreviewIdx(null);
    setPages((p) => p.filter((_, i) => i !== idx));
    retakeIdxRef.current = idx;
    if (nativeScanner) { void openNativeScanner("single"); return; }
    setLiveScanOpen("single");
  }, [nativeScanner, openNativeScanner]);

  const deleteFromPreview = useCallback((idx: number) => {
    setPages((p) => {
      const q = p.filter((_, i) => i !== idx);
      setPreviewIdx(q.length ? Math.min(idx, q.length - 1) : null);
      return q;
    });
  }, []);

  const doSave = async () => {
    if (!pages.length) { notify("Nessuna pagina", "Aggiungi almeno una pagina."); return; }
    const finalName = (name || defaultName || "Scansione").trim() || "Scansione";
    const jobPages = () => pagesRefForSave.current.map((p) => (p.processed_base64
      ? { data_base64: p.processed_base64, mime: "image/jpeg", already_cropped: true, already_processed: true, ocr: p.processed_ocr ?? null }
      : { data_base64: p.data_base64, mime: p.mime, already_cropped: !!(p.manual_crop || p.auto_cropped), already_processed: false, ocr: null }));
    try {
      setBusy(true);
      // V50.z337 — Barra di avanzamento: attende le pagine ancora in elaborazione (una alla volta in background)
      const total = pages.length;
      let done = pagesRefForSave.current.filter((p) => !p.mime.startsWith("image/") || p.processed_key === optsKey).length;
      setProgress(done / (total + 1));
      setSavingLbl(`Elaboro pagina ${Math.min(total, done + 1)} di ${total}…`);
      const t0 = Date.now();
      while (done < total && Date.now() - t0 < 180000) {
        await new Promise((r) => setTimeout(r, 300));
        done = pagesRefForSave.current.filter((p) => !p.mime.startsWith("image/") || p.processed_key === optsKey).length;
        setProgress(done / (total + 1));
        setSavingLbl(`Elaboro pagina ${Math.min(total, done + 1)} di ${total}…`);
      }
      setProgress(total / (total + 1));
      setSavingLbl("Creo il PDF…");
      const payload = { pages: jobPages(), enhance, autocrop, grayscale, name: finalName };
      const r = await api<{ pdf_base64: string; name: string; page_count: number; ocr_text?: string; ocr_conf?: number | null; text_hash?: string | null }>("/scanner/merge-pdf", { method: "POST", body: { ...payload, ocr: true } });
      // V50.z226 — Il PDF viene salvato SUBITO, prima di qualsiasi flusso successivo (analisi, allegato…):
      // I miei file › Scanner sempre; se c'è un contatto di origine anche nei file del cliente. Mai perso se l'utente chiude.
      const fname = r.name.toLowerCase().endsWith(".pdf") ? r.name : `${r.name}.pdf`;
      const bytes = Math.floor((r.pdf_base64.length * 3) / 4);
      // V50.z246 — Duplicati per CONTENUTO (impronta del testo OCR): stesso documento già scansionato → chiedi conferma
      if (r.text_hash) {
        setSavingLbl("Controllo duplicati…");
        const dup = await api<{ duplicate: boolean; by?: string | null; file?: { name?: string; created_at?: string } | null }>(
          `/master-files/duplicate?text_hash=${encodeURIComponent(r.text_hash)}&name=${encodeURIComponent(fname)}&size=${bytes}`,
        ).catch(() => null);
        if (dup?.duplicate) {
          const when = dup.file?.created_at ? new Date(dup.file.created_at).toLocaleDateString("it-IT") : "";
          const proceed = await new Promise<boolean>((resolve) => {
            notify("Documento già presente", `Questo documento risulta già salvato come «${dup.file?.name || "file"}»${when ? ` (${when})` : ""}. Salvarlo comunque?`, [
              { text: "Annulla", style: "cancel", onPress: () => resolve(false) },
              { text: "Salva comunque", onPress: () => resolve(true) },
            ]);
          });
          if (!proceed) { setBusy(false); setSavingLbl(""); return; }
        }
      }
      setSavingLbl("Salvataggio in I miei file…");
      const saves: Promise<unknown>[] = [
        // V50.z251 — dallo scanner Fatture il PDF va in Master Files › **Fatture** (category bills), altrove in › Scanner
        api("/master-files", { method: "POST", body: { category: source === "bills" ? "bills" : "scanner", name: fname, mime: "application/pdf", data_base64: r.pdf_base64, size: bytes, source: source || (contactId ? "contact" : "widget"), source_contact_id: contactId || null, ocr_text: r.ocr_text || null, text_hash: r.text_hash || null } }),
      ];
      if (contactId) {
        saves.push(api(`/contacts/${contactId}/files`, { method: "POST", body: { name: fname, mime: "application/pdf", data_base64: r.pdf_base64, size: bytes } }));
      }
      const results = await Promise.allSettled(saves);
      const failed = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
      const tabLabel = source === "bills" ? "Fatture" : "Scanner";
      if (failed.length) {
        // V50.z251 — errore VISIBILE (es. archivio file 503 «Archivio file non disponibile, riprova»): niente fallimenti silenziosi
        const msgs = failed.map((f) => String((f.reason as any)?.message || f.reason));
        notify("Salvataggio non completato ⚠️", `${msgs.join(" · ")}\n\nIl PDF NON è stato archiviato in I miei file › ${tabLabel}. Riprova tra qualche istante.`);
      } else notify("PDF salvato ✅", contactId ? `In I miei file › ${tabLabel} e nei file del cliente` : `In I miei file › ${tabLabel}`);
      await onSaved({ pdf_base64: r.pdf_base64, name: r.name, page_count: r.page_count, mime: "application/pdf" });
      onClose();
    } catch (e: any) {
      // V50.z337 — Connessione caduta: salva il lavoro in locale e riprendi automaticamente al ritorno della rete
      if (isNetworkError(e)) {
        const job: PendingScanJob = { id: `job_${Date.now().toString(36)}`, created_at: new Date().toISOString(), name: finalName, pages: jobPages(), enhance, autocrop, grayscale, contactId: contactId || null, source: source || null };
        await savePendingScan(job);
        notify("Connessione assente 📶", `«${finalName}» è stato salvato sul dispositivo: il PDF verrà creato e archiviato automaticamente appena torna la connessione.`);
        onClose();
        return;
      }
      notify("Errore scansione", e?.message || "");
    } finally {
      setBusy(false);
      setSavingLbl("");
      setProgress(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent><KModalBody>
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
              <Ionicons name="close" size={22} color={HT.text} />
            </Pressable>
          </View>

          {/* Sources */}
          <View style={styles.sourceRow}>
            <Pressable onPress={() => (nativeScanner ? void openNativeScanner("multi") : setLiveScanOpen("multi"))} style={styles.sourceBtn} testID="scanner-live" disabled={nativeBusy}>
              <View style={[styles.sourceIcon, { backgroundColor: '#DC2626' }]}>
                {nativeBusy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="scan" size={20} color="#FFF" />}
              </View>
              <Text style={styles.sourceTxt}>{nativeScanner ? "Scanner" : "Scan continuo"}</Text>
            </Pressable>
            <Pressable onPress={addFromCamera} style={styles.sourceBtn} testID="scanner-camera">
              <View style={[styles.sourceIcon, { backgroundColor: '#FF6B35' }]}><Ionicons name="camera" size={20} color="#FFF" /></View>
              <Text style={styles.sourceTxt}>Foto singola</Text>
            </Pressable>
            <Pressable onPress={addFromGallery} style={styles.sourceBtn} testID="scanner-gallery">
              <View style={[styles.sourceIcon, { backgroundColor: '#0891B2' }]}><Ionicons name="images" size={20} color="#FFF" /></View>
              <Text style={styles.sourceTxt}>Galleria</Text>
            </Pressable>
            <Pressable onPress={addFromPdf} style={styles.sourceBtn} testID="scanner-pdf">
              <View style={[styles.sourceIcon, { backgroundColor: '#7C3AED' }]}><Ionicons name="document" size={20} color="#FFF" /></View>
              <Text style={styles.sourceTxt}>PDF / File</Text>
            </Pressable>
          </View>

          {nativeScanner ? (
            <View style={styles.nativeBadge} testID="scanner-native-badge">
              <Ionicons name="flash" size={12} color={HT.success} />
              <Text style={styles.nativeBadgeTxt}>Scanner di sistema: bordi in tempo reale, ritaglio e raddrizzamento automatici · OCR locale</Text>
            </View>
          ) : null}
          {/* Enhancement toggles */}
          <View style={styles.togglesRow}>
            <ToggleChip label="Autocrop" active={autocrop} onToggle={() => setAutocrop((v) => !v)} testID="tg-autocrop" />
            <ToggleChip label="Migliora" active={enhance} onToggle={() => setEnhance((v) => !v)} testID="tg-enhance" />
            <ToggleChip label="B/N" active={grayscale} onToggle={() => setGrayscale((v) => !v)} testID="tg-bw" />
          </View>

          {/* Pages preview */}
          <KScrollView style={{ maxHeight: keyboardOpen ? 120 : 300 }} contentContainerStyle={{ padding: 12, gap: 8 }} keyboardShouldPersistTaps="handled">
            {pages.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="scan" size={36} color={HT.muted} />
                <Text style={styles.emptyTxt}>Nessuna pagina · usa Fotocamera / Galleria / PDF</Text>
              </View>
            ) : pages.map((p, i) => (
              <View key={p.id} style={styles.pageRow} testID={`scanner-page-${i}`}>
                <View style={styles.pageBadge}><Text style={styles.pageBadgeTxt}>{i + 1}</Text></View>
                <Pressable onPress={() => setPreviewIdx(i)} testID={`scanner-page-thumb-${i}`} accessibilityLabel={`Anteprima pagina ${i + 1}`}>
                  {p.preview_uri === "pdf" ? (
                    <View style={[styles.thumb, styles.thumbPdf]}>
                      <Ionicons name="document" size={22} color="#DC2626" />
                      <Text style={styles.thumbPdfTxt}>PDF</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: p.preview_uri }} style={styles.thumb} resizeMode="cover" />
                  )}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pageMeta} numberOfLines={1}>
                    {p.mime.startsWith("image/") ? "Immagine" : p.mime === "application/pdf" ? "PDF" : p.mime}
                  </Text>
                  {p.mime.startsWith("image/") ? (
                    <Text style={[styles.pageSub, p.processed_key === optsKey && p.processed_base64 ? { color: HT.success } : null]} numberOfLines={1} testID={`scanner-page-state-${i}`}>
                      {p.processed_key === optsKey ? (p.processed_base64 ? `Pronta · ${Math.round((p.processed_base64.length * 3) / 4 / 1024)} KB` : "Da elaborare al salvataggio") : "Elaborazione in background…"}
                    </Text>
                  ) : null}
                </View>
                {p.mime.startsWith("image/") && (
                  <Pressable onPress={() => setCropIdx(i)} style={styles.iconBtn} testID={`scanner-page-crop-${i}`}><Ionicons name="crop" size={17} color="#FF6B35" /></Pressable>
                )}
                <Pressable onPress={() => moveUp(i)} disabled={i === 0} style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]}><Ionicons name="chevron-up" size={18} color={HT.text} /></Pressable>
                <Pressable onPress={() => moveDown(i)} disabled={i === pages.length - 1} style={[styles.iconBtn, i === pages.length - 1 && { opacity: 0.3 }]}><Ionicons name="chevron-down" size={18} color={HT.text} /></Pressable>
                <Pressable onPress={() => removePage(i)} style={styles.iconBtn} testID={`scanner-page-remove-${i}`}><Ionicons name="trash-outline" size={17} color="#DC2626" /></Pressable>
              </View>
            ))}
          </KScrollView>

          {/* Name */}
          <View style={styles.nameWrap}>
            <Text style={styles.lbl}>Nome file</Text>
            <TextInput
              ref={nameInputRef}
              value={name}
              onChangeText={setName}
              placeholder="Es. Enel-Luce-Ottobre-2026"
              placeholderTextColor={HT.muted}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              testID="scanner-name"
            />
            <Text style={styles.hint}>Verrà salvato come PDF in «I miei file › Scanner»{contactId ? " e nei file del cliente" : ""} (.pdf aggiunto in automatico)</Text>
          </View>

          {/* Footer */}
          {busy && progress !== null ? (
            <View style={styles.progressWrap} testID="scanner-progress">
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(Math.max(0.04, Math.min(1, progress)) * 100)}%` }]} /></View>
              <Text style={styles.progressTxt}>{savingLbl || "Elaboro…"} · {Math.round(progress * 100)}%</Text>
            </View>
          ) : pages.length > 0 && processedCount < pages.length ? (
            <Text style={styles.bgHint} testID="scanner-bg-hint">Elaboro in background {processedCount}/{pages.length} pagine · puoi continuare ad acquisire</Text>
          ) : null}
          <View style={styles.footer}>
            <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: HT.card2 }]}>
              <Text style={{ color: HT.text, fontWeight: "700" }}>Annulla</Text>
            </Pressable>
            <Pressable
              onPress={doSave}
              disabled={busy || pages.length === 0}
              style={[styles.btn, { backgroundColor: pages.length && !busy ? "#FF6B35" : HT.muted, flex: 2 }]}
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
              processed_key: undefined, processed_base64: undefined, processed_ocr: null, // V50.z337 — rielabora dopo il ritaglio
            } : p)));
            setCropIdx(null);
          }}
        />
      )}
      {/* V50.z337 — Anteprima piena schermata con swipe + «Scarta e rifai» */}
      {previewIdx !== null && pages.length > 0 && (
        <ScanPagesPreview
          pages={pages}
          index={Math.min(previewIdx, pages.length - 1)}
          onClose={() => setPreviewIdx(null)}
          onRetake={retakePage}
          onDelete={deleteFromPreview}
        />
      )}
    </KModalBody></Modal>
  );
}

function ToggleChip({ label, active, onToggle, testID }: { label: string; active: boolean; onToggle: () => void; testID?: string }) {
  return (
    <Pressable onPress={onToggle} testID={testID} style={[styles.tgChip, active && { backgroundColor: '#FF6B35', borderColor: '#FF6B35' }]}>
      <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={14} color={active ? "#FFF" : HT.muted} />
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
  nativeBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 12, marginTop: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: HT.successTint },
  nativeBadgeTxt: { flex: 1, fontSize: 11, fontWeight: "700", color: HT.success },

  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "94%", overflow: "hidden" },
  hdr: { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1, borderBottomColor: HT.border },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  sourceRow: { flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  sourceBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 10, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sourceTxt: { fontSize: 11, fontWeight: "700", color: HT.text },
  togglesRow: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 12, flexWrap: "wrap" },
  tgChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1.5, borderColor: HT.border },
  tgChipTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: HT.muted, fontStyle: "italic", textAlign: "center" },
  pageRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.card2, borderRadius: 12, padding: 8, borderWidth: 1, borderColor: HT.border },
  pageBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF6B35', alignItems: "center", justifyContent: "center" },
  pageBadgeTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: HT.border },
  thumbPdf: { alignItems: "center", justifyContent: "center", backgroundColor: HT.dangerTint },
  thumbPdfTxt: { fontSize: 9, color: "#DC2626", fontWeight: "800", marginTop: 2 },
  pageMeta: { fontSize: 12, fontWeight: "700", color: HT.text },
  pageSub: { fontSize: 10.5, color: HT.muted, marginTop: 2 },
  progressWrap: { paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: HT.border, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: "#FF6B35" },
  progressTxt: { fontSize: 11.5, fontWeight: "700", color: HT.text2, textAlign: "center" },
  bgHint: { fontSize: 11, color: HT.muted, textAlign: "center", paddingTop: 8, paddingHorizontal: 12, fontStyle: "italic" },
  iconBtn: { padding: 6 },
  nameWrap: { padding: 12, borderTopWidth: 1, borderTopColor: HT.border },
  lbl: { fontSize: 11, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  input: { backgroundColor: HT.card2, borderRadius: 10, padding: 12, fontSize: 14, color: HT.text },
  hint: { fontSize: 10, color: HT.muted, fontStyle: "italic", marginTop: 4 },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: HT.border },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10 },
});

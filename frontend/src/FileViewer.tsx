import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform, ActivityIndicator, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { CalculatorFAB } from "@/src/CalculatorFAB";
import { api } from "@/src/api";
import { PdfPagesZoom } from "@/src/PdfPagesZoom";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Props = {
  visible: boolean;
  fileName: string;
  mime: string;
  dataBase64: string;
  onClose: () => void;
  onShare?: () => void;
};

/**
 * V38S — Universal in-app file viewer.
 *
 * PDF is rendered via a self-contained **PDF.js** page (loaded from CDN inside
 * an iframe/WebView) so it stays inside the app on Android/mobile Chrome
 * (which normally hijack `application/pdf` responses into the OS Downloads).
 * Because PDF.js runs entirely client-side, this works even without network
 * once the CDN bundle is cached.
 *
 * HTML → rendered via srcDoc (web) / html source (native).
 * Images → <img> (web) / expo Image (native).
 *
 * The Calculator FAB is embedded so the user can compute while reading the
 * PDF / analysis without leaving the viewer.
 */
export function FileViewer({ visible, fileName, mime, dataBase64, onClose, onShare }: Props) {
  const insets = useSafeAreaInsets(); // V50.z251 — header sotto la status bar/notch (prima paddingTop fisso → titolo sopra i bottoni)
  const { width: winW, height: winH } = useWindowDimensions();
  const isPdf = mime.toLowerCase().includes("pdf");
  const isImg = mime.toLowerCase().startsWith("image/");
  const isHtml = mime.toLowerCase().includes("html");
  const dataUri = useMemo(() => `data:${mime};base64,${dataBase64}`, [mime, dataBase64]);

  /**
   * V50.z56 — Web: convert base64 → Blob URL for PDFs and large files.
   * Reasons:
   *   1. `<iframe srcDoc>` (previous approach) required loading pdf.js from
   *      the CDN with `about:srcdoc` origin — blocked by many CSPs, adblock,
   *      corporate proxies → resulted in a BLACK SCREEN.
   *   2. `data:application/pdf;base64,...` URIs are limited to ~2MB in Chrome
   *      and are slower to parse.
   *   3. A Blob URL served by the browser (`blob:https://...`) is opened by
   *      the built-in Chrome/Firefox/Safari PDF viewer natively — no external
   *      dependency, no CDN, no black screen, full controls (zoom, page, search).
   */
  const [webBlobUrl, setWebBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!visible || !dataBase64) {
      setWebBlobUrl(null);
      return;
    }
    let revokedUrl: string | null = null;
    try {
      const bin = (globalThis as any).atob(dataBase64) as string;
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
      revokedUrl = URL.createObjectURL(blob);
      setWebBlobUrl(revokedUrl);
    } catch {
      // Fallback su dataUri se atob fallisce (browser esotico)
      setWebBlobUrl(null);
    }
    return () => {
      if (revokedUrl) {
        try { URL.revokeObjectURL(revokedUrl); } catch { /* ignore */ }
      }
    };
  }, [visible, dataBase64, mime]);

  /**
   * V38Z' — Decode a base64-encoded HTML payload as **UTF-8**.
   *
   * Previous impl used plain `atob(dataBase64)` which returns a binary string
   * where every byte is treated as Latin-1 — this corrupts multi-byte UTF-8
   * characters (emojis, accented chars, non-Latin scripts). We now:
   *   1. atob → binary string of bytes
   *   2. Convert to Uint8Array (byte-by-byte)
   *   3. TextDecoder("utf-8") → proper Unicode string
   *
   * Falls back gracefully to legacy behaviour if TextDecoder or atob are
   * missing (e.g. exotic runtime).
   */
  const htmlDecoded = useMemo(() => {
    if (!isHtml || !dataBase64) return "";
    try {
      const g = globalThis as unknown as { atob?: (s: string) => string; TextDecoder?: typeof TextDecoder };
      if (!g.atob) return "";
      const bin = g.atob(dataBase64);
      if (typeof g.TextDecoder === "function") {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
        return new g.TextDecoder("utf-8").decode(bytes);
      }
      // Legacy fallback: percent-decode trick (handles UTF-8 without TextDecoder)
      try {
        return decodeURIComponent(
          Array.prototype.map
            .call(bin, (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        );
      } catch {
        return bin;
      }
    } catch {
      return "";
    }
  }, [isHtml, dataBase64]);

  /**
   * V50.z251 — Nativo: PDF renderizzato come immagini dal backend (PyMuPDF, `POST /files/pdf-pages`).
   * Prima: WebView + pdf.js da cdnjs → SCHERMO NERO quando il CDN è irraggiungibile/bloccato. Zero dipendenze esterne.
   */
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [pdfTotal, setPdfTotal] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const pdfLoadingRef = useRef(false);
  const loadPages = async (start: number) => {
    if (pdfLoadingRef.current) return;
    pdfLoadingRef.current = true;
    setPdfBusy(true); setPdfErr(null);
    try {
      const r = await api<{ pages: string[]; total: number; start: number }>("/files/pdf-pages", { method: "POST", body: { pdf_base64: dataBase64, start, max_pages: 8, dpi: 110 } });
      setPdfTotal(r.total);
      setPdfPages((prev) => (start === 0 ? r.pages : [...prev, ...r.pages]));
    } catch (e: any) {
      setPdfErr(e?.message || "Impossibile aprire il PDF");
    } finally { setPdfBusy(false); pdfLoadingRef.current = false; }
  };
  // V50.z283 — pagine ad alta risoluzione (200 dpi) per lo zoom: testo piccolo leggibile
  const fetchHiRes = useCallback(async (start: number, count: number) => {
    const r = await api<{ pages: string[] }>("/files/pdf-pages", { method: "POST", body: { pdf_base64: dataBase64, start, max_pages: count, dpi: 200 } });
    return r.pages;
  }, [dataBase64]);
  useEffect(() => {
    if (Platform.OS === "web" || !visible || !isPdf) return;
    setPdfPages([]); setPdfTotal(0);
    if (!dataBase64) { setPdfErr("Documento vuoto: il PDF non contiene dati."); return; }
    void loadPages(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isPdf, dataBase64]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
          <Pressable onPress={onClose} hitSlop={8} testID="fileviewer-close">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
          {/* V50.z56 — Web: pulsanti "Apri in nuova scheda" + "Scarica" per
              garantire fallback nel raro caso in cui il browser non abbia un
              PDF viewer built-in (Chromium headless, mobile Safari old). */}
          {Platform.OS === "web" && isPdf && webBlobUrl ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                testID="fileviewer-open-tab"
                hitSlop={8}
                onPress={() => {
                  try { (globalThis as any).open?.(webBlobUrl, "_blank"); } catch { /* ignore */ }
                }}
              >
                <Ionicons name="open-outline" size={22} color="#FFF" />
              </Pressable>
              <Pressable
                testID="fileviewer-download"
                hitSlop={8}
                onPress={() => {
                  try {
                    const a = (globalThis as any).document?.createElement?.("a");
                    if (a) { a.href = webBlobUrl; a.download = fileName || "documento.pdf"; a.click(); }
                  } catch { /* ignore */ }
                }}
              >
                <Ionicons name="download-outline" size={22} color="#FFF" />
              </Pressable>
              {onShare ? (
                <Pressable onPress={onShare} hitSlop={8} testID="fileviewer-share">
                  <Ionicons name="share-social" size={22} color="#FFF" />
                </Pressable>
              ) : null}
            </View>
          ) : onShare ? (
            <Pressable onPress={onShare} hitSlop={8} testID="fileviewer-share">
              <Ionicons name="share-social" size={22} color="#FFF" />
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        <View style={styles.body}>
          {!dataBase64 ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#FFF" />
              <Text style={styles.loadingTxt}>Caricamento…</Text>
            </View>
          ) : Platform.OS === "web" ? (
            isImg ? (
              // @ts-expect-error web only
              <img src={webBlobUrl || dataUri} alt={fileName} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : isPdf ? (
              // V50.z56 — Web: usa il viewer PDF nativo del browser (Chrome/Firefox/Safari).
              // Zero dipendenze CDN → niente "schermo nero" quando pdf.js è bloccato.
              webBlobUrl ? (
                // @ts-expect-error web only
                <iframe src={webBlobUrl} title={fileName} style={{ width: "100%", height: "100%", border: "none", backgroundColor: HT.card }} />
              ) : (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color="#FFF" />
                  <Text style={styles.loadingTxt}>Preparazione documento…</Text>
                </View>
              )
            ) : isHtml ? (
              // @ts-expect-error web only
              <iframe srcDoc={htmlDecoded} title={fileName} style={{ width: "100%", height: "100%", border: "none", backgroundColor: HT.card }} />
            ) : (
              <UnsupportedType />
            )
          ) : isImg ? (
            <WebView
              source={{ uri: dataUri }}
              style={{ flex: 1, backgroundColor: '#111' }}
              originWhitelist={["*"]}
              scalesPageToFit
            />
          ) : isPdf ? (
            pdfErr ? (
              <View style={styles.loading} testID="fileviewer-pdf-error">
                <Ionicons name="alert-circle" size={40} color="#FCA5A5" />
                <Text style={styles.loadingTxt}>{pdfErr}</Text>
                <Pressable onPress={() => loadPages(0)} style={styles.retryBtn} testID="fileviewer-pdf-retry"><Text style={styles.retryTxt}>Riprova</Text></Pressable>
              </View>
            ) : (
              <PdfPagesZoom
                pages={pdfPages}
                total={pdfTotal}
                busy={pdfBusy}
                winW={winW}
                winH={winH}
                onLoadMore={() => void loadPages(pdfPages.length)}
                fetchHiRes={fetchHiRes}
              />
            )
          ) : isHtml ? (
            <WebView
              source={{ html: htmlDecoded }}
              style={{ flex: 1, backgroundColor: HT.card }}
              originWhitelist={["*"]}
              javaScriptEnabled
            />
          ) : (
            <UnsupportedType />
          )}
        </View>
        {/* V38R/S — Calculator accessible while viewing the PDF / analysis */}
        {visible ? <CalculatorFAB /> : null}
      </View>
    </Modal>
  );
}

function UnsupportedType() {
  return (
    <View style={styles.loading}>
      <Ionicons name="document-outline" size={40} color="#FFF" />
      <Text style={styles.loadingTxt}>Tipo di file non visualizzabile in-app.{"\n"}Usa «Condividi» per aprirlo altrove.</Text>
    </View>
  );
}

function escape(s: string): string {
  return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  retryBtn: { alignSelf: "center", marginTop: 12, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 999, paddingHorizontal: 18, minHeight: 40, justifyContent: "center" },
  retryTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12, // V50.z251 — sovrascritto inline con useSafeAreaInsets().top
    paddingBottom: 10,
    backgroundColor: HT.brand,
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, marginHorizontal: 12, textAlign: "center" },
  body: { flex: 1, backgroundColor: '#111', justifyContent: "center", alignItems: "center" },
  loading: { justifyContent: "center", alignItems: "center", gap: 10 },
  loadingTxt: { color: "#FFF", fontSize: 13, textAlign: "center" },
});

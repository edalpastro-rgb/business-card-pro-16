import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { WebView } from "react-native-webview";
import { CalculatorFAB } from "@/src/CalculatorFAB";

type Props = {
  visible: boolean;
  fileName: string;
  mime: string;
  dataBase64: string;
  onClose: () => void;
  onShare?: () => void;
};

/**
 * Inline file viewer. Renders PDF and image files inside the app.
 *
 * V38R (June 2026):
 *  - Web: for PDFs, decode base64 → Blob → object URL and render via <iframe>.
 *    This avoids the browser "Download / Open in" dialog that some browsers
 *    show for data-URI PDFs above ~2MB.
 *  - HTML documents are rendered via Blob URL too (large HTML fails with data:).
 *  - Calculator FAB embedded so the user can compute while reading the PDF /
 *    analysis without leaving the viewer.
 */
export function FileViewer({ visible, fileName, mime, dataBase64, onClose, onShare }: Props) {
  const isPdf = mime.toLowerCase().includes("pdf");
  const isImg = mime.toLowerCase().startsWith("image/");
  const isHtml = mime.toLowerCase().includes("html");

  // Build a blob URL on web for PDFs and HTML — avoids the "download" dialog
  // triggered by iframe src=data:application/pdf for larger documents.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!visible || !dataBase64) { setBlobUrl(null); return; }
    if (!isPdf && !isHtml) { setBlobUrl(null); return; }
    try {
      const bin = (globalThis as any).atob(dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: isPdf ? "application/pdf" : "text/html" });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => { try { URL.revokeObjectURL(url); } catch {} };
    } catch (e) {
      console.warn("FileViewer blob err", e);
      setBlobUrl(null);
    }
  }, [visible, dataBase64, isPdf, isHtml]);

  const dataUri = useMemo(() => `data:${mime};base64,${dataBase64}`, [mime, dataBase64]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} testID="fileviewer-close">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
          {onShare ? (
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
              <img src={dataUri} alt={fileName} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (isPdf || isHtml) ? (
              blobUrl ? (
                // @ts-expect-error web only
                <iframe src={blobUrl} title={fileName} style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#FFF" }} />
              ) : (
                <View style={styles.loading}><ActivityIndicator size="large" color="#FFF" /></View>
              )
            ) : (
              <UnsupportedType />
            )
          ) : isImg ? (
            <WebView
              source={{ uri: dataUri }}
              style={{ flex: 1, backgroundColor: "#111" }}
              originWhitelist={["*"]}
              scalesPageToFit
            />
          ) : isPdf ? (
            <WebView
              source={{ uri: dataUri }}
              style={{ flex: 1, backgroundColor: "#111" }}
              originWhitelist={["*"]}
              onError={() => {}}
            />
          ) : isHtml ? (
            <WebView
              source={{ html: (globalThis as any).atob ? (globalThis as any).atob(dataBase64) : "" }}
              style={{ flex: 1, backgroundColor: "#FFF" }}
              originWhitelist={["*"]}
            />
          ) : (
            <UnsupportedType />
          )}
        </View>
        {/* V38R — Calculator accessible while viewing the PDF / analysis */}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 44 : 12,
    paddingBottom: 10,
    backgroundColor: theme.color.brandPrimary,
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, marginHorizontal: 12, textAlign: "center" },
  body: { flex: 1, backgroundColor: "#111", justifyContent: "center", alignItems: "center" },
  loading: { justifyContent: "center", alignItems: "center", gap: 10 },
  loadingTxt: { color: "#FFF", fontSize: 13, textAlign: "center" },
});

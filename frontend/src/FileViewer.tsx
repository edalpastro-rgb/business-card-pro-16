import React from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { WebView } from "react-native-webview";

type Props = {
  visible: boolean;
  fileName: string;
  mime: string;
  dataBase64: string;
  onClose: () => void;
};

/**
 * Inline file viewer. Renders PDF and image files inside the app.
 * On web uses an <iframe> with data URI (or <img> for images).
 * On native uses <WebView> pointing at a data URI (works for PDF on iOS, images anywhere).
 */
export function FileViewer({ visible, fileName, mime, dataBase64, onClose }: Props) {
  const dataUri = React.useMemo(() => `data:${mime};base64,${dataBase64}`, [mime, dataBase64]);
  const isPdf = mime.toLowerCase().includes("pdf");
  const isImg = mime.toLowerCase().startsWith("image/");
  const isHtml = mime.toLowerCase().includes("html");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} testID="fileviewer-close">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
          <View style={{ width: 24 }} />
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
            ) : isHtml || isPdf ? (
              // @ts-expect-error web only
              <iframe src={dataUri} title={fileName} style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#FFF" }} />
            ) : (
              <UnsupportedType />
            )
          ) : isImg ? (
            // On native for images we can also use expo-image / Image
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
      </View>
    </Modal>
  );
}

function UnsupportedType() {
  return (
    <View style={styles.loading}>
      <Ionicons name="document-outline" size={40} color="#FFF" />
      <Text style={styles.loadingTxt}>Tipo di file non visualizzabile in-app.{"\n"}Usa "Condividi" per aprirlo altrove.</Text>
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

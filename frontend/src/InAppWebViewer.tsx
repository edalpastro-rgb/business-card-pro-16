import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

/**
 * V50.z74 — Componente riutilizzabile che apre un URL in WebView interna all'app
 * (o iframe su Expo Web). Header nero con back, titolo e apertura esterna opzionale.
 *
 * Usage:
 *   const [wv, setWv] = useState<{title:string;url:string}|null>(null);
 *   <Modal visible={!!wv} animationType="slide" onRequestClose={() => setWv(null)}>
 *     {wv && <InAppWebViewer title={wv.title} url={wv.url} onClose={() => setWv(null)} />}
 *   </Modal>
 */
export function InAppWebViewer({
  title,
  url,
  onClose,
}: {
  title: string;
  url: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const openExternal = () => {
    Linking.openURL(url).catch(() => Alert.alert("Errore", "Impossibile aprire il link nel browser"));
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={8} testID="inapp-webview-close">
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title || "Link"}</Text>
        <Pressable onPress={openExternal} hitSlop={8} testID="inapp-webview-external">
          <Ionicons name="open-outline" size={22} color="#FFF" />
        </Pressable>
      </View>
      <View style={{ flex: 1, backgroundColor: "#FFF" }}>
        {Platform.OS === "web" ? (
          // @ts-expect-error web only
          <iframe src={url} title={title} style={{ width: "100%", height: "100%", border: "none" }} />
        ) : (
          <WebView
            source={{ uri: url }}
            style={{ flex: 1 }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(e: any) => {
              setLoading(false);
              setErrMsg(e?.nativeEvent?.description || "Impossibile caricare la pagina");
            }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            originWhitelist={["*"]}
          />
        )}
        {loading && Platform.OS !== "web" ? (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color="#0EA5E9" />
          </View>
        ) : null}
        {errMsg ? (
          <View style={styles.errBox}>
            <Ionicons name="warning" size={22} color="#DC2626" />
            <Text style={styles.errTxt}>{errMsg}</Text>
            <Pressable onPress={openExternal} style={styles.errBtn}>
              <Text style={styles.errBtnTxt}>Apri nel browser</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 44 : 12,
    paddingBottom: 10,
    backgroundColor: "#0F172A",
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, marginHorizontal: 12, textAlign: "center" },
  loader: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)" },
  errBox: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, backgroundColor: "#FFF" },
  errTxt: { color: "#DC2626", fontSize: 13, textAlign: "center" },
  errBtn: { backgroundColor: "#0EA5E9", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  errBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

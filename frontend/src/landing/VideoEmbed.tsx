// VideoEmbed.tsx — V50.z547 — Video Vimeo/YouTube delle pagine landing (link dal CMS). Vuoto → placeholder «sarà inserito il link».
// Web: <iframe> del player (dnt=1 / nocookie). Nativo: WebView. Il link si incolla così com'è (vimeo.com/ID, youtu.be/ID…): toEmbedUrl lo converte.
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { LP } from "@/src/landing/palette";

export function toEmbedUrl(raw?: string): string {
  const u = (raw || "").trim();
  if (!u) return "";
  let m = u.match(/player\.vimeo\.com\/video\/\d+/) ? [u] : null;
  if (m) return u;
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?/);
  if (m) return `https://player.vimeo.com/video/${m[1]}?dnt=1${m[2] ? `&h=${m[2]}` : ""}`;
  if (/youtube(-nocookie)?\.com\/embed\//.test(u)) return u;
  m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/))([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  return u;
}

export function VideoEmbed({ url, label, accent, line, maxWidth = 820, testID }: { url?: string; label?: string; accent: string; line: string; maxWidth?: number; testID?: string }) {
  const src = toEmbedUrl(url);
  if (!src) {
    if (!label) return null;
    return (
      <View style={[v.box, v.placeholder, { borderColor: line, maxWidth }]} testID={testID}>
        <Ionicons name="play-circle" size={48} color={accent} />
        <Text style={v.lbl}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={[v.box, { borderColor: line, maxWidth, borderStyle: "solid" }]} testID={testID}>
      {Platform.OS === "web"
        ? React.createElement("iframe", { src, title: label || "Video", allow: "autoplay; fullscreen; picture-in-picture", allowFullScreen: true, loading: "lazy", style: { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, borderRadius: 16 } })
        : <WebView source={{ uri: src }} style={StyleSheet.absoluteFill} allowsFullscreenVideo allowsInlineMediaPlayback mediaPlaybackRequiresUserAction />}
    </View>
  );
}

const v = StyleSheet.create({
  box: { width: "100%", aspectRatio: 16 / 9, borderRadius: 16, borderWidth: 1, backgroundColor: LP.surfaceInk, overflow: "hidden", alignSelf: "center", marginTop: 10 },
  placeholder: { borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 8 },
  lbl: { color: LP.muted, fontSize: 13, fontWeight: "700", textAlign: "center", paddingHorizontal: 16 },
});

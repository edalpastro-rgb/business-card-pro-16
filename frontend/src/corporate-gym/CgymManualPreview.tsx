// CgymManualPreview.tsx — V50.z204 — Anteprima manuali DENTRO l'app (niente browser esterno):
// immagini → viewer nativo con zoom (ScrollView), PDF/Docs → InAppWebViewer (WebView nativa / iframe web; Android usa il viewer Google).
import React from "react";
import { View, Text, StyleSheet, Modal, Pressable, Image, ScrollView, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/src/theme";
import { InAppWebViewer } from "@/src/InAppWebViewer";
import { CgymManualLink, downloadManual } from "@/src/corporate-gym/manualsApi";
import { notify } from "@/src/utils/notify";

export function manualViewerUrl(link: CgymManualLink): string {
  const isPdf = (link.mime || "").includes("pdf") || link.exportable;
  if (Platform.OS === "android" && isPdf) return `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(link.url)}`;
  return link.url;
}

export function CgymManualPreview({ link, onClose }: { link: CgymManualLink | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = React.useState(false);
  const [imgLoading, setImgLoading] = React.useState(true);
  const isImage = !!link && (link.mime || "").startsWith("image/");
  const dl = async () => { if (!link) return; setBusy(true); try { await downloadManual(link); } catch (e: any) { notify("Download", e?.message || "Non riuscito"); } finally { setBusy(false); } };
  return (
    <Modal visible={!!link} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.root, { paddingTop: insets.top }]} testID="cgym-manual-preview">
        {link && isImage ? (
          <>
            <View style={styles.head}>
              <Pressable onPress={onClose} hitSlop={10} testID="cgym-manual-preview-close"><Ionicons name="close" size={24} color="#FFF" /></Pressable>
              <Text style={styles.title} numberOfLines={1}>{link.name}</Text>
              <Pressable onPress={dl} hitSlop={10} disabled={busy} testID="cgym-manual-preview-download">{busy ? <ActivityIndicator color="#FFF" /> : <Ionicons name="download-outline" size={22} color="#FFF" />}</Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.imgWrap} maximumZoomScale={4} minimumZoomScale={1} centerContent>
              {imgLoading && <ActivityIndicator color="#FFF" style={{ position: "absolute", top: "45%", alignSelf: "center" }} />}
              <Image source={{ uri: link.url }} style={styles.img} resizeMode="contain" onLoadEnd={() => setImgLoading(false)} />
            </ScrollView>
            <Text style={[styles.hint, { paddingBottom: insets.bottom + 8 }]}>Pizzica per ingrandire · Scarica per condividere</Text>
          </>
        ) : link ? (
          <InAppWebViewer title={link.name} url={manualViewerUrl(link)} onClose={onClose} />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B1220" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  title: { flex: 1, color: "#FFF", fontWeight: "800", fontSize: 15 },
  imgWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 8 },
  img: { width: "100%", height: 600, maxHeight: "100%" as any },
  hint: { color: theme.color.muted, fontSize: 11.5, textAlign: "center", paddingTop: 8 },
});

/**
 * V28.w — Google Drive file picker modal per la chat Axon.
 * Lista i file autorizzati (scope drive.file) e permette di sceglierne uno
 * come attachment (viene scaricato via backend e passato come base64 come i file locali).
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView, ActivityIndicator, Image, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  iconLink?: string;
};

function mimeIcon(mime?: string): { name: any; color: string } {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return { name: "document", color: "#DC2626" };
  if (m.includes("spreadsheet") || m.includes("excel")) return { name: "grid", color: "#059669" };
  if (m.includes("presentation")) return { name: "easel", color: "#EA580C" };
  if (m.includes("document") || m.includes("word")) return { name: "document-text", color: "#2563EB" };
  if (m.startsWith("image/")) return { name: "image", color: "#7C3AED" };
  if (m === "application/vnd.google-apps.folder") return { name: "folder", color: "#F59E0B" };
  return { name: "document-outline", color: "#94A3B8" };
}

export function GoogleDrivePickerModal({
  visible,
  onClose,
  onFilePicked,
}: {
  visible: boolean;
  onClose: () => void;
  onFilePicked: (info: { name: string; mime: string; data_base64: string }) => void;
}) {
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; google_email?: string }>({ connected: false, configured: false });
  const bottomPad = useBottomSheetPadding();
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [q, setQ] = useState("");
  const [searchTick, setSearchTick] = useState(0);
  const safeBottom = useSafeBottom(); // V29.aq
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api<any>("/google-drive/status");
      setStatus(r || { connected: false, configured: false });
    } catch { /* silent */ }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const url = q.trim() ? `/google-drive/files?search=${encodeURIComponent(q.trim())}` : "/google-drive/files";
      const r = await api<{ files?: DriveFile[] }>(url);
      setFiles(Array.isArray(r?.files) ? r.files : []);
    } catch (e: any) {
      // Silent fail se non connesso
      setFiles([]);
    } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      await loadStatus();
    })();
  }, [visible, loadStatus]);

  useEffect(() => {
    if (!visible || !status.connected) return;
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, status.connected, searchTick]);

  const pickFile = async (f: DriveFile) => {
    try {
      setDownloading(f.id);
      const info = await api<{ name: string; mime: string; data_base64: string; size: number }>(`/google-drive/files/${f.id}/content`);
      if (!info?.data_base64) throw new Error("File vuoto");
      onFilePicked({ name: info.name, mime: info.mime, data_base64: info.data_base64 });
      onClose();
    } catch (e: any) {
      notify("Errore download Drive", e?.message || String(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: safeBottom + 12 }, { paddingBottom: bottomPad }]}>
          <View style={styles.hdr}>
            <View style={styles.badge}><Ionicons name="logo-google" size={16} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Google Drive</Text>
              {status.connected && status.google_email ? (
                <Text style={styles.sub}>{status.google_email}</Text>
              ) : (
                <Text style={styles.sub}>Fonte file cloud per Axon</Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
          </View>

          {!status.configured ? (
            <View style={styles.empty}>
              <Ionicons name="warning" size={30} color="#F59E0B" />
              <Text style={styles.emptyTxt}>Google Drive non configurato lato server.</Text>
            </View>
          ) : !status.connected ? (
            <View style={styles.empty}>
              <Ionicons name="link-outline" size={30} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>Google Drive non collegato. Vai in Impostazioni → Google Drive per collegarlo.</Text>
            </View>
          ) : (
            <>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color="#94A3B8" />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  onSubmitEditing={() => setSearchTick((t) => t + 1)}
                  placeholder="Cerca nei file autorizzati…"
                  placeholderTextColor="#94A3B8"
                  style={styles.searchInput}
                  autoCapitalize="none"
                />
                {q ? (
                  <Pressable onPress={() => { setQ(""); setSearchTick((t) => t + 1); }} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color="#94A3B8" />
                  </Pressable>
                ) : null}
              </View>

              {loading ? (
                <ActivityIndicator color="#0F9D58" style={{ marginTop: 20 }} />
              ) : files.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="cloud-outline" size={30} color={theme.color.muted} />
                  <Text style={styles.emptyTxt}>Nessun file trovato tra quelli autorizzati.{"\n"}Google Drive con scope drive.file mostra solo i file che hai esplicitamente autorizzato.</Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
                  {files.map((f) => {
                    const icon = mimeIcon(f.mimeType);
                    const isDownloading = downloading === f.id;
                    return (
                      <Pressable
                        key={f.id}
                        testID={`gd-file-${f.id}`}
                        onPress={() => !downloading && pickFile(f)}
                        disabled={!!downloading}
                        style={[styles.row, isDownloading && { opacity: 0.6 }]}
                      >
                        {f.iconLink && Platform.OS === "web" ? (
                          <Image source={{ uri: f.iconLink }} style={styles.icon16} />
                        ) : (
                          <Ionicons name={icon.name} size={22} color={icon.color} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowName} numberOfLines={1}>{f.name}</Text>
                          <Text style={styles.rowMeta}>
                            {(f.mimeType || "").split(/[./]/).slice(-1)[0] || "file"}
                            {f.size ? ` · ${Math.round(Number(f.size) / 1024)} KB` : ""}
                          </Text>
                        </View>
                        {isDownloading ? <ActivityIndicator color="#0F9D58" /> : <Ionicons name="download-outline" size={18} color={theme.color.brandPrimary} />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "80%" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  badge: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#0F9D58", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F1F5F9", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: theme.color.onSurface, padding: 0 },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: theme.color.muted, textAlign: "center", fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  icon16: { width: 22, height: 22 },
  rowName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowMeta: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },
});

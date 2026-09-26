/**
 * V49.i — Dropbox file picker modal per la chat Axon.
 * Naviga cartelle di Dropbox e scarica il file selezionato via backend
 * come base64 così Axon può leggerlo come un allegato locale.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Ionicons } from "@expo/vector-icons";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type DbxEntry = {
  ".tag"?: string;
  id?: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  server_modified?: string;
};

function mimeIcon(name?: string): { name: any; color: string } {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return { name: "document", color: "#DC2626" };
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return { name: "grid", color: "#059669" };
  if (n.endsWith(".pptx") || n.endsWith(".ppt")) return { name: "easel", color: "#EA580C" };
  if (n.endsWith(".docx") || n.endsWith(".doc") || n.endsWith(".txt")) return { name: "document-text", color: "#2563EB" };
  if (/\.(png|jpg|jpeg|gif|webp|heic)$/i.test(n)) return { name: "image", color: "#7C3AED" };
  return { name: "document-outline", color: HT.muted };
}

function extFromName(n: string): string {
  const m = n.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "file";
}

export function DropboxPickerModal({
  visible,
  onClose,
  onFilePicked,
}: {
  visible: boolean;
  onClose: () => void;
  onFilePicked: (info: { name: string; mime: string; data_base64: string }) => void;
}) {
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; dropbox_email?: string }>({ connected: false, configured: false });
  const bottomPad = useBottomSheetPadding();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<DbxEntry[]>([]);
  const [q, setQ] = useState("");
  const [searchTick, setSearchTick] = useState(0);
  const safeBottom = useSafeBottom();
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api<any>("/dropbox/status");
      setStatus(r || { connected: false, configured: false });
    } catch { /* silent */ }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const url = q.trim() ? `/dropbox/files?search=${encodeURIComponent(q.trim())}` : "/dropbox/files";
      const r = await api<{ files?: DbxEntry[]; folders?: DbxEntry[] }>(url);
      const items = [...(r?.folders || []), ...(r?.files || [])];
      setEntries(items);
    } catch {
      setEntries([]);
    } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (!visible) return;
    (async () => { await loadStatus(); })();
  }, [visible, loadStatus]);

  useEffect(() => {
    if (!visible || !status.connected) return;
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, status.connected, searchTick]);

  const pickFile = async (f: DbxEntry) => {
    try {
      const path = f.path_lower || f.path_display || f.id;
      if (!path) return;
      setDownloading(path);
      const info = await api<{ name: string; mime: string; data_base64: string; size: number }>(
        `/dropbox/files/${encodeURIComponent(path).replace(/%2F/g, "/")}/content`,
      );
      if (!info?.data_base64) throw new Error("File vuoto");
      onFilePicked({ name: info.name || f.name, mime: info.mime || "application/octet-stream", data_base64: info.data_base64 });
      onClose();
    } catch (e: any) {
      notify("Errore download Dropbox", e?.message || String(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: safeBottom + 12 }, { paddingBottom: bottomPad }]}>
          <View style={styles.hdr}>
            <View style={styles.badge}><Ionicons name="logo-dropbox" size={16} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Dropbox</Text>
              {status.connected && status.dropbox_email ? (
                <Text style={styles.sub}>{status.dropbox_email}</Text>
              ) : (
                <Text style={styles.sub}>Fonte file cloud per Axon</Text>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={HT.text} /></Pressable>
          </View>

          {!status.configured ? (
            <View style={styles.empty}>
              <Ionicons name="warning" size={30} color="#F59E0B" />
              <Text style={styles.emptyTxt}>Dropbox non configurato lato server.</Text>
            </View>
          ) : !status.connected ? (
            <View style={styles.empty}>
              <Ionicons name="link-outline" size={30} color={HT.muted} />
              <Text style={styles.emptyTxt}>Dropbox non collegato. Vai in Impostazioni → Dropbox per collegarlo.</Text>
            </View>
          ) : (
            <>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={HT.muted} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  onSubmitEditing={() => setSearchTick((t) => t + 1)}
                  placeholder="Cerca nel tuo Dropbox…"
                  placeholderTextColor={HT.muted}
                  style={styles.searchInput}
                  autoCapitalize="none"
                />
                {q ? (
                  <Pressable onPress={() => { setQ(""); setSearchTick((t) => t + 1); }} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color={HT.muted} />
                  </Pressable>
                ) : null}
              </View>

              {loading ? (
                <ActivityIndicator color="#0061FF" style={{ marginTop: 20 }} />
              ) : entries.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="cloud-outline" size={30} color={HT.muted} />
                  <Text style={styles.emptyTxt}>Nessun file trovato.</Text>
                </View>
              ) : (
                <KScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
                  {entries.map((f) => {
                    const isFile = f[".tag"] === "file";
                    const icon = isFile ? mimeIcon(f.name) : { name: "folder" as const, color: "#F59E0B" };
                    const key = (f.path_lower || f.id || f.name) as string;
                    const isDownloading = downloading === key;
                    return (
                      <Pressable
                        key={key}
                        testID={`dbx-file-${key}`}
                        onPress={() => isFile && !downloading && pickFile(f)}
                        disabled={!isFile || !!downloading}
                        style={[styles.row, isDownloading && { opacity: 0.6 }]}
                      >
                        <Ionicons name={icon.name} size={22} color={icon.color} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowName} numberOfLines={1}>{f.name}</Text>
                          <Text style={styles.rowMeta}>
                            {isFile ? extFromName(f.name) : "cartella (apri da Dropbox)"}
                            {f.size ? ` · ${Math.round(f.size / 1024)} KB` : ""}
                          </Text>
                        </View>
                        {isDownloading ? (
                          <ActivityIndicator color="#0061FF" />
                        ) : isFile ? (
                          <Ionicons name="download-outline" size={18} color={HT.brand} />
                        ) : (
                          <Ionicons name="chevron-forward" size={16} color={HT.muted} />
                        )}
                      </Pressable>
                    );
                  })}
                </KScrollView>
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
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "80%" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  badge: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#0061FF', alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11, color: HT.muted, fontWeight: "600" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.card2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: HT.text, padding: 0 },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: HT.muted, textAlign: "center", fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: HT.card2 },
  rowName: { fontSize: 14, fontWeight: "700", color: HT.text },
  rowMeta: { fontSize: 11, color: HT.muted, fontWeight: "600" },
});

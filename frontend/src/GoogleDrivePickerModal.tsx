/**
 * V28.w — Google Drive file picker modal per la chat Axon.
 * Lista i file autorizzati (scope drive.file) e permette di sceglierne uno
 * come attachment (viene scaricato via backend e passato come base64 come i file locali).
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Platform } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Ionicons } from "@expo/vector-icons";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { KModalBody } from "@/src/ui/keyboard"; // V50.z397 — tastiera: campo attivo sempre visibile nelle Modal
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
  return { name: "document-outline", color: HT.muted };
}

export function GoogleDrivePickerModal({
  visible,
  onClose,
  onFilePicked,
  onNavigateToPicker,
}: {
  visible: boolean;
  onClose: () => void;
  onFilePicked: (info: { name: string; mime: string; data_base64: string }) => void;
  /** V50.y — Chiamato per NAVIGARE al picker cartelle: chi ci chiama
   *  è responsabile di chiudere anche la modale parent (AssistantChat)
   *  altrimenti il picker screen viene nascosto sotto. */
  onNavigateToPicker?: () => void;
}) {
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; google_email?: string }>({ connected: false, configured: false });
  const bottomPad = useBottomSheetPadding();
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [needsPicker, setNeedsPicker] = useState(false);
  const [q, setQ] = useState("");
  const [searchTick, setSearchTick] = useState(0);
  const safeBottom = useSafeBottom(); // V29.aq
  const [downloading, setDownloading] = useState<string | null>(null);
  // V50.q — Breadcrumb per la navigazione cartelle Drive.
  const [folderPath, setFolderPath] = useState<Array<{ id: string; name: string }>>([]);
  const router = useRouter();

  const loadStatus = useCallback(async () => {
    try {
      const r = await api<any>("/google-drive/status");
      setStatus(r || { connected: false, configured: false });
    } catch { /* silent */ }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      // V50.q — Se siamo dentro una cartella, filtra per folder_id
      const currentFolder = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : "";
      const params = new URLSearchParams();
      if (q.trim()) params.set("search", q.trim());
      if (currentFolder && !q.trim()) params.set("folder_id", currentFolder);
      const url = params.toString() ? `/google-drive/files?${params.toString()}` : "/google-drive/files";
      const r = await api<{ files?: DriveFile[]; needs_picker?: boolean }>(url);
      setFiles(Array.isArray(r?.files) ? r.files : []);
      setNeedsPicker(!!r?.needs_picker);
    } catch (e: any) {
      // Silent fail se non connesso
      setFiles([]);
      setNeedsPicker(false);
    } finally { setLoading(false); }
  }, [q, folderPath]);

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
    // V50.q — Se è una CARTELLA, naviga dentro invece di provare a scaricarla
    // come PDF (causa 403 "Export only supports Docs Editors files").
    if (f.mimeType === "application/vnd.google-apps.folder") {
      setQ(""); // reset ricerca
      setLoading(true);
      try {
        const url = `/google-drive/files?folder_id=${encodeURIComponent(f.id)}`;
        const r = await api<{ files?: DriveFile[] }>(url);
        setFiles(Array.isArray(r?.files) ? r.files : []);
        setFolderPath(prev => [...prev, { id: f.id, name: f.name }]);
      } catch (e: any) {
        notify("Errore apertura cartella", e?.message || String(e));
      } finally {
        setLoading(false);
      }
      return;
    }
    // V50.q — I Google Docs/Sheets/Slides devono usare export mime types, non
    // il download raw. Il backend gestisce già l'export ma se restituisce 403
    // mostriamo un messaggio più chiaro.
    try {
      setDownloading(f.id);
      const info = await api<{ name: string; mime: string; data_base64: string; size: number }>(`/google-drive/files/${f.id}/content`);
      if (!info?.data_base64) throw new Error("File vuoto");
      onFilePicked({ name: info.name, mime: info.mime, data_base64: info.data_base64 });
      onClose();
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Messaggio più leggibile per l'errore "fileNotExportable"
      if (msg.includes("fileNotExportable") || msg.includes("Export only supports Docs")) {
        notify("File non esportabile", "Questo tipo di file non può essere scaricato via Drive. Aprilo su Drive e scaricalo manualmente, poi caricalo dal picker file.");
      } else {
        notify("Errore download Drive", msg);
      }
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}><KModalBody>
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
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={HT.text} /></Pressable>
          </View>

          {!status.configured ? (
            <View style={styles.empty}>
              <Ionicons name="warning" size={30} color="#F59E0B" />
              <Text style={styles.emptyTxt}>Google Drive non configurato lato server.</Text>
            </View>
          ) : !status.connected ? (
            <View style={styles.empty}>
              <Ionicons name="link-outline" size={30} color={HT.muted} />
              <Text style={styles.emptyTxt}>Google Drive non collegato. Vai in Impostazioni → Google Drive per collegarlo.</Text>
            </View>
          ) : (
            <>
              {/* V50.q — Breadcrumb navigazione cartelle Drive */}
              {folderPath.length > 0 && (
                <View style={styles.breadcrumb}>
                  <Pressable
                    onPress={() => { setFolderPath([]); setSearchTick((t) => t + 1); }}
                    style={styles.crumbBtn}
                    hitSlop={8}
                  >
                    <Ionicons name="home" size={14} color={theme.color.primary} />
                    <Text style={styles.crumbTxt}>Drive</Text>
                  </Pressable>
                  {folderPath.map((f, i) => (
                    <React.Fragment key={f.id}>
                      <Ionicons name="chevron-forward" size={12} color={HT.muted} />
                      <Pressable
                        onPress={() => {
                          setFolderPath(folderPath.slice(0, i + 1));
                          setSearchTick((t) => t + 1);
                        }}
                        style={styles.crumbBtn}
                        hitSlop={6}
                      >
                        <Text style={styles.crumbTxt} numberOfLines={1}>{f.name}</Text>
                      </Pressable>
                    </React.Fragment>
                  ))}
                </View>
              )}
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={HT.muted} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  onSubmitEditing={() => setSearchTick((t) => t + 1)}
                  placeholder="Cerca nei file autorizzati…"
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
                <ActivityIndicator color="#0F9D58" style={{ marginTop: 20 }} />
              ) : needsPicker ? (
                // V50.i — Nessuna cartella Axon scelta: guida al picker
                <View style={styles.empty}>
                  <Ionicons name="folder-open-outline" size={30} color="#F59E0B" />
                  <Text style={[styles.emptyTxt, { fontWeight: "800", color: HT.text }]}>
                    Nessuna cartella Axon scelta
                  </Text>
                  <Text style={styles.emptyTxt}>
                    Apri il Google Picker per scegliere una o più cartelle: Axon leggerà solo i file al loro interno.
                  </Text>
                  <Pressable
                    onPress={() => {
                      // V50.y — Chiudi anche la parent modal se disponibile,
                      // altrimenti il picker resta invisibile dietro la chat.
                      if (onNavigateToPicker) onNavigateToPicker();
                      else onClose();
                      setTimeout(() => router.push("/google-drive-picker" as any), 250);
                    }}
                    style={styles.pickerCta}
                  >
                    <Ionicons name="add-circle" size={18} color="#FFF" />
                    <Text style={styles.pickerCtaTxt}>Scegli cartella Axon</Text>
                  </Pressable>
                </View>
              ) : files.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="cloud-outline" size={30} color={HT.muted} />
                  <Text style={styles.emptyTxt}>File non presente nella cartella.{"\n"}Aggiungilo alla cartella Axon oppure cambia cartella dalle Impostazioni → Google Drive.</Text>
                  <Pressable
                    onPress={() => {
                      if (onNavigateToPicker) onNavigateToPicker();
                      else onClose();
                      setTimeout(() => router.push("/google-drive-picker" as any), 250);
                    }}
                    style={styles.pickerCta}
                  >
                    <Ionicons name="folder" size={16} color="#FFF" />
                    <Text style={styles.pickerCtaTxt}>Gestisci cartelle</Text>
                  </Pressable>
                </View>
              ) : (
                <KScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
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
                        {isDownloading ? <ActivityIndicator color="#0F9D58" /> : <Ionicons name="download-outline" size={18} color={HT.brand} />}
                      </Pressable>
                    );
                  })}
                </KScrollView>
              )}
            </>
          )}
        </View>
      </View>
    </KModalBody></Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "80%" },
  hdr: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  badge: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#0F9D58', alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11, color: HT.muted, fontWeight: "600" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.card2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  // V50.q — Breadcrumb per navigazione cartelle Drive
  breadcrumb: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 6, paddingHorizontal: 4 },
  crumbBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: HT.violetTint, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: 140 },
  crumbTxt: { fontSize: 12, fontWeight: "700", color: theme.color.primary },
  searchInput: { flex: 1, fontSize: 14, color: HT.text, padding: 0 },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: HT.muted, textAlign: "center", fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: HT.card2 },
  icon16: { width: 22, height: 22 },
  rowName: { fontSize: 14, fontWeight: "700", color: HT.text },
  rowMeta: { fontSize: 11, color: HT.muted, fontWeight: "600" },
  // V50.i — CTA per aprire il Google Picker
  pickerCta: {
    marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    backgroundColor: '#0F9D58',
  },
  pickerCtaTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
});

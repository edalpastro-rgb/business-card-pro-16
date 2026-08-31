/**
 * Bug 11 — Live in-app camera scanner (continuous mode).
 *
 * Cosa fa:
 *  - Apre una `CameraView` (expo-camera) a schermo intero con AUTOFOCUS continuo
 *    (prop `autofocus="on"`), così la messa a fuoco è sempre attiva senza tap.
 *  - Permette di scattare N foto senza mai chiudere la camera (modalità continua).
 *  - Ogni scatto viene subito mostrato come thumbnail nella strip in basso; in
 *    parallelo invia la foto a `POST /api/scanner/autocrop-preview` per ottenere
 *    la versione ritagliata automaticamente e sostituisce la thumbnail (badge ✂️).
 *  - Al tap su "Fine (N)" chiude la camera e restituisce l'array di pagine al
 *    componente parent (DocumentScannerModal).
 *
 * Web: `CameraView` di expo-camera è supportato via WebRTC; se non permesso,
 * il componente mostra un fallback che rimanda al picker OS.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

export type LiveScannedPage = {
  data_base64: string;
  mime: string;
  preview_uri: string; // data:image/jpeg;base64,...
  cropped?: boolean; // true = version returned by /scanner/autocrop-preview
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onDone: (pages: LiveScannedPage[]) => void;
  enhance?: boolean;
  grayscale?: boolean;
};

export function LiveCameraScanner({ visible, onClose, onDone, enhance = true, grayscale = false }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [pages, setPages] = useState<LiveScannedPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState<"on" | "off">("off");
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [processingCount, setProcessingCount] = useState(0);

  // Reset state when modal is closed
  useEffect(() => {
    if (!visible) {
      setPages([]);
      setBusy(false);
      setTorch("off");
      setProcessingCount(0);
    }
  }, [visible]);

  // Request permission when the modal opens
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const applyAutocropAsync = useCallback(
    async (index: number, data_base64: string) => {
      setProcessingCount((c) => c + 1);
      try {
        const r = await api<{ detected: boolean; data_base64: string; mime: string }>(
          "/scanner/autocrop-preview",
          {
            method: "POST",
            body: { data_base64, mime: "image/jpeg", enhance, grayscale },
          },
        );
        if (r?.detected && r.data_base64) {
          setPages((prev) => {
            const next = [...prev];
            if (!next[index]) return prev;
            next[index] = {
              ...next[index],
              data_base64: r.data_base64,
              mime: r.mime || "image/jpeg",
              preview_uri: `data:${r.mime || "image/jpeg"};base64,${r.data_base64}`,
              cropped: true,
            };
            return next;
          });
        } else if (r?.data_base64) {
          // Even if not detected, we keep the enhanced version (better contrast/sharpness)
          setPages((prev) => {
            const next = [...prev];
            if (!next[index]) return prev;
            next[index] = {
              ...next[index],
              data_base64: r.data_base64,
              mime: r.mime || "image/jpeg",
              preview_uri: `data:${r.mime || "image/jpeg"};base64,${r.data_base64}`,
              cropped: false,
            };
            return next;
          });
        }
      } catch {
        // Silently keep original page — user can still crop server-side on save
      } finally {
        setProcessingCount((c) => Math.max(0, c - 1));
      }
    },
    [enhance, grayscale],
  );

  const takeShot = useCallback(async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.85,
        skipProcessing: false,
        exif: false,
      });
      if (!photo?.base64) {
        notify("Errore", "Foto non acquisita — riprova.");
        return;
      }
      const preview_uri = photo.uri || `data:image/jpeg;base64,${photo.base64}`;
      // Add page immediately so the user sees a thumbnail
      let newIndex = -1;
      setPages((prev) => {
        newIndex = prev.length;
        return [
          ...prev,
          {
            data_base64: photo.base64!,
            mime: "image/jpeg",
            preview_uri,
            cropped: false,
          },
        ];
      });
      // Fire-and-forget autocrop in background
      setTimeout(() => {
        if (newIndex >= 0) applyAutocropAsync(newIndex, photo.base64!);
      }, 0);
    } catch (e: any) {
      notify("Errore fotocamera", e?.message || "");
    } finally {
      setBusy(false);
    }
  }, [busy, applyAutocropAsync]);

  const removePage = (idx: number) => {
    setPages((prev) => prev.filter((_, i) => i !== idx));
  };

  const finish = () => {
    if (!pages.length) {
      onClose();
      return;
    }
    onDone(pages);
  };

  if (!visible) return null;

  // Permission gate — while denied, show a friendly UI
  if (permission && !permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <View style={styles.permWrap}>
            <Ionicons name="camera-outline" size={64} color="#F1F5F9" />
            <Text style={styles.permTitle}>Serve l&apos;accesso alla fotocamera</Text>
            <Text style={styles.permSub}>
              Per scansionare documenti in modalità continua l&apos;app deve accedere alla fotocamera del
              dispositivo. Nessun dato viene inviato senza il tuo consenso.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
              <Pressable onPress={onClose} style={[styles.permBtn, { backgroundColor: "#334155" }]}>
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              {permission.canAskAgain ? (
                <Pressable
                  onPress={requestPermission}
                  style={[styles.permBtn, { backgroundColor: "#FF6B35" }]}
                >
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Consenti</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") {
                      import("react-native").then(({ Linking }) => Linking.openSettings?.());
                    }
                  }}
                  style={[styles.permBtn, { backgroundColor: "#FF6B35" }]}
                >
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Apri impostazioni</Text>
                </Pressable>
              )}
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <CameraView
          ref={(r) => {
            cameraRef.current = r;
          }}
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          enableTorch={torch === "on"}
          autofocus="on"
          animateShutter={true}
        />

        {/* Overlay corner-guides to help user frame the document */}
        <View pointerEvents="none" style={styles.guides}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {/* Top bar */}
        <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topBarInner}>
            <Pressable onPress={onClose} hitSlop={12} style={styles.circleBtn} testID="live-scan-close">
              <Ionicons name="close" size={22} color="#FFF" />
            </Pressable>
            <View style={styles.topBadge}>
              <Ionicons name="scan-outline" size={13} color="#FFF" />
              <Text style={styles.topBadgeTxt}>
                Modalità continua · Autofocus attivo
                {processingCount > 0 ? ` · elaboro ${processingCount}…` : ""}
              </Text>
            </View>
            <Pressable
              onPress={() => setTorch((t) => (t === "on" ? "off" : "on"))}
              hitSlop={12}
              style={[styles.circleBtn, torch === "on" && { backgroundColor: "#FF6B35" }]}
              testID="live-scan-torch"
            >
              <Ionicons name={torch === "on" ? "flash" : "flash-off"} size={20} color="#FFF" />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Bottom controls */}
        <SafeAreaView edges={["bottom"]} style={styles.bottomBar} pointerEvents="box-none">
          {/* Thumbnails strip */}
          {pages.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stripInner}
              style={styles.strip}
            >
              {pages.map((p, i) => (
                <View key={`page-${i}`} style={styles.thumbWrap} testID={`live-scan-thumb-${i}`}>
                  <Image source={{ uri: p.preview_uri }} style={styles.thumb} resizeMode="cover" />
                  {p.cropped && (
                    <View style={styles.thumbBadge}>
                      <Ionicons name="cut" size={10} color="#FFF" />
                    </View>
                  )}
                  <Pressable
                    onPress={() => removePage(i)}
                    style={styles.thumbDel}
                    testID={`live-scan-thumb-del-${i}`}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={12} color="#FFF" />
                  </Pressable>
                  <View style={styles.thumbNum}>
                    <Text style={styles.thumbNumTxt}>{i + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Shutter row */}
          <View style={styles.shutterRow}>
            <Pressable
              onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
              hitSlop={12}
              style={styles.sideBtn}
              testID="live-scan-flip"
            >
              <Ionicons name="camera-reverse-outline" size={26} color="#FFF" />
            </Pressable>

            <Pressable
              onPress={takeShot}
              disabled={busy}
              style={[styles.shutter, busy && { opacity: 0.6 }]}
              testID="live-scan-shutter"
              accessibilityLabel="Scatta"
            >
              <View style={styles.shutterInner}>
                {busy ? (
                  <ActivityIndicator color="#FF6B35" />
                ) : (
                  <Ionicons name="camera" size={26} color="#FF6B35" />
                )}
              </View>
            </Pressable>

            <Pressable
              onPress={finish}
              hitSlop={12}
              style={[styles.sideBtn, pages.length > 0 && styles.sideBtnDone]}
              testID="live-scan-done"
            >
              {pages.length > 0 ? (
                <>
                  <Ionicons name="checkmark" size={18} color="#FFF" />
                  <Text style={styles.doneTxt}>Fine ({pages.length})</Text>
                </>
              ) : (
                <Text style={styles.doneTxt}>Fine</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  guides: {
    position: "absolute",
    top: "18%",
    bottom: "22%",
    left: "8%",
    right: "8%",
  },
  corner: {
    position: "absolute",
    width: 32,
    height: 32,
    borderColor: "#FF6B35",
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  topBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  topBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexShrink: 1,
  },
  topBadgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "700" },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingTop: 8,
  },
  strip: { maxHeight: 84 },
  stripInner: { paddingHorizontal: 12, gap: 8, paddingVertical: 6 },
  thumbWrap: { position: "relative", width: 64, height: 64, borderRadius: 8, overflow: "visible" },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#111",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  thumbBadge: {
    position: "absolute",
    top: -4,
    left: -4,
    backgroundColor: "#10B981",
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  thumbDel: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  thumbNum: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  thumbNumTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },

  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sideBtn: {
    minWidth: 72,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 6,
  },
  sideBtnDone: { backgroundColor: "#FF6B35" },
  doneTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },

  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, backgroundColor: "#0B1220" },
  permTitle: { color: "#F1F5F9", fontSize: 18, fontWeight: "800", marginTop: 16, textAlign: "center" },
  permSub: { color: "#94A3B8", fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  permBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
});

export default LiveCameraScanner;

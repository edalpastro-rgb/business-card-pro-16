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
import Svg, { Polygon, Circle } from "react-native-svg";
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
  // Bug 11.b — Live edge detection state.
  // Corners are stored NORMALIZED (0..1) so we can map them to the current
  // overlay size (which we measure via onLayout).
  const [liveCorners, setLiveCorners] = useState<[number, number][] | null>(null);
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [edgeDetectOn, setEdgeDetectOn] = useState(true);
  const detectBusyRef = useRef(false); // prevents overlapping requests
  const lastCornersRef = useRef<[number, number][] | null>(null); // for EMA smoothing
  // Bug 11.c — Auto-shutter: fire capture when the document is stable for
  // AUTO_STABLE_MS. State machine per-detection: unstable → stable → captured
  // (cool-down for AUTO_COOLDOWN_MS so we don't take two shots in a row).
  const [autoShutter, setAutoShutter] = useState(true);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null); // 0..1 progress
  const stableSinceRef = useRef<number | null>(null); // ms timestamp when doc became stable
  const cooldownUntilRef = useRef<number>(0); // ms timestamp until which no auto-shot allowed

  // Reset state when modal is closed
  useEffect(() => {
    if (!visible) {
      setPages([]);
      setBusy(false);
      setTorch("off");
      setProcessingCount(0);
      setLiveCorners(null);
      lastCornersRef.current = null;
      detectBusyRef.current = false;
      stableSinceRef.current = null;
      cooldownUntilRef.current = 0;
      setAutoCountdown(null);
    }
  }, [visible]);

  // Request permission when the modal opens
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  // Bug 11.b — Live edge detection loop.
  // Every SAMPLE_INTERVAL ms, we grab a low-quality frame with takePictureAsync
  // and POST it to /scanner/detect-corners. If corners are detected we apply
  // exponential moving average smoothing (alpha=0.5) to avoid jitter, then
  // update `liveCorners` for the overlay to redraw.
  //
  // Bug 11.c — Auto-shutter: when the document is detected AND corners are
  // stable (max normalized delta < STABILITY_THRESHOLD) for AUTO_STABLE_MS,
  // we automatically trigger takeShot(). Cool-down prevents duplicates.
  useEffect(() => {
    if (!visible || !edgeDetectOn) return;
    if (!permission?.granted) return;
    let cancelled = false;
    const SAMPLE_INTERVAL = 900; // faster sampling so auto-shutter feels responsive
    const ALPHA = 0.55; // 0 = no smoothing, 1 = only new value
    const STABILITY_THRESHOLD = 0.03; // max normalized delta across 4 corners
    const AUTO_STABLE_MS = 1000; // hold time before firing auto-shutter
    const AUTO_COOLDOWN_MS = 2000; // grace period after auto/manual shot

    const smooth = (
      next: [number, number][],
      prev: [number, number][] | null,
    ): [number, number][] => {
      if (!prev) return next;
      return next.map(([x, y], i) => {
        const [px, py] = prev[i] || [x, y];
        return [px + (x - px) * ALPHA, py + (y - py) * ALPHA] as [number, number];
      });
    };

    const maxDelta = (a: [number, number][], b: [number, number][]): number => {
      let m = 0;
      for (let i = 0; i < 4; i++) {
        const dx = Math.abs(a[i][0] - b[i][0]);
        const dy = Math.abs(a[i][1] - b[i][1]);
        m = Math.max(m, dx, dy);
      }
      return m;
    };

    const tick = async () => {
      if (cancelled) return;
      if (detectBusyRef.current) return;
      if (busy) return; // don't sample while user is capturing
      if (!cameraRef.current) return;
      detectBusyRef.current = true;
      try {
        const snap = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.1,
          skipProcessing: true,
          exif: false,
        } as any);
        if (cancelled) return;
        if (!snap?.base64) return;
        const r = await api<{ detected: boolean; corners: [number, number][] | null }>(
          "/scanner/detect-corners",
          { method: "POST", body: { data_base64: snap.base64, mime: "image/jpeg" } },
        );
        if (cancelled) return;
        const now = Date.now();
        if (r?.detected && r.corners && r.corners.length === 4) {
          const smoothed = smooth(r.corners, lastCornersRef.current);
          // Stability = delta between raw new corners and previous smoothed
          const stable = lastCornersRef.current
            ? maxDelta(r.corners, lastCornersRef.current) < STABILITY_THRESHOLD
            : false;
          lastCornersRef.current = smoothed;
          setLiveCorners(smoothed);

          // Auto-shutter state machine
          if (autoShutter && now >= cooldownUntilRef.current) {
            if (stable) {
              if (stableSinceRef.current == null) {
                stableSinceRef.current = now;
                setAutoCountdown(0);
              } else {
                const held = now - stableSinceRef.current;
                if (held >= AUTO_STABLE_MS) {
                  // Fire!
                  stableSinceRef.current = null;
                  cooldownUntilRef.current = now + AUTO_COOLDOWN_MS;
                  setAutoCountdown(null);
                  // release the guard before calling takeShot which sets busy=true
                  detectBusyRef.current = false;
                  takeShot();
                  return;
                } else {
                  setAutoCountdown(Math.min(1, held / AUTO_STABLE_MS));
                }
              }
            } else {
              // moved → reset countdown
              stableSinceRef.current = null;
              setAutoCountdown(null);
            }
          } else {
            setAutoCountdown(null);
          }
        } else {
          lastCornersRef.current = null;
          setLiveCorners(null);
          stableSinceRef.current = null;
          setAutoCountdown(null);
        }
      } catch {
        // ignore transient errors — the loop will retry next tick
      } finally {
        detectBusyRef.current = false;
      }
    };

    // First sample fires after a short delay so camera has time to warm up
    const initial = setTimeout(tick, 800);
    const iv = setInterval(tick, SAMPLE_INTERVAL);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(iv);
    };
    // Note: takeShot is stable via useCallback below; adding it here would cause a re-subscribe cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, edgeDetectOn, permission?.granted, busy, autoShutter]);

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
    // Reset auto-shutter timers (whether manual or auto call)
    stableSinceRef.current = null;
    setAutoCountdown(null);
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
          animateShutter={false}
        />

        {/* Bug 11.b — Live edge detection overlay (SVG polygon + corner dots) */}
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (Math.abs(width - overlaySize.w) > 1 || Math.abs(height - overlaySize.h) > 1) {
              setOverlaySize({ w: Math.round(width), h: Math.round(height) });
            }
          }}
        >
          {edgeDetectOn && liveCorners && overlaySize.w > 0 && overlaySize.h > 0 && (
            <Svg width={overlaySize.w} height={overlaySize.h} pointerEvents="none">
              <Polygon
                points={liveCorners
                  .map(([nx, ny]) => `${(nx * overlaySize.w).toFixed(1)},${(ny * overlaySize.h).toFixed(1)}`)
                  .join(" ")}
                fill="rgba(34,197,94,0.18)"
                stroke="#22C55E"
                strokeWidth={3}
                strokeLinejoin="round"
              />
              {liveCorners.map(([nx, ny], i) => (
                <Circle
                  key={`c-${i}`}
                  cx={nx * overlaySize.w}
                  cy={ny * overlaySize.h}
                  r={7}
                  fill="#22C55E"
                  stroke="#FFF"
                  strokeWidth={2}
                />
              ))}
            </Svg>
          )}
        </View>

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
            <Pressable
              onPress={() => setEdgeDetectOn((v) => !v)}
              hitSlop={12}
              style={styles.topBadge}
              testID="live-scan-edge-toggle"
            >
              <Ionicons
                name={edgeDetectOn ? (liveCorners ? "checkmark-circle" : "scan-outline") : "scan-outline"}
                size={13}
                color={edgeDetectOn && liveCorners ? "#22C55E" : "#FFF"}
              />
              <Text style={styles.topBadgeTxt}>
                {edgeDetectOn
                  ? autoCountdown !== null
                    ? `Scatto tra ${Math.max(0, Math.ceil((1 - autoCountdown) * 1))}s…`
                    : liveCorners
                      ? autoShutter
                        ? "Rilevato · tieni fermo per lo scatto"
                        : "Documento rilevato · tocca per scattare"
                      : "Cerco i bordi… inquadra il foglio"
                  : "Autofocus attivo · rilevamento OFF"}
                {processingCount > 0 ? ` · ${processingCount}` : ""}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAutoShutter((v) => !v);
                stableSinceRef.current = null;
                setAutoCountdown(null);
              }}
              hitSlop={12}
              style={[styles.circleBtn, autoShutter && { backgroundColor: "#22C55E" }]}
              testID="live-scan-auto-toggle"
              accessibilityLabel={autoShutter ? "Passa a scatto manuale" : "Passa a scatto automatico"}
            >
              <Ionicons name={autoShutter ? "flash-outline" : "hand-left-outline"} size={18} color="#FFF" />
            </Pressable>
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
              style={[styles.shutter, busy && { opacity: 0.6 }, autoCountdown !== null && { borderColor: "#22C55E" }]}
              testID="live-scan-shutter"
              accessibilityLabel="Scatta"
            >
              {/* Auto-shutter progress ring: a green quadrant that grows around the shutter */}
              {autoCountdown !== null && autoCountdown > 0 && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.shutterRing,
                    {
                      // Simulate progress with a rotating border sweep: grow diameter as fill
                      opacity: 0.75,
                      transform: [{ scale: 0.55 + 0.45 * autoCountdown }],
                    },
                  ]}
                />
              )}
              <View style={styles.shutterInner}>
                {busy ? (
                  <ActivityIndicator color="#FF6B35" />
                ) : autoCountdown !== null ? (
                  <Ionicons name="hourglass" size={26} color="#22C55E" />
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
  shutterRing: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 44,
    borderWidth: 4,
    borderColor: "#22C55E",
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

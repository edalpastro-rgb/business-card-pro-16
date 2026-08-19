import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import jsQR from "jsqr";
import jpeg from "jpeg-js";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
};

const SCAN_INTERVAL_MS = 500; // ~2 scans/sec on native (takePicture is slow)
const SCAN_TARGET_SIZE = 480; // downscale to 480px for fast jsQR decoding

/**
 * QR / barcode scanner modal (V38L — jsQR pure-JS decoder).
 *
 * Strategy:
 *   - NATIVE (Expo Go / production build): CameraView from expo-camera renders
 *     the live preview. Every 500 ms we call `takePictureAsync` (fast, no
 *     shutter animation, skipProcessing), then downscale + JPEG-decode the
 *     result with jpeg-js and run jsQR on the raw RGBA buffer. This bypasses
 *     the flaky native onBarcodeScanned and works reliably on Android Expo Go.
 *   - WEB: getUserMedia + <video> → canvas → getImageData → jsQR. Runs at
 *     ~10-15 scans/sec.
 *   - GALLERY FALLBACK (both): user picks a photo of the QR from library and
 *     we decode it via the same jsQR pipeline. Works even when the live
 *     preview cannot focus.
 */
export function QRScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [scanTick, setScanTick] = useState(0); // just to force UI refresh for status dot
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    scanned.current = false;
    setWebError(null);
    setTorch(false);
    setBusy(false);
    if (!visible) return;
    if (Platform.OS === "web") {
      startWebScanner();
      return;
    }
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, permission?.granted]);

  // ---- NATIVE: periodic snapshot + jsQR decoding ----
  const nativeLoopTimer = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!visible || !permission?.granted) return;
    nativeLoopTimer.current = setInterval(() => {
      void nativeScanOnce();
    }, SCAN_INTERVAL_MS);
    return () => {
      if (nativeLoopTimer.current) clearInterval(nativeLoopTimer.current);
      nativeLoopTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, permission?.granted]);

  const nativeScanOnce = async () => {
    if (scanned.current || busy || !cameraRef.current) return;
    try {
      setScanTick((t) => t + 1);
      // Snapshot the preview frame. skipProcessing + quality=0.3 keeps it fast.
      const pic = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        base64: false,
        skipProcessing: true,
        exif: false,
        shutterSound: false,
      });
      if (!pic?.uri) return;
      const result = await decodeQrFromUri(pic.uri);
      if (result) {
        scanned.current = true;
        handleFound(result);
      }
      // cleanup temp file
      try { await FileSystem.deleteAsync(pic.uri, { idempotent: true }); } catch {}
    } catch (e) {
      console.warn("nativeScanOnce err", e);
    }
  };

  const decodeQrFromUri = async (uri: string): Promise<string | null> => {
    // Downscale and get base64 JPEG via expo-image-manipulator (fast, native)
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: SCAN_TARGET_SIZE } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    const b64 = manip.base64;
    if (!b64) return null;
    const raw = base64ToUint8(b64);
    let decoded: { data: Uint8Array; width: number; height: number };
    try {
      decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true }) as any;
    } catch (e) {
      console.warn("jpeg decode err", e);
      return null;
    }
    const width = decoded.width;
    const height = decoded.height;
    const rgba = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    const qr = jsQR(rgba, width, height, { inversionAttempts: "attemptBoth" });
    return qr?.data || null;
  };

  // ---- WEB: video → canvas → jsQR ----
  const videoRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<any>(null);

  const startWebScanner = async () => {
    try {
      const nav: any = (globalThis as any).navigator;
      if (!nav?.mediaDevices?.getUserMedia) {
        setWebError("Fotocamera non disponibile sul browser.");
        return;
      }
      const stream = await nav.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          // @ts-expect-error focusMode advanced constraint
          focusMode: { ideal: "continuous" },
          // @ts-expect-error advanced is standard MediaTrackConstraints
          advanced: [{ focusMode: "continuous" }],
        },
        audio: false,
      });
      streamRef.current = stream;
      try {
        const track = stream.getVideoTracks()[0] as any;
        if (track?.applyConstraints) {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
        }
      } catch {}
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
      }
      const doc: any = (globalThis as any).document;
      canvasRef.current = doc.createElement("canvas");
      const tick = () => {
        if (scanned.current || !videoRef.current) return;
        try {
          const v = videoRef.current;
          const c = canvasRef.current;
          const w = v.videoWidth || 640;
          const h = v.videoHeight || 480;
          if (w > 0 && h > 0) {
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
            if (qr?.data) {
              scanned.current = true;
              handleFound(qr.data);
              return;
            }
          }
        } catch (e) {
          console.warn("web scan err", e);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setWebError(e?.message || "Impossibile avviare la fotocamera.");
    }
  };

  const stopWebScanner = () => {
    if (rafRef.current != null) {
      try { cancelAnimationFrame(rafRef.current); } catch {}
      rafRef.current = null;
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      streamRef.current = null;
    }
  };

  const handleFound = (data: string) => {
    stopWebScanner();
    if (nativeLoopTimer.current) { clearInterval(nativeLoopTimer.current); nativeLoopTimer.current = null; }
    onScanned(data);
    onClose();
  };

  const handleClose = () => {
    stopWebScanner();
    if (nativeLoopTimer.current) { clearInterval(nativeLoopTimer.current); nativeLoopTimer.current = null; }
    onClose();
  };

  // ---- Gallery fallback (both platforms) ----
  const scanFromLibrary = async () => {
    setBusy(true);
    try {
      if (Platform.OS === "web") {
        const doc: any = (globalThis as any).document;
        const input = doc.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) { setBusy(false); return; }
          const img = new (globalThis as any).Image();
          img.onload = async () => {
            try {
              const c = (globalThis as any).document.createElement("canvas");
              c.width = img.naturalWidth;
              c.height = img.naturalHeight;
              const ctx = c.getContext("2d");
              ctx.drawImage(img, 0, 0);
              const imgData = ctx.getImageData(0, 0, c.width, c.height);
              const qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
              if (qr?.data) {
                handleFound(qr.data);
              } else {
                setWebError("Nessun QR code rilevato nell'immagine.");
              }
            } catch (e: any) {
              setWebError("Errore decodifica: " + (e?.message || ""));
            } finally { setBusy(false); }
          };
          img.src = URL.createObjectURL(f);
        };
        input.click();
        return;
      }
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setBusy(false); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.uri) { setBusy(false); return; }
      const result = await decodeQrFromUri(res.assets[0].uri);
      if (result) {
        handleFound(result);
      } else {
        setWebError("Nessun QR code rilevato nell'immagine selezionata.");
      }
    } catch (e: any) {
      console.warn("scanFromLibrary err", e);
      setWebError("Errore: " + (e?.message || ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={8} testID="qr-close">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "center" }}>
            <View style={[styles.statusDot, { backgroundColor: (scanTick % 2 === 0) ? "#22C55E" : "#16A34A" }]} />
            <Text style={styles.title}>Inquadra il QR code</Text>
          </View>
          {Platform.OS !== "web" ? (
            <Pressable onPress={() => setTorch((t) => !t)} hitSlop={8} testID="qr-torch">
              <Ionicons name={torch ? "flash" : "flash-off"} size={22} color="#FFF" />
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        {Platform.OS === "web" ? (
          <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
            {/* @ts-expect-error web-only */}
            <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
            {webError && (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={22} color="#DC2626" />
                <Text style={styles.errorTxt}>{webError}</Text>
              </View>
            )}
          </View>
        ) : !permission?.granted ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#000" }}>
            <Ionicons name="camera-outline" size={44} color="#FFF" />
            <Text style={{ color: "#FFF", textAlign: "center", marginTop: 12, fontSize: 15 }}>
              Serve il permesso della fotocamera per scansionare i QR code.
            </Text>
            <Pressable
              onPress={requestPermission}
              style={{ marginTop: 16, backgroundColor: theme.color.brandPrimary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}
            >
              <Text style={{ color: "#FFF", fontWeight: "700" }}>Concedi permesso</Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            ref={cameraRef as any}
            style={{ flex: 1 }}
            facing="back"
            autofocus="on"
            enableTorch={torch}
            active={visible}
          />
        )}

        {/* Framing overlay */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>
            Allinea il QR code al centro · decodifica automatica ogni {Math.round(SCAN_INTERVAL_MS / 100) / 10}s
          </Text>
          {webError && Platform.OS !== "web" && (
            <View style={[styles.errorBox, { position: "relative", marginTop: 12 }]}>
              <Ionicons name="warning" size={18} color="#DC2626" />
              <Text style={styles.errorTxt}>{webError}</Text>
            </View>
          )}
        </View>

        {/* Gallery fallback — works on all platforms */}
        <View style={styles.galleryBar}>
          <Pressable
            onPress={scanFromLibrary}
            disabled={busy}
            style={[styles.galleryBtn, busy && { opacity: 0.7 }]}
            testID="qr-from-gallery"
          >
            {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="images" size={18} color="#FFF" />}
            <Text style={styles.galleryTxt}>{busy ? "Decodifica…" : "Scegli QR dalla galleria"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function base64ToUint8(b64: string): Uint8Array {
  // Cross-platform base64 → Uint8Array (works on native RN + web)
  try {
    const g: any = globalThis as any;
    if (typeof g.atob === "function") {
      const bin = g.atob(b64);
      const len = bin.length;
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  } catch {}
  // Fallback: Buffer polyfill provided by RN via Metro
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const B = require("buffer").Buffer;
    return new Uint8Array(B.from(b64, "base64"));
  } catch {
    return new Uint8Array(0);
  }
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
    backgroundColor: "#000000CC",
    zIndex: 10,
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 90, justifyContent: "center", alignItems: "center" },
  frame: { width: 260, height: 260, borderRadius: 24, borderWidth: 3, borderColor: "#FFF", backgroundColor: "transparent", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 10 },
  hint: { color: "#FFF", fontSize: 12, marginTop: 16, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, textAlign: "center", maxWidth: 320 },
  errorBox: { position: "absolute", bottom: 90, backgroundColor: "#FFF", padding: 14, borderRadius: 12, flexDirection: "row", gap: 10, alignItems: "center", maxWidth: 320 },
  errorTxt: { flex: 1, color: theme.color.onSurface, fontSize: 12 },
  galleryBar: { position: "absolute", bottom: 24, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", zIndex: 20 },
  galleryBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, backgroundColor: "rgba(37,99,235,0.95)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", elevation: 4, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6 },
  galleryTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
});

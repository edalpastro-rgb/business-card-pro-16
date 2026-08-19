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

// Fixed (V38M): larger canvas resolution to give jsQR enough pixels on small
// QR codes printed on business cards. 480px was too aggressive for near-scans.
// V38N tuning (Samsung S21 / mid-range Android): more stabilization time +
// higher JPEG quality so the frame isn't motion-blurred when hand-held near
// a business card. S21 autofocus settles in ~500-600 ms but hand shake takes
// another beat.
const SCAN_INTERVAL_MS = 900;              // native live scan interval (was 700)
const SCAN_STABILIZATION_MS = 1300;        // wait before the FIRST live scan (was 900)
const SCAN_LIVE_TARGET_SIZE = 1400;        // downscale live snapshots to this width (was 1024)
const SCAN_GALLERY_TARGET_SIZE = 2048;     // gallery uploads keep higher detail
const JPEG_QUALITY_LIVE = 0.85;            // more headroom for jsQR pattern lock (was 0.65)

/**
 * QR / barcode scanner modal (V38M — hi-res jsQR pure-JS decoder).
 *
 * Strategy:
 *   - NATIVE (Expo Go / production build): CameraView renders the live
 *     preview. After a 900 ms stabilization delay (letting the autofocus
 *     settle), we call `takePictureAsync` every 700 ms, downscale to
 *     1024 px, JPEG-decode with jpeg-js and run jsQR on the raw RGBA. Higher
 *     resolution → far more reliable pattern lock on business-card QR codes.
 *   - WEB: getUserMedia + <video> → full-resolution canvas → jsQR.
 *   - GALLERY FALLBACK (both): user picks a photo of the QR. We resize to
 *     2048 px, run jsQR, and if it fails we retry with `attemptBoth` +
 *     rotated 90/180/270° copies. Result auto-fills the new-contact form.
 */
export function QRScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [galleryHint, setGalleryHint] = useState<string | null>(null);
  const [scanTick, setScanTick] = useState(0);
  const cameraRef = useRef<any>(null);
  const cameraReadyRef = useRef<boolean>(false);
  const stabilizeUntilRef = useRef<number>(0);

  useEffect(() => {
    scanned.current = false;
    setWebError(null);
    setTorch(false);
    setBusy(false);
    setGalleryHint(null);
    cameraReadyRef.current = false;
    stabilizeUntilRef.current = 0;
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

  const onCameraReady = () => {
    cameraReadyRef.current = true;
    // Let AF settle for a short moment before we start grabbing frames.
    stabilizeUntilRef.current = Date.now() + SCAN_STABILIZATION_MS;
  };

  const nativeScanOnce = async () => {
    if (scanned.current || busy || !cameraRef.current) return;
    if (!cameraReadyRef.current) return;
    if (Date.now() < stabilizeUntilRef.current) return;
    try {
      setScanTick((t) => t + 1);
      const pic = await cameraRef.current.takePictureAsync({
        quality: JPEG_QUALITY_LIVE,
        base64: false,
        skipProcessing: true, // faster; we don't need exif/orientation for QR
        exif: false,
        shutterSound: false,
      });
      if (!pic?.uri) return;
      const result = await decodeQrFromUri(pic.uri, SCAN_LIVE_TARGET_SIZE);
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

  // Downscale via expo-image-manipulator, JPEG-decode with jpeg-js, run jsQR.
  // Returns decoded string or null. Retries with rotated copies on gallery
  // images (which may be rotated by the user's camera).
  const decodeQrFromUri = async (uri: string, targetSize: number, tryRotations = false): Promise<string | null> => {
    const runPipeline = async (rotate: 0 | 90 | 180 | 270): Promise<string | null> => {
      const actions: any[] = [{ resize: { width: targetSize } }];
      if (rotate !== 0) actions.push({ rotate });
      const manip = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
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
      const rgba = new Uint8ClampedArray(
        decoded.data.buffer,
        decoded.data.byteOffset,
        decoded.data.byteLength
      );
      const qr = jsQR(rgba, decoded.width, decoded.height, { inversionAttempts: "attemptBoth" });
      return qr?.data || null;
    };
    // First attempt (no rotation)
    const first = await runPipeline(0);
    if (first) return first;
    if (!tryRotations) return null;
    // Gallery retry: try 90 / 180 / 270 rotations
    for (const r of [90, 180, 270] as const) {
      const hit = await runPipeline(r);
      if (hit) return hit;
    }
    return null;
  };

  // ---- WEB: video → full-res canvas → jsQR ----
  const videoRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<any>(null);
  const webStartAtRef = useRef<number>(0);

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
          width: { ideal: 1920 },
          height: { ideal: 1080 },
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
      webStartAtRef.current = Date.now();
      const doc: any = (globalThis as any).document;
      canvasRef.current = doc.createElement("canvas");
      const tick = () => {
        if (scanned.current || !videoRef.current) return;
        // Give the webcam ~600 ms to auto-expose/focus before decoding
        if (Date.now() - webStartAtRef.current < 600) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
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
            setScanTick((t) => t + 1);
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

  // ---- Gallery fallback (both platforms) — FIXED in V38M ----
  const scanFromLibrary = async () => {
    setBusy(true);
    setGalleryHint(null);
    setWebError(null);
    try {
      if (Platform.OS === "web") {
        await scanFromLibraryWeb();
        return;
      }
      // Native path: high-res + rotation retries
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setBusy(false); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.uri) { setBusy(false); return; }
      const result = await decodeQrFromUri(res.assets[0].uri, SCAN_GALLERY_TARGET_SIZE, true);
      if (result) {
        handleFound(result);
      } else {
        setGalleryHint("Nessun QR code rilevato nell'immagine. Prova con una foto più nitida o più ravvicinata.");
        setBusy(false);
      }
    } catch (e: any) {
      console.warn("scanFromLibrary err", e);
      setGalleryHint("Errore: " + (e?.message || "impossibile decodificare l'immagine"));
      setBusy(false);
    }
  };

  // Web gallery pipeline: input file → createImageBitmap → canvas → jsQR.
  // Uses a promise wrapper so the async control flow is clean and the busy
  // spinner resets after the user finishes picking a file.
  const scanFromLibraryWeb = async (): Promise<void> => {
    const doc: any = (globalThis as any).document;
    const winSelf: any = globalThis as any;
    const file: File | null = await new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      // Some browsers require the input to be attached to the DOM
      input.style.position = "fixed";
      input.style.left = "-9999px";
      doc.body.appendChild(input);
      let done = false;
      input.onchange = () => {
        if (done) return;
        done = true;
        const f = input.files?.[0] || null;
        try { doc.body.removeChild(input); } catch {}
        resolve(f);
      };
      // If the user cancels the picker, "onchange" never fires — we time out.
      setTimeout(() => {
        if (done) return;
        done = true;
        try { doc.body.removeChild(input); } catch {}
        resolve(null);
      }, 60000);
      input.click();
    });
    if (!file) { setBusy(false); return; }
    try {
      let width: number;
      let height: number;
      let imgData: ImageData;
      const c = doc.createElement("canvas");
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (typeof winSelf.createImageBitmap === "function") {
        const bmp = await winSelf.createImageBitmap(file);
        width = bmp.width;
        height = bmp.height;
        c.width = width;
        c.height = height;
        ctx.drawImage(bmp, 0, 0);
        imgData = ctx.getImageData(0, 0, width, height);
        try { bmp.close?.(); } catch {}
      } else {
        // Older-browser fallback via <img> + object URL
        const url = URL.createObjectURL(file);
        const img: any = new (globalThis as any).Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("image load failed"));
          img.src = url;
        });
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
        c.width = width;
        c.height = height;
        ctx.drawImage(img, 0, 0);
        imgData = ctx.getImageData(0, 0, width, height);
        try { URL.revokeObjectURL(url); } catch {}
      }
      // First attempt: as-is
      let qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
      // Second attempt: downscale to 1024 (some QRs decode better at a
      // canonical size than at the original crazy-high resolution)
      if (!qr) {
        const scaled = doc.createElement("canvas");
        const sctx = scaled.getContext("2d", { willReadFrequently: true });
        const scale = Math.min(1, 1024 / Math.max(width, height));
        scaled.width = Math.max(1, Math.round(width * scale));
        scaled.height = Math.max(1, Math.round(height * scale));
        sctx.drawImage(c, 0, 0, scaled.width, scaled.height);
        const sData = sctx.getImageData(0, 0, scaled.width, scaled.height);
        qr = jsQR(sData.data, sData.width, sData.height, { inversionAttempts: "attemptBoth" });
      }
      if (qr?.data) {
        handleFound(qr.data);
      } else {
        setGalleryHint("Nessun QR code rilevato nell'immagine. Prova con una foto più nitida o più ravvicinata.");
        setBusy(false);
      }
    } catch (e: any) {
      console.warn("web gallery decode err", e);
      setGalleryHint("Errore: " + (e?.message || "decodifica non riuscita"));
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
            onCameraReady={onCameraReady}
          />
        )}

        {/* Framing overlay */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>
            Allinea il QR al centro · scansione automatica ogni {Math.round(SCAN_INTERVAL_MS / 100) / 10}s
          </Text>
          {galleryHint && (
            <View style={[styles.errorBox, { position: "relative", marginTop: 12 }]}>
              <Ionicons name="information-circle" size={18} color="#B45309" />
              <Text style={styles.errorTxt}>{galleryHint}</Text>
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

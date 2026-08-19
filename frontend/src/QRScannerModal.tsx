import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { CameraView, useCameraPermissions, scanFromURLAsync } from "expo-camera";
import * as ImagePicker from "expo-image-picker";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
};

const BARCODE_TYPES = ["qr", "datamatrix", "pdf417", "aztec", "ean13", "code128"] as any;

/**
 * QR / barcode scanner modal.
 *
 * Focus strategy (V38K):
 *   - iOS 16+ / Android with Google Code Scanner: use `CameraView.launchScanner`
 *     which opens the native DataScannerViewController / MLKit scanner. These
 *     are the SAME scanners that the OS Camera app uses, so focus works
 *     flawlessly on business cards.
 *   - Older devices / Expo Go on iOS < 16: fall back to CameraView with
 *     autofocus + tap-to-focus overlay + manual zoom bar + torch.
 *   - Web: MediaDevices getUserMedia + BarcodeDetector API (with
 *     continuous-autofocus advanced constraint).
 */
export function QRScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(0);
  const [torch, setTorch] = useState<boolean>(false);
  // camKey forces the CameraView to remount when we tap to refocus
  const [camKey, setCamKey] = useState<number>(0);
  const [modernAvailable, setModernAvailable] = useState<boolean>(false);

  // Detect availability of the modern (native) scanner. This is a static prop
  // on CameraView in expo-camera 17. We wrap in try/catch for safety.
  useEffect(() => {
    try {
      const CV: any = CameraView;
      const v = typeof CV.isModernBarcodeScannerAvailable === "function"
        ? CV.isModernBarcodeScannerAvailable()
        : !!CV.isModernBarcodeScannerAvailable;
      setModernAvailable(!!v && Platform.OS !== "web");
    } catch {
      setModernAvailable(false);
    }
  }, []);

  useEffect(() => {
    scanned.current = false;
    setWebError(null);
    setTorch(false);
    setZoom(0);
    setCamKey((k) => k + 1);
    if (!visible) return;
    if (Platform.OS === "web") {
      startWebScanner();
      return;
    }
    // Try native modern scanner (iOS 16+ / Android Google Code Scanner)
    if (modernAvailable) {
      launchModernScanner();
      return;
    }
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, modernAvailable]);

  // ---- Native modern scanner (iOS 16+ / Android Code Scanner) ----
  const modernSubRef = useRef<any>(null);
  const launchModernScanner = async () => {
    try {
      const CV: any = CameraView;
      // Set up listener BEFORE launching to avoid missing the first event
      modernSubRef.current = CV.onModernBarcodeScanned((event: any) => {
        if (scanned.current) return;
        scanned.current = true;
        const data = event?.data || event?.rawValue || "";
        try { modernSubRef.current?.remove?.(); } catch {}
        modernSubRef.current = null;
        try { CV.dismissScanner?.(); } catch {}
        if (data) {
          onScanned(String(data));
        }
        onClose();
      });
      await CV.launchScanner?.({ barcodeTypes: BARCODE_TYPES, isGuidanceEnabled: true, isPinchToZoomEnabled: true, isHighlightingEnabled: true });
    } catch (e) {
      console.warn("modern scanner err", e);
      // Fall through: caller will still show fallback UI on next render.
      setModernAvailable(false);
    }
  };

  const stopModern = () => {
    try { modernSubRef.current?.remove?.(); } catch {}
    modernSubRef.current = null;
    try { (CameraView as any).dismissScanner?.(); } catch {}
  };

  // ---- Web scanner via BarcodeDetector ----
  const videoRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

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
          // @ts-expect-error focusMode is an advanced constraint on Chromium mobile
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
      const BD: any = (globalThis as any).BarcodeDetector;
      if (!BD) {
        setWebError("Il tuo browser non supporta il rilevamento QR. Aprilo su Chrome/Edge o usa l'app mobile.");
        return;
      }
      const detector = new BD({ formats: ["qr_code", "data_matrix"] });
      const tick = async () => {
        if (scanned.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            scanned.current = true;
            handleFound(codes[0].rawValue);
            return;
          }
        } catch {}
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
    onScanned(data);
    onClose();
  };

  const handleClose = () => {
    stopWebScanner();
    stopModern();
    onClose();
  };

  const refocus = () => {
    // Force the camera to remount → re-evaluates autofocus
    setCamKey((k) => k + 1);
  };

  const zoomIn = () => setZoom((z) => Math.min(0.5, +(z + 0.05).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.0, +(z - 0.05).toFixed(2)));

  // V38K — fallback: user picks a photo of the QR code (or a business card
  // containing a QR) from the phone/library. We decode the image directly
  // without needing the live camera. Works even when autofocus fails.
  const scanFromLibrary = async () => {
    try {
      if (Platform.OS === "web") {
        // Web path: prompt an <input type=file> and decode via BarcodeDetector
        const BD: any = (globalThis as any).BarcodeDetector;
        if (!BD) {
          setWebError("Il tuo browser non supporta la decodifica QR da immagine.");
          return;
        }
        const doc: any = (globalThis as any).document;
        const input = doc.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          const img = new (globalThis as any).Image();
          img.onload = async () => {
            try {
              const det = new BD({ formats: ["qr_code", "data_matrix"] });
              const codes = await det.detect(img);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                handleFound(codes[0].rawValue);
              } else {
                setWebError("Nessun QR code rilevato nell'immagine.");
              }
            } catch (e: any) {
              setWebError("Errore nella decodifica: " + (e?.message || ""));
            }
          };
          img.src = URL.createObjectURL(f);
        };
        input.click();
        return;
      }
      // Native: use ImagePicker + expo-camera scanFromURLAsync
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const uri = res.assets[0].uri;
      const codes = await scanFromURLAsync(uri, ["qr", "datamatrix", "pdf417", "aztec"] as any);
      if (codes && codes.length > 0 && codes[0].data) {
        handleFound(codes[0].data);
      } else {
        console.warn("Nessun QR rilevato nell'immagine.");
      }
    } catch (e: any) {
      console.warn("scanFromLibrary err", e?.message || e);
    }
  };

  // If we're using (or about to use) the modern native scanner, we don't render
  // our modal UI — the native OS shows its own full-screen scanner.
  if (modernAvailable && Platform.OS !== "web") {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={8} testID="qr-close">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title}>Inquadra il QR code</Text>
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
          // Tap the preview to force the camera to refocus.
          <Pressable onPress={refocus} style={{ flex: 1 }} testID="qr-tap-focus">
            <CameraView
              key={`cam-${camKey}`}
              style={{ flex: 1 }}
              facing="back"
              autofocus="on"
              zoom={zoom}
              enableTorch={torch}
              active={visible}
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={(evt) => {
                if (scanned.current) return;
                scanned.current = true;
                if (evt?.data) handleFound(evt.data);
              }}
            />
          </Pressable>
        )}

        {/* Framing overlay */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>
            {Platform.OS === "web"
              ? "Allinea il QR code al centro del riquadro"
              : "Tocca lo schermo per mettere a fuoco · avvicina/allontana per leggere QR ravvicinati"}
          </Text>
        </View>

        {/* Zoom controls (native only, non-modern fallback) */}
        {Platform.OS !== "web" && permission?.granted && (
          <View style={styles.zoomBar}>
            <Pressable onPress={zoomOut} style={styles.zoomBtn} hitSlop={6} testID="qr-zoom-out">
              <Ionicons name="remove" size={22} color="#FFF" />
            </Pressable>
            <Text style={styles.zoomLbl}>Zoom {Math.round(zoom * 100)}%</Text>
            <Pressable onPress={zoomIn} style={styles.zoomBtn} hitSlop={6} testID="qr-zoom-in">
              <Ionicons name="add" size={22} color="#FFF" />
            </Pressable>
          </View>
        )}

        {/* Gallery fallback — works on all platforms. Useful when live
            autofocus struggles with a business-card QR. */}
        <View style={styles.galleryBar}>
          <Pressable onPress={scanFromLibrary} style={styles.galleryBtn} testID="qr-from-gallery">
            <Ionicons name="images" size={18} color="#FFF" />
            <Text style={styles.galleryTxt}>Scegli QR dalla galleria</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
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
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, textAlign: "center", marginHorizontal: 12 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" },
  frame: { width: 260, height: 260, borderRadius: 24, borderWidth: 3, borderColor: "#FFF", backgroundColor: "transparent", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 10 },
  hint: { color: "#FFF", fontSize: 12, marginTop: 16, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, textAlign: "center", maxWidth: 320 },
  errorBox: { position: "absolute", bottom: 90, backgroundColor: "#FFF", padding: 16, borderRadius: 12, flexDirection: "row", gap: 10, alignItems: "center", maxWidth: 320 },
  errorTxt: { flex: 1, color: theme.color.onSurface, fontSize: 13 },
  zoomBar: { position: "absolute", bottom: 90, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  zoomBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  zoomLbl: { color: "#FFF", fontWeight: "700", fontSize: 13, minWidth: 96, textAlign: "center", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14 },
  galleryBar: { position: "absolute", bottom: 24, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", zIndex: 20 },
  galleryBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, backgroundColor: "rgba(37,99,235,0.95)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", elevation: 4, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6 },
  galleryTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
});

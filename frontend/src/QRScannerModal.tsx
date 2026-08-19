import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { CameraView, useCameraPermissions } from "expo-camera";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
};

/**
 * QR / barcode scanner modal. Uses expo-camera CameraView with barcode support
 * on native. On web the browser BarcodeDetector API is used when available.
 * Returns the raw scanned string via onScanned() — the caller decides how to
 * parse (vCard, URL, JSON, plain phone, etc.).
 *
 * Focus tuning (V38J):
 *   - On modern iPhones the primary rear lens has a minimum focus distance
 *     ~10-12 cm which makes business-card QR codes blurry. We apply a subtle
 *     digital zoom (0.03) to push past that threshold. Autofocus is forced to
 *     "on" (continuous) and the user can toggle a stronger zoom via the +/-
 *     buttons.
 *   - On web we ask getUserMedia for advanced { focusMode: 'continuous' }.
 */
export function QRScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(0.03); // subtle digital zoom for close-up focus
  const [torch, setTorch] = useState<boolean>(false);

  useEffect(() => {
    scanned.current = false;
    setWebError(null);
    setTorch(false);
    setZoom(0.03);
    if (!visible) return;
    if (Platform.OS !== "web" && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
    if (Platform.OS === "web" && visible) {
      startWebScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
      // Ask for continuous autofocus explicitly (fallbacks silently if unsupported)
      const stream = await nav.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // @ts-expect-error focusMode is an advanced constraint on Chromium mobile
          focusMode: { ideal: "continuous" },
          // @ts-expect-error advanced is standard MediaTrackConstraints
          advanced: [{ focusMode: "continuous" }],
        },
        audio: false,
      });
      streamRef.current = stream;
      // Try to apply constraints post-open for maximum coverage
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
    onClose();
  };

  const zoomIn = () => setZoom((z) => Math.min(0.35, +(z + 0.05).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.0, +(z - 0.05).toFixed(2)));

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
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            autofocus="on"
            zoom={zoom}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["qr", "datamatrix", "pdf417", "aztec"] }}
            onBarcodeScanned={(evt) => {
              if (scanned.current) return;
              scanned.current = true;
              if (evt?.data) handleFound(evt.data);
            }}
          />
        )}

        {/* Framing overlay */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>Allinea il QR code al centro del riquadro · avvicina o allontana per mettere a fuoco</Text>
        </View>

        {/* Zoom controls (native only) */}
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
  errorBox: { position: "absolute", bottom: 40, backgroundColor: "#FFF", padding: 16, borderRadius: 12, flexDirection: "row", gap: 10, alignItems: "center", maxWidth: 320 },
  errorTxt: { flex: 1, color: theme.color.onSurface, fontSize: 13 },
  zoomBar: { position: "absolute", bottom: 30, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  zoomBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  zoomLbl: { color: "#FFF", fontWeight: "700", fontSize: 13, minWidth: 96, textAlign: "center", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14 },
});

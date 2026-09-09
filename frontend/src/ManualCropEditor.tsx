import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Image, ActivityIndicator, PanResponder, LayoutChangeEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Polygon, Line } from "react-native-svg";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

/**
 * Ritaglio manuale del documento dopo lo scatto.
 * - Mostra l'immagine (contain) con 4 maniglie trascinabili agli angoli.
 * - Alla conferma invia gli angoli normalizzati (0..1) a POST /api/scanner/manual-crop
 *   che applica la correzione prospettica (OpenCV) e restituisce il JPEG ritagliato.
 * Cross-platform (PanResponder: iOS / Android / web).
 */

export type CropResult = { data_base64: string; mime: string; preview_uri: string };

type Props = {
  visible: boolean;
  imageBase64: string;         // base64 puro oppure data URL
  onCancel: () => void;
  onDone: (r: CropResult) => void;
  enhance?: boolean;
  grayscale?: boolean;
};

type Pt = { x: number; y: number };
const HANDLE = 44;
const DEFAULT_CORNERS: Pt[] = [{ x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }];

export function ManualCropEditor({ visible, imageBase64, onCancel, onDone, enhance = true, grayscale = false }: Props) {
  const uri = imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const [box, setBox] = useState({ w: 0, h: 0 });          // container layout
  const [img, setImg] = useState({ w: 0, h: 0 });          // natural size
  const [corners, setCorners] = useState<Pt[]>(DEFAULT_CORNERS);
  const cornersRef = useRef<Pt[]>(DEFAULT_CORNERS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCorners(DEFAULT_CORNERS);
    cornersRef.current = DEFAULT_CORNERS;
    Image.getSize(uri, (w, h) => setImg({ w, h }), () => setImg({ w: 3, h: 4 }));
  }, [visible, uri]);

  // Rettangolo effettivo dell'immagine dentro il container (resizeMode contain)
  const rect = (() => {
    if (!box.w || !box.h || !img.w || !img.h) return { x: 0, y: 0, w: box.w, h: box.h };
    const s = Math.min(box.w / img.w, box.h / img.h);
    const w = img.w * s, h = img.h * s;
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();

  const toPx = (p: Pt) => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });

  const rectRef = useRef(rect);
  rectRef.current = rect;
  const startRef = useRef<Pt[]>([]);
  const responders = useRef(
    [0, 1, 2, 3].map((i) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => { startRef.current = cornersRef.current.map((c) => ({ ...c })); },
        onPanResponderMove: (_e, g) => {
          const r = rectRef.current;
          if (!r.w || !r.h) return;
          const s = startRef.current[i];
          const nx = Math.min(1, Math.max(0, s.x + g.dx / r.w));
          const ny = Math.min(1, Math.max(0, s.y + g.dy / r.h));
          const next = cornersRef.current.map((c, k) => (k === i ? { x: nx, y: ny } : c));
          cornersRef.current = next;
          setCorners(next);
        },
        onPanResponderTerminationRequest: () => false,
      })
    )
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: width, h: height });
  };

  const resetFull = () => {
    const full: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    cornersRef.current = full;
    setCorners(full);
  };

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api<{ data_base64: string; mime: string }>("/scanner/manual-crop", {
        method: "POST",
        body: {
          data_base64: imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64,
          corners: cornersRef.current.map((c) => [c.x, c.y]),
          enhance,
          grayscale,
        },
      });
      onDone({ data_base64: r.data_base64, mime: r.mime || "image/jpeg", preview_uri: `data:${r.mime || "image/jpeg"};base64,${r.data_base64}` });
    } catch (e: any) {
      notify("Ritaglio non riuscito", e?.message || "Riprova");
    } finally {
      setBusy(false);
    }
  }, [imageBase64, enhance, grayscale, onDone]);

  const px = corners.map(toPx);
  const points = px.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.hdr}>
          <Pressable onPress={onCancel} hitSlop={10} testID="crop-cancel" style={styles.hdrBtn}>
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title}>Ritaglia documento</Text>
          <Pressable onPress={resetFull} hitSlop={10} testID="crop-reset" style={styles.hdrBtn}>
            <Ionicons name="expand-outline" size={22} color="#FFF" />
          </Pressable>
        </View>
        <Text style={styles.hint}>Trascina i 4 angoli sui bordi del foglio, poi conferma.</Text>

        <View style={styles.stage} onLayout={onLayout} testID="crop-stage">
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {box.w > 0 && (
            <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Polygon points={points} fill="rgba(255,107,53,0.18)" stroke="#FF6B35" strokeWidth={2} />
              {px.map((p, i) => {
                const q = px[(i + 1) % 4];
                return <Line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#FFF" strokeWidth={1} strokeDasharray="6 4" />;
              })}
            </Svg>
          )}
          {box.w > 0 && px.map((p, i) => (
            <View
              key={i}
              {...responders[i].panHandlers}
              testID={`crop-handle-${i}`}
              style={[styles.handle, { left: p.x - HANDLE / 2, top: p.y - HANDLE / 2 }]}
            >
              <View style={styles.handleDot} />
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={onCancel} style={[styles.btn, { backgroundColor: "#334155" }]} testID="crop-back">
            <Ionicons name="arrow-back" size={18} color="#FFF" />
            <Text style={styles.btnTxt}>Annulla</Text>
          </Pressable>
          <Pressable onPress={confirm} disabled={busy} style={[styles.btn, { backgroundColor: "#0F9D58", opacity: busy ? 0.6 : 1 }]} testID="crop-confirm">
            {busy ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="crop" size={18} color="#FFF" /><Text style={styles.btnTxt}>Applica ritaglio</Text></>)}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6 },
  hdrBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  hint: { color: "#CBD5E1", fontSize: 12, textAlign: "center", paddingHorizontal: 16, marginBottom: 6 },
  stage: { flex: 1, marginHorizontal: 12, backgroundColor: "#111", borderRadius: 10, overflow: "hidden" },
  handle: { position: "absolute", width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,107,53,0.25)" },
  handleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#FF6B35", borderWidth: 3, borderColor: "#FFF" },
  actions: { flexDirection: "row", gap: 10, padding: 14 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 999, minHeight: 48 },
  btnTxt: { color: "#FFF", fontSize: 15, fontWeight: "900" },
});

export default ManualCropEditor;

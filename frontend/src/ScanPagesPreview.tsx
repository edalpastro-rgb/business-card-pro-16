/**
 * V50.z337 — Anteprima pagine scanner a piena schermata: swipe orizzontale tra le pagine,
 * contatore, «Scarta e rifai» (elimina la pagina e riapre la fotocamera per sostituirla nella
 * stessa posizione) e chiusura.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Image, FlatList, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ScannedPage } from "@/src/DocumentScannerModal";

type Props = {
  pages: ScannedPage[];
  index: number;
  onClose: () => void;
  onRetake: (index: number) => void;
  onDelete: (index: number) => void;
};

export function ScanPagesPreview({ pages, index, onClose, onRetake, onDelete }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [cur, setCur] = useState(index);
  const listRef = useRef<FlatList<ScannedPage>>(null);

  useEffect(() => { setCur(Math.min(index, Math.max(0, pages.length - 1))); }, [index, pages.length]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== cur) setCur(Math.max(0, Math.min(pages.length - 1, i)));
  };

  const page = pages[cur];
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} testID="scan-preview">
        <FlatList
          ref={listRef}
          data={pages}
          horizontal
          pagingEnabled
          initialScrollIndex={Math.min(index, Math.max(0, pages.length - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(_, i) => String(i)}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          renderItem={({ item }) => (
            <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
              {item.preview_uri === "pdf" ? (
                <View style={styles.pdfBox}><Ionicons name="document" size={64} color="#DC2626" /><Text style={styles.pdfTxt}>PDF importato</Text></View>
              ) : (
                <Image source={{ uri: item.preview_uri }} style={{ width, height: height - insets.top - insets.bottom - 200 }} resizeMode="contain" />
              )}
            </View>
          )}
        />

        {/* Top bar */}
        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.circleBtn} testID="scan-preview-close">
            <Ionicons name="close" size={22} color="#FFF" />
          </Pressable>
          <View style={styles.counter} testID="scan-preview-counter">
            <Text style={styles.counterTxt}>Pagina {cur + 1} di {pages.length}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Bottom actions */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.hint}>{pages.length > 1 ? "Scorri per sfogliare le pagine" : " "}</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => onDelete(cur)} style={[styles.btn, styles.btnGhost]} testID="scan-preview-delete">
              <Ionicons name="trash-outline" size={18} color="#FCA5A5" />
              <Text style={[styles.btnTxt, { color: "#FCA5A5" }]}>Elimina</Text>
            </Pressable>
            <Pressable
              onPress={() => onRetake(cur)}
              disabled={!page || page.preview_uri === "pdf"}
              style={[styles.btn, styles.btnPrimary, (!page || page.preview_uri === "pdf") && { opacity: 0.4 }]}
              testID="scan-preview-retake"
            >
              <Ionicons name="camera-reverse" size={18} color="#FFF" />
              <Text style={styles.btnTxt}>Scarta e rifai</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  circleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  counter: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)" },
  counterTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 10, backgroundColor: "rgba(0,0,0,0.55)", paddingTop: 12 },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, minHeight: 48, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnGhost: { backgroundColor: "rgba(255,255,255,0.12)" },
  btnPrimary: { backgroundColor: "#FF6B35", flex: 1.6 },
  btnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  pdfBox: { alignItems: "center", gap: 10 },
  pdfTxt: { color: "#FFF", fontWeight: "700" },
});

// PdfPagesZoom.tsx — V50.z283 — Pagine PDF (jpeg dal backend) con scorrimento infinito, pinch-to-zoom (Android+iOS), doppio tap,
// pan orizzontale quando ingrandito e ri-rendering ad alta risoluzione (200 dpi) delle pagine visibili quando zoom ≥ 1.5×.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Image, ActivityIndicator, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from "react-native-reanimated";

const A4 = 1.414;
const GAP = 6;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const HIRES_FROM = 1.5;
const DOUBLE_TAP_ZOOM = 2.5;

type Props = {
  pages: string[];
  total: number;
  busy: boolean;
  winW: number;
  winH: number;
  onLoadMore: () => void;
  fetchHiRes: (start: number, count: number) => Promise<string[]>;
};

export function PdfPagesZoom({ pages, total, busy, winW, winH, onLoadMore, fetchHiRes }: Props) {
  const [zoom, setZoom] = useState(1);
  const [hiRes, setHiRes] = useState<Record<number, string>>({});
  const [scrollOn, setScrollOn] = useState(true);
  const [current, setCurrent] = useState(1);
  const vRef = useRef<ScrollView>(null);
  const hRef = useRef<ScrollView>(null);
  const offX = useRef(0);
  const offY = useRef(0);
  const zoomRef = useRef(1);
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);
  const hiResInflight = useRef<Set<number>>(new Set());

  const pageW = winW * zoom;
  const pageH = pageW * A4 + GAP;

  // shared values per l'anteprima live del pinch (transform) — il layout reale cambia al rilascio
  const scale = useSharedValue(1);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const cw = useSharedValue(winW);
  const ch = useSharedValue(winH);
  const zoomSv = useSharedValue(1);

  const requestHiRes = useCallback(
    (y: number, z: number) => {
      if (z < HIRES_FROM || !pages.length) return;
      const ph = winW * z * A4 + GAP;
      const first = Math.max(0, Math.floor(y / ph));
      const last = Math.min(pages.length - 1, Math.floor((y + winH) / ph));
      const missing: number[] = [];
      for (let i = first; i <= last; i++) if (!hiRes[i] && !hiResInflight.current.has(i)) missing.push(i);
      if (!missing.length) return;
      const start = missing[0];
      const count = missing[missing.length - 1] - start + 1;
      for (let i = start; i < start + count; i++) hiResInflight.current.add(i);
      fetchHiRes(start, count)
        .then((imgs) => setHiRes((prev) => { const n = { ...prev }; imgs.forEach((img, k) => { n[start + k] = img; }); return n; }))
        .catch(() => { /* resta la versione standard */ })
        .finally(() => { for (let i = start; i < start + count; i++) hiResInflight.current.delete(i); });
    },
    [pages.length, hiRes, winW, winH, fetchHiRes],
  );

  const commitZoom = useCallback((next: number, focalX: number, focalY: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const ratio = z / zoomRef.current;
    pendingScroll.current = { x: Math.max(0, (offX.current + focalX) * ratio - focalX), y: Math.max(0, (offY.current + focalY) * ratio - focalY) };
    zoomRef.current = z;
    zoomSv.value = z;
    scale.value = 1;
    setZoom(z);
    setScrollOn(true);
  }, [scale, zoomSv]);

  useEffect(() => {
    const p = pendingScroll.current;
    if (!p) return;
    pendingScroll.current = null;
    requestAnimationFrame(() => {
      hRef.current?.scrollTo({ x: zoom > 1 ? p.x : 0, animated: false });
      vRef.current?.scrollTo({ y: p.y, animated: false });
      offX.current = zoom > 1 ? p.x : 0;
      offY.current = p.y;
      requestHiRes(p.y, zoom);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const toggleZoom = useCallback((x: number, y: number) => {
    commitZoom(zoomRef.current > 1 ? 1 : DOUBLE_TAP_ZOOM, x, y);
  }, [commitZoom]);

  const pinchStart = useCallback(() => setScrollOn(false), []);

  const nativeV = Gesture.Native();
  const nativeH = Gesture.Native();
  const pinch = Gesture.Pinch()
    .simultaneousWithExternalGesture(nativeV, nativeH)
    .onStart((e) => {
      fx.value = e.focalX;
      fy.value = e.focalY;
      runOnJS(pinchStart)();
    })
    .onUpdate((e) => {
      const lo = MIN_ZOOM / zoomSv.value;
      const hi = MAX_ZOOM / zoomSv.value;
      scale.value = Math.min(hi, Math.max(lo, e.scale));
    })
    .onEnd(() => {
      runOnJS(commitZoom)(zoomSv.value * scale.value, fx.value, fy.value);
    });
  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(260).onEnd((e) => { runOnJS(toggleZoom)(e.x, e.y); });
  const gesture = Gesture.Simultaneous(pinch, doubleTap);

  const liveStyle = useAnimatedStyle(() => {
    const s = scale.value;
    return {
      transform: [
        { translateX: (fx.value + sx.value - cw.value / 2) * (1 - s) },
        { translateY: (fy.value + sy.value - ch.value / 2) * (1 - s) },
        { scale: s },
      ],
    };
  });

  const onVScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    offY.current = contentOffset.y;
    sy.value = contentOffset.y;
    const cur = Math.min(total || pages.length, Math.floor((contentOffset.y + layoutMeasurement.height / 2) / pageH) + 1);
    if (cur !== current) setCurrent(cur);
    // scorrimento infinito: carica il blocco successivo quando manca circa una pagina alla fine
    if (!busy && pages.length < total && contentOffset.y + layoutMeasurement.height >= contentSize.height - pageH) onLoadMore();
  };
  const onVScrollEnd = () => requestHiRes(offY.current, zoomRef.current);
  const onHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { offX.current = e.nativeEvent.contentOffset.x; sx.value = e.nativeEvent.contentOffset.x; };

  return (
    <View style={styles.root} onLayout={(e) => { ch.value = e.nativeEvent.layout.height; }}>
      <GestureDetector gesture={gesture}>
        <View style={styles.root}>
          <GestureDetector gesture={nativeV}>
            <ScrollView
              ref={vRef}
              style={styles.root}
              contentContainerStyle={{ paddingBottom: 48 }}
              scrollEnabled={scrollOn}
              onScroll={onVScroll}
              onScrollEndDrag={onVScrollEnd}
              onMomentumScrollEnd={onVScrollEnd}
              scrollEventThrottle={64}
              testID="fileviewer-pdf-pages"
            >
              <GestureDetector gesture={nativeH}>
                <ScrollView
                  ref={hRef}
                  horizontal
                  scrollEnabled={scrollOn && zoom > 1}
                  showsHorizontalScrollIndicator={zoom > 1}
                  onScroll={onHScroll}
                  scrollEventThrottle={64}
                  contentContainerStyle={{ width: pageW }}
                >
                  <Animated.View style={[{ width: pageW }, liveStyle]} onLayout={(e) => { cw.value = e.nativeEvent.layout.width; }}>
                    {pages.map((p, i) => (
                      <Image
                        key={i}
                        source={{ uri: `data:image/jpeg;base64,${hiRes[i] || p}` }}
                        style={{ width: pageW, height: pageW * A4, backgroundColor: "#FFF", marginBottom: GAP }}
                        resizeMode="contain"
                        testID={`fileviewer-pdf-page-${i}`}
                      />
                    ))}
                  </Animated.View>
                </ScrollView>
              </GestureDetector>
              {busy ? (
                <View style={styles.loading}><ActivityIndicator size="large" color="#FFF" /><Text style={styles.loadingTxt}>Preparazione pagine…</Text></View>
              ) : null}
            </ScrollView>
          </GestureDetector>
        </View>
      </GestureDetector>
      {total > 0 ? (
        <View style={styles.pill} pointerEvents="none" testID="fileviewer-pdf-counter">
          <Text style={styles.pillTxt}>Pagina {current} di {total}{zoom > 1 ? ` · ${zoom.toFixed(1)}×` : ""}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#111" },
  loading: { padding: 24, alignItems: "center", gap: 8 },
  loadingTxt: { color: "#CBD5E1", fontSize: 13 },
  pill: { position: "absolute", bottom: 14, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  pillTxt: { color: "#FFF", fontSize: 12, fontWeight: "800" },
});

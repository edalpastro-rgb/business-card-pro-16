import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type WheelItem<T = any> = { value: T; label: string };

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5; // must be odd
const HALF = Math.floor(VISIBLE_ITEMS / 2);

type WheelProps<T> = {
  items: WheelItem<T>[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
};

/** Single wheel column. Renders items and snaps to the closest one on scroll end. */
export function Wheel<T = any>({ items, value, onChange, testID }: WheelProps<T>) {
  const scrollRef = useRef<ScrollView | null>(null);
  const initialIdx = useMemo(() => {
    const idx = items.findIndex((it) => it.value === value);
    return idx < 0 ? 0 : idx;
  }, [items, value]);

  const [currentIdx, setCurrentIdx] = useState(initialIdx);

  // Scroll to the initial item on mount / when value changes externally
  useEffect(() => {
    setCurrentIdx(initialIdx);
    // Slight delay so layout is ready
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: initialIdx * ITEM_HEIGHT, animated: false });
    }, 30);
    return () => clearTimeout(t);
  }, [initialIdx]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(y / ITEM_HEIGHT)));
    setCurrentIdx(idx);
    if (items[idx] && items[idx].value !== value) onChange(items[idx].value);
    // Snap precisely
    scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: true });
  };

  const onScrollWeb = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // On web there's no momentum end — debounce
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(y / ITEM_HEIGHT)));
    if (idx !== currentIdx) setCurrentIdx(idx);
  };

  return (
    <View style={styles.wheelWrap} testID={testID}>
      {/* Center highlight */}
      <View style={styles.centerHighlight} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        onScrollEndDrag={Platform.OS === "web" ? onMomentumEnd : undefined}
        onScroll={Platform.OS === "web" ? onScrollWeb : undefined}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: HALF * ITEM_HEIGHT }}
      >
        {items.map((it, i) => {
          const dist = Math.abs(i - currentIdx);
          const opacity = dist === 0 ? 1 : dist === 1 ? 0.55 : 0.25;
          const scale = dist === 0 ? 1 : dist === 1 ? 0.92 : 0.85;
          return (
            <View
              key={String(it.value) + i}
              style={[styles.item, { opacity, transform: [{ scale }] }]}
            >
              <Text
                style={[
                  styles.itemTxt,
                  dist === 0 && { color: HT.brand, fontWeight: "700" },
                ]}
                numberOfLines={1}
              >
                {it.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

type WheelPickerModalProps<T> = {
  visible: boolean;
  title: string;
  items: WheelItem<T>[];
  value: T;
  onConfirm: (v: T) => void;
  onClose: () => void;
  testID?: string;
};

/** A modal wrapping a single wheel. Confirm/Cancel buttons at bottom. */
export function WheelPickerModal<T = any>({
  visible,
  title,
  items,
  value,
  onConfirm,
  onClose,
  testID,
}: WheelPickerModalProps<T>) {
  const [tempValue, setTempValue] = useState<T>(value);
  const bottomPad = useBottomSheetPadding();

  useEffect(() => {
    if (visible) setTempValue(value);
  }, [visible, value]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} testID={testID}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={HT.muted} />
            </Pressable>
          </View>

          <Wheel<T> items={items} value={tempValue} onChange={setTempValue} testID={testID ? `${testID}-wheel` : undefined} />

          <View style={[styles.footer, { paddingBottom: bottomPad }]}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnGhost]}>
              <Text style={[styles.btnTxt, { color: HT.muted }]}>Annulla</Text>
            </Pressable>
            <Pressable
              onPress={() => { onConfirm(tempValue); onClose(); }}
              style={[styles.btn, styles.btnPrimary]}
              testID={testID ? `${testID}-confirm` : undefined}
            >
              <Text style={[styles.btnTxt, { color: "#FFF" }]}>Conferma</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wheelWrap: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    position: "relative",
    overflow: "hidden",
  },
  centerHighlight: {
    position: "absolute",
    top: HALF * ITEM_HEIGHT,
    left: 12,
    right: 12,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: HT.border,
    backgroundColor: "rgba(37, 99, 235, 0.06)",
    borderRadius: 8,
    zIndex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  itemTxt: {
    fontSize: 17,
    color: HT.text,
  },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 16 },
  sheet: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: HT.card,
    borderRadius: 16,
    paddingVertical: 12,
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 6 },
  title: { fontSize: 16, fontWeight: "700", color: HT.text },
  footer: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: { backgroundColor: HT.card2 },
  btnPrimary: { backgroundColor: HT.brand },
  btnTxt: { fontSize: 15, fontWeight: "700" },
});

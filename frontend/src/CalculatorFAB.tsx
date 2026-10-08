// V26.o — Floating Calculator FAB with modal
// V50.z6 — Draggable FAB: long-press + drag to reposition. Position persisted
// via AsyncStorage so it survives app reloads. Quick tap still opens the
// calculator (drag threshold = 6px to distinguish tap vs drag).
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "expo-router";
import {
  View, Text, StyleSheet, Pressable, Platform,
  Animated, Dimensions, PanResponder,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { useRegisterFab } from "@/src/FabStack";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { BP_DESKTOP, SIDEBAR_W } from "@/src/hooks/useResponsive"; // V50.z480

type Op = "+" | "-" | "×" | "÷" | null;

const FAB_SIZE = 56;
const DRAG_THRESHOLD = 6; // px — sotto questa soglia è un tap
const POS_STORAGE_KEY = "calc_fab_position_v1";
// Margine di sicurezza per non nascondere il FAB dietro tab bar / status bar
const EDGE_MARGIN = 8;
const BOTTOM_SAFE = 100; // spazio per tab bar

function _clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** V50.z466 — Fix crash Android: la FAB è montata nel layout radice e all'avvio lo stato di navigazione può non esistere ancora
 *  (`usePathname` legge `state.routes[...].pathname` → TypeError). Se il contesto non è pronto restituisce "" invece di lanciare. */
function useSafePathname(): string {
  try {
    return usePathname() || "";
  } catch {
    return "";
  }
}

// V50.z482 — Una sola FAB per volta: la radice (_layout, prop `root`) ha la precedenza; le schermate che la montano anche loro
// (contatto, bollette, report, viewer) non renderizzano nulla finché la radice è montata (prima erano due FAB sovrapposte).
let _calcFabRootMounted = false;
const _calcFabSubs = new Set<() => void>();

export function CalculatorFAB({ root }: { root?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (root) {
      _calcFabRootMounted = true; _calcFabSubs.forEach((f) => f());
      return () => { _calcFabRootMounted = false; _calcFabSubs.forEach((f) => f()); };
    }
    const f = () => forceRender((x) => x + 1);
    _calcFabSubs.add(f);
    return () => { _calcFabSubs.delete(f); };
  }, [root]);
  const isPrimary = !!root || !_calcFabRootMounted;
  const { width: screenW, height: screenH } = Dimensions.get("window");
  // V50.z480 — Desktop web (sidebar laterale): il FAB in basso a destra copriva la card Scadenze della Home. Sul desktop lo
  // posizioniamo nella colonna della sidebar (sotto il menu, sopra utente/Esci), dove non c'è mai contenuto. Chiave di
  // persistenza separata per il desktop così una vecchia posizione in basso a destra non viene riapplicata.
  const isDesktop = screenW >= BP_DESKTOP;
  const posKey = isDesktop ? `${POS_STORAGE_KEY}_desktop` : POS_STORAGE_KEY;

  // Default: bottom-right, con margine per non coprire i tab · desktop: dentro la sidebar sopra il footer
  const defaultPos = useMemo(
    () => (isDesktop
      ? { x: Math.round((SIDEBAR_W - FAB_SIZE) / 2), y: screenH - FAB_SIZE - 130 }
      : { x: screenW - FAB_SIZE - 20, y: screenH - FAB_SIZE - BOTTOM_SAFE }),
    [screenW, screenH, isDesktop],
  );

  // Animated position (smoothness) + shadow ref per snapshot in gesture start
  const pan = useRef(new Animated.ValueXY(defaultPos)).current;
  const posRef = useRef(defaultPos);
  const wasDrag = useRef(false);

  useRegisterFab("calculator", isPrimary);

  // Carica posizione persistita al mount
  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem(posKey);
        if (!s) return;
        const p = JSON.parse(s);
        if (typeof p?.x !== "number" || typeof p?.y !== "number") return;
        const clamped = {
          x: _clamp(p.x, EDGE_MARGIN, screenW - FAB_SIZE - EDGE_MARGIN),
          y: _clamp(p.y, EDGE_MARGIN, screenH - FAB_SIZE - EDGE_MARGIN),
        };
        pan.setValue(clamped);
        posRef.current = clamped;
      } catch { /* ignora */ }
    })();
  }, [pan, screenW, screenH, posKey]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > DRAG_THRESHOLD || Math.abs(gs.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        wasDrag.current = false;
        pan.setOffset({ x: posRef.current.x, y: posRef.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_e, gs) => {
        if (Math.abs(gs.dx) > DRAG_THRESHOLD || Math.abs(gs.dy) > DRAG_THRESHOLD) {
          wasDrag.current = true;
        }
        pan.x.setValue(gs.dx);
        pan.y.setValue(gs.dy);
      },
      onPanResponderRelease: (_e, gs) => {
        pan.flattenOffset();
        const rawX = posRef.current.x + gs.dx;
        const rawY = posRef.current.y + gs.dy;
        const clamped = {
          x: _clamp(rawX, EDGE_MARGIN, screenW - FAB_SIZE - EDGE_MARGIN),
          y: _clamp(rawY, EDGE_MARGIN, screenH - FAB_SIZE - EDGE_MARGIN),
        };
        Animated.spring(pan, {
          toValue: clamped,
          useNativeDriver: false,
          friction: 8,
          tension: 60,
        }).start(() => {
          posRef.current = clamped;
          AsyncStorage.setItem(posKey, JSON.stringify(clamped)).catch(() => {});
        });
      },
      onPanResponderTerminate: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  const handleTap = () => {
    // Se stavi trascinando, non aprire la calcolatrice
    if (wasDrag.current) {
      wasDrag.current = false;
      return;
    }
    setOpen(true);
  };

  if (!isPrimary) return null;

  return (
    <>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.fab,
          {
            left: pan.x,
            top: pan.y,
            right: undefined,
            bottom: undefined,
          },
        ]}
      >
        <Pressable
          testID="calc-fab"
          onPress={handleTap}
          style={styles.fabInner}
          accessibilityLabel="Apri calcolatrice (tieni premuto e trascina per spostare)"
        >
          <Ionicons name="calculator" size={26} color="#FFF" />
        </Pressable>
      </Animated.View>
      <CalculatorModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CalculatorModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const pathname = useSafePathname(); // V50.z480 — FIX crash web «pathname is not defined»: la variabile era definita solo nel FAB, non qui
  const safeBottom = useSafeBottom(); // V29.aq — inside modal so paddingBottom respects gesture bar
  const screenH = Dimensions.get("window").height;
  // V50.z14 — Sheet ridimensionabile via drag handle. minH mostra solo
  // display + prima riga, maxH mostra tutta la calcolatrice.
  const MIN_H = 240;
  const MAX_H = Math.min(560, Math.round(screenH * 0.72));
  const DEFAULT_H = Math.min(500, Math.round(screenH * 0.62));
  const heightAnim = useRef(new Animated.Value(DEFAULT_H)).current;
  const currentH = useRef(DEFAULT_H);
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [waiting, setWaiting] = useState(false);

  // V50.z14 — Animazione slide-in / slide-out (rimpiazza Modal transparent
  // così le pagine sottostanti restano scrollabili quando la calc è aperta)
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(600)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 60 }).start();
    } else if (mounted) {
      Animated.timing(translateY, { toValue: 600, duration: 220, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // V50.z14 — PanResponder sul drag handle: sposta il dito in giù per
  // schiacciare la calcolatrice e vedere la pagina sottostante; in su per
  // riespanderla. Snap ai limiti su release.
  const resizePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dy) > 3,
      onPanResponderGrant: () => { /* start */ },
      onPanResponderMove: (_e, gs) => {
        const next = Math.max(MIN_H, Math.min(MAX_H, currentH.current - gs.dy));
        heightAnim.setValue(next);
      },
      onPanResponderRelease: (_e, gs) => {
        const next = Math.max(MIN_H, Math.min(MAX_H, currentH.current - gs.dy));
        currentH.current = next;
        Animated.spring(heightAnim, { toValue: next, useNativeDriver: false, friction: 8 }).start();
      },
    }),
  ).current;

  const inputDigit = (d: string) => {
    if (waiting) {
      setDisplay(d);
      setWaiting(false);
    } else {
      setDisplay(display === "0" ? d : display + d);
    }
  };
  const inputDot = () => {
    if (waiting) { setDisplay("0."); setWaiting(false); return; }
    if (!display.includes(".")) setDisplay(display + ".");
  };
  const clear = () => { setDisplay("0"); setPrev(null); setOp(null); setWaiting(false); };
  const toggleSign = () => {
    setDisplay(display.startsWith("-") ? display.slice(1) : "-" + display);
  };
  const percent = () => {
    setDisplay(String(parseFloat(display) / 100));
  };
  const compute = (a: number, b: number, o: Op): number => {
    switch (o) {
      case "+": return a + b;
      case "-": return a - b;
      case "×": return a * b;
      case "÷": return b === 0 ? NaN : a / b;
      default: return b;
    }
  };
  const setOperator = (nextOp: Op) => {
    const current = parseFloat(display);
    if (prev == null) {
      setPrev(current);
    } else if (op) {
      const result = compute(prev, current, op);
      setDisplay(formatResult(result));
      setPrev(result);
    }
    setOp(nextOp);
    setWaiting(true);
  };
  const equals = () => {
    const current = parseFloat(display);
    if (op && prev != null) {
      const result = compute(prev, current, op);
      setDisplay(formatResult(result));
      setPrev(null);
      setOp(null);
      setWaiting(true);
    }
  };
  const backspace = () => {
    if (waiting) return;
    if (display.length <= 1 || (display.length === 2 && display.startsWith("-"))) {
      setDisplay("0");
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const Btn = ({ label, onPress, variant, span }: { label: string; onPress: () => void; variant?: "op" | "acc" | "eq" | "clr"; span?: 2 }) => (
    <Pressable
      testID={`calc-key-${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        span === 2 && { flex: 2.15 },
        variant === "op" && styles.keyOp,
        variant === "acc" && styles.keyAcc,
        variant === "eq" && styles.keyEq,
        variant === "clr" && styles.keyClr,
        pressed && { opacity: 0.65 },
      ]}
    >
      <Text style={[styles.keyTxt, (variant === "op" || variant === "eq" || variant === "clr") && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );

  if (!mounted || pathname === "/voice-enroll") return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={styles.overlayRoot}
      testID="calc-overlay"
    >
      <Animated.View
        style={[
          styles.sheet,
          {
            paddingBottom: safeBottom + 12,
            transform: [{ translateY }],
            height: heightAnim,
          },
        ]}
      >
        {/* V50.z14 — Drag handle: trascina in giù per schiacciare la calc,
            in su per riespanderla. Tocchi fuori dalla sheet NON chiudono più
            (l'utente può scrollare la pagina sottostante liberamente). */}
        <View {...resizePan.panHandlers} style={styles.dragHandleWrap}>
          <View style={styles.dragHandle} />
        </View>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headTitle}>Calcolatrice</Text>
            {op && prev != null ? (
              <Text style={styles.headSub}>{formatResult(prev)} {op}</Text>
            ) : null}
          </View>
          <Pressable testID="calc-close" onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={HT.muted} />
          </Pressable>
        </View>
        <View style={styles.displayBox}>
          <Text style={styles.displayTxt} numberOfLines={1} adjustsFontSizeToFit>{display}</Text>
        </View>
        <View style={styles.pad}>
          <View style={styles.row}>
            <Btn label="AC" onPress={clear} variant="clr" />
            <Btn label="±" onPress={toggleSign} variant="acc" />
            <Btn label="%" onPress={percent} variant="acc" />
            <Btn label="÷" onPress={() => setOperator("÷")} variant="op" />
          </View>
          <View style={styles.row}>
            <Btn label="7" onPress={() => inputDigit("7")} />
            <Btn label="8" onPress={() => inputDigit("8")} />
            <Btn label="9" onPress={() => inputDigit("9")} />
            <Btn label="×" onPress={() => setOperator("×")} variant="op" />
          </View>
          <View style={styles.row}>
            <Btn label="4" onPress={() => inputDigit("4")} />
            <Btn label="5" onPress={() => inputDigit("5")} />
            <Btn label="6" onPress={() => inputDigit("6")} />
            <Btn label="-" onPress={() => setOperator("-")} variant="op" />
          </View>
          <View style={styles.row}>
            <Btn label="1" onPress={() => inputDigit("1")} />
            <Btn label="2" onPress={() => inputDigit("2")} />
            <Btn label="3" onPress={() => inputDigit("3")} />
            <Btn label="+" onPress={() => setOperator("+")} variant="op" />
          </View>
          <View style={styles.row}>
            <Btn label="0" onPress={() => inputDigit("0")} span={2} />
            <Btn label="." onPress={inputDot} />
            <Btn label="=" onPress={equals} variant="eq" />
          </View>
          <View style={styles.rowSmall}>
            <Pressable testID="calc-backspace" onPress={backspace} style={styles.bsBtn}>
              <Ionicons name="backspace-outline" size={18} color={HT.muted} />
              <Text style={styles.bsTxt}>Cancella</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function formatResult(n: number): string {
  if (!isFinite(n)) return "Errore";
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(8)).toString();
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: HT.brand,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: "0 4px 12px rgba(0,0,0,0.25)" } as any,
      default: { shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6 },
    }),
    zIndex: 100,
  },
  fabInner: {
    width: "100%",
    height: "100%",
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  // V50.z14 — Overlay non-modale: pointerEvents="box-none" fa passare i tap
  // fuori dal sheet alla pagina sottostante (l'utente può scrollare mentre
  // la calcolatrice è aperta). Il sheet si chiude solo con la X.
  overlayRoot: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 200,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    backgroundColor: HT.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 20,
  },
  dragHandleWrap: {
    // Zona touch estesa attorno all'handle per un drag più facile con il dito
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 6,
    marginTop: -6,
    marginBottom: 4,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: HT.borderStrong,
  },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  headTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  headSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  displayBox: {
    backgroundColor: HT.card2,
    borderRadius: 12,
    padding: 14,
    alignItems: "flex-end",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: HT.border,
  },
  displayTxt: { fontSize: 34, fontWeight: "700", color: HT.text },
  pad: { gap: 6 },
  row: { flexDirection: "row", gap: 6 },
  rowSmall: { alignItems: "center", marginTop: 2 },
  key: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    backgroundColor: HT.border,
    alignItems: "center",
    justifyContent: "center",
  },
  keyTxt: { fontSize: 20, fontWeight: "600", color: HT.text },
  keyOp: { backgroundColor: '#F59E0B' },
  keyEq: { backgroundColor: HT.brand },
  keyClr: { backgroundColor: '#DC2626' },
  keyAcc: { backgroundColor: HT.borderStrong },
  bsBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  bsTxt: { color: HT.muted, fontWeight: "600", fontSize: 12 },
});

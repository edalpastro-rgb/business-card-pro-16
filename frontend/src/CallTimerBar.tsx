/**
 * V28.r — ActiveCallContext + CallTimerBar
 * Sostituisce il modal a schermo intero (V28.f) con una barra compatta fissa
 * in cima all'app, sempre visibile durante la chiamata attiva. L'utente può
 * navigare liberamente mentre il timer va avanti. Al tap su "Termina" la barra
 * PATCHa il log con la durata misurata.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";

type ActiveCall = {
  contactName?: string;
  contactPhone?: string;
  startedAt: number; // ms epoch
  logId?: string | null;
};

type Ctx = {
  active: ActiveCall | null;
  startCall: (info: { contactName?: string; contactPhone?: string }) => void;
  setLogId: (logId: string | null) => void;
  endCall: () => Promise<void>;
  dismiss: () => void; // Chiudi senza salvare durata
};

const ActiveCallCtx = createContext<Ctx>({
  active: null,
  startCall: () => {},
  setLogId: () => {},
  endCall: async () => {},
  dismiss: () => {},
});

export function ActiveCallProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null);

  const startCall = useCallback((info: { contactName?: string; contactPhone?: string }) => {
    setActive({
      contactName: info.contactName || "Chiamata in corso",
      contactPhone: info.contactPhone,
      startedAt: Date.now(),
      logId: null,
    });
  }, []);

  const setLogId = useCallback((logId: string | null) => {
    setActive((cur) => (cur ? { ...cur, logId } : cur));
  }, []);

  const endCall = useCallback(async () => {
    const cur = active;
    setActive(null);
    if (cur?.logId) {
      const duration = Math.floor((Date.now() - cur.startedAt) / 1000);
      try {
        await api(`/calls/log/${cur.logId}`, { method: "PATCH", body: { duration_sec: duration } });
      } catch {
        /* silent */
      }
    }
  }, [active]);

  const dismiss = useCallback(() => {
    setActive(null);
  }, []);

  const value = useMemo<Ctx>(() => ({ active, startCall, setLogId, endCall, dismiss }), [active, startCall, setLogId, endCall, dismiss]);
  return <ActiveCallCtx.Provider value={value}>{children}</ActiveCallCtx.Provider>;
}

export function useActiveCall(): Ctx {
  return useContext(ActiveCallCtx);
}

function fmtMS(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Barra compatta mostrata SOTTO la status bar quando c'è una chiamata attiva.
 * Occupa una fascia orizzontale in cima all'app (position: absolute), non blocca
 * la navigazione né gli altri touch events sottostanti (solo l'area della barra).
 */
export function CallTimerBar() {
  const { active, endCall, dismiss } = useActiveCall();
  const insets = useSafeAreaInsets();
  const [seconds, setSeconds] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!active) return;
    setSeconds(Math.floor((Date.now() - active.startedAt) / 1000));
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - active.startedAt) / 1000));
    }, 1000);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      clearInterval(id);
      loop.stop();
    };
  }, [active, pulse]);

  useEffect(() => {
    // Chiude il menu di "Chiudi senza salvare" quando la chiamata cambia
    if (!active) setMenuOpen(false);
  }, [active]);

  if (!active) return null;

  const onTerminate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await endCall();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: (insets.top || 0) + 4 }]}
    >
      <View style={styles.bar} testID="call-timer-bar">
        <Animated.View style={[styles.dot, { transform: [{ scale: pulse }] }]} pointerEvents="none" />
        <Ionicons name="call" size={16} color="#FFF" />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{active.contactName}</Text>
          {active.contactPhone ? (
            <Text style={styles.phone} numberOfLines={1}>{active.contactPhone}</Text>
          ) : null}
        </View>
        <View style={styles.timerBox}>
          <Text style={styles.timer} testID="call-timer-bar-value">{fmtMS(seconds)}</Text>
        </View>
        <Pressable
          testID="call-timer-bar-end"
          onPress={onTerminate}
          disabled={busy}
          style={[styles.endBtn, busy && { opacity: 0.6 }]}
          accessibilityLabel="Termina chiamata"
          hitSlop={6}
        >
          <Ionicons name="call" size={16} color="#FFF" style={{ transform: [{ rotate: "135deg" }] }} />
          <Text style={styles.endBtnTxt}>Termina</Text>
        </Pressable>
        <Pressable
          testID="call-timer-bar-more"
          onPress={() => setMenuOpen((v) => !v)}
          style={styles.moreBtn}
          hitSlop={6}
          accessibilityLabel="Altre opzioni"
        >
          <Ionicons name="ellipsis-vertical" size={16} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </View>
      {menuOpen && (
        <View style={styles.menu} testID="call-timer-menu">
          <Pressable
            testID="call-timer-bar-dismiss"
            onPress={() => { setMenuOpen(false); dismiss(); }}
            style={styles.menuItem}
          >
            <Ionicons name="close-circle" size={16} color="#94A3B8" />
            <Text style={styles.menuItemTxt}>Chiudi senza registrare durata</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    ...Platform.select({
      ios: { shadowColor: "#0F172A", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 8 },
      default: { boxShadow: "0 4px 12px rgba(15,23,42,0.25)" as any },
    }),
  },
  dot: { position: "absolute", left: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFF", opacity: 0.6 },
  info: { flex: 1, minWidth: 0, marginLeft: 4 },
  name: { color: "#FFF", fontSize: 13, fontWeight: "800", letterSpacing: -0.2 },
  phone: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontWeight: "600" },
  timerBox: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  timer: { color: "#FFF", fontSize: 14, fontWeight: "900", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DC2626",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  endBtnTxt: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  moreBtn: { padding: 4 },
  menu: {
    marginTop: 4,
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 6,
    alignSelf: "flex-end",
    ...Platform.select({
      ios: { shadowColor: "#0F172A", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
      default: { boxShadow: "0 4px 12px rgba(15,23,42,0.15)" as any },
    }),
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  menuItemTxt: { fontSize: 12, color: "#1B2B4B", fontWeight: "700" },
});

/**
 * V28.f — CallTimerOverlay
 * Visible call timer that starts as soon as the user taps "Chiama".
 * Shows the count-up (mm:ss), the contact name/phone, and a Termina button.
 * On close, PATCHes the persisted call log with the measured duration.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";

const C = { navy: "#1B2B4B", primary: "#FF6B35", success: "#16A34A", muted: "#94A3B8" };

type Props = {
  visible: boolean;
  logId: string | null;
  contactName?: string;
  contactPhone?: string;
  onClose: () => void;
};

function fmtMS(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function CallTimerOverlay({ visible, logId, contactName, contactPhone, onClose }: Props) {
  const [seconds, setSeconds] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    startedAtRef.current = Date.now();
    setSeconds(0);
    const id = setInterval(() => {
      const started = startedAtRef.current || Date.now();
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => { clearInterval(id); loop.stop(); };
  }, [visible, pulse]);

  const finish = async () => {
    const duration = seconds;
    onClose();
    if (logId) {
      try {
        await api(`/calls/log/${logId}`, { method: "PATCH", body: { duration_sec: duration } });
      } catch {
        /* silent — timer accuracy is best-effort */
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="call-timer-card">
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulse }] }]} pointerEvents="none" />
          <View style={styles.iconWrap}>
            <Ionicons name="call" size={26} color="#FFF" />
          </View>
          <Text style={styles.name} numberOfLines={1}>{contactName || "Chiamata in corso"}</Text>
          {contactPhone ? <Text style={styles.phone}>{contactPhone}</Text> : null}
          <Text style={styles.timer} testID="call-timer-value">{fmtMS(seconds)}</Text>
          <Text style={styles.hint}>La chiamata parte sul telefono. Al termine tocca &quot;Termina&quot; per registrare la durata.</Text>
          <Pressable testID="call-timer-end" onPress={finish} style={styles.endBtn}>
            <Ionicons name="call" size={18} color="#FFF" style={{ transform: [{ rotate: "135deg" }] }} />
            <Text style={styles.endBtnTxt}>Termina e registra</Text>
          </Pressable>
          <Pressable testID="call-timer-dismiss" onPress={onClose} style={styles.dismissBtn} hitSlop={8}>
            <Text style={styles.dismissTxt}>Chiudi senza salvare durata</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#FFF", borderRadius: 22, padding: 24, alignItems: "center", position: "relative", overflow: "hidden", ...Platform.select({ ios: { shadowColor: "#0F172A", shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 12 }, default: {} }) },
  pulseRing: { position: "absolute", top: 24, width: 100, height: 100, borderRadius: 50, borderWidth: 6, borderColor: C.success + "44" },
  iconWrap: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.success, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  name: { fontSize: 17, fontWeight: "800", color: C.navy, letterSpacing: -0.2, textAlign: "center" },
  phone: { fontSize: 13, color: C.muted, marginTop: 2, fontWeight: "600" },
  timer: { fontSize: 44, fontWeight: "900", color: C.navy, marginTop: 12, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  hint: { fontSize: 11, color: C.muted, textAlign: "center", marginTop: 10, lineHeight: 16 },
  endBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#DC2626", paddingVertical: 14, paddingHorizontal: 18, borderRadius: 999, marginTop: 16, alignSelf: "stretch" },
  endBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  dismissBtn: { marginTop: 10, paddingVertical: 6 },
  dismissTxt: { fontSize: 12, color: C.muted, fontWeight: "600", textDecorationLine: "underline" },
});

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground, Modal, Linking, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { MasterVoiceRecorder } from "@/src/MasterVoiceRecorder";

type Banner = { item_id: string; kind: string; title?: string; body?: string; image_base64?: string | null; color?: string } | null;

type Alerts = { unread: number; latest: { contract_id: string; contract_number?: string; supplier?: string; created_by?: string; created_at?: string }[] };

export default function MasterScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [banner, setBanner] = useState<Banner>(null);
  const [alerts, setAlerts] = useState<Alerts>({ unread: 0, latest: [] });
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const pulseAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const [mt, al] = await Promise.all([
        api<{ item: Banner }>("/my-thing/random-banner").catch(() => ({ item: null })),
        api<Alerts>("/contracts/new-alerts").catch(() => ({ unread: 0, latest: [] })),
      ]);
      setBanner(mt.item || null);
      setAlerts(al);
    } catch (e) {
      console.warn("master load", e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (alerts.unread > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(0);
    }
  }, [alerts.unread, pulseAnim]);

  const dateStr = now.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const goto = (path: string) => { setMenuOpen(false); router.push(path as any); };

  const handleNewContract = async () => {
    // Mark as seen (clears the badge)
    try { await api("/contracts/mark-seen", { method: "POST" }); await load(); } catch {}
    router.push("/contract/new" as any);
  };

  const buttons: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; badge?: number }[] = [
    { label: "Agenda", icon: "calendar", color: "#0891B2", onPress: () => goto("/(tabs)/calendario") },
    { label: "New App", icon: "add-circle", color: "#16A34A", onPress: () => goto("/appointment/new") },
    { label: "New Contact", icon: "person-add", color: "#7C3AED", onPress: () => goto("/contact/new") },
    { label: "Chat Gruppo", icon: "chatbubbles", color: "#F59E0B", onPress: () => setChatPickerOpen(true) },
    { label: "My Web", icon: "globe", color: "#DB2777", onPress: () => goto("/my-web") },
    { label: "Calcolatrice", icon: "calculator", color: "#6366F1", onPress: () => setCalcOpen(true) },
    { label: "New CRT", icon: "document-text", color: "#059669", onPress: handleNewContract, badge: alerts.unread },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <LinearGradient colors={["#0F172A", "#1E3A8A", "#4C1D95"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} testID="master-back">
            <Ionicons name="chevron-back" size={22} color="#FFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>Ciao {(user?.name || "Master").split(" ")[0]}</Text>
            <Text style={styles.title}>Interfaccia Master</Text>
          </View>
          <View style={styles.clockWrap}>
            <Text style={styles.clockTime} testID="master-clock-time">{timeStr}</Text>
            <Text style={styles.clockDate} testID="master-clock-date">{dateStr}</Text>
          </View>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.menuBtn} testID="master-menu-btn">
            <Ionicons name="ellipsis-vertical" size={22} color="#FFF" />
          </Pressable>
        </View>

        {/* My Thing banner */}
        <Pressable onPress={() => router.push("/my-thing")} style={styles.bannerWrap} testID="master-banner">
          {banner?.image_base64 ? (
            <ImageBackground source={{ uri: `data:image/*;base64,${banner.image_base64}` }} style={styles.bannerImg} imageStyle={{ borderRadius: 16 }}>
              <LinearGradient colors={["transparent", "rgba(0,0,0,0.55)"]} style={styles.bannerOverlay}>
                <Text style={styles.bannerLabel}>My Thing</Text>
                {banner.title ? <Text style={styles.bannerTitle} numberOfLines={1}>{banner.title}</Text> : null}
                {banner.body ? <Text style={styles.bannerBody} numberOfLines={2}>{banner.body}</Text> : null}
              </LinearGradient>
            </ImageBackground>
          ) : (
            <LinearGradient colors={["#7C3AED", "#DB2777"]} style={styles.bannerFallback} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Ionicons name="images" size={28} color="#FFF" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.bannerLabel}>My Thing</Text>
                <Text style={styles.bannerBody}>Aggiungi immagini motivazionali da &quot;My Thing&quot;</Text>
              </View>
            </LinearGradient>
          )}
        </Pressable>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.grid}>
          {buttons.map((b) => (
            <MasterButton key={b.label} {...b} pulseAnim={pulseAnim} />
          ))}
        </View>
        <MasterVoiceRecorder />
      </ScrollView>

      {/* 3-dot menu */}
      <Modal transparent visible={menuOpen} onRequestClose={() => setMenuOpen(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuBox} onStartShouldSetResponder={() => true}>
            <MenuItem icon="color-palette" color="#7C3AED" label="Setting App" hint="Cambia tema e colori" onPress={() => goto("/settings-app")} testID="menu-settings" />
            <MenuItem icon="business" color="#059669" label="New Corporate" hint="Crea nuova area business" onPress={() => goto("/corporate/new")} testID="menu-corporate" />
            <MenuItem icon="person-add" color="#DB2777" label="Invita Collaboratore" hint="Genera link / QR con ruolo" onPress={() => goto("/invite-collaborator")} testID="menu-invite" />
            <MenuItem icon="gift" color="#F59E0B" label="Invita Cliente" hint="Trial gratuito con link estensibile" onPress={() => goto("/invitati")} testID="menu-invite-client" />
          </View>
        </Pressable>
      </Modal>

      {/* Chat Gruppo picker */}
      <Modal transparent visible={chatPickerOpen} onRequestClose={() => setChatPickerOpen(false)} animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setChatPickerOpen(false)}>
          <View style={styles.sheetBox} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Chat Gruppo</Text>
            <PickerRow icon="chatbubbles" color="#0891B2" label="Chat interna" hint="Team collaborators" onPress={() => { setChatPickerOpen(false); router.push("/(tabs)/chat"); }} testID="chat-internal" />
            <PickerRow icon="logo-whatsapp" color="#25D366" label="WhatsApp" hint="Apri gruppo esterno" onPress={() => Linking.openURL("https://web.whatsapp.com")} testID="chat-whatsapp" />
            <PickerRow icon="paper-plane" color="#0088CC" label="Telegram" hint="Apri gruppo esterno" onPress={() => Linking.openURL("https://web.telegram.org")} testID="chat-telegram" />
            <Pressable onPress={() => setChatPickerOpen(false)} style={styles.sheetCancel}><Text style={styles.sheetCancelTxt}>Chiudi</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Calculator modal */}
      <Modal transparent visible={calcOpen} onRequestClose={() => setCalcOpen(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setCalcOpen(false)}>
          <View style={styles.calcBox} onStartShouldSetResponder={() => true}>
            <View style={styles.calcHeader}>
              <Text style={styles.calcTitle}>Calcolatrice</Text>
              <Pressable onPress={() => setCalcOpen(false)}><Ionicons name="close" size={22} color={theme.color.onSurface} /></Pressable>
            </View>
            <Calculator />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function MasterButton({ label, icon, color, onPress, badge, pulseAnim }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; badge?: number; pulseAnim: Animated.Value }) {
  return (
    <Pressable onPress={onPress} style={styles.btnCell} testID={`master-btn-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <View style={[styles.btnCircle, { backgroundColor: color }]}>
        <Ionicons name={icon} size={28} color="#FFF" />
        {typeof badge === "number" && badge > 0 && (
          <Animated.View
            style={[
              styles.badgeDot,
              {
                opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
              },
            ]}
            testID="master-new-crt-badge"
          >
            <Text style={styles.badgeTxt}>{badge > 9 ? "9+" : String(badge)}</Text>
          </Animated.View>
        )}
      </View>
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

function MenuItem({ icon, color, label, hint, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; hint: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress} testID={testID}>
      <View style={[styles.menuIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.menuHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
    </Pressable>
  );
}

function PickerRow({ icon, color, label, hint, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; hint: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.pickerRow} onPress={onPress} testID={testID}>
      <View style={[styles.menuIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.menuHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function Calculator() {
  const [display, setDisplay] = useState("0");
  const [operand, setOperand] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const inputNum = (n: string) => {
    if (waiting) { setDisplay(n); setWaiting(false); }
    else setDisplay((d) => d === "0" ? n : d + n);
  };
  const inputDot = () => {
    if (waiting) { setDisplay("0."); setWaiting(false); return; }
    if (!display.includes(".")) setDisplay((d) => d + ".");
  };
  const clear = () => { setDisplay("0"); setOperand(null); setOperator(null); setWaiting(false); };
  const compute = (a: number, b: number, op: string) => {
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "×": return a * b;
      case "÷": return b === 0 ? NaN : a / b;
      default: return b;
    }
  };
  const applyOp = (op: string) => {
    const cur = parseFloat(display);
    if (operand !== null && operator && !waiting) {
      const res = compute(operand, cur, operator);
      setDisplay(String(res));
      setOperand(res);
    } else {
      setOperand(cur);
    }
    setOperator(op);
    setWaiting(true);
  };
  const equals = () => {
    if (operand === null || !operator) return;
    const res = compute(operand, parseFloat(display), operator);
    setDisplay(String(Number.isFinite(res) ? +res.toFixed(10) : "Errore"));
    setOperand(null);
    setOperator(null);
    setWaiting(true);
  };
  const percent = () => setDisplay((d) => String(parseFloat(d) / 100));
  const negate = () => setDisplay((d) => String(-parseFloat(d)));

  const btns: { label: string; type?: "op" | "eq" | "fn"; onPress: () => void }[][] = [
    [
      { label: "AC", type: "fn", onPress: clear },
      { label: "±", type: "fn", onPress: negate },
      { label: "%", type: "fn", onPress: percent },
      { label: "÷", type: "op", onPress: () => applyOp("÷") },
    ],
    [
      { label: "7", onPress: () => inputNum("7") },
      { label: "8", onPress: () => inputNum("8") },
      { label: "9", onPress: () => inputNum("9") },
      { label: "×", type: "op", onPress: () => applyOp("×") },
    ],
    [
      { label: "4", onPress: () => inputNum("4") },
      { label: "5", onPress: () => inputNum("5") },
      { label: "6", onPress: () => inputNum("6") },
      { label: "-", type: "op", onPress: () => applyOp("-") },
    ],
    [
      { label: "1", onPress: () => inputNum("1") },
      { label: "2", onPress: () => inputNum("2") },
      { label: "3", onPress: () => inputNum("3") },
      { label: "+", type: "op", onPress: () => applyOp("+") },
    ],
    [
      { label: "0", onPress: () => inputNum("0") },
      { label: ".", onPress: inputDot },
      { label: "=", type: "eq", onPress: equals },
    ],
  ];

  return (
    <View>
      <View style={styles.calcDisplay}>
        <Text style={styles.calcDisplayTxt} numberOfLines={1}>{display}</Text>
        {operator && <Text style={styles.calcOpTxt}>{operator}</Text>}
      </View>
      {btns.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", marginTop: 6 }}>
          {row.map((b) => {
            const isZero = b.label === "0";
            const isEq = b.type === "eq";
            const isOp = b.type === "op";
            const isFn = b.type === "fn";
            const bg = isEq ? "#7C3AED" : isOp ? "#F59E0B" : isFn ? "#E5E7EB" : "#F1F5F9";
            const fg = isEq || isOp ? "#FFF" : theme.color.onSurface;
            return (
              <Pressable
                key={b.label}
                onPress={b.onPress}
                testID={`calc-${b.label}`}
                style={[styles.calcBtn, { backgroundColor: bg, flex: isZero ? 2 : 1, marginLeft: isZero ? 0 : 4 }]}
              >
                <Text style={[styles.calcBtnTxt, { color: fg }]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  hero: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  menuBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  hi: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  title: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  clockWrap: { alignItems: "flex-end", marginRight: 6 },
  clockTime: { color: "#FFF", fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  clockDate: { color: "rgba(255,255,255,0.75)", fontSize: 10, textTransform: "capitalize" },

  bannerWrap: { marginTop: 14, height: 120, borderRadius: 16, overflow: "hidden" },
  bannerImg: { flex: 1 },
  bannerOverlay: { flex: 1, padding: 14, justifyContent: "flex-end" },
  bannerFallback: { flex: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center" },
  bannerLabel: { color: "#FFF", fontSize: 10, fontWeight: "800", letterSpacing: 1, opacity: 0.85 },
  bannerTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", marginTop: 2 },
  bannerBody: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 2 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  btnCell: { width: "31%", alignItems: "center", marginBottom: 18 },
  btnCircle: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  btnLabel: { marginTop: 8, fontSize: 12, fontWeight: "700", color: theme.color.onSurface, textAlign: "center" },
  badgeDot: { position: "absolute", top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "#16A34A", justifyContent: "center", alignItems: "center", paddingHorizontal: 5, borderWidth: 2, borderColor: "#FFF" },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  menuBox: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, paddingBottom: 30 },
  menuItem: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 10 },
  menuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  menuHint: { fontSize: 11, color: theme.color.muted, marginTop: 1 },

  sheetBox: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, paddingBottom: 30 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginBottom: 8, paddingHorizontal: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  sheetCancel: { marginTop: 10, alignItems: "center", padding: 12, backgroundColor: "#F1F5F9", borderRadius: 10 },
  sheetCancelTxt: { fontWeight: "800", color: theme.color.onSurface },

  calcBox: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 14, paddingBottom: 30 },
  calcHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  calcTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  calcDisplay: { backgroundColor: "#0F172A", borderRadius: 12, padding: 18, alignItems: "flex-end" },
  calcDisplayTxt: { color: "#FFF", fontSize: 40, fontWeight: "700", fontVariant: ["tabular-nums"] },
  calcOpTxt: { color: "#F59E0B", fontSize: 14, fontWeight: "800" },
  calcBtn: { flex: 1, aspectRatio: 1.15, borderRadius: 14, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  calcBtnTxt: { fontSize: 22, fontWeight: "700" },
});

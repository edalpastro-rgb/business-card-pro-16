import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ImageBackground, Modal, Linking, Animated, Easing, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { MasterVoiceRecorder } from "@/src/MasterVoiceRecorder";
import { MasterPromoteModal } from "@/src/MasterPromoteModal";
import { MetricBoxClickable, MetricDrillModal, MetricKey } from "@/src/StatMetrics";
import { ModuleErrorBoundary } from "@/src/shared";
import { NeuralPatternBg } from "@/src/NeuralPatternBg";

type Banner = { item_id: string; kind: string; title?: string; body?: string; image_base64?: string | null; color?: string } | null;
type MyThingImage = { item_id: string; image_base64?: string | null };
type Alerts = { unread: number; latest: { contract_id: string; contract_number?: string; supplier?: string; created_by?: string; created_at?: string }[] };
type ReportStats = { period: string; start?: string; end?: string; stats: { energy: any; network: any } };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };

export default function MasterRoute() {
  return (
    <ModuleErrorBoundary moduleName="master">
      <MasterScreen />
    </ModuleErrorBoundary>
  );
}

function MasterScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [banner, setBanner] = useState<Banner>(null); // kept only for optional title/body from random-banner
  const [myThingImages, setMyThingImages] = useState<string[]>([]);
  const [myThingIdx, setMyThingIdx] = useState(0);
  const [alerts, setAlerts] = useState<Alerts>({ unread: 0, latest: [] });
  // V45 — Badge counter for pending rule proposals (Master)
  const [pendingProposals, setPendingProposals] = useState<number>(0);
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [report, setReport] = useState<ReportStats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [drill, setDrill] = useState<{ metric: MetricKey; area: "energy" | "network" | null; color: string; title: string } | null>(null);
  const [voiceSignal, setVoiceSignal] = useState(0);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [voicePhase, setVoicePhase] = useState<"idle" | "recording" | "processing" | "review" | "saving">("idle");
  const voicePulse = React.useRef(new Animated.Value(1)).current;
  const pulseAnim = React.useRef(new Animated.Value(0)).current;
  const bannerFade = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // V45 — Poll pending rule proposals count (30s) so the "Insegna ad Axon"
  // tile shows a red badge when new suggestions are ready to review.
  useEffect(() => {
    let alive = true;
    const fetchCount = async () => {
      try {
        const r = await api<{ pending: number }>("/axon/rule-proposals/count-pending");
        if (alive) setPendingProposals(r.pending || 0);
      } catch { /* silent */ }
    };
    fetchCount();
    const t = setInterval(fetchCount, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const load = useCallback(async () => {
    try {
      const [mt, mtList, al, r, s] = await Promise.all([
        api<{ item: Banner }>("/my-thing/random-banner").catch(() => ({ item: null })),
        api<{ items: MyThingImage[] }>("/my-thing", { query: { kind: "image" } }).catch(() => ({ items: [] })),
        api<Alerts>("/contracts/new-alerts").catch(() => ({ unread: 0, latest: [] })),
        api<ReportStats>("/reports", { query: { period: "day" } }).catch(() => null),
        api<Settings>("/settings").catch(() => null),
      ]);
      setBanner(mt.item || null);
      const imgs = (mtList.items || [])
        .map((it) => it.image_base64)
        .filter((v): v is string => !!v && v.length > 20);
      // Shuffle for random rotation
      for (let i = imgs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      }
      setMyThingImages(imgs);
      setMyThingIdx(0);
      setAlerts(al);
      setReport(r);
      setSettings(s);
    } catch (e) {
      console.warn("master load", e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Auto-cycle My Thing images every 10s with crossfade (same UX as Home)
  useEffect(() => {
    if (myThingImages.length < 2) return;
    const id = setInterval(() => {
      Animated.timing(bannerFade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
        setMyThingIdx((n) => (n + 1) % myThingImages.length);
        Animated.timing(bannerFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
      });
    }, 10000);
    return () => clearInterval(id);
  }, [myThingImages, bannerFade]);

  const currentBannerImg = myThingImages.length > 0 ? myThingImages[myThingIdx] : (banner?.image_base64 || null);

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

  // Voice recording pulse (red button when recording)
  useEffect(() => {
    if (voicePhase === "recording") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(voicePulse, { toValue: 1.15, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(voicePulse, { toValue: 1.0, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      voicePulse.setValue(1);
    }
  }, [voicePhase, voicePulse]);

  const dateStr = now.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const goto = (path: string) => { setMenuOpen(false); router.push(path as any); };

  const handleNewContract = async () => {
    // Mark as seen (clears the badge)
    try { await api("/contracts/mark-seen", { method: "POST" }); await load(); } catch {}
    router.push("/contract/new" as any);
  };

  const buttons: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; badge?: number; pulse?: Animated.Value }[] = [
    { label: "Agenda", icon: "calendar", color: "#0891B2", onPress: () => goto("/(tabs)/calendario") },
    { label: "New Contact", icon: "person-add", color: "#7C3AED", onPress: () => goto("/contact/new") },
    { label: "Chat Gruppo", icon: "chatbubbles", color: "#F59E0B", onPress: () => setChatPickerOpen(true) },
    { label: "Calcolatrice", icon: "calculator", color: "#6366F1", onPress: () => setCalcOpen(true) },
    { label: "My Web", icon: "globe", color: "#DB2777", onPress: () => goto("/my-web") },
    { label: "New CRT", icon: "document-text", color: "#059669", onPress: handleNewContract, badge: alerts.unread },
    { label: "New App", icon: "add-circle", color: "#16A34A", onPress: () => goto("/appointment/new") },
    {
      label: voicePhase === "recording" ? "Ferma registrazione" : "Registra audio",
      icon: voicePhase === "recording" ? "stop" : "mic",
      color: voicePhase === "recording" ? "#DC2626" : "#7C3AED",
      onPress: () => {
        if (voicePhase === "recording") {
          setVoiceStopSignal((s) => s + 1);
        } else if (voicePhase === "idle") {
          setVoiceSignal((s) => s + 1);
        }
      },
      pulse: voicePhase === "recording" ? voicePulse : undefined,
    },
    { label: "I miei audio", icon: "folder-open", color: "#8B5CF6", onPress: () => goto("/my-audios") },
    { label: "Analizza bolletta", icon: "flash", color: "#EA580C", onPress: () => goto("/bill-quick") },
    { label: "I miei file", icon: "folder-open", color: "#0891B2", onPress: () => goto("/master-files") },
    { label: "Biglietto da visita", icon: "id-card", color: "#7C3AED", onPress: () => goto("/business-card") },
    { label: "Banner Evento", icon: "megaphone", color: "#F59E0B", onPress: () => goto("/event-banners") },
    { label: "Script Telefonata", icon: "document-text", color: "#0F766E", onPress: () => goto("/call-script-config") },
    { label: "Insegna ad Axon", icon: "sparkles", color: "#FF6B35", onPress: () => goto("/ai-teach"), badge: pendingProposals },
    { label: "Cruscotto", icon: "grid", color: "#0EA5E9", onPress: () => goto("/cruscotto") },
    { label: "Azioni rapide", icon: "flash", color: "#8B5CF6", onPress: () => goto("/quick-actions") },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* V29.ba — Header hero: stesso tema tecnico della Home (sfondo navy scuro +
          circuiti neurali cyan) MA senza i loghi AdvisorOS/AxonOS. */}
      <View style={styles.hero}>
        <LinearGradient
          colors={["#0B1E38", "#0F172A", "#1E293B"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <NeuralPatternBg
            width={390}
            height={140}
            color="#38BDF8"
            opacity={0.28}
            pulseColor="#22D3EE"
          />
        </View>
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
      </View>

      {/* My Thing banner spostato FUORI dall'hero (V29.az) così l'immagine
          dashboard resta fully-visible come in Home. */}
      <Pressable
        onPress={() => router.push("/my-thing")}
        style={[styles.bannerWrap, { marginHorizontal: 16, marginTop: 12 }]}
        testID="master-banner"
      >
        {currentBannerImg ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: bannerFade }]} pointerEvents="none">
            <ImageBackground
              source={{ uri: currentBannerImg }}
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
              imageStyle={Platform.OS === "web" ? ({ objectFit: "cover", width: "100%", height: "100%" } as any) : { borderRadius: 12 }}
            />
          </Animated.View>
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

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <View style={styles.grid}>
          {buttons.map((b) => (
            <MasterButton key={b.label} {...b} pulseAnim={pulseAnim} />
          ))}
        </View>

        {/* V29.o — Promuovi ad agente (solo Master) */}
        <Pressable
          testID="master-promote-btn"
          onPress={() => setPromoteOpen(true)}
          style={masterExtraStyles.promoteBtn}
        >
          <View style={masterExtraStyles.promoteIcon}>
            <Ionicons name="rocket" size={20} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={masterExtraStyles.promoteTitle}>Promuovi ad agente</Text>
            <Text style={masterExtraStyles.promoteSub}>Trova un contatto e assegnagli le autorizzazioni operative</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#EA580C" />
        </Pressable>

        {/* V26.o — Statistiche giornaliere (spostate da Home) */}
        <View style={styles.statsSection}>
          <Text style={styles.statsHeader}>Statistiche di oggi</Text>
          {(["energy", "network"] as const).map((areaKey) => {
            const s = (report?.stats as any)?.[areaKey];
            const color = areaKey === "energy" ? (settings?.energy_color || theme.color.energy) : (settings?.network_color || theme.color.network);
            const title = areaKey === "energy" ? (settings?.energy_title || "Consulente Energetico") : (settings?.network_title || "Networker");
            const iconName: any = areaKey === "energy" ? "flash" : "people";
            const openDrill = (m: MetricKey) => setDrill({ metric: m, area: areaKey, color, title });
            return (
              <View key={areaKey} style={[styles.statCardV, { borderLeftColor: color }]} testID={`master-stat-${areaKey}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <View style={[styles.statBadge, { backgroundColor: color + "22" }]}>
                    <Ionicons name={iconName} size={14} color={color} />
                  </View>
                  <Text style={[styles.statTitle, { color }]} numberOfLines={1}>{title}</Text>
                </View>
                <View style={styles.metricsGrid}>
                  <MetricBoxClickable testID={`master-${areaKey}-appointments_done`} label="Appuntamenti fatti" value={s?.appointments_done ?? 0} color={color} onPress={() => openDrill("appointments_done")} />
                  <MetricBoxClickable testID={`master-${areaKey}-appointments_total`} label="Totale programmati" value={s?.appointments_total ?? 0} color={color} onPress={() => openDrill("appointments_total")} />
                  <MetricBoxClickable testID={`master-${areaKey}-phone_done`} label="Telefonate fatte" value={s?.phone_done ?? 0} color={color} onPress={() => openDrill("phone_done")} />
                  <MetricBoxClickable testID={`master-${areaKey}-contracts`} label="Contratti" value={s?.contracts ?? 0} color={color} onPress={() => openDrill("contracts")} />
                  <MetricBoxClickable testID={`master-${areaKey}-products`} label="Prodotti venduti" value={s?.products ?? 0} color={color} onPress={() => openDrill("products")} />
                </View>
              </View>
            );
          })}
        </View>

        <MasterVoiceRecorder
          hideTrigger
          startSignal={voiceSignal}
          stopSignal={voiceStopSignal}
          onPhaseChange={setVoicePhase}
        />
      </ScrollView>

      {/* 3-dot menu */}
      <Modal transparent visible={menuOpen} onRequestClose={() => setMenuOpen(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuBox} onStartShouldSetResponder={() => true}>
            <MenuItem icon="color-palette" color="#7C3AED" label="Setting App" hint="Cambia tema e colori" onPress={() => goto("/settings-app")} testID="menu-settings" />
            <MenuItem icon="analytics" color="#0EA5E9" label="Team Insights" hint="Metriche + profilo AI dei collaboratori" onPress={() => goto("/team-insights")} testID="menu-team-insights" />
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
      <MetricDrillModal
        visible={!!drill}
        onClose={() => setDrill(null)}
        metric={drill?.metric || null}
        area={drill?.area || null}
        startIso={report?.start || ""}
        endIso={report?.end || ""}
        color={drill?.color || theme.color.brandPrimary}
        title={drill?.title || "Dettaglio"}
      />
      <MasterPromoteModal visible={promoteOpen} onClose={() => setPromoteOpen(false)} />
    </SafeAreaView>
  );
}

function MasterButton({ label, icon, color, onPress, badge, pulseAnim, pulse }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; badge?: number; pulseAnim: Animated.Value; pulse?: Animated.Value }) {
  return (
    <Pressable onPress={onPress} style={styles.btnCell} testID={`master-btn-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <Animated.View style={[styles.btnCircle, { backgroundColor: color }, pulse ? { transform: [{ scale: pulse }] } : null]}>
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
      </Animated.View>
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

const masterExtraStyles = StyleSheet.create({
  promoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FED7AA",
    backgroundColor: "#FFF7ED",
    marginTop: 12,
    marginBottom: 4,
  },
  promoteIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#EA580C",
    alignItems: "center", justifyContent: "center",
  },
  promoteTitle: { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  promoteSub: { fontSize: 12, color: "#9A3412", opacity: 0.75, marginTop: 2, lineHeight: 16 },
});



const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  hero: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    // V29.az — Height fissa uguale all'header Home (140px full-screen) così
    // l'immagine dashboard AdvisorOS/AxonOS è visibile alla stessa dimensione.
    height: 140,
    backgroundColor: "#0B1E38",
    overflow: "hidden",
    position: "relative",
    justifyContent: "flex-start",
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    // V29.az — Scrim trasparente per allineamento visivo esatto con l'header
    // Home (che non ha scrim). La leggibilità dei testi è garantita dal
    // textShadow applicato su .hi, .title, .clockTime, .clockDate.
    backgroundColor: "transparent",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10, zIndex: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  menuBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  hi: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    // V29.az — Text shadow leggero per garantire leggibilità sopra l'immagine
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  title: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  clockWrap: { alignItems: "flex-end", marginRight: 6 },
  clockTime: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  clockDate: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 10,
    textTransform: "capitalize",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  bannerWrap: { marginTop: 8, height: 100, borderRadius: 12, overflow: "hidden", position: "relative", backgroundColor: "#F1F5F9", zIndex: 1 },
  bannerImg: { flex: 1 },
  bannerOverlay: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  bannerFallback: { flex: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center" },
  bannerLabel: { color: "#FFF", fontSize: 9, fontWeight: "800", letterSpacing: 1, opacity: 0.85 },
  bannerTitle: { color: "#FFF", fontSize: 13, fontWeight: "800", marginTop: 1 },
  bannerBody: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  btnCell: { width: "31%", alignItems: "center", marginBottom: 22 },
  // V29.ba — Stile "Optima": icona full-round su cerchio colorato con shadow
  // marcato (effetto rialzato/3D) e leggero highlight in alto.
  btnCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  btnLabel: { marginTop: 10, fontSize: 12, fontWeight: "700", color: theme.color.onSurface, textAlign: "center" },
  badgeDot: { position: "absolute", top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "#16A34A", justifyContent: "center", alignItems: "center", paddingHorizontal: 5, borderWidth: 2, borderColor: "#FFF" },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  myAudiosLink: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#F5F3FF", borderRadius: 20, borderWidth: 1, borderColor: "#DDD6FE" },
  myAudiosLinkTxt: { color: "#7C3AED", fontWeight: "800", fontSize: 13 },
  statsSection: { marginTop: 6, marginBottom: 16 },
  statsHeader: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface, marginBottom: 10, letterSpacing: 0.3, textTransform: "uppercase" },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, borderLeftWidth: 4, padding: 10, gap: 4 },
  statCardV: { backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, borderLeftWidth: 4, padding: 10, marginBottom: 10 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statTitle: { fontSize: 12, fontWeight: "800", marginBottom: 4 },
  statRowLine: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  statNum: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, minWidth: 22 },
  statLbl: { fontSize: 11, color: theme.color.muted },

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

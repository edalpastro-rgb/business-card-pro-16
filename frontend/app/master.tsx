import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ImageBackground, Modal, Linking, Animated, Easing, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { ModuleErrorBoundary } from "@/src/shared";

// V49.g — Header Master allineato all'header Home: usa la stessa immagine.
const HOME_HEADER_IMG = require("@/assets/images/advisoros-home-header.jpg");

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
  // V46 — Safe bottom padding for slide-up sheets on Android gesture-nav / iOS home indicator.
  const bottomPad = useBottomSheetPadding();
  // V49 — Reorder mode + persisted button order. (Assistance quick-call buttons
  //        rimossi in V49 — spostati nel pannello "Comunica con l'azienda" della Home.)
  const [reorderMode, setReorderMode] = useState<boolean>(false);
  const [buttonOrder, setButtonOrder] = useState<string[] | null>(null);

  // Load saved button order on mount
  useEffect(() => {
    (async () => {
      try {
        const ord = await AsyncStorage.getItem("master.buttons.order.v1");
        if (ord) {
          try {
            const parsed = JSON.parse(ord);
            if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
              setButtonOrder(parsed);
            }
          } catch { /* ignore malformed */ }
        }
      } catch { /* ignore */ }
    })();
  }, []);
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

  // V48 — Apply saved order (if any), placing unknown/new buttons at the end.
  const orderedButtons = useMemo(() => {
    if (!buttonOrder || !buttonOrder.length) return buttons;
    const byLabel = new Map(buttons.map((b) => [b.label, b] as const));
    const seen = new Set<string>();
    const out: typeof buttons = [];
    for (const label of buttonOrder) {
      const b = byLabel.get(label);
      if (b && !seen.has(label)) {
        out.push(b);
        seen.add(label);
      }
    }
    for (const b of buttons) {
      if (!seen.has(b.label)) out.push(b);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buttons, buttonOrder]);

  const persistOrder = useCallback(async (list: { label: string }[]) => {
    try {
      await AsyncStorage.setItem(
        "master.buttons.order.v1",
        JSON.stringify(list.map((b) => b.label)),
      );
    } catch { /* ignore */ }
  }, []);

  const moveButton = useCallback(
    (label: string, direction: "left" | "right") => {
      const current = orderedButtons.map((b) => b.label);
      const i = current.indexOf(label);
      if (i < 0) return;
      const j = direction === "left" ? i - 1 : i + 1;
      if (j < 0 || j >= current.length) return;
      const next = [...current];
      [next[i], next[j]] = [next[j], next[i]];
      setButtonOrder(next);
      // Persist immediately (async, best-effort)
      const reordered = next
        .map((lbl) => orderedButtons.find((b) => b.label === lbl))
        .filter(Boolean) as typeof orderedButtons;
      persistOrder(reordered);
    },
    [orderedButtons, persistOrder],
  );

  const resetOrder = useCallback(async () => {
    setButtonOrder(null);
    try {
      await AsyncStorage.removeItem("master.buttons.order.v1");
    } catch { /* ignore */ }
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* V49.g — Header allineato alla Home: stessa immagine di sfondo con
          loghi AdvisorOS/AxonOS integrati, data/ora TL e avatar TR come
          overlay corner. Il tap sull'avatar apre il menu Master (Setting App,
          Team Insights, New Corporate, Invita Collaboratore, Invita Cliente)
          — lo stesso menu che era precedentemente aperto dall'icona ellipsis. */}
      <View style={styles.brandHeader}>
        <View style={styles.brandHeaderBox} testID="master-brand-header">
          <Image
            source={HOME_HEADER_IMG}
            resizeMode="cover"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              borderRadius: 12,
            }}
          />
          <View pointerEvents="none" style={styles.brandHeaderScrim} />
          <View style={styles.brandHeaderCornerTL} pointerEvents="none">
            <Text style={styles.brandHeaderDate} numberOfLines={1} testID="master-clock-time">
              {now.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
              {" · "}
              {now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={8}
            style={styles.brandHeaderCornerTR}
            testID="master-menu-btn"
          >
            {user?.avatar_base64 ? (
              <Image source={{ uri: user.avatar_base64 }} style={styles.brandHeaderAvatar} />
            ) : (
              <View style={styles.brandHeaderAvatarFallback}>
                <Text style={styles.brandHeaderAvatarTxt}>
                  {user?.name?.[0]?.toUpperCase() || "?"}
                </Text>
              </View>
            )}
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
        {/* V48 — Reorder mode toggle bar */}
        <View style={masterExtraStyles.reorderBar}>
          {reorderMode ? (
            <>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="swap-horizontal" size={14} color="#EA580C" />
                <Text style={masterExtraStyles.reorderTxt}>
                  Modalità riordino attiva — usa le frecce ←/→ su ogni bottone
                </Text>
              </View>
              <Pressable
                onPress={resetOrder}
                hitSlop={6}
                style={masterExtraStyles.reorderResetBtn}
                testID="master-reorder-reset"
              >
                <Text style={masterExtraStyles.reorderResetTxt}>Reset</Text>
              </Pressable>
              <Pressable
                onPress={() => setReorderMode(false)}
                hitSlop={6}
                style={masterExtraStyles.reorderDoneBtn}
                testID="master-reorder-done"
              >
                <Text style={masterExtraStyles.reorderDoneTxt}>Fatto</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => setReorderMode(true)}
              hitSlop={6}
              style={masterExtraStyles.reorderStartBtn}
              testID="master-reorder-start"
            >
              <Ionicons name="reorder-three" size={14} color="#0EA5E9" />
              <Text style={masterExtraStyles.reorderStartTxt}>Riordina bottoni</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.grid}>
          {orderedButtons.map((b, idx) => (
            <View key={b.label} style={{ position: "relative" }}>
              <Pressable
                onLongPress={() => setReorderMode((v) => !v)}
                delayLongPress={450}
                style={{ borderRadius: 22 }}
                testID={`master-btn-wrap-${b.label}`}
              >
                <MasterButton
                  {...b}
                  pulseAnim={pulseAnim}
                  onPress={reorderMode ? () => {} : b.onPress}
                />
              </Pressable>
              {reorderMode && (
                <View style={masterExtraStyles.reorderArrows} pointerEvents="box-none">
                  <Pressable
                    onPress={() => moveButton(b.label, "left")}
                    hitSlop={6}
                    style={[masterExtraStyles.reorderArrowBtn, idx === 0 && { opacity: 0.3 }]}
                    disabled={idx === 0}
                    testID={`master-move-left-${b.label}`}
                  >
                    <Ionicons name="chevron-back" size={14} color="#FFF" />
                  </Pressable>
                  <Pressable
                    onPress={() => moveButton(b.label, "right")}
                    hitSlop={6}
                    style={[
                      masterExtraStyles.reorderArrowBtn,
                      idx === orderedButtons.length - 1 && { opacity: 0.3 },
                    ]}
                    disabled={idx === orderedButtons.length - 1}
                    testID={`master-move-right-${b.label}`}
                  >
                    <Ionicons name="chevron-forward" size={14} color="#FFF" />
                  </Pressable>
                </View>
              )}
            </View>
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
          <View style={[styles.menuBox, { paddingBottom: bottomPad }]} onStartShouldSetResponder={() => true}>
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
          <View style={[styles.sheetBox, { paddingBottom: bottomPad }]} onStartShouldSetResponder={() => true}>
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
          <View style={[styles.calcBox, { paddingBottom: bottomPad }]} onStartShouldSetResponder={() => true}>
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

function MasterButton({ label, icon, color, onPress, onLongPress, badge, pulseAnim, pulse }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; onLongPress?: () => void; badge?: number; pulseAnim: Animated.Value; pulse?: Animated.Value }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={500} style={styles.btnCell} testID={`master-btn-${label.replace(/\s+/g, '-').toLowerCase()}`}>
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
  // V48 — Reorder mode + assistance-number modal styles
  reorderBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    minHeight: 32,
  },
  reorderStartBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#E0F2FE",
    borderWidth: 1,
    borderColor: "#7DD3FC",
  },
  reorderStartTxt: { fontSize: 11, color: "#0369A1", fontWeight: "800" },
  reorderTxt: { fontSize: 11, color: "#78350F", fontWeight: "700", flexShrink: 1 },
  reorderResetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  reorderResetTxt: { fontSize: 11, color: "#64748B", fontWeight: "800" },
  reorderDoneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EA580C",
  },
  reorderDoneTxt: { fontSize: 11, color: "#FFF", fontWeight: "800" },
  reorderArrows: {
    position: "absolute",
    top: -6,
    right: -6,
    flexDirection: "row",
    gap: 4,
  },
  reorderArrowBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  supportBtnSaveTxt: { fontSize: 13, fontWeight: "700", color: "#FFF" },
});



const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  // V49.g — Header allineato alla Home (stessa immagine + data TL + avatar TR).
  brandHeader: {
    backgroundColor: "transparent",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  brandHeaderBox: {
    height: 140,
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.35)",
    borderRadius: 12,
    position: "relative",
    overflow: "hidden",
    justifyContent: "center",
  },
  brandHeaderScrim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  brandHeaderCornerTL: {
    position: "absolute",
    top: 4,
    left: 10,
    zIndex: 2,
  },
  brandHeaderCornerTR: {
    position: "absolute",
    top: 4,
    right: 8,
    zIndex: 2,
  },
  brandHeaderDate: {
    color: "rgba(186,230,253,0.85)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "capitalize",
  },
  brandHeaderAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: "#FFF1E9",
  },
  brandHeaderAvatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FF6B35",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF1E9",
  },
  brandHeaderAvatarTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
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
    // V49.g — Nome storico "btnCircle": la forma è passata da cerchio a
    // quadrato con angoli leggermente arrotondati (borderRadius 16 su 72×72)
    // su richiesta utente. Manteniamo colori, icone, testi, badge e
    // funzionalità di riordino identici. Nessun altro punto dell'app usa
    // esattamente questa forma quindi il cambio è locale al Master.
    width: 72,
    height: 72,
    borderRadius: 16,
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

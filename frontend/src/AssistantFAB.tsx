// V50.z311 — Pulsante flottante globale che apre la chat Axon (estratto da AssistantChat.tsx, nessuna modifica logica)
import React, { useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, AppState, View, Text, Pressable, Platform, Animated, Easing, Image, PanResponder, Dimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, usePathname } from "expo-router";
import { useIsDesktop } from "@/src/hooks/useResponsive";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AXON_OPEN_CHAT_EVENT } from "@/src/axonProactive";
import { CHAT_OPEN_KEY } from "@/src/utils/appStatePersist";
import { axnApi, AXN_UNREAD_CHANGED_EVENT } from "@/src/axonNotifications";
import { AXON_UNREAD_EVENT, checkAxonUnread, markAxonRead } from "@/src/axonUnread"; // V50.z383 — messaggio Axon non letto → verde lampeggiante
import { AssistantChatModal } from "@/src/AssistantChat";
import { styles } from "@/src/assistant/chatStyles";

const AXONOS_LOGO_WHITE_ASPECT = 1375 / 294;
const AXONOS_LOGO_WHITE = require("@/assets/images/axonos-logo-white.png");

/**
 * Global floating action button that opens the assistant chat.
 * Visible on all screens (mounted at root layout).
 */
export function AssistantFAB() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() || "";
  const isDesktop = useIsDesktop(); // V50.z409
  const [open, setOpen] = useState(false);
  const [unreadInfoReq, setUnreadInfoReq] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal

  // V50.z100 — FAB trascinabile con snap agli edge e persistenza posizione.
  const FAB_SIZE = 56;
  const EDGE_MARGIN = 16;
  const winRef = useRef(Dimensions.get("window"));
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panOffset = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const dragStartTs = useRef(0);
  const [posReady, setPosReady] = useState(false);
  // Base bottom (senza offset drag) — ricalcolato per render.
  const tabBarHeight = 60 + Math.max(insets.bottom || 0, 20);
  const baseBottom = tabBarHeight + 12;
  // V50.z385 — il FAB Axon sta in basso a SINISTRA: la calcolatrice (in basso a destra) non lo copre più → nessun rialzo
  const bottom = baseBottom;

  // Carica posizione salvata (solo una volta).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("axon_fab_pos_v2"); // V50.z385 — nuova chiave: ancoraggio a sinistra
        if (raw && !cancelled) {
          const p = JSON.parse(raw);
          if (typeof p?.x === "number" && typeof p?.y === "number") {
            pan.setValue({ x: p.x, y: p.y });
            panOffset.current = { x: p.x, y: p.y };
          }
        }
      } catch { /* ignore */ }
      if (!cancelled) setPosReady(true);
    })();
    return () => { cancelled = true; };
  }, [pan]);

  // Aggiorna larghezza schermo su rotate.
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      winRef.current = window;
    });
    return () => { try { (sub as any)?.remove?.(); } catch {} };
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // V50.z385 — il TAP è gestito SOLO dalla Pressable interna (onPress nativo, indipendente dal gesto):
      // il PanResponder non «ruba» più il tocco all'inizio e si attiva solo con un movimento reale (> 8 px).
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderGrant: () => {
        didDrag.current = false;
        dragStartTs.current = Date.now();
        pan.setOffset({ x: panOffset.current.x, y: panOffset.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, g) => {
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) didDrag.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(e, g);
      },
      onPanResponderRelease: async (_e, g) => {
        pan.flattenOffset();
        const win = winRef.current;
        // V50.z385 — Ancoraggio BOTTOM-LEFT (left = EDGE_MARGIN, bottom = `bottom`): non si sovrappone più al FAB calcolatrice.
        // dx > 0 sposta a destra; dy > 0 sposta in giù.
        const anchorBottom = bottom;

        // Ricava x/y attuali (dai valori .__getValue()).
        const curX = (pan.x as any).__getValue();
        const curY = (pan.y as any).__getValue();

        // Snap orizzontale al bordo più vicino (fabLeftPos in coordinate schermo).
        const fabLeftPos = EDGE_MARGIN + curX;
        const centerX = fabLeftPos + FAB_SIZE / 2;
        const snapLeft = centerX < win.width / 2;
        // offsetX target: sinistra → 0 ; destra → win.width - FAB_SIZE - EDGE_MARGIN*2
        const targetOffsetX = snapLeft ? 0 : (win.width - FAB_SIZE - EDGE_MARGIN * 2);

        // Clamp verticale: non uscire sopra la status bar né sotto il tab bar.
        const maxUpOffset = -(win.height - anchorBottom - FAB_SIZE - Math.max(insets.top || 0, 20));
        const clampedY = Math.min(0, Math.max(maxUpOffset, curY));

        try {
          Animated.parallel([
            Animated.spring(pan.x, { toValue: targetOffsetX, useNativeDriver: false, friction: 7, tension: 60 }),
            Animated.spring(pan.y, { toValue: clampedY, useNativeDriver: false, friction: 7, tension: 60 }),
          ]).start();
        } catch { /* non bloccare il tap se l'animazione fallisce */ }

        panOffset.current = { x: targetOffsetX, y: clampedY };
        try {
          await AsyncStorage.setItem(
            "axon_fab_pos_v2",
            JSON.stringify({ x: targetOffsetX, y: clampedY })
          );
        } catch { /* ignore */ }

        // Se non c'è stato drag significativo → tratta come tap (fallback:
        // il tap principale è gestito dalla Pressable interna, vedi V50.z131).
        if (!didDrag.current && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6 && (Date.now() - dragStartTs.current) < 500) {
          fireTapRef.current?.();
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // V50.z83 — Poll info-requests: se ci sono richieste non lette, badge + blink veloce
  // V50.z248 — + avvisi CRITICI non letti (axon-notifications/unread-count.critical) → lampeggio ROSSO pulsante finché
  // l'utente non apre la notifica. Refresh: ogni 30 s, al ritorno in foreground, all'arrivo di una push, dopo lettura.
  const [criticalUnread, setCriticalUnread] = useState(0);
  // V50.z419 — Briefing spontaneo (collaboratore): colore AMBRA distinto da rosso (critico) e verde (messaggio non letto). Livello 1 = solo colore.
  const [briefingNew, setBriefingNew] = useState(false);
  const briefingTs = useRef(0);
  useEffect(() => {
    if (!user || open) return;
    if (Date.now() - briefingTs.current < 5 * 60 * 1000) return;
    briefingTs.current = Date.now();
    api<{ has_new: boolean }>("/axon/briefing").then((b) => setBriefingNew(!!b?.has_new)).catch(() => {});
  }, [user, pathname, open]);
  useEffect(() => { if (open) setBriefingNew(false); }, [open]);
  // V50.z383 — messaggio di Axon non letto (chat chiusa): il pulsante lampeggia in VERDE finché la chat non viene aperta
  const [axonUnread, setAxonUnread] = useState(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const r = await api<{ pending: number; unread: number }>("/info-requests/count");
        if (!cancelled) setUnreadInfoReq(r?.unread || 0);
      } catch { /* ignore */ }
      try {
        const n = await axnApi.unread();
        if (!cancelled) setCriticalUnread(n?.critical || 0);
      } catch { /* ignore */ }
      void checkAxonUnread(openRef.current);
    };
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    const appSub = AppState.addEventListener("change", (st) => { if (st === "active") fetchCount(); });
    const evSub = DeviceEventEmitter.addListener(AXN_UNREAD_CHANGED_EVENT, (r: any) => { if (typeof r?.critical === "number") setCriticalUnread(r.critical); else fetchCount(); });
    const unreadSub = DeviceEventEmitter.addListener(AXON_UNREAD_EVENT, (r: any) => { if (!cancelled) setAxonUnread(!!r?.unread && !openRef.current); });
    let pushSub: { remove: () => void } | null = null;
    if (Platform.OS !== "web") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Notif = require("expo-notifications");
        pushSub = Notif.addNotificationReceivedListener(() => { setTimeout(fetchCount, 800); });
      } catch { /* Expo Go/web */ }
    }
    return () => { cancelled = true; clearInterval(iv); appSub.remove(); evSub.remove(); unreadSub.remove(); pushSub?.remove(); };
  }, [user]);

  // V50.z383 — chat aperta = messaggi letti: memorizza la lettura e spegne il verde; anche alla chiusura (tutto ciò che
  // è arrivato mentre era aperta è stato letto) → il pulsante torna viola normale
  const everOpened = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (open) everOpened.current = true;
    else if (!everOpened.current) return;
    setAxonUnread(false);
    void markAxonRead();
  }, [open, user]);

  // V50.z383 — Lampeggio VERDE (opacità del velo verde 0 ↔ 0.95) attivo solo con un messaggio Axon non letto
  const greenBlink = useRef(new Animated.Value(0)).current;
  const showGreen = axonUnread && !open && criticalUnread <= 0;
  useEffect(() => {
    if (!showGreen) { greenBlink.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(greenBlink, { toValue: 1, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(greenBlink, { toValue: 0, duration: 550, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ]));
    loop.start();
    return () => { loop.stop(); greenBlink.setValue(0); };
  }, [showGreen, greenBlink]);
  const greenOpacity = greenBlink.interpolate({ inputRange: [0, 1], outputRange: [0, 0.95] });

  // V50.z248 — Alone rosso pulsante (scale 1→1.7, opacità 0.75→0) attivo solo con avvisi critici non letti
  const redPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (criticalUnread <= 0) { redPulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(redPulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
      Animated.timing(redPulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); redPulse.setValue(0); };
  }, [criticalUnread, redPulse]);
  const haloScale = redPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.75] });
  const haloOpacity = redPulse.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.85, 0.7, 0] });

  // Blink loop attivo solo quando ci sono unread
  useEffect(() => {
    if (unreadInfoReq > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.35, duration: 500, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); blink.setValue(1); };
    } else {
      blink.setValue(1);
    }
  }, [unreadInfoReq, blink]);

  // Handler tap FAB (usa ref per evitare closure stale nel PanResponder).
  const handlePress = () => {
    // V50.z248 — Avvisi critici non letti: apri il centro notifiche (la lettura ferma il lampeggio rosso)
    if (criticalUnread > 0) {
      router.push("/axon-notifications?unread=1" as any);
      return;
    }
    // Se ci sono richieste info non lette, apri prima quella pagina invece del chat modal
    if (unreadInfoReq > 0) {
      router.push("/info-requests" as any);
      return;
    }
    setOpen(true);
  };
  const handlePressRef = useRef(handlePress);
  useEffect(() => { handlePressRef.current = handlePress; });
  // V50.z196 — Blocco 9: apertura chat da bubble proattive / notifiche / segnale vocale esterno (ViolaWake-ready).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(AXON_OPEN_CHAT_EVENT, () => setOpen(true));
    return () => sub.remove();
  }, []);
  // V50.z242 — BUG-STATE-001: ricorda se la chat era aperta → al cold start nativo la riapre (entro 12 h).
  const openRestored = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web" || !user?.user_id || openRestored.current) return;
    openRestored.current = true;
    (async () => {
      try {
        const [[, flag], [, at]] = await AsyncStorage.multiGet([CHAT_OPEN_KEY, CHAT_OPEN_KEY + "_at"]);
        if (flag !== "1" || !at || Date.now() - Number(at) > 12 * 3600 * 1000) return;
        setTimeout(() => setOpen(true), 700);
      } catch { /* ignore */ }
    })();
  }, [user?.user_id]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (open) AsyncStorage.multiSet([[CHAT_OPEN_KEY, "1"], [CHAT_OPEN_KEY + "_at", String(Date.now())]]).catch(() => {});
    else AsyncStorage.removeItem(CHAT_OPEN_KEY).catch(() => {});
  }, [open]);
  // V50.z131 — Tap robusto: la Pressable interna gestisce il tap in modo
  // nativo (indipendente dalla negoziazione del PanResponder, che su alcune
  // schermate con liste lunghe — es. Contatti — non arrivava al release).
  // Il PanResponder resta solo per il drag. Guard anti doppio-fire (400ms).
  const lastTapTs = useRef(0);
  const fireTap = () => {
    const now = Date.now();
    if (now - lastTapTs.current < 400) return;
    lastTapTs.current = now;
    handlePressRef.current?.();
  };
  const fireTapRef = useRef(fireTap);
  useEffect(() => { fireTapRef.current = fireTap; });

  // Hide when not logged in — e durante la registrazione vocale (V50.z407: il FAB copriva il footer Annulla/Avanti)
  if (!user || pathname === "/voice-enroll") return null;

  return (
    <>
      <Animated.View
        pointerEvents={posReady || isDesktop ? "box-none" : "none"}
        style={[
          styles.fabWrap,
          isDesktop
            // V50.z415 — WEB DESKTOP: overlay FISSO in basso a destra, a sinistra della calcolatrice (24 + 56 + 16 = 96 px dal bordo).
            // Niente drag né posizione salvata (una posizione memorizzata da un'altra finestra lo portava fuori schermo → «FAB sparito»).
            ? { bottom: 24, right: 96, transform: [] }
            : {
                bottom,
                left: EDGE_MARGIN,
                // NOTA: qui SOLO valori JS-driven (pan). Se si mescolano con valori
                // useNativeDriver:true (pulse/blink) l'intero transform diventa
                // "native" e la spring del rilascio lancia un'eccezione → il tap
                // non viene mai gestito su Android/iOS.
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                ],
              },
        ]}
        {...(isDesktop ? {} : panResponder.panHandlers)}
      >
        <Animated.View
          style={{
            opacity: unreadInfoReq > 0 && criticalUnread <= 0 ? blink : 1,
            transform: [{ scale: pulse }],
          }}
        >
        {criticalUnread > 0 ? (
          <Animated.View pointerEvents="none" style={[styles.fabHalo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]} testID="assistant-fab-critical-halo" />
        ) : null}
        <Pressable
          style={[styles.fab, briefingNew && !showGreen && criticalUnread <= 0 && styles.fabBriefing, criticalUnread > 0 && styles.fabCritical, showGreen && styles.fabUnreadGreen]}
          onPress={fireTap}
          hitSlop={14}
          pressRetentionOffset={24}
          accessibilityRole="button"
          accessibilityLabel={criticalUnread > 0 ? `Avviso critico: ${criticalUnread} notifiche urgenti non lette — tocca per aprire` : unreadInfoReq > 0 ? `Apri richieste info (${unreadInfoReq} nuove) — trascina per spostare` : showGreen ? "Nuovo messaggio di Axon non letto — tocca per aprire la chat" : "Apri assistente AI — trascina per spostare"}
          testID="assistant-fab"
        >
          {showGreen ? (
            <Animated.View pointerEvents="none" style={[styles.fabGreenOverlay, { opacity: greenOpacity }]} testID="assistant-fab-unread-green" />
          ) : null}
          <Image
            source={AXONOS_LOGO_WHITE}
            style={{ width: 46, height: Math.round(46 / AXONOS_LOGO_WHITE_ASPECT) }}
            resizeMode="contain"
            testID="assistant-fab-logo"
          />
          <View style={styles.fabDot} />
          {criticalUnread > 0 ? (
            <View style={[styles.fabBadge, styles.fabBadgeCritical]} testID="assistant-fab-critical-badge">
              <Text style={styles.fabBadgeTxt}>!</Text>
            </View>
          ) : unreadInfoReq > 0 ? (
            <View style={styles.fabBadge} testID="assistant-fab-badge">
              <Text style={styles.fabBadgeTxt}>{unreadInfoReq > 9 ? "9+" : String(unreadInfoReq)}</Text>
            </View>
          ) : null}
        </Pressable>
        </Animated.View>
      </Animated.View>
      <AssistantChatModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

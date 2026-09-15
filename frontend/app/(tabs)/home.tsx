import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, RefreshControl, ActivityIndicator, ScrollView, Image, ImageBackground, Platform, Animated, Easing, Alert, AppState } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect, useRootNavigationState, usePathname, useLocalSearchParams } from "expo-router";
import Svg, { Circle, G } from "react-native-svg";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CallActionSheet, CallTarget } from "@/src/CallActionSheet";
import { CallScriptOverlay } from "@/src/CallScriptOverlay";
import { CompanyContactSheet } from "@/src/CompanyContactSheet";
import { HomeEventBanner } from "@/src/HomeEventBanner";
import { AlarmHomeWidget } from "@/src/AlarmHomeWidget";
import { DrawerMenu } from "@/src/DrawerMenu";
import { DashboardWidgetsSection } from "@/src/DashboardWidgetsSection";
import { HeaderWeatherBadge } from "@/src/WeatherWidget";
import { DeadlineActionsSheet, DeadlineItem } from "@/src/DeadlineActionsSheet";
const APPT_TODAY_WIDGET = ["appointments_today"];
import { HomeTipsBanner } from "@/src/HomeTipsBanner";
import { CgymAlertStrip } from "@/src/corporate-gym/CgymAlertStrip"; // Corporate Gym (Blocco 1)
import { ProactiveBubbles } from "@/src/ProactiveBubbles"; // V50.z196 — Blocco 9: bubble proattive AxonOS
import { SetupProcessingBadge } from "@/src/SetupProcessingBadge"; // V50.z216 — Blocco 5: «AxonOS sta leggendo i tuoi file…»
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

// V29.aq — Header dashboard image (loaded as local bundled asset so it works
// offline on APK/IPA builds). Full-bleed dark image with AdvisorOS + AxonOS
// branding. Aspect 2:1 (2000x1000).
import { BrandHeaderImage } from "@/src/BrandHeaderImage"; // V50.z232

/* ────────────────────────────────────────────────────────────────
   V27 — Modern Dashboard Redesign
   Palette: primary orange #FF6B35 · secondary navy #1B2B4B
   White background · rounded shadow cards · bold KPIs · SVG charts
   ──────────────────────────────────────────────────────────────── */
const C = {
  primary: "#FF6B35",
  primarySoft: "#FFF1E9",
  navy: "#1B2B4B",
  navySoft: "#EEF1F7",
  white: "#FFFFFF",
  bg: "#FFFFFF",
  border: "#EEF0F4",
  muted: "#7A8794",
  text: "#111820",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  warning: "#F59E0B",
  warningSoft: "#FEF3C7",
};

type CustomArea = { id: string; name: string; color: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; custom_areas?: CustomArea[] };
type Callback = { callback_id: string; title: string; area: "energy" | "network"; scheduled_at: string; note: string; done: boolean; contact_id?: string; phone?: string };
type ApptStats = { mine: { total: number; done: number; undone: number }; group: { total: number; done: number; undone: number } };
// V28.b — My Thing banner can rotate BOTH images and messages (Messaggi tab)
type MyThingItem = {
  item_id: string;
  kind: "message" | "image" | "event" | "anniversary";
  title?: string | null;
  body?: string | null;
  image_base64?: string | null;
  color?: string | null;
  active?: boolean;
  // V28.d — banner customization
  font_family?: string | null;
  font_size?: string | null;
};
type MyThingBannerSlide =
  | { kind: "image"; image: string }
  | {
      kind: "message";
      title: string;
      body: string;
      color: string;
      fontFamily: string | undefined;
      fontSize: number;
      textColor: string;
    };

// V28.d — helpers shared with /my-thing editor (kept in-lined here to avoid a
// cross-module import for such a tiny utility set).
function _hLuminance(hex: string): number {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function _hContrastText(bg: string): string {
  return _hLuminance(bg) > 0.72 ? "#1B2B4B" : "#FFFFFF";
}
function _hFontFamily(key: string | null | undefined): string | undefined {
  switch ((key || "system") as string) {
    case "serif":
      return Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, 'Times New Roman', serif" });
    case "monospace":
      return Platform.select({ ios: "Menlo", android: "monospace", default: "'SF Mono', Menlo, Consolas, monospace" });
    case "rounded":
      return Platform.select({ ios: "Avenir Next", android: "sans-serif-medium", default: "'Nunito', 'Avenir Next', system-ui, sans-serif" });
    default:
      return undefined;
  }
}
function _hFontSize(key: string | null | undefined): number {
  switch ((key || "medium") as string) {
    case "small":  return 13;
    case "large":  return 20;
    default:       return 16;
  }
}

// V29.aq — Header con immagine bundled locale (offline-safe). Nessuna
// animazione hero, nessun URL remoto: l'immagine include già i loghi
// AdvisorOS + AxonOS su sfondo dark tech.

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pagePad = usePageBottomPadding();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscription, setSubscription] = useState<{ status: string; days_left?: number | null; is_active: boolean } | null>(null);
  const [myThingSlides, setMyThingSlides] = useState<MyThingBannerSlide[]>([]);
  const [myThingIdx, setMyThingIdx] = useState(0);
  // V28.e — Tap-to-pause the banner (user request: NON aprire la scheda di modifica)
  const [bannerPaused, setBannerPaused] = useState(false);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  // V28.e — Script overlay for callbacks (opens ONLY on user's manual tap)
  const [scriptTarget, setScriptTarget] = useState<{ name: string; phone?: string } | null>(null);
  const [apptStats, setApptStats] = useState<ApptStats | null>(null);
  const [contactsCount, setContactsCount] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  // V29 — Scadenze imminenti (widget Home)
  const [deadlines, setDeadlines] = useState<any[]>([]);
  const [deadlinesDays, setDeadlinesDays] = useState<number>(60);
  // V50.z138 — Tap sul filtro attivo (o sulla ×) → chiude/resetta la vista scadenze
  const [dlCollapsed, setDlCollapsed] = useState(false);
  // V50.j — Header FISSO (rimossa animazione di collapse su scroll).
  //   Motivo: animare `height` richiede useNativeDriver:false, che rialloca
  //   layout ad ogni frame di scroll → "effetto scatto" visibile su Android.
  //   Preferiamo scroll fluido (native driver possibile perché non serve
  //   più agganciare scrollY a nulla) rispetto a un mini-collapse del brand.
  const HEADER_HEIGHT = 140;
  const [deadlinesLoading, setDeadlinesLoading] = useState<boolean>(true);
  // V49 — "Comunica con l'azienda" panel (nome, email, numeri di servizio)
  const [companySheetOpen, setCompanySheetOpen] = useState<boolean>(false);
  // V50.z259 — Deep link /home?section=widgets|ritelefonate|appuntamenti|azioni|scadenze|statistiche|comunica (Navigatore Axon)
  const { section: sectionParam } = useLocalSearchParams<{ section?: string }>();
  const homeScrollRef = useRef<ScrollView | null>(null);
  const sectionY = useRef<Record<string, number>>({});
  const onSectionLayout = (key: string) => (e: any) => { sectionY.current[key] = e.nativeEvent.layout.y; };
  useEffect(() => {
    if (!sectionParam) return;
    if (sectionParam === "comunica") { setCompanySheetOpen(true); return; }
    if (sectionParam === "azioni") setQaOpen(true);
    const t = setTimeout(() => {
      const y = sectionY.current[sectionParam];
      if (y != null) homeScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }, 450);
    return () => clearTimeout(t);
  }, [sectionParam]);
  // V50.z25 — Sezione "Azioni rapide" collassabile (a scomparsa) con persistenza
  const [qaOpen, setQaOpen] = useState<boolean>(true);
  // V50.z35 — Drawer laterale con 6 categorie
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem("home_qa_open_v1");
        if (v === "0") setQaOpen(false);
      } catch { /* silent */ }
    })();
  }, []);
  const toggleQa = useCallback(() => {
    setQaOpen((prev) => {
      const next = !prev;
      AsyncStorage.setItem("home_qa_open_v1", next ? "1" : "0").catch(() => {});
      return next;
    });
  }, []);

  // V50.z111 — Tour guidato al primo avvio (per-utente, non per-device).
  // Fonte di verità: `user-settings.onboarding_done` lato server (sopravvive a
  // reinstall/cambio telefono); cache locale `onboarding_done_${user_id}` per
  // evitare la chiamata a ogni apertura. Viene marcato come fatto SOLO quando
  // l'utente conclude o salta il tour (non al semplice mount della pagina).
  // V50.z133 — Su nativo, a cold start con sessione salvata, Home è la prima
  // schermata: un `router.replace` lanciato prima che il navigator root sia
  // pronto viene ignorato silenziosamente ("REPLACE not handled") → il tour non
  // compariva più. Attendiamo `useRootNavigationState().key` e un breve tick.
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const onboardingTriggered = useRef(false);
  // V50.z158 — Apertura tour "a prova di bomba" (APK 1.0.50: ancora assente al
  // primo avvio). (1) Non dipendiamo più da navReady per DECIDERE (solo per il
  // ritardo iniziale); (2) usiamo `push` (gestito sempre) alternato a `replace`;
  // (3) verifichiamo con `usePathname` che siamo davvero su /libretto e
  // ritentiamo fino a 5 volte a 1s di distanza. La chiave locale viene scritta
  // da libretto.tsx appena il tour compare (una volta per dispositivo).
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  useEffect(() => {
    if (!user?.user_id || onboardingTriggered.current) return;
    let mounted = true;
    const timers: any[] = [];
    (async () => {
      try {
        // V50.z120 — Per-device: a ogni nuova installazione il tour di benvenuto
        // viene mostrato una volta (poi mai più su quel dispositivo).
        const localKey = `onboarding_done_${user.user_id}`;
        const doneLocal = await AsyncStorage.getItem(localKey);
        if (doneLocal === "1" || !mounted) return;
        onboardingTriggered.current = true;
        const href = "/tour" as any; // V50.z257 — nuovo Tour conversazionale (4 schermate)
        const attempt = (n: number) => {
          if (!mounted || n > 5) return;
          if ((pathnameRef.current || "").includes("libretto")) return;
          try {
            if (n % 2 === 1) router.push(href); else router.replace(href);
          } catch { /* retry below */ }
          timers.push(setTimeout(() => attempt(n + 1), 1000));
        };
        timers.push(setTimeout(() => attempt(1), navReady ? 350 : 900));
      } catch { /* silent */ }
    })();
    return () => { mounted = false; timers.forEach((t) => clearTimeout(t)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.user_id]);

  // Update header clock every minute (aligned to the next :00 second)
  // V50.z159 — L'orologio usa SEMPRE l'ora locale del dispositivo (fuso dell'area
  // geografica). Su Android i timer JS vengono sospesi in background: al rientro
  // (AppState → active) e al focus della tab ri-sincronizziamo subito e
  // riallineiamo l'intervallo, così l'ora non resta indietro di minuti.
  useEffect(() => {
    let intervalId: any = null;
    let timeoutId: any = null;
    const arm = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      setNowTick(Date.now());
      const d = new Date();
      const msToNextMinute = (60 - d.getSeconds()) * 1000 - d.getMilliseconds();
      timeoutId = setTimeout(() => {
        setNowTick(Date.now());
        intervalId = setInterval(() => setNowTick(Date.now()), 60000);
      }, Math.max(500, msToNextMinute));
    };
    arm();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") arm(); });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      sub.remove();
    };
  }, []);
  useFocusEffect(useCallback(() => { setNowTick(Date.now()); }, []));

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [s, c, sub, mtImgs, mtMsgs, ast, cts, us, dl] = await Promise.all([
        api<Settings>("/settings"),
        api<{ items: Callback[] }>("/callbacks", { query: { day: today, include_done: true } }),
        api<any>("/subscription/status").catch(() => null),
        api<{ items: MyThingItem[] }>("/my-thing", { query: { kind: "image" } }).catch(() => ({ items: [] })),
        // V28.b — also fetch Messaggi so they appear in the rotating banner
        api<{ items: MyThingItem[] }>("/my-thing", { query: { kind: "message" } }).catch(() => ({ items: [] })),
        api<ApptStats>("/appointments/stats", { query: { range_days: 30 } }).catch(() => null),
        api<{ items: any[] }>("/contacts").catch(() => ({ items: [] })),
        api<any>("/user-settings").catch(() => null),
        api<any>("/deadlines/upcoming").catch(() => ({ items: [], days: 60 })),
      ]);
      setSettings(s);
      setCallbacks(c.items);
      setSubscription(sub);
      setApptStats(ast);
      setContactsCount((cts?.items || []).length);
      // V29 — Scadenze
      const winDays = Number(us?.deadlines_window_days) > 0 ? Number(us.deadlines_window_days) : 60;
      setDeadlinesDays(winDays);
      setDeadlines(Array.isArray(dl?.items) ? dl.items : []);
      setDeadlinesLoading(false);
      const imgs = (mtImgs.items || [])
        // V47 — Include only items where the `active` visibility flag is
        // explicitly ON. Legacy items (missing/null) default to true so we
        // don't hide historical images, but ANY falsy value (`false`, `"false"`,
        // `0`, `null` after an explicit toggle-off) is correctly excluded.
        .filter((it) => {
          const a = (it as { active?: unknown }).active;
          if (a === false || a === 0 || a === "false") return false;
          return true;
        })
        .map((it) => it.image_base64)
        .filter((v): v is string => !!v && v.length > 20);
      // Build combined banner slides (images + messages), shuffle for variety
      const messageSlides: MyThingBannerSlide[] = (mtMsgs.items || [])
        .filter((it) => {
          const a = (it as { active?: unknown }).active;
          if (a === false || a === 0 || a === "false") return false;
          return ((it.body || "").trim() || (it.title || "").trim());
        })
        .map((it) => {
          const bg = it.color || "#FFFFFF";
          return {
            kind: "message" as const,
            title: (it.title || "").trim(),
            body: (it.body || "").trim(),
            color: bg,
            fontFamily: _hFontFamily(it.font_family),
            fontSize: _hFontSize(it.font_size),
            textColor: _hContrastText(bg),
          };
        });
      const imageSlides: MyThingBannerSlide[] = imgs.map((img) => ({ kind: "image" as const, image: img }));
      const combined: MyThingBannerSlide[] = [...imageSlides, ...messageSlides];
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }
      setMyThingSlides(combined);
      setMyThingIdx(0);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresh at midnight
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 0 && d.getMinutes() < 2) load();
    }, 60000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-cycle My Thing banner (images + messages) — respects pause state
  const myThingFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (myThingSlides.length < 2 || bannerPaused) return;
    const id = setInterval(() => {
      Animated.timing(myThingFade, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
        setMyThingIdx((n) => (n + 1) % myThingSlides.length);
        Animated.timing(myThingFade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
      });
    }, 10000);
    return () => clearInterval(id);
  }, [myThingSlides, myThingFade, bannerPaused]);

  const myThingSlide = myThingSlides.length > 0 ? myThingSlides[myThingIdx] : null;

  // KPI derived values
  const nowMs = Date.now();
  const cbTodayTotal = callbacks.length;
  const cbDone = callbacks.filter((c) => c.done).length;
  const cbLate = callbacks.filter((c) => !c.done && new Date(c.scheduled_at).getTime() < nowMs).length;
  const cbPending = cbTodayTotal - cbDone;
  const cbEnergy = callbacks.filter((c) => c.area === "energy").length;
  const cbNetwork = callbacks.filter((c) => c.area === "network").length;
  const apptTotal = apptStats?.mine?.total || 0;
  const apptDone = apptStats?.mine?.done || 0;
  const apptUndone = apptStats?.mine?.undone || 0;

  // V29 — Cambio finestra scadenze: salva su user_settings e ricarica il widget
  const changeDeadlinesDays = useCallback(async (days: number) => {
    setDeadlinesDays(days);
    setDeadlinesLoading(true);
    try {
      await api("/user-settings", { method: "PUT", body: { deadlines_window_days: days } });
      const dl = await api<any>(`/deadlines/upcoming`, { query: { days } }).catch(() => ({ items: [] }));
      setDeadlines(Array.isArray(dl?.items) ? dl.items : []);
    } catch (e) {
      console.warn("changeDeadlinesDays failed", e);
    } finally {
      setDeadlinesLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* ── Header V29.aq: sfondo immagine dashboard locale (offline-safe).
          Riga 1: data/ora TL + avatar TR come overlay corner.
          L'immagine include già il logo AdvisorOS + AxonOS quindi non serve
          il fade animato con testo "Ciao, NOME". */}
      <View style={styles.brandHeader}>
        <View
          style={[styles.brandHeaderBox, { height: HEADER_HEIGHT }]}
          testID="home-brand-header"
        >
          {/* V50.z232 — header pulito + nuovo logo AxonOS piccolo; logo aziendale (Personalizzazione Aziendale) al posto di AdvisorOS se caricato */}
          <BrandHeaderImage radius={12} />
          {/* Gradient scrim per garantire leggibilità della data/ora sopra l'immagine */}
          <View pointerEvents="none" style={styles.brandHeaderScrim} />
          {/* V50.z132 — Mini icona meteo (sole/pioggia/neve) in basso a sinistra */}
          <HeaderWeatherBadge />

          {/* V29.ae — Layout header 80px: date/avatar come overlay corner */}
          <View style={styles.brandHeaderCornerTL} pointerEvents="none">
            <Text style={styles.brandHeaderDate} numberOfLines={1}>
              {new Date(nowTick).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
              {" · "}
              {new Date(nowTick).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
          {/* V50.z35 — Hamburger drawer (angolo top-left, sopra la data) */}
          <Pressable
            onPress={() => setDrawerOpen(true)}
            hitSlop={10}
            style={styles.brandHeaderHamburger}
            testID="home-drawer-open"
            accessibilityLabel="Apri menu completo"
          >
            <Ionicons name="menu" size={22} color="#FFF" />
          </Pressable>
          <Pressable onPress={() => router.push("/impostazioni" as any)} hitSlop={8} style={styles.brandHeaderCornerTR}>
            {user?.avatar_base64 ? (
              <Image source={{ uri: user.avatar_base64 }} style={styles.brandHeaderAvatar} />
            ) : (
              <View style={styles.brandHeaderAvatarFallback}>
                <Text style={styles.brandHeaderAvatarTxt}>{user?.name?.[0]?.toUpperCase() || "?"}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      <ScrollView
        ref={homeScrollRef}
        style={styles.scrollBg}
        contentContainerStyle={[styles.scroll, { paddingBottom: pagePad }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />}
      >
        {/* V50.z104 — Banner consigli utilizzo / broadcast super-admin */}
        <HomeTipsBanner />
        {/* Corporate Gym (Blocco 1) — striscia sottile: solo con sessioni obbligatorie non completate */}
        <CgymAlertStrip />
        {/* V50.z196 — Blocco 9: suggerimenti/alert proattivi di AxonOS (tap → chat) */}
        <ProactiveBubbles />
        {/* ── Trial banners ── */}
        {subscription?.status === "trial" && (subscription.days_left ?? 999) <= 7 && (
          <View style={[styles.banner, { backgroundColor: (subscription.days_left ?? 0) <= 3 ? C.dangerSoft : C.warningSoft, borderColor: (subscription.days_left ?? 0) <= 3 ? C.danger : C.warning }]}>
            <Ionicons name="time" size={18} color={(subscription.days_left ?? 0) <= 3 ? C.danger : C.warning} />
            <Text style={styles.bannerTxt}>Trial in scadenza: {subscription.days_left} giorni residui</Text>
          </View>
        )}
        {subscription?.status === "expired" && (
          <View style={[styles.banner, { backgroundColor: C.dangerSoft, borderColor: C.danger }]}>
            <Ionicons name="alert-circle" size={18} color={C.danger} />
            <Text style={[styles.bannerTxt, { color: C.danger }]}>Trial scaduto — contatta chi ti ha invitato per rinnovare</Text>
          </View>
        )}

        {/* V50.z10 — Widget prossima sveglia (nascosto se nessuna entro 12h) */}
        <AlarmHomeWidget />

        {/* ── 2) Banner My Thing — nascosto completamente se vuoto (V50.z5) ── */}
        {myThingSlide ? (
        <View style={styles.myThingBtn} testID="home-my-thing-banner">
            <Pressable
              testID="home-my-thing-toggle"
              onPress={() => setBannerPaused((p) => !p)}
              style={StyleSheet.absoluteFill}
              accessibilityLabel={bannerPaused ? "Riprendi rotazione banner" : "Metti in pausa banner"}
            >
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: myThingFade }]} pointerEvents="none">
                {myThingSlide.kind === "image" ? (
                  <ImageBackground
                    source={{ uri: myThingSlide.image }}
                    resizeMode="cover"
                    style={StyleSheet.absoluteFill}
                    imageStyle={Platform.OS === "web" ? ({ objectFit: "cover", width: "100%", height: "100%" } as any) : undefined}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: myThingSlide.color }]}>
                    <View style={styles.myThingMsg}>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{
                          color: myThingSlide.textColor,
                          fontWeight: "700",
                          textAlign: "center",
                          fontFamily: myThingSlide.fontFamily,
                          fontSize: 13,
                          lineHeight: 18,
                          width: "100%",
                        }}
                      >
                        {myThingSlide.body}
                      </Text>
                    </View>
                  </View>
                )}
              </Animated.View>
            </Pressable>

          {/* Pause/play indicator (visible only when paused) */}
          {myThingSlide && bannerPaused ? (
            <View style={styles.bannerPausePill} pointerEvents="none">
              <Ionicons name="pause" size={11} color="#FFF" />
              <Text style={styles.bannerPausePillTxt}>In pausa</Text>
            </View>
          ) : null}

          {/* Edit shortcut — small icon top-right, doesn't interfere with tap-to-pause */}
          {myThingSlide ? (
            <Pressable
              testID="home-my-thing-edit"
              onPress={() => router.push("/my-thing")}
              hitSlop={8}
              style={styles.bannerEditBtn}
              accessibilityLabel="Modifica My Thing"
            >
              <Ionicons name="create-outline" size={16} color="#FFF" />
            </Pressable>
          ) : null}
        </View>
        ) : null}

        {/* ── 2b) Banner Evento ── */}
        <HomeEventBanner />

        {/* ── 3) Bottone Interfaccia Master ── */}
        {!user?.parent_user_id && (
          <Pressable testID="home-master-btn" onPress={() => router.push("/master" as any)} style={styles.masterCard}>
            <View style={styles.masterIcon}>
              <Ionicons name="grid" size={20} color={C.white} />
            </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.masterTitle} numberOfLines={1}>Interfaccia Master</Text>
            <Text style={styles.masterSub} numberOfLines={1}>Agenda · Contatti · Contratti · Team</Text>
          </View>
            <Ionicons name="chevron-forward" size={18} color={C.white} />
          </Pressable>
        )}

        {/* V50.z120 — Sezione widget dashboard (meteo, appuntamenti oggi, PUN, scadenze…)
             spostata SOTTO il bottone Interfaccia Master su richiesta utente */}
        {/* V50.z132 — "Appuntamenti di oggi" è renderizzato più in basso, sotto Ritelefonate */}
        {/* V50.z216 — indicatore discreto: file/audio del wizard letti in background (sparisce da solo) */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }} onLayout={onSectionLayout("widgets")}><SetupProcessingBadge /></View>
        <DashboardWidgetsSection exclude={APPT_TODAY_WIDGET} />

        {/* ── 4) Ritelefonate di oggi ── */}
        <View style={styles.section} onLayout={onSectionLayout("ritelefonate")}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Ritelefonate di oggi</Text>
            <View style={styles.pill}><Text style={styles.pillTxt}>{cbTodayTotal}</Text></View>
          </View>
          <Pressable testID="add-callback-btn" onPress={() => router.push("/callback/new")} style={styles.addBtn}>
            <Ionicons name="add-circle" size={20} color={C.white} />
            <Text style={styles.addBtnTxt}>Aggiungi Telefonata</Text>
          </Pressable>
          {callbacks.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={28} color={C.muted} />
              <Text style={styles.emptyTxt}>Nessuna ritelefonata programmata</Text>
            </View>
          )}
          {["energy", "network"].map((area) => {
            const list = callbacks.filter((c) => c.area === area);
            if (list.length === 0) return null;
            const color = area === "energy" ? (settings?.energy_color || C.primary) : (settings?.network_color || C.navy);
            const title = area === "energy" ? settings?.energy_title : settings?.network_title;
            return (
              <View key={area} style={styles.areaBlock}>
                <View style={styles.areaHead}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.areaTitle}>{title}</Text>
                </View>
                {list.map((cb) => (
                  <CallbackRow
                    key={cb.callback_id}
                    cb={cb}
                    color={color}
                    onOpen={() => {
                      if (cb.contact_id) {
                        router.push(`/contact/${cb.contact_id}`);
                      } else if (cb.phone) {
                        setCallTarget({ phone: cb.phone, contact_id: null, callback_id: cb.callback_id, display_name: cb.title });
                      } else {
                        if (Platform.OS === "web") {
                          window.alert("Questa ritelefonata non ha un contatto collegato né un numero di telefono. Usa l'icona matita per aggiungerlo.");
                        } else {
                          Alert.alert("Nessun numero disponibile", "Questa ritelefonata non ha né contatto collegato né numero di telefono. Usa l'icona matita per modificarla.");
                        }
                      }
                    }}
                    onScript={() => setScriptTarget({ name: cb.title, phone: cb.phone })}
                    onEdit={() => router.push(`/callback/${cb.callback_id}`)}
                    onToggleDone={async () => {
                      try {
                        await api(`/callbacks/${cb.callback_id}`, { method: "PUT", body: { done: !cb.done } });
                        await load();
                      } catch (e: any) { console.warn("Errore toggle callback:", e?.message || e); }
                    }}
                  />
                ))}
              </View>
            );
          })}
        </View>

        {/* V50.z132 — Banner "Appuntamenti di oggi" SOTTO Ritelefonate */}
        <View onLayout={onSectionLayout("appuntamenti")}><DashboardWidgetsSection only={APPT_TODAY_WIDGET} /></View>

        {/* ── 5) Azioni rapide (a scomparsa) ── */}
        <View style={styles.section} onLayout={onSectionLayout("azioni")}>
          <Pressable onPress={toggleQa} style={styles.qaHeader} hitSlop={8}>
            <Text style={styles.sectionTitle}>Azioni rapide</Text>
            <Ionicons name={qaOpen ? "chevron-up" : "chevron-down"} size={20} color={C.navy} />
          </Pressable>
          {qaOpen ? (
            <View style={styles.quickRow}>
              <Pressable testID="qa-new-appt" style={styles.quick} onPress={() => router.push("/appointment/new")}>
                <View style={[styles.quickIcon, { backgroundColor: "#0EA5E9" /* V50.z34 CRM Core */ }]}>
                  <Ionicons name="calendar-outline" size={22} color="#FFF" />
                </View>
                <Text style={styles.quickTxt} numberOfLines={2}>Nuovo appuntamento</Text>
              </Pressable>
              <Pressable testID="qa-new-contact" style={styles.quick} onPress={() => router.push("/contact/new")}>
                <View style={[styles.quickIcon, { backgroundColor: "#0EA5E9" /* V50.z34 CRM Core */ }]}>
                  <Ionicons name="person-add-outline" size={22} color="#FFF" />
                </View>
                <Text style={styles.quickTxt} numberOfLines={2}>Nuovo contatto</Text>
              </Pressable>
              <Pressable testID="qa-voice-copilot" style={styles.quick} onPress={() => router.push("/voice-copilot")}>
                <View style={[styles.quickIcon, { backgroundColor: "#7C3AED" /* V50.z34 AI & Axon */ }]}>
                  <Ionicons name="car-sport" size={22} color="#FFF" />
                </View>
                <Text style={styles.quickTxt} numberOfLines={2}>Axon Drive</Text>
              </Pressable>
              {/* V50.z253 — Resoconto Km (note spese) */}
              <Pressable testID="qa-km-report" style={styles.quick} onPress={() => router.push("/km-report" as any)}>
                <View style={[styles.quickIcon, { backgroundColor: "#0EA5E9" /* CRM Core */ }]}>
                  <Ionicons name="speedometer-outline" size={22} color="#FFF" />
                </View>
                <Text style={styles.quickTxt} numberOfLines={2}>Resoconto Km</Text>
              </Pressable>
              {/* V50.z25 — Caselle mail (IMAP) — categoria Comunicazioni */}
              <Pressable testID="qa-email-accounts" style={styles.quick} onPress={() => router.push("/email-accounts")}>
                <View style={[styles.quickIcon, { backgroundColor: "#F97316" /* V50.z34 Comunicazioni */ }]}>
                  <Ionicons name="mail-outline" size={22} color="#FFF" />
                </View>
                <Text style={styles.quickTxt} numberOfLines={2}>Caselle mail</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* ── V29 · Scadenze imminenti ── */}
        <View style={styles.section} onLayout={onSectionLayout("scadenze")}>
          {/* V50.s — Titolo "SCADENZE" compatto + chips centrati sotto */}
          <View style={styles.dlHeader}>
            <Text style={styles.dlSectionTitle}>SCADENZE</Text>
            <View style={styles.dlChipsRowCentered}>
              {[30, 60, 90, 180].map((d) => {
                const active = !dlCollapsed && d === deadlinesDays;
                return (
                  <Pressable
                    key={d}
                    testID={`dl-window-${d}`}
                    hitSlop={6}
                    accessibilityLabel={active ? `Filtro ${d} giorni attivo: tocca per chiudere` : `Mostra scadenze entro ${d} giorni`}
                    onPress={() => {
                      if (active) { setDlCollapsed(true); return; }
                      setDlCollapsed(false);
                      if (d !== deadlinesDays) changeDeadlinesDays(d);
                    }}
                    style={[styles.dlChip, active && styles.dlChipActive]}
                  >
                    <Text style={[styles.dlChipTxt, active && styles.dlChipTxtActive]}>{d}gg</Text>
                    {active && <Ionicons name="close" size={12} color={C.primary} style={{ marginLeft: 3 }} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
          {dlCollapsed ? (
            <Text style={styles.dlCollapsedHint}>Filtro chiuso · tocca un intervallo per vedere le scadenze</Text>
          ) : (
            <DeadlinesWidget
              items={deadlines}
              loading={deadlinesLoading}
              onOpenContact={(cid) => router.push(`/contact/${cid}?tab=bills` as any)}
              onChanged={() => changeDeadlinesDays(deadlinesDays)}
            />
          )}
        </View>

        {/* ── 6) Statistiche ── */}
        <View style={styles.section} onLayout={onSectionLayout("statistiche")}>
          <Text style={styles.sectionTitle}>Statistiche</Text>

          {/* KPI cards 2×2 */}
          <View style={styles.kpiRow}>
            <KpiCard
              testID="kpi-callbacks"
              label="Ritelefonate oggi"
              value={cbTodayTotal}
              icon="call"
              accent={C.primary}
              hint={cbLate > 0 ? `${cbLate} in ritardo` : cbDone > 0 ? `${cbDone} completate` : "nessuna urgenza"}
              hintColor={cbLate > 0 ? C.danger : C.success}
              // V50.r — Rimosso navigate a route inesistente (/callbacks-list).
              // La lista delle ritelefonate di oggi è già mostrata più sotto
              // nella sezione "Da Ritelefonare". Card ora solo informativa.
            />
            <KpiCard
              testID="kpi-appointments"
              label="Appuntamenti 30gg"
              value={apptTotal}
              icon="calendar"
              accent={C.navy}
              hint={`${apptDone} fatti · ${apptUndone} da fare`}
              hintColor={C.muted}
              onPress={() => router.push("/(tabs)/calendario" as any)}
            />
          </View>
          <View style={[styles.kpiRow, { marginTop: 12 }]}>
            <KpiCard
              testID="kpi-contacts"
              label="Contatti totali"
              value={contactsCount}
              icon="people"
              accent={C.primary}
              hint="in rubrica"
              hintColor={C.muted}
              onPress={() => router.push("/(tabs)/contatti" as any)}
            />
            <KpiCard
              testID="kpi-done-today"
              label="Fatte oggi"
              value={cbDone}
              icon="checkmark-done"
              accent={C.navy}
              hint={cbPending > 0 ? `${cbPending} da chiudere` : "tutto ok"}
              hintColor={cbPending > 0 ? C.warning : C.success}
              // V50.r — Rimosso navigate a route inesistente (/callbacks-list).
              // Lista già visibile nella sezione "Da Ritelefonare" sotto.
            />
          </View>

          {/* Charts: donut + bar */}
          {(apptTotal > 0 || cbTodayTotal > 0) && (
            <View style={[styles.chartsRow, { marginTop: 12 }]}>
              <View style={[styles.card, styles.donutCard]}>
                <Text style={styles.cardTitle}>Appuntamenti</Text>
                <Text style={styles.cardSub}>ultimi 30 giorni</Text>
                <View style={styles.donutWrap}>
                  <DonutChart
                    size={120}
                    strokeWidth={14}
                    segments={[
                      { value: apptDone, color: C.primary },
                      { value: apptUndone, color: C.navy },
                    ]}
                    centerLabel={apptTotal > 0 ? `${Math.round((apptDone / apptTotal) * 100)}%` : "0%"}
                    centerSub="fatti"
                  />
                </View>
                <View style={styles.legend}>
                  <LegendDot color={C.primary} label={`Fatti · ${apptDone}`} />
                  <LegendDot color={C.navy} label={`Da fare · ${apptUndone}`} />
                </View>
              </View>

              <View style={[styles.card, styles.donutCard]}>
                <Text style={styles.cardTitle}>Ritelefonate</Text>
                <Text style={styles.cardSub}>di oggi per area</Text>
                <View style={{ marginTop: 14, marginBottom: 8 }}>
                  <BarRow label={settings?.energy_title || "Energy"} value={cbEnergy} max={Math.max(1, cbEnergy, cbNetwork)} color={C.primary} />
                  <BarRow label={settings?.network_title || "Network"} value={cbNetwork} max={Math.max(1, cbEnergy, cbNetwork)} color={C.navy} />
                  <BarRow label="In ritardo" value={cbLate} max={Math.max(1, cbEnergy, cbNetwork, cbLate)} color={C.danger} />
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={{ height: 16 }} />

        {/* V49 — Bottone "Comunica con l'azienda": apre bottom sheet con nome
            azienda, email e numeri di servizio configurabili dal Master. */}
        <Pressable
          testID="home-company-contact-btn"
          onPress={() => setCompanySheetOpen(true)}
          style={styles.companyContactBtn}
        >
          <View style={styles.companyContactIcon}>
            <Ionicons name="business" size={22} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.companyContactTitle} numberOfLines={1} ellipsizeMode="tail">COMUNICA CON L&apos;AZIENDA</Text>
            <Text style={styles.companyContactSub} numberOfLines={1}>Numeri di servizio e contatti</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#FFF" />
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      <CallActionSheet
        visible={!!callTarget}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onCompleted={(res) => {
          setCallTarget(null);
          load();
          if (res?.outcome_id === "call_appointment") {
            const cid = callTarget?.contact_id;
            if (cid) router.push(`/appointment/new?contact_id=${cid}`);
          }
        }}
      />

      {/* V28.e — Script overlay for callbacks (manual open, no autopopup) */}
      <CallScriptOverlay
        visible={!!scriptTarget}
        onClose={() => setScriptTarget(null)}
        contactName={scriptTarget?.name}
        contactPhone={scriptTarget?.phone}
      />

      {/* V49 — Bottom sheet "Comunica con l'azienda" */}
      <CompanyContactSheet
        visible={companySheetOpen}
        onClose={() => setCompanySheetOpen(false)}
      />

      {/* V50.z35 — Drawer laterale con 6 categorie */}
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </SafeAreaView>
  );
}

/* ═══════════════════════ Reusable UI bits ═══════════════════════ */

// V29 — Widget "Scadenze imminenti" per la Home. Ogni card è cliccabile e
// apre l'anagrafica del contatto sulla tab Fatture per intervenire subito.
// V50.z153 — Icona ⋯ a destra: Disattiva avviso / Nuova data / Sostituisci bolletta.
function DeadlinesWidget({
  items,
  loading,
  onOpenContact,
  onChanged,
}: {
  items: any[];
  loading: boolean;
  onOpenContact: (contactId: string) => void;
  onChanged: () => void;
}) {
  const [actionItem, setActionItem] = useState<DeadlineItem | null>(null);
  const TYPE = { luce: { i: "flash", c: "#F59E0B" }, gas: { i: "flame", c: "#EA580C" }, telco: { i: "wifi", c: "#0891B2" } } as const;
  const STATUS = {
    expired: { l: "Scaduta", fg: C.danger, bg: C.dangerSoft },
    critical: { l: "Urgente", fg: "#B45309", bg: C.warningSoft },
    warning: { l: "In arrivo", fg: "#0369A1", bg: "#DBEAFE" },
    ok: { l: "OK", fg: C.success, bg: C.successSoft },
  } as any;
  if (loading) {
    return (
      <View style={[styles.card, { alignItems: "center", paddingVertical: 22 }]}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }
  if (!items || items.length === 0) {
    return (
      <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.successSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="checkmark" size={18} color={C.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: C.text }}>Tutto in ordine</Text>
          <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Nessun contratto in scadenza nella finestra selezionata.</Text>
        </View>
      </View>
    );
  }
  return (
    <View>
      {items.slice(0, 5).map((d) => {
        const tm = (TYPE as any)[d.bill_type] || TYPE.luce;
        const sm = STATUS[d.status] || STATUS.ok;
        const c = d.contact || {};
        const label = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contatto";
        const dl = typeof d.days_left === "number" ? d.days_left : null;
        const dlTxt = dl === null ? "" : dl < 0 ? `${Math.abs(dl)} gg fa` : dl === 0 ? "oggi" : dl === 1 ? "domani" : `tra ${dl} gg`;
        return (
          <Pressable
            key={d.bill_id}
            testID={`deadline-${d.bill_id}`}
            onPress={() => c.contact_id && onOpenContact(c.contact_id)}
            style={({ pressed }) => [styles.deadlineRow, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.deadlineIcon, { backgroundColor: tm.c + "1A" }]}>
              <Ionicons name={tm.i as any} size={16} color={tm.c} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.deadlineName} numberOfLines={1}>{label}</Text>
              <Text style={styles.deadlineMeta} numberOfLines={1}>
                {(d.nome_offerta || d.fornitore || "Contratto")} · scade il {(() => {
                  try { const [y, m, dd] = String(d.expiry_date).split("-"); return `${dd}/${m}/${y}`; } catch { return d.expiry_date; }
                })()}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <View style={[styles.deadlinePill, { backgroundColor: sm.bg }]}>
                <Text style={[styles.deadlinePillTxt, { color: sm.fg }]}>{sm.l}</Text>
              </View>
              {!!dlTxt && <Text style={[styles.deadlineDays, { color: sm.fg }]}>{dlTxt}</Text>}
            </View>
            <Pressable
              testID={`deadline-more-${d.bill_id}`}
              onPress={() => setActionItem(d)}
              hitSlop={8}
              accessibilityLabel="Azioni scadenza"
              style={({ pressed }) => [styles.deadlineMoreBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={C.muted} />
            </Pressable>
          </Pressable>
        );
      })}
      {items.length > 5 && (
        <Text style={styles.deadlineMore}>+{items.length - 5} altre scadenze nel periodo selezionato</Text>
      )}
      <DeadlineActionsSheet item={actionItem} onClose={() => setActionItem(null)} onChanged={onChanged} />
    </View>
  );
}

function KpiCard({ testID, label, value, icon, accent, hint, hintColor, onPress }: {
  testID?: string; label: string; value: number; icon: any; accent: string; hint?: string; hintColor?: string; onPress?: () => void;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.kpi, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.kpiIconBadge, { backgroundColor: accent + "18" }]}>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
      {!!hint && <Text style={[styles.kpiHint, { color: hintColor || C.muted }]} numberOfLines={1}>{hint}</Text>}
    </Pressable>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(6, (value / max) * 100) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barTop}>
        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.barValue}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: value > 0 ? color : "transparent" }]} />
      </View>
    </View>
  );
}

/* Simple animated SVG donut chart */
function DonutChart({ size, strokeWidth, segments, centerLabel, centerSub }: {
  size: number; strokeWidth: number; segments: { value: number; color: string }[]; centerLabel?: string; centerSub?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((a, b) => a + b.value, 0);
  const hasData = total > 0;

  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          {/* Track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={C.border}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {hasData && segments.map((seg, i) => {
            if (seg.value <= 0) return null;
            const dash = (seg.value / total) * circumference;
            const el = (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                fill="transparent"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill as any} pointerEvents="none">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.donutCenterLabel}>{centerLabel}</Text>
          {!!centerSub && <Text style={styles.donutCenterSub}>{centerSub}</Text>}
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════════ Callback Row (kept behavior, updated look) ═══════════════════════ */

function CallbackRow({ cb, color, onOpen, onScript, onEdit, onToggleDone }: { cb: Callback; color: string; onOpen: () => void; onScript: () => void; onEdit: () => void; onToggleDone: () => void }) {
  const [now, setNow] = useState(Date.now());
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  const dueAt = new Date(cb.scheduled_at).getTime();
  const diffMin = (dueAt - now) / 60000;
  const past = diffMin < 0;
  const urgent = !cb.done && diffMin <= 15;
  const soon = !cb.done && !urgent && diffMin <= 30;
  const upcoming = !cb.done && !urgent && !soon;

  useEffect(() => {
    if (!urgent && !soon) { sweep.setValue(0); return; }
    const cycle = urgent ? 2000 : 3200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: cycle, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, soon, sweep]);

  const bg = cb.done ? C.white : urgent ? C.dangerSoft : soon ? "#FFEDD5" : upcoming ? C.warningSoft : C.white;
  const border = cb.done ? C.border : urgent ? C.danger : soon ? "#F59E0B" : upcoming ? "#EAB308" : C.border;
  const sweepColor = urgent ? "rgba(220,38,38,0.22)" : "rgba(245,158,11,0.18)";

  return (
    <View style={{ opacity: cb.done ? 0.55 : 1 }} testID={`callback-${cb.callback_id}`}>
      <View style={{ flexDirection: "row", backgroundColor: bg, borderRadius: 14, marginBottom: 8, alignItems: "stretch", overflow: "hidden", borderWidth: 1, borderColor: border, position: "relative" }}>
        {(urgent || soon) && !cb.done ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: sweep.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
              backgroundColor: sweepColor, zIndex: 0,
            }}
          />
        ) : null}
        <Pressable
          testID={`callback-open-${cb.callback_id}`}
          onPress={() => { if (typeof onOpen === "function") onOpen(); }}
          android_ripple={{ color: "rgba(0,0,0,0.06)" }}
          style={({ pressed }) => [{ flex: 1, flexDirection: "row", alignItems: "center", opacity: pressed ? 0.75 : 1, zIndex: 1 }]}
        >
          <View style={{ width: 5, backgroundColor: color, alignSelf: "stretch" }} />
          <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12 }}>
            <Text style={[{ fontSize: 15, fontWeight: "700", color: C.text }, cb.done && { textDecorationLine: "line-through" }]}>{cb.title}</Text>
            <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {new Date(cb.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {!cb.done && !past && urgent ? "  ⚠ tra pochi minuti" : ""}
              {!cb.done && !past && soon ? "  ⏰ tra meno di 30 min" : ""}
              {!cb.done && past ? "  · in ritardo" : ""}
              {cb.note ? "  · " + cb.note : ""}
            </Text>
          </View>
        </Pressable>
        <Pressable testID={`callback-script-${cb.callback_id}`} onPress={onScript} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.55 : 1, zIndex: 1 }]}>
          <Ionicons name="document-text" size={18} color={C.navy} />
        </Pressable>
        <Pressable testID={`callback-edit-${cb.callback_id}`} onPress={onEdit} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.55 : 1, zIndex: 1 }]}>
          <Ionicons name="pencil" size={18} color={C.primary} />
        </Pressable>
        <Pressable testID={`callback-toggle-${cb.callback_id}`} onPress={onToggleDone} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 12, justifyContent: "center", opacity: pressed ? 0.6 : 1, zIndex: 1 }]}>
          <Ionicons name={cb.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={cb.done ? C.success : C.muted} />
        </Pressable>
      </View>
    </View>
  );
}

/* ═══════════════════════ Styles ═══════════════════════ */

const cardShadow = Platform.select({
  ios: { shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 3 },
  default: { shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  rootDark: { flex: 1, backgroundColor: "#0D1B2A" },
  scrollBg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 12 },

  /* V49 — Bottone "Comunica con l'azienda" (fondo Home) */
  companyContactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: C.navy,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  companyContactIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  companyContactTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFF",
    letterSpacing: 0.3,
  },
  companyContactSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.75)",
    marginTop: 2,
  },


  /* Header V29.y — container unico bordato, sfondo trasparente */
  brandHeader: {
    backgroundColor: "transparent",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  brandHeaderBox: {
    // V29.aq — Header con immagine full-bleed locale (offline-safe).
    // V29.ar — height animata via scrollY (140 → 60 su scroll).
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
    // Sottile scrim scuro solo nella parte superiore per data/ora leggibile.
    backgroundColor: "transparent",
    // Web: usa boxShadow-like gradient — su native usiamo backgroundColor + border only
  },
  brandHeaderCornerTL: {
    position: "absolute",
    top: 4,
    left: 44,   // V50.z35: spazio a sinistra per hamburger
    zIndex: 2,
  },
  brandHeaderHamburger: {
    position: "absolute",
    top: 4,
    left: 8,
    zIndex: 3,
    width: 32, height: 28,
    alignItems: "center", justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  brandHeaderCornerTR: {
    position: "absolute",
    top: 4,
    right: 8,
    zIndex: 2,
  },
  brandHeaderBgLayer: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 0,
  },
  brandHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  brandHeaderDate: {
    // V29.ao — Header dark: testo cyan chiaro leggibile sul fondo navy
    color: "rgba(186,230,253,0.85)", // sky-200 alpha
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
    borderColor: C.primarySoft,
  },
  brandHeaderAvatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: C.primarySoft,
  },
  brandHeaderAvatarTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  brandHeaderGreet: {
    // V29.ao — Testo bianco su fondo dark per leggibilità
    color: "#F1F5F9",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  brandHeaderGreetName: {
    color: "#FF6B35",
    fontWeight: "900",
  },
  brandHeaderHero: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
    marginTop: 0,
    paddingTop: 0,
  },
  brandHeaderHeroLayer: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  brandHeaderHeroLogo: {
    width: "70%",
    height: 50,
    alignSelf: "center",
    backgroundColor: "transparent",
  },

  /* Header (legacy — mantenuto per compatibilità) */
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8, paddingBottom: 4 },
  heroWrap: {
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  heroLayer: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBrandImg: {
    width: 280,
    height: 110,
    backgroundColor: "transparent",
  },
  heroGreet: {
    color: C.navy,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
    textAlign: "center",
  },
  eyebrow: { color: C.muted, fontSize: 12, textTransform: "capitalize", fontWeight: "600" },
  hi: { color: C.navy, fontSize: 26, fontWeight: "800", marginTop: 2, letterSpacing: -0.5 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.primarySoft },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.navy, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: C.white, fontSize: 16, fontWeight: "800" },

  /* Banners */
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  bannerTxt: { flex: 1, fontWeight: "700", fontSize: 13, color: C.text },

  /* KPI */
  kpiRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  kpi: {
    flex: 1, backgroundColor: C.white, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: C.border,
    ...(cardShadow as any),
  },
  kpiIconBadge: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  kpiValue: { fontSize: 32, fontWeight: "900", color: C.navy, letterSpacing: -1 },
  kpiLabel: { fontSize: 12, fontWeight: "700", color: C.text, marginTop: 2 },
  kpiHint: { fontSize: 11, fontWeight: "600", marginTop: 4 },

  /* Master */
  masterCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.navy,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 16,
    marginTop: 16, marginBottom: 12,
    ...(cardShadow as any),
  },
  masterIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  masterTitle: { color: C.white, fontWeight: "800", fontSize: 15 },
  masterSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2, fontWeight: "600" },

  /* Charts */
  chartsRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  card: { flex: 1, backgroundColor: C.white, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: C.border, ...(cardShadow as any) },
  donutCard: { minHeight: 220 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: C.navy },
  cardSub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  donutWrap: { alignItems: "center", justifyContent: "center", marginTop: 10 },
  donutCenterLabel: { fontSize: 20, fontWeight: "900", color: C.navy, letterSpacing: -0.5 },
  donutCenterSub: { fontSize: 10, color: C.muted, fontWeight: "700", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6 },
  legend: { marginTop: 12, gap: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, fontWeight: "700", color: C.text },

  /* Bars */
  barRow: { marginBottom: 12 },
  barTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  barLabel: { fontSize: 12, fontWeight: "700", color: C.text, flex: 1 },
  barValue: { fontSize: 14, fontWeight: "900", color: C.navy },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: C.navySoft, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },

  /* My Thing */
  myThingBtn: { backgroundColor: C.primarySoft, borderRadius: 12, marginTop: 6, marginBottom: 6, overflow: "hidden", position: "relative", height: 80, borderWidth: 1, borderColor: C.border },
  // V29.ad — Card compatta (max 80px): niente titolo, testo su una riga con overflow nascosto
  myThingMsg: { paddingVertical: 6, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", gap: 0, minHeight: 78 },
  myThingMsgTitle: { fontWeight: "800", fontSize: 12, letterSpacing: 0.3, textTransform: "uppercase", opacity: 0.85, textAlign: "center" },
  myThingMsgBody: { fontWeight: "700", fontSize: 15, lineHeight: 21, textAlign: "center" },
  // V28.e — pause pill + edit shortcut
  bannerPausePill: {
    position: "absolute",
    bottom: 8,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.62)",
  },
  bannerPausePillTxt: { color: "#FFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  bannerEditBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  /* Section */
  section: { marginTop: 22 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: C.navy, letterSpacing: -0.3 },
  pill: { backgroundColor: C.primarySoft, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillTxt: { color: C.primary, fontWeight: "800", fontSize: 12 },

  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.primary, paddingVertical: 13, borderRadius: 14, marginBottom: 12,
    ...(cardShadow as any),
  },
  addBtnTxt: { color: C.white, fontSize: 14, fontWeight: "800" },

  empty: { alignItems: "center", padding: 22, gap: 8, backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
  emptyTxt: { color: C.muted, fontWeight: "600" },

  areaBlock: { marginBottom: 8 },
  areaHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  areaTitle: { fontSize: 12, fontWeight: "800", color: C.navy, textTransform: "uppercase", letterSpacing: 0.5 },

  /* Quick — V29.ba stile "Optima": icona full-round colorata con shadow rialzato */
  qaHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  quick: {
    flexGrow: 1, flexBasis: "45%", minWidth: 140, maxWidth: "100%",
    backgroundColor: C.white, padding: 14, borderRadius: 16, alignItems: "flex-start", gap: 10,
    borderWidth: 1, borderColor: C.border,
    ...(cardShadow as any),
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  quickTxt: { fontWeight: "800", color: C.navy, fontSize: 13 },

  /* V29 · Scadenze */
  dlChipsRow: { flexDirection: "row", gap: 6 },
  // V50.s — Header "SCADENZE" con chips centrati sotto
  dlHeader: { alignItems: "center", gap: 10, marginBottom: 12 },
  dlSectionTitle: { fontSize: 18, fontWeight: "900", color: C.navy, letterSpacing: 2, textAlign: "center" },
  dlChipsRowCentered: { flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" },
  dlChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 9, paddingVertical: 5, minHeight: 28, borderRadius: 999, backgroundColor: C.navySoft, borderWidth: 1, borderColor: C.border },
  dlCollapsedHint: { fontSize: 11, color: C.muted, textAlign: "center", paddingVertical: 8, fontStyle: "italic" },
  dlChipActive: { backgroundColor: C.primarySoft, borderColor: C.primary },
  dlChipTxt: { fontSize: 11, fontWeight: "800", color: C.navy },
  dlChipTxtActive: { color: C.primary },
  deadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    ...(cardShadow as any),
  },
  deadlineIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  deadlineName: { fontSize: 14, fontWeight: "800", color: C.text },
  deadlineMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  deadlinePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  deadlinePillTxt: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.2 },
  deadlineDays: { fontSize: 11.5, fontWeight: "700", marginTop: 4 },
  deadlineMore: { fontSize: 12, color: C.muted, textAlign: "center", marginTop: 4, marginBottom: 4 },
  deadlineMoreBtn: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
});

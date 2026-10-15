import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Share, View, Text, StyleSheet, ScrollView, Pressable, Image, ImageBackground, Modal, Linking, Animated, Easing, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useRole } from "@/src/useRole"; // V50.z436
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { openInAppLink } from "@/src/utils/openInAppLink";
import { pickAvatarBase64 } from "@/src/image-picker";
import { MasterVoiceRecorder } from "@/src/MasterVoiceRecorder";
import { MasterPromoteModal } from "@/src/MasterPromoteModal";
import { WakeTrainingSheet } from "@/src/wake/WakeTrainingSheet"; // V50.z401 — foglio link pubblico wake-word (AI & Axon)
import { MetricBoxClickable, MetricDrillModal, MetricKey } from "@/src/StatMetrics";
import { useBottomSheetPadding, usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { ModuleErrorBoundary } from "@/src/shared";

// V49.g — Header Master allineato all'header Home: usa la stessa immagine.
import { HeaderWeatherBadge } from "@/src/WeatherWidget";
import { BrandHeaderImage } from "@/src/BrandHeaderImage"; // V50.z232
import { MenuIcon, MenuIconName, LOCK_KEY_ICON } from "@/src/LockKeyIcon"; // V50.z237
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
// V50.z362 — sezione «Utility»: i pulsanti grigi usano HT.text2 (varia col tema) → chiave di categoria normalizzata,
// altrimenti l'intestazione «Utility» sparisce nei temi in cui text2 ≠ #475569.
const UTIL_GRAY = "#475569";
const catKey = (color: string): string => (color === HT.text2 || color === HT.muted ? UTIL_GRAY : color);

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
  const { user, logout, refresh } = useAuth();
  const roleInfo = useRole(); // V50.z436 — il Pannello Master non è accessibile a chi non ha `master_panel` (consulente/collaboratore)
  useEffect(() => { if (user && !roleInfo.can("master_panel") && !roleInfo.isSubMaster) router.replace("/(tabs)/home" as any); }, [user, roleInfo]);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [wakeOpen, setWakeOpen] = useState(false); // V50.z401
  const [banner, setBanner] = useState<Banner>(null); // kept only for optional title/body from random-banner
  const [myThingImages, setMyThingImages] = useState<string[]>([]);
  const [myThingIdx, setMyThingIdx] = useState(0);
  const [alerts, setAlerts] = useState<Alerts>({ unread: 0, latest: [] });
  // V50.z356 — «Axon Lab» visibile SOLO a Super Master e delegati (GET /lab/access); i consulenti non lo vedono
  const [labAccess, setLabAccess] = useState(false);
  useEffect(() => { api<{ can_train: boolean }>("/lab/access").then((a) => setLabAccess(!!a?.can_train)).catch(() => setLabAccess(false)); }, []);
  // V45 — Badge counter for pending rule proposals (Master)
  const [pendingProposals, setPendingProposals] = useState<number>(0);
  const [newCourses, setNewCourses] = useState<number>(0); // V50.z285 — badge «Area Corsi» (corsi non ancora aperti)
  // V46 — Safe bottom padding for slide-up sheets on Android gesture-nav / iOS home indicator.
  const bottomPad = useBottomSheetPadding();
  // V50.a — Padding standard globale per il contenuto scrollabile con
  // PersistentBottomNav visibile. Allineato a Home/Master (min 140).
  const pagePad = usePageBottomPadding();
  // V49 — Reorder mode + persisted button order. (Assistance quick-call buttons
  //        rimossi in V49 — spostati nel pannello "Comunica con l'azienda" della Home.)
  const [reorderMode, setReorderMode] = useState<boolean>(false);
  const [buttonOrder, setButtonOrder] = useState<string[] | null>(null);
  // V50.z104 — Super-admin gate per la nuova sezione "Gestione Clienti AdvisorOS"
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ super_admin: boolean }>("/admin/me");
        if (!cancelled) setIsSuperAdmin(!!r?.super_admin);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load saved button order on mount
  useEffect(() => {
    (async () => {
      try {
        const ord = await AsyncStorage.getItem("master.buttons.order.v1");
        if (ord) {
          try {
            const parsed = JSON.parse(ord);
            if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
              // V50.z287/z353/z362 — migrazione etichette (l'ordine salvato è per etichetta):
              // «Autocompilazione CRT» era stata rinominata «Axon Lab» (z353); ora torna «Autocompilazione CRT» nello stesso posto,
              // «Compilazione CRT» (z353) → «Autocompilazione CRT»; «Axon Lab» esce dall'ordine salvato e viene inserito nella sezione AI & Axon.
              let migrated: string[] = parsed.map((x: string) => (x === "Compilazione CRT" ? "Autocompilazione CRT" : x));
              if (!migrated.includes("Autocompilazione CRT")) migrated = migrated.map((x) => (x === "Axon Lab" ? "Autocompilazione CRT" : x));
              migrated = migrated.filter((x, i) => x !== "Axon Lab" && migrated.indexOf(x) === i);
              setButtonOrder(migrated);
            }
          } catch { /* ignore malformed */ }
        }
      } catch { /* ignore */ }
    })();
  }, []);
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
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
      try {
        const c = await api<{ new_count?: number }>("/courses");
        if (alive) setNewCourses(c.new_count || 0);
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

  // V50.z52 — Tap sull'avatar del Master apre SOLO l'azione "Cambia foto"
  // (l'utente ha chiesto di rimuovere il menu 3-punti con navigazioni multiple).
  const changeAvatar = async () => {
    setMenuOpen(false);
    setAvatarBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) {
        await api("/auth/profile", { method: "PUT", body: { avatar_base64: b64 } });
        await refresh();
        notify("Foto aggiornata ✅", "");
      }
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile aggiornare la foto");
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleNewContract = async () => {
    // Mark as seen (clears the badge)
    try { await api("/contracts/mark-seen", { method: "POST" }); await load(); } catch {}
    router.push("/axon-lab" as any); // V50.z343 — Axon Lab sostituisce Autocompilazione CRT
  };

  // V50.z422 — «Condividi Landing Page»: link personalizzato https://landing.axonos.cloud?ref=<CODICE_AGENTE> copiato negli appunti
  const shareLanding = async () => {
    try {
      const r = await api<{ url: string; ref: string; has_agent_code: boolean }>("/me/landing-link");
      let copied = false;
      try { await Clipboard.setStringAsync(r.url); copied = true; } catch { /* appunti non disponibili */ }
      if (Platform.OS !== "web") {
        try { await Share.share({ message: r.url, url: r.url }); } catch { /* annullato */ }
      }
      notify(copied ? "Link copiato negli appunti" : "Il tuo link landing", r.url + (r.has_agent_code ? "" : "\n(Imposta un codice agente in Team per un link più leggibile)"));
    } catch {
      notify("Errore", "Non riesco a generare il link in questo momento.");
    }
  };

  const buttons: { label: string; icon: MenuIconName; color: string; onPress: () => void; badge?: number; pulse?: Animated.Value }[] = [
    // V50.z40 — Colori palette semantica (Proposta A): stessa di Axon Hub e drawer.
    // CRM Core (blu #0EA5E9)
    { label: "Agenda", icon: "calendar", color: "#0EA5E9", onPress: () => goto("/(tabs)/calendario") },
    { label: "New Contact", icon: "person-add", color: "#0EA5E9", onPress: () => goto("/contact/new") },
    // V50.z362 — «Autocompilazione CRT» (flusso consulente 9 step) resta in CRM Core, al posto storico; Axon Lab va nella sezione AI & Axon.
    { label: "Autocompilazione CRT", icon: "document-text", color: "#0EA5E9", onPress: () => router.push("/axon-lab/business" as any) },
    // Comunicazioni (arancione #F97316)
    { label: "Chat Gruppo", icon: "chatbubbles", color: "#F97316", onPress: () => setChatPickerOpen(true) },
    // Amministrazione / utility (grigio #475569)
    { label: "Calcolatrice", icon: "calculator", color: HT.text2, onPress: () => setCalcOpen(true) },
    // AI & Axon (viola #7C3AED)
    { label: "My Web", icon: "globe", color: "#7C3AED", onPress: () => goto("/my-web") },
    // Utility (grigio #475569) — V50.z50 richiesta utente: Sveglia + Scanner
    { label: "Sveglia", icon: "alarm", color: HT.text2, onPress: () => goto("/axon-alarms") },
    { label: "Scanner", icon: "scan", color: HT.text2, onPress: () => goto("/scanner") },
    // V50.z157 — Meteo tra le Utility (richiesta utente)
    { label: "Meteo", icon: "partly-sunny", color: HT.text2, onPress: () => goto("/meteo") },
    { label: "Profilo", icon: "person", color: HT.text2, onPress: () => goto("/(tabs)/impostazioni") }, // V50.z287 — mancava nel blocco Utility
    // CRM Core
    { label: "Mercato", icon: "stats-chart", color: "#EAB308", onPress: () => router.push("/mercato" as any) }, // V50.z345 — DB condizioni economiche concorrenti + benchmark
    { label: "New App", icon: "add-circle", color: "#0EA5E9", onPress: () => goto("/appointment/new") },
    // Comunicazioni
    {
      label: voicePhase === "recording" ? "Ferma registrazione" : "Registra audio",
      icon: voicePhase === "recording" ? "stop" : "mic",
      color: voicePhase === "recording" ? "#DC2626" : "#F97316",
      onPress: () => {
        if (voicePhase === "recording") {
          setVoiceStopSignal((s) => s + 1);
        } else if (voicePhase === "idle") {
          setVoiceSignal((s) => s + 1);
        }
      },
      pulse: voicePhase === "recording" ? voicePulse : undefined,
    },
    // Documenti & Cloud (verde #10B981)
    { label: "Anagrafica", icon: "id-card", color: "#10B981", onPress: () => goto("/anagrafica-master") },
    { label: "Mappa Clienti", icon: "map", color: "#0EA5E9", onPress: () => goto("/map-clients") }, // V50.z240
    { label: "Giro Ottimale", icon: "car-sport", color: "#0EA5E9", onPress: () => goto("/optimal-route") }, // V50.z240
    { label: "Resoconto Km", icon: "speedometer", color: "#0EA5E9", onPress: () => goto("/km-report") }, // V50.z253
    // V50.z232 — Personalizzazione Aziendale: logo header per tutta l'organizzazione + ragione sociale/P.IVA/indirizzo come firma
    { label: "Personalizzazione Aziendale", icon: "business", color: "#10B981", onPress: () => goto("/personalizzazione-aziendale") },
    { label: "I miei audio", icon: "folder-open", color: "#10B981", onPress: () => goto("/my-audios") },
    // V50.z205 — Blocco 8 Fase 4: hub Sfera Home
    { label: "Spazio Personale", icon: LOCK_KEY_ICON, color: "#10B981", onPress: () => goto("/spazio-personale") }, // V50.z237 — lucchetto+chiave (area protetta da PIN)
    // AI & Axon
    { label: "Analizza bolletta", icon: "flash", color: "#7C3AED", onPress: () => goto("/bill-quick") },
    // Documenti & Cloud
    { label: "I miei file", icon: "folder-open", color: "#10B981", onPress: () => goto("/master-files") },
    { label: "Biglietto da visita", icon: "id-card", color: "#10B981", onPress: () => goto("/business-card") },
    // Comunicazioni
    { label: "Banner Evento", icon: "megaphone", color: "#F97316", onPress: () => goto("/event-banners") },
    { label: "Script Telefonata", icon: "document-text", color: "#F97316", onPress: () => goto("/call-script-config") },
    // AI & Axon
    { label: "Axon Center", icon: "sparkles", color: "#7C3AED", onPress: () => goto("/axon-hub"), badge: pendingProposals },
    ...(labAccess ? [{ label: "Axon Lab", icon: "color-wand" as const, color: "#7C3AED", onPress: handleNewContract, badge: alerts.unread }] : []),
    { label: "Condividi Landing", icon: "share-social", color: "#7C3AED", onPress: shareLanding }, // V50.z422 — accanto ad Axon Lab // V50.z356 — solo Super Master/delegati · V50.z362 — sezione AI & Axon
    // CRM Core
    { label: "Cruscotto", icon: "grid", color: "#0EA5E9", onPress: () => goto("/cruscotto") },
    { label: "Azioni rapide", icon: "flash", color: "#0EA5E9", onPress: () => goto("/quick-actions") },
    // Team & Insights (giallo #EAB308) — Corporate Gym (Blocco 1)
    { label: "Corporate Gym", icon: "barbell", color: "#EAB308", onPress: () => goto("/corporate-gym") },
    // V50.z285 — Area Corsi nella griglia (prima solo card dentro Team Insights → introvabile); badge = corsi nuovi
    { label: "Area Corsi", icon: "school", color: "#EAB308", onPress: () => goto("/courses"), badge: newCourses },
    { label: "Team Insights", icon: "analytics", color: "#EAB308", onPress: () => goto("/team-insights") },
    // V50.z310 — Confronto KPI fra collaboratori (classifica, grafico, testa a testa)
    { label: "Confronto Team", icon: "podium", color: "#EAB308", onPress: () => goto("/team-compare") },
    // V50.z287 — area feedback/recensioni clienti e segnalazioni (bug, errori, idee) di nuovo raggiungibili dalla griglia
    { label: "Recensioni Clienti", icon: "star", color: "#EAB308", onPress: () => goto("/reviews-analytics") },
    { label: "Feedback & Bug", icon: "bug", color: "#EAB308", onPress: () => goto("/bug-report") },
  ];

  // V48 — Apply saved order (if any). V50.z362 — i pulsanti nuovi/non presenti nell'ordine salvato entrano
  // DOPO l'ultimo pulsante della stessa sezione (colore), non in coda: così le sezioni restano compatte.
  // V50.z40 — Se non c'è ordine custom, raggruppa per categoria colore
  // (CRM blu → Comunicazioni arancio → AI viola → Documenti verde → Utility grigio).
  const orderedButtons = useMemo(() => {
    if (buttonOrder && buttonOrder.length) {
      const byLabel = new Map(buttons.map((b) => [b.label, b] as const));
      const seen = new Set<string>();
      const out: typeof buttons = [];
      for (const label of buttonOrder) {
        const b = byLabel.get(label);
        if (b && !seen.has(label)) { out.push(b); seen.add(label); }
      }
      for (const b of buttons) {
        if (seen.has(b.label)) continue;
        let at = -1;
        for (let i = out.length - 1; i >= 0; i--) { if (catKey(out[i].color) === catKey(b.color)) { at = i; break; } }
        if (at >= 0) out.splice(at + 1, 0, b); else out.push(b);
        seen.add(b.label);
      }
      return out;
    }
    // Default: ordina per priorità categoria (colore) mantenendo ordine
    // originale dentro ogni categoria.
    const catPriority: Record<string, number> = {
      "#0EA5E9": 1,  // CRM Core
      "#F97316": 2,  // Comunicazioni
      "#7C3AED": 3,  // AI & Axon
      "#10B981": 4,  // Documenti & Cloud
      "#EAB308": 5,  // Team & Insights
      [UTIL_GRAY]: 6,  // Amministrazione / utility
      "#DC2626": 2,  // rec attivo → resta accanto a Comunicazioni
    };
    return [...buttons].sort((a, b) => {
      const pa = catPriority[catKey(a.color)] ?? 99;
      const pb = catPriority[catKey(b.color)] ?? 99;
      if (pa !== pb) return pa - pb;
      return buttons.indexOf(a) - buttons.indexOf(b);
    });
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
      {/* V50.c — Header brandizzato AdvisorOS/AxonOS RIPRISTINATO su richiesta
          utente. In V50.a avevamo rimosso l'intero header per interpretazione
          errata del "banner con la foto personale". L'header brand resta,
          NON viene renderizzato alcun banner My Thing sotto (già rimosso in
          V49.l dello scroll). */}
      <View style={styles.brandHeader}>
        <View style={styles.brandHeaderBox} testID="master-brand-header">
          {/* V50.z232 — header pulito + nuovo logo AxonOS piccolo; logo aziendale (Personalizzazione Aziendale) al posto di AdvisorOS se caricato */}
          <BrandHeaderImage radius={12} />
          <View pointerEvents="none" style={styles.brandHeaderScrim} />
          {/* V50.z157 — Badge meteo anche nell'header Master (sempre visibile) */}
          <HeaderWeatherBadge />
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

      {/* V49.l — Banner "My Thing" rimosso dal Master su richiesta utente
          (resta disponibile in Home). Master ora va direttamente allo scroll
          contenente Riordino + griglia dei bottoni Master. */}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad }}>
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
          {orderedButtons.map((b, idx) => {
            // V50.z41 — Mini-header di categoria: inserito quando cambia colore
            // rispetto al bottone precedente (in modalità non-reorder e senza
            // buttonOrder custom, così i gruppi restano puliti).
            const catLabelMap: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
              "#0EA5E9": { label: "CRM Core", icon: "briefcase" },
              "#F97316": { label: "Comunicazioni", icon: "mail" },
              "#DC2626": { label: "Comunicazioni", icon: "mail" },
              "#7C3AED": { label: "AI & Axon", icon: "sparkles" },
              "#10B981": { label: "Anagrafica & DB Master", icon: "id-card" },
              "#EAB308": { label: "Team & Insights", icon: "people" },
              [UTIL_GRAY]: { label: "Utility", icon: "options" },
            };
            const prevColor = idx > 0 ? catKey(orderedButtons[idx - 1].color) : null;
            const isCategoryStart = !reorderMode && (idx === 0 || (prevColor && prevColor !== catKey(b.color)));
            const cat = catLabelMap[catKey(b.color)];
            return (
              <React.Fragment key={b.label}>
                {isCategoryStart && cat ? (
                  <View style={masterExtraStyles.catHeader}>
                    <View style={[masterExtraStyles.catBadge, { backgroundColor: b.color + "22" }]}>
                      <Ionicons name={cat.icon} size={12} color={b.color} />
                    </View>
                    <Text style={[masterExtraStyles.catLabel, { color: b.color }]}>{cat.label}</Text>
                    <View style={[masterExtraStyles.catLine, { backgroundColor: b.color + "33" }]} />
                  </View>
                ) : null}
                <View style={{ position: "relative" }}>
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
              </React.Fragment>
            );
          })}
        </View>

        {/* V50.z401 — «Promuovi ad agente» e «Addestramento wake-word» non stanno più da soli in Home: sono righe del pannello
            Impostazioni & Configurazioni (CRM Core › sotto Gestione Team · AI & Axon). */}
        {/* V50.z50 — Pannello "Impostazioni & Configurazioni" categorizzato.
            Include TUTTI i link del tab Profilo (spalmati per categoria) così
            l'utente può accedervi direttamente dall'area Master. Il tab Profilo
            resta invariato per retro-compatibilità. */}
        <SettingsHubSection
          isOwner={!user?.parent_user_id}
          isSuperAdmin={isSuperAdmin}
          onGoto={goto}
          onPromote={() => setPromoteOpen(true)}
          onWakeTraining={() => setWakeOpen(true)}
          onLogout={async () => {
            await logout();
            router.replace("/login");
          }}
        />

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

      {/* V50.z52 — Menu avatar semplificato: SOLO "Cambia foto" (l'utente
          ha rimosso il menu 3-punti con Team/Corporate/Invita/Setting/Bug/GDPR:
          tutte quelle voci sono ora nell'hub "Impostazioni & Configurazioni"
          sotto la griglia Master). */}
      <Modal transparent visible={menuOpen} onRequestClose={() => setMenuOpen(false)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menuBox, { paddingBottom: bottomPad }]} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Foto profilo</Text>
            <MenuItem
              icon="camera"
              color="#FF6B35"
              label={avatarBusy ? "Caricamento…" : "Cambia foto"}
              hint="Scegli una nuova immagine dalla galleria"
              onPress={changeAvatar}
              testID="master-avatar-change"
            />
            <Pressable
              onPress={() => setMenuOpen(false)}
              style={styles.sheetCancel}
              testID="master-avatar-close"
            >
              <Text style={styles.sheetCancelTxt}>Chiudi</Text>
            </Pressable>
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
            <PickerRow icon="logo-whatsapp" color="#25D366" label="WhatsApp" hint="Apri gruppo esterno" onPress={() => openInAppLink(router, "https://web.whatsapp.com", { title: "WhatsApp Web" })} testID="chat-whatsapp" />
            <PickerRow icon="paper-plane" color="#0088CC" label="Telegram" hint="Apri gruppo esterno" onPress={() => openInAppLink(router, "https://web.telegram.org", { title: "Telegram Web" })} testID="chat-telegram" />
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
              <Pressable onPress={() => setCalcOpen(false)}><Ionicons name="close" size={22} color={HT.text} /></Pressable>
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
        color={drill?.color || HT.brand}
        title={drill?.title || "Dettaglio"}
      />
      <MasterPromoteModal visible={promoteOpen} onClose={() => setPromoteOpen(false)} />
      <WakeTrainingSheet visible={wakeOpen} onClose={() => setWakeOpen(false)} />
    </SafeAreaView>
  );
}

function MasterButton({ label, icon, color, onPress, onLongPress, badge, pulseAnim, pulse }: { label: string; icon: MenuIconName; color: string; onPress: () => void; onLongPress?: () => void; badge?: number; pulseAnim: Animated.Value; pulse?: Animated.Value }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={500} style={styles.btnCell} testID={`master-btn-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <Animated.View style={[styles.btnCircle, { backgroundColor: color }, pulse ? { transform: [{ scale: pulse }] } : null]}>
        <MenuIcon name={icon} size={28} color="#FFF" />
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
      <View style={styles.btnLabelWrap}>
        <Text
          style={styles.btnLabel}
          numberOfLines={2}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label}
        </Text>
      </View>
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
      <Ionicons name="chevron-forward" size={18} color={HT.muted} />
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
            const fg = isEq || isOp ? "#FFF" : HT.text;
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

// V50.z50 — Pannello "Impostazioni & Configurazioni" categorizzato mostrato
// nell'area Master. Raccoglie tutti i link presenti nel tab Profilo, così
// l'utente li può raggiungere direttamente da Master, raggruppati per
// categoria (CRM Core, AI & Axon, Comunicazioni, Docs, Team, Amministrazione).
type HubItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
  ownerOnly?: boolean;
  superAdminOnly?: boolean;
  testID?: string;
};
type HubGroup = {
  color: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: HubItem[];
};

function SettingsHubSection({
  isOwner,
  isSuperAdmin,
  onGoto,
  onLogout,
  onPromote,
  onWakeTraining,
}: {
  isOwner: boolean;
  isSuperAdmin: boolean;
  onGoto: (path: string) => void;
  onLogout: () => Promise<void>;
  onPromote: () => void;
  onWakeTraining: () => void;
}) {
  const { user } = useAuth();
  const groups: HubGroup[] = [
    {
      color: "#0EA5E9", label: "CRM Core", icon: "briefcase",
      items: [
        { icon: "people-circle", label: "Gestione Team", hint: "Invita collaboratori e assegna aree", onPress: () => onGoto("/team"), ownerOnly: true, testID: "hub-team" },
        { icon: "rocket", label: "Promuovi ad agente", hint: "Trova un contatto e assegnagli le autorizzazioni operative", onPress: onPromote, ownerOnly: true, testID: "master-promote-btn" }, // V50.z401 — dentro Gestione Team (era da solo in Home)
        { icon: "document-text", label: "Script Telefonata", hint: "Testo mostrato agli agenti durante le chiamate", onPress: () => onGoto("/call-script-config"), ownerOnly: true, testID: "hub-call-script" },
        { icon: "person-add", label: "Invita Prospect / Collaboratore", hint: "Prospect esterno o Collaboratore del tuo team", onPress: () => onGoto("/invita"), ownerOnly: true, testID: "hub-invita" },
        { icon: "people-outline", label: "Gruppi Contatti", hint: "Crea gruppi personalizzati per invii bulk", onPress: () => onGoto("/groups"), testID: "hub-groups" },
        { icon: "business", label: "New Corporate", hint: "Crea nuova area business", onPress: () => onGoto("/corporate/new"), ownerOnly: true, testID: "hub-corporate" },
        { icon: "gift", label: "Invita Cliente", hint: "Trial gratuito con link estensibile", onPress: () => onGoto("/invitati"), ownerOnly: true, testID: "hub-invite-client" },
        { icon: "settings", label: "Aree & Categorie CRM", hint: "Aree contatto, appuntamenti, prodotti (nel Profilo)", onPress: () => onGoto("/(tabs)/impostazioni"), ownerOnly: true, testID: "hub-crm-settings" },
        { icon: "options-outline", label: "Campi Personalizzati Anagrafica", hint: "Aggiungi campi custom alla scheda cliente", onPress: () => onGoto("/custom-fields"), ownerOnly: true, testID: "hub-custom-fields" },
      ],
    },
    {
      color: "#7C3AED", label: "AI & Axon", icon: "sparkles",
      items: [
        { icon: "sparkles", label: "Axon Center", hint: "Regole, documenti, cervello, script, sveglie, domotica", onPress: () => onGoto("/axon-hub"), ownerOnly: true, testID: "hub-axon-hub" },
        { icon: "eye", label: "Memoria AxonOS", hint: "Cosa sa Axon di me · vedi, correggi, cancella", onPress: () => onGoto("/axon-memory"), testID: "hub-axon-memory" },
        { icon: "chatbox-ellipses", label: "Personalizza Assistente", hint: "Nome, modalità (testo/voce), voce", onPress: () => onGoto("/(tabs)/impostazioni"), testID: "hub-assistant" },
        { icon: "mic-circle", label: "Addestramento wake-word «Axon»", hint: "Link pubblico da condividere · pannello campioni", onPress: onWakeTraining, testID: "hub-wake-training" }, // V50.z401
      ],
    },
    {
      color: "#F97316", label: "Comunicazioni", icon: "mail",
      items: [
        { icon: "mail-open", label: "Email aggiuntive", hint: "Indirizzi da usare come mittente", onPress: () => onGoto("/(tabs)/impostazioni"), testID: "hub-extra-emails" },
        { icon: "mail-open", label: "Configurazione Email (SMTP)", hint: "Aruba, Gmail o altro provider per invii bulk", onPress: () => onGoto("/smtp"), ownerOnly: true, testID: "hub-smtp" },
        { icon: "mail", label: "Caselle mail", hint: "IMAP: leggi, allega, importa in CRM", onPress: () => onGoto("/email-accounts"), testID: "hub-email-accounts" },
      ],
    },
    {
      color: "#10B981", label: "Anagrafica & DB Master", icon: "id-card",
      items: [
        { icon: "id-card", label: "Anagrafica & DB Master", hint: "Password vault e credenziali riservate", onPress: () => onGoto("/anagrafica-master"), testID: "hub-anagrafica-master" },
        { icon: "id-card", label: "Biglietto da visita", hint: "Modifica il tuo biglietto pubblico", onPress: () => onGoto("/business-card"), testID: "hub-business-card" },
        { icon: "folder-open", label: "I miei file", hint: "Note, bollette, audio, file allegati", onPress: () => onGoto("/master-files"), testID: "hub-master-files" },
        { icon: "logo-google", label: "Google Drive", hint: "Collega il tuo Drive per allegare file ad Axon", onPress: () => onGoto("/google-drive"), testID: "hub-gdrive" },
        { icon: "logo-dropbox", label: "Dropbox", hint: "Collega il tuo Dropbox per allegare file ad Axon", onPress: () => onGoto("/dropbox"), testID: "hub-dropbox" },
      ],
    },
    {
      color: "#EAB308", label: "Team & Insights", icon: "people",
      items: [
        { icon: "analytics", label: "Team Insights", hint: "Metriche + profilo AI dei collaboratori", onPress: () => onGoto("/team-insights"), ownerOnly: true, testID: "hub-insights" },
        { icon: "podium", label: "Confronto collaboratori", hint: "Classifica KPI, grafico per metrica, testa a testa", onPress: () => onGoto("/team-compare"), ownerOnly: true, testID: "hub-compare" },
        { icon: "person-add", label: "Invita Collaboratore", hint: "Genera link / QR con ruolo", onPress: () => onGoto("/invite-collaborator"), ownerOnly: true, testID: "hub-invite-collab" },
        { icon: "gift", label: "Invita un amico", hint: "Codice personale · giorni gratis per te e per chi arriva", onPress: () => onGoto("/invita-amico"), testID: "hub-invita-amico" },
        { icon: "mail-unread", label: "Richieste Info (Lead)", hint: "Lead pubblici con risposte AxonOS", onPress: () => onGoto("/leads"), testID: "hub-leads" },
      ],
    },
    {
      color: "#8B5CF6", label: "Gestione Clienti AdvisorOS", icon: "shield-checkmark",
      items: [
        { icon: "people-circle-outline", label: "Utenti registrati", hint: "Tutti gli utenti di tutte le organizzazioni: ricerca, stato, ruolo, ultimo accesso · Elimina / Cambia ruolo / Sposta / Piano / Reinvia benvenuto", onPress: () => onGoto("/admin/users"), superAdminOnly: true, testID: "hub-admin-users" }, // V50.z541
        { icon: "layers-outline", label: "Piani e prezzi", hint: "Collaboratore singolo 19€ · Master 10 utenti 50€ · Master 50 utenti 100€ · oltre 50 preventivo — modificabili senza toccare il codice", onPress: () => onGoto("/admin/org-plans"), superAdminOnly: true, testID: "hub-admin-org-plans" }, // V50.z541
        { icon: "people-outline", label: "Elenco Clienti + Tier", hint: "Paganti/Test/AxonOS + storico utilizzo + broadcast", onPress: () => onGoto("/admin/customers"), superAdminOnly: true, testID: "hub-admin-customers" },
        { icon: "pricetags", label: "Codici Promozionali", hint: "Crea codici (settimane/mesi gratis, premium, crediti), scadenza, max utilizzi, chi li ha usati", onPress: () => onGoto("/admin/promo-codes"), superAdminOnly: true, testID: "hub-admin-promo" },
        { icon: "map-outline", label: "Mappa completa dell'app", hint: "Tutte le funzioni in un unico posto: nome, cosa fa, come si usa, percorso e link diretto · si aggiorna da sola a ogni nuova funzione", onPress: () => onGoto("/admin/app-map"), testID: "hub-admin-app-map" }, // V50.z561
        { icon: "globe-outline", label: "CMS Landing Axon Core", hint: "Testi, prezzi barrati/attivi e limite posti Founder della pagina pubblica /landing (password dedicata)", onPress: () => onGoto("/admin/landing-cms"), superAdminOnly: true, testID: "hub-admin-landing-cms" }, // V50.z530
        { icon: "shield-half", label: "Protezione registrazione", hint: "Anti-bot «Fort Knox»: rate limit, honeypot, proof-of-work, Turnstile, email usa-e-getta, URL privacy, tentativi bloccati", onPress: () => onGoto("/admin/register-guard"), superAdminOnly: true, testID: "hub-admin-register-guard" },
        { icon: "mail-unread-outline", label: "Email di benvenuto", hint: "Oggetto e testo con segnaposto, codice promo incluso, link privacy/app, invio di prova", onPress: () => onGoto("/admin/welcome-email"), superAdminOnly: true, testID: "hub-admin-welcome-email" },
        { icon: "footsteps", label: "Onboarding consulenti", hint: "3 checkpoint per consulente (profilo, anagrafica, primo cliente) con data/ora; solleciti automatici a 3 e 7 giorni", onPress: () => onGoto("/admin/onboarding"), superAdminOnly: true, testID: "hub-admin-onboarding" }, // V50.z461 — Prompt 23
        { icon: "speedometer-outline", label: "Cruscotto Beta", hint: "10 metriche del piano «Beta sul campo» con soglie e verdetto GO/ITERA/RIPENSA; ondate del sondaggio NPS", onPress: () => onGoto("/admin/beta"), testID: "hub-admin-beta" }, // V50.z474
        { icon: "shield-checkmark-outline", label: "Report antivirus", hint: "File rifiutati dall'upload guard (formato, dimensione, virus) con data, utente e motivo; stato ClamAV", onPress: () => onGoto("/admin/upload-guard"), testID: "hub-admin-upload-guard" }, // V50.z472
      ],
    },
    {
      color: HT.text2, label: "Amministrazione", icon: "options",
      items: [
        { icon: "color-palette", label: "Setting App", hint: "Cambia tema e colori", onPress: () => onGoto("/settings-app"), testID: "hub-settings-app" },
        { icon: "ribbon", label: "Branding aziendale", hint: "Logo e nome sui PDF (report, comparazioni)", onPress: () => onGoto("/(tabs)/impostazioni"), ownerOnly: true, testID: "hub-branding" },
        { icon: "person-circle", label: "Email e password di accesso", hint: "Cambia l'email con cui accedi e la password", onPress: () => onGoto("/(tabs)/impostazioni?section=security"), testID: "hub-account-access" }, // V50.z405
        { icon: "shield-checkmark", label: "Sicurezza & 2FA", hint: "Autenticazione a due fattori, PIN e biometria", onPress: () => onGoto("/security"), testID: "hub-security" },
        { icon: "shield-half", label: "Sicurezza AdvisorOS", hint: "Come proteggiamo i tuoi dati e come usarli in sicurezza", onPress: () => onGoto("/security-info"), testID: "hub-security-info" },
        { icon: "book", label: "Libretto Informativo", hint: "Guida operativa completa · PDF", onPress: () => onGoto("/libretto"), testID: "hub-libretto" },
        {
          icon: "sparkles",
          label: "Rivedi tour guidato",
          hint: "Riapri l'onboarding di benvenuto",
          onPress: async () => {
            try {
              await AsyncStorage.removeItem("libretto_seen_v1");
              if (user?.user_id) await AsyncStorage.removeItem(`onboarding_done_${user.user_id}`);
              await api("/user-settings", { method: "PUT", body: { onboarding_done: false } }).catch(() => {});
              notify("Tour guidato riavviato", "Ti riportiamo all'introduzione");
              setTimeout(() => onGoto("/tour"), 300); // V50.z257
            } catch (e: any) {
              notify("Errore", e?.message || "Impossibile riavviare il tour");
            }
          },
          testID: "hub-tour",
        },
        { icon: "bug", label: "Bug, Errori e Idee", hint: "Segnalazioni degli utenti", onPress: () => onGoto("/bug-report"), ownerOnly: true, testID: "hub-bug" },
        { icon: "shield-checkmark", label: "Richieste cancellazione dati", hint: "GDPR requests degli utenti", onPress: () => onGoto("/help-center-admin"), ownerOnly: true, testID: "hub-gdpr" },
      ],
    },
  ];

  return (
    <View style={masterExtraStyles.hubSection} testID="master-settings-hub">
      <View style={masterExtraStyles.hubHeader}>
        <View style={[masterExtraStyles.hubHeaderIcon, { backgroundColor: "#0F172A22" }]}>
          <Ionicons name="options" size={14} color={HT.text} />
        </View>
        <Text style={[masterExtraStyles.hubHeaderTitle, { color: HT.text }]}>Impostazioni & Configurazioni</Text>
        <View style={[masterExtraStyles.hubHeaderLine, { backgroundColor: "#0F172A22" }]} />
      </View>

      {groups.map((g) => {
        const items = g.items.filter((it) => (!it.ownerOnly || isOwner) && (!it.superAdminOnly || isSuperAdmin));
        if (items.length === 0) return null;
        return (
          <View key={g.label} style={masterExtraStyles.hubGroup} testID={`hub-group-${g.label}`}>
            <View style={[masterExtraStyles.hubGroupBar, { backgroundColor: g.color + "12" }]}>
              <View style={[masterExtraStyles.hubGroupBarIcon, { backgroundColor: g.color + "26" }]}>
                <Ionicons name={g.icon} size={12} color={g.color} />
              </View>
              <Text style={[masterExtraStyles.hubGroupBarTitle, { color: g.color }]}>{g.label}</Text>
            </View>
            {items.map((it) => (
              <Pressable
                key={it.label}
                onPress={it.onPress}
                style={masterExtraStyles.hubRow}
                testID={it.testID}
              >
                <View style={[masterExtraStyles.hubRowIcon, { backgroundColor: g.color + "22" }]}>
                  <Ionicons name={it.icon} size={18} color={g.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={masterExtraStyles.hubRowTitle} numberOfLines={1}>{it.label}</Text>
                  {!!it.hint && <Text style={masterExtraStyles.hubRowHint} numberOfLines={2}>{it.hint}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={HT.muted} />
              </Pressable>
            ))}
          </View>
        );
      })}

      <Pressable onPress={onLogout} style={masterExtraStyles.hubLogoutBtn} testID="hub-logout">
        <Ionicons name="log-out-outline" size={18} color={HT.danger} />
        <Text style={masterExtraStyles.hubLogoutTxt}>Esci</Text>
      </Pressable>
    </View>
  );
}

const masterExtraStyles = StyleSheet.create({
  // V50.z50 — Pannello "Impostazioni & Configurazioni" categorizzato
  hubSection: { marginTop: 16, marginBottom: 8, gap: 12 },
  hubHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  hubHeaderIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  hubHeaderTitle: {
    fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase",
  },
  hubHeaderLine: { flex: 1, height: 2, borderRadius: 1 },
  hubGroup: {
    backgroundColor: HT.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HT.border,
    padding: 4,
    gap: 2,
    overflow: "hidden",
  },
  hubGroupBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: HT.border,
    marginHorizontal: -4, marginTop: -4, marginBottom: 2,
  },
  hubGroupBarIcon: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  hubGroupBarTitle: {
    fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase",
  },
  hubRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: 10,
  },
  hubRowIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  hubRowTitle: { fontSize: 14, fontWeight: "700", color: HT.text },
  hubRowHint: { fontSize: 11, color: HT.muted, marginTop: 1 },
  hubLogoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: HT.card, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#FCA5A5',
    marginTop: 4,
  },
  hubLogoutTxt: { color: HT.danger, fontWeight: "800", fontSize: 14 },
  // V50.z41 — Mini-header di categoria nella grid Master
  catHeader: {
    width: "100%", flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 12, marginBottom: 4, paddingHorizontal: 2,
  },
  catBadge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  catLine: { flex: 1, height: 2, borderRadius: 1, marginLeft: 4 },
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
    backgroundColor: HT.axonTint,
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  reorderStartTxt: { fontSize: 11, color: HT.axon, fontWeight: "800" },
  reorderTxt: { fontSize: 11, color: "#FDBA74", fontWeight: "700", flexShrink: 1 },
  reorderResetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: HT.card2,
  },
  reorderResetTxt: { fontSize: 11, color: HT.muted, fontWeight: "800" },
  reorderDoneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EA580C',
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
    backgroundColor: '#0F172A',
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: HT.card,
  },
  supportBtnSaveTxt: { fontSize: 13, fontWeight: "700", color: "#FFF" },
});



const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  // V50.a — Header minimale pulito (senza banner brandizzato): data a sinistra,
  // avatar/menu a destra. Il SupportFab globale si posiziona alla sinistra
  // dell'avatar automaticamente.
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    minHeight: 44,
  },
  headerDate: {
    color: HT.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "capitalize",
    flex: 1,
  },
  headerAvatarBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: HT.brandTint,
  },
  headerAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF6B35',
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: HT.brandTint,
  },
  headerAvatarTxt: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  // V49.g — Legacy header brand styles (mantenuti solo per compatibilità in
  // caso di riferimento residuo, ma non renderizzati più).
  brandHeader: {
    backgroundColor: "transparent",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  brandHeaderBox: {
    height: 140,
    backgroundColor: '#000',
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
    borderColor: HT.brandTint,
  },
  brandHeaderAvatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FF6B35',
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: HT.brandTint,
  },
  brandHeaderAvatarTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  hero: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    // V29.az — Height fissa uguale all'header Home (140px full-screen) così
    // l'immagine dashboard AdvisorOS/AxonOS è visibile alla stessa dimensione.
    height: 140,
    backgroundColor: '#0B1E38',
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

  bannerWrap: { marginTop: 8, height: 100, borderRadius: 12, overflow: "hidden", position: "relative", backgroundColor: HT.card2, zIndex: 1 },
  bannerImg: { flex: 1 },
  bannerOverlay: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  bannerFallback: { flex: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center" },
  bannerLabel: { color: "#FFF", fontSize: 9, fontWeight: "800", letterSpacing: 1, opacity: 0.85 },
  bannerTitle: { color: "#FFF", fontSize: 13, fontWeight: "800", marginTop: 1 },
  bannerBody: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 1 },

  // V50.c — Grid a 4 colonne CENTRATO orizzontalmente con dimensioni FISSE
  // in pixel per evitare l'inconsistenza flex-wrap con percentuali su RN Web
  // (che tende a squeezare le celle facendone entrare 5 invece di 4).
  // Larghezza cella 84px × 4 = 336, gap tra celle 8px × 3 = 24, totale 360.
  // Su viewport 390 con padding 16+16 = 32, spazio disponibile = 358 → si
  // adatta perfettamente. `justifyContent: space-around` distribuisce lo
  // spazio residuo simmetricamente ai lati (centraggio).
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    rowGap: 18,
    columnGap: 0,
  },
  btnCell: {
    width: 84,
    alignItems: "center",
    flexShrink: 0,
  },
  // V50.c — Wrapper esplicito con width:100% attorno al Text. In un parent
  // con `alignItems:"center"` RN NON stretcha i figli di tipo Text (bug
  // storico di RN-Web + Android). Un View wrapper con width:100% forza
  // invece la larghezza piena e permette a numberOfLines/ellipsizeMode di
  // funzionare correttamente su tutte le piattaforme.
  btnLabelWrap: {
    width: "100%",
    marginTop: 8,
    alignItems: "center",
  },
  // V29.ba — Stile "Optima": icona full-round su cerchio colorato con shadow
  // marcato (effetto rialzato/3D) e leggero highlight in alto.
  btnCircle: {
    // V49.g — Nome storico "btnCircle": la forma è passata da cerchio a
    // quadrato con angoli leggermente arrotondati (borderRadius 14 su 66×66)
    // su richiesta utente. Manteniamo colori, icone, testi, badge e
    // funzionalità di riordino identici. Nessun altro punto dell'app usa
    // esattamente questa forma quindi il cambio è locale al Master.
    // V50.c — Icona ridotta 72→66 per lasciare più spazio orizzontale al
    // label (evita wrap carattere-per-carattere).
    width: 66,
    height: 66,
    borderRadius: 14,
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
  // V50.c — Label pulita: fontSize 11, textAlign center, lineHeight 14.
  // La larghezza è garantita dal wrapper btnLabelWrap (width:100%).
  btnLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: HT.text,
    textAlign: "center",
    lineHeight: 14,
  },
  badgeDot: { position: "absolute", top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#16A34A', justifyContent: "center", alignItems: "center", paddingHorizontal: 5, borderWidth: 2, borderColor: HT.card },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  myAudiosLink: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16, backgroundColor: HT.violetTint, borderRadius: 20, borderWidth: 1, borderColor: HT.violet + '66' },
  myAudiosLinkTxt: { color: "#7C3AED", fontWeight: "800", fontSize: 13 },
  statsSection: { marginTop: 6, marginBottom: 16 },
  statsHeader: { fontSize: 13, fontWeight: "800", color: HT.text, marginBottom: 10, letterSpacing: 0.3, textTransform: "uppercase" },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, borderLeftWidth: 4, padding: 10, gap: 4 },
  statCardV: { backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, borderLeftWidth: 4, padding: 10, marginBottom: 10 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statTitle: { fontSize: 12, fontWeight: "800", marginBottom: 4 },
  statRowLine: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  statNum: { fontSize: 18, fontWeight: "800", color: HT.text, minWidth: 22 },
  statLbl: { fontSize: 11, color: HT.muted },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  menuBox: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, paddingBottom: 30 },
  // V50.z34 — Header categoria nel menu 3-dot (grigio muted, 11pt uppercase)
  menuCatHeader: { fontSize: 11, fontWeight: "800", color: HT.muted, letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 4, paddingTop: 10, paddingBottom: 4 },
  menuItem: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 10 },
  menuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 14, fontWeight: "800", color: HT.text },
  menuHint: { fontSize: 11, color: HT.muted, marginTop: 1 },

  sheetBox: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, paddingBottom: 30 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: HT.borderStrong, marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: HT.text, marginBottom: 8, paddingHorizontal: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  sheetCancel: { marginTop: 10, alignItems: "center", padding: 12, backgroundColor: HT.card2, borderRadius: 10 },
  sheetCancelTxt: { fontWeight: "800", color: HT.text },

  calcBox: { backgroundColor: HT.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 14, paddingBottom: 30 },
  calcHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  calcTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  calcDisplay: { backgroundColor: '#0F172A', borderRadius: 12, padding: 18, alignItems: "flex-end" },
  calcDisplayTxt: { color: "#FFF", fontSize: 40, fontWeight: "700", fontVariant: ["tabular-nums"] },
  calcOpTxt: { color: "#F59E0B", fontSize: 14, fontWeight: "800" },
  calcBtn: { flex: 1, aspectRatio: 1.15, borderRadius: 14, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  calcBtnTxt: { fontSize: 22, fontWeight: "700" },
});

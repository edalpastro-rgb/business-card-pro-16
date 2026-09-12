import "@/src/polyfills"; // MUST be first — TextEncoder/TextDecoder polyfill for Hermes (xlsx e altre libs legacy)
import { Stack, router as expoRouter, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { LogBox, Platform, View, AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth, isAppLockEnabled, isTrustStillValid } from "@/src/auth";
import { AppLockOverlay } from "@/src/AppLock";
import { WakeWordService } from "@/src/wakeword/WakeWordService";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AssistantFAB } from "@/src/AssistantChat";
import * as Linking from "expo-linking";
import { openInAppLink } from "@/src/utils/openInAppLink";
import { PersistentBottomNav } from "@/src/PersistentBottomNav";
// V50.z147 — SupportFab non più montato (header Help rimosso); import rimosso.
import { CalculatorFAB } from "@/src/CalculatorFAB";
import { EdgePanel } from "@/src/EdgePanel";
import { OnboardingWizard } from "@/src/OnboardingWizard";
import { AnimatedSplash } from "@/src/AnimatedSplash";
import { FabStackProvider } from "@/src/FabStack";
import { ActiveCallProvider } from "@/src/CallTimerBar";
import { storage } from "@/src/utils/storage";
import { configureNotifHandler } from "@/src/notifs";
import { configureAlarmNotifications } from "@/src/alarmNotifs";
import { registerForPush } from "@/src/pushRegister";
import { AndroidKeyboardPadding } from "@/src/keyboard/AndroidKeyboardPadding";
import { RootInsetsProbe } from "@/src/hooks/useSafeBottom"; // V50.z187 — inset bottom radice uniforme // V50.z186 — tastiera Android edge-to-edge
import { AxnBadgeSync } from "@/src/AxnDrawerBadge";
import { PushBridgeSync } from "@/src/pushBridge"; // V50.z193 — canale Android default (modulo) + registrazione token con retry + stato al server
import { GlobalErrorBoundary } from "@/src/GlobalErrorBoundary";

configureNotifHandler();
configureAlarmNotifications();

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Disable Chrome/Google auto-translate on web preview (it butchers Italian short words like "lun"/"mer" -> "luna"/"sirena")
if (Platform.OS === "web" && typeof document !== "undefined") {
  try {
    document.documentElement.setAttribute("lang", "it");
    document.documentElement.setAttribute("translate", "no");
    document.documentElement.classList.add("notranslate");
    const meta = document.createElement("meta");
    meta.name = "google";
    meta.content = "notranslate";
    document.head.appendChild(meta);

    // V27 — ensure viewport-fit=cover so CSS env(safe-area-inset-*) works
    // and the Android system nav bar doesn't overlap the bottom tab labels.
    let vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      document.head.appendChild(vp);
    }
    if (!/viewport-fit=cover/.test(vp.content || "")) {
      vp.content = "width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover";
    }
  } catch {}
}

function LockGate() {
  const { user, locked, setLocked, logout } = useAuth();

  // On foreground: re-check trust and re-lock if app lock is enabled
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      if (next !== "active") {
        // record when we went inactive
        try { await storage.secureSet("app_bg_at_v1", Date.now()); } catch {}
        return;
      }
      if (!user) return;

      // V29.ao — Defensive timeout: se isTrustStillValid o le operazioni SecureStore
      // si bloccano (osservato al ritorno dopo una telefonata in APK), non lasciamo
      // l'app in stato "loading" per sempre. Timeout 2500ms.
      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        new Promise((resolve) => {
          let done = false;
          const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
          p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
            .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
        });

      try {
        // If trust expired -> force full logout (triggers login flow with 2FA)
        const trustOk = await withTimeout(isTrustStillValid(), 2500, true);
        if (!trustOk) {
          await withTimeout(logout(), 2500, undefined as any);
          return;
        }

        const lockOn = await withTimeout(isAppLockEnabled(), 1500, false);
        if (!lockOn) return;

        const bgAt = (await withTimeout(
          storage.secureGet<number | null>("app_bg_at_v1", null) as Promise<number | null>,
          1500,
          null,
        )) as number | null;
        const idleMs = 5 * 60 * 1000;
        if (bgAt && Date.now() - Number(bgAt) > idleMs) {
          setLocked(true);
        }
      } catch {
        // Su qualsiasi errore: non lock, non logout. Meglio lasciare l'app aperta
        // che intrappolare l'utente in una rotellina.
      }
    });
    return () => sub.remove();
  }, [user, setLocked, logout]);

  if (user && locked) {
    return (
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
        <AppLockOverlay />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <FabStackProvider>
        <ActiveCallProvider>
          <StackWithCallBar />
        </ActiveCallProvider>
      </FabStackProvider>
    </View>
  );
}

// V29.o — Rimosso il banner "chiamata in corso". La durata viene registrata in
// background silenziosamente: nessun elemento UI mostrato all'utente.
function StackWithCallBar() {
  const { user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    // V50.z13 — Response listener globale: tap su notifica sveglia/timer/
    // promemoria → naviga alle impostazioni della sveglia (screen /axon-alarms).
    // V50.z84 — Tap su push info-request: naviga a action_url/deeplink.
    if (Platform.OS === "web") return;
    const handleData = (data: any) => {
      try {
        const tag = (data?.tag || "") as string;
        if (tag.startsWith("alarm_")) {
          router.push("/axon-alarms" as any);
          return;
        }
        const url = data?.deeplink || data?.action_url;
        if (typeof url === "string" && url.length > 0) {
          if (url.startsWith("http")) {
            // V50.z108 — apri link http/https nella WebView interna (mantiene bottom nav).
            try { openInAppLink(router, url); } catch { /* ignore */ }
          } else {
            router.push(url as any);
          }
        }
      } catch { /* ignore */ }
    };
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      handleData(resp?.notification?.request?.content?.data);
    });
    // Cold-start check
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleData(resp?.notification?.request?.content?.data);
    }).catch(() => {});
    return () => sub.remove();
  }, [router]);

  // V50.z84 — Registra device token per push ad ogni app open / login
  useEffect(() => {
    if (!user?.user_id) return;
    registerForPush(user.user_id).catch(() => {});
  }, [user?.user_id]);
  return (
    <View style={{ flex: 1 }}>
      {/* V50.z186 — padding dinamico = altezza tastiera (solo Android): il campo attivo resta visibile */}
      <AndroidKeyboardPadding>
        <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
      </AndroidKeyboardPadding>
      {/* V50.z181 — badge icona app = notifiche AxonOS non lette */}
      <AxnBadgeSync enabled={!!user?.user_id} />
      {/* V50.z193 — Bridge push: token con retry + stato dispositivo al server + ack test programmati */}
      <PushBridgeSync userId={user?.user_id} />
      <AssistantFAB />
      {/* V50.z147 — Rimosso il bottone Help/Support Center dalle top header di tutte le pagine
          (`<SupportFab />`, V49.j/k): ridondante con il tab "Help" della bottom bar (V50.z141).
          Il componente resta in `src/SupportFab.tsx` per eventuale riuso. */}
      {/* V50.z5 — Calculator FAB globale: appare in tutte le pagine, anche
          sopra i modali fatture (posizionato accanto al FAB Axon). */}
      {user ? <CalculatorFAB /> : null}
      {user ? <PersistentBottomNav /> : null}
      {user ? <OnboardingWizard /> : null}
      {/* V50.z15 — Edge Panel Samsung-style: linguetta a destra, shortcut personalizzabili */}
      {user ? <EdgePanel /> : null}
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  // V29.aj — Fallback timer: se il caricamento dei font (fontfaceobserver
  // interno di expo-font su web) va in timeout dopo 6s l'app resterebbe bianca.
  // Dopo 1500ms procediamo comunque a rendere l'app; i font si caricheranno in
  // background e le icone appariranno appena disponibili.
  const [proceed, setProceed] = React.useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProceed(true), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (loaded || error || proceed) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error, proceed]);

  // V50.x — Wake Word globale: se l'utente ha attivato il toggle in Impostazioni,
  // avvia il servizio (native se disponibile, mock altrimenti) e alla rilevazione
  // apre la schermata Axon Drive in modalità automatica.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let mounted = true;
    (async () => {
      try {
        const enabled = await AsyncStorage.getItem("wake_word_enabled_v1");
        if (!mounted || enabled !== "1") return;
        await WakeWordService.start({ threshold: 0.8 });
        unsub = WakeWordService.onWake(({ score, source }) => {
          console.log(`[WakeWord] Axon rilevato (${source}, score=${score.toFixed(2)}) → Axon Drive`);
          try { expoRouter.push("/voice-copilot?auto=1" as any); } catch {/* noop */}
        });
      } catch (e) { console.warn("[WakeWord] init error:", e); }
    })();
    return () => {
      mounted = false;
      if (unsub) unsub();
      WakeWordService.stop().catch(() => {});
    };
  }, []);

  if (!loaded && !error && !proceed) return null;

  return (
    <GlobalErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* V50.z55 — Tastiera globale: `KeyboardProvider` di
              `react-native-keyboard-controller` abilita in tutte le pagine
              il comportamento nativo che porta il TextInput focalizzato sopra
              la tastiera (scroll automatico, adjustResize su Android,
              scroll-into-view su iOS). Copertura globale senza modifiche
              per singola pagina. */}
          <KeyboardProvider>
            <RootInsetsProbe />
            <AuthProvider>
              <LockGate />
              <AnimatedSplash />
            </AuthProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </GlobalErrorBoundary>
  );
}

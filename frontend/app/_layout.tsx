import "@/src/polyfills"; // MUST be first — installs TextEncoder/TextDecoder polyfill for Hermes (jspdf/xlsx need latin1)
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { LogBox, Platform, View, AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth, isAppLockEnabled, isTrustStillValid } from "@/src/auth";
import { AppLockOverlay } from "@/src/AppLock";
import { AssistantFAB } from "@/src/AssistantChat";
import { PersistentBottomNav } from "@/src/PersistentBottomNav";
import { AnimatedSplash } from "@/src/AnimatedSplash";
import { FabStackProvider } from "@/src/FabStack";
import { ActiveCallProvider } from "@/src/CallTimerBar";
import { storage } from "@/src/utils/storage";
import { configureNotifHandler } from "@/src/notifs";
import { GlobalErrorBoundary } from "@/src/GlobalErrorBoundary";

configureNotifHandler();

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
        await storage.secureSet("app_bg_at_v1", Date.now());
        return;
      }
      if (!user) return;

      // If trust expired -> force full logout (triggers login flow with 2FA)
      const trustOk = await isTrustStillValid();
      if (!trustOk) {
        await logout();
        return;
      }

      const lockOn = await isAppLockEnabled();
      if (!lockOn) return;

      const bgAt = (await storage.secureGet<number | null>("app_bg_at_v1", null)) as number | null;
      const idleMs = 5 * 60 * 1000;
      if (bgAt && Date.now() - Number(bgAt) > idleMs) {
        setLocked(true);
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
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
      <AssistantFAB />
      {user ? <PersistentBottomNav /> : null}
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

  if (!loaded && !error && !proceed) return null;

  return (
    <GlobalErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            <LockGate />
            <AnimatedSplash />
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </GlobalErrorBoundary>
  );
}

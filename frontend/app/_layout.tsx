import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, Platform, View, AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth, isAppLockEnabled, isTrustStillValid } from "@/src/auth";
import { AppLockOverlay } from "@/src/AppLock";
import { storage } from "@/src/utils/storage";
import { configureNotifHandler } from "@/src/notifs";

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
  return <Stack screenOptions={{ headerShown: false, animation: "fade" }} />;
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <LockGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

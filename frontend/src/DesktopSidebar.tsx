// DesktopSidebar.tsx — V50.z409 — Navigazione laterale per web desktop (≥ 1024 px).
// Sostituisce la bottom nav: logo in alto, voci principali (stesse TABS della PersistentBottomNav), utente + logout in basso.
// Montata in app/_layout.tsx (StackWithCallBar) SOLO quando isDesktop && user && rotta non a schermo intero.
import React from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { HT } from "@/src/homeTheme";
import { useAuth } from "@/src/auth";
import { TABS, HIDE_ON_PATHS } from "@/src/PersistentBottomNav";
import { SIDEBAR_W } from "@/src/hooks/useResponsive";

const LOGO = require("@/assets/images/advisoros-logo-transparent.png");

export function desktopSidebarHidden(pathname: string): boolean {
  return HIDE_ON_PATHS.some((p) => pathname === p) || pathname.startsWith("/auth") || pathname.startsWith("/login") || pathname.startsWith("/register") || pathname.startsWith("/reset-password");
}

export function DesktopSidebar() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { user, logout } = useAuth();
  const current = TABS.find((t) =>
    t.activePrefixes ? t.activePrefixes.some((p) => pathname.startsWith(p)) : pathname.includes(`/${t.name}`),
  )?.name;

  return (
    <View style={styles.root} testID="desktop-sidebar">
      <Pressable onPress={() => router.push("/(tabs)/home" as any)} style={styles.brand} testID="desktop-sidebar-brand">
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandTxt}>Advisor<Text style={{ color: HT.brand }}>OS</Text></Text>
      </Pressable>

      <View style={styles.menu}>
        {TABS.map((t) => {
          const active = current === t.name;
          return (
            <Pressable key={t.name} onPress={() => router.push(t.route as any)} style={[styles.item, active && styles.itemOn]} testID={`desktop-tab-${t.name}`}>
              <Ionicons name={active ? t.iconOn : t.iconOff} size={20} color={active ? HT.brand : HT.text2} />
              <Text style={[styles.itemTxt, active && styles.itemTxtOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Pressable onPress={() => router.push("/(tabs)/impostazioni" as any)} style={styles.userRow} testID="desktop-sidebar-user">
          {user?.picture ? <Image source={{ uri: user.picture }} style={styles.avatar} /> : (
            <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarTxt}>{(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}</Text></View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName} numberOfLines={1}>{user?.name || "Utente"}</Text>
            <Text style={styles.userMail} numberOfLines={1}>{user?.email || ""}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => { void logout(); }} style={styles.logout} hitSlop={6} testID="desktop-sidebar-logout">
          <Ionicons name="log-out-outline" size={18} color={HT.muted} />
          <Text style={styles.logoutTxt}>Esci</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: SIDEBAR_W, backgroundColor: HT.nav, borderRightWidth: 1, borderRightColor: HT.border, paddingVertical: 16, paddingHorizontal: 12, gap: 8 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 8 },
  logo: { width: 34, height: 34 },
  brandTxt: { fontSize: 19, fontWeight: "900", color: HT.text, letterSpacing: -0.4 },
  menu: { gap: 2 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, minHeight: 44 },
  itemOn: { backgroundColor: HT.brandTint },
  itemTxt: { fontSize: 14.5, fontWeight: "700", color: HT.text2 },
  itemTxtOn: { color: HT.brand, fontWeight: "800" },
  footer: { marginTop: "auto", gap: 6, borderTopWidth: 1, borderTopColor: HT.border, paddingTop: 12 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: HT.brand, fontWeight: "900", fontSize: 15 },
  userName: { fontSize: 13.5, fontWeight: "800", color: HT.text },
  userMail: { fontSize: 11.5, color: HT.muted },
  logout: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40 },
  logoutTxt: { fontSize: 13, fontWeight: "700", color: HT.muted },
});

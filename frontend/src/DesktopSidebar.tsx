// DesktopSidebar.tsx — V50.z409 — Navigazione laterale per web desktop (≥ 1024 px).
// Sostituisce la bottom nav: logo in alto, voci principali (stesse TABS della PersistentBottomNav), utente + logout in basso.
// V50.z489 — sotto «Profilo»: blocco «Interfaccia Master» (Agenda · Contatti · Contratti · Team) + «Menu completo» (le stesse voci
// del menu hamburger della Home, raggruppate per categoria): il menu non sparisce più cambiando pagina. Solo web desktop.
// Montata in app/_layout.tsx (StackWithCallBar) SOLO quando isDesktop && user && rotta non a schermo intero.
import React from "react";
import { View, Text, Pressable, StyleSheet, Image, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { HT } from "@/src/homeTheme";
import { useAuth } from "@/src/auth";
import { TABS, HIDE_ON_PATHS } from "@/src/PersistentBottomNav";
import { SIDEBAR_W } from "@/src/hooks/useResponsive";
import { ITEMS as DRAWER_ITEMS, type DrawerItem } from "@/src/DrawerMenu"; // V50.z489 — stesse voci del menu hamburger
import { MENU_CATEGORIES } from "@/src/menuCategories";
import { MenuIcon } from "@/src/LockKeyIcon";

// V50.z489 — voci del menu Home (Interfaccia Master) sempre visibili sotto «Profilo»
const MASTER_LINKS: { label: string; icon: any; route: string }[] = [
  { label: "Agenda", icon: "calendar-outline", route: "/(tabs)/calendario" },
  { label: "Contatti", icon: "people-outline", route: "/(tabs)/contatti" },
  { label: "Contratti", icon: "document-text-outline", route: "/crt" },
  { label: "Team", icon: "people-circle-outline", route: "/team" },
];
const GROUPED = Object.values(MENU_CATEGORIES)
  .sort((a, b) => a.order - b.order)
  .map((cat) => ({ cat, items: DRAWER_ITEMS.filter((i) => i.categoryKey === cat.key) }))
  .filter((g) => g.items.length > 0);

const LOGO = require("@/assets/images/advisoros-logo-transparent.png");

export function desktopSidebarHidden(pathname: string): boolean {
  // V50.z493 — /landing e /lite sono pagine pubbliche: mai sidebar, anche da loggati
  if (pathname === "/landing" || pathname === "/lite" || pathname.startsWith("/landing/") || pathname.startsWith("/lite/")) return true;
  if (pathname.startsWith("/voice-copilot")) return true; // V50.z495 — Axon Drive: solo la schermata di guida, niente sidebar/menu
  return HIDE_ON_PATHS.some((p) => pathname === p) || pathname.startsWith("/auth") || pathname.startsWith("/login") || pathname.startsWith("/register") || pathname.startsWith("/reset-password");
}

export function DesktopSidebar() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { user, logout } = useAuth();
  const current = TABS.find((t) =>
    t.activePrefixes ? t.activePrefixes.some((p) => pathname.startsWith(p)) : pathname.includes(`/${t.name}`),
  )?.name;
  const isActive = (route: string) => { const p = route.replace("/(tabs)", "").split("?")[0]; return !!p && p !== "/" && pathname === p; };

  return (
    <View style={styles.root} testID="desktop-sidebar">
      <Pressable onPress={() => router.push("/(tabs)/home" as any)} style={styles.brand} testID="desktop-sidebar-brand">
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandTxt}>Advisor<Text style={{ color: HT.brand }}>OS</Text></Text>
      </Pressable>

      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: 2 }} showsVerticalScrollIndicator={false} testID="desktop-sidebar-scroll">
        {TABS.map((t) => {
          const active = current === t.name;
          return (
            <Pressable key={t.name} onPress={() => router.push(t.route as any)} style={[styles.item, active && styles.itemOn]} testID={`desktop-tab-${t.name}`}>
              <Ionicons name={active ? t.iconOn : t.iconOff} size={20} color={active ? HT.brand : HT.text2} />
              <Text style={[styles.itemTxt, active && styles.itemTxtOn]}>{t.label}</Text>
            </Pressable>
          );
        })}

        {/* V50.z489 — Interfaccia Master: Agenda · Contatti · Contratti · Team (prima solo nel menu della Home) */}
        <Text style={styles.sectionLbl} testID="desktop-master-section">Interfaccia Master</Text>
        {MASTER_LINKS.map((m) => {
          const active = isActive(m.route);
          return (
            <Pressable key={m.label} onPress={() => router.push(m.route as any)} style={[styles.item, styles.itemSm, active && styles.itemOn]} testID={`desktop-master-${m.label.toLowerCase()}`}>
              <Ionicons name={m.icon} size={18} color={active ? HT.brand : HT.text2} />
              <Text style={[styles.itemTxt, styles.itemTxtSm, active && styles.itemTxtOn]}>{m.label}</Text>
            </Pressable>
          );
        })}

        {/* V50.z489 — Menu completo (stesse voci dell'hamburger della Home), per categoria */}
        <Text style={styles.sectionLbl} testID="desktop-fullmenu-section">Menu completo</Text>
        {GROUPED.map(({ cat, items }) => (
          <View key={cat.key} style={{ marginBottom: 6 }}>
            <View style={styles.catRow}>
              <View style={[styles.catDot, { backgroundColor: cat.color }]} />
              <Text style={[styles.catLbl, { color: cat.color }]}>{cat.label}</Text>
            </View>
            {items.map((it: DrawerItem) => {
              const active = !it.action && isActive(it.href);
              return (
                <Pressable key={it.href} onPress={() => { if (it.action) it.action(); else router.push(it.href as any); }} style={[styles.item, styles.itemSm, active && styles.itemOn]} testID={`desktop-menu-${it.href}`}>
                  <View style={[styles.menuIcon, { backgroundColor: cat.color }]}><MenuIcon name={it.icon} size={13} color="#FFF" /></View>
                  <Text style={[styles.itemTxt, styles.itemTxtSm, active && styles.itemTxtOn]} numberOfLines={1}>{it.label}</Text>
                  {it.badge ? <it.badge /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

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
  sectionLbl: { fontSize: 10.5, fontWeight: "900", color: HT.muted, letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 12, marginTop: 14, marginBottom: 4 },
  itemSm: { paddingVertical: 7, minHeight: 36, gap: 10 },
  itemTxtSm: { fontSize: 13 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, marginTop: 6, marginBottom: 2 },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  catLbl: { fontSize: 10, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  menuIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
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

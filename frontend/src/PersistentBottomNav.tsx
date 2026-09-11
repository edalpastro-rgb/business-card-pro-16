import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useNavBarBottomInset } from "@/src/hooks/useSafeBottom";

/**
 * V29.n — Barra di navigazione inferiore SEMPRE visibile su tutte le schermate
 * fuori dal gruppo (tabs) (es. scheda anagrafica cliente, Interfaccia Master,
 * dettagli appuntamento, ecc.). Su rotte interne a (tabs) resta invisibile: la
 * Tabs nativa di expo-router prende il posto.
 *
 * Non ridefiniamo la Tabs (che rimane sorgente di verità per gli screens
 * principali) — questa è solo una replica visiva per garantire coerenza di
 * navigazione all'utente.
 */

const TAB_ACTIVE = "#FF6B35";
const TAB_INACTIVE = "#94A3B8";
const TAB_BG = "#FFFFFF";
const TAB_BORDER = "#EEF0F4";

type TabDef = {
  name: string;
  label: string;
  route: `/${string}`;
  iconOn: keyof typeof Ionicons.glyphMap;
  iconOff: keyof typeof Ionicons.glyphMap;
  /** V50.z141 — prefissi di pathname extra che rendono attivo il tab (es. Help → /libretto) */
  activePrefixes?: string[];
};

const TABS: TabDef[] = [
  { name: "home",         label: "Home",       route: "/(tabs)/home",         iconOn: "grid",             iconOff: "grid-outline" },
  { name: "contatti",     label: "Contatti",   route: "/(tabs)/contatti",     iconOn: "people",           iconOff: "people-outline" },
  { name: "chat",         label: "Chat",       route: "/(tabs)/chat",         iconOn: "chatbubbles",      iconOff: "chatbubbles-outline" },
  { name: "calendario",   label: "Calendario", route: "/(tabs)/calendario",   iconOn: "calendar",         iconOff: "calendar-outline" },
  // V50.z141 — "Report" sostituito da "Help" (apre la guida / tour guidato). Statistiche → menu laterale.
  { name: "help",         label: "Help",       route: "/libretto",            iconOn: "help-circle",      iconOff: "help-circle-outline", activePrefixes: ["/libretto", "/help"] },
  { name: "impostazioni", label: "Profilo",    route: "/(tabs)/impostazioni", iconOn: "person-circle",    iconOff: "person-circle-outline" },
];

// Rotte dove la barra NON deve mai apparire (login, splash, app-lock,
// schermate di creazione con sticky footer proprio).
const HIDE_ON_PATHS = [
  "/login", "/index", "/", "/auth",
  "/appointment/new", "/callback/new",
  // V50.w — Schermate con footer sticky che verrebbero coperti dalla tab bar
  "/google-drive-picker",
  "/axon-scripts-import",
  "/libretto-editor",
];

export function PersistentBottomNav() {
  const pathname = usePathname() || "";
  const router = useRouter();
  // V50.z167 — stesso hook della Tabs nativa: padding-bottom identico su tutte le schermate
  const bottomInset = useNavBarBottomInset();

  // Se siamo su una rotta interna a (tabs)/*, la Tabs nativa gestisce la barra:
  // rileviamo controllando se il pathname corrisponde a uno dei tab principali
  // (+ /report, rotta del gruppo (tabs) non più visibile nella barra).
  const TAB_GROUP_EXTRA = ["/report"];
  const inTabs =
    pathname === "/" ||
    TAB_GROUP_EXTRA.some((p) => pathname === p || pathname === `/(tabs)${p}`) ||
    TABS.some((t) => {
      if (!t.route.startsWith("/(tabs)")) return false;
      const bare = t.route.replace("/(tabs)", "");
      return pathname === bare || pathname === `/(tabs)${bare}`;
    });

  const hideCompletely = HIDE_ON_PATHS.some((p) => pathname === p) || pathname.startsWith("/auth");
  if (hideCompletely) return null;
  if (inTabs) return null; // la Tabs nativa è già visibile

  const current = TABS.find((t) =>
    t.activePrefixes ? t.activePrefixes.some((p) => pathname.startsWith(p)) : pathname.includes(`/${t.name}`),
  )?.name;

  return (
    <View
      style={[
        styles.bar,
        {
          height: 60 + bottomInset,
          paddingBottom: bottomInset,
        },
      ]}
      testID="persistent-bottom-nav"
      pointerEvents="box-none"
    >
      {TABS.map((t) => {
        const isActive = current === t.name;
        return (
          <Pressable
            key={t.name}
            onPress={() => router.push(t.route as any)}
            style={styles.item}
            hitSlop={6}
            testID={`persistent-tab-${t.name}`}
          >
            <Ionicons
              name={isActive ? t.iconOn : t.iconOff}
              size={t.name === "impostazioni" ? 24 : 22}
              color={isActive ? TAB_ACTIVE : TAB_INACTIVE}
            />
            <Text style={[styles.lbl, { color: isActive ? TAB_ACTIVE : TAB_INACTIVE }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: TAB_BG,
    borderTopColor: TAB_BORDER,
    borderTopWidth: 1,
    paddingTop: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOpacity: 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 8 },
      default: {},
    }),
    zIndex: 40,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
    gap: 3,
  },
  lbl: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginTop: 3,
  },
});

export default PersistentBottomNav;

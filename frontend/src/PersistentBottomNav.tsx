import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
};

const TABS: TabDef[] = [
  { name: "home",         label: "Home",       route: "/(tabs)/home",         iconOn: "grid",             iconOff: "grid-outline" },
  { name: "contatti",     label: "Contatti",   route: "/(tabs)/contatti",     iconOn: "people",           iconOff: "people-outline" },
  { name: "chat",         label: "Chat",       route: "/(tabs)/chat",         iconOn: "chatbubbles",      iconOff: "chatbubbles-outline" },
  { name: "calendario",   label: "Calendario", route: "/(tabs)/calendario",   iconOn: "calendar",         iconOff: "calendar-outline" },
  { name: "report",       label: "Report",     route: "/(tabs)/report",       iconOn: "bar-chart",        iconOff: "bar-chart-outline" },
  { name: "impostazioni", label: "Profilo",    route: "/(tabs)/impostazioni", iconOn: "person-circle",    iconOff: "person-circle-outline" },
];

// Rotte dove la barra NON deve mai apparire (login, splash, app-lock,
// schermate di creazione con sticky footer proprio).
const HIDE_ON_PATHS = ["/login", "/index", "/", "/auth", "/appointment/new", "/callback/new"];

export function PersistentBottomNav() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Se siamo su una rotta interna a (tabs)/*, la Tabs nativa gestisce la barra:
  // rileviamo controllando se il pathname corrisponde a uno dei tab principali.
  const inTabs =
    pathname === "/" ||
    TABS.some((t) => {
      const bare = t.route.replace("/(tabs)", "");
      return pathname === bare || pathname === `/(tabs)${bare}`;
    });

  const hideCompletely = HIDE_ON_PATHS.some((p) => pathname === p) || pathname.startsWith("/auth");
  if (hideCompletely) return null;
  if (inTabs) return null; // la Tabs nativa è già visibile

  const bottomInset = Math.max(insets.bottom || 0, 20);

  const current = TABS.find((t) => pathname.includes(`/${t.name}`))?.name;

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

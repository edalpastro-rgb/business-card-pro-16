// V50.z35 — Drawer laterale con 6 categorie colorate (Proposta A palette).
// Stile ispirato agli screenshot dell'utente: header categoria uppercase con
// linea sotto, voci con icona circolare piena a colore, separatore sottile.
// Le quick actions della Home restano invariate: questo drawer è un menu
// COMPLETO che si apre dal pulsante hamburger.

import { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, Animated,
  Dimensions, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { theme } from "@/src/theme";
import { MENU_CATEGORIES } from "@/src/menuCategories";

type IconName = keyof typeof Ionicons.glyphMap;

type DrawerItem = {
  label: string;
  icon: IconName;
  href: string;
  categoryKey: keyof typeof MENU_CATEGORIES;
};

const ITEMS: DrawerItem[] = [
  // CRM Core (blu #0EA5E9)
  { label: "Cruscotto",         icon: "speedometer-outline",  href: "/cruscotto",          categoryKey: "crm" },
  { label: "Contatti",          icon: "people-outline",       href: "/contatti",           categoryKey: "crm" },
  { label: "Nuovo Contatto",    icon: "person-add-outline",   href: "/contact/new",        categoryKey: "crm" },
  { label: "Appuntamenti",      icon: "calendar-outline",     href: "/calendario",         categoryKey: "crm" },
  { label: "Nuovo Appuntamento",icon: "add-circle-outline",   href: "/appointment/new",    categoryKey: "crm" },
  { label: "Scadenze",          icon: "hourglass-outline",    href: "/deadlines",          categoryKey: "crm" },
  // AI & Axon (viola #7C3AED)
  { label: "Axon Hub",          icon: "sparkles",             href: "/axon-hub",           categoryKey: "axon" },
  { label: "Insegna ad Axon",   icon: "school-outline",       href: "/ai-teach",           categoryKey: "axon" },
  { label: "Cervello Axon",     icon: "bulb-outline",         href: "/axon-brain",         categoryKey: "axon" },
  { label: "Voice Copilot",     icon: "mic",                  href: "/voice-copilot",      categoryKey: "axon" },
  { label: "Timer & Sveglie",   icon: "alarm-outline",        href: "/axon-alarms",        categoryKey: "axon" },
  { label: "Avvisi Axon",       icon: "notifications-outline",href: "/axon-alerts",        categoryKey: "axon" },
  { label: "Home Assistant",    icon: "home-outline",         href: "/axon-homeassistant", categoryKey: "axon" },
  { label: "Help Center",       icon: "shield-checkmark-outline", href: "/help-center",    categoryKey: "axon" },
  // Comunicazioni (arancione #F97316)
  { label: "Caselle Mail",      icon: "mail-outline",         href: "/email-accounts",     categoryKey: "comm" },
  { label: "Auto-CRM da Mail",  icon: "flash-outline",        href: "/mail-crm-proposals", categoryKey: "comm" },
  { label: "Outlook",           icon: "mail-open-outline",    href: "/outlook",            categoryKey: "comm" },
  { label: "Chat Team",         icon: "chatbubbles-outline",  href: "/(tabs)/chat",        categoryKey: "comm" },
  // Anagrafica & DB Master (verde #10B981)
  { label: "Anagrafica Master",   icon: "id-card-outline",      href: "/anagrafica-master",   categoryKey: "docs" },
  { label: "Master Files",        icon: "folder-outline",       href: "/master-files",        categoryKey: "docs" },
  { label: "Google Drive",        icon: "cloud-outline",        href: "/google-drive",        categoryKey: "docs" },
  { label: "Biglietto da visita", icon: "card-outline",         href: "/business-card",       categoryKey: "docs" },
  // Team & Insights (giallo #EAB308)
  { label: "Team Insights",     icon: "analytics-outline",    href: "/team-insights",      categoryKey: "team" },
  { label: "Invita Collaboratore", icon: "person-add-outline",href: "/invite-collaborator",categoryKey: "team" },
  { label: "Statistiche",       icon: "bar-chart-outline",    href: "/(tabs)/report",      categoryKey: "team" }, // V50.z141 — ex tab "Report"
  // Amministrazione (grigio #475569)
  { label: "Impostazioni",      icon: "settings-outline",     href: "/(tabs)/impostazioni",categoryKey: "admin" },
  { label: "Setting App",       icon: "color-palette-outline",href: "/settings-app",       categoryKey: "admin" },
  { label: "Bug & Idee",        icon: "bug-outline",          href: "/bug-report",         categoryKey: "admin" },
];

const SCREEN_W = Dimensions.get("window").width;
const DRAWER_W = Math.min(SCREEN_W * 0.85, 340);

export function DrawerMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const slideX = useRef(new Animated.Value(-DRAWER_W)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideX, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideX, { toValue: -DRAWER_W, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slideX, opacity]);

  const go = (href: string) => {
    onClose();
    // slight delay so drawer close animation doesn't glitch
    setTimeout(() => router.push(href as any), 80);
  };

  // Raggruppa per categoria in ordine palette
  const grouped = Object.values(MENU_CATEGORIES)
    .sort((a, b) => a.order - b.order)
    .map((cat) => ({ cat, items: ITEMS.filter((i) => i.categoryKey === cat.key) }))
    .filter((g) => g.items.length > 0);

  return (
    <Modal visible={visible} transparent onRequestClose={onClose} animationType="none" statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.45)", opacity }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} testID="drawer-backdrop" />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          { width: DRAWER_W, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, transform: [{ translateX: slideX }] },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.brandBadge}>
            <Ionicons name="sparkles" size={18} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTitle}>AdvisorOS</Text>
            <Text style={styles.brandSub}>Menu completo</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} testID="drawer-close">
            <Ionicons name="close" size={26} color={theme.color.onSurface} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
          {grouped.map(({ cat, items }) => (
            <View key={cat.key} style={{ marginTop: 14 }}>
              {/* Header categoria: linea + label uppercase */}
              <View style={styles.catHeaderRow}>
                <View style={[styles.catBadge, { backgroundColor: cat.color + "22" }]}>
                  <Ionicons name={cat.icon as any} size={12} color={cat.color} />
                </View>
                <Text style={[styles.catLabel, { color: cat.color }]}>{cat.label}</Text>
                <View style={[styles.catLine, { backgroundColor: cat.color + "33" }]} />
              </View>
              {items.map((it) => (
                <Pressable
                  key={it.href}
                  onPress={() => go(it.href)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: cat.color + "0C" }]}
                  testID={`drawer-item-${it.href}`}
                >
                  <View style={[styles.rowIcon, { backgroundColor: cat.color }]}>
                    <Ionicons name={it.icon} size={18} color="#FFF" />
                  </View>
                  <Text style={styles.rowLabel} numberOfLines={1}>{it.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: "absolute", left: 0, top: 0, bottom: 0,
    backgroundColor: "#FFFFFF",
    borderTopRightRadius: 22, borderBottomRightRadius: 22,
    paddingHorizontal: 12,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 10px 30px rgba(0,0,0,0.2)" } as any)
      : { shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 3, height: 0 }, elevation: 24 }),
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  brandBadge: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: "#0F172A",
    alignItems: "center", justifyContent: "center",
  },
  brandTitle: { fontSize: 15, fontWeight: "900", color: theme.color.onSurface, letterSpacing: -0.3 },
  brandSub: { fontSize: 11, color: theme.color.muted, marginTop: 1 },

  catHeaderRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginBottom: 6, paddingHorizontal: 4,
  },
  catBadge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" },
  catLine: { flex: 1, height: 2, borderRadius: 1, marginLeft: 4 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10, paddingHorizontal: 6, borderRadius: 10,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: "#0F172A" },
});

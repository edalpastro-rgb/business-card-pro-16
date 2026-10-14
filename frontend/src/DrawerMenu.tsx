// V50.z35 — Drawer laterale con 6 categorie colorate (Proposta A palette).
// Stile ispirato agli screenshot dell'utente: header categoria uppercase con
// linea sotto, voci con icona circolare piena a colore, separatore sottile.
// Le quick actions della Home restano invariate: questo drawer è un menu
// COMPLETO che si apre dal pulsante hamburger.

import React, { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, Animated,
  Dimensions, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MenuIcon, MenuIconName, LOCK_KEY_ICON } from "@/src/LockKeyIcon"; // V50.z237
import { useRouter } from "expo-router";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { useSuperAdmin } from "@/src/useSuperAdmin"; // V50.z542
import { MENU_CATEGORIES } from "@/src/menuCategories";
import { CgymDrawerBadge } from "@/src/corporate-gym/CgymDrawerBadge"; // Corporate Gym (Blocco 3)

import { AxnDrawerBadge } from "@/src/AxnDrawerBadge"; // V50.z181 — notifiche push AxonOS
import { AlarmDrawerBadge } from "@/src/AlarmIndicators"; // V50.z334 — «tra 25m» accanto a Timer & Sveglie
import { openAxonRecommendations } from "@/src/axonProactive"; // V50.z334 — Consigli di Axon → chat
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

// Axon Drive — piccola icona automobile accanto al nome (solo UI)
const AxonDriveCarBadge = () => <Ionicons name="car-sport" size={16} color="#7C3AED" style={{ marginRight: 6 }} />;

type IconName = MenuIconName;

export type DrawerItem = {
  label: string;
  icon: IconName;
  href: string;
  categoryKey: keyof typeof MENU_CATEGORIES;
  badge?: React.ComponentType; // indicatore opzionale a destra (es. Corporate Gym "3/7")
  action?: () => void; // V50.z334 — azione al posto della navigazione (es. apre la chat Axon)
  superAdminOnly?: boolean; // V50.z542 — visibile solo al Supermaster
};

export const ITEMS: DrawerItem[] = [
  // CRM Core (blu #0EA5E9)
  { label: "Cruscotto",         icon: "speedometer-outline",  href: "/cruscotto",          categoryKey: "crm" },
  { label: "Contatti",          icon: "people-outline",       href: "/contatti",           categoryKey: "crm" },
  { label: "Nuovo Contatto",    icon: "person-add-outline",   href: "/contact/new",        categoryKey: "crm" },
  { label: "Appuntamenti",      icon: "calendar-outline",     href: "/calendario",         categoryKey: "crm" },
  { label: "Nuovo Appuntamento",icon: "add-circle-outline",   href: "/appointment/new",    categoryKey: "crm" },
  { label: "Call",              icon: "call-outline",         href: "/call",               categoryKey: "crm" }, // V50.z506 — modulo Call (telefonate del giorno)
  { label: "Scadenze",          icon: "hourglass-outline",    href: "/deadlines",          categoryKey: "crm" },
  { label: "Contratti",         icon: "document-text-outline", href: "/crt",               categoryKey: "crm" }, // V50.z489 — anche nella sidebar web
  // AI & Axon (viola #7C3AED)
  { label: "Axon Hub",          icon: "sparkles",             href: "/axon-hub",           categoryKey: "axon" },
  { label: "Addestramento wake-word Axon", icon: "mic-circle-outline", href: "/wake-word-training", categoryKey: "axon" }, // V50.z410
  { label: "Consigli di Axon",  icon: "bulb",                 href: "#axon-recommendations", categoryKey: "axon", action: openAxonRecommendations }, // V50.z334 — consigli del Tour nella chat
  { label: "Insegna ad Axon",   icon: "school-outline",       href: "/ai-teach",           categoryKey: "axon" },
  { label: "Cervello Axon",     icon: "bulb-outline",         href: "/axon-brain",         categoryKey: "axon" },
  { label: "Axon Drive",        icon: "mic",                  href: "/voice-copilot",      categoryKey: "axon", badge: AxonDriveCarBadge },
  { label: "Timer & Sveglie",   icon: "alarm-outline",        href: "/axon-alarms",        categoryKey: "axon", badge: AlarmDrawerBadge }, // V50.z334 — prossima sveglia/timer
  { label: "Notifiche Axon",    icon: "notifications",        href: "/axon-notifications", categoryKey: "axon", badge: AxnDrawerBadge },
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
  { label: "Modelli moduli",      icon: "document-attach-outline", href: "/form-templates",   categoryKey: "docs" }, // V50.z268 — PDF moduli auto-compilati
  { label: "Master Files",        icon: "folder-outline",       href: "/master-files",        categoryKey: "docs" },
  { label: "Google Drive",        icon: "cloud-outline",        href: "/google-drive",        categoryKey: "docs" },
  { label: "Le mie aree",         icon: "flash-outline",        href: "/le-mie-aree",         categoryKey: "docs" },
  { label: "Mappa Clienti",       icon: "map-outline",          href: "/map-clients",         categoryKey: "crm" }, // V50.z240 — FEAT-GEO-001
  { label: "Giro Ottimale",       icon: "car-sport-outline",    href: "/optimal-route",       categoryKey: "crm" }, // V50.z240
  { label: "Resoconto Km",        icon: "speedometer-outline",  href: "/km-report",           categoryKey: "crm" }, // V50.z253
  { label: "Note spese & Storico", icon: "receipt-outline",     href: "/axon-expenses",       categoryKey: "docs" }, // V50.z229 — storico spese, chiusura mese, statistiche // V50.z228 — mini-wizard aree + stato configurazione
  { label: "Integrazioni AxonOS", icon: "link-outline",         href: "/axon-integrations",   categoryKey: "docs" }, // V50.z197 — Blocco 8: due sfere
  { label: "Spazio Personale",    icon: LOCK_KEY_ICON,          href: "/spazio-personale",    categoryKey: "docs" }, // V50.z205 — Blocco 8 Fase 4: Sfera Home · V50.z237 lucchetto+chiave (area protetta da PIN)
  { label: "Biglietto da visita", icon: "card-outline",         href: "/business-card",       categoryKey: "docs" },
  // Team & Insights (giallo #EAB308)
  { label: "Team",              icon: "people-circle-outline", href: "/team",              categoryKey: "team" }, // V50.z489
  { label: "Team Insights",     icon: "analytics-outline",    href: "/team-insights",      categoryKey: "team" },
  { label: "Invita Collaboratore", icon: "person-add-outline",href: "/invite-collaborator",categoryKey: "team" },
  { label: "Statistiche",       icon: "bar-chart-outline",    href: "/(tabs)/report",      categoryKey: "team" }, // V50.z141 — ex tab "Report"
  { label: "Corporate Gym",     icon: "barbell-outline",      href: "/corporate-gym",      categoryKey: "team", badge: CgymDrawerBadge }, // Corporate Gym (Blocco 1/3)
  { label: "Utenti Registrati", icon: "shield-checkmark-outline", href: "/admin/users",    categoryKey: "team", superAdminOnly: true }, // V50.z542 — Pannello Supermaster
  // Amministrazione (grigio #475569)
  { label: "Impostazioni",      icon: "settings-outline",     href: "/(tabs)/impostazioni",categoryKey: "admin" },
  { label: "Setting App",       icon: "color-palette-outline",href: "/settings-app",       categoryKey: "admin" },
  { label: "Email di sistema",  icon: "mail-outline",         href: "/email-config",       categoryKey: "admin" }, // V50.z336 — Resend advisoros.it
  { label: "Bug & Idee",        icon: "bug-outline",          href: "/bug-report",         categoryKey: "admin" },
];

const SCREEN_W = Dimensions.get("window").width;
const DRAWER_W = Math.min(SCREEN_W * 0.85, 340);

export function DrawerMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const isSuperAdmin = useSuperAdmin(); // V50.z542
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

  const go = (it: DrawerItem) => {
    onClose();
    // slight delay so drawer close animation doesn't glitch
    setTimeout(() => { if (it.action) it.action(); else router.push(it.href as any); }, 80);
  };

  // Raggruppa per categoria in ordine palette
  const grouped = Object.values(MENU_CATEGORIES)
    .sort((a, b) => a.order - b.order)
    .map((cat) => ({ cat, items: ITEMS.filter((i) => i.categoryKey === cat.key && (!i.superAdminOnly || isSuperAdmin)) }))
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
            <Ionicons name="close" size={26} color={HT.text} />
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
                  onPress={() => go(it)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: cat.color + "0C" }]}
                  testID={`drawer-item-${it.href}`}
                >
                  <View style={[styles.rowIcon, { backgroundColor: cat.color }]}>
                    <MenuIcon name={it.icon} size={18} color="#FFF" />
                  </View>
                  <Text style={styles.rowLabel} numberOfLines={1}>{it.label}</Text>
                  {it.badge ? <it.badge /> : null}
                  <Ionicons name="chevron-forward" size={16} color={HT.muted} />
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
    backgroundColor: HT.card,
    borderTopRightRadius: 22, borderBottomRightRadius: 22,
    paddingHorizontal: 12,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 10px 30px rgba(0,0,0,0.2)" } as any)
      : { shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 3, height: 0 }, elevation: 24 }),
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: HT.card2,
  },
  brandBadge: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F172A',
    alignItems: "center", justifyContent: "center",
  },
  brandTitle: { fontSize: 15, fontWeight: "900", color: HT.text, letterSpacing: -0.3 },
  brandSub: { fontSize: 11, color: HT.muted, marginTop: 1 },

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
    borderBottomWidth: 1, borderBottomColor: HT.card2,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: HT.text },
});

// V50.z15 — Edge Panel: pannello laterale a scomparsa stile Samsung Edge.
// Linguetta sottile sul lato destro dello schermo: tap = apri il pannello,
// swipe verso sinistra = apri con gesture. Contiene shortcut personalizzabili
// (scelte tra le azioni disponibili in tutta l'app).
//
// Persistenza: lista ID selezionati in AsyncStorage (`edge_panel_ids_v1`).
// Posizione verticale linguetta: `edge_panel_tab_y_v1`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Animated, Dimensions,
  PanResponder, ScrollView, Modal, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Elenco azioni disponibili ──────────────────────────────────────
export type EdgeAction = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  href: string;
};

export const EDGE_ACTIONS: EdgeAction[] = [
  { id: "home", label: "Home", icon: "home", color: "#0EA5E9", href: "/(tabs)/home" },
  { id: "master", label: "Interfaccia Master", icon: "grid", color: "#FF6B35", href: "/master" },
  { id: "agenda", label: "Agenda", icon: "calendar", color: "#0891B2", href: "/(tabs)/calendario" },
  { id: "contatti", label: "Contatti", icon: "people", color: "#6366F1", href: "/(tabs)/contatti" },
  { id: "chat", label: "Chat Team", icon: "chatbubbles", color: "#F59E0B", href: "/(tabs)/chat" },
  { id: "report", label: "Report", icon: "bar-chart", color: "#22C55E", href: "/(tabs)/report" },
  { id: "profilo", label: "Profilo", icon: "person", color: "#7C3AED", href: "/(tabs)/impostazioni" },
  { id: "new-contact", label: "Nuovo Contatto", icon: "person-add", color: "#7C3AED", href: "/contact/new" },
  { id: "new-appt", label: "Nuovo Appuntamento", icon: "add-circle", color: "#16A34A", href: "/appointment/new" },
  { id: "new-crt", label: "Nuovo Contratto", icon: "document-text", color: "#059669", href: "/contract/new" },
  { id: "my-audios", label: "I miei audio", icon: "folder-open", color: "#8B5CF6", href: "/my-audios" },
  { id: "my-files", label: "I miei file", icon: "folder-open", color: "#0891B2", href: "/master-files" },
  { id: "my-web", label: "My Web", icon: "globe", color: "#DB2777", href: "/my-web" },
  { id: "bill-quick", label: "Analizza bolletta", icon: "flash", color: "#EA580C", href: "/bill-quick" },
  { id: "business-card", label: "Biglietto Visita", icon: "id-card", color: "#7C3AED", href: "/business-card" },
  { id: "call-script", label: "Script Telefonata", icon: "document-text", color: "#0F766E", href: "/call-script-config" },
  { id: "ai-teach", label: "Insegna ad Axon", icon: "sparkles", color: "#FF6B35", href: "/ai-teach" },
  { id: "axon-brain", label: "Cervello Axon", icon: "sparkles", color: "#7C3AED", href: "/axon-brain" },
  { id: "axon-scripts", label: "Playbook Script", icon: "library", color: "#FBBF24", href: "/axon-scripts" },
  { id: "axon-alarms", label: "Timer & Sveglie", icon: "alarm", color: "#22C55E", href: "/axon-alarms" },
  { id: "libretto", label: "Libretto App", icon: "book", color: "#F59E0B", href: "/libretto" },
  { id: "cruscotto", label: "Cruscotto", icon: "grid", color: "#0EA5E9", href: "/cruscotto" },
  { id: "quick", label: "Azioni Rapide", icon: "flash", color: "#8B5CF6", href: "/quick-actions" },
  { id: "banners", label: "Banner Evento", icon: "megaphone", color: "#F59E0B", href: "/event-banners" },
  { id: "ha", label: "Home Assistant", icon: "home-outline", color: "#3B82F6", href: "/axon-homeassistant" },
];

const KEY_IDS = "edge_panel_ids_v1";
const KEY_TAB_Y = "edge_panel_tab_y_v1";
const KEY_ENABLED = "edge_panel_enabled_v1";
const KEY_DISCOVERED = "edge_panel_discovered_v1";
const DEFAULT_IDS = ["home", "agenda", "new-contact", "axon-alarms", "master"];
const PANEL_WIDTH = 260;
const TAB_WIDTH = 6;
const TAB_HEIGHT = 68;

// Rotte dove nascondere l'edge panel (login, splash)
const HIDE_ON_PATHS = ["/login", "/register", "/reset-password"];

export function EdgePanel() {
  const router = useRouter();
  const pathname = usePathname();
  const { height: screenH } = Dimensions.get("window");

  const [enabled, setEnabled] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_IDS);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tabY, setTabY] = useState<number>(Math.round(screenH * 0.45));
  const [discovered, setDiscovered] = useState<boolean>(true); // V50.z17 — nuovo utente?
  const translateX = useRef(new Animated.Value(PANEL_WIDTH)).current;
  // V50.z17 — Animated values per pulse discovery della linguetta
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Load config
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY_IDS);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
            setSelectedIds(arr);
          }
        }
        const y = await AsyncStorage.getItem(KEY_TAB_Y);
        if (y) {
          const n = parseInt(y, 10);
          if (!isNaN(n)) setTabY(Math.max(60, Math.min(screenH - 200, n)));
        }
        const en = await AsyncStorage.getItem(KEY_ENABLED);
        if (en === "0") setEnabled(false);
        // V50.z17 — Verifica se l'utente ha già scoperto l'Edge Panel
        const disc = await AsyncStorage.getItem(KEY_DISCOVERED);
        if (disc !== "1") setDiscovered(false);
      } catch { /* ignore */ }
    })();
  }, [screenH]);

  // V50.z17 — Pulse loop finché l'utente non ha aperto per la prima volta il
  // pannello. Alone giallo intorno alla linguetta + leggera scala che va e viene.
  useEffect(() => {
    if (discovered || open) return;
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1.0, duration: 900, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [discovered, open, pulseAnim, scaleAnim]);

  // Segna come scoperta la prima volta che l'utente apre il pannello
  useEffect(() => {
    if (open && !discovered) {
      setDiscovered(true);
      AsyncStorage.setItem(KEY_DISCOVERED, "1").catch(() => {});
    }
  }, [open, discovered]);

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: open ? 0 : PANEL_WIDTH,
      useNativeDriver: true,
      friction: 9,
      tension: 60,
    }).start();
  }, [open, translateX]);

  // Drag verticale della linguetta (per riposizionarla) + swipe orizzontale per aprire
  const wasSwipe = useRef(false);
  const tabPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: () => { wasSwipe.current = false; },
      onPanResponderMove: (_e, gs) => {
        // Se movimento orizzontale predominante → indica swipe apri
        if (Math.abs(gs.dx) > Math.abs(gs.dy) && gs.dx < -20) {
          wasSwipe.current = true;
        } else if (Math.abs(gs.dy) > 5) {
          // Drag verticale — sposta la linguetta
          setTabY((prev) => Math.max(60, Math.min(screenH - 200, prev + gs.dy)));
        }
      },
      onPanResponderRelease: (_e, gs) => {
        if (wasSwipe.current && gs.dx < -30) {
          setOpen(true);
        }
        // Salva posizione
        AsyncStorage.setItem(KEY_TAB_Y, String(tabY)).catch(() => {});
      },
    }),
  ).current;

  const actionsSelected = useMemo(
    () => selectedIds.map((id) => EDGE_ACTIONS.find((a) => a.id === id)).filter((x): x is EdgeAction => !!x),
    [selectedIds],
  );

  const saveIds = useCallback(async (ids: string[]) => {
    setSelectedIds(ids);
    try { await AsyncStorage.setItem(KEY_IDS, JSON.stringify(ids)); } catch { /* ignore */ }
  }, []);

  const toggleId = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    saveIds(next);
  };

  const onPickAction = (a: EdgeAction) => {
    setOpen(false);
    setTimeout(() => router.push(a.href as any), 150);
  };

  const hidden = HIDE_ON_PATHS.some((p) => pathname?.startsWith(p));
  if (!enabled || hidden) return null;

  return (
    <>
      {/* Linguetta laterale */}
      {!open && (
        <View
          {...tabPan.panHandlers}
          style={[styles.tab, { top: tabY, right: 0 }]}
          testID="edge-tab"
        >
          <Pressable
            onPress={() => setOpen(true)}
            style={styles.tabInner}
            hitSlop={{ left: 16, right: 4, top: 8, bottom: 8 }}
          >
            {/* V50.z17 — Alone pulsante per farla scoprire ai nuovi utenti */}
            {!discovered && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.tabGlow,
                  {
                    opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.55] }),
                    transform: [{
                      scaleY: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }),
                    }, {
                      scaleX: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }),
                    }],
                  },
                ]}
              />
            )}
            <Animated.View
              style={[
                styles.tabBar,
                !discovered && { transform: [{ scaleX: scaleAnim }] },
                !discovered && { backgroundColor: "#FBBF24", width: TAB_WIDTH + 2 },
              ]}
            />
          </Pressable>
        </View>
      )}

      {/* Overlay quando aperto: chiude toccando fuori */}
      {open && (
        <Pressable
          style={styles.overlay}
          onPress={() => setOpen(false)}
          testID="edge-overlay"
        />
      )}

      {/* Pannello */}
      <Animated.View
        style={[
          styles.panel,
          {
            width: PANEL_WIDTH,
            height: screenH,
            transform: [{ translateX }],
          },
        ]}
        pointerEvents={open ? "auto" : "none"}
      >
        <View style={styles.panelHead}>
          <Ionicons name="apps" size={18} color="#FBBF24" />
          <Text style={styles.panelTitle}>Azioni rapide</Text>
          <Pressable onPress={() => setOpen(false)} hitSlop={10}>
            <Ionicons name="close" size={22} color="#94A3B8" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {actionsSelected.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="hand-left" size={30} color="#64748B" />
              <Text style={styles.emptyTxt}>Nessuna azione ancora. Tocca &quot;Modifica&quot;.</Text>
            </View>
          ) : (
            actionsSelected.map((a) => (
              <Pressable key={a.id} onPress={() => onPickAction(a)} style={styles.tile} testID={`edge-a-${a.id}`}>
                <View style={[styles.tileIcon, { backgroundColor: a.color }]}>
                  <Ionicons name={a.icon} size={22} color="#FFF" />
                </View>
                <Text style={styles.tileTxt} numberOfLines={2}>{a.label}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
        <View style={styles.panelFoot}>
          <Pressable onPress={() => setEditOpen(true)} style={styles.editBtn} testID="edge-edit">
            <Ionicons name="create-outline" size={16} color="#FBBF24" />
            <Text style={styles.editTxt}>Modifica</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* Modal Edit — checklist di tutte le azioni */}
      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <View style={styles.editBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditOpen(false)} />
          <View style={styles.editSheet}>
            <View style={styles.editHead}>
              <Text style={styles.editTitle}>Scegli le scorciatoie</Text>
              <Pressable onPress={() => setEditOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#94A3B8" />
              </Pressable>
            </View>
            <Text style={styles.editSub}>Tocca per aggiungere/rimuovere. Puoi averne quante vuoi.</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {EDGE_ACTIONS.map((a) => {
                const on = selectedIds.includes(a.id);
                return (
                  <Pressable key={a.id} onPress={() => toggleId(a.id)} style={[styles.editRow, on && styles.editRowOn]}>
                    <View style={[styles.editRowIcon, { backgroundColor: a.color }]}>
                      <Ionicons name={a.icon} size={16} color="#FFF" />
                    </View>
                    <Text style={styles.editRowLabel}>{a.label}</Text>
                    <Ionicons
                      name={on ? "checkmark-circle" : "add-circle-outline"}
                      size={22}
                      color={on ? "#22C55E" : "#64748B"}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.editFoot}>
              <Pressable
                onPress={async () => {
                  await AsyncStorage.setItem(KEY_ENABLED, "0");
                  setEnabled(false);
                  setEditOpen(false);
                  setOpen(false);
                }}
                style={styles.disableBtn}
              >
                <Text style={styles.disableTxt}>Disattiva linguetta</Text>
              </Pressable>
              <Pressable onPress={() => setEditOpen(false)} style={styles.doneBtn}>
                <Text style={styles.doneTxt}>Fatto</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Linguetta
  tab: {
    position: "absolute",
    width: 24,
    height: TAB_HEIGHT,
    zIndex: 300,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  tabInner: {
    width: 24, height: TAB_HEIGHT,
    alignItems: "flex-end", justifyContent: "center",
    paddingRight: 0,
  },
  tabBar: {
    width: TAB_WIDTH, height: TAB_HEIGHT,
    borderTopLeftRadius: 6, borderBottomLeftRadius: 6,
    backgroundColor: "rgba(251,191,36,0.85)",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: -1, height: 2 },
    elevation: 4,
  },
  // V50.z17 — Alone/pulse per farla notare ai nuovi utenti
  tabGlow: {
    position: "absolute",
    right: 0,
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
    borderRadius: 6,
    backgroundColor: "#FBBF24",
    shadowColor: "#FBBF24",
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: -4, height: 0 },
  },
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)", zIndex: 250,
  },
  panel: {
    position: "absolute", top: 0, right: 0,
    backgroundColor: "#0F2438",
    zIndex: 260,
    borderTopLeftRadius: 20, borderBottomLeftRadius: 20,
    paddingTop: Platform.OS === "ios" ? 54 : 24,
    borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12,
    shadowOffset: { width: -6, height: 0 }, elevation: 24,
  },
  panelHead: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  panelTitle: { color: "#FFF", fontSize: 15, fontWeight: "800", flex: 1 },
  grid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    padding: 10, justifyContent: "flex-start",
  },
  tile: {
    width: (PANEL_WIDTH - 30) / 2, alignItems: "center",
    paddingVertical: 10, gap: 6,
    borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  tileIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  tileTxt: {
    color: "#E2E8F0", fontSize: 11, fontWeight: "700",
    textAlign: "center", paddingHorizontal: 4,
  },
  empty: { padding: 20, alignItems: "center", gap: 8, width: "100%" },
  emptyTxt: { color: "#64748B", fontSize: 12, textAlign: "center" },
  panelFoot: {
    padding: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
  },
  editBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 10,
    backgroundColor: "rgba(251,191,36,0.15)",
    borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
  },
  editTxt: { color: "#FBBF24", fontSize: 13, fontWeight: "800" },
  // Edit modal
  editBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  editSheet: {
    backgroundColor: "#0F2438",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 14, paddingBottom: 24,
  },
  editHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  editTitle: { flex: 1, color: "#FFF", fontSize: 16, fontWeight: "800" },
  editSub: { color: "#94A3B8", fontSize: 12, marginBottom: 12 },
  editRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)",
  },
  editRowOn: { backgroundColor: "rgba(34,197,94,0.06)" },
  editRowIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  editRowLabel: { flex: 1, color: "#E2E8F0", fontSize: 14, fontWeight: "600" },
  editFoot: { flexDirection: "row", gap: 10, marginTop: 12 },
  disableBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(239,68,68,0.4)",
  },
  disableTxt: { color: "#EF4444", fontWeight: "700", fontSize: 13 },
  doneBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    backgroundColor: "#FBBF24",
  },
  doneTxt: { color: "#0F172A", fontWeight: "900", fontSize: 14 },
});

/**
 * V27 — CallScriptOverlay: opens when the agent taps "Script" on a contact card
 * or ritelefonata. Shows the phone number prominently + the Master-configured
 * script (with {name}/{agent} placeholders substituted). V28.f: supports MULTIPLE
 * named scripts (freddo/caldo/prospect) — user picks one via chip selector.
 *
 * V29.aa — Bottom sheet trascinabile:
 *  - Non è più un Modal (che bloccava lo scroll della pagina sottostante).
 *  - È un overlay inline `position: absolute` in fondo allo schermo.
 *  - L'utente può trascinare l'header verso il basso per ridurre il pannello
 *    a una barra minima (solo il titolo "Chiamata: Nome"), oppure verso l'alto
 *    per riespanderlo. I pulsanti `-` / `+` fanno lo stesso via tap.
 *  - Quando è ridotto a barra, la scheda cliente sottostante resta scrollabile
 *    perché il resto dello schermo non è coperto da nessun overlay.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, Platform, Animated, PanResponder, Dimensions } from "react-native";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const C = { primary: "#FF6B35", primarySoft: "#FFF1E9", navy: "#1B2B4B", muted: "#94A3B8", success: "#16A34A" };

type Props = {
  visible: boolean;
  onClose: () => void;
  contactName?: string;
  contactPhone?: string;
};

type NamedScript = { id: string; name: string; content: string; whatsapp_message?: string };

const HEADER_HEIGHT = 64; // altezza barra minima (solo titolo)

export function CallScriptOverlay({ visible, onClose, contactName, contactPhone }: Props) {
  const { user } = useAuth();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal // V29.ao — non finire sotto la gesture bar Android
  const [scripts, setScripts] = useState<NamedScript[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [waGlobal, setWaGlobal] = useState<string>("");
  const [fontSize, setFontSize] = useState(14);
  const [minimized, setMinimized] = useState(false);

  const screenH = Dimensions.get("window").height;
  const expandedH = Math.round(screenH * 0.45);
  const minH = HEADER_HEIGHT;

  const heightAnim = useRef(new Animated.Value(expandedH)).current;

  const animateTo = useCallback((target: number, done?: () => void) => {
    Animated.timing(heightAnim, {
      toValue: target,
      duration: 220,
      useNativeDriver: false,
    }).start(() => done?.());
  }, [heightAnim]);

  const minimize = useCallback(() => {
    setMinimized(true);
    animateTo(minH);
  }, [animateTo, minH]);

  const expand = useCallback(() => {
    setMinimized(false);
    animateTo(expandedH);
  }, [animateTo, expandedH]);

  useEffect(() => {
    if (visible) {
      setMinimized(false);
      heightAnim.setValue(expandedH);
    }
  }, [visible, expandedH, heightAnim]);

  // PanResponder sull'header per il drag
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => {
        const base = minimized ? minH : expandedH;
        const next = Math.max(minH, Math.min(expandedH, base - g.dy));
        heightAnim.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        // drag verso il basso → riduci; verso l'alto → espandi. Threshold ~40px.
        if (g.dy > 40) minimize();
        else if (g.dy < -40) expand();
        else {
          // ritorna allo stato corrente
          animateTo(minimized ? minH : expandedH);
        }
      },
    })
  ).current;

  const load = useCallback(async () => {
    try {
      const s = await api<{ call_script?: string; call_scripts?: NamedScript[]; wa_referral_template?: string }>("/settings");
      // V29.ao — Filtro rilassato: accetta script anche con content vuoto (l'utente
      // può averlo appena creato); mostreremo poi l'anteprima con placeholder.
      // Il vecchio filtro `x.content` scartava troppi script validi.
      const raw = Array.isArray(s.call_scripts) ? s.call_scripts.filter((x) => x && x.id) : [];
      const list = raw.map((x) => ({ id: x.id, name: x.name || "Script", content: x.content || "", whatsapp_message: x.whatsapp_message || "" }));
      // Fallback: legacy `call_script` singolo se non c'è nessuno script strutturato
      if (list.length === 0 && s.call_script) {
        list.push({ id: "_default", name: "Standard", content: s.call_script, whatsapp_message: "" });
      }
      setScripts(list);
      // V50.z69 — Fallback globale se lo script attivo non ha whatsapp_message
      setWaGlobal(s.wa_referral_template || "");
      // Assicura che activeId punti ad uno script esistente
      setActiveId((prev) => (list.some((x) => x.id === prev) ? prev : (list[0]?.id || "")));
    } catch { setScripts([]); }
  }, []); // V29.ao — NON dipende più da activeId (evitiamo loop di ricarica)

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const current = scripts.find((s) => s.id === activeId) || scripts[0];
  const firstName = (contactName || "").split(" ")[0] || "cliente";
  const agentName = user?.name?.split(" ")[0] || "";
  const rendered = (current?.content || "")
    .replace(/\{agent\}/g, agentName)
    .replace(/\{name\}/g, firstName);
  // V50.z69 — Messaggio WhatsApp per lo script attivo (fallback a wa_referral_template globale)
  const waRaw = (current?.whatsapp_message || "").trim() || waGlobal;
  const renderedWa = waRaw
    .replace(/\{agent\}/g, agentName)
    .replace(/\{name\}/g, firstName);

  const dial = () => {
    const num = (contactPhone || "").replace(/[^\d+]/g, "");
    if (!num) return;
    const url = `tel:${num}`;
    if (Platform.OS === "web") { try { window.location.href = url; } catch { /* ignore */ } }
    else Linking.openURL(url).catch(() => {});
  };

  // V29.ao — RIMOSSA `openPhoneApp` (era duplicato del banner grande "Tocca per
  // chiamare"). Ora l'unico entry-point per chiamare è il banner verde `dial`.

  // V29.af — Azione "Mess.WhatsApp": apre il link `wa.me/<numero>` (mobile e web).
  // V50.z69 — Se lo script attivo ha un `whatsapp_message` (o fallback globale), lo precompila.
  const openWhatsApp = () => {
    const raw = (contactPhone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (!raw) return;
    const url = renderedWa
      ? `https://wa.me/${raw}?text=${encodeURIComponent(renderedWa)}`
      : `https://wa.me/${raw}`;
    if (Platform.OS === "web") { try { window.open(url, "_blank"); } catch { /* ignore */ } }
    else Linking.openURL(url).catch(() => {});
  };

  const copyWaMessage = async () => {
    if (!renderedWa) return;
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(renderedWa);
      } else {
        const Clipboard = await import("expo-clipboard");
        await Clipboard.setStringAsync(renderedWa);
      }
    } catch { /* ignore */ }
  };

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheet, { height: heightAnim }]} testID="call-script-overlay" pointerEvents="box-none">
      <View style={styles.card}>
        {/* Header trascinabile */}
        <View style={styles.hdr} {...panResponder.panHandlers}>
          <View style={styles.grabber} />
          <View style={styles.hdrRow}>
            {/* V29.aq — Header minimale: rimossi icona documento, titolo "Chiamata: X"
                e sottotitolo "Leggi lo script..." su richiesta utente. Restano
                SOLO i controlli Aa/+/- e la X di chiusura. */}
            <View style={{ flex: 1 }} />
            {!minimized && (
              <>
                <Pressable onPress={() => setFontSize((s) => Math.max(12, s - 2))} hitSlop={8} style={styles.zoomBtn} testID="call-script-font-smaller">
                  <Ionicons name="text" size={12} color={C.navy} />
                </Pressable>
                <Pressable onPress={() => setFontSize((s) => Math.min(26, s + 2))} hitSlop={8} style={styles.zoomBtn} testID="call-script-font-bigger">
                  <Ionicons name="text" size={16} color={C.navy} />
                </Pressable>
              </>
            )}
            <Pressable
              onPress={minimized ? expand : minimize}
              hitSlop={8}
              style={styles.zoomBtn}
              testID={minimized ? "call-script-expand" : "call-script-minimize"}
              accessibilityLabel={minimized ? "Espandi pannello" : "Riduci a barra"}
            >
              <Ionicons name={minimized ? "add" : "remove"} size={18} color={C.navy} />
            </Pressable>
            <Pressable onPress={onClose} hitSlop={8} testID="call-script-overlay-close">
              <Ionicons name="close" size={22} color={C.navy} />
            </Pressable>
          </View>
        </View>

        {/* Contenuto: nascosto quando minimizzato */}
        {!minimized && (
          <>
            {scripts.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
                {scripts.map((s) => {
                  const on = s.id === (current?.id || activeId);
                  return (
                    <Pressable
                      key={s.id}
                      testID={`script-chip-${s.id}`}
                      onPress={() => setActiveId(s.id)}
                      style={[styles.chip, on && { backgroundColor: C.primary, borderColor: C.primary }]}
                    >
                      <Ionicons name={on ? "checkmark-circle" : "document-outline"} size={13} color={on ? "#FFF" : C.primary} />
                      <Text style={[styles.chipTxt, on && { color: "#FFF" }]}>{s.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {/* V29.ap — RIMOSSA la barra "Chiamata + pulsante chiama" (richiesta
                utente): quando lo script è aperto restano SOLO i controlli in
                cima (Aa, +/-, X) e il testo scrollabile sotto. Il numero e i
                pulsanti chiamata vivono già nel profilo contatto. */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 40 + (insets.bottom || 0) }}>
              {rendered ? (
                <Text style={[styles.scriptTxt, { fontSize, lineHeight: fontSize * 1.55 }]} testID="call-script-overlay-text">{rendered}</Text>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="information-circle-outline" size={30} color={C.muted} />
                  <Text style={styles.emptyTxt}>Nessuno script configurato</Text>
                  <Text style={styles.emptySub}>Il Master può inserirlo dalle Impostazioni → &quot;Script Telefonata&quot;</Text>
                </View>
              )}

              {/* V50.z69 — Card WhatsApp associata (opzionale, per-script o globale) */}
              {renderedWa ? (
                <View style={styles.waCard} testID="call-script-wa-card">
                  <View style={styles.waHeader}>
                    <Ionicons name="logo-whatsapp" size={16} color="#16A34A" />
                    <Text style={styles.waHeaderTxt}>Messaggio WhatsApp</Text>
                    {current?.whatsapp_message ? (
                      <View style={styles.waBadge}>
                        <Text style={styles.waBadgeTxt}>per questo script</Text>
                      </View>
                    ) : (
                      <View style={[styles.waBadge, { backgroundColor: "#DBEAFE" }]}>
                        <Text style={[styles.waBadgeTxt, { color: "#1E40AF" }]}>predefinito</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.waTxt, { fontSize: Math.max(12, fontSize - 2) }]} testID="call-script-wa-text">{renderedWa}</Text>
                  <View style={styles.waActionRow}>
                    <Pressable onPress={copyWaMessage} style={styles.waCopyBtn} testID="call-script-wa-copy">
                      <Ionicons name="copy-outline" size={14} color="#166534" />
                      <Text style={styles.waCopyBtnTxt}>Copia</Text>
                    </Pressable>
                    {(contactPhone || "").trim() ? (
                      <Pressable onPress={openWhatsApp} style={styles.waSendBtn} testID="call-script-wa-send">
                        <Ionicons name="send" size={14} color="#FFF" />
                        <Text style={styles.waSendBtnTxt}>Invia su WhatsApp</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    elevation: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
  },
  card: {
    flex: 1,
    backgroundColor: "#FFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
    borderTopWidth: 1,
    borderTopColor: "#EEF0F4",
  },
  hdr: { paddingTop: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#EEF0F4", backgroundColor: "#FFF" },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 6 },
  hdrRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  hdrIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: C.navy, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  zoomBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  chipsScroll: { paddingHorizontal: 14, paddingTop: 10 },
  chipsRow: { gap: 8, paddingRight: 20 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: C.primary },
  chipTxt: { fontSize: 12, fontWeight: "800", color: C.primary },
  // V29.ao — Riga chiamata compatta: banner verde grande + bottone WhatsApp
  callRow: { flexDirection: "row", alignItems: "stretch", gap: 8, paddingHorizontal: 14, marginTop: 8 },
  whatsBtn: {
    width: 54,
    borderRadius: 12,
    backgroundColor: "#25D366",
    alignItems: "center",
    justifyContent: "center",
  },
  phoneCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#DCFCE7", padding: 12, borderRadius: 12 },
  phoneIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.success, alignItems: "center", justifyContent: "center" },
  phoneLbl: { fontSize: 11, fontWeight: "700", color: "#166534", textTransform: "uppercase", letterSpacing: 0.5 },
  phoneNum: { fontSize: 22, fontWeight: "900", color: C.navy, letterSpacing: -0.5, marginTop: 2 },
  scriptTxt: { color: C.navy, fontWeight: "500" },
  waCard: { marginTop: 18, padding: 12, backgroundColor: "#F0FDF4", borderRadius: 12, borderWidth: 1, borderColor: "#86EFAC", gap: 8 },
  waHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  waHeaderTxt: { flex: 1, fontSize: 12, fontWeight: "800", color: "#166534", textTransform: "uppercase", letterSpacing: 0.5 },
  waBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "#DCFCE7" },
  waBadgeTxt: { fontSize: 9, fontWeight: "800", color: "#166534" },
  waTxt: { color: C.navy, fontWeight: "500", lineHeight: 20 },
  waActionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  waCopyBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: "#DCFCE7", borderWidth: 1, borderColor: "#86EFAC" },
  waCopyBtnTxt: { fontSize: 12, fontWeight: "700", color: "#166534" },
  waSendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 8, backgroundColor: "#16A34A" },
  waSendBtnTxt: { fontSize: 13, fontWeight: "800", color: "#FFF" },
  empty: { alignItems: "center", padding: 30, gap: 8 },
  emptyTxt: { color: C.navy, fontWeight: "800", fontSize: 14 },
  emptySub: { color: C.muted, fontSize: 12, textAlign: "center" },
});

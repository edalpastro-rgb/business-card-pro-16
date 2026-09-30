// V50.z338/z339 — Switcher tema (Impostazioni profilo → «Aspetto»): 4 card preview affiancate (Luce · Pearl · Slate · Midnight), nome sotto, spunta sull'attivo.
// Il cambio salva la preferenza (locale per-utente + backend users.ui_theme) e ricarica l'app per applicare la palette.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { setPostReloadRoute } from "@/src/RoutePersistence";
import { useResponsive } from "@/src/hooks/useResponsive"; // V50.z409 — desktop: card compatte affiancate all'anteprima
import { ACTIVE_THEME_ID, BOOT_THEME_FROM_STORAGE, PALETTES, THEME_IDS, ThemeId, getUserTheme, normalizeThemeId, persistTheme, readThemeFallback, reloadApp, safeThemeReload } from "@/src/themes";

/** Sincronizza il tema salvato sul server per l'utente loggato: se differisce da quello attivo → salva in locale e ricarica (una volta). */
export function useThemeSync(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      // V50.z344 — Il PROFILO UTENTE sul database è la fonte di verità: ad ogni avvio si legge il tema salvato e, se
      // diverso da quello con cui l'app è partita, si applica subito (ricarica bundle). Offline → locale/AsyncStorage.
      let target: ThemeId | null = null;
      try {
        const r = await api<{ ui_theme: string }>("/me/theme");
        target = normalizeThemeId(r.ui_theme);
      } catch {
        target = getUserTheme(userId) || (BOOT_THEME_FROM_STORAGE ? null : await readThemeFallback());
      }
      if (cancelled || !target) return;
      if (target !== ACTIVE_THEME_ID) {
        await persistTheme(target, userId);
        // V50.z350 — riavvio automatico SOLO con guard anti-loop (vedi safeThemeReload): se il tema non è rileggibile
        // o è già stato tentato un riavvio, l'app resta sul tema corrente e continua a funzionare.
        if (!cancelled) await safeThemeReload(target);
      } else if (getUserTheme(userId) !== target) {
        await persistTheme(target, userId);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
}

export function ThemePicker() {
  const { user } = useAuth();
  const [busy, setBusy] = useState<ThemeId | null>(null);
  // V50.z340 — Anteprima live: il tap sulla card mostra subito una mini-Home nella palette scelta; «Applica» salva e ricarica
  const [selected, setSelected] = useState<ThemeId>(ACTIVE_THEME_ID);
  const sel = PALETTES[selected];
  const dirty = selected !== ACTIVE_THEME_ID;
  const { isWide } = useResponsive(); // V50.z409 — ≥768 px: card tema compatte (max 110 px) + anteprima live a fianco

  const choose = async (id: ThemeId) => {
    if (id === ACTIVE_THEME_ID || busy) return;
    setBusy(id);
    try {
      // V50.z344 — 1) salva sul profilo utente (database) 2) salva in locale 3) applica subito ricaricando il bundle
      try { await api("/me/theme", { method: "PUT", body: { ui_theme: id } }); } catch { /* offline: la copia locale verrà riallineata al prossimo avvio online */ }
      await persistTheme(id, user?.user_id);
      await setPostReloadRoute("/(tabs)/impostazioni"); // V50.z410 — dopo il reload si resta su Profilo
      const ok = await reloadApp();
      if (!ok) notify("Tema salvato", "Chiudi e riapri l'app per applicare il nuovo tema.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.card} testID="theme-picker">
      <View style={styles.head}>
        <View style={styles.iconBox}><Ionicons name="color-palette" size={18} color={HT.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Aspetto</Text>
          <Text style={styles.sub}>Scegli il tema dell'app. La preferenza è salvata sul tuo profilo.</Text>
        </View>
      </View>
      <View style={isWide ? styles.wideBody : undefined}>
      <View style={[styles.row, isWide && styles.rowWide]}>
        {THEME_IDS.map((id) => {
          const p = PALETTES[id];
          const active = id === ACTIVE_THEME_ID;
          return (
            <Pressable key={id} onPress={() => setSelected(id)} style={isWide ? styles.itemWide : styles.item} testID={`theme-option-${id}`} accessibilityLabel={`Tema ${p.name}`} accessibilityState={{ selected: active }}>
              <View style={[styles.preview, { backgroundColor: p.bg, borderColor: active ? HT.brand : selected === id ? p.accent : HT.borderStrong, borderWidth: active || selected === id ? 2 : 1 }]}>
                <View style={[styles.pvBar, { backgroundColor: p.card, borderBottomColor: p.border }, p.shadow && styles.pvShadow]}>
                  <View style={[styles.pvDot, { backgroundColor: p.accent }]} />
                  <View style={[styles.pvLine, { backgroundColor: p.text2, width: 18 }]} />
                </View>
                <View style={[styles.pvCard, { backgroundColor: p.card, borderColor: p.border, borderRadius: p.radius / 2 }, p.shadow && styles.pvShadow]}>
                  <View style={[styles.pvLine, { backgroundColor: p.text, width: "70%" }]} />
                  <View style={[styles.pvLine, { backgroundColor: p.muted, width: "45%" }]} />
                </View>
                <View style={[styles.pvCard, { backgroundColor: p.card, borderColor: p.border, borderRadius: p.radius / 2 }, p.shadow && styles.pvShadow]}>
                  <View style={[styles.pvLine, { backgroundColor: p.accent, width: "55%" }]} />
                </View>
                <View style={[styles.pvNav, { backgroundColor: p.nav, borderTopColor: p.border }]}>
                  <View style={[styles.pvNavDot, { backgroundColor: p.navActive }]} />
                  <View style={[styles.pvNavDot, { backgroundColor: p.navInactive }]} />
                  <View style={[styles.pvNavDot, { backgroundColor: p.navInactive }]} />
                </View>
                {busy === id ? <View style={styles.busy}><ActivityIndicator color={p.accent} /></View> : null}
                {active ? (
                  <View style={[styles.check, { backgroundColor: HT.brand }]} testID={`theme-active-${id}`}>
                    <Ionicons name="checkmark" size={12} color="#FFF" />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.name, active && { color: HT.brand }]}>{p.name}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Anteprima live nella palette selezionata */}
      <View style={[styles.live, isWide && styles.liveWide, { backgroundColor: sel.bg, borderColor: sel.border }]} testID={`theme-live-preview-${selected}`}>
        <View style={[styles.liveBar, { backgroundColor: sel.card, borderBottomColor: sel.border }]}>
          <View style={[styles.liveIcon, { backgroundColor: sel.glassStrong }]} />
          <Text style={[styles.liveBrand, { color: sel.text }]}>Advisor<Text style={{ color: sel.accent }}>OS</Text></Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.liveClock, { color: sel.text2 }]}>14:32</Text>
          <View style={[styles.liveAvatar, { backgroundColor: sel.accent }]} />
        </View>
        <View style={styles.liveRow}>
          {[["12", "Contatti"], ["3", "Oggi"]].map(([v, l]) => (
            <View key={l} style={[styles.liveKpi, { backgroundColor: sel.card, borderColor: sel.border, borderRadius: sel.radius - 4 }, sel.shadow && styles.pvShadow]}>
              <Text style={[styles.liveKpiVal, { color: sel.text }]}>{v}</Text>
              <Text style={[styles.liveKpiLbl, { color: sel.muted }]}>{l}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.liveCard, { backgroundColor: sel.card, borderColor: sel.border, borderRadius: sel.radius - 4 }, sel.shadow && styles.pvShadow]}>
          <Text style={[styles.liveCardTitle, { color: sel.text }]}>Ritelefonate di oggi</Text>
          <View style={[styles.liveTrack, { backgroundColor: sel.glassStrong }]}><View style={[styles.liveFill, { backgroundColor: sel.accent }]} /></View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={[styles.liveBtn, { backgroundColor: sel.accent }]}><Text style={styles.liveBtnTxt}>+ Telefonata</Text></View>
            <View style={[styles.liveBtn, { borderWidth: 1, borderColor: sel.borderStrong }]}><Text style={[styles.liveBtnTxt, { color: sel.text2 }]}>Dettagli</Text></View>
          </View>
        </View>
        <View style={[styles.liveNav, { backgroundColor: sel.nav, borderTopColor: sel.border }]}>
          {[0, 1, 2, 3, 4].map((i) => <View key={i} style={[styles.liveNavDot, { backgroundColor: i === 0 ? sel.navActive : sel.navInactive }]} />)}
        </View>
      </View>
      </View>

      {dirty ? (
        <Pressable onPress={() => choose(selected)} disabled={!!busy} style={[styles.applyBtn, { backgroundColor: sel.accent }, busy && { opacity: 0.6 }]} testID="theme-apply">
          {busy ? <ActivityIndicator color="#FFF" /> : <Ionicons name="checkmark-circle" size={18} color="#FFF" />}
          <Text style={styles.applyTxt}>Applica tema {sel.name}</Text>
        </Pressable>
      ) : (
        <Text style={styles.applyHint}>Tocca una card per vedere l'anteprima, poi «Applica».</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: HT.radius, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 12, ...HT.cardShadow },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  row: { flexDirection: "row", gap: 8 },
  rowWide: { flexWrap: "wrap", alignContent: "flex-start", flex: 1, gap: 10 },
  wideBody: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  item: { flex: 1, alignItems: "center", gap: 6, minWidth: 0 },
  itemWide: { width: 104, alignItems: "center", gap: 6 },
  liveWide: { width: 300, flexShrink: 0 },
  preview: { width: "100%", aspectRatio: 0.72, borderRadius: 12, overflow: "hidden", padding: 5, gap: 4, position: "relative" },
  pvShadow: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  pvBar: { height: 12, borderRadius: 4, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4 },
  pvDot: { width: 6, height: 6, borderRadius: 3 },
  pvLine: { height: 3, borderRadius: 2 },
  pvCard: { borderWidth: 1, padding: 4, gap: 3 },
  pvNav: { marginTop: "auto", height: 14, borderTopWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-around", borderRadius: 4 },
  pvNavDot: { width: 6, height: 6, borderRadius: 3 },
  busy: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  check: { position: "absolute", top: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 11.5, fontWeight: "800", color: HT.text2 },
  // anteprima live
  live: { borderRadius: 14, borderWidth: 1, overflow: "hidden", padding: 10, gap: 8 },
  liveBar: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 10, borderBottomWidth: 1 },
  liveIcon: { width: 16, height: 16, borderRadius: 5 },
  liveBrand: { fontSize: 12, fontWeight: "900", letterSpacing: -0.3 },
  liveClock: { fontSize: 10, fontWeight: "700" },
  liveAvatar: { width: 16, height: 16, borderRadius: 8 },
  liveRow: { flexDirection: "row", gap: 8 },
  liveKpi: { flex: 1, borderWidth: 1, padding: 10 },
  liveKpiVal: { fontSize: 18, fontWeight: "900", letterSpacing: -0.5 },
  liveKpiLbl: { fontSize: 10, fontWeight: "700", marginTop: 1 },
  liveCard: { borderWidth: 1, padding: 10, gap: 8 },
  liveCardTitle: { fontSize: 12, fontWeight: "800" },
  liveTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  liveFill: { width: "62%", height: 6, borderRadius: 3 },
  liveBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  liveBtnTxt: { fontSize: 10.5, fontWeight: "800", color: "#FFF" },
  liveNav: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", height: 26, borderTopWidth: 1, borderRadius: 8 },
  liveNavDot: { width: 10, height: 10, borderRadius: 5 },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, minHeight: 46 },
  applyTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  applyHint: { fontSize: 11.5, color: HT.muted, textAlign: "center" },
});

// V50.z338/z339 — Switcher tema (Impostazioni profilo → «Aspetto»): 4 card preview affiancate (Luce · Pearl · Slate · Midnight), nome sotto, spunta sull'attivo.
// Il cambio salva la preferenza (locale per-utente + backend users.ui_theme) e ricarica l'app per applicare la palette.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { ACTIVE_THEME_ID, PALETTES, THEME_IDS, ThemeId, getUserTheme, normalizeThemeId, persistTheme, reloadApp } from "@/src/themes";

/** Sincronizza il tema salvato sul server per l'utente loggato: se differisce da quello attivo → salva in locale e ricarica (una volta). */
export function useThemeSync(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const local = getUserTheme(userId);
        if (local && local !== ACTIVE_THEME_ID) {
          // cambio utente sullo stesso device: applica il tema di QUESTO utente
          await persistTheme(local, userId);
          if (!cancelled) await reloadApp();
          return;
        }
        const r = await api<{ ui_theme: string }>("/me/theme");
        const server = normalizeThemeId(r.ui_theme);
        if (cancelled || !server) return;
        if (server !== ACTIVE_THEME_ID && !local) {
          await persistTheme(server, userId);
          await reloadApp();
        } else if (!local) {
          await persistTheme(ACTIVE_THEME_ID, userId);
        }
      } catch { /* offline: resta il tema locale */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
}

export function ThemePicker() {
  const { user } = useAuth();
  const [busy, setBusy] = useState<ThemeId | null>(null);

  const choose = async (id: ThemeId) => {
    if (id === ACTIVE_THEME_ID || busy) return;
    setBusy(id);
    try {
      await persistTheme(id, user?.user_id);
      try { await api("/me/theme", { method: "PUT", body: { ui_theme: id } }); } catch { /* offline: verrà sincronizzato al prossimo salvataggio */ }
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
      <View style={styles.row}>
        {THEME_IDS.map((id) => {
          const p = PALETTES[id];
          const active = id === ACTIVE_THEME_ID;
          return (
            <Pressable key={id} onPress={() => choose(id)} style={styles.item} testID={`theme-option-${id}`} accessibilityLabel={`Tema ${p.name}`} accessibilityState={{ selected: active }}>
              <View style={[styles.preview, { backgroundColor: p.bg, borderColor: active ? HT.brand : HT.borderStrong, borderWidth: active ? 2 : 1 }]}>
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
  item: { flex: 1, alignItems: "center", gap: 6, minWidth: 0 },
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
});

// SettingsHub.tsx — V50.z249 — Profilo & Impostazioni ristrutturato: card Profilo Master in cima + bottoni raggruppati
// che aprono sezioni dedicate (stessa schermata `impostazioni` con `?section=`). Le sezioni AxonOS non compaiono qui:
// sono raggiungibili da AxonOS Center → «Assistente & Header tabella» (`/impostazioni?section=axon`).
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { theme } from "@/src/theme";

export type SettingsSection = "security" | "billing" | "branding" | "integrations" | "general" | "axon";

export const SECTION_META: Record<SettingsSection, { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; sub: string }> = {
  security: { title: "Sicurezza", icon: "shield-checkmark", color: "#DC2626", sub: "PIN, biometria, cambio password, 2FA" },
  billing: { title: "Abbonamento e Pagamenti", icon: "card", color: "#0EA5E9", sub: "Piano attivo, versione app, configurazione guidata" },
  branding: { title: "Personalizzazione Aziendale", icon: "business", color: "#B45309", sub: "Logo, P.IVA, firma documenti, sede, email" },
  integrations: { title: "Integrazioni", icon: "git-network", color: "#16A34A", sub: "SMTP, Google Drive, Dropbox, Outlook, API" },
  general: { title: "Preferenze Generali", icon: "options", color: "#475569", sub: "Lingua, tema, Home, aree CRM, categorie" },
  axon: { title: "AxonOS · Assistente & Header tabella", icon: "sparkles", color: "#7C3AED", sub: "Nome, voce, tono, header tabelle, memoria" },
};

type LinkRow = { label: string; sub?: string; icon: keyof typeof Ionicons.glyphMap; href?: string; onPress?: () => void; testID: string };

export function SettingsGroupButton({ section, onPress }: { section: SettingsSection; onPress: () => void }) {
  const m = SECTION_META[section];
  return (
    <Pressable onPress={onPress} style={styles.group} testID={`settings-group-${section}`} accessibilityRole="button">
      <View style={[styles.groupIcon, { backgroundColor: m.color + "1A" }]}><Ionicons name={m.icon} size={22} color={m.color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.groupTitle}>{m.title}</Text>
        <Text style={styles.groupSub} numberOfLines={2}>{m.sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
    </Pressable>
  );
}

export function SettingsLinkRows({ rows }: { rows: LinkRow[] }) {
  const router = useRouter();
  return (
    <View style={styles.card}>
      {rows.map((r, i) => (
        <Pressable key={r.testID} onPress={() => (r.onPress ? r.onPress() : router.push(r.href as any))} style={[styles.row, i > 0 && styles.rowBorder]} testID={r.testID}>
          <Ionicons name={r.icon} size={20} color={theme.color.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{r.label}</Text>
            {r.sub ? <Text style={styles.rowSub}>{r.sub}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
        </Pressable>
      ))}
    </View>
  );
}

/** Cambio password (POST /auth/change-password): password attuale + nuova (min 8) + conferma. */
export function ChangePasswordCard() {
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [cf, setCf] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (nw.length < 8) { notify("Password troppo corta", "Minimo 8 caratteri."); return; }
    if (nw !== cf) { notify("Le password non coincidono", "Ricontrolla la conferma."); return; }
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { current_password: cur, new_password: nw, new_password_confirm: cf } });
      setCur(""); setNw(""); setCf("");
      notify("Password aggiornata", "La nuova password è attiva. Le sessioni aperte restano valide.");
    } catch (e: any) { notify("Cambio password non riuscito", e?.message || "Password attuale non corretta"); }
    finally { setBusy(false); }
  };
  return (
    <View style={styles.card} testID="change-password-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Ionicons name="key" size={18} color="#DC2626" /><Text style={styles.cardTitle}>Cambio password</Text>
      </View>
      {[["Password attuale", cur, setCur, "chpwd-current"], ["Nuova password (min 8)", nw, setNw, "chpwd-new"], ["Conferma nuova password", cf, setCf, "chpwd-confirm"]].map(([ph, v, set, tid]) => (
        <TextInput key={tid as string} value={v as string} onChangeText={set as any} placeholder={ph as string} placeholderTextColor="#94A3B8" secureTextEntry autoCapitalize="none" style={styles.input} testID={tid as string} />
      ))}
      <Pressable onPress={submit} disabled={busy || !cur || !nw || !cf} style={[styles.btn, (busy || !cur || !nw || !cf) && { opacity: 0.5 }]} testID="chpwd-submit">
        {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="checkmark" size={16} color="#FFF" />}
        <Text style={styles.btnTxt}>Aggiorna password</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.color.surface, borderRadius: 16, padding: 14, minHeight: 64, borderWidth: 1, borderColor: theme.color.border },
  groupIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  groupSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  card: { backgroundColor: theme.color.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.color.border },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 8 },
  rowBorder: { borderTopWidth: 1, borderTopColor: theme.color.border },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowSub: { fontSize: 12, color: theme.color.muted, marginTop: 1 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 14, color: theme.color.onSurface, marginTop: 8, backgroundColor: "#FFF" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#DC2626", borderRadius: 10, minHeight: 44, marginTop: 12 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

// V50.z434 — Pannello Master: Email di benvenuto (inviata dopo l'attivazione dell'account).
// Oggetto e testo con segnaposto, codice promo (tra quelli del Master), link privacy/app, on/off, invio di prova.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Switch } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)

type Cfg = {
  enabled: boolean; subject: string; body: string; promo_code: string; privacy_url: string; app_url: string;
  placeholders: string[]; promo_codes: { code: string; description?: string; benefit_type?: string }[]; sent_7d: number;
};

export default function WelcomeEmailScreen() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try { setCfg(await api<Cfg>("/admin/welcome-email")); } catch (e: any) { notify("Errore", e?.message || "Impossibile caricare"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api("/admin/welcome-email", { method: "PUT", body: { enabled: cfg.enabled, subject: cfg.subject, body: cfg.body, promo_code: cfg.promo_code, privacy_url: cfg.privacy_url, app_url: cfg.app_url } });
      notify("Salvato", "Email di benvenuto aggiornata.");
      await load();
    } catch (e: any) { notify("Errore", e?.message || "Salvataggio non riuscito"); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!cfg) return;
    setTesting(true);
    try {
      await save();
      const r = await api<{ ok: boolean; to: string }>("/admin/welcome-email/test", { method: "POST" });
      notify("Email di prova inviata", `Controlla la casella ${r.to}.`);
    } catch (e: any) { notify("Errore", e?.message || "Invio non riuscito"); }
    finally { setTesting(false); }
  };

  const preview = (txt: string) => (cfg ? txt.replace("{nome}", "Mario").replace("{cognome}", "Rossi").replace("{email}", "mario@esempio.it").replace("{codice_promo}", cfg.promo_code || "—").replace("{link_privacy}", cfg.privacy_url).replace("{link_app}", cfg.app_url) : txt);

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="welcome-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Email di benvenuto</Text>
          <Text style={s.hSub}>{cfg ? `Inviata dopo l'attivazione · ${cfg.sent_7d} negli ultimi 7 giorni` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={save} style={s.addBtn} disabled={saving || !cfg} testID="welcome-save">
          {saving ? <ActivityIndicator color={C.onSurfaceInverse} /> : <><Ionicons name="save-outline" size={18} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Salva</Text></>}
        </Pressable>
      </View>
      {!cfg ? <ActivityIndicator style={{ marginTop: 40 }} color={VIOLET} /> : (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
            <View style={s.card}>
              <View style={s.rowBetween}><Text style={s.cardTitle}>Invia email di benvenuto</Text><Switch value={cfg.enabled} onValueChange={(v) => setCfg({ ...cfg, enabled: v })} trackColor={{ true: VIOLET }} testID="welcome-enabled" /></View>
              <Text style={s.lbl}>Oggetto</Text>
              <TextInput value={cfg.subject} onChangeText={(v) => setCfg({ ...cfg, subject: v })} style={s.input} placeholderTextColor={C.muted} testID="welcome-subject" />
              <Text style={s.lbl}>Testo (le righe vuote separano i paragrafi)</Text>
              <TextInput value={cfg.body} onChangeText={(v) => setCfg({ ...cfg, body: v })} style={[s.input, s.multi]} multiline textAlignVertical="top" placeholderTextColor={C.muted} testID="welcome-body" />
              <View style={s.chips}>
                {cfg.placeholders.map((p) => (
                  <Pressable key={p} onPress={() => setCfg({ ...cfg, body: `${cfg.body}${cfg.body.endsWith("\n") || !cfg.body ? "" : " "}${p}` })} style={s.chip} testID={`welcome-ph-${p.replace(/[{}]/g, "")}`}>
                    <Text style={s.chipTxt}>{p}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.hint}>Tocca un segnaposto per aggiungerlo in fondo al testo. {"{codice_promo}"}: se nessun codice è scelto, le righe che lo contengono vengono omesse.</Text>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Codice promozionale da includere</Text>
              <View style={s.chips}>
                <Pressable onPress={() => setCfg({ ...cfg, promo_code: "" })} style={[s.chip, !cfg.promo_code && s.chipOn]} testID="welcome-promo-none"><Text style={[s.chipTxt, !cfg.promo_code && s.chipTxtOn]}>Nessuno</Text></Pressable>
                {cfg.promo_codes.map((p) => (
                  <Pressable key={p.code} onPress={() => setCfg({ ...cfg, promo_code: p.code })} style={[s.chip, cfg.promo_code === p.code && s.chipOn]} testID={`welcome-promo-${p.code}`}>
                    <Text style={[s.chipTxt, cfg.promo_code === p.code && s.chipTxtOn]}>{p.code}</Text>
                  </Pressable>
                ))}
              </View>
              {cfg.promo_codes.length === 0 && <Text style={s.hint}>Nessun codice attivo: creane uno in «Codici Promozionali».</Text>}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Link</Text>
              <Text style={s.lbl}>Informativa privacy {"{link_privacy}"}</Text>
              <TextInput value={cfg.privacy_url} onChangeText={(v) => setCfg({ ...cfg, privacy_url: v })} style={s.input} autoCapitalize="none" keyboardType="url" testID="welcome-privacy" />
              <Text style={s.lbl}>Apri l&apos;app {"{link_app}"}</Text>
              <TextInput value={cfg.app_url} onChangeText={(v) => setCfg({ ...cfg, app_url: v })} style={s.input} autoCapitalize="none" keyboardType="url" testID="welcome-app" />
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Anteprima</Text>
              <Text style={s.prevSubject}>{preview(cfg.subject)}</Text>
              <Text style={s.prevBody}>{preview(cfg.body).split("\n").filter((l) => cfg.promo_code || !l.includes("—")).join("\n")}</Text>
              <Pressable onPress={sendTest} style={s.testBtn} disabled={testing} testID="welcome-test">
                {testing ? <ActivityIndicator color={VIOLET} /> : <><Ionicons name="paper-plane-outline" size={18} color={VIOLET} /><Text style={s.testTxt}>Inviami un&apos;email di prova</Text></>}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: VIOLET, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  hint: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  lbl: { fontSize: 12, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: C.divider, borderRadius: 12, paddingHorizontal: 12, color: C.onSurface, backgroundColor: C.surface, fontSize: 15 },
  multi: { minHeight: 220, paddingVertical: 10, lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: VIOLET, backgroundColor: C.surface },
  chipOn: { backgroundColor: VIOLET },
  chipTxt: { color: VIOLET, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: C.onSurfaceInverse },
  prevSubject: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  prevBody: { fontSize: 13.5, color: C.onSurface, lineHeight: 20 },
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: VIOLET, marginTop: 6 },
  testTxt: { color: VIOLET, fontWeight: "800" },
});

// V50.z436 — Impostazioni ridotte per il ruolo CONSULENTE: solo (1) nome con cui Axon si rivolge all'utente, (2) voce di Axon,
// (3) ascolto costante «Axon» on/off (se il Master ha attivato il modulo). Nessuna impostazione TTS avanzata, nessuna area di
// amministrazione/configurazione. Salvataggio in /user-settings (il backend filtra comunque le chiavi per il consultant).
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Switch, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { useViolaWakeOptional } from "@/src/violawake/ViolaWakeProvider";
import { AXON_VOICES } from "@/app/axon-voice";

export function ConsultantSettings() {
  const { user, logout } = useAuth();
  const pagePad = usePageBottomPadding();
  const viola = useViolaWakeOptional();
  const [axonName, setAxonName] = useState("");
  const [voice, setVoice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api<{ assistant_name?: string; assistant_voice?: string }>("/user-settings")
      .then((s) => { setAxonName(s?.assistant_name || ""); setVoice(s?.assistant_voice || ""); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (patch: Record<string, string>, key: string) => {
    setSaving(key);
    try { await api("/user-settings", { method: "PUT", body: patch }); }
    catch (e: any) { notify("Impostazioni", e?.message || "Salvataggio non riuscito"); }
    finally { setSaving(null); }
  };

  const moduleOn = !!viola?.module?.enabled;
  const listenOn = !!viola?.settings?.enabled;
  const toggleListen = async (on: boolean) => {
    if (!viola) return;
    setSaving("listen");
    try {
      if (on && viola.supported) {
        const ok = await viola.askPermission();
        if (!ok) notify("Microfono", "Serve il microfono per l'ascolto costante.");
      }
      await viola.updateSettings({ enabled: on });
    } catch (e: any) { notify("Ascolto costante", e?.message || "Operazione non riuscita"); }
    finally { setSaving(null); }
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="consultant-settings">
      <View style={s.header}>
        <Text style={s.title}>Impostazioni</Text>
        <Text style={s.sub}>{user?.name} · <Text style={s.badge}>Consulente</Text></Text>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} /> : (
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: pagePad + 24 }]} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Text style={s.cardTitle}>Come ti chiama Axon</Text>
            <Text style={s.hint}>Il nome con cui l&apos;assistente si rivolge a te nelle risposte.</Text>
            <View style={s.row}>
              <TextInput value={axonName} onChangeText={setAxonName} placeholder={user?.name?.split(" ")[0] || "Il tuo nome"} placeholderTextColor={HT.muted} style={s.input} testID="consultant-axon-name" autoCapitalize="words" />
              <Pressable onPress={() => save({ assistant_name: axonName.trim() }, "name")} style={s.saveBtn} disabled={saving === "name"} testID="consultant-axon-name-save">
                {saving === "name" ? <ActivityIndicator color={HT.white} /> : <Text style={s.saveTxt}>Salva</Text>}
              </Pressable>
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Voce di Axon</Text>
            <View style={s.chips}>
              {AXON_VOICES.map((v) => {
                const on = voice === v.key;
                return (
                  <Pressable key={v.key} onPress={() => { setVoice(v.key); void save({ assistant_voice: v.key }, "voice"); }} style={[s.chip, on && s.chipOn]} testID={`consultant-voice-${v.key}`}>
                    <Ionicons name={v.gender === "F" ? "woman-outline" : v.gender === "M" ? "man-outline" : "sparkles-outline"} size={14} color={on ? HT.white : HT.brand} />
                    <Text style={[s.chipTxt, on && s.chipTxtOn]}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={s.card}>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>Ascolto costante «Axon»</Text>
                <Text style={s.hint}>{moduleOn ? "Di' «Axon» e parla con l'assistente senza toccare lo schermo." : "Modulo non attivato dal Master."}</Text>
              </View>
              {saving === "listen" ? <ActivityIndicator color={HT.brand} /> : <Switch value={listenOn} disabled={!moduleOn} onValueChange={toggleListen} trackColor={{ true: HT.brand }} testID="consultant-listen-switch" />}
            </View>
          </View>

          <Pressable onPress={logout} style={s.logout} testID="consultant-logout">
            <Ionicons name="log-out-outline" size={18} color={HT.danger} />
            <Text style={s.logoutTxt}>Esci dall&apos;account</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  title: { fontSize: 26, fontWeight: "900", color: HT.text },
  sub: { fontSize: 13, color: HT.muted, marginTop: 2 },
  badge: { color: HT.brand, fontWeight: "800" },
  body: { padding: 16, gap: 12 },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: HT.border, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  hint: { fontSize: 13, color: HT.muted, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  rowBetween: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" },
  input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: HT.border, borderRadius: theme.radius.md, paddingHorizontal: 12, color: HT.text, fontSize: 15, backgroundColor: HT.card2 },
  saveBtn: { backgroundColor: HT.brand, borderRadius: theme.radius.md, paddingHorizontal: 16, minHeight: 46, justifyContent: "center" },
  saveTxt: { color: HT.white, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: HT.brand, backgroundColor: HT.card2 },
  chipOn: { backgroundColor: HT.brand },
  chipTxt: { color: HT.brand, fontWeight: "700", fontSize: 13 },
  chipTxtOn: { color: HT.white },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, marginTop: 8 },
  logoutTxt: { color: HT.danger, fontWeight: "700" },
});

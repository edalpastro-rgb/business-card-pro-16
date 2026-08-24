/**
 * V27 — Master-only screen dedicated to editing the phone-call script that
 * agents see when they tap "Chiama" on a contact card. Backed by the same
 * `/api/settings` document (`call_script` field) used by CallScriptFAB and
 * CallScriptOverlay.
 */
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = { primary: "#FF6B35", navy: "#1B2B4B", muted: "#94A3B8", success: "#16A34A" };

export default function CallScriptConfigScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id;
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<{ call_script?: string }>("/settings");
      setScript(s.call_script || "");
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isMaster) load(); else setLoading(false); }, [isMaster, load]);

  const save = async () => {
    try {
      setSaving(true);
      // Fetch the full settings, patch call_script, PUT the full object
      // (SettingsModel PUT overwrites the whole document — this preserves other fields).
      const full = await api<any>("/settings");
      await api("/settings", { method: "PUT", body: { ...full, call_script: script } });
      notify("Salvato ✅", "Lo script è ora visibile a tutti gli agenti del team");
      router.back();
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setSaving(false); }
  };

  if (!isMaster) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
          <Text style={styles.title}>Script Telefonata</Text><View style={{ width: 26 }} />
        </View>
        <View style={{ padding: 40, alignItems: "center", gap: 10 }}>
          <Ionicons name="lock-closed" size={40} color={C.muted} />
          <Text style={{ fontWeight: "800", color: C.navy }}>Sezione riservata al Master</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Script Telefonata</Text>
          <Text style={styles.sub}>Mostrato agli agenti quando cliccano &quot;Chiama&quot; su un contatto</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 10 }}>
          <View style={styles.tipCard}>
            <Ionicons name="information-circle" size={18} color={C.primary} />
            <Text style={styles.tipTxt}>
              Suggerimento: struttura il testo in sezioni (Apertura, Scopo, Aggancio, Chiusura). Usa i
              placeholder <Text style={{ fontWeight: "800" }}>{"{name}"}</Text> (nome cliente) e{" "}
              <Text style={{ fontWeight: "800" }}>{"{agent}"}</Text> (nome agente).
            </Text>
          </View>

          <TextInput
            testID="call-script-textarea"
            value={script}
            onChangeText={setScript}
            multiline
            placeholder={"APERTURA\nBuongiorno {name}, sono {agent}…\n\nSCOPO\n…\n\nCHIUSURA\nLe va bene giovedì alle 18:00?"}
            placeholderTextColor="#94A3B8"
            style={styles.textarea}
          />

          <Pressable testID="save-script-btn" onPress={save} disabled={saving} style={[styles.saveBtn, { backgroundColor: saving ? C.muted : C.primary }]}>
            {saving ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="save" size={18} color="#FFF" />
                <Text style={styles.saveBtnTxt}>Salva script</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  title: { fontSize: 18, fontWeight: "800", color: C.navy, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  tipCard: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, backgroundColor: "#FFF1E9", borderRadius: 12, borderWidth: 1, borderColor: "#FFD5B8" },
  tipTxt: { flex: 1, fontSize: 12, color: C.navy, lineHeight: 17, fontWeight: "600" },
  textarea: { backgroundColor: "#FFF", borderRadius: 14, padding: 14, minHeight: 320, fontSize: 15, color: C.navy, textAlignVertical: "top", borderWidth: 1, borderColor: theme.color.border, lineHeight: 22 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, marginTop: 6 },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

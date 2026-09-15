// VisitDetectionSettings.tsx — V50.z256 — Impostazioni → Preferenze Generali → «Rilevamento Visite»
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, TextInput, ActivityIndicator, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { VD_DEFAULT, VisitDetectionSettings as VDS, VisitMode, loadVisitSettings, saveVisitSettings, ensureLocationPermission } from "@/src/visitDetection";

const SKY = "#0EA5E9";
const STAY = [5, 10, 15, 20, 30];
const RADIUS = [100, 150, 200, 300];
const MODES: { id: VisitMode; label: string; desc: string; icon: any }[] = [
  { id: "realtime", label: "Tempo Reale", desc: "Popup visita per visita", icon: "flash" },
  { id: "evening", label: "Fine Giornata", desc: "Solo recap serale", icon: "moon" },
  { id: "both", label: "Entrambe", desc: "Popup + recap", icon: "layers" },
];

export function VisitDetectionSettings() {
  const [s, setS] = useState<VDS>(VD_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [perm, setPerm] = useState<"granted" | "denied" | "blocked" | null>(null);

  useEffect(() => { loadVisitSettings().then(setS).finally(() => setLoading(false)); }, []);

  const persist = async (patch: Partial<VDS>) => {
    const next = { ...s, ...patch };
    if (patch.recap_time !== undefined && !/^\d{2}:\d{2}$/.test(patch.recap_time)) { setS(next); return; }
    setS(next); setSaving(true);
    try { await saveVisitSettings(next); } catch (e: any) { notify("Impostazioni", e?.message || "Salvataggio non riuscito"); } finally { setSaving(false); }
  };

  const toggle = async (on: boolean) => {
    if (on) {
      const p = await ensureLocationPermission(true);
      setPerm(p);
      if (p !== "granted") {
        notify("Posizione necessaria", p === "blocked" ? "Abilita la posizione nelle impostazioni del telefono per rilevare le visite." : "Senza posizione non posso riconoscere le soste presso i clienti.",
          p === "blocked" ? [{ text: "Apri impostazioni", onPress: () => Linking.openSettings() }, { text: "Ok" }] : undefined);
        return;
      }
    }
    await persist({ enabled: on });
  };

  if (loading) return <ActivityIndicator color={SKY} style={{ marginVertical: 16 }} />;
  return (
    <View testID="visit-detection-settings">
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Rilevamento Visite</Text>
          <Text style={styles.hint}>Riconosce automaticamente le soste presso i tuoi clienti (GPS) e registra visite e km nel Resoconto Km.</Text>
        </View>
        <Switch value={s.enabled} onValueChange={toggle} trackColor={{ true: SKY }} testID="vd-enabled" />
      </View>
      {perm === "blocked" && (
        <Pressable onPress={() => Linking.openSettings()} style={styles.warn} testID="vd-open-settings"><Ionicons name="warning" size={16} color="#B45309" /><Text style={styles.warnTxt}>Permesso posizione bloccato · tocca per aprire le impostazioni</Text></Pressable>
      )}

      <Text style={styles.label}>SOGLIA DI PERMANENZA</Text>
      <View style={styles.pills}>
        {STAY.map((m) => <Pill key={m} on={s.stay_minutes === m} label={`${m} min`} onPress={() => persist({ stay_minutes: m })} testID={`vd-stay-${m}`} />)}
      </View>
      <Text style={styles.hint}>La visita scatta solo dopo questo tempo nel raggio: evita i falsi positivi (passaggi in auto, clienti vicini in centro).</Text>

      <Text style={styles.label}>RAGGIO</Text>
      <View style={styles.pills}>
        {RADIUS.map((r) => <Pill key={r} on={s.radius_m === r} label={`${r} m`} onPress={() => persist({ radius_m: r })} testID={`vd-radius-${r}`} />)}
      </View>

      <Text style={styles.label}>MODALITÀ</Text>
      <View style={{ gap: 6 }}>
        {MODES.map((m) => {
          const on = s.mode === m.id;
          return (
            <Pressable key={m.id} onPress={() => persist({ mode: m.id })} style={[styles.mode, on && styles.modeOn]} testID={`vd-mode-${m.id}`}>
              <Ionicons name={m.icon} size={18} color={on ? SKY : theme.color.muted} />
              <View style={{ flex: 1 }}><Text style={[styles.modeTitle, on && { color: SKY }]}>{m.label}</Text><Text style={styles.hint}>{m.desc}</Text></View>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? SKY : theme.color.muted} />
            </Pressable>
          );
        })}
      </View>

      {s.mode !== "realtime" && (
        <>
          <Text style={styles.label}>ORARIO RECAP SERALE</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TextInput value={s.recap_time} onChangeText={(v) => persist({ recap_time: v })} placeholder="18:30" placeholderTextColor={theme.color.muted} style={styles.time} maxLength={5} keyboardType={Platform.OS === "web" ? undefined : "numbers-and-punctuation"} testID="vd-recap-time" />
            <Text style={styles.hint}>Formato HH:MM · lista delle soste con spunte pre-selezionate</Text>
          </View>
        </>
      )}
      <Text style={[styles.hint, { marginTop: 10 }]}>ℹ️ Con l&apos;app aperta funziona subito; il rilevamento in background richiede la build nativa (Publish) e il permesso «Sempre» alla posizione.{saving ? "  · salvataggio…" : ""}</Text>
    </View>
  );
}

function Pill({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.pill, on && styles.pillOn]}><Text style={[styles.pillTxt, on && { color: "#FFF" }]}>{label}</Text></Pressable>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  hint: { fontSize: 11, color: theme.color.muted, lineHeight: 15, marginTop: 2 },
  label: { fontSize: 11, fontWeight: "800", color: theme.color.muted, letterSpacing: 0.4, marginTop: 14, marginBottom: 6 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  pillOn: { backgroundColor: SKY, borderColor: SKY }, pillTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  mode: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, minHeight: 52 },
  modeOn: { borderColor: SKY, backgroundColor: "#E0F2FE" }, modeTitle: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  time: { width: 84, textAlign: "center", fontSize: 16, fontWeight: "800", color: theme.color.onSurface, backgroundColor: theme.color.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, minHeight: 44 },
  warn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF3C7", borderRadius: 10, padding: 10, marginTop: 8 }, warnTxt: { flex: 1, fontSize: 12, color: "#92400E", fontWeight: "700" },
});

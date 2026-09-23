// src/PushUrgencyCard.tsx — V50.z221 — Priorità degli avvisi push: per ogni tipo di evento un livello 🔴 CRITICAL / 🟠 HIGH / ⚪ NORMAL,
// più REGOLE PERSONALIZZATE (parola chiave nel titolo/testo → livello) per aggiungere priorità critiche a piacere.
// GET/PUT /axon/push/urgency-map (solo Master/owner). Le CRITICAL suonano sempre, anche di notte (bypass Non disturbare).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Urg = "CRITICAL" | "HIGH" | "NORMAL";
type Rule = { id: string; label: string; match: string; urgency: Urg };
type Cfg = { levels: Urg[]; urgency_map: Record<string, Urg>; custom_rules: Rule[]; labels: Record<string, string>; defaults: Record<string, Urg>; dnd_bypass: boolean };

const LV: Record<Urg, { dot: string; name: string; color: string; bg: string }> = {
  CRITICAL: { dot: "🔴", name: "Critica", color: HT.danger, bg: HT.dangerTint },
  HIGH: { dot: "🟠", name: "Alta", color: "#FDBA74", bg: HT.brandTint },
  NORMAL: { dot: "⚪", name: "Normale", color: HT.text2, bg: HT.card2 },
};

export function PushUrgencyCard() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [newMatch, setNewMatch] = useState("");
  const [newUrg, setNewUrg] = useState<Urg>("CRITICAL");

  useEffect(() => { api<Cfg>("/axon/push/urgency-map").then(setCfg).catch(() => {}); }, []);
  if (!cfg) return null;

  const save = async (body: { urgency_map?: Record<string, Urg>; custom_rules?: Rule[] }) => {
    setSaving(true);
    try { const r = await api<{ urgency_map: Record<string, Urg>; custom_rules: Rule[] }>("/axon/push/urgency-map", { method: "PUT", body }); setCfg((c) => (c ? { ...c, ...r } : c)); }
    catch (e: any) { notify("Non salvato", String(e?.message || e)); }
    finally { setSaving(false); }
  };
  const setKind = (k: string, u: Urg) => { const m = { ...cfg.urgency_map, [k]: u }; setCfg({ ...cfg, urgency_map: m }); void save({ urgency_map: m }); };
  const addRule = () => {
    const match = newMatch.trim();
    if (!match) return;
    const rules = [...cfg.custom_rules, { id: `tmp${Date.now()}`, label: match, match, urgency: newUrg }];
    setCfg({ ...cfg, custom_rules: rules }); setNewMatch("");
    void save({ custom_rules: rules });
  };
  const delRule = (id: string) => { const rules = cfg.custom_rules.filter((r) => r.id !== id); setCfg({ ...cfg, custom_rules: rules }); void save({ custom_rules: rules }); };
  const kinds = Object.keys(cfg.labels).filter((k) => k !== "test");
  const critN = kinds.filter((k) => cfg.urgency_map[k] === "CRITICAL").length + cfg.custom_rules.filter((r) => r.urgency === "CRITICAL").length;

  return (
    <View style={styles.card} testID="push-urgency-card">
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.head} testID="push-urgency-toggle">
        <Ionicons name="flame" size={18} color="#DC2626" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headTxt}>Priorità degli avvisi</Text>
          <Text style={styles.sub}>{critN} {critN === 1 ? "urgenza critica" : "urgenze critiche"} (LED rosso, suona sempre, anche di notte) · tocca per {open ? "chiudere" : "modificare"}</Text>
        </View>
        {saving ? <ActivityIndicator size="small" color="#DC2626" /> : <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={HT.muted} />}
      </Pressable>

      {open && (
        <>
          <Text style={styles.section}>Eventi AxonOS</Text>
          {kinds.map((k) => {
            const cur = cfg.urgency_map[k] || "NORMAL";
            return (
              <View key={k} style={styles.row} testID={`push-urgency-row-${k}`}>
                <Text style={styles.rowLabel} numberOfLines={2}>{cfg.labels[k]}</Text>
                <View style={styles.chips}>
                  {(["CRITICAL", "HIGH", "NORMAL"] as Urg[]).map((u) => {
                    const on = cur === u;
                    return (
                      <Pressable key={u} onPress={() => setKind(k, u)} style={[styles.chip, on && { backgroundColor: LV[u].bg, borderColor: LV[u].color }]} testID={`push-urgency-${k}-${u}`} accessibilityLabel={`${cfg.labels[k]}: ${LV[u].name}`}>
                        <Text style={styles.chipTxt}>{LV[u].dot}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
          <Text style={styles.legend}>🔴 Critica · 🟠 Alta · ⚪ Normale</Text>

          <Text style={styles.section}>Priorità personalizzate</Text>
          <Text style={styles.sub}>Aggiungi una parola chiave: se compare nel titolo o nel testo di un avviso, l'avviso prende quella priorità (es. «nuovo lead», «appuntamento», «Rossi»).</Text>
          {cfg.custom_rules.map((r) => (
            <View key={r.id} style={styles.ruleRow} testID={`push-rule-${r.id}`}>
              <Text style={styles.ruleDot}>{LV[r.urgency].dot}</Text>
              <Text style={styles.ruleTxt} numberOfLines={1}>«{r.match}» → {LV[r.urgency].name}</Text>
              <Pressable onPress={() => delRule(r.id)} hitSlop={8} style={styles.del} testID={`push-rule-del-${r.id}`}><Ionicons name="trash-outline" size={16} color={HT.muted} /></Pressable>
            </View>
          ))}
          <View style={styles.addRow}>
            <TextInput value={newMatch} onChangeText={setNewMatch} placeholder="Parola chiave dell'avviso…" placeholderTextColor={HT.muted} style={styles.input} onSubmitEditing={addRule} returnKeyType="done" testID="push-rule-input" />
            <View style={styles.chips}>
              {(["CRITICAL", "HIGH", "NORMAL"] as Urg[]).map((u) => (
                <Pressable key={u} onPress={() => setNewUrg(u)} style={[styles.chip, newUrg === u && { backgroundColor: LV[u].bg, borderColor: LV[u].color }]} testID={`push-rule-urg-${u}`}><Text style={styles.chipTxt}>{LV[u].dot}</Text></Pressable>
              ))}
            </View>
          </View>
          <Pressable onPress={addRule} disabled={!newMatch.trim() || saving} style={[styles.addBtn, (!newMatch.trim() || saving) && { opacity: 0.5 }]} testID="push-rule-add">
            <Ionicons name="add-circle" size={18} color="#FFF" /><Text style={styles.addTxt}>Aggiungi priorità {LV[newUrg].name.toLowerCase()}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card2, borderRadius: 14, borderWidth: 1, borderColor: HT.danger + '66', padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  headTxt: { fontSize: 13, fontWeight: "900", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  sub: { fontSize: 11.5, color: HT.muted, lineHeight: 15 },
  section: { fontSize: 12, fontWeight: "800", color: HT.text, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  rowLabel: { flex: 1, fontSize: 12.5, color: HT.text, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 6 },
  chip: { width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: HT.border, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" },
  chipTxt: { fontSize: 15 },
  legend: { fontSize: 11, color: HT.muted, textAlign: "right" },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, backgroundColor: HT.card2, borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: HT.border },
  ruleDot: { fontSize: 13 },
  ruleTxt: { flex: 1, fontSize: 12.5, color: HT.text, fontWeight: "600" },
  del: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, paddingHorizontal: 10, fontSize: 13, color: HT.text },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: 12, backgroundColor: '#DC2626' },
  addTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

// app/le-mie-aree.tsx — V50.z227 — Impostazioni → Le mie aree: attiva/disattiva aree, stato «Configurazione incompleta»,
// «Configura» apre il mini-wizard contestuale (max 3 passi), aree personalizzate (crea/modifica/elimina). ?configure=<key> apre subito il wizard.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { notify, confirmAsync } from "@/src/utils/notify";
import { AreaMiniWizard, type AreaCfg } from "@/src/AreaMiniWizard";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";
const NEW_CUSTOM: AreaCfg = { key: "custom_new", title: "Nuova area personalizzata", icon: "sparkles", desc: "", on: true, custom: true, future: false, status: "incomplete", wizard: { steps: [{ id: "custom", kind: "custom", title: "Racconta ad AxonOS questa area" }] } };

export default function LeMieAreeScreen() {
  const router = useRouter();
  const { configure } = useLocalSearchParams<{ configure?: string }>();
  const bottomPad = usePageBottomPadding();
  const [areas, setAreas] = useState<AreaCfg[] | null>(null);
  const [wiz, setWiz] = useState<AreaCfg | null>(null);
  const autoOpened = React.useRef(false);

  const load = useCallback(async () => {
    try { const r = await api<{ areas: AreaCfg[] }>("/axon/areas/config"); setAreas(r.areas); return r.areas; }
    catch (e: any) { notify("Errore", e?.message || String(e)); return []; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!areas || autoOpened.current || !configure) return;
    const a = areas.find((x) => x.key === configure);
    if (a?.wizard) { autoOpened.current = true; setWiz(a); }
  }, [areas, configure]);

  const toggle = async (a: AreaCfg, on: boolean) => {
    if (a.custom) return;
    setAreas((arr) => (arr || []).map((x) => (x.key === a.key ? { ...x, on } : x)));
    try {
      const all = Object.fromEntries((areas || []).filter((x) => !x.custom).map((x) => [x.key, x.key === a.key ? on : x.on]));
      await api("/axon/setup/sphere-areas", { method: "PUT", body: { areas: all } });
      // area attivata con mini-wizard → si apre subito
      if (on && a.wizard && a.status !== "complete") setWiz({ ...a, on });
    } catch (e: any) { notify("Errore", e?.message || String(e)); void load(); }
  };
  const removeCustom = async (a: AreaCfg) => {
    if (!(await confirmAsync("Elimina area", `Rimuovere «${a.title}» e i suoi avvisi?`))) return;
    try { await api(`/axon/areas/custom/${a.key}`, { method: "DELETE" }); void load(); } catch (e: any) { notify("Errore", e?.message || String(e)); }
  };

  const builtin = (areas || []).filter((a) => !a.custom && !a.future);
  const customs = (areas || []).filter((a) => a.custom);
  const incomplete = builtin.filter((a) => a.on && a.status === "incomplete").length;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="aree-back"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <Text style={styles.hTitle}>Le mie aree</Text>
        <View style={{ width: 26 }} />
      </View>
      {!areas ? <ActivityIndicator color={PURPLE} style={{ marginTop: 30 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: bottomPad }}>
          <Text style={styles.intro}>Attiva ciò che usi. Ogni area con dati apre un mini-wizard (max 3 passi): prima «Carica foto, file o PDF», AxonOS legge tutto e ti chiede solo ciò che manca.</Text>
          {incomplete > 0 && <View style={styles.banner} testID="aree-incomplete-banner"><Ionicons name="alert-circle" size={16} color={HT.warning} /><Text style={styles.bannerTxt}>{incomplete} {incomplete === 1 ? "area attiva con configurazione incompleta" : "aree attive con configurazione incompleta"}</Text></View>}

          {builtin.map((a) => {
            const incompleteA = a.on && a.status === "incomplete";
            return (
              <View key={a.key} style={[styles.row, incompleteA && { borderColor: '#FCD34D' }]} testID={`aree-row-${a.key}`}>
                <View style={[styles.icon, a.on && { backgroundColor: PURPLE }]}>
                  <Ionicons name={a.icon as any} size={20} color={a.on ? "#FFF" : HT.muted} />
                  {incompleteA && <View style={styles.dot} testID={`aree-incomplete-${a.key}`}><Ionicons name="alert" size={9} color="#FFF" /></View>}
                  {a.on && a.status === "complete" && <View style={[styles.dot, { backgroundColor: '#16A34A' }]}><Ionicons name="checkmark" size={9} color="#FFF" /></View>}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.title} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.desc} numberOfLines={2}>{a.desc}</Text>
                  {incompleteA && <Text style={styles.incTxt}>Configurazione incompleta</Text>}
                  {a.on && a.wizard && (
                    <Pressable onPress={() => setWiz(a)} style={styles.cfgBtn} testID={`aree-configure-${a.key}`}>
                      <Ionicons name={a.status === "complete" ? "create-outline" : "flash"} size={13} color={PURPLE} />
                      <Text style={styles.cfgTxt}>{a.status === "complete" ? "Modifica configurazione" : "Configura ora"}</Text>
                    </Pressable>
                  )}
                </View>
                <Switch value={a.on} onValueChange={(v) => toggle(a, v)} trackColor={{ true: PURPLE, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? "#FFF" : undefined} testID={`aree-switch-${a.key}`} />
              </View>
            );
          })}

          <Text style={styles.section}>✨ Aree personalizzate</Text>
          {customs.map((a) => (
            <View key={a.key} style={styles.row} testID={`aree-row-${a.key}`}>
              <View style={[styles.icon, { backgroundColor: '#C2410C' }]}><Ionicons name="sparkles" size={20} color="#FFF" /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title} numberOfLines={1}>{a.title}</Text>
                <Text style={styles.desc} numberOfLines={2}>{a.desc || "Nessuna descrizione"}{a.custom_area?.sites?.length ? ` · ${a.custom_area.sites.length} fonti web` : ""}{a.custom_area?.deadlines?.length ? ` · ${a.custom_area.deadlines.length} scadenze` : ""}</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable onPress={() => setWiz(a)} style={styles.cfgBtn} testID={`aree-configure-${a.key}`}><Ionicons name="create-outline" size={13} color={PURPLE} /><Text style={styles.cfgTxt}>Modifica</Text></Pressable>
                  <Pressable onPress={() => removeCustom(a)} style={styles.cfgBtn} testID={`aree-delete-${a.key}`}><Ionicons name="trash-outline" size={13} color="#DC2626" /><Text style={[styles.cfgTxt, { color: "#DC2626" }]}>Elimina</Text></Pressable>
                </View>
              </View>
            </View>
          ))}
          <Pressable onPress={() => setWiz(NEW_CUSTOM)} style={styles.addBtn} testID="aree-add-custom"><Ionicons name="add-circle" size={20} color="#FFF" /><Text style={styles.addTxt}>Nuova area personalizzata</Text></Pressable>
        </ScrollView>
      )}
      <AreaMiniWizard area={wiz} visible={!!wiz} onClose={() => setWiz(null)} onDone={() => void load()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: HT.card, borderBottomWidth: 1, borderBottomColor: HT.border },
  hTitle: { fontSize: 17, fontWeight: "900", color: HT.text },
  intro: { fontSize: 12.5, color: HT.muted, lineHeight: 17 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.warningTint, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: HT.warning + '66' },
  bannerTxt: { color: "#FDBA74", fontWeight: "800", fontSize: 12.5, flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 16, padding: 12, borderWidth: 1.5, borderColor: HT.border },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: HT.border, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: -4, top: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: '#F59E0B', alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: HT.card },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  desc: { fontSize: 12, color: HT.muted, lineHeight: 16 },
  incTxt: { fontSize: 11, fontWeight: "900", color: HT.warning },
  cfgBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, alignSelf: "flex-start" },
  cfgTxt: { color: PURPLE, fontWeight: "800", fontSize: 12.5 },
  section: { fontSize: 13, fontWeight: "900", color: HT.violet, marginTop: 8 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: '#C2410C' },
  addTxt: { color: "#FFF", fontWeight: "900", fontSize: 14.5 },
});

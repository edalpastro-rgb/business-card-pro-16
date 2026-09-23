// setup-config.tsx — V50.z216 — BLOCCO 5: Profilo → «La mia configurazione Set Up». Tutto ciò che il wizard ha raccolto, modificabile in
// qualsiasi momento (sfera, aree con switch, anagrafica, Parla a Neo, memoria). Ogni modifica si sincronizza con AxonOS automaticamente:
// nessun riavvio dell'app. Da qui si riapre qualunque step del wizard (POST /axon/setup/reopen → /setup).
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { SetupProcessingBadge } from "@/src/SetupProcessingBadge";
import { FutureInterestsAlert } from "@/src/FutureInterestsAlert"; // V50.z219
import type { Sphere } from "@/src/wizard/Step2Sfera";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";
type Area = { key: string; sphere: string; icon: string; title: string; desc: string; future: boolean; on: boolean };
type Cfg = {
  state: { status: string; mode: "setup" | "full" | null; sphere?: Sphere | null; steps: Record<string, { done: boolean; skipped: boolean }>; future_interests?: string[] };
  mode_label: string | null;
  anagrafica: { first_name?: string; last_name?: string; birth_date?: string; tax_id?: string; phone?: string; emails?: string[]; primary_email?: string; address?: string };
  areas: Area[];
  talk: { inputs: number; files: { file_id: string; name: string; size: number }[]; proposals_pending: number; proposals_accepted: number; facts_accepted: number; jobs_running: number };
  memory_items: number;
  where: { icon: string; title: string; text: string; route: string }[];
};
const SPHERES: { key: Sphere; label: string; emoji: string }[] = [{ key: "business", label: "Business", emoji: "🟦" }, { key: "home", label: "Home", emoji: "🟢" }, { key: "both", label: "Entrambe", emoji: "✨" }];
const STEP_TITLES = ["Chi sei", "Sfera", "Aree", "Parla a Neo"];

export default function SetupConfigScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const pagePad = usePageBottomPadding();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => { api<Cfg>("/axon/setup/config").then(setCfg).catch(() => {}); }, []);
  useFocusEffect(load);

  const setSphere = async (sphere: Sphere) => {
    setSaving("sphere");
    try { await api("/axon/setup/sphere-areas", { method: "PUT", body: { sphere } }); load(); } finally { setSaving(null); }
  };
  const toggleArea = async (key: string, on: boolean) => {
    if (!cfg) return;
    const areas = Object.fromEntries(cfg.areas.map((a) => [a.key, a.key === key ? on : a.on]));
    setCfg({ ...cfg, areas: cfg.areas.map((a) => (a.key === key ? { ...a, on } : a)) });
    try { await api("/axon/setup/sphere-areas", { method: "PUT", body: { areas } }); } catch { load(); }
  };
  const reopen = async (step: number) => {
    setSaving(`step${step}`);
    try { await api("/axon/setup/reopen", { method: "POST", body: { step } }); router.push("/setup" as any); } finally { setSaving(null); }
  };

  if (!cfg) return <View style={[styles.root, { justifyContent: "center" }]}><ActivityIndicator color={PURPLE} /></View>;
  const an = cfg.anagrafica || {};
  const sphere = cfg.state.sphere || null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/impostazioni" as any))} hitSlop={10} style={styles.headBtn} testID="setup-config-back"><Ionicons name="arrow-back" size={22} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle}>La mia configurazione Set Up</Text>
          <Text style={styles.headSub}>{cfg.mode_label || "Non ancora iniziata"} · modificabile sempre · sincronizzata con AxonOS</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: pagePad }} testID="setup-config">
        <SetupProcessingBadge />
        <FutureInterestsAlert />
        <View style={styles.infoBox}><Ionicons name="sync" size={16} color={HT.violet} /><Text style={styles.infoTxt}>Ogni modifica qui, in Anagrafica o in chat con AxonOS si aggiorna ovunque, subito. Non serve riavviare l'app.</Text></View>

        {/* Sfera */}
        <View style={styles.card}>
          <Row icon="planet" title="Sfera" right={<Pressable onPress={() => reopen(2)} hitSlop={8} testID="setup-config-reopen-2"><Text style={styles.link}>Step 2</Text></Pressable>} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {SPHERES.map((s) => (
              <Pressable key={s.key} onPress={() => setSphere(s.key)} disabled={saving === "sphere"} style={[styles.chip, sphere === s.key && styles.chipOn]} testID={`setup-config-sphere-${s.key}`}>
                <Text style={[styles.chipTxt, sphere === s.key && { color: "#FFF" }]}>{s.emoji} {s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Aree */}
        <View style={styles.card}>
          <Row icon="toggle" title={`Aree · ${cfg.areas.filter((a) => a.on && !a.future).length} attive`} right={<Pressable onPress={() => reopen(3)} hitSlop={8} testID="setup-config-reopen-3"><Text style={styles.link}>Step 3</Text></Pressable>} />
          {/* V50.z227 — Le mie aree: mini-wizard per area, stato configurazione, aree personalizzate */}
          <Pressable onPress={() => router.push("/le-mie-aree" as any)} style={styles.btnAlt} testID="setup-config-my-areas"><Ionicons name="flash" size={16} color={PURPLE} /><Text style={styles.btnAltTxt}>Le mie aree · configura e personalizza</Text></Pressable>
          {!sphere && <Text style={styles.muted}>Scegli prima una sfera.</Text>}
          {cfg.areas.map((a) => (
            <View key={a.key} style={styles.areaRow} testID={`setup-config-area-${a.key}`}>
              <View style={[styles.areaIcon, a.on && { backgroundColor: a.future ? "#FDBA74" : PURPLE }]}><Ionicons name={a.icon as any} size={18} color={a.on ? "#FFF" : HT.muted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.areaTitle} numberOfLines={1}>{a.title}</Text>
                <Text style={styles.areaDesc} numberOfLines={1}>{a.future ? "Interesse futuro · ti avviso quando è pronto" : a.desc}</Text>
              </View>
              <Switch value={a.on} onValueChange={(v) => toggleArea(a.key, v)} trackColor={{ true: a.future ? "#FDBA74" : PURPLE, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? "#FFF" : undefined} testID={`setup-config-switch-${a.key}`} />
            </View>
          ))}
        </View>

        {/* Anagrafica */}
        <View style={styles.card}>
          <Row icon="person-circle" title="Chi sei" right={<Pressable onPress={() => reopen(1)} hitSlop={8} testID="setup-config-reopen-1"><Text style={styles.link}>Step 1</Text></Pressable>} />
          <KV k="Nome" v={[an.first_name, an.last_name].filter(Boolean).join(" ")} />
          <KV k="Mail principale" v={an.primary_email} />
          {!!an.emails?.length && an.emails.length > 1 && <KV k="Altre mail" v={an.emails.filter((e) => e !== an.primary_email).join(", ")} />}
          <KV k="Telefono" v={an.phone} />
          <KV k="Indirizzo" v={an.address} />
          <KV k="Codice fiscale" v={an.tax_id} />
          <Pressable onPress={() => router.push("/anagrafica-master" as any)} style={styles.btnAlt} testID="setup-config-anagrafica"><Ionicons name="create" size={16} color={PURPLE} /><Text style={styles.btnAltTxt}>Modifica in Anagrafica</Text></Pressable>
        </View>

        {/* Parla a Neo */}
        <View style={styles.card}>
          <Row icon="chatbubble-ellipses" title="Parla a Neo" right={<Pressable onPress={() => reopen(4)} hitSlop={8} testID="setup-config-reopen-4"><Text style={styles.link}>Step 4</Text></Pressable>} />
          <KV k="Contributi" v={`${cfg.talk.inputs} (testi, file, audio)`} />
          <KV k="Dati confermati" v={String(cfg.talk.proposals_accepted)} />
          <KV k="Cose imparate" v={`${cfg.talk.facts_accepted} · memoria AxonOS: ${cfg.memory_items} voci`} />
          {cfg.talk.proposals_pending > 0 && (
            <Pressable onPress={() => reopen(4)} style={styles.btnWarn} testID="setup-config-pending"><Ionicons name="alert-circle" size={16} color={HT.warning} /><Text style={styles.btnWarnTxt}>{cfg.talk.proposals_pending} proposte da confermare · un tap ciascuna</Text></Pressable>
          )}
          {cfg.talk.files.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={styles.muted}>File letti da Neo (archiviati nei Master Files):</Text>
              {cfg.talk.files.slice(-5).map((f) => (
                <Pressable key={f.file_id || f.name} onPress={() => router.push("/master-files" as any)} style={styles.fileRow} testID={`setup-config-file-${f.file_id}`}>
                  <Ionicons name="document" size={16} color={PURPLE} /><Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Dove sono i dati */}
        <View style={styles.card}>
          <Row icon="map" title="Dove sono finiti i miei dati" />
          {cfg.where.map((w) => (
            <Pressable key={w.title} onPress={() => router.push(w.route as any)} style={styles.whereRow} testID={`setup-config-where-${w.title}`}>
              <Ionicons name={w.icon as any} size={18} color={PURPLE} />
              <View style={{ flex: 1 }}><Text style={styles.areaTitle}>{w.title}</Text><Text style={styles.areaDesc}>{w.text}</Text></View>
              <Ionicons name="chevron-forward" size={16} color={HT.muted} />
            </Pressable>
          ))}
        </View>

        {/* Step */}
        <View style={styles.card}>
          <Row icon="list" title="Step del wizard" />
          {STEP_TITLES.map((t, i) => {
            const st = cfg.state.steps?.[String(i + 1)];
            return (
              <Pressable key={t} onPress={() => reopen(i + 1)} style={styles.stepRow} testID={`setup-config-step-${i + 1}`}>
                <Ionicons name={st?.done ? "checkmark-circle" : st?.skipped ? "remove-circle" : "ellipse-outline"} size={20} color={st?.done ? "#059669" : st?.skipped ? HT.muted : "#CBD5E1"} />
                <Text style={[styles.areaTitle, { flex: 1 }]}>{i + 1} · {t}</Text>
                <Text style={styles.link}>{st?.done ? "Rivedi" : st?.skipped ? "Completa" : "Apri"}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ icon, title, right }: { icon: keyof typeof Ionicons.glyphMap; title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.rowHead}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={PURPLE} /></View>
      <Text style={styles.rowTitle}>{title}</Text>
      {right}
    </View>
  );
}
function KV({ k, v }: { k: string; v?: string | null }) {
  return <View style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={[styles.v, !v && { color: HT.muted, fontWeight: "500" }]} numberOfLines={2}>{v || "—"}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAF5FF' },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  headBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headTitle: { fontSize: 17, fontWeight: "900", color: HT.text },
  headSub: { fontSize: 12, color: HT.muted },
  infoBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.violetTint, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.violet + '66' },
  infoTxt: { flex: 1, fontSize: 12.5, color: HT.violet, lineHeight: 17, fontWeight: "600" },
  card: { backgroundColor: HT.card, borderRadius: 18, padding: 14, gap: 10, borderWidth: 1, borderColor: HT.violetTint },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "900", color: HT.text },
  link: { color: PURPLE, fontWeight: "800", fontSize: 13 },
  chip: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: HT.violet + '66', backgroundColor: '#FAF5FF' },
  chipOn: { backgroundColor: PURPLE, borderColor: PURPLE },
  chipTxt: { fontWeight: "800", color: HT.violet, fontSize: 13 },
  muted: { fontSize: 12, color: HT.muted },
  areaRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  areaIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: HT.border, alignItems: "center", justifyContent: "center" },
  areaTitle: { fontSize: 14, fontWeight: "800", color: HT.text },
  areaDesc: { fontSize: 11.5, color: HT.muted },
  kv: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  k: { width: 110, fontSize: 12.5, color: HT.muted, fontWeight: "700" },
  v: { flex: 1, fontSize: 13.5, color: HT.text, fontWeight: "700" },
  btnAlt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: PURPLE },
  btnAltTxt: { color: PURPLE, fontWeight: "800", fontSize: 13.5 },
  btnWarn: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, backgroundColor: HT.warningTint, borderWidth: 1, borderColor: '#FCD34D', paddingHorizontal: 12 },
  btnWarnTxt: { color: HT.warning, fontWeight: "800", fontSize: 13, flex: 1 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 },
  fileName: { flex: 1, fontSize: 13, color: HT.text, fontWeight: "600" },
  whereRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
});

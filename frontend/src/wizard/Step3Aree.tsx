// src/wizard/Step3Aree.tsx — V50.z214 — BLOCCO 3 · Step 3 «Aree»: elenco aree per la sfera scelta (icona, descrizione, switch),
// max 4 voci per schermata su sfondo fotografico allegro (velo chiaro → leggibilità massima). «Entrambe» = pagine Business poi Home.
// CarPlay/integrazioni complesse = «interesse futuro» (switch, non implementate → avviso di setup dedicato in una fase successiva).
// Fine pagina: «OK, avanti» (pagina successiva o salvataggio) · «Salta tutto per ora» (lo step resta saltato, nessun salvataggio).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, ImageBackground, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInRight } from "react-native-reanimated";
import { api } from "@/src/api";
import type { StepBinder } from "@/src/wizard/Step1Anagrafica";
import type { Sphere } from "@/src/wizard/Step2Sfera";
import { AreaMiniWizard, type AreaCfg } from "@/src/AreaMiniWizard"; // V50.z227 — mini-wizard contestuale all'attivazione

const PURPLE = "#7C3AED";
const PER_PAGE = 4;
type Area = { key: string; sphere: "business" | "home" | "both"; icon: string; title: string; desc: string; default_on: boolean; future: boolean };
type Page = { kind: "business" | "home" | "future"; label: string; sub: string; items: Area[]; accent: string };

const BG = {
  business: require("../../assets/images/wizard-bg-business.jpg"),
  home: require("../../assets/images/wizard-bg-home.jpg"),
  future: require("../../assets/images/wizard-bg-future.jpg"),
};
const META = {
  business: { label: "🟦 Aree Business", sub: "Accendi ciò che usi per lavoro.", accent: "#1D4ED8" },
  home: { label: "🟢 Aree Home", sub: "La tua vita privata, separata dal CRM.", accent: "#047857" },
  future: { label: "🚀 Interessi futuri", sub: "Non ancora disponibili: dimmi cosa ti interessa e ti avviso io.", accent: "#C2410C" },
};

function chunk<T>(arr: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

export function Step3Aree({ bind, sphere, initial, onNext, onSkipAll }: { bind: StepBinder; sphere: Sphere; initial?: Record<string, boolean>; onNext: () => void; onSkipAll: () => void }) {
  const [catalog, setCatalog] = useState<Area[] | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  // V50.z227 — area attivata con mini-wizard → si apre subito (max 3 passi)
  const [cfgAreas, setCfgAreas] = useState<Record<string, AreaCfg>>({});
  const [wiz, setWiz] = useState<AreaCfg | null>(null);
  useEffect(() => { api<{ areas: AreaCfg[] }>("/axon/areas/config").then((r) => setCfgAreas(Object.fromEntries(r.areas.map((a) => [a.key, a])))).catch(() => {}); }, []);
  const onToggle = (key: string, nv: boolean) => {
    setOn((s) => ({ ...s, [key]: nv }));
    const a = cfgAreas[key];
    if (nv && a?.wizard && a.status !== "complete") setWiz(a);
  };

  useEffect(() => {
    api<{ areas: Area[] }>(`/axon/setup/areas?sphere=${sphere}`).then((r) => {
      setCatalog(r.areas);
      const init: Record<string, boolean> = {};
      r.areas.forEach((a) => { init[a.key] = initial && a.key in initial ? !!initial[a.key] : a.default_on; });
      setOn(init);
    }).catch(() => { setCatalog([]); setError("Non riesco a caricare le aree: riprova tra poco."); });
  }, [sphere]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = useMemo<Page[]>(() => {
    if (!catalog) return [];
    const out: Page[] = [];
    const build = (kind: "business" | "home") => chunk(catalog.filter((a) => a.sphere === kind && !a.future), PER_PAGE).forEach((items) => out.push({ kind, items, ...META[kind] }));
    if (sphere === "business" || sphere === "both") build("business");
    if (sphere === "home" || sphere === "both") build("home");
    const fut = catalog.filter((a) => a.future);
    if (fut.length) out.push({ kind: "future", items: fut, ...META.future });
    return out;
  }, [catalog, sphere]);

  const submit = useCallback(async (): Promise<boolean> => {
    try { await api("/axon/setup/sphere-areas", { method: "PUT", body: { areas: on } }); return true; }
    catch (e: any) { setError(e?.message || "Salvataggio non riuscito"); return false; }
  }, [on]);
  useEffect(() => { bind(submit); }, [bind, submit]);

  if (!catalog) return <ActivityIndicator color={PURPLE} style={{ marginTop: 20 }} />;
  const cur = pages[page];
  if (!cur) return <Text style={styles.err}>{error || "Nessuna area disponibile."}</Text>;
  const last = page === pages.length - 1;
  const activeCount = Object.values(on).filter(Boolean).length;

  return (
    <View style={{ gap: 12 }} testID="step3-aree">
      <ImageBackground source={BG[cur.kind]} resizeMode="cover" style={styles.bg} imageStyle={styles.bgImg}>
        <LinearGradient colors={["rgba(255,255,255,0.35)", "rgba(255,255,255,0.88)", "rgba(255,255,255,0.97)"]} locations={[0, 0.45, 1]} style={styles.veil}>
          <View style={styles.pageHead}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pageLabel, { color: cur.accent }]}>{cur.label}</Text>
              <Text style={styles.pageSub}>{cur.sub}</Text>
            </View>
            <Text style={styles.pageIdx} testID="aree-page-idx">{page + 1}/{pages.length}</Text>
          </View>
          <Animated.View key={page} entering={FadeInRight.duration(300)} style={{ gap: 10 }}>
            {cur.items.map((a) => {
              const v = !!on[a.key];
              return (
                <View key={a.key} style={[styles.row, v && { borderColor: cur.accent }]} testID={`area-row-${a.key}`}>
                  <View style={[styles.rowIcon, { backgroundColor: v ? cur.accent : "#E2E8F0" }]}>
                    <Ionicons name={a.icon as any} size={22} color={v ? "#FFF" : "#64748B"} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{a.title}</Text>
                    <Text style={styles.rowDesc} numberOfLines={2}>{a.desc}</Text>
                    {a.future && <Text style={styles.futureTag}>Interesse futuro</Text>}
                    {v && !a.future && cfgAreas[a.key]?.wizard && (
                      <Pressable onPress={() => setWiz(cfgAreas[a.key])} style={styles.cfgBtn} testID={`area-configure-${a.key}`}>
                        <Ionicons name={cfgAreas[a.key].status === "complete" ? "checkmark-circle" : "alert-circle"} size={12} color={cfgAreas[a.key].status === "complete" ? "#16A34A" : "#B45309"} />
                        <Text style={[styles.cfgTxt, cfgAreas[a.key].status === "complete" && { color: "#16A34A" }]}>{cfgAreas[a.key].status === "complete" ? "Configurata" : "Configurazione incompleta · Configura"}</Text>
                      </Pressable>
                    )}
                  </View>
                  <Switch value={v} onValueChange={(nv) => onToggle(a.key, nv)} trackColor={{ true: cur.accent, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? "#FFF" : undefined} testID={`area-switch-${a.key}`} />
                </View>
              );
            })}
          </Animated.View>
        </LinearGradient>
      </ImageBackground>

      <View style={styles.dots}>{pages.map((_, i) => <View key={i} style={[styles.dot, i === page && { backgroundColor: PURPLE, width: 18 }]} />)}</View>
      {!!error && <Text style={styles.err}>{error}</Text>}

      <Pressable onPress={() => { setError(""); if (last) onNext(); else setPage((p) => p + 1); }} style={styles.okBtn} testID="aree-ok-next">
        <Text style={styles.okTxt}>OK, avanti</Text>
        <Ionicons name={last ? "checkmark" : "arrow-forward"} size={18} color="#FFF" />
      </Pressable>
      <View style={styles.secondaryRow}>
        {page > 0 ? <Pressable onPress={() => setPage((p) => p - 1)} style={styles.linkBtn} testID="aree-prev"><Ionicons name="arrow-back" size={14} color="#64748B" /><Text style={styles.linkTxt}>Indietro</Text></Pressable> : <View style={styles.linkBtn} />}
        <Text style={styles.count}>{activeCount} {activeCount === 1 ? "area attiva" : "aree attive"}</Text>
        <Pressable onPress={onSkipAll} style={styles.linkBtn} testID="aree-skip-all"><Text style={styles.linkTxt}>Salta tutto per ora</Text></Pressable>
      </View>
      <AreaMiniWizard area={wiz} visible={!!wiz} onClose={() => setWiz(null)} onDone={() => { api<{ areas: AreaCfg[] }>("/axon/areas/config").then((r) => setCfgAreas(Object.fromEntries(r.areas.map((a) => [a.key, a])))).catch(() => {}); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { borderRadius: 20, overflow: "hidden", minHeight: 320 },
  bgImg: { borderRadius: 20 },
  veil: { flex: 1, padding: 14, paddingTop: 56, gap: 12 },
  pageHead: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  pageLabel: { fontSize: 18, fontWeight: "900", textShadowColor: "rgba(255,255,255,0.9)", textShadowRadius: 6 },
  pageSub: { fontSize: 12.5, color: "#334155", fontWeight: "700", textShadowColor: "rgba(255,255,255,0.9)", textShadowRadius: 6 },
  pageIdx: { fontSize: 12, fontWeight: "800", color: "#475569", backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.97)", borderRadius: 16, padding: 12, minHeight: 68, borderWidth: 1.5, borderColor: "#E2E8F0" },
  rowIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "800", color: "#1B2B4B" },
  rowDesc: { fontSize: 12, color: "#64748B", lineHeight: 16 },
  cfgBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, alignSelf: "flex-start" },
  cfgTxt: { fontSize: 11, fontWeight: "800", color: "#B45309" },
  futureTag: { alignSelf: "flex-start", fontSize: 10, fontWeight: "800", color: "#C2410C", backgroundColor: "#FFF7ED", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DDD6FE" },
  okBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: PURPLE, borderRadius: 16, minHeight: 52 },
  okTxt: { color: "#FFF", fontWeight: "900", fontSize: 16 },
  secondaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, minWidth: 80, justifyContent: "center" },
  linkTxt: { color: "#64748B", fontWeight: "700", fontSize: 13.5 },
  count: { fontSize: 12, color: "#7C3AED", fontWeight: "800" },
  err: { fontSize: 12.5, color: "#DC2626", fontWeight: "700" },
});

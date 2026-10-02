// admin/wake-samples.tsx — V50.z398 — Pannello Super Master (/admin/wake-samples, raggiungibile dalla card «Addestramento wake-word»
// del pannello Master): TOTALE campioni in evidenza · parole/frasi da raccogliere (spunta/attiva, aggiungi, elimina; più wake-word
// attive insieme) · lista VISITATORI (sessioni anonime di /wake-training) con data/ora di accesso, n. campioni, stato
// Completato / Parziale / Solo visualizzato e ZIP per visitatore · ZIP totale. (V50.z390: prima solo statistiche aggregate.)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Platform, RefreshControl, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, getToken, BACKEND_URL } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { KScrollView } from "@/src/ui/keyboard";
import { WAKE_TRAINING_URL, shareWakeTrainingLink } from "@/src/wake/wakeLink";
import { HT } from "@/src/homeTheme";

type Word = { word: string; label: string; active: boolean };
type Config = { positive: Word[]; negative: Word[]; min_per_env: number; max_per_env: number };
type Stats = { total: number; total_bytes: number; positive: number; negative: number; words: { word: string; kind: string; total: number }[] };
type Session = { session_id: string; opened_at: string | null; last_seen: string | null; completed_at: string | null; platform: string | null; hits: number; total: number; positive: number; negative: number; bytes: number; environments: string[]; words: string[]; status: "completato" | "parziale" | "solo_visualizzato"; required: number };
type Sessions = { items: Session[]; required_per_session: number; total_samples: number; counts: Record<Session["status"], number> };

const STATUS: Record<Session["status"], { label: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = {
  completato: { label: "Completato", color: "#16A34A", icon: "checkmark-circle" },
  parziale: { label: "Parziale", color: "#F59E0B", icon: "time" },
  solo_visualizzato: { label: "Solo visualizzato", color: "#94A3B8", icon: "eye-outline" },
};
const fmtMb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const fmtDt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const slug = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]+/g, "").slice(0, 60);

export default function WakeSamplesAdmin() {
  const router = useRouter();
  const pad = usePageBottomPadding();
  const [st, setSt] = useState<Stats | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [sess, setSess] = useState<Sessions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newWord, setNewWord] = useState<{ positive: string; negative: string }>({ positive: "", negative: "" });
  const [filter, setFilter] = useState<"tutti" | Session["status"]>("tutti");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [a, b, c] = await Promise.all([api<Stats>("/wake-samples/stats"), api<Config>("/wake-samples/config"), api<Sessions>("/wake-samples/sessions")]);
      setSt(a); setCfg(b); setSess(c); setDirty(false);
    } catch (e: any) { setErr(e?.message || "Accesso riservato al Super Master"); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const download = async (q: Record<string, string> = {}) => {
    const k = JSON.stringify(q); setBusy(k);
    try {
      const token = await getToken();
      const qs = new URLSearchParams({ ...q, token: token || "" }).toString();
      const url = `${BACKEND_URL}/api/wake-samples/export.zip?${qs}`;
      if (Platform.OS === "web") { const a = document.createElement("a"); a.href = url; a.download = "axon-wake-samples.zip"; a.click(); } else await Linking.openURL(url);
    } catch (e: any) { notify(e?.message || "Download non riuscito"); } finally { setBusy(null); }
  };

  const wordTotal = (w: string) => st?.words.find((x) => x.word === w)?.total || 0;
  const setWords = (kind: "positive" | "negative", fn: (ws: Word[]) => Word[]) => { if (!cfg) return; setCfg({ ...cfg, [kind]: fn(cfg[kind]) }); setDirty(true); };
  const addWord = (kind: "positive" | "negative") => {
    const raw = newWord[kind].trim(); const w = slug(raw);
    if (!w) return;
    if (cfg?.[kind].some((x) => x.word === w)) { notify("Parola già presente"); return; }
    setWords(kind, (ws) => [...ws, { word: w, label: raw, active: true }]); setNewWord({ ...newWord, [kind]: "" });
  };
  const saveCfg = async () => {
    if (!cfg) return;
    if (!cfg.positive.some((w) => w.active)) { notify("Serve almeno una wake-word attiva"); return; }
    setBusy("cfg");
    try { setCfg(await api<Config>("/wake-samples/config", { method: "PUT", body: cfg })); setDirty(false); notify("Parole aggiornate: valgono da subito per i nuovi visitatori"); await load(); }
    catch (e: any) { notify(e?.message || "Salvataggio non riuscito"); } finally { setBusy(null); }
  };

  const items = (sess?.items || []).filter((x) => filter === "tutti" || x.status === filter);

  // funzione di render (NON componente interno: un componente ridefinito a ogni render smonterebbe la TextInput a ogni tasto)
  const wordList = (kind: "positive" | "negative", title: string, hint: string, color: string) => (
    <View style={s.card} testID={`wake-admin-words-${kind}`}>
      <Text style={s.cardHead}>{title}</Text>
      <Text style={s.meta}>{hint}</Text>
      {cfg![kind].map((w, i) => (
        <View key={w.word} style={s.wordRow} testID={`wake-admin-word-${w.word}`}>
          <Pressable onPress={() => setWords(kind, (ws) => ws.map((x, j) => (j === i ? { ...x, active: !x.active } : x)))} style={s.check} hitSlop={6} testID={`wake-admin-word-toggle-${w.word}`}>
            <Ionicons name={w.active ? "checkbox" : "square-outline"} size={24} color={w.active ? color : HT.muted} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[s.wordLbl, !w.active && { color: HT.muted, textDecorationLine: "line-through" }]}>{w.label}</Text>
            <Text style={s.meta}>{w.word} · {wordTotal(w.word)} campioni{w.active ? "" : " · non richiesta ai visitatori"}</Text>
          </View>
          <Pressable onPress={() => setWords(kind, (ws) => ws.filter((_, j) => j !== i))} style={s.check} hitSlop={6} testID={`wake-admin-word-del-${w.word}`}><Ionicons name="trash-outline" size={20} color={HT.danger} /></Pressable>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput value={newWord[kind]} onChangeText={(t) => setNewWord({ ...newWord, [kind]: t })} placeholder={kind === "positive" ? "Nuova parola o frase (es. Ehi Axon)" : "Nuova parola simile (es. Axel)"} placeholderTextColor={HT.muted} style={s.input} autoCapitalize="none" onSubmitEditing={() => addWord(kind)} returnKeyType="done" testID={`wake-admin-word-input-${kind}`} />
        <Pressable onPress={() => addWord(kind)} style={[s.addBtn, { backgroundColor: color }]} testID={`wake-admin-word-add-${kind}`}><Ionicons name="add" size={22} color="#FFF" /></Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="wake-admin-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Addestramento wake-word</Text><Text style={s.sub} numberOfLines={1}>Pannello Super Master · {WAKE_TRAINING_URL.replace(/^https?:\/\//, "")}</Text></View>
        <Pressable onPress={shareWakeTrainingLink} hitSlop={8} style={s.iconBtn} testID="wake-admin-share"><Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-social-outline"} size={20} color={HT.violet} /></Pressable>
        <Pressable onPress={() => Linking.openURL(WAKE_TRAINING_URL)} hitSlop={8} style={s.iconBtn} testID="wake-admin-open-page"><Ionicons name="open-outline" size={20} color={HT.violet} /></Pressable>
      </View>
      <KScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pad }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        {err ? <View style={s.card} testID="wake-admin-error"><Text style={s.err}>{err}</Text><Pressable onPress={load} style={s.btn}><Text style={s.btnTxt}>Riprova</Text></Pressable></View> : !st || !cfg || !sess ? <ActivityIndicator color={HT.violet} style={{ marginTop: 30 }} /> : (<>
          {/* TOTALE in evidenza */}
          <View style={s.hero} testID="wake-admin-totals">
            <Text style={s.heroN}>{sess.total_samples}</Text>
            <Text style={s.heroL}>campioni audio raccolti</Text>
            <Text style={s.heroMeta}>{st.positive} wake-word · {st.negative} simili · {fmtMb(st.total_bytes)} · {sess.items.length} visitatori</Text>
            <View style={s.heroRow}>
              {(Object.keys(STATUS) as Session["status"][]).map((k) => (
                <View key={k} style={s.heroStat} testID={`wake-admin-count-${k}`}><Ionicons name={STATUS[k].icon} size={14} color={STATUS[k].color} /><Text style={s.heroStatN}>{sess.counts[k] || 0}</Text><Text style={s.heroStatL}>{STATUS[k].label}</Text></View>
              ))}
            </View>
          </View>
          <Pressable onPress={() => download()} disabled={!!busy || !sess.total_samples} style={[s.btn, !sess.total_samples && { opacity: 0.5 }]} testID="wake-admin-download-all">{busy === "{}" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="download" size={18} color="#FFF" /><Text style={s.btnTxt}>Scarica tutti i campioni (ZIP + manifest.csv)</Text></>}</Pressable>

          {/* PAROLE / FRASI */}
          {wordList("positive", "Wake-word da raccogliere", "Spunta le parole o frasi attive: il visitatore le registra tutte, in ogni ambiente. Puoi lasciarne anche una sola.", "#16A34A")}
          {wordList("negative", "Parole simili (campioni negativi)", "Parole che assomigliano alla wake-word: servono ad Axon per non confondersi.", "#F59E0B")}
          <View style={s.card}>
            <Text style={s.cardHead}>Minimo per ambiente</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable onPress={() => { setCfg({ ...cfg, min_per_env: Math.max(1, cfg.min_per_env - 1) }); setDirty(true); }} style={s.stepBtn} testID="wake-admin-min-dec"><Ionicons name="remove" size={20} color={HT.text} /></Pressable>
              <Text style={s.stepN} testID="wake-admin-min">{cfg.min_per_env}</Text>
              <Pressable onPress={() => { setCfg({ ...cfg, min_per_env: Math.min(200, cfg.min_per_env + 1) }); setDirty(true); }} style={s.stepBtn} testID="wake-admin-min-inc"><Ionicons name="add" size={20} color={HT.text} /></Pressable>
              <Text style={[s.meta, { flex: 1 }]}>registrazioni per parola in ogni ambiente · «Completato» = {sess.required_per_session} campioni wake-word (o percorso finito)</Text>
            </View>
          </View>
          {dirty ? <Pressable onPress={saveCfg} disabled={busy === "cfg"} style={[s.btn, { backgroundColor: "#16A34A" }]} testID="wake-admin-save-config">{busy === "cfg" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="save" size={18} color="#FFF" /><Text style={s.btnTxt}>Salva parole e impostazioni</Text></>}</Pressable> : null}

          {/* VISITATORI */}
          <View style={s.card} testID="wake-admin-sessions">
            <Text style={s.cardHead}>Visitatori di /wake-training</Text>
            <Text style={s.meta}>Pagina pubblica anonima: ogni riga è una sessione del browser/telefono (nessun dato personale). Ora locale.</Text>
            <View style={s.filters}>
              {(["tutti", "completato", "parziale", "solo_visualizzato"] as const).map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[s.chip, filter === f && s.chipOn]} testID={`wake-admin-filter-${f}`}><Text style={[s.chipTxt, filter === f && { color: "#FFF" }]}>{f === "tutti" ? `Tutti (${sess.items.length})` : `${STATUS[f].label} (${sess.counts[f] || 0})`}</Text></Pressable>
              ))}
            </View>
            {!items.length ? <Text style={[s.meta, { textAlign: "center", paddingVertical: 12 }]}>Nessun visitatore{filter !== "tutti" ? " con questo stato" : " ancora: condividi il link"}</Text> : items.map((x) => (
              <View key={x.session_id} style={s.sessRow} testID={`wake-admin-session-${x.session_id}`}>
                <View style={[s.statusDot, { backgroundColor: STATUS[x.status].color }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.sessDt}>{fmtDt(x.opened_at)}</Text>
                    <View style={[s.badge, { backgroundColor: STATUS[x.status].color + "22" }]}><Text style={[s.badgeTxt, { color: STATUS[x.status].color }]}>{STATUS[x.status].label}</Text></View>
                  </View>
                  <Text style={s.sessMeta}>{x.total} campioni ({x.positive} wake-word · {x.negative} simili) · {x.environments.length} ambienti{x.platform ? ` · ${x.platform}` : ""}{x.completed_at ? ` · finito ${fmtDt(x.completed_at)}` : x.last_seen && x.last_seen !== x.opened_at ? ` · ultimo ${fmtDt(x.last_seen)}` : ""}</Text>
                  <Text style={s.sessId}>ID {x.session_id}</Text>
                </View>
                <Pressable onPress={() => download({ session_id: x.session_id })} disabled={!!busy || !x.total} style={[s.zipBtn, !x.total && { opacity: 0.35 }]} testID={`wake-admin-zip-${x.session_id}`}>
                  {busy === JSON.stringify({ session_id: x.session_id }) ? <ActivityIndicator color={HT.violet} size="small" /> : <><Ionicons name="download-outline" size={18} color={HT.violet} /><Text style={s.zipTxt}>ZIP</Text></>}
                </Pressable>
              </View>
            ))}
          </View>
        </>)}
      </KScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 16, fontWeight: "900", color: HT.text }, sub: { fontSize: 11, color: HT.muted }, iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  hero: { backgroundColor: HT.violet, borderRadius: 20, padding: 18, alignItems: "center", gap: 2 }, heroN: { fontSize: 48, fontWeight: "900", color: "#FFF", lineHeight: 54 }, heroL: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  heroMeta: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 }, heroRow: { flexDirection: "row", gap: 8, marginTop: 12, alignSelf: "stretch" },
  heroStat: { flex: 1, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 12, padding: 8, alignItems: "center", gap: 2 }, heroStatN: { color: "#FFF", fontWeight: "900", fontSize: 18 }, heroStatL: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: "700", textAlign: "center" },
  meta: { fontSize: 11, color: HT.muted, lineHeight: 15 }, err: { color: HT.danger, fontWeight: "700" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: HT.violet, paddingHorizontal: 14 }, btnTxt: { color: "#FFF", fontWeight: "800" },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 }, cardHead: { fontSize: 13, fontWeight: "900", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  wordRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderBottomWidth: 1, borderBottomColor: HT.border, paddingBottom: 6 }, wordLbl: { color: HT.text, fontWeight: "800", fontSize: 15 },
  check: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, color: HT.text, paddingHorizontal: 12, fontSize: 15 },
  addBtn: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 }, stepN: { width: 40, textAlign: "center", fontSize: 20, fontWeight: "900", color: HT.text },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { minHeight: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", backgroundColor: HT.card2 }, chipOn: { backgroundColor: HT.violet, borderColor: HT.violet }, chipTxt: { color: HT.text, fontWeight: "800", fontSize: 12 },
  sessRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border }, statusDot: { width: 10, height: 10, borderRadius: 5 },
  sessDt: { color: HT.text, fontWeight: "900", fontSize: 14 }, sessMeta: { color: HT.text, fontSize: 12 }, sessId: { color: HT.muted, fontSize: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }, badgeTxt: { fontSize: 10, fontWeight: "900" },
  zipBtn: { minWidth: 56, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4, paddingHorizontal: 8 }, zipTxt: { color: HT.violet, fontWeight: "900", fontSize: 12 },
});

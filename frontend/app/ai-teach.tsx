/**
 * V28.g — "Insegna ad Axon" (Master-only)
 * - Regole manuali organizzate per categoria libera (es. Clienti, Contratti, Comunicazioni…)
 * - Elenco illimitato di URL: indirizzo + descrizione + credenziali (opz.) + frequenza (manuale/giornaliera/settimanale/mensile)
 * - Pulsante "Aggiorna ora" globale per forzare il fetch di tutti gli URL via Tavily
 * Il contenuto viene usato da Axon come contesto prioritario durante l'analisi.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { AxonOSLogo } from "@/src/BrandLogos";
import { notify } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";
import * as FileSystem from "expo-file-system/legacy";

type Rule = { rule_id: string; category?: string; categories?: string[]; title: string; text: string; files: { name: string; mime: string; size: number }[]; updated_at?: string };
type UrlItem = { url_id: string; url: string; name: string; category?: string; frequency: "manual" | "daily" | "weekly" | "monthly"; username?: string; password_masked?: boolean; last_fetched_at?: string; last_summary?: string; last_error?: string };
// V28.j — Storico aggiornamenti (elenco esecuzioni di "Aggiorna ora" automatico o manuale)
type HistoryRunEntry = { url_id: string; name: string; url: string; error?: string };
type HistoryRun = {
  run_id: string;
  started_at: string;
  mode: "manual_all" | "manual_single" | "automatic";
  total: number;
  success_count: number;
  failure_count: number;
  successes: HistoryRunEntry[];
  failures: HistoryRunEntry[];
};

// Categorie preset suggerite — l'utente può digitarne anche di nuove.
const PRESET_CATEGORIES = ["Clienti", "Contratti", "Comunicazioni", "Vendita", "Luce", "Gas", "Telco", "Generale"];

const FREQ_LABEL: Record<string, string> = {
  manual: "Manuale",
  daily: "Giornaliera",
  weekly: "Settimanale",
  monthly: "Mensile",
};
const FREQ_ORDER: ("manual" | "daily" | "weekly" | "monthly")[] = ["manual", "daily", "weekly", "monthly"];
const C = { primary: "#FF6B35", primarySoft: "#FFF1E9", navy: "#1B2B4B", muted: "#94A3B8" };

// Deterministic color per category (stable hashing on the label)
function colorFor(category: string): string {
  const palette = ["#F59E0B", "#3B82F6", "#7C3AED", "#0F766E", "#DB2777", "#EA580C", "#0891B2", "#65A30D", "#DC2626", "#4F46E5"];
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// V28.n — Normalize a rule's categories: prefer `categories` array, fallback to legacy `category`.
function normalizeRuleCategories(r: Partial<Rule> | null | undefined): string[] {
  if (!r) return [];
  const raw = Array.isArray(r.categories) && r.categories.length
    ? r.categories
    : (r.category ? [r.category] : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    const key = (c || "").trim();
    if (!key) continue;
    const lk = key.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(key);
  }
  return out;
}

export default function AiTeachScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [tab, setTab] = useState<"rules" | "urls" | "history">("rules");
  const [filter, setFilter] = useState<string>("all");
  const [rules, setRules] = useState<Rule[]>([]);
  const [urls, setUrls] = useState<UrlItem[]>([]);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRule, setEditRule] = useState<Partial<Rule> | null>(null);
  const [editUrl, setEditUrl] = useState<Partial<UrlItem> | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  // V28.j — Info modal per tab (Regole / Fonti URL / Storico)
  const [infoTab, setInfoTab] = useState<null | "rules" | "urls" | "history">(null);

  const load = useCallback(async () => {
    if (!isMaster) return;
    try {
      setLoading(true);
      const [r, u, h] = await Promise.all([
        api<{ items: Rule[] }>("/ai-teach/rules"),
        api<{ items: UrlItem[] }>("/ai-teach/urls"),
        api<{ items: HistoryRun[] }>("/ai-teach/refresh-history").catch(() => ({ items: [] })),
      ]);
      setRules(r.items || []);
      setUrls(u.items || []);
      setHistory(h.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare i dati");
    } finally { setLoading(false); }
  }, [isMaster]);

  // Se la schermata è già in focus quando `useAuth` popola l'utente e lo promuove
  // a Master, `useFocusEffect` sotto NON re-fira automaticamente (la schermata è
  // già focused). Questo useEffect additivo garantisce che il fetch parta appena
  // `isMaster` diventa true. V29.at — Fix regressione "Insegna ad Axon vuoto".
  useEffect(() => {
    if (isMaster) load();
  }, [isMaster, load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // V28.n — Multi-category: raccogliamo TUTTE le categorie usate su TUTTE le regole.
  const availableCategories = useMemo(() => {
    const s = new Set<string>();
    rules.forEach((r) => {
      const cats = normalizeRuleCategories(r);
      if (cats.length === 0) s.add("Generale");
      else cats.forEach((c) => s.add(c));
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rules]);

  // V28.n — Una regola compare nel filtro se AL MENO UNA delle sue categorie combacia.
  const filteredRules = useMemo(
    () => (filter === "all"
      ? rules
      : rules.filter((r) => {
          const cats = normalizeRuleCategories(r);
          const list = cats.length ? cats : ["Generale"];
          return list.some((c) => c.toLowerCase() === filter.toLowerCase());
        })),
    [rules, filter],
  );

  const saveRule = async () => {
    if (!editRule) return;
    try {
      setBusy(true);
      // V28.n — Multi-category: normalizziamo l'array e lo passiamo come `categories`.
      // Il backend salva sia `categories` che `category` (prima categoria) per retrocompat.
      const cats = normalizeRuleCategories(editRule);
      const finalCats = cats.length ? cats : ["Generale"];
      const payload: any = {
        categories: finalCats,
        category: finalCats[0], // backward-compat
        title: (editRule.title || "").trim(),
        text: (editRule.text || "").trim(),
      };
      if ((editRule as any)._pendingFiles?.length) payload.files = (editRule as any)._pendingFiles;
      if (!payload.title || !payload.text) { notify("Dati mancanti", "Titolo e testo obbligatori"); setBusy(false); return; }
      if (editRule.rule_id) {
        await api(`/ai-teach/rules/${editRule.rule_id}`, { method: "PUT", body: payload });
      } else {
        payload.files = payload.files || [];
        await api("/ai-teach/rules", { method: "POST", body: payload });
      }
      setEditRule(null);
      load();
    } catch (e: any) { notify("Errore salvataggio", e?.message || ""); } finally { setBusy(false); }
  };

  // V28.n — Toggle di una categoria nel selettore multi-chip.
  const toggleEditCategory = useCallback((cat: string) => {
    setEditRule((r) => {
      const current = normalizeRuleCategories(r);
      const lk = cat.toLowerCase();
      const has = current.some((c) => c.toLowerCase() === lk);
      const next = has
        ? current.filter((c) => c.toLowerCase() !== lk)
        : [...current, cat];
      return { ...(r || {}), categories: next, category: next[0] } as Partial<Rule>;
    });
  }, []);

  // V28.n — Aggiungere una categoria custom digitata dall'utente.
  const [customCatInput, setCustomCatInput] = useState<string>("");
  const addCustomCategory = useCallback(() => {
    const val = customCatInput.trim();
    if (!val) return;
    toggleEditCategory(val);
    setCustomCatInput("");
  }, [customCatInput, toggleEditCategory]);

  const removeRule = async (id: string) => {
    try { await api(`/ai-teach/rules/${id}`, { method: "DELETE" }); load(); } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  // V28.l — Ora accetta QUALSIASI file (PDF, Excel, immagini, txt, csv…). Il file
  // viene letto in base64 tramite FileSystem/fetch e allegato alla regola.
  const attachPdf = async () => {
    const { asset, error, base64 } = await pickCommonFile({ multiple: false });
    if (error || !asset) { if (error) notify("Errore", error); return; }
    let b64 = base64 || (asset as { _base64?: string })._base64 || "";
    // Native (iOS/Android): read the file URI via expo-file-system as base64
    if (!b64 && asset.uri) {
      try {
        if (asset.uri.startsWith("data:")) {
          const comma = asset.uri.indexOf(",");
          if (comma > 0) b64 = asset.uri.slice(comma + 1);
        } else if (Platform.OS === "web") {
          const resp = await fetch(asset.uri);
          const blob = await resp.blob();
          b64 = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onerror = () => rej(new Error("FileReader error"));
            r.onload = () => {
              const s = String(r.result || "");
              const c = s.indexOf(",");
              res(c >= 0 ? s.slice(c + 1) : s);
            };
            r.readAsDataURL(blob);
          });
        } else {
          b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        }
      } catch (e: any) {
        notify("Errore lettura file", e?.message || String(e));
        return;
      }
    }
    if (!b64) { notify("Errore", "Impossibile leggere il file"); return; }
    setEditRule((r) => ({
      ...(r || {}),
      _pendingFiles: [...(((r as { _pendingFiles?: unknown[] } | null)?._pendingFiles) || []), { name: asset.name, mime: asset.mimeType || "application/octet-stream", data_base64: b64 }],
    } as Partial<Rule>));
  };

  const saveUrl = async () => {
    if (!editUrl) return;
    try {
      setBusy(true);
      const payload: any = {
        url: (editUrl.url || "").trim(),
        name: (editUrl.name || "").trim(),
        category: (editUrl.category || "generic").trim() || "generic",
        frequency: editUrl.frequency || "weekly",
      };
      if (editUrl.username) payload.username = editUrl.username;
      if ((editUrl as any).password) payload.password = (editUrl as any).password;
      if (!payload.url || !payload.name) { notify("Dati mancanti", "URL e nome obbligatori"); setBusy(false); return; }
      if (editUrl.url_id) {
        await api(`/ai-teach/urls/${editUrl.url_id}`, { method: "PUT", body: payload });
      } else {
        await api("/ai-teach/urls", { method: "POST", body: payload });
      }
      setEditUrl(null);
      load();
    } catch (e: any) { notify("Errore salvataggio", e?.message || ""); } finally { setBusy(false); }
  };

  const removeUrl = async (id: string) => {
    try { await api(`/ai-teach/urls/${id}`, { method: "DELETE" }); load(); } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const refreshUrl = async (id: string) => {
    try { await api(`/ai-teach/urls/${id}/refresh`, { method: "POST" }); notify("Aggiornato ✅", "Contenuto scaricato via Tavily"); load(); } catch (e: any) { notify("Errore refresh", e?.message || ""); }
  };

  // V28.g/j — Force refresh of ALL URLs at once + emit notification with details
  const refreshAll = async () => {
    if (urls.length === 0) { notify("Nessun URL", "Aggiungi prima almeno un URL da monitorare"); return; }
    try {
      setRefreshingAll(true);
      const res = await api<{ total: number; success: number; errors: string[] }>("/ai-teach/urls/refresh-all", { method: "POST" });
      // V28.j — In-app notification con dettagli sommari; lo storico completo è nel tab dedicato
      const when = new Date().toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      const parts: string[] = [`${res.success}/${res.total} URL aggiornati`];
      if (res.errors?.length) parts.push(`${res.errors.length} falliti`);
      notify(`Axon: aggiornamento ${when}`, parts.join(" · ") + (res.errors?.length ? `\n${res.errors.slice(0, 3).join("\n")}` : ""));
      load();
    } catch (e: any) { notify("Errore aggiornamento", e?.message || ""); } finally { setRefreshingAll(false); }
  };

  // V28.j — Info strings shown when the ℹ️ next to a tab is tapped
  const TAB_INFO: Record<string, { title: string; body: string }> = {
    rules: {
      title: "Regole manuali",
      body: "Insegna ad Axon come deve comportarsi. Aggiungi regole libere organizzate per categoria (es. Clienti, Contratti, Vendita). Ogni regola ha un titolo e un testo — verranno usate come contesto PRIORITARIO nelle risposte e nelle analisi. Puoi allegare PDF per esempi concreti (contratti, procedure). Le categorie sono libere: digitane una nuova o usa i preset.",
    },
    urls: {
      title: "Fonti URL monitorate",
      body: "Aggiungi siti web da cui Axon apprende automaticamente (es. arera.it, gse.it, siti del tuo settore). Per siti protetti da login inserisci username e password. Scegli la frequenza di aggiornamento: Manuale (solo quando premi Aggiorna ora), Giornaliera, Settimanale o Mensile. I contenuti vengono estratti tramite Tavily e passati ad Axon come contesto secondario.",
    },
    history: {
      title: "Storico aggiornamenti",
      body: "Elenco cronologico di tutte le esecuzioni di aggiornamento URL — manuali (con Aggiorna ora) e automatiche (in base alla frequenza). Per ogni esecuzione vedi data/ora, quali URL sono stati aggiornati con successo e quali hanno fallito (con motivo dell'errore).",
    },
  };

  // V29.at — Distinguere tra "utente non ancora caricato" e "utente non-master".
  // Prima il codice mostrava "Sezione riservata al Master" quando user era ancora
  // null durante la rehydration del token, facendo credere all'utente Master che
  // la sezione fosse vuota. Ora se user===null mostriamo uno spinner e aspettiamo.
  if (!user) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
          <Text style={styles.title}>Insegna ad Axon</Text><View style={{ width: 26 }} />
        </View>
        <View style={{ padding: 40, alignItems: "center", gap: 10 }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.muted }}>Caricamento…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isMaster) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={C.navy} /></Pressable>
          <Text style={styles.title}>Insegna ad Axon</Text><View style={{ width: 26 }} />
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
          <Text style={styles.title}>Insegna ad Axon</Text>
          <Text style={styles.sub}>Regole e fonti che Axon usa come contesto prioritario</Text>
        </View>
        <AxonOSLogo size={36} testID="ai-teach-logo" />
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        <Pressable testID="tab-rules" onPress={() => setTab("rules")} style={[styles.tabBtn, tab === "rules" && styles.tabBtnOn]}>
          <Ionicons name="book" size={16} color={tab === "rules" ? "#FFF" : C.navy} />
          <Text style={[styles.tabTxt, tab === "rules" && { color: "#FFF" }]}>Regole ({rules.length})</Text>
          <Pressable testID="info-tab-rules" onPress={() => setInfoTab("rules")} hitSlop={10} style={styles.infoBtn}>
            <Ionicons name="information-circle" size={16} color={tab === "rules" ? "#FFF" : C.primary} />
          </Pressable>
        </Pressable>
        <Pressable testID="tab-urls" onPress={() => setTab("urls")} style={[styles.tabBtn, tab === "urls" && styles.tabBtnOn]}>
          <Ionicons name="globe" size={16} color={tab === "urls" ? "#FFF" : C.navy} />
          <Text style={[styles.tabTxt, tab === "urls" && { color: "#FFF" }]}>Fonti URL ({urls.length})</Text>
          <Pressable testID="info-tab-urls" onPress={() => setInfoTab("urls")} hitSlop={10} style={styles.infoBtn}>
            <Ionicons name="information-circle" size={16} color={tab === "urls" ? "#FFF" : C.primary} />
          </Pressable>
        </Pressable>
        <Pressable testID="tab-history" onPress={() => setTab("history")} style={[styles.tabBtn, tab === "history" && styles.tabBtnOn]}>
          <Ionicons name="time" size={16} color={tab === "history" ? "#FFF" : C.navy} />
          <Text style={[styles.tabTxt, tab === "history" && { color: "#FFF" }]}>Storico ({history.length})</Text>
          <Pressable testID="info-tab-history" onPress={() => setInfoTab("history")} hitSlop={10} style={styles.infoBtn}>
            <Ionicons name="information-circle" size={16} color={tab === "history" ? "#FFF" : C.primary} />
          </Pressable>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 24 }} color={C.primary} /> : (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180, gap: 10 }}>
        {tab === "rules" && (
          <>
            {/* V28.g — Dynamic category filter */}
            {availableCategories.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {["all", ...availableCategories].map((c) => {
                  const on = filter === c;
                  const label = c === "all" ? "Tutte" : c;
                  const col = c === "all" ? C.navy : colorFor(c);
                  return (
                    <Pressable key={c} testID={`filter-${c}`} onPress={() => setFilter(c)} style={[styles.chip, { borderColor: col }, on && { backgroundColor: col }]}>
                      <Ionicons name={c === "all" ? "layers" : "pricetag"} size={12} color={on ? "#FFF" : col} />
                      <Text style={[styles.chipTxt, on ? { color: "#FFF" } : { color: col }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            <Pressable testID="add-rule-btn" onPress={() => setEditRule({ categories: filter !== "all" ? [filter] : ["Generale"], category: filter !== "all" ? filter : "Generale", title: "", text: "" })} style={styles.addBtn}>
              <Ionicons name="add-circle" size={20} color="#FFF" />
              <Text style={styles.addBtnTxt}>Aggiungi regola</Text>
            </Pressable>
            {filteredRules.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTxt}>Nessuna regola. Aggiungi la prima per iniziare a insegnare ad Axon.</Text></View>
            ) : filteredRules.map((r) => {
              const catList = normalizeRuleCategories(r);
              const displayCats = catList.length ? catList : ["Generale"];
              return (
                <View key={r.rule_id} style={styles.card} testID={`rule-${r.rule_id}`}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <View style={styles.catBadgeWrap}>
                      {displayCats.map((cat) => (
                        <View key={cat} style={[styles.catBadge, { backgroundColor: colorFor(cat) }]}>
                          <Ionicons name="pricetag" size={11} color="#FFF" />
                          <Text style={styles.catBadgeTxt}>{cat}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={2}>{r.title}</Text>
                    <Pressable testID={`edit-rule-${r.rule_id}`} onPress={() => setEditRule({ ...r, categories: catList.length ? catList : ["Generale"] })} hitSlop={8}><Ionicons name="pencil" size={16} color={C.primary} /></Pressable>
                    <Pressable testID={`del-rule-${r.rule_id}`} onPress={() => removeRule(r.rule_id)} hitSlop={8}><Ionicons name="trash-outline" size={16} color="#DC2626" /></Pressable>
                  </View>
                  <Text style={styles.cardTxt} numberOfLines={4}>{r.text}</Text>
                  {r.files?.length ? (
                    <View style={styles.filesRow}>
                      {r.files.map((f, i) => (
                        <View key={i} style={styles.fileTag}>
                          <Ionicons name="document" size={11} color="#DC2626" />
                          <Text style={styles.fileTagTxt} numberOfLines={1}>{f.name}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        )}

        {tab === "urls" && (
          <>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="add-url-btn" onPress={() => setEditUrl({ url: "", name: "", category: "generic", frequency: "weekly" })} style={[styles.addBtn, { flex: 1 }]}>
                <Ionicons name="add-circle" size={20} color="#FFF" />
                <Text style={styles.addBtnTxt}>Aggiungi URL</Text>
              </Pressable>
              <Pressable testID="refresh-all-btn" onPress={refreshAll} disabled={refreshingAll || urls.length === 0} style={[styles.refreshAllBtn, (refreshingAll || urls.length === 0) && { opacity: 0.5 }]}>
                {refreshingAll ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="refresh" size={18} color="#FFF" />}
                <Text style={styles.addBtnTxt}>{refreshingAll ? "Aggiorno…" : "Aggiorna ora"}</Text>
              </Pressable>
            </View>
            {urls.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTxt}>Nessun URL monitorato. Aggiungi siti (es. arera.it, gse.it) e Axon li leggerà come fonte.</Text></View>
            ) : urls.map((u) => (
              <View key={u.url_id} style={styles.card} testID={`url-${u.url_id}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="globe" size={16} color={C.navy} />
                  <Text style={styles.cardTitle} numberOfLines={1}>{u.name}</Text>
                  <View style={styles.freqPill}><Text style={styles.freqPillTxt}>{FREQ_LABEL[u.frequency] || u.frequency}</Text></View>
                  <Pressable testID={`refresh-url-${u.url_id}`} onPress={() => refreshUrl(u.url_id)} hitSlop={8}><Ionicons name="refresh" size={16} color={C.primary} /></Pressable>
                  <Pressable testID={`edit-url-${u.url_id}`} onPress={() => setEditUrl({ ...u })} hitSlop={8}><Ionicons name="pencil" size={16} color={C.primary} /></Pressable>
                  <Pressable testID={`del-url-${u.url_id}`} onPress={() => removeUrl(u.url_id)} hitSlop={8}><Ionicons name="trash-outline" size={16} color="#DC2626" /></Pressable>
                </View>
                <Text style={styles.cardTxt} numberOfLines={1}>{u.url}</Text>
                {u.last_fetched_at ? (
                  <Text style={styles.metaTxt}>Ultimo aggiornamento: {new Date(u.last_fetched_at).toLocaleString("it-IT")}</Text>
                ) : (
                  <Text style={styles.metaTxt}>Mai aggiornato — tocca ↻ o &quot;Aggiorna ora&quot;</Text>
                )}
                {u.last_error ? <Text style={[styles.metaTxt, { color: "#DC2626" }]}>Errore: {u.last_error}</Text> : null}
                {u.username ? <Text style={styles.metaTxt}>🔐 Login: {u.username} {u.password_masked ? "•••" : ""}</Text> : null}
                {u.last_summary ? <Text style={styles.summaryTxt} numberOfLines={3}>{u.last_summary}</Text> : null}
              </View>
            ))}
          </>
        )}

        {tab === "history" && (
          <>
            {history.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTxt}>Nessun aggiornamento ancora eseguito. Vai su Fonti URL e tocca &quot;Aggiorna ora&quot; per la prima esecuzione.</Text></View>
            ) : history.map((h) => {
              const when = new Date(h.started_at).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
              const modeLabel = h.mode === "manual_all" ? "Aggiorna ora" : h.mode === "manual_single" ? "Refresh singolo" : "Automatico";
              const modeIcon: keyof typeof Ionicons.glyphMap = h.mode === "automatic" ? "sync" : "refresh";
              const allOk = h.failure_count === 0;
              return (
                <View key={h.run_id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: allOk ? "#16A34A" : "#DC2626" }]} testID={`history-${h.run_id}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name={modeIcon} size={16} color={C.navy} />
                    <Text style={styles.cardTitle} numberOfLines={1}>{modeLabel}</Text>
                    <View style={[styles.freqPill, allOk ? { backgroundColor: "#DCFCE7" } : { backgroundColor: "#FEE2E2" }]}>
                      <Text style={[styles.freqPillTxt, { color: allOk ? "#166534" : "#DC2626" }]}>
                        {h.success_count}/{h.total} OK
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.metaTxt}>🕒 {when}</Text>
                  {h.successes?.length ? (
                    <View style={styles.historyGroup}>
                      <Text style={styles.historyGroupTitle}>✓ Aggiornati con successo ({h.successes.length})</Text>
                      {h.successes.slice(0, 5).map((s) => (
                        <Text key={s.url_id} style={styles.historyItemOk} numberOfLines={1}>• {s.name || s.url}</Text>
                      ))}
                      {h.successes.length > 5 ? <Text style={styles.metaTxt}>… e altri {h.successes.length - 5}</Text> : null}
                    </View>
                  ) : null}
                  {h.failures?.length ? (
                    <View style={styles.historyGroup}>
                      <Text style={[styles.historyGroupTitle, { color: "#DC2626" }]}>✗ Falliti ({h.failures.length})</Text>
                      {h.failures.slice(0, 5).map((f) => (
                        <View key={f.url_id}>
                          <Text style={styles.historyItemErr} numberOfLines={1}>• {f.name || f.url}</Text>
                          {f.error ? <Text style={styles.historyErrMsg} numberOfLines={2}>{f.error}</Text> : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      )}

      {/* Rule editor modal */}
      <Modal transparent visible={!!editRule} animationType="slide" onRequestClose={() => setEditRule(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>{editRule?.rule_id ? "Modifica regola" : "Nuova regola"}</Text>
              <Pressable onPress={() => setEditRule(null)} hitSlop={10}><Ionicons name="close" size={22} color={C.navy} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.lbl}>Categorie (seleziona una o più)</Text>
              {/* V28.n — Chip presenti (selezionate) mostrate in alto, con X per rimuoverle. */}
              {(() => {
                const selected = normalizeRuleCategories(editRule);
                if (selected.length === 0) {
                  return <Text style={styles.metaTxt} testID="rule-selected-cats-empty">Nessuna categoria selezionata — verrà usata &quot;Generale&quot;</Text>;
                }
                return (
                  <View style={styles.selectedCatsRow} testID="rule-selected-cats">
                    {selected.map((c) => (
                      <Pressable key={c} testID={`selected-cat-${c}`} onPress={() => toggleEditCategory(c)} style={[styles.selectedCatChip, { backgroundColor: colorFor(c) }]}>
                        <Ionicons name="pricetag" size={11} color="#FFF" />
                        <Text style={styles.selectedCatTxt}>{c}</Text>
                        <Ionicons name="close-circle" size={14} color="rgba(255,255,255,0.85)" />
                      </Pressable>
                    ))}
                  </View>
                );
              })()}
              {/* Preset chips: tap to toggle */}
              <Text style={[styles.lbl, { marginTop: 10 }]}>Preset</Text>
              <View style={styles.presetRow}>
                {PRESET_CATEGORIES.map((c) => {
                  const selected = normalizeRuleCategories(editRule);
                  const on = selected.some((s) => s.toLowerCase() === c.toLowerCase());
                  const col = colorFor(c);
                  return (
                    <Pressable key={c} testID={`preset-cat-${c}`} onPress={() => toggleEditCategory(c)} style={[styles.chip, { borderColor: col }, on && { backgroundColor: col }]}>
                      {on ? <Ionicons name="checkmark" size={12} color="#FFF" /> : null}
                      <Text style={[styles.chipTxt, on ? { color: "#FFF" } : { color: col }]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {/* Custom category input */}
              <Text style={[styles.lbl, { marginTop: 10 }]}>Aggiungi categoria personalizzata</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput
                  testID="rule-custom-cat-input"
                  value={customCatInput}
                  onChangeText={setCustomCatInput}
                  onSubmitEditing={addCustomCategory}
                  returnKeyType="done"
                  placeholder="Es. Backoffice, Fibra…"
                  placeholderTextColor="#94A3B8"
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                />
                <Pressable testID="rule-add-custom-cat" onPress={addCustomCategory} style={styles.addCatBtn}>
                  <Ionicons name="add" size={20} color="#FFF" />
                </Pressable>
              </View>

              <Text style={styles.lbl}>Titolo</Text>
              <TextInput testID="rule-title-input" value={editRule?.title || ""} onChangeText={(t) => setEditRule((r) => ({ ...(r || {}), title: t }))} placeholder="Es. Procedura acquisizione nuovi clienti" placeholderTextColor="#94A3B8" style={styles.input} />
              <Text style={styles.lbl}>Testo della regola</Text>
              <TextInput testID="rule-text-input" value={editRule?.text || ""} onChangeText={(t) => setEditRule((r) => ({ ...(r || {}), text: t }))} multiline placeholder="Descrivi la regola in modo dettagliato…" placeholderTextColor="#94A3B8" style={[styles.input, { minHeight: 130, textAlignVertical: "top" }]} />
              <Pressable onPress={attachPdf} style={styles.pdfBtn}><Ionicons name="attach" size={17} color={C.navy} /><Text style={styles.pdfBtnTxt}>Allega file (PDF, Excel, immagine…)</Text></Pressable>
              {(editRule as any)?._pendingFiles?.length ? (
                <Text style={styles.metaTxt}>Nuovi allegati: {(editRule as any)._pendingFiles.length}</Text>
              ) : editRule?.files?.length ? (
                <Text style={styles.metaTxt}>Allegati esistenti: {editRule.files.length} (non modificati)</Text>
              ) : null}
              <Pressable onPress={saveRule} disabled={busy} style={[styles.saveBtn, { backgroundColor: busy ? C.muted : C.primary }]} testID="save-rule">
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Salva regola</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* URL editor modal */}
      <Modal transparent visible={!!editUrl} animationType="slide" onRequestClose={() => setEditUrl(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>{editUrl?.url_id ? "Modifica URL" : "Nuovo URL da monitorare"}</Text>
              <Pressable onPress={() => setEditUrl(null)} hitSlop={10}><Ionicons name="close" size={22} color={C.navy} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.lbl}>Nome / descrizione</Text>
              <TextInput testID="url-name-input" value={editUrl?.name || ""} onChangeText={(t) => setEditUrl((u) => ({ ...(u || {}), name: t }))} placeholder="Es. ARERA - Bollette luce" placeholderTextColor="#94A3B8" style={styles.input} />
              <Text style={styles.lbl}>Indirizzo web</Text>
              <TextInput testID="url-input" value={editUrl?.url || ""} onChangeText={(t) => setEditUrl((u) => ({ ...(u || {}), url: t }))} placeholder="https://www.arera.it/…" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" />

              <Text style={styles.lbl}>Frequenza di aggiornamento</Text>
              <View style={styles.catRow}>
                {FREQ_ORDER.map((f) => {
                  const on = (editUrl?.frequency || "weekly") === f;
                  return (
                    <Pressable key={f} testID={`freq-${f}`} onPress={() => setEditUrl((u) => ({ ...(u || {}), frequency: f }))} style={[styles.chip, on && { backgroundColor: C.primary, borderColor: C.primary }, { flex: 1 }]}>
                      <Text style={[styles.chipTxt, on ? { color: "#FFF" } : { color: C.navy }]}>{FREQ_LABEL[f]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.lbl, { marginTop: 12 }]}>Credenziali (opzionali — per siti protetti)</Text>
              <TextInput testID="url-username" value={editUrl?.username || ""} onChangeText={(t) => setEditUrl((u) => ({ ...(u || {}), username: t }))} placeholder="Username (se richiesto)" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" />
              <TextInput testID="url-password" value={(editUrl as any)?.password || ""} onChangeText={(t) => setEditUrl((u) => ({ ...(u || {}), password: t }))} placeholder="Password (se richiesta)" placeholderTextColor="#94A3B8" style={styles.input} secureTextEntry />
              <Text style={styles.metaTxt}>La password viene salvata cifrata sul tuo tenant e mai mostrata di nuovo.</Text>

              <Pressable onPress={saveUrl} disabled={busy} style={[styles.saveBtn, { backgroundColor: busy ? C.muted : C.primary }]} testID="save-url">
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Salva URL</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* V28.j — Info modal per Regole / Fonti URL / Storico */}
      <Modal transparent visible={!!infoTab} animationType="fade" onRequestClose={() => setInfoTab(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { maxHeight: "60%" }]}>
            <View style={styles.sheetHdr}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <Ionicons name="information-circle" size={22} color={C.primary} />
                <Text style={styles.sheetTitle}>{infoTab ? TAB_INFO[infoTab].title : ""}</Text>
              </View>
              <Pressable onPress={() => setInfoTab(null)} hitSlop={10}><Ionicons name="close" size={22} color={C.navy} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 12 }}>
              <Text style={styles.infoBody}>{infoTab ? TAB_INFO[infoTab].body : ""}</Text>
              <Pressable onPress={() => setInfoTab(null)} style={[styles.saveBtn, { backgroundColor: C.primary, marginTop: 10 }]}>
                <Text style={styles.saveBtnTxt}>Ho capito</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: "800", color: C.navy, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: "600" },
  badge: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  tabsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 6 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#FFF", paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1.5, borderColor: theme.color.border },
  tabBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabTxt: { fontSize: 12, fontWeight: "800", color: C.navy, flexShrink: 1 },
  infoBtn: { padding: 2 },
  infoBody: { fontSize: 13, color: C.navy, lineHeight: 19, padding: 4, fontWeight: "600" },
  // V28.j — Storico aggiornamenti
  historyGroup: { marginTop: 8, gap: 3 },
  historyGroupTitle: { fontSize: 12, fontWeight: "800", color: "#166534", marginBottom: 2 },
  historyItemOk: { fontSize: 12, color: "#166534", fontWeight: "600" },
  historyItemErr: { fontSize: 12, color: "#DC2626", fontWeight: "700" },
  historyErrMsg: { fontSize: 11, color: "#DC2626", fontStyle: "italic", marginLeft: 10 },
  filterRow: { flexDirection: "row", gap: 6, marginBottom: 4, paddingRight: 20 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1.5 },
  chipTxt: { fontSize: 11, fontWeight: "800" },
  // V28.n — Multi-category selector
  selectedCatsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4, marginBottom: 2 },
  selectedCatChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  selectedCatTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  addCatBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  catBadgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, flexShrink: 1, maxWidth: "60%" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, paddingVertical: 13, borderRadius: 14 },
  refreshAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.navy, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14 },
  addBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  card: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: theme.color.border },
  catBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  catBadgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: C.navy },
  cardTxt: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  metaTxt: { fontSize: 11, color: C.muted, fontWeight: "600" },
  summaryTxt: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontStyle: "italic", marginTop: 4, backgroundColor: "#F8FAFC", padding: 8, borderRadius: 8 },
  filesRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 },
  fileTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#FEE2E2", maxWidth: 200 },
  fileTagTxt: { fontSize: 10, fontWeight: "700", color: "#DC2626" },
  freqPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: C.primarySoft },
  freqPillTxt: { fontSize: 10, fontWeight: "800", color: C.primary, textTransform: "uppercase", letterSpacing: 0.4 },
  empty: { padding: 30, alignItems: "center", backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTxt: { color: C.muted, textAlign: "center", fontSize: 12, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, maxHeight: "92%" },
  sheetHdr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: C.navy },
  lbl: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 12, fontSize: 14, color: C.navy, marginBottom: 4 },
  catRow: { flexDirection: "row", gap: 6 },
  pdfBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#F1F5F9", padding: 10, borderRadius: 10, marginTop: 10 },
  pdfBtnTxt: { color: C.navy, fontWeight: "800", fontSize: 13 },
  saveBtn: { padding: 14, borderRadius: 14, marginTop: 14, alignItems: "center" },
  saveBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

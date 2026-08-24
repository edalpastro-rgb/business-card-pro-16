/**
 * V28.g — "Insegna ad Axon" (Master-only)
 * - Regole manuali organizzate per categoria libera (es. Clienti, Contratti, Comunicazioni…)
 * - Elenco illimitato di URL: indirizzo + descrizione + credenziali (opz.) + frequenza (manuale/giornaliera/settimanale/mensile)
 * - Pulsante "Aggiorna ora" globale per forzare il fetch di tutti gli URL via Tavily
 * Il contenuto viene usato da Axon come contesto prioritario durante l'analisi.
 */
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { pickCommonFile } from "@/src/utils/filePicker";

type Rule = { rule_id: string; category: string; title: string; text: string; files: { name: string; mime: string; size: number }[]; updated_at?: string };
type UrlItem = { url_id: string; url: string; name: string; category?: string; frequency: "manual" | "daily" | "weekly" | "monthly"; username?: string; password_masked?: boolean; last_fetched_at?: string; last_summary?: string; last_error?: string };

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

export default function AiTeachScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [tab, setTab] = useState<"rules" | "urls">("rules");
  const [filter, setFilter] = useState<string>("all");
  const [rules, setRules] = useState<Rule[]>([]);
  const [urls, setUrls] = useState<UrlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRule, setEditRule] = useState<Partial<Rule> | null>(null);
  const [editUrl, setEditUrl] = useState<Partial<UrlItem> | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const load = useCallback(async () => {
    if (!isMaster) return;
    try {
      setLoading(true);
      const [r, u] = await Promise.all([
        api<{ items: Rule[] }>("/ai-teach/rules"),
        api<{ items: UrlItem[] }>("/ai-teach/urls"),
      ]);
      setRules(r.items || []);
      setUrls(u.items || []);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare i dati");
    } finally { setLoading(false); }
  }, [isMaster]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // V28.g — Filter chips built from actually used categories + "Tutte"
  const availableCategories = useMemo(() => {
    const s = new Set<string>();
    rules.forEach((r) => s.add(r.category || "Generale"));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rules]);

  const filteredRules = useMemo(
    () => (filter === "all" ? rules : rules.filter((r) => (r.category || "Generale") === filter)),
    [rules, filter],
  );

  const saveRule = async () => {
    if (!editRule) return;
    try {
      setBusy(true);
      const payload: any = {
        category: (editRule.category || "Generale").trim() || "Generale",
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

  const removeRule = async (id: string) => {
    try { await api(`/ai-teach/rules/${id}`, { method: "DELETE" }); load(); } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const attachPdf = async () => {
    const { asset, error, base64 } = await pickCommonFile({ multiple: false });
    if (error || !asset) { if (error) notify("Errore", error); return; }
    const b64 = base64 || (asset as any)._base64 || "";
    if (!b64) { notify("Errore", "Impossibile leggere il file"); return; }
    setEditRule((r) => ({
      ...(r || {}),
      _pendingFiles: [...(((r as any)?._pendingFiles) || []), { name: asset.name, mime: asset.mimeType || "application/pdf", data_base64: b64 }],
    } as any));
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

  // V28.g — Force refresh of ALL URLs at once
  const refreshAll = async () => {
    if (urls.length === 0) { notify("Nessun URL", "Aggiungi prima almeno un URL da monitorare"); return; }
    try {
      setRefreshingAll(true);
      const res = await api<{ total: number; success: number; errors: string[] }>("/ai-teach/urls/refresh-all", { method: "POST" });
      const msg = `${res.success}/${res.total} URL aggiornati${res.errors?.length ? ` · ${res.errors.length} errori` : ""}`;
      notify("Aggiornamento completato ✅", msg);
      load();
    } catch (e: any) { notify("Errore aggiornamento", e?.message || ""); } finally { setRefreshingAll(false); }
  };

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
        <View style={styles.badge}><Ionicons name="sparkles" size={16} color="#FFF" /></View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        <Pressable testID="tab-rules" onPress={() => setTab("rules")} style={[styles.tabBtn, tab === "rules" && styles.tabBtnOn]}>
          <Ionicons name="book" size={16} color={tab === "rules" ? "#FFF" : C.navy} />
          <Text style={[styles.tabTxt, tab === "rules" && { color: "#FFF" }]}>Regole ({rules.length})</Text>
        </Pressable>
        <Pressable testID="tab-urls" onPress={() => setTab("urls")} style={[styles.tabBtn, tab === "urls" && styles.tabBtnOn]}>
          <Ionicons name="globe" size={16} color={tab === "urls" ? "#FFF" : C.navy} />
          <Text style={[styles.tabTxt, tab === "urls" && { color: "#FFF" }]}>URL ({urls.length})</Text>
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
            <Pressable testID="add-rule-btn" onPress={() => setEditRule({ category: filter !== "all" ? filter : "Generale", title: "", text: "" })} style={styles.addBtn}>
              <Ionicons name="add-circle" size={20} color="#FFF" />
              <Text style={styles.addBtnTxt}>Aggiungi regola</Text>
            </Pressable>
            {filteredRules.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTxt}>Nessuna regola. Aggiungi la prima per iniziare a insegnare ad Axon.</Text></View>
            ) : filteredRules.map((r) => {
              const catLabel = r.category || "Generale";
              const col = colorFor(catLabel);
              return (
                <View key={r.rule_id} style={styles.card} testID={`rule-${r.rule_id}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[styles.catBadge, { backgroundColor: col }]}><Ionicons name="pricetag" size={11} color="#FFF" /><Text style={styles.catBadgeTxt}>{catLabel}</Text></View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{r.title}</Text>
                    <Pressable testID={`edit-rule-${r.rule_id}`} onPress={() => setEditRule({ ...r })} hitSlop={8}><Ionicons name="pencil" size={16} color={C.primary} /></Pressable>
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
              <Text style={styles.lbl}>Categoria</Text>
              <TextInput
                testID="rule-category-input"
                value={editRule?.category || ""}
                onChangeText={(t) => setEditRule((r) => ({ ...(r || {}), category: t }))}
                placeholder="Es. Clienti, Contratti, Comunicazioni…"
                placeholderTextColor="#94A3B8"
                style={styles.input}
              />
              <View style={styles.presetRow}>
                {PRESET_CATEGORIES.map((c) => {
                  const on = (editRule?.category || "").toLowerCase() === c.toLowerCase();
                  const col = colorFor(c);
                  return (
                    <Pressable key={c} testID={`preset-cat-${c}`} onPress={() => setEditRule((r) => ({ ...(r || {}), category: c }))} style={[styles.chip, { borderColor: col }, on && { backgroundColor: col }]}>
                      <Text style={[styles.chipTxt, on ? { color: "#FFF" } : { color: col }]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.lbl}>Titolo</Text>
              <TextInput testID="rule-title-input" value={editRule?.title || ""} onChangeText={(t) => setEditRule((r) => ({ ...(r || {}), title: t }))} placeholder="Es. Procedura acquisizione nuovi clienti" placeholderTextColor="#94A3B8" style={styles.input} />
              <Text style={styles.lbl}>Testo della regola</Text>
              <TextInput testID="rule-text-input" value={editRule?.text || ""} onChangeText={(t) => setEditRule((r) => ({ ...(r || {}), text: t }))} multiline placeholder="Descrivi la regola in modo dettagliato…" placeholderTextColor="#94A3B8" style={[styles.input, { minHeight: 130, textAlignVertical: "top" }]} />
              <Pressable onPress={attachPdf} style={styles.pdfBtn}><Ionicons name="attach" size={17} color={C.navy} /><Text style={styles.pdfBtnTxt}>Allega PDF (opzionale)</Text></Pressable>
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
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#FFF", paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: theme.color.border },
  tabBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabTxt: { fontSize: 13, fontWeight: "800", color: C.navy },
  filterRow: { flexDirection: "row", gap: 6, marginBottom: 4, paddingRight: 20 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#FFF", borderWidth: 1.5 },
  chipTxt: { fontSize: 11, fontWeight: "800" },
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

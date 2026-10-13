// FaqSearch.tsx — V50.z533 — Ricerca FAQ interattiva: digiti una parola chiave → domande/risposte filtrate in tempo reale.
// Le FAQ arrivano da GET /public/faq (gestibili dal CMS admin); `fallback` = elenco statico se il backend non risponde.
// V50.z536 — FAQ suggerite da Axon (semantica MiniLM locale, zero crediti).
// V50.z541 — (1) FAQ PER RUOLO: la richiesta porta il token → il server restituisce solo le FAQ del ruolo (Supermaster/Master/Manager/
// Collaboratore) + quelle generali. (2) Ricerca FUZZY: errori ortografici (distanza di edit), parole parziali (prefisso), bigrammi.
// (3) SUGGERIMENTI AUTOMATICI mentre digiti: tendina con le domande più vicine, tap → apre la FAQ.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, LayoutAnimation, Platform, UIManager } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BACKEND_URL, getToken } from "@/src/api";
import { HT } from "@/src/homeTheme";

export type FaqItem = { id: string; icon?: string; q: string; a: string; roles?: string[] };

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tokens = (s: string) => norm(s).split(/[^a-z0-9àèéìòù]+/i).filter((w) => w.length >= 2);

// ── fuzzy helpers ──
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v); rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
const bigrams = (s: string) => { const out = new Set<string>(); const t = norm(s).replace(/\s+/g, " "); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
function dice(a: Set<string>, b: Set<string>): number { if (!a.size || !b.size) return 0; let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return (2 * n) / (a.size + b.size); }
/** punteggio parola-query vs parola-testo: 1 esatto · 0.85 prefisso · 0.7 sottostringa · 0.6 errore di battitura (1-2 edit) */
function wordScore(qw: string, tw: string): number {
  if (tw === qw) return 1;
  if (tw.startsWith(qw) || (qw.length >= 4 && qw.startsWith(tw))) return 0.85;
  if (qw.length >= 4 && tw.includes(qw)) return 0.7;
  const max = qw.length >= 7 ? 2 : qw.length >= 4 ? 1 : 0;
  if (max && editDistance(qw, tw, max) <= max) return 0.6;
  return 0;
}
/** punteggio fuzzy di una FAQ rispetto alla query (0..): parole della domanda pesano 2×, della risposta 1×, + similarità bigrammi domanda */
export function fuzzyScore(it: FaqItem, query: string): number {
  const qw = tokens(query);
  if (!qw.length) return 0;
  const tq = tokens(it.q), ta = tokens(it.a);
  let score = 0, matched = 0;
  for (const w of qw) {
    const best = Math.max(0, ...tq.map((t) => wordScore(w, t) * 2), ...ta.map((t) => wordScore(w, t)));
    if (best > 0) matched++;
    score += best;
  }
  const coverage = matched / qw.length;            // quante parole della query hanno trovato qualcosa
  const dq = dice(bigrams(query), bigrams(it.q));   // somiglianza complessiva con la domanda (ordine/typo)
  return score * (0.5 + coverage) + dq * 2;
}

export function useFaqItems(fallback: FaqItem[] = []) {
  const [items, setItems] = useState<FaqItem[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tok = await getToken();
        const r = await fetch(`${BACKEND_URL}/api/public/faq`, { headers: tok ? { Authorization: `Bearer ${tok}` } : undefined });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (alive) { setItems(Array.isArray(j?.items) && j.items.length ? j.items : fallback); setRole(j?.role || null); }
      } catch { if (alive) setItems(fallback); }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, role };
}

const ROLE_LABEL: Record<string, string> = { superadmin: "Supermaster", master: "Master", manager: "Manager", collab: "Collaboratore" };

export function FaqSearch({ fallback = [], placeholder = "Cerca nelle FAQ (es. crediti, libri, bug, tema…)", maxWhenEmpty = 6, testID = "faq-search" }: { fallback?: FaqItem[]; placeholder?: string; maxWhenEmpty?: number; testID?: string }) {
  const { items, role } = useFaqItems(fallback);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [suggested, setSuggested] = useState<FaqItem[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setSuggested(null); setSuggesting(false); return; }
    let alive = true;
    setSuggesting(true);
    const t = setTimeout(async () => {
      try {
        const tok = await getToken();
        const r = await fetch(`${BACKEND_URL}/api/public/faq/suggest?q=${encodeURIComponent(q)}&k=3`, { headers: tok ? { Authorization: `Bearer ${tok}` } : undefined });
        const j = r.ok ? await r.json() : { items: [] };
        if (alive) setSuggested(Array.isArray(j?.items) ? j.items : []);
      } catch { if (alive) setSuggested([]); }
      finally { if (alive) setSuggesting(false); }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  // risultati: FAQ suggerite da Axon in cima, poi match fuzzy (typo, parole parziali) ordinati per punteggio
  const results = useMemo(() => {
    if (!items) return [];
    if (!query.trim()) return items.slice(0, maxWhenEmpty);
    const fuzzy = items.map((it) => ({ it, score: fuzzyScore(it, query) })).filter((r) => r.score >= 1.2).sort((x, y) => y.score - x.score).map((r) => r.it);
    if (!suggested?.length) return fuzzy;
    const ids = new Set(suggested.map((s) => s.id));
    return [...suggested, ...fuzzy.filter((k) => !ids.has(k.id))];
  }, [items, query, maxWhenEmpty, suggested]);

  // tendina suggerimenti automatici (domande più vicine a ciò che stai scrivendo)
  const autocomplete = useMemo(() => {
    if (!items || query.trim().length < 2 || !focused) return [];
    return items.map((it) => ({ it, score: fuzzyScore(it, query) })).filter((r) => r.score >= 1.0).sort((x, y) => y.score - x.score).slice(0, 5).map((r) => r.it);
  }, [items, query, focused]);

  const suggestedIds = useMemo(() => new Set((suggested || []).map((s) => s.id)), [suggested]);
  const toggle = (id: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => (o === id ? null : id)); };
  const pickSuggestion = (it: FaqItem) => { setQuery(it.q); setFocused(false); setOpen(it.id); };

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.box}>
        <Ionicons name="search" size={18} color={HT.muted} />
        <TextInput value={query} onChangeText={setQuery} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} placeholder={placeholder} placeholderTextColor={HT.muted} style={s.input} autoCorrect={false} returnKeyType="search" testID={`${testID}-input`} />
        {suggesting ? <ActivityIndicator size="small" color={HT.violet} /> : null}
        {query ? <Pressable onPress={() => setQuery("")} hitSlop={8} testID={`${testID}-clear`}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
      </View>
      {autocomplete.length ? (
        <View style={s.dropdown} testID={`${testID}-autocomplete`}>
          {autocomplete.map((it) => (
            <Pressable key={it.id} onPress={() => pickSuggestion(it)} style={s.ddRow} testID={`${testID}-ac-${it.id}`}>
              <Ionicons name="arrow-forward-circle-outline" size={15} color={HT.violet} />
              <Text style={s.ddTxt} numberOfLines={1}>{it.q}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {role ? <Text style={s.roleHint} testID={`${testID}-role`}>Guide per il tuo ruolo: {ROLE_LABEL[role] || role}</Text> : null}
      {suggested?.length ? (
        <View style={s.axonRow} testID={`${testID}-axon-hint`}>
          <Ionicons name="sparkles" size={14} color={HT.violet} />
          <Text style={s.axonTxt}>Axon suggerisce {suggested.length === 1 ? "questa FAQ" : `queste ${suggested.length} FAQ`} per «{query.trim()}»</Text>
        </View>
      ) : null}
      {!items ? <ActivityIndicator color={HT.violet} style={{ marginVertical: 12 }} /> : results.length === 0 ? (
        <Text style={s.empty} testID={`${testID}-empty`}>Nessuna FAQ trovata per «{query}». Prova con un&apos;altra parola oppure chiedi ad Axon in chat.</Text>
      ) : results.map((it) => {
        const isOpen = open === it.id;
        const isAxon = suggestedIds.has(it.id);
        return (
          <Pressable key={it.id} onPress={() => toggle(it.id)} style={[s.item, isOpen && s.itemOpen, isAxon && s.itemAxon]} testID={`${testID}-item-${it.id}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name={(it.icon || "help-circle-outline") as any} size={18} color={HT.violet} />
              <Text style={s.q}>{it.q}</Text>
              {isAxon ? <View style={s.axonBadge} testID={`${testID}-axon-badge-${it.id}`}><Ionicons name="sparkles" size={11} color={HT.violet} /></View> : null}
              <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
            </View>
            {isOpen ? <Text style={s.a} testID={`${testID}-answer-${it.id}`}>{it.a}</Text> : null}
          </Pressable>
        );
      })}
      {items && !query && items.length > maxWhenEmpty ? <Text style={s.hint}>{items.length - maxWhenEmpty} altre FAQ: digita una parola chiave per filtrarle.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  box: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  input: { flex: 1, color: HT.text, fontSize: 14.5, paddingVertical: 10 },
  dropdown: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.violet + "66", borderRadius: 12, overflow: "hidden" },
  ddRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border },
  ddTxt: { flex: 1, color: HT.text, fontSize: 13.5 },
  roleHint: { color: HT.muted, fontSize: 11.5, paddingHorizontal: 4 },
  item: { backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 8 },
  itemOpen: { borderColor: HT.violet + "88", backgroundColor: HT.violetTint },
  itemAxon: { borderColor: HT.violet + "66" },
  axonRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  axonTxt: { color: HT.violet, fontSize: 12.5, fontWeight: "700", flex: 1 },
  axonBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  q: { flex: 1, color: HT.text, fontSize: 14, fontWeight: "700" },
  a: { color: HT.text2, fontSize: 13.5, lineHeight: 20 },
  empty: { color: HT.muted, fontSize: 13, paddingVertical: 8 },
  hint: { color: HT.muted, fontSize: 12, textAlign: "center" },
});

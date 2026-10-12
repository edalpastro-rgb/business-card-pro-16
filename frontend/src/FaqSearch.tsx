// FaqSearch.tsx — V50.z533 — Ricerca FAQ interattiva: digiti una parola chiave → domande/risposte filtrate in tempo reale.
// Le FAQ arrivano da GET /public/faq (gestibili dal CMS admin); `fallback` = elenco statico se il backend non risponde.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, LayoutAnimation, Platform, UIManager } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BACKEND_URL } from "@/src/api";
import { HT } from "@/src/homeTheme";

export type FaqItem = { id: string; icon?: string; q: string; a: string };

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function useFaqItems(fallback: FaqItem[] = []) {
  const [items, setItems] = useState<FaqItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND_URL}/api/public/faq`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) setItems(Array.isArray(j?.items) && j.items.length ? j.items : fallback); })
      .catch(() => { if (alive) setItems(fallback); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return items;
}

export function FaqSearch({ fallback = [], placeholder = "Cerca nelle FAQ (es. crediti, libri, bug, tema…)", maxWhenEmpty = 6, testID = "faq-search" }: { fallback?: FaqItem[]; placeholder?: string; maxWhenEmpty?: number; testID?: string }) {
  const items = useFaqItems(fallback);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // V50.z536 — FAQ suggerite da Axon: ricerca SEMANTICA locale (MiniLM sul server, zero crediti) con debounce 350 ms
  const [suggested, setSuggested] = useState<FaqItem[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setSuggested(null); setSuggesting(false); return; }
    let alive = true;
    setSuggesting(true);
    const t = setTimeout(() => {
      fetch(`${BACKEND_URL}/api/public/faq/suggest?q=${encodeURIComponent(q)}&k=3`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => { if (alive) setSuggested(Array.isArray(j?.items) ? j.items : []); })
        .catch(() => { if (alive) setSuggested([]); })
        .finally(() => { if (alive) setSuggesting(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const results = useMemo(() => {
    if (!items) return [];
    const words = norm(query).split(/\s+/).filter((w) => w.length >= 2);
    if (!words.length) return items.slice(0, maxWhenEmpty);
    const keyword = items
      .map((it) => {
        const q = norm(it.q), a = norm(it.a);
        const inQ = words.filter((w) => q.includes(w)).length, inA = words.filter((w) => a.includes(w)).length;
        return { it, score: inQ * 2 + inA, all: words.every((w) => q.includes(w) || a.includes(w)) };
      })
      .filter((r) => r.score > 0)
      .sort((x, y) => Number(y.all) - Number(x.all) || y.score - x.score)
      .map((r) => r.it);
    if (!suggested?.length) return keyword;
    // le FAQ suggerite da Axon vanno in cima; il resto (match per parola chiave) segue senza duplicati
    const ids = new Set(suggested.map((s) => s.id));
    return [...suggested, ...keyword.filter((k) => !ids.has(k.id))];
  }, [items, query, maxWhenEmpty, suggested]);

  const suggestedIds = useMemo(() => new Set((suggested || []).map((s) => s.id)), [suggested]);
  const toggle = (id: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => (o === id ? null : id)); };

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.box}>
        <Ionicons name="search" size={18} color={HT.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={placeholder} placeholderTextColor={HT.muted} style={s.input} autoCorrect={false} returnKeyType="search" testID={`${testID}-input`} />
        {suggesting ? <ActivityIndicator size="small" color={HT.violet} /> : null}
        {query ? <Pressable onPress={() => setQuery("")} hitSlop={8} testID={`${testID}-clear`}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
      </View>
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

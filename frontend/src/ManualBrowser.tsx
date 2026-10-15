// ManualBrowser.tsx — V50.z554 — Manuale completo dell'app: ricerca FULL-TEXT (titolo, percorso, descrizione, parole chiave,
// risposte FAQ) + elenco per categoria. Ogni articolo: nome, percorso di navigazione, cosa fa/come si usa, pulsante «Apri» (deep link).
// Dati: GET /public/manual · GET /public/manual/search?q= (stesso manuale che Axon usa per guidare l'utente).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { resolveNavRoute } from "@/src/navRoutes";

export type ManualArticle = { id: string; kind: "manual" | "faq"; title: string; path: string; route: string | null; category: string; body: string; desc?: string; how?: string; score?: number };

export function ManualBrowser({ autoFocus, initialQuery }: { autoFocus?: boolean; initialQuery?: string }) {
  const router = useRouter();
  const [all, setAll] = useState<ManualArticle[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ManualArticle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { api<{ items: ManualArticle[]; categories: string[] }>("/public/manual").then((d) => { setAll(d.items || []); setCats(d.categories || []); }).catch(() => {}); }, []);

  const search = useCallback((text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    const t = text.trim();
    if (t.length < 2) { setResults(null); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try { const d = await api<{ items: ManualArticle[] }>(`/public/manual/search?q=${encodeURIComponent(t)}&k=12`); setResults(d.items || []); }
      catch { setResults([]); } finally { setBusy(false); }
    }, 220);
  }, []);

  useEffect(() => { if (initialQuery && initialQuery.trim().length >= 2) search(initialQuery); }, [initialQuery, search]);

  const byCat = useMemo(() => { const m: Record<string, ManualArticle[]> = {}; all.forEach((a) => { (m[a.category] ||= []).push(a); }); return m; }, [all]);

  const open = (a: ManualArticle) => { const r = a.route ? resolveNavRoute(a.route) : null; if (r) router.push(r as any); };

  const Article = ({ a }: { a: ManualArticle }) => {
    const expanded = openId === a.id || !!results;
    const canOpen = !!(a.route && resolveNavRoute(a.route));
    return (
      <Pressable onPress={() => setOpenId(expanded && !results ? null : a.id)} style={s.article} testID={`manual-article-${a.id}`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name={a.kind === "faq" ? "help-circle-outline" : "document-text-outline"} size={18} color={HT.brand} />
          <Text style={s.title} numberOfLines={2}>{a.title}</Text>
        </View>
        <Text style={s.path} numberOfLines={2}>📍 {a.path}</Text>
        {expanded ? (
          <>
            {a.kind === "manual" && a.how ? (
              <>
                <Text style={s.body}>{a.desc || a.body}</Text>
                <Text style={s.howLabel}>Come si usa</Text>
                <Text style={s.body} testID={`manual-how-${a.id}`}>{a.how}</Text>
              </>
            ) : (
              <Text style={s.body}>{a.body}</Text>
            )}
            {canOpen ? (
              <Pressable onPress={() => open(a)} style={s.openBtn} testID={`manual-open-${a.id}`}>
                <Ionicons name="open-outline" size={15} color={HT.bg} /><Text style={s.openTxt}>Apri {a.route}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 12 }} testID="manual-browser">
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={HT.muted} />
        <TextInput value={q} onChangeText={search} placeholder="Cerca una funzione: scanner, Axon Lab, landing page, nota vocale…" placeholderTextColor={HT.muted} style={s.input} autoFocus={autoFocus} autoCorrect={false} returnKeyType="search" testID="manual-search-input" />
        {busy ? <ActivityIndicator size="small" color={HT.brand} /> : q ? <Pressable onPress={() => search("")} hitSlop={8} testID="manual-search-clear"><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
      </View>
      {results ? (
        <View style={{ gap: 8 }} testID="manual-results">
          <Text style={s.hint}>{results.length ? `${results.length} articoli trovati` : "Nessun articolo: prova con un'altra parola (es. «bolletta», «invito»)"}</Text>
          {results.map((a) => <Article key={a.id} a={a} />)}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={s.hint}>{all.length} articoli · tocca una categoria</Text>
          {cats.map((c) => (
            <View key={c}>
              <Pressable onPress={() => setOpenCat(openCat === c ? null : c)} style={s.cat} testID={`manual-cat-${c}`}>
                <Text style={s.catTxt}>{c}</Text>
                <Text style={s.catN}>{(byCat[c] || []).length}</Text>
                <Ionicons name={openCat === c ? "chevron-up" : "chevron-down"} size={16} color={HT.muted} />
              </Pressable>
              {openCat === c ? <View style={{ gap: 8, marginTop: 8 }}>{(byCat[c] || []).map((a) => <Article key={a.id} a={a} />)}</View> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, paddingHorizontal: 12, minHeight: 48 },
  input: { flex: 1, color: HT.text, fontSize: 15, paddingVertical: 10 },
  hint: { color: HT.muted, fontSize: 12.5 },
  cat: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48 },
  catTxt: { flex: 1, color: HT.text, fontWeight: "800", fontSize: 14.5 },
  catN: { color: HT.muted, fontWeight: "700", fontSize: 12 },
  article: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 14, gap: 6 },
  title: { flex: 1, color: HT.text, fontWeight: "900", fontSize: 15 },
  path: { color: HT.brand, fontSize: 12.5, fontWeight: "700" },
  body: { color: HT.text2, fontSize: 14, lineHeight: 20, marginTop: 2 },
  howLabel: { color: HT.brand, fontSize: 12, fontWeight: "800", marginTop: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  openBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.brand, borderRadius: 999, paddingHorizontal: 14, minHeight: 40, marginTop: 4 },
  openTxt: { color: HT.bg, fontWeight: "900", fontSize: 13 },
});

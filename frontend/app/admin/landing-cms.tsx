// admin/landing-cms.tsx — V50.z530 — CMS della landing pubblica Axon Core (solo Super Admin + password LANDING_CMS_PASSWORD).
// Modifica senza toccare il codice: testi/titoli di ogni sezione, prezzi (barrato/attivo) e limite posti dei due piani Founder.
// Il contatore «posti rimasti» è calcolato dal backend: limite − account registrati con quel piano.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, BACKEND_URL } from "@/src/api";
import { notify, confirmAsync } from "@/src/utils/notify";
import { PasswordInput } from "@/src/PasswordInput";
import { KScrollView } from "@/src/ui/keyboard";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

type Content = Record<string, any>;
type FaqRow = { id: string; icon?: string; q: string; a: string ; roles?: string[] };
type Seats = Record<"builder" | "professional", { limit: number; taken: number; left: number }>;

function setPath(obj: Content, path: string[], value: unknown): Content {
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  const [head, ...rest] = path;
  (out as any)[head] = rest.length ? setPath((obj as any)[head] ?? {}, rest, value) : value;
  return out;
}
const getPath = (obj: Content, path: string[]) => path.reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), obj);

const FAQ_ROLES = [{ id: "superadmin", label: "Supermaster" }, { id: "master", label: "Master" }, { id: "manager", label: "Manager" }, { id: "collab", label: "Collaboratore" }]; // V50.z541 — FAQ per ruolo

export default function LandingCmsScreen() {
  const router = useRouter();
  const bottomPad = usePageBottomPadding();
  const [superAdmin, setSuperAdmin] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState<Content | null>(null);
  const [seats, setSeats] = useState<Seats | null>(null);
  const [dirty, setDirty] = useState(false);
  const [faq, setFaq] = useState<FaqRow[] | null>(null); // V50.z533 — FAQ gestibili (Help › ricerca FAQ + pagina /faq + conoscenza Axon)
  const [faqDirty, setFaqDirty] = useState(false);
  const H = { "X-CMS-Password": password };

  const [pwConfigured, setPwConfigured] = useState(true);
  // V50.z531 — permesso CMS: Super Admin OPPURE Master radice (non più solo /admin/me → in produzione restava il lucchetto)
  useEffect(() => { api<{ can: boolean; password_configured: boolean }>("/landing/cms/permission").then((r) => { setSuperAdmin(!!r.can); setPwConfigured(!!r.password_configured); }).catch(() => setSuperAdmin(false)); }, []);

  const load = useCallback(async () => {
    const r = await api<{ content: Content; seats: Seats }>("/landing/cms/content", { headers: H });
    setContent(r.content); setSeats(r.seats); setDirty(false);
    const f = await api<{ items: FaqRow[] }>("/public/faq");
    setFaq(f.items); setFaqDirty(false);
  }, [password]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = async () => {
    setBusy(true);
    try { await api("/landing/cms/unlock", { method: "POST", body: { password } }); setUnlocked(true); await load(); }
    catch (e: any) { notify("CMS Landing", e?.message || "Password errata"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!content) return;
    setBusy(true);
    try {
      const r = await api<{ seats: Seats; content: Content }>("/landing/cms/content", { method: "PUT", body: { content }, headers: H });
      setSeats(r.seats); setContent(r.content); setDirty(false); notify("CMS Landing", "Modifiche pubblicate ✅");
    } catch (e: any) { notify("CMS Landing", e?.message || "Salvataggio non riuscito"); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!(await confirmAsync("Ripristina default", "Tutti i testi, prezzi e limiti tornano ai valori originali. Continuare?"))) return;
    setBusy(true);
    try { await api("/landing/cms/reset", { method: "POST", headers: H }); await load(); notify("CMS Landing", "Default ripristinati"); }
    catch (e: any) { notify("CMS Landing", e?.message || "Errore"); }
    finally { setBusy(false); }
  };

  const saveFaq = async () => {
    if (!faq) return;
    const bad = faq.find((f) => f.q.trim().length < 3 || f.a.trim().length < 3);
    if (bad) { notify("FAQ", "Ogni FAQ deve avere domanda e risposta (almeno 3 caratteri)."); return; }
    setBusy(true);
    try { const r = await api<{ items: FaqRow[] }>("/landing/cms/faq", { method: "PUT", body: { items: faq }, headers: H }); setFaq(r.items); setFaqDirty(false); notify("FAQ", "FAQ pubblicate ✅ (Help, pagina FAQ e Axon aggiornati)"); }
    catch (e: any) { notify("FAQ", e?.message || "Salvataggio non riuscito"); }
    finally { setBusy(false); }
  };
  const resetFaq = async () => {
    if (!(await confirmAsync("Ripristina FAQ", "Le FAQ tornano all'elenco di default. Continuare?"))) return;
    setBusy(true);
    try { const r = await api<{ items: FaqRow[] }>("/landing/cms/faq/reset", { method: "POST", headers: H }); setFaq(r.items); setFaqDirty(false); }
    catch (e: any) { notify("FAQ", e?.message || "Errore"); }
    finally { setBusy(false); }
  };
  const editFaq = (idx: number, key: "q" | "a", v: unknown) => { setFaq((f) => (f ? f.map((it, i) => (i === idx ? { ...it, [key]: String(v) } : it)) : f)); setFaqDirty(true); };
  const moveFaq = (idx: number, dir: -1 | 1) => { setFaq((f) => { if (!f) return f; const j = idx + dir; if (j < 0 || j >= f.length) return f; const c = [...f]; [c[idx], c[j]] = [c[j], c[idx]]; return c; }); setFaqDirty(true); };
  const removeFaq = (idx: number) => { setFaq((f) => (f ? f.filter((_, i) => i !== idx) : f)); setFaqDirty(true); };
  const toggleFaqRole = (idx: number, role: string) => { setFaq((f) => (f ? f.map((it, i) => (i === idx ? { ...it, roles: (it.roles || []).includes(role) ? (it.roles || []).filter((x) => x !== role) : [...(it.roles || []), role] } : it)) : f)); setFaqDirty(true); }; // V50.z541
  const addFaq = () => { setFaq((f) => [...(f || []), { id: `faq_${Date.now().toString(36)}`, icon: "help-circle-outline", q: "", a: "" }]); setFaqDirty(true); };
  // V50.z536 — anteprima OG italianbrain.it (logo + posti Founder rimasti): rigenerata ogni notte, qui si forza subito
  const [ogInfo, setOgInfo] = useState<{ generated_at?: string | null; left?: number | null; limit?: number | null } | null>(null);
  const [ogTick, setOgTick] = useState(0);
  useEffect(() => { if (unlocked) api<typeof ogInfo>("/landing/cms/og").then(setOgInfo).catch(() => {}); }, [unlocked, ogTick]);
  const refreshOg = async () => {
    setBusy(true);
    try { const r = await api<{ left: number; limit: number }>("/landing/cms/og/refresh", { method: "POST", headers: H }); setOgTick((t) => t + 1); notify("Anteprima OG", `Rigenerata: ${r.left}/${r.limit} posti Founder liberi ✅`); }
    catch (e: any) { notify("Anteprima OG", e?.message || "Errore"); }
    finally { setBusy(false); }
  };

  const edit = (path: string[], value: unknown) => { setContent((c) => (c ? setPath(c, path, value) : c)); setDirty(true); };

  // Field/ListField sono componenti a livello di modulo (identità stabile → il TextInput non perde il focus a ogni tasto)
  const Field = (p: { label: string; path: string[]; multiline?: boolean; numeric?: boolean }) => (
    <CmsField label={p.label} multiline={p.multiline} numeric={p.numeric} value={getPath(content || {}, p.path)} onChange={(v) => edit(p.path, v)} testID={`cms-${p.path.join("-")}`} />
  );
  const ListField = (p: { label: string; path: string[] }) => (
    <CmsField label={`${p.label} (una per riga)`} multiline value={(getPath(content || {}, p.path) || []).join("\n")} onChange={(v) => edit(p.path, String(v).split("\n"))} testID={`cms-${p.path.join("-")}`} />
  );

  const header = (
    <View style={s.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} testID="back-btn"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>CMS Landing</Text>
        <Text style={s.sub}>Testi, prezzi, posti Founder e pagine di approfondimento</Text>
      </View>
      {unlocked ? (
        <Pressable onPress={save} disabled={busy || !dirty} style={[s.saveBtn, (!dirty || busy) && { opacity: 0.5 }]} testID="cms-save">
          {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="cloud-upload" size={16} color="#FFF" />}
          <Text style={s.saveTxt}>Pubblica</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (superAdmin === null) return <SafeAreaView style={s.root} edges={["top"]}>{header}<ActivityIndicator color={HT.violet} style={{ marginTop: 40 }} /></SafeAreaView>;
  if (!superAdmin) {
    return (
      <SafeAreaView style={s.root} edges={["top"]} testID="cms-forbidden">{header}
        <View style={{ padding: 40, alignItems: "center", gap: 10 }}><Ionicons name="lock-closed" size={40} color={HT.muted} /><Text style={s.cardTitle}>Sezione riservata all&apos;amministratore</Text><Text style={[s.muted, { textAlign: "center" }]}>Accedi con l&apos;account Master (owner principale) oppure con un&apos;email in ADVISOR_SUPER_ADMIN_EMAILS.</Text></View>
      </SafeAreaView>
    );
  }
  if (!unlocked) {
    return (
      <SafeAreaView style={s.root} edges={["top"]} testID="cms-lock">{header}
        <View style={{ padding: 16 }}>
          <View style={s.card}>
            <View style={s.row}><View style={s.iconWrap}><Ionicons name="key" size={20} color={HT.violet} /></View><Text style={s.cardTitle}>Password del CMS</Text></View>
            <Text style={s.muted}>Impostata sul server nel file .env (LANDING_CMS_PASSWORD). Richiesta in aggiunta al tuo login da amministratore.</Text>
            {!pwConfigured ? <Text style={[s.muted, { color: HT.danger, fontWeight: "800" }]} testID="cms-pw-missing">⚠️ LANDING_CMS_PASSWORD non è impostata nel .env del server: aggiungila e riavvia il backend, poi torna qui.</Text> : null}
            <PasswordInput value={password} onChangeText={setPassword} placeholder="Password CMS" testID="cms-password" />
            <Pressable onPress={unlock} disabled={busy || !password} style={[s.btn, (!password || busy) && { opacity: 0.6 }]} testID="cms-unlock">
              {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="lock-open" size={18} color="#FFF" /><Text style={s.btnTxt}>Sblocca</Text></>}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="cms-editor">{header}
      <KScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: bottomPad }}>
        {seats ? (
          <View style={[s.card, { flexDirection: "row", gap: 12 }]} testID="cms-seats">
            {(["builder", "professional"] as const).map((k) => (
              <View key={k} style={{ flex: 1, gap: 2 }}>
                <Text style={s.lbl}>{k === "builder" ? "Builder" : "Professional"}</Text>
                <Text style={s.cardTitle}>{seats[k].left} <Text style={s.muted}>posti rimasti</Text></Text>
                <Text style={s.muted}>{seats[k].taken} iscritti su {seats[k].limit}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Section title="1 · Hero">
          {Field({ label: "Badge", path: ["hero", "badge"] })}
          {Field({ label: "Titolo", path: ["hero", "title"], multiline: true })}
          {Field({ label: "Sottotitolo", path: ["hero", "subtitle"], multiline: true })}
          {Field({ label: "Pulsante primario", path: ["hero", "cta_primary"] })}
          {Field({ label: "Pulsante secondario", path: ["hero", "cta_secondary"] })}
        </Section>
        <Section title="2 · I due mondi">
          {Field({ label: "Titolo sezione", path: ["worlds", "title"] })}
          {Field({ label: "Sinistra · etichetta", path: ["worlds", "left_kicker"] })}
          {Field({ label: "Sinistra · titolo", path: ["worlds", "left_title"] })}
          {Field({ label: "Sinistra · testo", path: ["worlds", "left_text"], multiline: true })}
          {Field({ label: "Destra · etichetta", path: ["worlds", "right_kicker"] })}
          {Field({ label: "Destra · titolo", path: ["worlds", "right_title"] })}
          {Field({ label: "Destra · testo", path: ["worlds", "right_text"], multiline: true })}
        </Section>
        <Section title="3 · Manifesto privacy">
          {Field({ label: "Titolo", path: ["manifesto", "title"], multiline: true })}
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ gap: 8 }}>
              {Field({ label: `Pilastro ${i + 1} · titolo`, path: ["manifesto", "pillars", String(i), "title"] })}
              {Field({ label: `Pilastro ${i + 1} · testo`, path: ["manifesto", "pillars", String(i), "text"], multiline: true })}
            </View>
          ))}
        </Section>
        <Section title="4 · Piani Founder">
          {Field({ label: "Titolo sezione", path: ["plans", "title"] })}
          {Field({ label: "Sottotitolo", path: ["plans", "subtitle"] })}
          {Field({ label: "Etichetta posti ({limit} = limite)", path: ["plans", "seats_label"] })}
          {Field({ label: "Etichetta esaurito", path: ["plans", "sold_out_label"] })}
          {(["builder", "professional"] as const).map((k) => (
            <View key={k} style={s.planBox} testID={`cms-plan-${k}`}>
              <Text style={s.cardTitle}>{k === "builder" ? "Card 1 · Builder Founder" : "Card 2 · Professional Founder"}</Text>
              {Field({ label: "Badge", path: ["plans", k, "badge"] })}
              {Field({ label: "Nome piano", path: ["plans", k, "name"] })}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>{Field({ label: "Prezzo barrato (€)", path: ["plans", k, "price_old"], numeric: true })}</View>
                <View style={{ flex: 1 }}>{Field({ label: "Prezzo attivo (€)", path: ["plans", k, "price"], numeric: true })}</View>
                <View style={{ flex: 1 }}>{Field({ label: "Limite posti", path: ["plans", k, "limit"], numeric: true })}</View>
              </View>
              {ListField({ label: "Funzioni", path: ["plans", k, "features"] })}
              {Field({ label: "Pulsante", path: ["plans", k, "cta"] })}
            </View>
          ))}
        </Section>
        <Section title="Footer">
          {Field({ label: "Testo footer", path: ["footer", "text"], multiline: true })}
        </Section>

        {/* V50.z546 — pagine di approfondimento: italianbrain.it/axonos · /advisoros e, nell'app, /landing/axonos · /landing/advisoros */}
        <Section title="5 · Pagina AxonOS (approfondimento)">
          <Text style={s.muted}>Raggiunta da «Attiva AxonLite» e dal bottone 19€. Nei testi puoi usare {"{left}"} {"{limit}"} {"{price}"} {"{price_old}"} (posti e prezzo del piano Builder).</Text>
          <View style={s.planBox} testID="cms-page-axon-hero">
            <Text style={s.cardTitle}>Hero</Text>
            {Field({ label: "Etichetta", path: ["pages", "axon", "hero", "kicker"] })}
            {Field({ label: "Titolo H1", path: ["pages", "axon", "hero", "title"], multiline: true })}
            {Field({ label: "Sottotitolo", path: ["pages", "axon", "hero", "subtitle"], multiline: true })}
            {Field({ label: "Etichetta placeholder video", path: ["pages", "axon", "hero", "video_label"] })}
            {Field({ label: "Pulsante (→ registrazione AxonOS)", path: ["pages", "axon", "hero", "cta"] })}
            {Field({ label: "Nota sotto il pulsante", path: ["pages", "axon", "hero", "cta_note"] })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Concetto chiave «Svuota la Scrivania»</Text>
            {Field({ label: "Etichetta", path: ["pages", "axon", "concept", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "axon", "concept", "title"] })}
            {Field({ label: "Testo 1 (metafora)", path: ["pages", "axon", "concept", "text1"], multiline: true })}
            {Field({ label: "Testo 2 (famiglia come impresa)", path: ["pages", "axon", "concept", "text2"], multiline: true })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>L&apos;assistente in azione (4 scenari)</Text>
            {Field({ label: "Etichetta", path: ["pages", "axon", "scenarios", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "axon", "scenarios", "title"] })}
            {((getPath(content || {}, ["pages", "axon", "scenarios", "items"]) || []) as any[]).map((_, i) => (
              <View key={i} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ width: 70 }}>{Field({ label: "Icona", path: ["pages", "axon", "scenarios", "items", String(i), "emoji"] })}</View>
                  <View style={{ flex: 1 }}>{Field({ label: `Scenario ${i + 1} · titolo`, path: ["pages", "axon", "scenarios", "items", String(i), "title"] })}</View>
                </View>
                {Field({ label: `Scenario ${i + 1} · testo`, path: ["pages", "axon", "scenarios", "items", String(i), "text"], multiline: true })}
              </View>
            ))}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Onboarding lampo</Text>
            {Field({ label: "Etichetta", path: ["pages", "axon", "onboarding", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "axon", "onboarding", "title"] })}
            {Field({ label: "Testo", path: ["pages", "axon", "onboarding", "text"], multiline: true })}
            {ListField({ label: "Passi", path: ["pages", "axon", "onboarding", "bullets"] })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Offerta Soci Fondatori</Text>
            {Field({ label: "Etichetta", path: ["pages", "axon", "founders", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "axon", "founders", "title"] })}
            {Field({ label: "Testo", path: ["pages", "axon", "founders", "text"], multiline: true })}
            {Field({ label: "Pillola posti ({left}/{limit})", path: ["pages", "axon", "founders", "highlight"] })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Box tariffa unica (prezzo = piano Builder, sezione 4)</Text>
            {Field({ label: "Badge", path: ["pages", "axon", "pricing", "badge"] })}
            {Field({ label: "Titolo", path: ["pages", "axon", "pricing", "title"] })}
            {Field({ label: "Testo", path: ["pages", "axon", "pricing", "text"], multiline: true })}
            {ListField({ label: "Punti", path: ["pages", "axon", "pricing", "bullets"] })}
            {Field({ label: "Pulsante (→ registrazione AxonOS)", path: ["pages", "axon", "pricing", "cta"] })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Ponte verso il Business (→ pagina AdvisorOS)</Text>
            {Field({ label: "Etichetta", path: ["pages", "axon", "bridge", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "axon", "bridge", "title"] })}
            {Field({ label: "Testo", path: ["pages", "axon", "bridge", "text"], multiline: true })}
            {Field({ label: "Pulsante", path: ["pages", "axon", "bridge", "cta"] })}
          </View>
        </Section>

        <Section title="6 · Pagina AdvisorOS (approfondimento)">
          <Text style={s.muted}>Raggiunta da «Scopri AdvisorOS» e dal ponte della pagina AxonOS. Variabili: {"{left}"} {"{limit}"} {"{price}"} {"{price_old}"} (piano Professional). Nelle celle del confronto inizia con ✅ 🟡 ❌ per il colore.</Text>
          <View style={s.planBox} testID="cms-page-advisor-hero">
            <Text style={s.cardTitle}>Hero</Text>
            {Field({ label: "Etichetta", path: ["pages", "advisor", "hero", "kicker"] })}
            {Field({ label: "Titolo H1", path: ["pages", "advisor", "hero", "title"], multiline: true })}
            {Field({ label: "Sottotitolo", path: ["pages", "advisor", "hero", "subtitle"], multiline: true })}
            {Field({ label: "Etichetta placeholder video", path: ["pages", "advisor", "hero", "video_label"] })}
            {Field({ label: "Pulsante (→ registrazione AdvisorOS)", path: ["pages", "advisor", "hero", "cta"] })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Il dolore</Text>
            {Field({ label: "Etichetta", path: ["pages", "advisor", "pain", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "advisor", "pain", "title"] })}
            {Field({ label: "Testo 1 (la giornata)", path: ["pages", "advisor", "pain", "text1"], multiline: true })}
            {Field({ label: "Testo 2 (la svolta)", path: ["pages", "advisor", "pain", "text2"], multiline: true })}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Confronto AdvisorOS vs I Giganti</Text>
            {Field({ label: "Etichetta", path: ["pages", "advisor", "compare", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "advisor", "compare", "title"] })}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>{Field({ label: "Colonna 1", path: ["pages", "advisor", "compare", "col_need"] })}</View>
              <View style={{ flex: 1 }}>{Field({ label: "Colonna 2", path: ["pages", "advisor", "compare", "col_us"] })}</View>
              <View style={{ flex: 1 }}>{Field({ label: "Colonna 3", path: ["pages", "advisor", "compare", "col_them"] })}</View>
            </View>
            {((getPath(content || {}, ["pages", "advisor", "compare", "rows"]) || []) as any[]).map((_, i) => (
              <View key={i} style={{ gap: 8, borderTopWidth: 1, borderColor: HT.border, paddingTop: 8 }}>
                {Field({ label: `Riga ${i + 1} · esigenza`, path: ["pages", "advisor", "compare", "rows", String(i), "need"] })}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>{Field({ label: "AdvisorOS", path: ["pages", "advisor", "compare", "rows", String(i), "us"] })}</View>
                  <View style={{ flex: 1 }}>{Field({ label: "Giganti", path: ["pages", "advisor", "compare", "rows", String(i), "them"] })}</View>
                </View>
              </View>
            ))}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Funzionalità specialistiche (4 aree)</Text>
            {Field({ label: "Etichetta", path: ["pages", "advisor", "features", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "advisor", "features", "title"] })}
            {((getPath(content || {}, ["pages", "advisor", "features", "items"]) || []) as any[]).map((_, i) => (
              <View key={i} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ width: 70 }}>{Field({ label: "Icona", path: ["pages", "advisor", "features", "items", String(i), "emoji"] })}</View>
                  <View style={{ flex: 1 }}>{Field({ label: `Area ${i + 1} · titolo`, path: ["pages", "advisor", "features", "items", String(i), "title"] })}</View>
                </View>
                {Field({ label: `Area ${i + 1} · testo`, path: ["pages", "advisor", "features", "items", String(i), "text"], multiline: true })}
              </View>
            ))}
          </View>
          <View style={s.planBox}>
            <Text style={s.cardTitle}>Pacchetti e prezzi (prezzo = piano Professional, sezione 4)</Text>
            {Field({ label: "Etichetta", path: ["pages", "advisor", "pricing", "kicker"] })}
            {Field({ label: "Titolo", path: ["pages", "advisor", "pricing", "title"] })}
            {Field({ label: "Box Founder · badge", path: ["pages", "advisor", "pricing", "founders_title"] })}
            {Field({ label: "Box Founder · testo", path: ["pages", "advisor", "pricing", "founders_text"], multiline: true })}
            {Field({ label: "Box Founder · pillola posti ({left}/{limit})", path: ["pages", "advisor", "pricing", "founders_highlight"] })}
            {((getPath(content || {}, ["pages", "advisor", "pricing", "tiers"]) || []) as any[]).map((_, i) => (
              <View key={i} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ width: 70 }}>{Field({ label: "Icona", path: ["pages", "advisor", "pricing", "tiers", String(i), "emoji"] })}</View>
                  <View style={{ flex: 1 }}>{Field({ label: `Pacchetto ${i + 1} · nome`, path: ["pages", "advisor", "pricing", "tiers", String(i), "name"] })}</View>
                </View>
                {Field({ label: `Pacchetto ${i + 1} · descrizione`, path: ["pages", "advisor", "pricing", "tiers", String(i), "text"], multiline: true })}
              </View>
            ))}
            {Field({ label: "Pulsante prova (→ registrazione AdvisorOS)", path: ["pages", "advisor", "pricing", "cta_trial"] })}
            {Field({ label: "Pulsante preventivo (→ email)", path: ["pages", "advisor", "pricing", "cta_quote"] })}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>{Field({ label: "Email preventivi", path: ["pages", "advisor", "pricing", "quote_email"] })}</View>
              <View style={{ flex: 1 }}>{Field({ label: "Oggetto email", path: ["pages", "advisor", "pricing", "quote_subject"] })}</View>
            </View>
          </View>
        </Section>

        <View style={s.card} testID="cms-og">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[s.sectionTitle, { flex: 1 }]}>Anteprima social (OG) · italianbrain.it</Text>
            <Pressable onPress={refreshOg} disabled={busy} style={[s.saveBtn, busy && { opacity: 0.5 }]} testID="cms-og-refresh"><Ionicons name="refresh" size={14} color="#FFF" /><Text style={s.saveTxt}>Rigenera ora</Text></Pressable>
          </View>
          <Text style={s.muted}>Immagine che WhatsApp/LinkedIn mostrano quando condividi il link: logo AxonOS + «Solo N posti Founder rimasti». Si aggiorna da sola ogni notte alle 03:05{ogInfo?.generated_at ? ` · ultima generazione ${new Date(ogInfo.generated_at).toLocaleString("it-IT")} (${ogInfo.left}/${ogInfo.limit} liberi)` : ""}.</Text>
          <Image source={{ uri: `${BACKEND_URL}/api/public/og-preview.png?t=${ogTick}` }} style={s.ogImg} resizeMode="contain" accessibilityLabel="Anteprima OG" testID="cms-og-img" />
        </View>

        <View style={s.card} testID="cms-faq">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[s.sectionTitle, { flex: 1 }]}>FAQ · Help e pagina Domande frequenti</Text>
            <Pressable onPress={saveFaq} disabled={busy || !faqDirty} style={[s.saveBtn, (!faqDirty || busy) && { opacity: 0.5 }]} testID="cms-faq-save"><Ionicons name="cloud-upload" size={14} color="#FFF" /><Text style={s.saveTxt}>Pubblica FAQ</Text></Pressable>
          </View>
          <Text style={s.muted}>Le FAQ alimentano la ricerca in Help, la pagina /faq e le risposte di Axon («dove trovo…»). Pubblicazione separata dai testi della landing.</Text>
          {faq === null ? <ActivityIndicator color={HT.violet} /> : faq.map((it, idx) => (
            <View key={it.id} style={s.planBox} testID={`cms-faq-item-${idx}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[s.lbl, { flex: 1 }]}>FAQ {idx + 1}</Text>
                <Pressable onPress={() => moveFaq(idx, -1)} hitSlop={6} style={s.miniBtn} accessibilityLabel="Sposta su"><Ionicons name="arrow-up" size={16} color={HT.text2} /></Pressable>
                <Pressable onPress={() => moveFaq(idx, 1)} hitSlop={6} style={s.miniBtn} accessibilityLabel="Sposta giù"><Ionicons name="arrow-down" size={16} color={HT.text2} /></Pressable>
                <Pressable onPress={() => removeFaq(idx)} hitSlop={6} style={s.miniBtn} accessibilityLabel="Elimina FAQ" testID={`cms-faq-del-${idx}`}><Ionicons name="trash-outline" size={16} color={HT.danger} /></Pressable>
              </View>
              <CmsField label="Domanda" value={it.q} onChange={(v) => editFaq(idx, "q", v)} testID={`cms-faq-q-${idx}`} />
              <CmsField label="Risposta (indica il percorso: es. Profilo › Impostazioni › Aspetto)" value={it.a} onChange={(v) => editFaq(idx, "a", v)} multiline testID={`cms-faq-a-${idx}`} />
              <Text style={s.lbl}>Visibile a (nessuno selezionato = tutti)</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {FAQ_ROLES.map((r) => { const on = (it.roles || []).includes(r.id); return (
                  <Pressable key={r.id} onPress={() => toggleFaqRole(idx, r.id)} style={[s.roleChip, on && s.roleChipOn]} testID={`cms-faq-role-${idx}-${r.id}`}><Text style={[s.roleChipTxt, on && { color: HT.violet }]}>{r.label}</Text></Pressable>
                ); })}
              </View>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={addFaq} style={[s.btn, { flex: 1 }]} testID="cms-faq-add"><Ionicons name="add" size={18} color="#FFF" /><Text style={s.btnTxt}>Aggiungi FAQ</Text></Pressable>
            <Pressable onPress={resetFaq} disabled={busy} style={[s.btn, s.btnDanger, { flex: 1 }]} testID="cms-faq-reset"><Ionicons name="refresh" size={16} color={HT.danger} /><Text style={[s.btnTxt, { color: HT.danger }]}>Ripristina FAQ</Text></Pressable>
          </View>
        </View>

        <Pressable onPress={reset} disabled={busy} style={[s.btn, s.btnDanger]} testID="cms-reset">
          <Ionicons name="refresh" size={18} color={HT.danger} /><Text style={[s.btnTxt, { color: HT.danger }]}>Ripristina testi e prezzi di default</Text>
        </Pressable>
      </KScrollView>
    </SafeAreaView>
  );
}

function CmsField({ label, value, onChange, multiline, numeric, testID }: { label: string; value: unknown; onChange: (v: unknown) => void; multiline?: boolean; numeric?: boolean; testID: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => { setText((cur) => (numeric && Number(cur.replace(",", ".")) === Number(value) ? cur : value == null ? "" : String(value))); }, [value, numeric]);
  const commit = (t: string) => {
    setText(t);
    if (numeric) { const n = t.replace(",", ".").replace(/[^\d.]/g, ""); onChange(n === "" ? 0 : Number(n)); } else onChange(t);
  };
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.lbl}>{label}</Text>
      <TextInput value={text} onChangeText={commit} multiline={multiline} keyboardType={numeric ? "decimal-pad" : "default"} style={[s.input, multiline && { minHeight: 90, textAlignVertical: "top" }]} placeholderTextColor={HT.muted} testID={testID} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.card}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: HT.text, fontSize: 20, fontWeight: "900" },
  sub: { color: HT.muted, fontSize: 12, fontWeight: "600" },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.violet, borderRadius: 999, minHeight: 40, paddingHorizontal: 14 },
  saveTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: HT.border, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: HT.text, fontSize: 15, fontWeight: "800" },
  sectionTitle: { color: HT.violet, fontSize: 13, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  muted: { color: HT.muted, fontSize: 12, lineHeight: 16 },
  roleChip: { paddingHorizontal: 10, minHeight: 32, justifyContent: "center", borderRadius: 16, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  roleChipOn: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  roleChipTxt: { color: HT.text2, fontSize: 12, fontWeight: "700" },
  ogImg: { width: "100%", aspectRatio: 1200 / 630, borderRadius: 10, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  lbl: { color: HT.text2, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, fontSize: 14, minHeight: 44 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.violet, borderRadius: 999, minHeight: 46, paddingHorizontal: 14 },
  btnDanger: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.danger + "66" },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13.5 },
  miniBtn: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: HT.card },
  planBox: { gap: 8, backgroundColor: HT.card2, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border },
});

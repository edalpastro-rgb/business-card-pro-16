// admin/landing-cms.tsx — V50.z530 — CMS della landing pubblica Axon Core (solo Super Admin + password LANDING_CMS_PASSWORD).
// Modifica senza toccare il codice: testi/titoli di ogni sezione, prezzi (barrato/attivo) e limite posti dei due piani Founder.
// Il contatore «posti rimasti» è calcolato dal backend: limite − account registrati con quel piano.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify, confirmAsync } from "@/src/utils/notify";
import { PasswordInput } from "@/src/PasswordInput";
import { KScrollView } from "@/src/ui/keyboard";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

type Content = Record<string, any>;
type Seats = Record<"builder" | "professional", { limit: number; taken: number; left: number }>;

function setPath(obj: Content, path: string[], value: unknown): Content {
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  const [head, ...rest] = path;
  (out as any)[head] = rest.length ? setPath((obj as any)[head] ?? {}, rest, value) : value;
  return out;
}
const getPath = (obj: Content, path: string[]) => path.reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), obj);

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
  const H = { "X-CMS-Password": password };

  useEffect(() => { api<{ super_admin: boolean }>("/admin/me").then((r) => setSuperAdmin(!!r.super_admin)).catch(() => setSuperAdmin(false)); }, []);

  const load = useCallback(async () => {
    const r = await api<{ content: Content; seats: Seats }>("/landing/cms/content", { headers: H });
    setContent(r.content); setSeats(r.seats); setDirty(false);
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
        <Text style={s.sub}>Testi, prezzi e posti Founder della pagina pubblica</Text>
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
        <View style={{ padding: 40, alignItems: "center", gap: 10 }}><Ionicons name="lock-closed" size={40} color={HT.muted} /><Text style={s.cardTitle}>Sezione riservata all&apos;amministratore</Text></View>
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
  lbl: { color: HT.text2, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, fontSize: 14, minHeight: 44 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.violet, borderRadius: 999, minHeight: 46, paddingHorizontal: 14 },
  btnDanger: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.danger + "66" },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13.5 },
  planBox: { gap: 8, backgroundColor: HT.card2, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border },
});

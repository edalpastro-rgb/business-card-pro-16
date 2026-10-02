// V50.z434 — Pannello Master: «Fort Knox» registrazione — rate limiting, honeypot, proof-of-work, Turnstile,
// blocco email usa-e-getta, URL privacy; statistiche dei tentativi bloccati. GET/PUT /admin/register-guard, GET …/stats
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Switch, RefreshControl } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { PasswordInput } from "@/src/PasswordInput";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)

type Cfg = {
  enabled: boolean; pow_difficulty: number; min_fill_ms: number; ip_per_hour: number; ip_per_day: number; email_per_day: number;
  block_disposable: boolean; extra_blocked_domains: string[]; turnstile_site_key: string; turnstile_secret_set: boolean; turnstile_secret_hint: string; privacy_url: string;
};
type Stats = {
  blocked_24h: number; blocked_7d: number; registered_24h: number; registered_7d: number; pending_verification: number;
  by_reason: { reason: string; count: number }[]; recent: { reason: string; ip: string; email: string; detail: string; at: string }[];
};
const REASON_LABEL: Record<string, string> = {
  honeypot: "Honeypot compilato (bot)", disposable_email: "Email usa-e-getta", rate_ip: "Troppe registrazioni da un IP", rate_email: "Troppi tentativi per email",
  challenge_missing: "Verifica mancante/riutilizzata", challenge_expired: "Verifica scaduta", too_fast: "Compilazione troppo rapida", pow_invalid: "Proof-of-work non valido", turnstile: "Turnstile non superato",
};

export default function RegisterGuardScreen() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [secret, setSecret] = useState("");
  const [domainsTxt, setDomainsTxt] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api<Cfg>("/admin/register-guard"), api<Stats>("/admin/register-guard/stats")]);
      setCfg(c); setStats(s); setDomainsTxt((c.extra_blocked_domains || []).join(", "));
    } catch (e: any) { notify("Errore", e?.message || "Impossibile caricare"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const body: any = {
        enabled: cfg.enabled, pow_difficulty: cfg.pow_difficulty, min_fill_ms: cfg.min_fill_ms, ip_per_hour: cfg.ip_per_hour, ip_per_day: cfg.ip_per_day,
        email_per_day: cfg.email_per_day, block_disposable: cfg.block_disposable, turnstile_site_key: cfg.turnstile_site_key, privacy_url: cfg.privacy_url,
        extra_blocked_domains: domainsTxt.split(/[,\s;]+/).map((d) => d.trim()).filter(Boolean),
      };
      if (secret.trim()) body.turnstile_secret = secret.trim();
      const r = await api<Cfg>("/admin/register-guard", { method: "PUT", body });
      setCfg(r); setSecret("");
      notify("Salvato", "Protezioni registrazione aggiornate.");
    } catch (e: any) { notify("Errore", e?.message || "Salvataggio non riuscito"); }
    finally { setSaving(false); }
  };

  const num = (k: keyof Cfg, v: string) => setCfg((c) => (c ? { ...c, [k]: Number(v.replace(/\D/g, "")) || 0 } : c));

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="guard-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Protezione registrazione</Text>
          <Text style={s.hSub}>Anti-bot «Fort Knox»: rate limit, honeypot, proof-of-work, Turnstile</Text>
        </View>
        <Pressable onPress={save} style={s.addBtn} disabled={saving || !cfg} testID="guard-save">
          {saving ? <ActivityIndicator color={C.onSurfaceInverse} /> : <><Ionicons name="save-outline" size={18} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Salva</Text></>}
        </Pressable>
      </View>
      {!cfg ? <ActivityIndicator style={{ marginTop: 40 }} color={VIOLET} /> : (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
            {stats && (
              <View style={s.statsRow}>
                {[["Bloccati 24h", stats.blocked_24h, C.error], ["Bloccati 7g", stats.blocked_7d, C.warning], ["Iscritti 24h", stats.registered_24h, C.success], ["Da attivare", stats.pending_verification, VIOLET]].map(([l, v, col]) => (
                  <View key={String(l)} style={s.stat}><Text style={[s.statV, { color: col as string }]}>{v as number}</Text><Text style={s.statL}>{l as string}</Text></View>
                ))}
              </View>
            )}

            <View style={s.card}>
              <View style={s.rowBetween}><Text style={s.cardTitle}>Protezioni attive</Text><Switch value={cfg.enabled} onValueChange={(v) => setCfg({ ...cfg, enabled: v })} trackColor={{ true: VIOLET }} testID="guard-enabled" /></View>
              <Text style={s.hint}>Sempre attive: honeypot, verifica monouso con tempo minimo, proof-of-work, rate limiting, email usa-e-getta, consenso privacy obbligatorio, codice email di attivazione.</Text>
              <View style={s.grid}>
                <Field label="Difficoltà PoW (2-6)" value={String(cfg.pow_difficulty)} onChange={(v) => num("pow_difficulty", v)} testID="guard-pow" />
                <Field label="Tempo minimo compilazione (ms)" value={String(cfg.min_fill_ms)} onChange={(v) => num("min_fill_ms", v)} testID="guard-minfill" />
                <Field label="Max per IP / ora" value={String(cfg.ip_per_hour)} onChange={(v) => num("ip_per_hour", v)} testID="guard-iph" />
                <Field label="Max per IP / giorno" value={String(cfg.ip_per_day)} onChange={(v) => num("ip_per_day", v)} testID="guard-ipd" />
                <Field label="Max tentativi per email / giorno" value={String(cfg.email_per_day)} onChange={(v) => num("email_per_day", v)} testID="guard-epd" />
              </View>
              <View style={s.rowBetween}><Text style={s.lblRow}>Blocca email usa-e-getta (lista integrata)</Text><Switch value={cfg.block_disposable} onValueChange={(v) => setCfg({ ...cfg, block_disposable: v })} trackColor={{ true: VIOLET }} /></View>
              <Text style={s.lbl}>Altri domini bloccati (separati da virgola)</Text>
              <TextInput value={domainsTxt} onChangeText={setDomainsTxt} placeholder="es. spam.it, fake-mail.com" placeholderTextColor={C.muted} style={s.input} autoCapitalize="none" testID="guard-domains" />
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Cloudflare Turnstile (CAPTCHA invisibile)</Text>
              <Text style={s.hint}>Gratuito: dash.cloudflare.com → Turnstile → Aggiungi sito (inserisci il dominio del backend e dell&apos;app). Si attiva appena la Secret Key è salvata.</Text>
              <Text style={s.lbl}>Site Key</Text>
              <TextInput value={cfg.turnstile_site_key} onChangeText={(v) => setCfg({ ...cfg, turnstile_site_key: v })} placeholder="0x4AAAAAAA…" placeholderTextColor={C.muted} style={s.input} autoCapitalize="none" testID="guard-ts-site" />
              <Text style={s.lbl}>Secret Key {cfg.turnstile_secret_set ? `(impostata: ${cfg.turnstile_secret_hint})` : "(non impostata)"}</Text>
              <PasswordInput value={secret} onChangeText={setSecret} placeholder={cfg.turnstile_secret_set ? "Lascia vuoto per non cambiare" : "0x4AAAAAAA…"} placeholderTextColor={C.muted} style={s.input} testID="guard-ts-secret" />
              {cfg.turnstile_secret_set && (
                <Pressable onPress={async () => { try { const r = await api<Cfg>("/admin/register-guard", { method: "PUT", body: { turnstile_secret: "", turnstile_site_key: "" } }); setCfg(r); notify("Turnstile disattivato"); } catch (e: any) { notify("Errore", e?.message); } }} style={s.linkBtn} testID="guard-ts-remove">
                  <Text style={s.linkTxt}>Rimuovi chiavi Turnstile</Text>
                </Pressable>
              )}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Informativa privacy</Text>
              <Text style={s.lbl}>URL mostrato nel modulo di registrazione</Text>
              <TextInput value={cfg.privacy_url} onChangeText={(v) => setCfg({ ...cfg, privacy_url: v })} placeholder="https://advisoros.it/privacy" placeholderTextColor={C.muted} style={s.input} autoCapitalize="none" keyboardType="url" testID="guard-privacy" />
            </View>

            {stats && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Tentativi bloccati (7 giorni)</Text>
                {stats.by_reason.length === 0 ? <Text style={s.hint}>Nessun tentativo bloccato.</Text> : stats.by_reason.map((r) => (
                  <View key={r.reason} style={s.rowBetween}><Text style={s.lblRow}>{REASON_LABEL[r.reason] || r.reason}</Text><Text style={s.count}>{r.count}</Text></View>
                ))}
                {stats.recent.slice(0, 10).map((r, i) => (
                  <Text key={i} style={s.recent}>{new Date(r.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {REASON_LABEL[r.reason] || r.reason} · {r.ip} · {r.email}</Text>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID: string }) {
  return (
    <View style={s.field}>
      <Text style={s.lbl}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="number-pad" style={s.input} testID={testID} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: VIOLET, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: C.divider },
  statV: { fontSize: 20, fontWeight: "900" },
  statL: { fontSize: 11, color: C.muted, textAlign: "center" },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  hint: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 36 },
  lblRow: { flex: 1, fontSize: 13.5, color: C.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  field: { flexGrow: 1, flexBasis: "45%", gap: 4 },
  lbl: { fontSize: 12, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: C.divider, borderRadius: 12, paddingHorizontal: 12, color: C.onSurface, backgroundColor: C.surface, fontSize: 15 },
  count: { fontSize: 15, fontWeight: "800", color: C.error },
  recent: { fontSize: 11.5, color: C.muted },
  linkBtn: { paddingVertical: 8 },
  linkTxt: { color: C.error, fontWeight: "700", fontSize: 13 },
});

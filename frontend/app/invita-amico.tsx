// V50.z322 — Pannello Master › «Invita un amico»: il mio codice + (Super Admin) premi configurabili e registro dei referral.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Switch } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { ReferralCard } from "@/src/ReferralCard";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)

type BenefitType = "free_weeks" | "free_months" | "premium" | "credits";
type Reward = { benefit_type: BenefitType; benefit_value: number; premium_days: number | null; summary: string };
type Settings = { enabled: boolean; inviter: Reward; invitee: Reward; total_referrals: number; benefits: { id: BenefitType; label: string }[] };
type Row = { referral_id: string; code: string; inviter: { email: string; name: string }; invitee: { email: string; name: string }; inviter_reward: string; invitee_reward: string; created_at: string };
type Lead = { user_id: string; email: string; name: string; code: string; count: number };

export default function InvitaAmicoScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [settings, setSettings] = useState<Settings | null | false>(null); // false = non super admin
  const [list, setList] = useState<{ items: Row[]; leaderboard: Lead[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const st = await api<Settings>("/admin/referral-settings");
      setSettings(st);
      setList(await api<{ items: Row[]; leaderboard: Lead[] }>("/admin/referrals"));
    } catch { setSettings(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="referral-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.hTitle}>Porta un amico</Text><Text style={s.hSub}>Codice personale · 30 crediti AI a te, 30 al collega</Text></View>
      </View>
      <KScrollView contentContainerStyle={[s.body, { paddingBottom: pagePad }]}>
        <ReferralCard />
        {settings === null ? <ActivityIndicator color={VIOLET} /> : settings ? (
          <>
            <WorkspaceReferralPanel />
            <AddonRequestsPanel />
            <RewardSettings settings={settings} onSaved={load} />
            <View style={s.card} testID="referral-admin-list">
              <Text style={s.title}>Registro referral · {list?.items.length ?? settings.total_referrals}</Text>
              {list && list.leaderboard.length > 0 ? (
                <View style={{ gap: 4, marginBottom: 8 }}>
                  <Text style={s.lbl}>Top invitanti</Text>
                  {list.leaderboard.map((l) => <Text key={l.user_id} style={s.row}>🏅 <Text style={s.bold}>{l.name}</Text> · {l.code} · {l.count} amic{l.count === 1 ? "o" : "i"}</Text>)}
                </View>
              ) : null}
              {list === null ? <ActivityIndicator color={VIOLET} /> : list.items.length === 0 ? <Text style={s.muted}>Nessun referral finora.</Text> : list.items.map((r) => (
                <View key={r.referral_id} style={s.refRow} testID={`referral-row-${r.referral_id}`}>
                  <Ionicons name="people" size={18} color={VIOLET} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.row}><Text style={s.bold}>{r.inviter.name}</Text> → <Text style={s.bold}>{r.invitee.name}</Text></Text>
                    <Text style={s.muted}>{r.invitee.email} · {new Date(r.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {r.code}</Text>
                    <Text style={s.muted}>Premi: invitante +{r.inviter_reward} · invitato +{r.invitee_reward}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </KScrollView>
    </SafeAreaView>
  );
}

// V50.z523 — pannello admin: programma «Porta un amico» attivabile per workspace + crediti base mensili + blocco a crediti esauriti
type WsRow = { tenant_id: string; email: string; name: string; app_name: string; referrals: number; enabled: boolean; monthly_base_credits: number; enforce_credits: boolean };
function WorkspaceReferralPanel() {
  const [data, setData] = useState<{ items: WsRow[]; program_enabled: boolean; defaults: { monthly_base_credits: number; inviter_credits: number; invitee_credits: number } } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(() => api<any>("/admin/referral/workspaces").then(setData).catch(() => setData(null)), []);
  useEffect(() => { load(); }, [load]);
  const put = async (tid: string, body: Partial<WsRow>) => {
    setBusy(tid);
    try { await api(`/admin/referral/workspaces/${tid}`, { method: "PUT", body }); await load(); }
    catch (e: any) { notify("Workspace", e?.message || "Aggiornamento non riuscito"); }
    finally { setBusy(null); }
  };
  if (!data) return null;
  const items = data.items.filter((w) => !q || `${w.email} ${w.name} ${w.app_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={s.card} testID="referral-workspaces">
      <Text style={s.title}>Programma per workspace</Text>
      <Text style={s.muted}>Attiva o disattiva «Porta un amico» per ogni workspace. Premi: {data.defaults.inviter_credits} crediti a chi invita (alla registrazione), {data.defaults.invitee_credits} al collega (all'abbonamento). Crediti base mensili di default: {data.defaults.monthly_base_credits}.</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="Cerca workspace (email, nome, app)…" placeholderTextColor={C.muted} style={[s.input, { width: "100%", marginVertical: 8 }]} testID="referral-ws-search" />
      {items.map((w) => (
        <View key={w.tenant_id} style={s.wsRow} testID={`referral-ws-${w.tenant_id}`}>
          <View style={{ flex: 1 }}>
            <Text style={s.bold} numberOfLines={1}>{w.app_name || w.name || w.email}</Text>
            <Text style={s.muted} numberOfLines={1}>{w.email} · {w.referrals} inviti · base {w.monthly_base_credits}/mese{w.enforce_credits ? " · blocco attivo" : ""}</Text>
          </View>
          <Pressable onPress={() => put(w.tenant_id, { enforce_credits: !w.enforce_credits })} disabled={busy === w.tenant_id} style={s.wsBtn} testID={`referral-ws-enforce-${w.tenant_id}`} accessibilityLabel="Blocco a crediti esauriti">
            <Ionicons name={w.enforce_credits ? "lock-closed" : "lock-open-outline"} size={16} color={VIOLET} />
          </Pressable>
          {busy === w.tenant_id ? <ActivityIndicator color={VIOLET} /> : <Switch value={w.enabled} onValueChange={(v) => put(w.tenant_id, { enabled: v })} testID={`referral-ws-toggle-${w.tenant_id}`} />}
        </View>
      ))}
    </View>
  );
}

// V50.z524 — pannello Master: richieste «pacchetto add-on» crediti AI arrivate dalla chat (402 crediti esauriti) → accredita bonus / rifiuta
type AddonReq = { req_id: string; email: string; name: string; note: string | null; balance: { base: number; bonus: number }; created_at: string };
function AddonRequestsPanel() {
  const [data, setData] = useState<{ items: AddonReq[]; default_credits: number } | null>(null);
  const [credits, setCredits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<any>("/admin/ai-credits/addon-requests").then(setData).catch(() => setData(null)), []);
  useEffect(() => { load(); }, [load]);
  const handle = async (r: AddonReq, action: "grant" | "reject") => {
    setBusy(r.req_id);
    const n = parseInt(credits[r.req_id] ?? "", 10);
    try {
      const res = await api<{ credits: number }>(`/admin/ai-credits/addon-requests/${r.req_id}/handle`, { method: "POST", body: { action, credits: action === "grant" && Number.isFinite(n) && n > 0 ? n : undefined } });
      notify(action === "grant" ? "Pacchetto accreditato ✅" : "Richiesta rifiutata", action === "grant" ? `+${res.credits} crediti AI bonus a ${r.name || r.email}` : r.email);
      await load();
    } catch (e: any) { notify("Add-on", e?.message || "Operazione non riuscita"); }
    finally { setBusy(null); }
  };
  if (!data) return null;
  return (
    <View style={s.card} testID="addon-requests">
      <Text style={s.title}>Richieste pacchetto add-on · {data.items.length}</Text>
      <Text style={s.muted}>Arrivano dalla chat quando un utente finisce i crediti AI del mese. I crediti accreditati sono bonus e non scadono (default {data.default_credits}).</Text>
      {data.items.length === 0 ? <Text style={s.muted}>Nessuna richiesta in attesa.</Text> : data.items.map((r) => (
        <View key={r.req_id} style={s.wsRow} testID={`addon-req-${r.req_id}`}>
          <View style={{ flex: 1 }}>
            <Text style={s.bold} numberOfLines={1}>{r.name || r.email}</Text>
            <Text style={s.muted} numberOfLines={2}>{r.email} · saldo base {r.balance?.base ?? 0} / bonus {r.balance?.bonus ?? 0} · {new Date(r.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}{r.note ? ` · «${r.note}»` : ""}</Text>
          </View>
          <TextInput value={credits[r.req_id] ?? String(data.default_credits)} onChangeText={(t) => setCredits((p) => ({ ...p, [r.req_id]: t.replace(/\D/g, "") }))} keyboardType="number-pad" style={[s.input, { width: 70 }]} testID={`addon-req-credits-${r.req_id}`} />
          {busy === r.req_id ? <ActivityIndicator color={VIOLET} /> : (
            <>
              <Pressable onPress={() => handle(r, "grant")} style={s.wsBtn} testID={`addon-req-grant-${r.req_id}`} accessibilityLabel="Accredita"><Ionicons name="checkmark" size={18} color={VIOLET} /></Pressable>
              <Pressable onPress={() => handle(r, "reject")} style={s.wsBtn} testID={`addon-req-reject-${r.req_id}`} accessibilityLabel="Rifiuta"><Ionicons name="close" size={18} color={C.muted} /></Pressable>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

function RewardEditor({ label, value, benefits, onChange }: { label: string; value: Reward; benefits: { id: BenefitType; label: string }[]; onChange: (r: Reward) => void }) {
  const isPremium = value.benefit_type === "premium";
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.lbl}>{label}</Text>
      <View style={s.chips}>
        {benefits.map((b) => {
          const on = b.id === value.benefit_type;
          return <Pressable key={b.id} onPress={() => onChange({ ...value, benefit_type: b.id, benefit_value: b.id === "credits" ? 50 : 1, premium_days: b.id === "premium" ? 14 : null })} style={[s.chip, on && s.chipOn]} testID={`referral-${label === "Chi invita" ? "inviter" : "invitee"}-${b.id}`}><Text style={[s.chipTxt, on && s.chipTxtOn]}>{b.label}</Text></Pressable>;
        })}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={s.muted}>{isPremium ? "Giorni di premium" : value.benefit_type === "credits" ? "Crediti" : value.benefit_type === "free_months" ? "Mesi" : "Settimane"}</Text>
        <TextInput
          value={String(isPremium ? (value.premium_days ?? "") : value.benefit_value)}
          onChangeText={(t) => { const n = parseInt(t.replace(/\D/g, ""), 10); onChange(isPremium ? { ...value, premium_days: Number.isFinite(n) ? n : null } : { ...value, benefit_value: Number.isFinite(n) ? n : 0 }); }}
          keyboardType="number-pad" style={s.input} testID={`referral-${label === "Chi invita" ? "inviter" : "invitee"}-value`}
        />
      </View>
    </View>
  );
}

function RewardSettings({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [inviter, setInviter] = useState<Reward>(settings.inviter);
  const [invitee, setInvitee] = useState<Reward>(settings.invitee);
  const [saving, setSaving] = useState(false);
  const valid = (r: Reward) => (r.benefit_type === "premium" ? (r.premium_days ?? 0) > 0 : r.benefit_value > 0);
  const save = async () => {
    if (saving || !valid(inviter) || !valid(invitee)) return;
    setSaving(true);
    try {
      await api("/admin/referral-settings", { method: "PUT", body: { enabled, inviter: { benefit_type: inviter.benefit_type, benefit_value: inviter.benefit_value || 1, premium_days: inviter.premium_days }, invitee: { benefit_type: invitee.benefit_type, benefit_value: invitee.benefit_value || 1, premium_days: invitee.premium_days } } });
      notify("Premi aggiornati ✅", "Valgono per i prossimi codici amico riscattati.");
      onSaved();
    } catch (e: any) { notify("Errore", e?.message); } finally { setSaving(false); }
  };
  return (
    <View style={s.card} testID="referral-settings">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={s.title}>Premi «Invita un amico» (Super Admin)</Text>
        <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: VIOLET }} testID="referral-enabled" />
      </View>
      <RewardEditor label="Chi invita" value={inviter} benefits={settings.benefits} onChange={setInviter} />
      <RewardEditor label="Chi arriva" value={invitee} benefits={settings.benefits} onChange={setInvitee} />
      <Pressable onPress={save} disabled={saving || !valid(inviter) || !valid(invitee)} style={[s.primary, (saving || !valid(inviter) || !valid(invitee)) && { opacity: 0.45 }]} testID="referral-settings-save">
        {saving ? <ActivityIndicator color={C.onSurfaceInverse} /> : <Text style={s.primaryTxt}>Salva premi</Text>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  wsBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  body: { padding: 16 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.divider, gap: 12, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  lbl: { fontSize: 11.5, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: VIOLET, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: VIOLET },
  chipTxt: { color: VIOLET, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: C.onSurfaceInverse },
  input: { width: 90, minHeight: 42, borderWidth: 1, borderColor: C.divider, borderRadius: 10, paddingHorizontal: 10, color: C.onSurface, backgroundColor: C.surface, fontSize: 15, fontWeight: "700" },
  primary: { minHeight: 48, borderRadius: 12, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center" },
  primaryTxt: { color: C.onSurfaceInverse, fontWeight: "800", fontSize: 15 },
  row: { fontSize: 13.5, color: C.onSurface },
  bold: { fontWeight: "800" },
  muted: { fontSize: 12, color: C.muted },
  refRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.divider },
});

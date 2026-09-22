// V50.z322 — Pannello Master › «Invita un amico»: il mio codice + (Super Admin) premi configurabili e registro dei referral.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Switch } from "react-native";
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
        <View style={{ flex: 1 }}><Text style={s.hTitle}>Invita un amico</Text><Text style={s.hSub}>Codice personale · premi per chi invita e chi arriva</Text></View>
      </View>
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: pagePad }]}>
        <ReferralCard />
        {settings === null ? <ActivityIndicator color={VIOLET} /> : settings ? (
          <>
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
      </ScrollView>
    </SafeAreaView>
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

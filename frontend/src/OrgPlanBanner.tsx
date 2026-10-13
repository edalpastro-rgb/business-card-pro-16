// OrgPlanBanner.tsx — V50.z541 — Riquadro «Utenti N/M · piano» per il Master/Manager (GET /org/plan) con «Passa al piano superiore».
// Upgrade: pagamento dal paywall (Stripe, piani del CMS) oppure richiesta al Supermaster (POST /org/plan/upgrade-request).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";

type OrgState = { plan: { id: string; label: string; max_users: number | null } | null; plan_id: string | null; used: number; max_users: number | null; left: number | null; over_limit: boolean; is_root: boolean; root_email?: string;
  upgrades: { id: string; label: string; price_month: number | null; max_users: number | null; quote: boolean }[]; super_admin: boolean };

export function OrgPlanBanner({ refreshKey, testID = "org-plan-banner" }: { refreshKey?: any; testID?: string }) {
  const router = useRouter();
  const [st, setSt] = useState<OrgState | null>(null);
  const load = useCallback(() => { api<OrgState>("/org/plan").then(setSt).catch(() => setSt(null)); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!st || st.super_admin) return null;
  const atLimit = st.max_users !== null && st.used >= st.max_users;
  const pct = st.max_users ? Math.min(1, st.used / st.max_users) : 0;
  const askUpgrade = () => {
    const payable = st.upgrades.filter((u) => !u.quote);
    const quote = st.upgrades.find((u) => u.quote);
    const request = async (plan_id: string) => {
      try { const r = await api<{ message: string }>("/org/plan/upgrade-request", { method: "POST", body: { plan_id } }); notify("Richiesta inviata", r.message); }
      catch (e: any) { notify("Errore", e?.message || ""); }
    };
    if (!st.is_root) { notify("Piano dell'organizzazione", `Il limite utenti è del Master (${st.root_email || "titolare"}): chiedi a lui l'upgrade.`); return; }
    const buttons: any[] = [];
    if (payable.length) buttons.push({ text: "Paga e passa subito (Stripe)", onPress: () => router.push("/paywall" as any) });
    if (quote) buttons.push({ text: `Richiedi preventivo (${quote.label})`, onPress: () => void request(quote.id) });
    if (payable[0]) buttons.push({ text: `Richiedi al Supermaster: ${payable[0].label}`, onPress: () => void request(payable[0].id) });
    if (Platform.OS === "web") {
      const first = payable[0] || quote;
      if (first && window.confirm(`Passare a «${first.label}»?\n\nOK = richiesta al Supermaster (ti ricontatta), Annulla = vai al pagamento.`)) void request(first.id); else router.push("/paywall" as any);
      return;
    }
    Alert.alert("Passa al piano superiore", `Oggi: ${st.plan?.label || "nessun piano"} · ${st.used}/${st.max_users ?? "∞"} utenti`, [...buttons, { text: "Annulla", style: "cancel" }]);
  };
  return (
    <View style={[s.wrap, atLimit && s.wrapWarn]} testID={testID}>
      <View style={s.row}>
        <Ionicons name="layers-outline" size={18} color={atLimit ? HT.danger : HT.violet} />
        <Text style={s.title} testID={`${testID}-usage`}>Utenti {st.used}{st.max_users !== null ? `/${st.max_users}` : ""} · {st.plan?.label || "Nessun piano (nessun limite)"}</Text>
        {st.upgrades.length && st.max_users !== null ? <Pressable onPress={askUpgrade} style={[s.btn, atLimit && s.btnWarn]} testID={`${testID}-upgrade`}><Text style={[s.btnTxt, atLimit && { color: "#FFF" }]}>{atLimit ? "Passa al piano superiore" : "Upgrade"}</Text></Pressable> : null}
      </View>
      {st.max_users !== null ? <View style={s.bar}><View style={[s.fill, { width: `${pct * 100}%` as any, backgroundColor: atLimit ? HT.danger : HT.violet }]} /></View> : null}
      {atLimit ? <Text style={s.warnTxt} testID={`${testID}-limit`}>Limite del piano raggiunto: non puoi aggiungere o invitare altri utenti finché non passi al piano superiore.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12, gap: 8 },
  wrapWarn: { borderColor: HT.danger + "88", backgroundColor: HT.dangerTint },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: HT.text, fontSize: 13.5, fontWeight: "800" },
  btn: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: HT.violet, backgroundColor: HT.violetTint },
  btnWarn: { backgroundColor: HT.danger, borderColor: HT.danger },
  btnTxt: { color: HT.violet, fontSize: 12.5, fontWeight: "800" },
  bar: { height: 6, borderRadius: 3, backgroundColor: HT.border, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  warnTxt: { color: HT.danger, fontSize: 12, lineHeight: 16 },
});

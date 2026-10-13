// OrgPlanPicker.tsx — V50.z541 — Scelta del piano alla registrazione (piani dal CMS Supermaster: GET /public/org-plans).
// Collaboratore singolo · Master fino a 10 · Master fino a 50 · Oltre 50 (preventivo). Il piano fissa il limite utenti dell'organizzazione.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BACKEND_URL } from "@/src/api";
import { HT } from "@/src/homeTheme";

export type OrgPlan = { id: string; label: string; price_month: number | null; max_users: number | null; quote: boolean; desc?: string | null; badge?: string | null };

export function useOrgPlans() {
  const [plans, setPlans] = useState<OrgPlan[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND_URL}/api/public/org-plans`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) setPlans(Array.isArray(j?.items) ? j.items : []); })
      .catch(() => { if (alive) setPlans([]); });
    return () => { alive = false; };
  }, []);
  return plans;
}

export function OrgPlanPicker({ value, onChange, onPlans, testID = "org-plan" }: { value?: string; onChange: (id: string) => void; onPlans?: (n: number) => void; testID?: string }) {
  const plans = useOrgPlans();
  useEffect(() => { if (plans !== null) onPlans?.(plans.length); }, [plans]); // eslint-disable-line react-hooks/exhaustive-deps
  if (plans === null) return <ActivityIndicator color={HT.violet} style={{ marginVertical: 8 }} />;
  if (!plans.length) return null;
  return (
    <View style={s.wrap} testID={testID}>
      {plans.map((p) => {
        const on = value === p.id;
        return (
          <Pressable key={p.id} onPress={() => onChange(p.id)} style={[s.card, on && s.cardOn]} testID={`${testID}-${p.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <View style={s.row}>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? HT.violet : HT.muted} />
              <Text style={[s.label, on && { color: HT.violet }]}>{p.label}</Text>
              {p.badge ? <View style={s.badge}><Text style={s.badgeTxt}>{p.badge}</Text></View> : null}
              <Text style={s.price}>{p.quote || p.price_month == null ? "Preventivo" : `${Number(p.price_month).toLocaleString("it-IT")}€/mese`}</Text>
            </View>
            {p.desc ? <Text style={s.desc}>{p.desc}</Text> : null}
            {!p.quote && p.max_users ? <Text style={s.meta}>{p.max_users === 1 ? "1 utente" : `fino a ${p.max_users} utenti nell'organizzazione`}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  card: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12, gap: 4 },
  cardOn: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { flex: 1, color: HT.text, fontSize: 14, fontWeight: "800" },
  price: { color: HT.text, fontSize: 13.5, fontWeight: "800" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: HT.violet },
  badgeTxt: { color: "#FFF", fontSize: 10.5, fontWeight: "800" },
  desc: { color: HT.text2, fontSize: 12.5, lineHeight: 17, paddingLeft: 28 },
  meta: { color: HT.muted, fontSize: 11.5, paddingLeft: 28 },
});

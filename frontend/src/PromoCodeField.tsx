// V50.z320 — Codice promozionale: campo opzionale (onboarding, saltabile) + card in Impostazioni › Abbonamento.
// POST /promo/redeem {code} → {message, benefit_summary}. Errori: 404 non valido · 410 scaduto/esaurito · 409 già usato.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)
/** V50.z322 — codice amico ricevuto via link /login?ref=…, precompilato al primo onboarding */
export const PENDING_REFERRAL_KEY = "pending_referral_code_v1";

type Props = {
  /** Onboarding: mostra «Salta» e chiama onDone dopo applicazione o salto */
  onDone?: () => void | Promise<void>;
  compact?: boolean;
};

export function PromoCodeField({ onDone, compact }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { AsyncStorage.getItem(PENDING_REFERRAL_KEY).then((c) => { if (c) setCode(c); }).catch(() => {}); }, []);

  const apply = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ message: string; benefit_summary: string }>("/promo/redeem", { method: "POST", body: { code: c } });
      setResult({ ok: true, text: `${r.benefit_summary} · ${r.message}` });
      setCode("");
      AsyncStorage.removeItem(PENDING_REFERRAL_KEY).catch(() => {});
    } catch (e: any) {
      setResult({ ok: false, text: e?.message || "Codice non valido" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.card, compact && s.cardCompact]} testID="promo-code-field">
      <View style={s.head}>
        <Ionicons name="pricetag" size={18} color={VIOLET} />
        <Text style={s.title}>Hai un codice promozionale o un codice amico?</Text>
      </View>
      <Text style={s.sub}>Inseriscilo qui{onDone ? " (facoltativo)" : ""}: il beneficio viene applicato subito al tuo account.</Text>
      <View style={s.row}>
        <TextInput
          value={code}
          onChangeText={(t) => { setCode(t.toUpperCase()); setResult(null); }}
          placeholder="ES. LANCIO2026 o AMICO-…"
          placeholderTextColor={C.muted}
          style={s.input}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={apply}
          testID="promo-code-input"
        />
        <Pressable onPress={apply} disabled={!code.trim() || busy} style={[s.btn, (!code.trim() || busy) && s.btnOff]} testID="promo-code-apply">
          {busy ? <ActivityIndicator size="small" color={C.onSurfaceInverse} /> : <Text style={s.btnTxt}>Applica</Text>}
        </Pressable>
      </View>
      {result ? (
        <View style={[s.res, result.ok ? s.resOk : s.resErr]} testID={result.ok ? "promo-code-success" : "promo-code-error"}>
          <Ionicons name={result.ok ? "checkmark-circle" : "alert-circle"} size={16} color={result.ok ? C.success : C.error} />
          <Text style={[s.resTxt, { color: result.ok ? C.success : C.error }]}>{result.text}</Text>
        </View>
      ) : null}
      {onDone ? (
        <Pressable onPress={() => void onDone()} style={s.skip} testID="promo-code-continue">
          <Text style={s.skipTxt}>{result?.ok ? "Continua" : "Salta, non ho un codice"}</Text>
          <Ionicons name="arrow-forward" size={16} color={VIOLET} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Card Impostazioni › Abbonamento: campo + storico dei codici usati */
export function PromoRedeemCard() {
  const [my, setMy] = useState<{ items: { code: string; benefit_summary: string; redeemed_at: string }[]; promo_credits: number; premium_until: string | null } | null>(null);
  const load = () => api<any>("/promo/my").then(setMy).catch(() => setMy({ items: [], promo_credits: 0, premium_until: null }));
  useEffect(() => { load(); }, []);
  return (
    <View testID="promo-redeem-card">
      <PromoCodeField compact />
      {my && (my.items.length > 0 || my.promo_credits > 0) ? (
        <View style={s.hist}>
          {my.promo_credits > 0 ? <Text style={s.histLine}>💎 Crediti AxonOS: <Text style={s.bold}>{my.promo_credits}</Text></Text> : null}
          {my.premium_until ? <Text style={s.histLine}>⭐ Premium fino al {new Date(my.premium_until).toLocaleDateString("it-IT")}</Text> : null}
          {my.items.map((it, i) => (
            <Text key={i} style={s.histLine} testID={`promo-my-${it.code}`}>🎟 <Text style={s.bold}>{it.code}</Text> · {it.benefit_summary} · {new Date(it.redeemed_at).toLocaleDateString("it-IT")}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.divider, gap: 10 },
  cardCompact: { marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "800", color: C.onSurface },
  sub: { fontSize: 13, color: C.muted, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minWidth: 0, minHeight: 46, borderWidth: 1, borderColor: C.divider, borderRadius: 12, paddingHorizontal: 12, color: C.onSurface, backgroundColor: C.surface, fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  btn: { minHeight: 46, minWidth: 92, paddingHorizontal: 14, borderRadius: 12, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center" },
  btnOff: { opacity: 0.45 },
  btnTxt: { color: C.onSurfaceInverse, fontWeight: "800", fontSize: 14 },
  res: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 10, borderRadius: 10 },
  resOk: { backgroundColor: C.success + "18" },
  resErr: { backgroundColor: C.error + "18" },
  resTxt: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  skip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 2 },
  skipTxt: { color: VIOLET, fontWeight: "700", fontSize: 14 },
  hist: { paddingHorizontal: 6, marginBottom: 12, gap: 4 },
  histLine: { fontSize: 12.5, color: C.muted },
  bold: { fontWeight: "800", color: C.onSurface },
});

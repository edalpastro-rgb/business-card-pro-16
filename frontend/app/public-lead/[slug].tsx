// V50.z103 — Pagina pubblica form Lead.
// Aperta da chiunque via link permanente condivisibile dal Master.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const BACKEND = (
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
  ""
).replace(/\/$/, "");

type NeedOpt = { id: string; label: string; emoji: string };
type Meta = { master_name: string; needs: NeedOpt[] };

export default function PublicLeadPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [needs, setNeeds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchMeta = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${BACKEND}/api/public/lead-form/${slug}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `HTTP ${r.status}`);
      }
      setMeta(await r.json());
    } catch (e: any) {
      setError(e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const toggleNeed = (id: string) => {
    setNeeds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const submit = async () => {
    if (fullName.trim().length < 2) return setError("Inserisci il tuo nome");
    if (!email.trim() && !phone.trim()) return setError("Inserisci almeno email o telefono");
    if (!consent) return setError("Devi accettare l'informativa privacy");
    setError("");
    setSubmitting(true);
    try {
      const r = await fetch(`${BACKEND}/api/public/lead-form/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          needs,
          free_text: freeText.trim(),
          consent_privacy: consent,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `HTTP ${r.status}`);
      }
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.message || "Errore invio");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}><ActivityIndicator size="large" color="#8B5CF6" /></View>
    </SafeAreaView>
  );

  if (error && !meta) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        <Ionicons name="alert-circle" size={48} color="#DC2626" />
        <Text style={styles.errorTitle}>Pagina non trovata</Text>
        <Text style={styles.errorSub}>{error}</Text>
      </View>
    </SafeAreaView>
  );

  if (submitted) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={40} color="#FFF" /></View>
        <Text style={styles.successTitle}>Richiesta inviata! 🎉</Text>
        <Text style={styles.successSub}>Ti ricontatteremo al più presto con una proposta su misura.</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.title}>Chiedi una consulenza gratuita ✨</Text>
          <Text style={styles.subtitle}>
            Compila il form e {meta?.master_name || "il tuo consulente"} ti risponderà con le soluzioni AdvisorOS più adatte.
          </Text>
        </View>

        <Text style={styles.lbl}>Nome e Cognome *</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Mario Rossi"
          placeholderTextColor={HT.muted}
          testID="lead-name"
        />

        <Text style={styles.lbl}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="tu@esempio.com"
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor={HT.muted}
          testID="lead-email"
        />

        <Text style={styles.lbl}>Telefono / WhatsApp</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="+39 333 1234567"
          keyboardType="phone-pad"
          placeholderTextColor={HT.muted}
          testID="lead-phone"
        />
        <Text style={styles.hint}>Almeno uno tra email e telefono è richiesto.</Text>

        <Text style={[styles.lbl, { marginTop: 18 }]}>Su cosa vuoi consulenza? (scegli quelli che ti interessano)</Text>
        <View style={styles.needsWrap}>
          {(meta?.needs || []).map((n) => {
            const active = needs.includes(n.id);
            return (
              <Pressable
                key={n.id}
                onPress={() => toggleNeed(n.id)}
                style={[styles.needChip, active && styles.needChipActive]}
                testID={`need-${n.id}`}
              >
                <Text style={styles.needEmoji}>{n.emoji}</Text>
                <Text style={[styles.needLbl, active && styles.needLblActive]}>{n.label}</Text>
                {active ? <Ionicons name="checkmark-circle" size={16} color="#8B5CF6" /> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.lbl, { marginTop: 18 }]}>Raccontaci di più (opzionale)</Text>
        <TextInput
          style={styles.textArea}
          value={freeText}
          onChangeText={setFreeText}
          placeholder="Es. Vorrei ridurre i costi delle bollette casa, ho un impianto vecchio..."
          multiline
          numberOfLines={5}
          placeholderTextColor={HT.muted}
          testID="lead-freetext"
        />

        <Pressable
          style={styles.consentRow}
          onPress={() => setConsent(!consent)}
          testID="lead-consent"
        >
          <View style={[styles.checkbox, consent && { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }]}>
            {consent ? <Ionicons name="checkmark" size={16} color="#FFF" /> : null}
          </View>
          <Text style={styles.consentTxt}>
            Ho letto e accetto l&apos;informativa sul trattamento dei dati personali (GDPR).
          </Text>
        </Pressable>

        {error ? <Text style={styles.errInline}>{error}</Text> : null}

        <Pressable
          style={[styles.submitBtn, (!consent || submitting || !fullName.trim()) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={!consent || submitting || !fullName.trim()}
          testID="lead-submit"
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="send" size={18} color="#FFF" />
              <Text style={styles.submitTxt}>Invia richiesta</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.footer}>🔒 I tuoi dati sono usati solo per rispondere alla tua richiesta.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: HT.card2 },
  scroll: { padding: 20, paddingBottom: 80 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  hero: { alignItems: "center", marginBottom: 20 },
  title: { fontSize: 24, fontWeight: "800", color: HT.text, textAlign: "center" },
  subtitle: { fontSize: 14, color: HT.muted, textAlign: "center", marginTop: 8, lineHeight: 20 },
  lbl: { fontSize: 12, fontWeight: "700", color: HT.text2, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: HT.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: HT.card,
    color: HT.text, fontSize: 15,
  },
  textArea: {
    borderWidth: 1, borderColor: HT.border, borderRadius: 12,
    padding: 14, backgroundColor: HT.card, color: HT.text,
    fontSize: 15, minHeight: 120,
    textAlignVertical: "top",
  },
  hint: { fontSize: 11, color: HT.muted, marginTop: 4 },
  needsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  needChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 22, borderWidth: 1.5, borderColor: HT.border,
    backgroundColor: HT.card,
  },
  needChipActive: { borderColor: '#8B5CF6', backgroundColor: "#8B5CF618" },
  needEmoji: { fontSize: 16 },
  needLbl: { fontSize: 13, color: HT.text2, fontWeight: "600" },
  needLblActive: { color: "#8B5CF6", fontWeight: "800" },
  consentRow: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "flex-start" },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: HT.borderStrong,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  consentTxt: { flex: 1, fontSize: 13, color: HT.text2, lineHeight: 18 },
  submitBtn: {
    marginTop: 24, backgroundColor: '#8B5CF6', paddingVertical: 15, borderRadius: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    ...Platform.select({ web: { cursor: "pointer" as any }, default: {} }),
  },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  errInline: { color: "#DC2626", fontSize: 13, marginTop: 12, textAlign: "center" },
  errorTitle: { fontSize: 18, fontWeight: "800", color: HT.text, marginTop: 12, textAlign: "center" },
  errorSub: { fontSize: 13, color: HT.muted, marginTop: 6, textAlign: "center" },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#10B981', alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: "800", color: HT.text, textAlign: "center" },
  successSub: { fontSize: 14, color: HT.muted, marginTop: 10, textAlign: "center", lineHeight: 20 },
  footer: { fontSize: 11, color: HT.muted, textAlign: "center", marginTop: 30 },
});

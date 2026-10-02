// V50.z101 — Pagina pubblica per la compilazione della recensione.
// Aperta dal cliente tramite link firmato (JWT) ricevuto via WA/Email/SMS/Telegram.
// Nessuna autenticazione richiesta.

import React, { useCallback, useEffect, useState } from "react";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { BACKEND_URL } from "@/src/api"; // V50.z431 — unico punto che definisce l'indirizzo del backend

// Ricava base URL backend (usa lo stesso approccio di src/api.ts ma senza auth)
const BACKEND = (
  BACKEND_URL ||
  (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL ||
  ""
).replace(/\/$/, "");

type FormInfo = {
  req_id: string;
  contact_name: string;
  channel: string;
  status: string;
  already_responded: boolean;
};

export default function PublicReviewPage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [rating, setRating] = useState<number>(0);
  const [textVal, setTextVal] = useState<string>("");
  const [consent, setConsent] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchInfo = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${BACKEND}/api/public/review-form/${token}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as FormInfo;
      setInfo(data);
      if (data.already_responded) setSubmitted(true);
    } catch (e: any) {
      setError(e?.message || "Impossibile caricare il modulo");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const submit = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${BACKEND}/api/public/review-form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          text: textVal.trim(),
          consent_publish: consent,
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !info) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color="#DC2626" />
          <Text style={styles.errorTitle}>Link non valido o scaduto</Text>
          <Text style={styles.errorSub}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={40} color="#FFF" />
          </View>
          <Text style={styles.successTitle}>Grazie di cuore! 🙏</Text>
          <Text style={styles.successSub}>
            La tua recensione è stata inviata. Sarà pubblicata dopo una veloce verifica del consulente.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>La tua opinione conta ✨</Text>
          <Text style={styles.subtitle}>
            {info?.contact_name ? `Ciao ${info.contact_name.split(" ")[0]}!` : "Ciao!"} Grazie per la fiducia. Bastano pochi secondi.
          </Text>
        </View>

        <Text style={styles.q}>Quante stelle vuoi lasciare?</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => setRating(n)}
              style={styles.starBtn}
              testID={`star-${n}`}
              accessibilityLabel={`${n} stelle`}
            >
              <Ionicons
                name={n <= rating ? "star" : "star-outline"}
                size={44}
                color={n <= rating ? "#F59E0B" : "#CBD5E1"}
              />
            </Pressable>
          ))}
        </View>
        <Text style={styles.ratingLabel}>
          {rating === 0 ? "Tocca le stelle per valutare" :
            rating === 1 ? "😕 Da migliorare" :
            rating === 2 ? "😐 Sufficiente" :
            rating === 3 ? "🙂 Buono" :
            rating === 4 ? "😊 Molto buono" :
            "🤩 Eccellente!"}
        </Text>

        <Text style={styles.q}>Vuoi lasciare un commento? (opzionale)</Text>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={6}
          value={textVal}
          onChangeText={setTextVal}
          placeholder="Racconta la tua esperienza…"
          placeholderTextColor={HT.muted}
          testID="review-text-input"
        />

        <Pressable
          style={styles.consentRow}
          onPress={() => setConsent(!consent)}
          testID="review-consent"
        >
          <View style={[styles.checkbox, consent && { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }]}>
            {consent ? <Ionicons name="checkmark" size={16} color="#FFF" /> : null}
          </View>
          <Text style={styles.consentTxt}>
            Autorizzo la pubblicazione della mia recensione (nome abbreviato) sulla pagina pubblica del consulente.
          </Text>
        </Pressable>

        {error ? <Text style={styles.errInline}>{error}</Text> : null}

        <Pressable
          style={[styles.submitBtn, (rating < 1 || submitting) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={rating < 1 || submitting}
          testID="review-submit-btn"
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="send" size={18} color="#FFF" />
              <Text style={styles.submitTxt}>Invia recensione</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.footer}>
          🔒 I tuoi dati sono trattati esclusivamente per la valutazione del servizio.
        </Text>
      </KScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: HT.card2 },
  scroll: { padding: 20, paddingBottom: 60 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  header: { alignItems: "center", marginBottom: 20 },
  title: { fontSize: 24, fontWeight: "800", color: HT.text, textAlign: "center" },
  subtitle: { fontSize: 14, color: HT.muted, textAlign: "center", marginTop: 8 },
  q: { fontSize: 14, fontWeight: "700", color: HT.text, marginTop: 20, marginBottom: 8 },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 6 },
  starBtn: { padding: 4 },
  ratingLabel: { textAlign: "center", fontSize: 13, color: HT.muted, marginTop: 6, fontWeight: "600" },
  textArea: {
    borderWidth: 1, borderColor: HT.border, borderRadius: 12,
    padding: 14, backgroundColor: HT.card, color: HT.text,
    fontSize: 15, minHeight: 130,
    textAlignVertical: "top",
  },
  consentRow: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "flex-start" },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: HT.borderStrong,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  consentTxt: { flex: 1, fontSize: 13, color: HT.text2, lineHeight: 18 },
  submitBtn: {
    marginTop: 24,
    backgroundColor: '#8B5CF6',
    paddingVertical: 15,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...Platform.select({
      web: { cursor: "pointer" as any },
      default: {},
    }),
  },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  errInline: { color: "#DC2626", fontSize: 13, marginTop: 12 },
  errorTitle: { fontSize: 18, fontWeight: "800", color: HT.text, marginTop: 12, textAlign: "center" },
  errorSub: { fontSize: 13, color: HT.muted, marginTop: 6, textAlign: "center" },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#10B981', alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: "800", color: HT.text, textAlign: "center" },
  successSub: { fontSize: 14, color: HT.muted, marginTop: 10, textAlign: "center", lineHeight: 20 },
  footer: { fontSize: 11, color: HT.muted, textAlign: "center", marginTop: 30 },
});

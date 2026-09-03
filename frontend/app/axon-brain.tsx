/**
 * V50.w — Cervello Axon (memoria distillata + profilo appreso)
 *
 * Vista + gestione della memoria a lungo termine che Axon costruisce
 * automaticamente ascoltando le conversazioni. L'utente può:
 *  - Vedere il profilo appreso (specializzazione, tono, preferenze)
 *  - Vedere ogni "fatto" memorizzato e rimuoverne singolarmente
 *  - Attivare/disattivare l'apprendimento automatico
 *  - Forzare una distillazione ora ("Aggiorna cervello")
 *  - Reset totale
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert,
  ActivityIndicator, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

type BrainFact = { fact_id: string; fact: string; category?: string; importance?: number };
type BrainProfile = {
  specialization?: string;
  tone?: string;
  jargon?: string;
  preferences?: string;
  style_markers?: string;
};

const CATEGORY_COLOR: Record<string, string> = {
  preferenze: "#7C3AED",
  specializzazione: "#0F9D58",
  clienti: "#1D4ED8",
  processo: "#EA580C",
  obiezioni: "#DC2626",
  altro: "#64748B",
};

export default function AxonBrainScreen() {
  const router = useRouter();
  const bottomInset = usePageBottomPadding();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [profile, setProfile] = useState<BrainProfile>({});
  const [facts, setFacts] = useState<BrainFact[]>([]);
  const [editSpec, setEditSpec] = useState("");
  const [editTone, setEditTone] = useState("");
  const [editPref, setEditPref] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<any>("/axon/brain");
      setEnabled(r?.learning_enabled !== false);
      setProfile(r?.profile || {});
      setFacts(Array.isArray(r?.facts) ? r.facts : []);
      setEditSpec(r?.profile?.specialization || "");
      setEditTone(r?.profile?.tone || "");
      setEditPref(r?.profile?.preferences || "");
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare il cervello");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLearning = async (v: boolean) => {
    setEnabled(v);
    try {
      await api("/axon/brain/settings", { method: "PUT", body: { learning_enabled: v } });
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
      setEnabled(!v);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api("/axon/brain/settings", {
        method: "PUT",
        body: { specialization: editSpec, tone: editTone, preferences: editPref },
      });
      notify("Profilo salvato ✅", "Axon ne terrà conto nelle prossime risposte");
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setSaving(false); }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api<any>("/axon/brain/refresh", { method: "POST" });
      if (r?.ok) {
        notify("Cervello aggiornato ✨", `${r?.facts_added || 0} nuovi fatti appresi`);
        await load();
      } else if (r?.skipped) {
        notify("Nulla di nuovo", "Non ho trovato pattern rilevanti da salvare");
      }
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setRefreshing(false); }
  };

  const removeFact = (fact_id: string) => {
    Alert.alert("Rimuovi fatto", "Sei sicuro?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Rimuovi", style: "destructive",
        onPress: async () => {
          try {
            await api(`/axon/brain/facts/${fact_id}`, { method: "DELETE" });
            setFacts((prev) => prev.filter((f) => f.fact_id !== fact_id));
          } catch (e: any) { notify("Errore", e?.message || String(e)); }
        }
      },
    ]);
  };

  const resetAll = () => {
    Alert.alert(
      "Cancella tutto il cervello",
      "Axon dimenticherà TUTTO quello che ha appreso su di te. Sei sicuro?",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Reset", style: "destructive",
          onPress: async () => {
            try {
              await api("/axon/brain/reset", { method: "POST" });
              notify("Cervello resettato", "Axon ricomincia da zero");
              await load();
            } catch (e: any) { notify("Errore", e?.message || String(e)); }
          }
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color="#7C3AED" size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.hBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.hTitle}>🧠 Cervello Axon</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: bottomInset }}>
        {/* Toggle apprendimento */}
        <View style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Apprendimento automatico</Text>
            <Text style={styles.cardSub}>
              {enabled ? "Axon apprende dalle tue conversazioni ogni ~8 messaggi" : "Axon NON apprenderà nulla di nuovo"}
            </Text>
          </View>
          <Switch value={enabled} onValueChange={toggleLearning} trackColor={{ true: "#7C3AED", false: "#334155" }} />
        </View>

        {/* Profilo comportamentale */}
        <Text style={styles.groupTitle}>Profilo comportamentale</Text>
        <View style={styles.formCard}>
          <Text style={styles.formLabel}>Specializzazione</Text>
          <TextInput
            value={editSpec}
            onChangeText={setEditSpec}
            placeholder="Es. Fotovoltaico residenziale, PMI, telco B2B…"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <Text style={styles.formLabel}>Tono preferito</Text>
          <TextInput
            value={editTone}
            onChangeText={setEditTone}
            placeholder="Es. amichevole ma preciso, breve e diretto…"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <Text style={styles.formLabel}>Preferenze (come vuoi le risposte)</Text>
          <TextInput
            value={editPref}
            onChangeText={setEditPref}
            placeholder="Es. sempre elenchi puntati, esempi numerici, saluto 'Buonasera'…"
            placeholderTextColor="#94A3B8"
            style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
            multiline
          />
          <Pressable onPress={saveProfile} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color="#0F172A" /> : (
              <><Ionicons name="save" size={16} color="#0F172A" /><Text style={styles.saveBtnTxt}>Salva profilo</Text></>
            )}
          </Pressable>
          {profile.jargon ? (
            <Text style={styles.autoTxt}>🤖 Gergo rilevato: {profile.jargon}</Text>
          ) : null}
          {profile.style_markers ? (
            <Text style={styles.autoTxt}>🤖 Stile rilevato: {profile.style_markers}</Text>
          ) : null}
        </View>

        {/* Refresh */}
        <Pressable onPress={refresh} disabled={refreshing} style={[styles.refreshBtn, refreshing && { opacity: 0.6 }]}>
          {refreshing ? <ActivityIndicator color="#FFF" /> : (
            <>
              <Ionicons name="sparkles" size={16} color="#FFF" />
              <Text style={styles.refreshTxt}>Aggiorna cervello ora</Text>
            </>
          )}
        </Pressable>

        {/* Facts */}
        <Text style={styles.groupTitle}>Fatti memorizzati ({facts.length})</Text>
        {facts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="bulb-outline" size={30} color="#64748B" />
            <Text style={styles.emptyTxt}>
              Nessun fatto ancora. Continua a chattare con Axon: dopo alcune conversazioni imparerà le tue preferenze automaticamente.
            </Text>
          </View>
        ) : (
          facts.map((f) => (
            <View key={f.fact_id} style={styles.factRow}>
              <View style={[styles.catDot, { backgroundColor: CATEGORY_COLOR[f.category || "altro"] || CATEGORY_COLOR.altro }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.factTxt}>{f.fact}</Text>
                {f.category ? <Text style={styles.factCat}>{f.category}</Text> : null}
              </View>
              <Pressable onPress={() => removeFact(f.fact_id)} hitSlop={10} style={styles.trashBtn}>
                <Ionicons name="close" size={18} color="#DC2626" />
              </Pressable>
            </View>
          ))
        )}

        {/* Reset */}
        {facts.length > 0 || profile.specialization ? (
          <Pressable onPress={resetAll} style={styles.resetBtn}>
            <Ionicons name="trash" size={16} color="#DC2626" />
            <Text style={styles.resetTxt}>Cancella tutto</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  hBtn: { padding: 6, minWidth: 30 },
  hTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  groupTitle: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(124,58,237,0.15)", borderColor: "rgba(124,58,237,0.4)", borderWidth: 1,
    padding: 14, borderRadius: 12, marginBottom: 4,
  },
  cardTitle: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  cardSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  formCard: { backgroundColor: "rgba(255,255,255,0.06)", padding: 12, borderRadius: 12, gap: 6 },
  formLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", marginTop: 6 },
  input: { backgroundColor: "#FFF", borderRadius: 10, padding: 10, color: "#0F172A", fontSize: 14 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#FBBF24", paddingVertical: 10, borderRadius: 999, marginTop: 8,
  },
  saveBtnTxt: { color: "#0F172A", fontWeight: "900", fontSize: 13 },
  autoTxt: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 6 },
  refreshBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#7C3AED", paddingVertical: 12, borderRadius: 999, marginTop: 10,
  },
  refreshTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  emptyBox: { alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, gap: 8 },
  emptyTxt: { color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center", lineHeight: 17 },
  factRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FFF", padding: 10, borderRadius: 10, marginBottom: 6,
  },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  factTxt: { color: "#0F172A", fontSize: 13, fontWeight: "600" },
  factCat: { color: "#64748B", fontSize: 10, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  trashBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#FEE2E2" },
  resetBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: "rgba(220,38,38,0.15)", borderWidth: 1, borderColor: "rgba(220,38,38,0.4)",
  },
  resetTxt: { color: "#DC2626", fontWeight: "800", fontSize: 12 },
});

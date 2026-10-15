// V50.z17 — HELP CENTER: schermata con termini d'uso dell'assistente AI
// AdvisorOS/AxonOS. Mostrata al primo utilizzo dell'assistente AxonOS e
// accessibile in qualsiasi momento dal FAB HELP CENTER e dall'Axon Center.
// L'utente può richiedere la cancellazione dei propri dati; la richiesta
// viene registrata e resa visibile all'amministratore (Master).

import { useState } from "react";
import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert, Modal, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { playActivationEffect } from "@/src/activation/events"; // V50.z335
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { useAuth } from "@/src/auth";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export const HELP_CENTER_SEEN_KEY = "helpcenter_seen_v1";

export default function HelpCenterScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ onboarding?: string; from?: string; deletion?: string }>();
  const isOnboarding = params?.onboarding === "1";
  const pagePad = usePageBottomPadding();
  // V50.z254 — ?deletion=1 (dal tab Help) apre subito il form di richiesta cancellazione dati
  const [askOpen, setAskOpen] = useState(params?.deletion === "1");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const isMaster = !user?.parent_user_id;

  const acknowledge = async () => {
    try {
      await AsyncStorage.setItem(HELP_CENTER_SEEN_KEY, "1");
    } catch { /* ignore */ }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as any);
  };

  const submitDeletion = async () => {
    if (sending) return;
    setSending(true);
    try {
      await api("/help-center/data-deletion-request", {
        method: "POST",
        body: { reason: reason.trim() },
      });
      setAskOpen(false);
      setReason("");
      Alert.alert(
        "Richiesta inviata",
        "La tua richiesta di cancellazione dati è stata registrata. Un amministratore la prenderà in carico.",
      );
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Invio richiesta fallito");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        {!isOnboarding ? (
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="help-center-back">
            <Ionicons name="chevron-back" size={24} color={HT.text} />
          </Pressable>
        ) : (
          <View style={{ width: 30 }} />
        )}
        <Text style={styles.headerTitle}>HELP CENTER</Text>
        {isMaster ? (
          <Pressable
            onPress={() => router.push("/help-center-admin" as any)}
            hitSlop={10}
            style={styles.adminBtn}
            testID="help-center-admin-btn"
          >
            <Ionicons name="shield-checkmark" size={20} color="#7C3AED" />
          </Pressable>
        ) : (
          <View style={{ width: 30 }} />
        )}
      </View>

      <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad, gap: 12 }}>
        {/* V50.z136 — Prima voce: riavvia il tour guidato (intro animata + libretto) */}
        <Pressable
          testID="help-replay-tour"
          onPress={async () => {
            try {
              await AsyncStorage.removeItem("libretto_seen_v1");
              if (user?.user_id) await AsyncStorage.removeItem(`onboarding_done_${user.user_id}`);
              await api("/user-settings", { method: "PUT", body: { onboarding_done: false } }).catch(() => {});
            } catch { /* silent */ }
            router.push("/tour" as any); // V50.z257
          }}
          style={styles.replayBtn}
        >
          <View style={styles.replayIcon}>
            <Ionicons name="sparkles" size={20} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.replayTitle}>Rifai il tour guidato</Text>
            <Text style={styles.replayHint}>Riparte dall'inizio: intro animata + giro guidato dell'app</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#FFF" />
        </Pressable>

        {/* V50.z335 — Rivedi l'introduzione: la connessione con Axon (onda, vibrazione, voce) senza rifare il tour */}
        <Pressable
          testID="help-replay-intro"
          onPress={async () => {
            try {
              const st = await api<{ assistant_name?: string; assistant_voice?: string }>("/user-settings");
              router.replace("/(tabs)/home" as any);
              setTimeout(() => playActivationEffect({ name: st?.assistant_name || "Axon", voice: st?.assistant_voice, greet: true }), 500);
            } catch { playActivationEffect({ name: "Axon", greet: true }); }
          }}
          style={styles.faqBtn}
        >
          <View style={[styles.faqIcon, { backgroundColor: HT.violetTint }]}><Ionicons name="flash" size={22} color="#7C3AED" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.faqTitle}>Rivedi l&apos;introduzione</Text>
            <Text style={styles.faqHint}>Il momento della connessione con Axon: onda, vibrazione e il suo saluto</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HT.muted} />
        </Pressable>

        {/* V50.z554 — Manuale completo: mappa di ogni funzione con ricerca full-text */}
        <Pressable testID="help-manual" onPress={() => router.push("/manuale" as any)} style={styles.faqBtn}>
          <View style={styles.faqIcon}><Ionicons name="map" size={22} color={HT.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.faqTitle}>Manuale completo dell&apos;app</Text>
            <Text style={styles.faqHint}>Tutte le funzioni: dove si trovano, cosa fanno, come si usano. Cerca «scanner», «Axon Lab», «landing page»…</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HT.muted} />
        </Pressable>

        {/* V50.z329 — FAQ (accordion) + link alla landing */}
        <Pressable testID="help-faq" onPress={() => router.push("/faq" as any)} style={styles.faqBtn}>
          <View style={styles.faqIcon}><Ionicons name="help-circle" size={22} color={HT.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.faqTitle}>Domande frequenti</Text>
            <Text style={styles.faqHint}>Axon Lab, addestramento Axon, salvataggio documenti, collaboratori, sicurezza</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HT.muted} />
        </Pressable>

        <View style={styles.badge}>
          <Ionicons name="shield-checkmark" size={20} color="#7C3AED" />
          <Text style={styles.badgeTxt}>Termini di utilizzo · assistente AI</Text>
        </View>

        <Text style={styles.h1}>
          Termini di utilizzo dell&apos;assistenza AdvisorOS basata sull&apos;intelligenza artificiale
        </Text>

        <Text style={styles.sub}>HELP CENTER</Text>

        <Text style={styles.p}>
          L&apos;accesso e l&apos;utilizzo dell&apos;agente basato sull&apos;intelligenza artificiale di
          AdvisorOS (&quot;Chatbot&quot;) sono soggetti alle presenti Condizioni d&apos;uso e alle
          Condizioni d&apos;uso del sito web.
        </Text>

        <Text style={styles.p}>
          Questo chatbot utilizza l&apos;intelligenza artificiale per fornirti informazioni utili
          e supporto basati sui dati e sulle regole di AdvisorOS. Sebbene cerchi di fornire
          risposte corrette, potrebbe non disporre sempre di informazioni complete. Ricorda che
          le risposte del chatbot non costituiscono consulenza legale o professionale e AdvisorOS
          non è responsabile per le azioni che intraprenderai sulla base di esse. Utilizzando il
          chatbot, riconosci che AdvisorOS utilizzerà e conserverà le tue informazioni personali
          affinché un rappresentante del Servizio Clienti AdvisorOS possa riprendere la
          conversazione, se richiesto, e/o inviarti un&apos;e-mail di approfondimento sulla nostra
          discussione. Utilizzeremo le tue informazioni come descritto nella nostra Informativa
          sulla privacy.
        </Text>

        <Text style={styles.h2}>Precisione</Text>
        <Text style={styles.p}>
          Sebbene ci impegniamo al massimo per includere informazioni accurate e aggiornate nel
          chatbot di AdvisorOS, basandoci sui dati e sulle regole di AdvisorOS, non garantiamo
          né dichiariamo che il chatbot sia privo di errori. Errori di inserimento dati o altri
          problemi tecnici potrebbero talvolta comportare la visualizzazione di informazioni
          inesatte.
        </Text>

        <Text style={styles.h2}>Feedback</Text>
        <Text style={styles.p}>
          Di tanto in tanto, potresti fornire ad AdvisorOS suggerimenti, idee o altri feedback
          relativi al Chatbot (&quot;Feedback&quot;). AdvisorOS sarà proprietaria di tale Feedback
          e avrà il diritto, ma non l&apos;obbligo, di utilizzarlo, svilupparlo e sfruttarlo in
          qualsiasi modo, senza alcuna restrizione o obbligo di compenso o di richiesta di
          autorizzazione da parte tua. AdvisorOS potrà utilizzare il Feedback per addestrare il
          Chatbot.
        </Text>

        <Text style={styles.h2}>Utilizzo dei dati delle conversazioni</Text>
        <Text style={styles.p} testID="help-privacy-training">
          AdvisorOS utilizza dati aggregati e anonimizzati delle conversazioni con AxonOS per
          migliorare la qualità delle risposte, delle regole e dei modelli di AxonOS. In questo
          processo NON vengono raccolti né utilizzati dati sensibili: nomi di persone e aziende,
          cifre, importi, numeri di telefono, indirizzi, e-mail e ogni riferimento personale vengono
          rimossi o resi anonimi prima dell&apos;aggregazione. I tuoi contatti, le tue bollette e i tuoi
          documenti restano isolati nel tuo spazio (multi-tenant) e non sono mai visibili ad altri
          clienti né condivisi con terze parti.
        </Text>

        <Text style={styles.h2}>Registri delle sessioni</Text>
        <Text style={styles.p}>
          I registri delle sessioni vengono conservati per un massimo di 24 ore dalla conclusione
          della sessione. Gli operatori del servizio clienti possono accedere al registro delle sessioni
          per fornirti ulteriore assistenza. Se desideri che AdvisorOS elimini il registro delle
          tue sessioni prima della scadenza del periodo di conservazione, ti preghiamo di
          contattarci utilizzando i recapiti indicati di seguito.
        </Text>

        <Pressable style={styles.deleteBtn} onPress={() => setAskOpen(true)} testID="request-deletion-btn">
          <Ionicons name="trash-outline" size={18} color="#DC2626" />
          <Text style={styles.deleteTxt}>Richiedi cancellazione dei miei dati</Text>
        </Pressable>

        <View style={styles.contactBox}>
          <Ionicons name="mail-outline" size={16} color={HT.muted} />
          <Text style={styles.contactTxt}>Contatti: support@advisoros.it</Text>
        </View>

        {isOnboarding ? (
          <Pressable style={styles.gotIt} onPress={acknowledge} testID="got-it-btn">
            <Ionicons name="checkmark-circle" size={20} color="#FFF" />
            <Text style={styles.gotItTxt}>Ho capito</Text>
          </Pressable>
        ) : null}
      </KScrollView>

      {/* Modal richiesta cancellazione */}
      <Modal
        transparent
        visible={askOpen}
        animationType="fade"
        onRequestClose={() => setAskOpen(false)}
        statusBarTranslucent
      ><KModalBody>
        <View style={styles.mBackdrop}>
          <View style={styles.mBox}>
            <View style={styles.mHeaderRow}>
              <View style={styles.mIcon}>
                <Ionicons name="alert-circle" size={20} color="#DC2626" />
              </View>
              <Text style={styles.mTitle}>Cancellazione dati</Text>
            </View>
            <Text style={styles.mHint}>
              Un amministratore riceverà la tua richiesta e provvederà alla cancellazione secondo
              i tempi previsti dall&apos;Informativa sulla privacy.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Motivo (opzionale)"
              placeholderTextColor={HT.muted}
              multiline
              style={styles.mInput}
              maxLength={2000}
              testID="deletion-reason-input"
            />
            <View style={styles.mBtnRow}>
              <Pressable style={styles.mCancel} onPress={() => setAskOpen(false)}>
                <Text style={styles.mCancelTxt}>Annulla</Text>
              </Pressable>
              <Pressable
                style={[styles.mConfirm, sending && { opacity: 0.6 }]}
                onPress={submitDeletion}
                disabled={sending}
                testID="deletion-confirm-btn"
              >
                {sending ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.mConfirmTxt}>Invia richiesta</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KModalBody></Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // V50.z137 — bottone prominente (pieno, colore brand) come prima voce dell'Help Center
  replayBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: '#7C3AED', borderRadius: 14, padding: 16, minHeight: 68, shadowColor: "#7C3AED", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  replayIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  replayTitle: { fontSize: 16, fontWeight: "900", color: "#FFF" },
  replayHint: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  faqBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card2, borderRadius: 14, padding: 14, minHeight: 64, borderWidth: 1, borderColor: HT.border },
  faqIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  faqTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  faqHint: { fontSize: 12, color: HT.muted, marginTop: 2 },
  root: { flex: 1, backgroundColor: HT.card2 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: HT.border,
    backgroundColor: HT.card,
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  adminBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "900", color: HT.text, letterSpacing: 0.4 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: "flex-start",
  },
  badgeTxt: { fontSize: 11, color: "#7C3AED", fontWeight: "800", letterSpacing: 0.2 },
  h1: { fontSize: 18, fontWeight: "800", color: HT.text, lineHeight: 24, marginTop: 4 },
  sub: { fontSize: 12, fontWeight: "900", color: "#7C3AED", letterSpacing: 1.5, marginTop: -6 },
  h2: { fontSize: 15, fontWeight: "800", color: HT.text, marginTop: 8 },
  p: { fontSize: 13, color: HT.text2, lineHeight: 20 },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 8, paddingVertical: 14, borderRadius: 12,
    backgroundColor: HT.dangerTint, borderWidth: 1, borderColor: HT.danger + '66',
  },
  deleteTxt: { color: "#DC2626", fontWeight: "800", fontSize: 14 },
  contactBox: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6,
    alignSelf: "center",
  },
  contactTxt: { fontSize: 12, color: HT.muted },
  gotIt: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 8, paddingVertical: 16, borderRadius: 999,
    backgroundColor: '#7C3AED',
    shadowColor: "#7C3AED", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  gotItTxt: { color: "#FFF", fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },
  // Modal
  mBackdrop: {
    flex: 1, backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  mBox: {
    width: "100%", maxWidth: 420, backgroundColor: HT.card, borderRadius: 16,
    padding: 16, gap: 10,
    ...Platform.select({ ios: {}, android: { elevation: 8 } }),
  },
  mHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  mIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: HT.dangerTint,
    alignItems: "center", justifyContent: "center",
  },
  mTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  mHint: { fontSize: 13, color: HT.muted, lineHeight: 18 },
  mInput: {
    borderWidth: 1, borderColor: HT.border, borderRadius: 12,
    padding: 12, fontSize: 14, color: HT.text,
    minHeight: 90, textAlignVertical: "top", backgroundColor: HT.card2,
  },
  mBtnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  mCancel: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    backgroundColor: HT.card2,
  },
  mCancelTxt: { color: HT.text, fontWeight: "800", fontSize: 14 },
  mConfirm: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    backgroundColor: '#DC2626',
  },
  mConfirmTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
});

/**
 * V50.n — OnboardingWizard: modal 3-step per nuovi Master.
 *
 * Mostrato al primo login di ogni Master (persistenza tramite AsyncStorage
 * chiave `onboarding_v1_dismissed_${user_id}`). Ogni step ha:
 *  - un titolo breve
 *  - una descrizione di 1-2 frasi
 *  - una CTA che porta direttamente alla sezione dell'app
 *
 * L'utente può "Salta tutto" per non vederlo più.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const C = theme.color;

type Step = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  cta: string;
  action: () => void;
};

export function OnboardingWizard() {
  const { user } = useAuth();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);

  const STORAGE_KEY = user ? `onboarding_v1_dismissed_${user.user_id}` : null;

  useEffect(() => {
    if (!user || !STORAGE_KEY) return;
    // Solo per Master
    const role = (user as any).role || "";
    if (role !== "master") return;
    (async () => {
      try {
        const dismissed = await AsyncStorage.getItem(STORAGE_KEY);
        if (!dismissed) setVisible(true);
      } catch {}
    })();
  }, [user, STORAGE_KEY]);

  const dismiss = async () => {
    setVisible(false);
    if (STORAGE_KEY) {
      try { await AsyncStorage.setItem(STORAGE_KEY, "1"); } catch {}
    }
  };

  const goTo = async (path: string) => {
    await dismiss();
    setTimeout(() => router.push(path as any), 100);
  };

  const steps: Step[] = [
    {
      key: "rule",
      icon: "book",
      title: "1. Insegna ad Axon la prima regola",
      desc: "Le regole in 'Insegna ad Axon' rendono le risposte precise sul tuo modo di lavorare. Bastano 30 secondi.",
      cta: "Crea la prima regola",
      action: () => goTo("/ai-teach"),
    },
    {
      key: "bill",
      icon: "flash",
      title: "2. Analizza la tua prima bolletta",
      desc: "Carica un PDF di bolletta luce/gas — Axon estrae POD, PDR, consumi e scadenze in 5 secondi. Poi la salva sul cliente.",
      cta: "Vai al Master → Analizza bolletta",
      action: () => goTo("/master"),
    },
    {
      key: "axon",
      icon: "sparkles",
      title: "3. Chiedi qualcosa ad Axon",
      desc: "Tocca la 🔮 in basso e chiedi in linguaggio naturale: «Tabella PUN F1 F2 F3 luglio 2026», «Chi non ha appuntamenti da 90gg?», o digita /aiuto per i comandi rapidi.",
      cta: "Apri Axon",
      action: async () => {
        await dismiss();
        // Trigger axon fab: the fab listens for a global event; here we just close and rely on user tapping it.
      },
    },
  ];

  const step = steps[current];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === current && styles.dotActive]}
                />
              ))}
            </View>
            <Pressable onPress={dismiss} hitSlop={10} testID="onboarding-skip">
              <Text style={styles.skip}>Salta</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.iconWrap}>
              <Ionicons name={step.icon} size={40} color="#FFF" />
            </View>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.desc}>{step.desc}</Text>
          </ScrollView>

          <View style={styles.footer}>
            {current > 0 ? (
              <Pressable onPress={() => setCurrent(current - 1)} style={[styles.btn, styles.btnGhost]}>
                <Ionicons name="chevron-back" size={18} color={C.navy} />
                <Text style={styles.btnGhostTxt}>Indietro</Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Pressable onPress={step.action} style={[styles.btn, styles.btnPrimary]} testID={`onboarding-cta-${step.key}`}>
              <Text style={styles.btnPrimaryTxt}>{step.cta}</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFF" />
            </Pressable>
          </View>

          {current < steps.length - 1 && (
            <Pressable
              onPress={() => setCurrent(current + 1)}
              hitSlop={8}
              style={styles.nextLater}
              testID="onboarding-next"
            >
              <Text style={styles.nextLaterTxt}>Continua l&apos;onboarding →</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,36,56,0.75)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: HT.card,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dots: { flexDirection: "row", gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: HT.border,
  },
  dotActive: { backgroundColor: C.primary, width: 22 },
  skip: { color: C.muted, fontSize: 13, fontWeight: "700" },
  content: { alignItems: "center", paddingVertical: 8 },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: C.navy,
    textAlign: "center",
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    color: C.muted,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    gap: 8,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  btnPrimary: {
    backgroundColor: C.primary,
    flex: 1,
    justifyContent: "center",
  },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  btnGhost: {
    backgroundColor: HT.card2,
  },
  btnGhostTxt: { color: C.navy, fontWeight: "700", fontSize: 13 },
  nextLater: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 6,
  },
  nextLaterTxt: {
    fontSize: 13,
    color: C.primary,
    fontWeight: "700",
  },
});

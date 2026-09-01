/**
 * V50.p — MicroTutorial: slideshow animato di step per spiegare in 15s
 * come funziona una feature. Se `videoUri` è fornito → riproduce il video;
 * altrimenti mostra uno slideshow di step animati con icona + testo.
 *
 * Usato dentro le info modal di "Analizza bolletta" e "Insegna ad Axon"
 * per abbattere la barriera cognitiva del 70% (numeri stimati).
 *
 * Uso:
 *   <MicroTutorial
 *     steps={[
 *       { icon: 'cloud-upload-outline', title: 'Carica il PDF', desc: 'Tocca "Carica bolletta"' },
 *       { icon: 'sparkles-outline', title: "L'AI estrae i dati", desc: 'POD, PDR, consumi, scadenze' },
 *       { icon: 'save-outline', title: 'Si salva sul cliente', desc: 'Report esportabile e condivisibile' },
 *     ]}
 *     videoUri={undefined} // futuro: URL di un mp4 da 15s
 *   />
 */
import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Animated, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

const C = theme.color;

export type TutorialStep = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  color?: string;
};

type Props = {
  steps: TutorialStep[];
  videoUri?: string;
  autoplayMs?: number; // 0 = disable autoplay
};

export function MicroTutorial({ steps, videoUri, autoplayMs = 3500 }: Props) {
  const [idx, setIdx] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;

  // Video placeholder: se in futuro passi un videoUri, qui puoi montare
  // un <expo-video> Player. Per ora fallback slideshow animato.
  const useVideo = false && !!videoUri;

  useEffect(() => {
    if (useVideo) return;
    if (!autoplayMs || steps.length <= 1) return;
    const t = setInterval(() => {
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(slide, { toValue: -12, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setIdx(prev => (prev + 1) % steps.length);
        slide.setValue(12);
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(slide, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start();
      });
    }, autoplayMs);
    return () => clearInterval(t);
  }, [autoplayMs, steps.length, fade, slide, useVideo]);

  if (!steps || steps.length === 0) return null;
  const step = steps[idx];
  const color = step.color || C.primary;

  return (
    <View style={styles.wrap} testID="micro-tutorial">
      <View style={styles.card}>
        <Animated.View style={{ opacity: fade, transform: [{ translateX: slide }], alignItems: "center" }}>
          <View style={[styles.iconBg, { backgroundColor: color }]}>
            <Ionicons name={step.icon} size={32} color="#FFF" />
          </View>
          <View style={styles.stepPill}>
            <Text style={styles.stepPillTxt}>Step {idx + 1} di {steps.length}</Text>
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.desc}>{step.desc}</Text>
        </Animated.View>
      </View>
      {steps.length > 1 && (
        <View style={styles.dots}>
          {steps.map((_, i) => (
            <Pressable key={i} onPress={() => setIdx(i)} hitSlop={6}>
              <View style={[styles.dot, i === idx && { backgroundColor: color, width: 22 }]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginVertical: 12,
  },
  card: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    alignItems: "center",
    minHeight: 200,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  iconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  stepPill: {
    backgroundColor: "#EEF2FF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  stepPillTxt: { fontSize: 10, fontWeight: "800", color: "#6366F1", letterSpacing: 0.8 },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: C.navy,
    marginBottom: 6,
    textAlign: "center",
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
    color: C.muted,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  dots: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
  },
});

// V50.p — Preset step per le feature principali
export const TUTORIAL_ANALIZZA_BOLLETTA: TutorialStep[] = [
  {
    icon: "cloud-upload-outline",
    title: "Carica il PDF della bolletta",
    desc: "Tocca 'Carica fattura PDF' su Luce, Gas o Telco. Anche foto della bolletta cartacea vanno bene.",
    color: "#F59E0B",
  },
  {
    icon: "sparkles-outline",
    title: "L'AI estrae tutto in 5 secondi",
    desc: "POD/PDR, consumi annui, potenza, tariffa attuale, scadenze pagamento, IVA. Nessuna trascrizione manuale.",
    color: "#7C3AED",
  },
  {
    icon: "documents-outline",
    title: "Report salvato sul cliente",
    desc: "La bolletta si aggancia al cliente. Puoi confrontarla con le offerte aziendali, condividere il report PDF via WhatsApp e archiviare.",
    color: "#10B981",
  },
];

export const TUTORIAL_INSEGNA_AXON: TutorialStep[] = [
  {
    icon: "book-outline",
    title: "Regole in linguaggio naturale",
    desc: "Scrivi come parleresti a un collega: 'Quando un cliente chiede X, proponigli Y'. Axon memorizza e applica.",
    color: "#38BDF8",
  },
  {
    icon: "globe-outline",
    title: "URL come fonti dinamiche",
    desc: "Inserisci link ad ARERA, GME, listini fornitori. Axon fetcha e legge PDF/pagine live quando serve.",
    color: "#0EA5E9",
  },
  {
    icon: "flame-outline",
    title: "Suggerimenti auto-generati",
    desc: "Ogni notte Axon analizza le tue chat e propone nuove regole. Approva con un tap e diventano parte del suo cervello.",
    color: "#EA580C",
  },
];

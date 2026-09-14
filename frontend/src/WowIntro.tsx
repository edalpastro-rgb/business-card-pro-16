import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { BrainPlus } from "@/src/BrainPlus"; // V50.z190 — claim AxonOS Brain+

/**
 * V50.z136 — Intro animata "effetto wow" del tour di onboarding.
 * 100% offline (nessun video/YouTube): slide con fade + slide-in + zoom,
 * orbite di icone che pulsano, sfondo con bolle animate. Avanza da sola ogni
 * ~4.2s, oppure tap su "Avanti"; l'ultima slide ha "Inizia il tour".
 */
type Slide = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  title: string;
  body: string;
  orbit: React.ComponentProps<typeof Ionicons>["name"][];
};

const SLIDES: Slide[] = [
  { key: "welcome", icon: "sparkles", color: "#FBBF24", title: "Benvenuto in AdvisorOS", body: "Il CRM pensato per consulenti, venditori, agenzie e network. Tutto in un'unica app, sempre con te.", orbit: ["people", "calendar", "flash", "document-text"] },
  { key: "crm", icon: "people", color: "#0EA5E9", title: "Contatti & Calendario", body: "Anagrafiche complete, appuntamenti condivisi con il cliente via WhatsApp o email, scadenze contratti sotto controllo.", orbit: ["call", "location", "time", "notifications"] },
  { key: "axon", icon: "chatbubbles", color: "#8B5CF6", title: "AxonOS, il tuo assistente AI", body: "Chiedi a voce o per iscritto: PUN, bollette, clienti, timer e promemoria. Impara dalle tue regole e ti risponde in streaming.", orbit: ["mic", "bar-chart", "bulb", "alarm"] },
  { key: "docs", icon: "scan", color: "#22C55E", title: "Scanner & Documenti", body: "Scansiona bollette e contratti con ritaglio automatico, analizzali con l'AI e archiviali su Drive.", orbit: ["camera", "cloud-upload", "analytics", "folder"] },
];

const AUTO_MS = 4200;

function Bubble({ size, x, y, delay, color }: { size: number; x: number; y: number; delay: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3800 + delay, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [delay, t]);
  const st = useAnimatedStyle(() => ({
    transform: [{ translateY: -18 * t.value }, { scale: 0.9 + 0.2 * t.value }],
    opacity: 0.18 + 0.12 * t.value,
  }));
  return <Animated.View pointerEvents="none" style={[styles.bubble, { width: size, height: size, borderRadius: size / 2, left: x, top: y, backgroundColor: color }, st]} />;
}

function OrbitIcon({ name, index, color }: { name: Slide["orbit"][number]; index: number; color: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withDelay(index * 220, withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })), -1, true));
  }, [index, pulse]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.12 * pulse.value }], opacity: 0.75 + 0.25 * pulse.value }));
  const angle = (index / 4) * Math.PI * 2 - Math.PI / 2;
  const r = 86;
  return (
    <Animated.View
      entering={ZoomIn.delay(350 + index * 120).springify()}
      style={[styles.orbitIcon, { left: 110 + r * Math.cos(angle) - 22, top: 110 + r * Math.sin(angle) - 22 }, st]}
    >
      <Ionicons name={name} size={20} color={color} />
    </Animated.View>
  );
}

export function WowIntro({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slide = SLIDES[idx];
  const last = idx === SLIDES.length - 1;

  const next = useCallback(() => {
    setIdx((i) => (i < SLIDES.length - 1 ? i + 1 : i));
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!last) timer.current = setTimeout(next, AUTO_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [idx, last, next]);

  const bubbles = useMemo(
    () => [
      { size: 220, x: -60, y: 40, delay: 0, color: "#38BDF8" },
      { size: 160, x: width - 90, y: 140, delay: 600, color: "#A78BFA" },
      { size: 120, x: width * 0.55, y: 420, delay: 300, color: "#34D399" },
      { size: 90, x: 30, y: 520, delay: 900, color: "#FBBF24" },
    ],
    [width],
  );

  return (
    <Animated.View style={styles.root} entering={FadeIn.duration(400)} exiting={FadeOut.duration(350)} testID="wow-intro">
      {bubbles.map((b, i) => <Bubble key={i} {...b} />)}

      {/* Logo */}
      <Animated.View entering={FadeInDown.duration(600)} style={styles.logoRow}>
        <Image source={require("@/assets/images/advisoros-logo-transparent.png")} style={styles.logo} resizeMode="contain" />
      </Animated.View>

      {/* Hero icon + orbit (re-mounted per slide → animazioni di ingresso) */}
      <View key={slide.key} style={styles.heroWrap}>
        <Animated.View entering={ZoomIn.duration(650).springify().damping(12)} style={[styles.heroCircle, { backgroundColor: slide.color + "22", borderColor: slide.color }]}>
          <Ionicons name={slide.icon} size={64} color={slide.color} />
        </Animated.View>
        {slide.orbit.map((n, i) => <OrbitIcon key={n} name={n} index={i} color={slide.color} />)}
      </View>

      <View key={`t-${slide.key}`} style={styles.textWrap}>
        <Animated.Text entering={FadeInUp.delay(150).duration(550)} style={styles.title}>{slide.title}</Animated.Text>
        {slide.key === "axon" ? (
          <Animated.View entering={FadeInUp.delay(250).duration(550)}>
            <BrainPlus dark size={24} tagline align="center" style={{ marginBottom: 8 }} testID="wow-brainplus" />
          </Animated.View>
        ) : null}
        <Animated.Text entering={FadeInUp.delay(320).duration(550)} style={styles.body}>{slide.body}</Animated.Text>
      </View>

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <Pressable key={s.key} onPress={() => setIdx(i)} hitSlop={8}>
            <View style={[styles.dot, i === idx && { backgroundColor: slide.color, width: 22 }]} />
          </Pressable>
        ))}
      </View>

      {/* CTA */}
      <View style={styles.ctaRow}>
        <Pressable onPress={onDone} hitSlop={8} style={styles.skip} testID="wow-intro-skip">
          <Text style={styles.skipTxt}>Salta intro</Text>
        </Pressable>
        <Pressable
          onPress={last ? onDone : next}
          style={[styles.cta, { backgroundColor: slide.color }]}
          testID={last ? "wow-intro-start" : "wow-intro-next"}
        >
          <Text style={styles.ctaTxt}>{last ? "Inizia il tour" : "Avanti"}</Text>
          <Ionicons name={last ? "rocket" : "arrow-forward"} size={18} color="#0F172A" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", paddingHorizontal: 28, overflow: "hidden", zIndex: 50 },
  bubble: { position: "absolute" },
  logoRow: { position: "absolute", top: 56, alignItems: "center" },
  logo: { width: 150, height: 44 },
  heroWrap: { width: 220, height: 220, alignItems: "center", justifyContent: "center", marginBottom: 26 },
  heroCircle: { width: 128, height: 128, borderRadius: 64, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  orbitIcon: { position: "absolute", width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  textWrap: { alignItems: "center", minHeight: 150 },
  title: { color: "#FFF", fontSize: 26, fontWeight: "900", textAlign: "center", letterSpacing: 0.2, marginBottom: 12 },
  body: { color: "rgba(255,255,255,0.78)", fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 340 },
  dots: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8, marginBottom: 26 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.3)" },
  ctaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 380 },
  skip: { paddingVertical: 12, paddingHorizontal: 8, minHeight: 44, justifyContent: "center" },
  skipTxt: { color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 14 },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 14, minHeight: 48 },
  ctaTxt: { color: "#0F172A", fontWeight: "900", fontSize: 15 },
});

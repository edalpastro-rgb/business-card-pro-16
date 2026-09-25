// setup.tsx — V50.z211 — BLOCCO 1: wizard di onboarding «Set Up and Go» (popup WOW + struttura 4 step con progress bar).
// Arriva dopo ToS → Tour → /permessi. Modalità: «Set Up and Go» = Step 1 + Step 2 + 3 preferenze core (pannello core dello Step 3);
// «Full and Go» = tutti e 4 gli step, ogni area saltabile senza invalidare il completamento; «Dopo» = rimanda (Impostazioni → Configurazione
// guidata; Axon ricorda con un avviso in chat quando una risposta soffre della configurazione mancante).
// Step: 1 Chi sei (Blocco 2) · 2 Sfera + 3 Aree (Blocco 3) · 4 Parla a Neo (Blocco 4). `StepBody` monta il componente dello step.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInUp, ZoomIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing } from "react-native-reanimated";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { Step1Anagrafica, type StepBinder } from "@/src/wizard/Step1Anagrafica"; // V50.z212 — Blocco 2 · Step 1
import { Step2Sfera, type Sphere } from "@/src/wizard/Step2Sfera"; // V50.z214 — Blocco 3 · Step 2
import { Step3Aree } from "@/src/wizard/Step3Aree"; // V50.z214 — Blocco 3 · Step 3
import { Step4ParlaNeo } from "@/src/wizard/Step4ParlaNeo"; // V50.z215 — Blocco 4 · Step 4
import { Confetti } from "@/src/wizard/Confetti"; // V50.z216 — Blocco 5 · schermata finale
import { PrivacyNote } from "@/src/wizard/PrivacyNote"; // V50.z217 — riga privacy (popup WOW + Step 4)
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";
type Mode = "setup" | "full";
type StepState = { done: boolean; skipped: boolean };
export type SetupState = {
  status: "not_started" | "deferred" | "in_progress" | "completed"; mode: Mode | null; current_step: number;
  steps: Record<string, StepState>; core_prefs: Record<string, unknown>; mode_steps: number[]; permissions_done: boolean;
  sphere?: Sphere | null; areas?: Record<string, boolean>; future_interests?: string[];
};

export const STEP_META: Array<{ n: number; key: string; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { n: 1, key: "chi-sei", title: "Chi sei", subtitle: "Il tuo profilo e la tua attività", icon: "person-circle" },
  { n: 2, key: "sfera", title: "Sfera e tono", subtitle: "Dove userai AdvisorOS e come deve parlarti Neo", icon: "planet" },
  { n: 3, key: "aree", title: "Aree", subtitle: "Accendi le aree che ti servono, spegni il resto", icon: "toggle" },
  { n: 4, key: "parla-a-neo", title: "Parla a Neo", subtitle: "Neo impara da te e compila l'app al posto tuo", icon: "chatbubble-ellipses" },
];

// ─────────────────────────────────────────────────────────────────────────── Popup di benvenuto (effetto WOW)
function WelcomePopup({ onPick }: { onPick: (m: Mode | "later") => void }) {
  const pulse = useSharedValue(1);
  useEffect(() => { pulse.value = withRepeat(withSequence(withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) })), -1, true); }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <LinearGradient colors={[HT.violet, "#7C3AED", "#2563EB"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.welcome} testID="setup-welcome">
      <Animated.View entering={ZoomIn.duration(700).springify()} style={[styles.orb, pulseStyle]}>
        <Ionicons name="rocket" size={54} color="#FFF" />
      </Animated.View>
      <Animated.Text entering={FadeInUp.delay(300).duration(600)} style={styles.welcomeTitle}>Dai, iniziamo.{"\n"}Sei pronto?</Animated.Text>
      <Animated.Text entering={FadeInUp.delay(550).duration(600)} style={styles.welcomeSub}>
        Pochi minuti per dire ad AxonOS chi sei e come lavori: da domani ti parla come un collega che ti conosce.
      </Animated.Text>
      <Animated.View entering={FadeInDown.delay(800).duration(600)} style={styles.welcomeBtns}>
        <Pressable onPress={() => onPick("setup")} style={styles.btnPrimary} testID="setup-pick-setup">
          <Ionicons name="flash" size={18} color={HT.violet} />
          <View style={{ flex: 1 }}><Text style={styles.btnPrimaryTxt}>Set Up and Go</Text><Text style={styles.btnHint}>L'essenziale · Chi sei, la tua sfera e le aree</Text></View>
        </Pressable>
        <Pressable onPress={() => onPick("full")} style={styles.btnSecondary} testID="setup-pick-full">
          <Ionicons name="layers" size={18} color="#FFF" />
          <View style={{ flex: 1 }}><Text style={styles.btnSecondaryTxt}>Full and Go</Text><Text style={[styles.btnHint, { color: "#E9D5FF" }]}>Tutti e 4 gli step · puoi saltare le aree che vuoi</Text></View>
        </Pressable>
        <Pressable onPress={() => onPick("later")} style={styles.btnLater} testID="setup-pick-later">
          <Text style={styles.btnLaterTxt}>Dopo</Text>
        </Pressable>
        <Text style={styles.laterHint}>Potrai configurare tutto in qualsiasi momento da Impostazioni.</Text>
        <PrivacyNote light />
      </Animated.View>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────── Barra di avanzamento (sempre visibile)
function ProgressBar({ steps, current, state }: { steps: number[]; current: number; state: SetupState }) {
  const idx = Math.max(0, steps.indexOf(current));
  const pct = Math.round(((idx + 1) / steps.length) * 100);
  return (
    <View style={styles.progressWrap} testID="setup-progress">
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
      <View style={styles.progressDots}>
        {steps.map((s) => {
          const st = state.steps[String(s)] || { done: false, skipped: false };
          const active = s === current;
          return (
            <View key={s} style={styles.dotCol}>
              <View style={[styles.dot, active && styles.dotActive, st.done && styles.dotDone, st.skipped && styles.dotSkipped]} testID={`setup-dot-${s}`}>
                {st.done ? <Ionicons name="checkmark" size={12} color="#FFF" /> : st.skipped ? <Ionicons name="remove" size={12} color="#FFF" /> : <Text style={[styles.dotTxt, active && { color: "#FFF" }]}>{s}</Text>}
              </View>
              <Text style={[styles.dotLabel, active && { color: HT.violet, fontWeight: "800" }]} numberOfLines={1}>{STEP_META[s - 1].title}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.progressTxt}>Passo {idx + 1} di {steps.length} · {pct}%</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────── Corpo dello step (Blocco 2: Step 1 · Blocco 3: Step 2-3)
function StepBody({ step, bind, state, onNext, onSkipAll }: { step: number; bind: StepBinder; state: SetupState; onNext: () => void; onSkipAll: () => void }) {
  const meta = STEP_META[step - 1];
  return (
    <View style={styles.stepBody} testID={`setup-step-${step}`}>
      <View style={styles.stepIcon}><Ionicons name={meta.icon} size={26} color={HT.violet} /></View>
      <Text style={styles.stepTitle}>{meta.title}</Text>
      <Text style={styles.stepSub}>{meta.subtitle}</Text>
      {step === 1 ? <Step1Anagrafica bind={bind} />
        : step === 2 ? <Step2Sfera bind={bind} initial={state.sphere} />
        : step === 3 ? <Step3Aree bind={bind} sphere={state.sphere || "both"} initial={state.areas} onNext={onNext} onSkipAll={onSkipAll} />
        : <Step4ParlaNeo bind={bind} />}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────── Schermata finale (BLOCCO 5): coriandoli, messaggio di AxonOS, redirect Home
type Completion = { first_name: string; mode: Mode; mode_label: string; message: string; stats: { areas_on: number; accepted: number; facts: number; files: number }; running_jobs: number; redirect_seconds: number };
function CompletionScreen({ state, onRedo }: { state: SetupState; onRedo: () => void }) {
  const router = useRouter();
  const [c, setC] = useState<Completion | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const goHome = useCallback(() => router.replace("/" as any), [router]);
  useEffect(() => { api<Completion>("/axon/setup/completion").then((r) => { setC(r); setLeft(r.redirect_seconds || 6); }).catch(() => setLeft(6)); }, []);
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) { goHome(); return; }
    const t = setTimeout(() => setLeft((v) => (v === null ? v : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [left, goHome]);
  const skippedN = Object.values(state.steps).filter((s) => s.skipped).length;
  return (
    <LinearGradient colors={state.mode === "setup" ? [HT.success, "#059669"] : [HT.violet, "#059669"]} style={styles.welcome} testID="setup-done">
      <Confetti />
      <Animated.View entering={ZoomIn.duration(600).springify()} style={styles.orb}><Ionicons name="checkmark-done" size={54} color="#FFF" /></Animated.View>
      <Animated.Text entering={FadeInUp.delay(250)} style={styles.welcomeTitle} testID="setup-done-title">{c?.first_name ? `Fatto, ${c.first_name}!` : "Fatto!"}</Animated.Text>
      <Animated.View entering={FadeInUp.delay(400)} style={styles.axonMsg} testID="setup-done-message">
        <Text style={styles.axonMsgWho}>✨ AxonOS · {c?.mode_label || (state.mode === "setup" ? "Set Up and Go" : "Full and Go")}</Text>
        <Text style={styles.axonMsgTxt}>{c ? c.message : "Sto preparando il tuo riepilogo…"}</Text>
        {skippedN > 0 && <Text style={styles.axonMsgNote}>Hai saltato {skippedN} {skippedN === 1 ? "area" : "aree"}: le trovi in Profilo → «La mia configurazione Set Up».</Text>}
        {!!c?.running_jobs && <View style={styles.readingRow}><ActivityIndicator size="small" color="#FFF" /><Text style={styles.axonMsgNote}>AxonOS sta leggendo i tuoi file… puoi già usare l'app.</Text></View>}
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(600)} style={styles.welcomeBtns}>
        <Pressable onPress={goHome} style={styles.btnPrimary} testID="setup-go-home"><Ionicons name="home" size={18} color="#059669" /><Text style={[styles.btnPrimaryTxt, { color: "#059669" }]}>Vai alla Home{left !== null && left > 0 ? ` · ${left}` : ""}</Text></Pressable>
        <Pressable onPress={() => router.replace("/setup-config" as any)} style={styles.btnSecondary} testID="setup-go-config"><Ionicons name="options" size={18} color="#FFF" /><Text style={styles.btnSecondaryTxt}>La mia configurazione Set Up</Text></Pressable>
        <Pressable onPress={() => { setLeft(null); onRedo(); }} style={styles.btnLater} testID="setup-redo"><Text style={styles.btnLaterTxt}>Ripeti la configurazione</Text></Pressable>
      </Animated.View>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────── Schermata
export default function SetupScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const params = useLocalSearchParams<{ welcome?: string }>();
  const [state, setState] = useState<SetupState | null>(null);
  const [showWelcome, setShowWelcome] = useState<boolean>(params.welcome === "1");
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  // V50.z212 — lo step attivo registra qui la sua validazione/salvataggio: «Continua» avanza solo se ritorna true
  const stepSubmit = useRef<(() => Promise<boolean>) | null>(null);
  const bindStep: StepBinder = useCallback((fn) => { stepSubmit.current = fn; }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<SetupState>("/axon/setup/state");
        setState(s);
        if (params.welcome !== "1" && (s.status === "not_started" || s.status === "deferred" || !s.mode)) setShowWelcome(true);
      } catch { setState(null); }
    })();
  }, [params.welcome]);

  const save = useCallback(async (body: Record<string, unknown>) => {
    try { const s = await api<SetupState>("/axon/setup/state", { method: "PUT", body }); setState(s); return s; } catch { return null; }
  }, []);

  const pick = useCallback(async (m: Mode | "later") => {
    if (m === "later") { await save({ status: "deferred" }); router.replace("/" as any); return; }
    await save({ status: "in_progress", mode: m, current_step: 1 });
    setShowWelcome(false);
  }, [router, save]);

  const steps = useMemo(() => (state?.mode === "setup" ? [1, 2, 3] : [1, 2, 3, 4]), [state?.mode]);
  const current = state?.current_step && steps.includes(state.current_step) ? state.current_step : steps[0];

  const advance = useCallback(async (skipped: boolean) => {
    if (!state || saving) return;
    if (!skipped && stepSubmit.current) {
      setSaving(true);
      const ok = await stepSubmit.current().catch(() => false);
      setSaving(false);
      if (!ok) return;
    }
    stepSubmit.current = null;
    const i = steps.indexOf(current);
    const upd: Record<string, unknown> = { step_updates: { [String(current)]: skipped ? { skipped: true, done: false } : { done: true, skipped: false } } };
    if (i + 1 < steps.length) { upd.current_step = steps[i + 1]; await save(upd); }
    else { upd.status = "completed"; await save(upd); setFinished(true); }
  }, [current, save, saving, state, steps]);

  const back = useCallback(async () => {
    const i = steps.indexOf(current);
    if (i > 0) await save({ current_step: steps[i - 1] }); else setShowWelcome(true);
  }, [current, save, steps]);

  if (showWelcome) return <WelcomePopup onPick={pick} />;
  if (!state) return <View style={[styles.root, { justifyContent: "center" }]}><ActivityIndicator color={HT.violet} /></View>;

  if (finished || state.status === "completed") return <CompletionScreen state={state} onRedo={async () => { await api("/axon/setup/reset", { method: "POST" }).catch(() => {}); setFinished(false); setShowWelcome(true); }} />;

  const isLast = steps.indexOf(current) === steps.length - 1;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={10} style={styles.headBtn} testID="setup-back"><Ionicons name="arrow-back" size={22} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle}>{state.mode === "setup" ? "Set Up and Go" : "Full and Go"}</Text>
          <Text style={styles.headSub}>{state.mode === "setup" ? "L'essenziale, in pochi minuti" : "Configurazione completa · ogni area è saltabile"}</Text>
        </View>
        <Pressable onPress={async () => { await save({ status: "deferred" }); router.replace("/" as any); }} hitSlop={10} style={styles.headBtn} testID="setup-defer">
          <Ionicons name="close" size={22} color={HT.muted} />
        </Pressable>
      </View>
      <ProgressBar steps={steps} current={current} state={state} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (current === 3 ? 40 : 150) }}>
        <Animated.View key={current} entering={FadeInUp.duration(350)}>
          <StepBody step={current} bind={bindStep} state={state} onNext={() => advance(false)} onSkipAll={() => advance(true)} />
        </Animated.View>
      </ScrollView>
      {current !== 3 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => advance(false)} disabled={saving} style={[styles.primary, saving && { opacity: 0.7 }]} testID="setup-next">
            {saving ? <ActivityIndicator color="#FFF" /> : <><Text style={styles.primaryTxt}>{isLast ? "Completa" : "Continua"}</Text><Ionicons name={isLast ? "checkmark" : "arrow-forward"} size={18} color="#FFF" /></>}
          </Pressable>
          {state.mode === "full" && current > 3 && (
            <Pressable onPress={() => advance(true)} style={styles.skip} testID="setup-skip-step"><Text style={styles.skipTxt}>Salta quest'area</Text></Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  welcome: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  orb: { width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.35)" },
  welcomeTitle: { color: "#FFF", fontSize: 34, fontWeight: "900", textAlign: "center", lineHeight: 40, marginTop: 8 },
  welcomeSub: { color: "#E9D5FF", fontSize: 15, textAlign: "center", lineHeight: 22, paddingHorizontal: 8 },
  welcomeBtns: { width: "100%", gap: 10, marginTop: 16 },
  btnPrimary: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 18, paddingHorizontal: 18, minHeight: 60 },
  btnPrimaryTxt: { color: HT.violet, fontWeight: "900", fontSize: 17 },
  btnHint: { fontSize: 11.5, color: HT.muted, marginTop: 1 },
  btnSecondary: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.6)", borderRadius: 18, paddingHorizontal: 18, minHeight: 60 },
  btnSecondaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 17 },
  btnLater: { alignItems: "center", justifyContent: "center", minHeight: 48 },
  btnLaterTxt: { color: "#FFF", fontWeight: "800", fontSize: 15, opacity: 0.9 },
  laterHint: { color: "#E9D5FF", fontSize: 11.5, textAlign: "center", opacity: 0.85 },
  axonMsg: { width: "100%", backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 18, padding: 16, gap: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  axonMsgWho: { color: "#FDE68A", fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },
  axonMsgTxt: { color: "#FFF", fontSize: 15.5, lineHeight: 22, fontWeight: "600" },
  axonMsgNote: { color: "#E9D5FF", fontSize: 12.5, lineHeight: 17, flex: 1 },
  readingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  headBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headTitle: { fontSize: 17, fontWeight: "900", color: HT.text },
  headSub: { fontSize: 12, color: HT.muted },
  progressWrap: { paddingHorizontal: 16, paddingBottom: 10, gap: 10, backgroundColor: HT.bg },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: HT.violetTint, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: PURPLE, borderRadius: 4 },
  progressDots: { flexDirection: "row", justifyContent: "space-between" },
  dotCol: { flex: 1, alignItems: "center", gap: 4 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  dotActive: { backgroundColor: PURPLE },
  dotDone: { backgroundColor: '#059669' },
  dotSkipped: { backgroundColor: '#94A3B8' },
  dotTxt: { fontSize: 12, fontWeight: "800", color: HT.violet },
  dotLabel: { fontSize: 10, color: HT.muted },
  progressTxt: { fontSize: 11.5, color: HT.muted, textAlign: "center", fontWeight: "700" },
  stepBody: { backgroundColor: HT.card, borderRadius: 18, padding: 18, gap: 8, borderWidth: 1, borderColor: HT.violetTint },
  stepIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  stepTitle: { fontSize: 22, fontWeight: "900", color: HT.text },
  stepSub: { fontSize: 13.5, color: HT.muted, lineHeight: 19 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, gap: 6, backgroundColor: HT.bg },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: PURPLE, borderRadius: 16, minHeight: 52 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 16 },
  skip: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  skipTxt: { color: HT.muted, fontWeight: "700", fontSize: 14 },
});

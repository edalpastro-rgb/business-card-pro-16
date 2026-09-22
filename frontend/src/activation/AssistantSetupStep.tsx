// V50.z318 — Step OBBLIGATORIO al primo accesso: nome dell'assistente (default «Axon») e voce.
// OK → salva /user-settings {assistant_name, assistant_voice, assistant_setup_done, activation_done}
// → vibrazione doppia → apre la chat → onda di energia 3 s → «Ciao, sono {nome}. Sono pronto.»
import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { playAudioBase64 } from "@/src/utils/audioPlayback";
import { theme } from "@/src/theme";
import { AXON_VOICES } from "@/app/axon-voice";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)

export function AssistantSetupStep({ initialName, initialVoice, onDone }: { initialName?: string; initialVoice?: string; onDone: (name: string, voice: string) => void | Promise<void> }) {
  const [name, setName] = useState((initialName && initialName !== "Neo" ? initialName : "") || "Axon");
  const [voice, setVoice] = useState(initialVoice || "nova");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length >= 2 && name.trim().length <= 20;

  const preview = async (v: string) => {
    setVoice(v);
    setPreviewing(v);
    try {
      const r = await api<{ audio_base64: string; mime: string }>("/assistant/tts", { method: "POST", body: { text: `Ciao, sono ${name.trim() || "Axon"}.`, voice: v } });
      if (r?.audio_base64) await new Promise<void>((res) => { playAudioBase64(r.audio_base64, r.mime || "audio/mpeg", () => res()).catch(() => res()); });
    } catch { /* anteprima non disponibile */ }
    setPreviewing(null);
  };

  const ok = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try { await onDone(name.trim(), voice); } finally { setSaving(false); }
  };

  return (
    <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" testID="assistant-setup-step">
      <View style={s.orb}><Ionicons name="sparkles" size={34} color={C.onSurfaceInverse} /></View>
      <Text style={s.title}>Dai un nome al tuo assistente</Text>
      <Text style={s.sub}>Prima di iniziare scegli come chiamarlo e con quale voce deve parlarti. Potrai cambiarli quando vuoi dalle Impostazioni.</Text>

      <Text style={s.lbl}>Nome</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Axon" placeholderTextColor={C.muted} style={s.input} maxLength={20} autoCapitalize="words" testID="setup-name-input" />
      {!valid ? <Text style={s.err}>Da 2 a 20 caratteri.</Text> : null}

      <Text style={s.lbl}>Voce</Text>
      <View style={s.voices}>
        {AXON_VOICES.map((v) => {
          const on = v.key === voice;
          return (
            <Pressable key={v.key} onPress={() => void preview(v.key)} style={[s.voice, on && s.voiceOn]} testID={`setup-voice-${v.key}`} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <View style={s.voiceHead}>
                <Text style={[s.voiceName, on && { color: VIOLET }]}>{v.label}</Text>
                {previewing === v.key ? <ActivityIndicator size="small" color={VIOLET} /> : <Ionicons name={on ? "volume-high" : "play"} size={16} color={on ? VIOLET : C.muted} />}
              </View>
              <Text style={s.voiceDesc}>{v.desc}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={ok} disabled={!valid || saving} style={({ pressed }) => [s.okBtn, (!valid || saving) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]} testID="setup-ok-btn" accessibilityRole="button">
        {saving ? <ActivityIndicator color={C.onSurfaceInverse} /> : <Text style={s.okTxt}>OK</Text>}
      </Pressable>
      <Text style={s.hint}>Tocca una voce per ascoltarla. Premendo OK {name.trim() || "Axon"} si attiva e si presenta.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  body: { padding: 24, paddingBottom: 60, gap: 10 },
  orb: { alignSelf: "center", width: 76, height: 76, borderRadius: 38, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center", marginBottom: 6, shadowColor: VIOLET, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
  title: { color: C.onSurfaceInverse, fontSize: 24, fontWeight: "900", textAlign: "center", letterSpacing: -0.5 },
  sub: { color: C.onSurfaceInverse, opacity: 0.8, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 8 },
  lbl: { color: C.onSurfaceInverse, opacity: 0.75, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 6 },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceSecondary, color: C.onSurface, paddingHorizontal: 16, fontSize: 18, fontWeight: "700" },
  err: { color: C.error, fontSize: 12 },
  voices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  voice: { width: "48%", flexGrow: 1, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceSecondary, padding: 12, gap: 4, minHeight: 64 },
  voiceOn: { borderColor: VIOLET, backgroundColor: C.brandTertiary },
  voiceHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  voiceName: { color: C.onSurface, fontSize: 15, fontWeight: "800" },
  voiceDesc: { color: C.muted, fontSize: 11 },
  okBtn: { marginTop: 16, minHeight: 56, borderRadius: 999, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center", shadowColor: VIOLET, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  okTxt: { color: C.onSurfaceInverse, fontSize: 18, fontWeight: "900", letterSpacing: 2 },
  hint: { color: C.onSurfaceInverse, opacity: 0.65, fontSize: 12, textAlign: "center" },
});

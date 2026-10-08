// V50.z456 — «Personalizza Axon»: due selettori indipendenti (Personalità + Stile linguistico) che modificano il system prompt
// di Axon SOLO per questo account. Visibile al Super Master (AdvisorOS) e a tutti gli utenti su AxonOS Lite (allowed dal server).
// Impostazioni › AI & Axon. Salvataggio immediato al tocco su PUT /axon/personalize.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const VIOLET = "#7C3AED"; // colore sezione AI & Axon (uguale in chiaro e scuro)

type Opt = { key: string; label: string; desc: string };
type Payload = { allowed: boolean; personality: string | null; style: string | null; personalities: Opt[]; styles: Opt[] };

function Selector({ title, options, value, onPick, testPrefix }: { title: string; options: Opt[]; value: string | null; onPick: (k: string | null) => void; testPrefix: string }) {
  const sel = options.find((o) => o.key === value) || null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.lbl}>{title}</Text>
      <View style={s.chips}>
        <Pressable onPress={() => onPick(null)} style={[s.chip, !value && s.chipOn]} testID={`${testPrefix}-default`}>
          <Text style={[s.chipTxt, !value && s.chipTxtOn]}>Predefinita</Text>
        </Pressable>
        {options.map((o) => (
          <Pressable key={o.key} onPress={() => onPick(o.key === value ? null : o.key)} style={[s.chip, value === o.key && s.chipOn]} testID={`${testPrefix}-${o.key}`}>
            <Text style={[s.chipTxt, value === o.key && s.chipTxtOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.desc} testID={`${testPrefix}-desc`}>{sel ? `${sel.label}: ${sel.desc}` : "Predefinita: Axon come sempre"}</Text>
    </View>
  );
}

export function AxonPersonalizeCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Payload>("/axon/personalize").then(setData).catch(() => setFailed(true));
  }, []);

  const save = async (personality: string | null, style: string | null) => {
    if (!data || saving) return;
    const prev = data;
    setData({ ...data, personality, style });
    setSaving(true);
    try {
      const r = await api<Payload>("/axon/personalize", { method: "PUT", body: { personality, style } });
      setData(r);
    } catch (e: any) {
      setData(prev);
      notify("Errore", e?.message || "Impossibile salvare la personalizzazione");
    } finally {
      setSaving(false);
    }
  };

  if (failed || (data && !data.allowed)) return null;
  if (!data) return <View style={s.card}><ActivityIndicator color={VIOLET} /></View>;
  return (
    <View style={s.card} testID="axon-personalize-card">
      <View style={s.head}>
        <View style={s.orb}><Ionicons name="color-palette" size={18} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Personalizza Axon</Text>
          <Text style={s.sub}>Personalità e stile linguistico valgono solo per il tuo account. Puoi cambiarli quando vuoi.</Text>
        </View>
        {saving ? <ActivityIndicator color={VIOLET} /> : <Ionicons name="checkmark-circle" size={20} color={VIOLET} />}
      </View>
      <Selector title="Personalità" options={data.personalities} value={data.personality} onPick={(k) => save(k, data.style)} testPrefix="axon-pers" />
      <Selector title="Stile linguistico" options={data.styles} value={data.style} onPick={(k) => save(data.personality, k)} testPrefix="axon-style" />
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.divider, gap: 14, marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  orb: { width: 40, height: 40, borderRadius: 20, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  sub: { fontSize: 12, color: C.muted, marginTop: 2 },
  lbl: { fontSize: 13, color: C.onSurface, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: VIOLET, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: VIOLET },
  chipTxt: { color: VIOLET, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: "#FFFFFF" },
  desc: { fontSize: 12.5, color: C.muted },
});

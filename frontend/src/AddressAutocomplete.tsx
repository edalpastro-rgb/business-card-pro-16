// src/AddressAutocomplete.tsx — V50.z469 — Feature 6/15: campo «Cerca indirizzo» con suggerimenti Google Places (via backend
// `/places/autocomplete` + `/places/details`, chiave solo server). Alla selezione restituisce i campi strutturati (via, civico,
// CAP, città, provincia, indirizzo formattato, lat/lon). Se il servizio non è disponibile il campo resta un normale input e i
// campi sottostanti si compilano a mano: nessun blocco.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";

export type PlaceParts = { formatted: string; street: string; number: string; zip: string; city: string; province: string; country: string; lat?: number | null; lon?: number | null };
type Sugg = { place_id: string; text: string; main: string; secondary: string };

const newSession = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function AddressAutocomplete({ onSelect, placeholder = "Cerca indirizzo (via, civico, città)…", testID = "address-autocomplete", dark, label = "Cerca indirizzo" }: {
  onSelect: (p: PlaceParts) => void; placeholder?: string; testID?: string; dark?: boolean; label?: string | null;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Sugg[]>([]);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const session = useRef(newSession());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const text = q.trim();
    if (text.length < 3) { setItems([]); setLoading(false); return; }
    timer.current = setTimeout(async () => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const r = await api<{ enabled: boolean; suggestions: Sugg[] }>(`/places/autocomplete?q=${encodeURIComponent(text)}&session=${session.current}`);
        if (my !== seq.current) return;
        if (r.enabled === false) { setEnabled(false); setItems([]); return; }
        setItems(r.suggestions || []); setOpen(true);
      } catch { if (my === seq.current) { setItems([]); setEnabled(false); } }
      finally { if (my === seq.current) setLoading(false); }
    }, 320);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const pick = async (s: Sugg) => {
    setOpen(false); setItems([]); setLoading(true); Keyboard.dismiss();
    try {
      const d = await api<PlaceParts>(`/places/details?place_id=${encodeURIComponent(s.place_id)}&session=${session.current}`);
      session.current = newSession(); // una sessione Places = autocomplete + 1 details
      setQ(d.formatted || s.text);
      onSelect(d);
    } catch {
      setQ(s.text);
      onSelect({ formatted: s.text, street: s.main, number: "", zip: "", city: s.secondary.split(",")[0] || "", province: "", country: "IT" });
    } finally { setLoading(false); }
  };

  if (!enabled) return null; // servizio non configurato → nessun campo extra, compilazione manuale

  return (
    <View style={{ marginBottom: 8, zIndex: 20 }} testID={testID}>
      {label ? <Text style={[st.lbl, dark && { color: "#CBD5E1" }]}>{label}</Text> : null}
      <View style={[st.box, dark && st.boxDark]}>
        <Ionicons name="location-outline" size={18} color={dark ? "#94A3B8" : HT.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={dark ? "#64748B" : HT.muted} style={[st.input, dark && { color: "#F8FAFC" }]}
          autoCorrect={false} autoCapitalize="words" onFocus={() => items.length && setOpen(true)} testID={`${testID}-input`} />
        {loading ? <ActivityIndicator size="small" color={HT.brand} /> : q ? (
          <Pressable onPress={() => { setQ(""); setItems([]); }} hitSlop={8} testID={`${testID}-clear`}><Ionicons name="close-circle" size={18} color={dark ? "#94A3B8" : HT.muted} /></Pressable>
        ) : null}
      </View>
      {open && items.length > 0 ? (
        <View style={[st.list, dark && st.listDark]}>
          {items.map((s) => (
            <Pressable key={s.place_id} onPress={() => pick(s)} style={({ pressed }) => [st.row, pressed && { backgroundColor: HT.glassStrong }]} testID={`${testID}-item`}>
              <Ionicons name="navigate-outline" size={15} color={HT.brand} />
              <View style={{ flex: 1 }}>
                <Text style={[st.main, dark && { color: "#F8FAFC" }]} numberOfLines={1}>{s.main || s.text}</Text>
                {s.secondary ? <Text style={st.sec} numberOfLines={1}>{s.secondary}</Text> : null}
              </View>
            </Pressable>
          ))}
          <Text style={st.powered}>Suggerimenti Google</Text>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  lbl: { fontSize: 12, fontWeight: "700", color: HT.muted, marginBottom: 4 },
  box: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  boxDark: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.14)" },
  input: { flex: 1, color: HT.text, fontSize: 15, paddingVertical: 10 },
  list: { marginTop: 4, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, overflow: "hidden" },
  listDark: { backgroundColor: "#0F172A", borderColor: "rgba(255,255,255,0.14)" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border },
  main: { fontSize: 14, fontWeight: "700", color: HT.text },
  sec: { fontSize: 11.5, color: HT.muted },
  powered: { fontSize: 9.5, color: HT.muted, textAlign: "right", paddingHorizontal: 10, paddingVertical: 4 },
});

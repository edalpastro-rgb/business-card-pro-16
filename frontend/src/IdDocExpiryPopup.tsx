// IdDocExpiryPopup.tsx — V50.z267 — Popup «documento in scadenza» (≤ 30 giorni): all'avvio e al ritorno in foreground.
// GET /identity-documents/expiring-popup → Modal con Apri (deep link) / Ricordamelo domani (snooze 24h server-side).
import React, { useCallback, useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, AppState } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Item = { doc_id: string; doc_type_label: string; document_number?: string; expiry_date?: string; days_left: number | null; subject_label: string; deeplink: string };

export function IdDocExpiryPopup() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const check = useCallback(async () => {
    try { const r = await api<{ items: Item[] }>("/identity-documents/expiring-popup"); setItems(r.items || []); } catch { /* offline */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(check, 4000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    return () => { clearTimeout(t); sub.remove(); };
  }, [check]);
  if (!items.length) return null;
  const it = items[0];
  const snooze = async () => { try { await api(`/identity-documents/${it.doc_id}/popup-snooze`, { method: "POST" }); } catch {} setItems((l) => l.slice(1)); };
  const open = async () => { await snooze(); router.push(it.deeplink as any); };
  const exp = it.expiry_date ? it.expiry_date.split("-").reverse().join("/") : "";
  const when = it.days_left === null ? "" : it.days_left < 0 ? "è SCADUTO" : it.days_left === 0 ? "scade OGGI" : `scade tra ${it.days_left} giorni`;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={snooze}>
      <View style={s.backdrop}>
        <View style={s.card} testID="iddoc-expiry-popup">
          <View style={s.iconWrap}><Ionicons name="alert-circle" size={30} color="#DC2626" /></View>
          <Text style={s.title}>Documento in scadenza</Text>
          <Text style={s.body}>{it.subject_label === "Tu" ? "Il tuo" : `Cliente ${it.subject_label}:`} <Text style={{ fontWeight: "900" }}>{it.doc_type_label}</Text>{it.document_number ? ` n. ${it.document_number}` : ""} {when}{exp ? ` (${exp})` : ""}. Ricordati di rinnovarlo.</Text>
          <Pressable onPress={open} style={s.primary} testID="iddoc-popup-open"><Ionicons name="open-outline" size={16} color="#FFF" /><Text style={s.primaryTxt}>Apri</Text></Pressable>
          <Pressable onPress={snooze} style={s.secondary} testID="iddoc-popup-snooze"><Text style={s.secondaryTxt}>Ricordamelo domani{items.length > 1 ? ` (+${items.length - 1})` : ""}</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, backgroundColor: HT.card2, borderRadius: 20, padding: 22, alignItems: "center", gap: 10 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: HT.dangerTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text },
  body: { fontSize: 14, color: HT.text, textAlign: "center", lineHeight: 21 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: '#DC2626', borderRadius: 12, minHeight: 46, width: "100%", marginTop: 6 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  secondary: { minHeight: 44, justifyContent: "center" }, secondaryTxt: { color: HT.muted, fontWeight: "700", fontSize: 13 },
});

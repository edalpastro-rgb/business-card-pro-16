// ResetTestDataCard.tsx — V50.z288 — Impostazioni (solo Master): «Azzera dati di test» con doppia conferma (scrivi AZZERA).
// Cancella clienti/anagrafiche e tutto il collegato, calendario, sveglie/timer, aree/categorie/gruppi, profilo Master e team.
// Mantiene Axon (chat, regole, KB, documenti/link insegnati, memoria), accessi (Drive/Dropbox/mail), utenti, modelli moduli.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const RED = "#DC2626";

export function ResetTestDataCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ total: number; contacts: number } | null>(null);
  const ok = confirm.trim().toUpperCase() === "AZZERA";

  const run = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const r = await api<{ total: number; contacts: number }>("/admin/reset-test-data", { method: "POST", body: { confirm: confirm.trim() } });
      setDone(r); setConfirm(""); setOpen(false);
      notify("Dati azzerati", `${r.contacts} clienti e ${r.total} record eliminati. Axon, accessi e collaboratori sono stati mantenuti.`);
      setTimeout(() => router.replace("/(tabs)/home" as any), 800);
    } catch (e: any) { notify("Azzera dati", e?.message || "Operazione non riuscita"); } finally { setBusy(false); }
  };

  return (
    <View style={s.card} testID="settings-reset-card">
      <Pressable onPress={() => setOpen((v) => !v)} style={s.row} testID="settings-reset-toggle">
        <View style={s.icon}><Ionicons name="trash-bin" size={22} color={RED} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Azzera dati di test</Text>
          <Text style={s.sub}>Cancella clienti, calendario, sveglie, aree e profilo Master. Axon e accessi restano.</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-forward"} size={18} color={HT.muted} />
      </Pressable>
      {open ? (
        <View style={s.body}>
          <Text style={s.warn}>⚠️ Operazione irreversibile per tutto il team.</Text>
          <Text style={s.list}>🗑️ Elimina: clienti e anagrafiche, note, visite, richiami, esiti chiamate, biglietti da visita, documenti d&apos;identità, fatture, contratti, moduli compilati, pratiche CRT, recensioni, inviti, appuntamenti, promemoria, giri visite e km, sveglie e timer, gruppi/aree/categorie/sottocategorie, profilo Master e profili team.</Text>
          <Text style={s.list}>✅ Mantiene: tutto Axon (chat, regole, documenti e link insegnati, knowledge base, memoria, script, offerte, file Master, modelli moduli, ordine CRT, voce/tour/interessi), accessi Drive/Dropbox/mail, utenti e collaboratori, dispositivi, branding.</Text>
          <Text style={s.lbl}>Scrivi AZZERA per confermare</Text>
          <TextInput value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="AZZERA" placeholderTextColor={HT.muted} style={s.input} testID="settings-reset-input" />
          <Pressable onPress={run} disabled={!ok || busy} style={[s.btn, (!ok || busy) && { opacity: 0.5 }]} testID="settings-reset-run">
            {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="trash" size={18} color="#FFF" /><Text style={s.btnTxt}>Azzera adesso</Text></>}
          </Pressable>
        </View>
      ) : done ? <Text style={[s.sub, { paddingHorizontal: 14, paddingBottom: 12, color: HT.success }]}>✓ Ultimo azzeramento: {done.contacts} clienti, {done.total} record.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.danger + '66', overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64 },
  icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: HT.dangerTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: RED }, sub: { fontSize: 12, color: HT.muted, marginTop: 2, lineHeight: 16 },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 8, borderTopWidth: 1, borderTopColor: HT.dangerTint, paddingTop: 10 },
  warn: { fontSize: 13, fontWeight: "800", color: RED }, list: { fontSize: 12, color: HT.text, lineHeight: 17 },
  lbl: { fontSize: 12, fontWeight: "800", color: HT.muted, marginTop: 4 },
  input: { borderWidth: 1, borderColor: HT.danger + '66', borderRadius: 10, minHeight: 44, paddingHorizontal: 12, fontSize: 16, fontWeight: "800", color: RED, letterSpacing: 2 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 12, backgroundColor: RED },
  btnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
});

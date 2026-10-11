// CreditsExhaustedCard.tsx — V50.z524 — Card in chat quando il backend risponde 402 «ai_credits_exhausted»:
// crediti AI del mese finiti → chat Axon in pausa fino al 1° del mese; pulsante «Richiedi pacchetto add-on» (richiesta manuale al Master,
// crediti bonus che non scadono). Nessun riferimento al programma referral (scelta del cliente).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";

export const AI_CREDITS_EXHAUSTED = "ai_credits_exhausted";

function renewalLabel(iso?: string): string {
  const d = iso ? new Date(`${iso}T00:00:00`) : null;
  const dt = d && !isNaN(d.getTime()) ? d : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  return dt.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
}

export function CreditsExhaustedCard() {
  const [renewsOn, setRenewsOn] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ renews_on?: string; addon_request_open?: boolean }>("/ai/credits/me")
      .then((r) => { setRenewsOn(r.renews_on); if (r.addon_request_open) setSent(true); })
      .catch(() => {});
  }, []);

  const request = async () => {
    if (busy || sent) return;
    setBusy(true);
    try { await api("/ai/credits/addon-request", { method: "POST", body: {} }); setSent(true); }
    catch { /* la card resta: l'utente può riprovare */ }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.card} testID="credits-exhausted">
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="lock-closed" size={18} color={HT.violet} /></View>
        <Text style={styles.title}>Crediti AI esauriti</Text>
      </View>
      <Text style={styles.txt}>Hai usato tutti i crediti AI di questo mese. Si ricaricano automaticamente il <Text style={styles.bold}>{renewalLabel(renewsOn)}</Text>.</Text>
      <Text style={styles.txt}><Text style={styles.bold}>In pausa:</Text> chat con Axon (testo e voce).{"\n"}<Text style={styles.bold}>Sempre disponibili:</Text> clienti, agenda, documenti, bollette, dettatura e tutte le altre funzioni.</Text>
      {sent ? (
        <View style={styles.sentRow} testID="credits-addon-sent">
          <Ionicons name="checkmark-circle" size={18} color={HT.violet} />
          <Text style={styles.sentTxt}>Richiesta inviata: ti ricontattiamo al più presto per attivare il pacchetto add-on.</Text>
        </View>
      ) : (
        <Pressable onPress={request} disabled={busy} style={[styles.btn, busy && { opacity: 0.6 }]} testID="credits-addon-request">
          {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="cart-outline" size={16} color="#FFF" /><Text style={styles.btnTxt}>Richiedi pacchetto add-on</Text></>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, marginLeft: 30, marginTop: 6, backgroundColor: HT.violetTint, borderRadius: 14, borderWidth: 1, borderColor: HT.violet + "66", padding: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { width: 30, height: 30, borderRadius: 10, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 13.5, fontWeight: "800", color: HT.violet },
  txt: { fontSize: 12, color: HT.violet, lineHeight: 17 },
  bold: { fontWeight: "800" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: HT.violet, borderRadius: 999, minHeight: 44, paddingHorizontal: 14, alignSelf: "flex-start" },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12.5 },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sentTxt: { flex: 1, fontSize: 12, color: HT.violet, fontWeight: "700" },
});

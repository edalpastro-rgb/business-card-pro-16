// V50.z322 — «Invita un amico»: codice personale, condivisione (WhatsApp / share sheet / copia), amici arrivati, giorni guadagnati.
// Usato in Impostazioni › Abbonamento e nel pannello Master (/invita-amico). Allineato con AxonOS Lite (GET /referral/me).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Share, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { api, BACKEND_URL } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const VIOLET = "#8B5CF6"; // identità Axon (uguale in chiaro e scuro)
const WA_GREEN = "#25D366"; // colore marchio WhatsApp

type Me = {
  code: string; share_path: string; share_text: string; enabled: boolean;
  reward_inviter: { summary: string }; reward_invitee: { summary: string };
  friends_count: number; days_earned: number;
  friends: { name: string; email: string; created_at: string; reward: string }[];
};

function publicOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return (Constants.expoConfig?.extra as any)?.backendUrl || BACKEND_URL || "";
}

export function ReferralCard({ showFriends = true }: { showFriends?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => api<Me>("/referral/me").then(setMe).catch(() => setErr(true)), []);
  useEffect(() => { load(); }, [load]);

  if (err) return null;
  if (!me) return <View style={s.card}><ActivityIndicator color={VIOLET} /></View>;
  const link = `${publicOrigin()}${me.share_path}`;
  const fullText = `${me.share_text}\n👉 ${link}`;

  const copy = async () => { await Clipboard.setStringAsync(me.code); notify("Codice copiato ✅", me.code); };
  const copyLink = async () => { await Clipboard.setStringAsync(link); notify("Link copiato ✅", link); };
  const whatsapp = async () => {
    const url = `whatsapp://send?text=${encodeURIComponent(fullText)}`;
    const web = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
    try {
      if (Platform.OS !== "web" && (await Linking.canOpenURL(url))) return void Linking.openURL(url);
      if (Platform.OS === "web" && typeof window !== "undefined") window.open(web, "_blank");
      else await Linking.openURL(web);
    } catch { notify("WhatsApp non disponibile", "Copia il link e condividilo manualmente."); }
  };
  const share = async () => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && (navigator as any).share) { await (navigator as any).share({ title: "Invita un amico · AdvisorOS", text: fullText }); return; }
      if (Platform.OS === "web") return void copyLink();
      await Share.share({ message: fullText });
    } catch { /* annullato */ }
  };

  return (
    <View style={s.card} testID="referral-card">
      <View style={s.head}>
        <View style={s.orb}><Ionicons name="gift" size={20} color={C.onSurfaceInverse} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Invita un amico</Text>
          <Text style={s.sub}>Tu ricevi <Text style={s.bold}>{me.reward_inviter.summary.toLowerCase()}</Text>, il tuo amico <Text style={s.bold}>{me.reward_invitee.summary.toLowerCase()}</Text>.</Text>
        </View>
      </View>
      {!me.enabled ? <Text style={s.off}>Il programma non è attivo al momento.</Text> : null}

      <Pressable onPress={copy} style={s.codeBox} testID="referral-code" accessibilityLabel="Copia il codice amico">
        <Text style={s.codeLbl}>IL TUO CODICE AMICO</Text>
        <View style={s.codeRow}><Text style={s.code}>{me.code}</Text><Ionicons name="copy-outline" size={18} color={VIOLET} /></View>
      </Pressable>

      <View style={s.actions}>
        <Pressable onPress={whatsapp} style={[s.act, { backgroundColor: WA_GREEN }]} testID="referral-whatsapp"><Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" /><Text style={s.actTxt}>WhatsApp</Text></Pressable>
        <Pressable onPress={share} style={[s.act, { backgroundColor: VIOLET }]} testID="referral-share"><Ionicons name="share-social" size={18} color={C.onSurfaceInverse} /><Text style={s.actTxt}>Condividi</Text></Pressable>
        <Pressable onPress={copyLink} style={[s.act, s.actGhost]} testID="referral-copy-link"><Ionicons name="link" size={18} color={VIOLET} /><Text style={[s.actTxt, { color: VIOLET }]}>Link</Text></Pressable>
      </View>

      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statN} testID="referral-friends-count">{me.friends_count}</Text><Text style={s.statL}>amici arrivati</Text></View>
        <View style={s.statSep} />
        <View style={s.stat}><Text style={s.statN} testID="referral-days-earned">{me.days_earned}</Text><Text style={s.statL}>giorni guadagnati</Text></View>
      </View>

      {showFriends && me.friends.length > 0 ? (
        <View style={s.friends}>
          {me.friends.map((f, i) => (
            <View key={i} style={s.friend}>
              <Ionicons name="person-circle-outline" size={20} color={VIOLET} />
              <Text style={s.friendTxt} numberOfLines={1}>{f.name} · {new Date(f.created_at).toLocaleDateString("it-IT")} · +{f.reward}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.divider, gap: 12, marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  orb: { width: 40, height: 40, borderRadius: 20, backgroundColor: VIOLET, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: C.onSurface },
  sub: { fontSize: 12.5, color: C.muted, lineHeight: 17, marginTop: 2 },
  bold: { fontWeight: "800", color: C.onSurface },
  off: { fontSize: 12.5, color: C.warning, fontWeight: "700" },
  codeBox: { borderWidth: 1.5, borderColor: VIOLET, borderStyle: "dashed", borderRadius: 14, padding: 12, backgroundColor: VIOLET + "0D", minHeight: 44 },
  codeLbl: { fontSize: 10.5, fontWeight: "800", color: VIOLET, letterSpacing: 1 },
  codeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  code: { fontSize: 20, fontWeight: "900", color: C.onSurface, letterSpacing: 1.5 },
  actions: { flexDirection: "row", gap: 8 },
  act: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 12 },
  actGhost: { borderWidth: 1, borderColor: VIOLET, backgroundColor: C.surfaceSecondary },
  actTxt: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  stats: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10 },
  stat: { flex: 1, alignItems: "center" },
  statN: { fontSize: 22, fontWeight: "900", color: VIOLET },
  statL: { fontSize: 11.5, color: C.muted, fontWeight: "600" },
  statSep: { width: 1, height: 30, backgroundColor: C.divider },
  friends: { gap: 6 },
  friend: { flexDirection: "row", alignItems: "center", gap: 8 },
  friendTxt: { flex: 1, fontSize: 12.5, color: C.onSurface },
});

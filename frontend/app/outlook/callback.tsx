// V50.z18 — Outlook OAuth callback: pagina di ritorno dopo il flow Microsoft.
// Il backend redirige qui con ?ok=1 (successo) o ?ok=0&error=... (fallito).
// Chiude la sessione WebBrowser (mobile) o mostra un breve messaggio (web).

import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

// Chiude il popup su web se rimasto aperto (best-effort)
WebBrowser.maybeCompleteAuthSession();

export default function OutlookCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ok?: string; error?: string }>();
  const ok = params?.ok === "1";
  const errorCode = params?.error;

  useEffect(() => {
    // Chiude la sessione WebBrowser (Android/iOS) — in web è no-op
    try { WebBrowser.dismissBrowser(); } catch { /* ignore */ }
    // Se aperti tramite popup web, chiudi la finestra dopo un attimo
    if (typeof window !== "undefined" && window.opener) {
      setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 1200);
    }
  }, []);

  const goBack = () => {
    router.replace("/outlook" as any);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        {ok ? (
          <>
            <View style={[styles.iconBox, { backgroundColor: HT.successTint }]}>
              <Ionicons name="checkmark-circle" size={48} color="#059669" />
            </View>
            <Text style={styles.title}>Outlook collegato!</Text>
            <Text style={styles.sub}>Puoi chiudere questa finestra e tornare all&apos;app.</Text>
          </>
        ) : errorCode ? (
          <>
            <View style={[styles.iconBox, { backgroundColor: HT.dangerTint }]}>
              <Ionicons name="close-circle" size={48} color="#DC2626" />
            </View>
            <Text style={styles.title}>Collegamento fallito</Text>
            <Text style={styles.sub}>Motivo: {errorCode}</Text>
            <Text style={styles.hint}>Torna all&apos;app e riprova.</Text>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#0078D4" />
            <Text style={styles.title}>Elaborazione…</Text>
          </>
        )}

        <Pressable onPress={goBack} style={styles.btn}>
          <Ionicons name="arrow-back" size={18} color="#FFF" />
          <Text style={styles.btnTxt}>Torna a Outlook</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  center: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 24, gap: 12,
  },
  iconBox: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "800", color: HT.text, textAlign: "center", marginTop: 6 },
  sub: { fontSize: 13, color: HT.muted, textAlign: "center", marginTop: 4, lineHeight: 18 },
  hint: { fontSize: 12, color: HT.muted, textAlign: "center", marginTop: 6, fontStyle: "italic" },
  btn: {
    marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999,
    backgroundColor: '#0078D4',
  },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

/**
 * V28.w — Google Drive OAuth callback page.
 * Google redirige qui con ?code=...&state=... — noi POST-iamo al backend
 * per scambiare il code con un refresh_token, poi torniamo alla pagina Drive.
 */
import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Platform, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export default function GoogleCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const router = useRouter();
  const [state, setState] = useState<"pending" | "success" | "error">("pending");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const code = String(params.code || "");
    const stt = String(params.state || "");
    const err = String(params.error || "");
    if (err) {
      setState("error");
      setErrorMsg(err);
      return;
    }
    if (!code || !stt) {
      setState("error");
      setErrorMsg("Parametri mancanti (code o state)");
      return;
    }
    (async () => {
      try {
        // V50.z197 — Blocco 8: se lo state appartiene alle Integrazioni AxonOS (Calendar/Contacts per sfera) lo gestisce
        // il modulo isolato; altrimenti {handled:false} e si prosegue con lo scambio Drive come prima.
        let dest = "/google-drive";
        const axi = await api<{ handled: boolean; redirect?: string }>("/axon/integrations/oauth/exchange", { method: "POST", body: { code, state: stt } }).catch(() => ({ handled: false } as { handled: boolean; redirect?: string }));
        if (axi?.handled) {
          dest = axi.redirect || "/axon-integrations";
        } else {
          await api("/google-drive/oauth/exchange", { method: "POST", body: { code, state: stt } });
        }
        setState("success");
        // Naviga alla pagina di destinazione dopo 1.5s
        setTimeout(() => {
          if (Platform.OS === "web") {
            (globalThis as any).window.location.replace(dest);
          } else {
            router.replace(dest as any);
          }
        }, 1500);
      } catch (e: any) {
        setState("error");
        setErrorMsg(e?.message || "Scambio del codice fallito");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.centerBox}>
        {state === "pending" && (
          <>
            <ActivityIndicator size="large" color="#0F9D58" />
            <Text style={styles.title}>Sto collegando Google Drive…</Text>
            <Text style={styles.sub}>Solo un attimo</Text>
          </>
        )}
        {state === "success" && (
          <>
            <Ionicons name="checkmark-circle" size={54} color="#0F9D58" />
            <Text style={[styles.title, { color: "#0F9D58" }]}>Collegato con successo!</Text>
            <Text style={styles.sub}>Torno alle impostazioni…</Text>
          </>
        )}
        {state === "error" && (
          <>
            <Ionicons name="close-circle" size={54} color="#DC2626" />
            <Text style={[styles.title, { color: "#DC2626" }]}>Collegamento fallito</Text>
            <Text style={styles.sub}>{errorMsg}</Text>
            <Pressable onPress={() => router.replace("/google-drive" as any)} style={styles.btn}>
              <Text style={styles.btnTxt}>Torna alle impostazioni</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2, justifyContent: "center", alignItems: "center" },
  centerBox: { alignItems: "center", padding: 30, gap: 10, maxWidth: 400 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text, textAlign: "center" },
  sub: { fontSize: 13, color: HT.muted, textAlign: "center" },
  btn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: HT.brand },
  btnTxt: { color: "#FFF", fontWeight: "800" },
});

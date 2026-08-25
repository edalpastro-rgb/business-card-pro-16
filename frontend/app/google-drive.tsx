/**
 * V28.w — Google Drive: schermata di collegamento/scollegamento OAuth.
 * Il vero flow OAuth funziona solo in PRODUZIONE (redirect_uri = advisoros.it).
 * In preview mostriamo comunque lo stato + bottone, ma l'apertura del popup
 * porterà a un errore Google (redirect_uri non registrato per il preview).
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

if (Platform.OS === "web") {
  try { WebBrowser.maybeCompleteAuthSession(); } catch {}
}

const GD_GREEN = "#0F9D58";

export default function GoogleDriveScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; google_email?: string; updated_at?: string; scopes?: string[] }>({ connected: false, configured: false });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<any>("/google-drive/status");
      setStatus(r || { connected: false, configured: false });
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere lo stato Google Drive");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reload status when app comes back to foreground (utente torna dal browser esterno)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onFocus = () => load();
    (globalThis as any).window?.addEventListener?.("focus", onFocus);
    return () => (globalThis as any).window?.removeEventListener?.("focus", onFocus);
  }, [load]);

  const connect = async () => {
    if (!status.configured) {
      notify("Non disponibile", "Google Drive non è configurato lato server. Contatta l'amministratore.");
      return;
    }
    try {
      setConnecting(true);
      const r = await api<{ authorization_url: string }>("/google-drive/oauth/start", { method: "POST", body: {} });
      const url = r?.authorization_url;
      if (!url) throw new Error("URL di autorizzazione non ricevuto");
      if (Platform.OS === "web") {
        // Su web apriamo lo stesso tab (redirect finale sarà /auth/google/callback che ci riporta qui)
        (globalThis as any).window.location.assign(url);
        return;
      }
      // Native: apri authSession, alla chiusura ricarichiamo lo stato
      const redirect = Linking.createURL("google-oauth");
      await WebBrowser.openAuthSessionAsync(url, redirect);
      await load();
    } catch (e: any) {
      notify("Errore connessione", e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    const ok = Platform.OS === "web"
      ? (globalThis as any).window.confirm("Scollegare Google Drive? Axon non potrà più accedere ai tuoi file Drive.")
      : true;
    if (Platform.OS !== "web") {
      // Su native usiamo Alert per conferma
      Alert.alert("Scollega Google Drive", "Axon non potrà più accedere ai tuoi file Drive.", [
        { text: "Annulla", style: "cancel" },
        { text: "Scollega", style: "destructive", onPress: doDisconnect },
      ]);
      return;
    }
    if (!ok) return;
    await doDisconnect();
  };

  const doDisconnect = async () => {
    try {
      setDisconnecting(true);
      await api("/google-drive", { method: "DELETE" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setDisconnecting(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Google Drive</Text>
          <Text style={styles.sub}>Integrazione OAuth per allegare i file Drive ad Axon</Text>
        </View>
        <View style={styles.badgeIcon}><Ionicons name="logo-google" size={18} color="#FFF" /></View>
      </View>

      {loading ? (
        <ActivityIndicator color={GD_GREEN} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}>
          {!status.configured && (
            <View style={[styles.card, { borderColor: "#F59E0B" }]}>
              <Ionicons name="warning" size={22} color="#F59E0B" />
              <Text style={styles.cardTxt}>Google Drive non è configurato lato server. Contatta l&apos;amministratore.</Text>
            </View>
          )}
          {status.configured && (
            <View style={[styles.card, { borderColor: status.connected ? GD_GREEN : theme.color.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name={status.connected ? "checkmark-circle" : "close-circle"} size={22} color={status.connected ? GD_GREEN : "#94A3B8"} />
                <Text style={[styles.cardTitle, { color: status.connected ? GD_GREEN : theme.color.onSurface }]}>
                  {status.connected ? "Collegato" : "Non collegato"}
                </Text>
              </View>
              {status.connected && status.google_email ? (
                <Text style={styles.cardMeta}>Account: <Text style={{ fontWeight: "800" }}>{status.google_email}</Text></Text>
              ) : null}
              {status.connected && Array.isArray(status.scopes) ? (
                <Text style={styles.cardMeta}>Permessi: {status.scopes.join(", ")}</Text>
              ) : null}
              <Text style={styles.cardTxt}>
                {status.connected
                  ? "Axon può accedere ai file Drive che hai autorizzato. Nella chat troverai un nuovo bottone per allegarli."
                  : "Collega il tuo Google Drive per permettere ad Axon di leggere i file che sceglierai di autorizzare (scope drive.file — solo file autorizzati, non tutto il Drive)."}
              </Text>
            </View>
          )}

          {status.configured && !status.connected && (
            <Pressable
              testID="gd-connect-btn"
              onPress={connect}
              disabled={connecting}
              style={[styles.primaryBtn, { backgroundColor: GD_GREEN }, connecting && { opacity: 0.6 }]}
            >
              {connecting ? <ActivityIndicator color="#FFF" /> : <Ionicons name="link" size={18} color="#FFF" />}
              <Text style={styles.primaryBtnTxt}>{connecting ? "Apertura autorizzazione…" : "Collega Google Drive"}</Text>
            </Pressable>
          )}

          {status.connected && (
            <Pressable
              testID="gd-disconnect-btn"
              onPress={disconnect}
              disabled={disconnecting}
              style={[styles.secondaryBtn, disconnecting && { opacity: 0.6 }]}
            >
              {disconnecting ? <ActivityIndicator color="#DC2626" /> : <Ionicons name="unlink" size={18} color="#DC2626" />}
              <Text style={styles.secondaryBtnTxt}>{disconnecting ? "Scollegamento…" : "Scollega"}</Text>
            </Pressable>
          )}

          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={18} color={theme.color.brandPrimary} />
            <Text style={styles.infoTxt}>
              Al primo collegamento Google chiederà quali file autorizzare. Solo quei file saranno accessibili ad Axon (scope <Text style={{ fontWeight: "800" }}>drive.file</Text>). Puoi revocare in qualsiasi momento dal pulsante Scollega.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 11, color: theme.color.muted, marginTop: 2, fontWeight: "600" },
  badgeIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: GD_GREEN, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: "#FFF", borderRadius: 14, padding: 12, gap: 8, borderWidth: 1.5, borderColor: theme.color.border },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  cardMeta: { fontSize: 12, color: theme.color.muted, fontWeight: "600" },
  cardTxt: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: "#DC2626", backgroundColor: "#FEF2F2" },
  secondaryBtnTxt: { color: "#DC2626", fontWeight: "800", fontSize: 14 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, backgroundColor: "#EDE9FE" },
  infoTxt: { flex: 1, fontSize: 12, color: theme.color.onSurface, lineHeight: 17 },
});

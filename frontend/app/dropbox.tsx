/**
 * V49.i — Dropbox OAuth connection screen.
 *
 * Parallel a `google-drive.tsx`. Flusso:
 *   1) L'utente tocca "Collega Dropbox" → POST /api/dropbox/oauth/start
 *      → riceve authorization_url.
 *   2) Web: `window.location.assign(url)` — la stessa tab.
 *      Native: `WebBrowser.openAuthSessionAsync(url, callbackUrl)`.
 *   3) Dropbox redirige a `/auth/dropbox/callback?code=...&state=...` (rotta
 *      frontend) che POSTa il code su /api/dropbox/oauth/exchange.
 *   4) Il backend salva il refresh_token cifrato e chiudiamo il flow.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { buildOAuthReturn } from "@/src/utils/oauthReturn";

const DBX_BLUE = "#0061FF";

type DbxStatus = {
  connected: boolean;
  configured: boolean;
  dropbox_email?: string;
  account_id?: string;
  updated_at?: string;
};

export default function DropboxScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<DbxStatus>({ connected: false, configured: false });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<DbxStatus>("/dropbox/status");
      setStatus(r || { connected: false, configured: false });
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere lo stato Dropbox");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reload status when web tab comes back to foreground
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onFocus = () => load();
    (globalThis as any).window?.addEventListener?.("focus", onFocus);
    return () => (globalThis as any).window?.removeEventListener?.("focus", onFocus);
  }, [load]);

  const connect = async () => {
    if (!status.configured) {
      notify("Non disponibile", "Dropbox non è configurato lato server. Contatta l'amministratore.");
      return;
    }
    try {
      setConnecting(true);
      // V50.z154 — deep-link di ritorno (frontend://dropbox?oauth=dropbox) come
      // returnUrl del custom tab + info per la pagina di callback (intent Android).
      const ret = Platform.OS === "web" ? null : buildOAuthReturn("dropbox", "dropbox");
      const r = await api<{ authorization_url: string }>("/dropbox/oauth/start", { method: "POST", body: ret?.body || {} });
      const url = r?.authorization_url;
      if (!url) throw new Error("URL di autorizzazione non ricevuto");

      if (Platform.OS === "web" || !ret) {
        (globalThis as any).window.location.assign(url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, ret.returnUrl, {
        showInRecents: false,
        preferEphemeralSession: true,
      });
      // V50.n — Polling più lungo (30 tentativi × 1.5s = 45s) e messaggio
      // di errore chiaro se dopo il flow non risulta collegato.
      if (result.type === "success" || result.type === "cancel" || result.type === "dismiss") {
        let ok = false;
        for (let i = 0; i < 30; i++) {
          try {
            const s = await api<DbxStatus>("/dropbox/status");
            if (s?.connected) {
              setStatus(s);
              notify("Collegato ✅", "Dropbox è ora collegato ad Axon");
              ok = true;
              break;
            }
          } catch { /* ignore */ }
          await new Promise((rs) => setTimeout(rs, 1500));
        }
        if (!ok) {
          notify(
            "Connessione Dropbox non completata",
            "Verifica sul Dropbox App Console che l'URI di redirect autorizzato sia:\nhttps://business-card-pro-16.emergent.host/auth/dropbox/callback\n\nPoi riprova.",
          );
        }
      }
      await load();
    } catch (e: any) {
      notify("Errore connessione", e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    try {
      setDisconnecting(true);
      await api("/dropbox", { method: "DELETE" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || String(e));
    } finally { setDisconnecting(false); }
  };

  const disconnect = async () => {
    if (Platform.OS !== "web") {
      Alert.alert("Scollega Dropbox", "Axon non potrà più accedere ai tuoi file Dropbox.", [
        { text: "Annulla", style: "cancel" },
        { text: "Scollega", style: "destructive", onPress: doDisconnect },
      ]);
      return;
    }
    const ok = (globalThis as any).window.confirm("Scollegare Dropbox? Axon non potrà più accedere ai tuoi file Dropbox.");
    if (ok) await doDisconnect();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dropbox</Text>
          <Text style={styles.sub}>Integrazione OAuth per allegare i file Dropbox ad Axon</Text>
        </View>
        <View style={styles.badgeIcon}><Ionicons name="logo-dropbox" size={18} color="#FFF" /></View>
      </View>

      {loading ? (
        <ActivityIndicator color={DBX_BLUE} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: pagePad }}>
          {!status.configured && (
            <View style={[styles.card, { borderColor: "#F59E0B" }]}>
              <Ionicons name="warning" size={22} color="#F59E0B" />
              <Text style={styles.cardTxt}>Dropbox non è configurato lato server. Contatta l&apos;amministratore.</Text>
            </View>
          )}
          {status.configured && (
            <View style={[styles.card, { borderColor: status.connected ? DBX_BLUE : theme.color.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name={status.connected ? "checkmark-circle" : "close-circle"} size={22} color={status.connected ? DBX_BLUE : "#94A3B8"} />
                <Text style={[styles.cardTitle, { color: status.connected ? DBX_BLUE : theme.color.onSurface }]}>
                  {status.connected ? "Collegato" : "Non collegato"}
                </Text>
              </View>
              {status.connected && status.dropbox_email ? (
                <Text style={styles.cardMeta}>Account: <Text style={{ fontWeight: "800" }}>{status.dropbox_email}</Text></Text>
              ) : null}
              <Text style={styles.cardTxt}>
                {status.connected
                  ? "Axon può accedere ai file Dropbox che autorizzi. Nella chat troverai il bottone Dropbox per allegarli."
                  : "Collega il tuo Dropbox per permettere ad Axon di leggere i file che sceglierai (sola lettura)."}
              </Text>
            </View>
          )}

          {status.configured && !status.connected && (
            <Pressable
              testID="dbx-connect-btn"
              onPress={connect}
              disabled={connecting}
              style={[styles.primaryBtn, { backgroundColor: DBX_BLUE }, connecting && { opacity: 0.6 }]}
            >
              {connecting ? <ActivityIndicator color="#FFF" /> : <Ionicons name="link" size={18} color="#FFF" />}
              <Text style={styles.primaryBtnTxt}>{connecting ? "Apertura autorizzazione…" : "Collega Dropbox"}</Text>
            </Pressable>
          )}

          {status.connected && (
            <Pressable
              testID="dbx-disconnect-btn"
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
              Solo lettura dei file. Il refresh token è cifrato lato server. Puoi revocare l&apos;accesso in ogni momento anche dal tuo account Dropbox.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: theme.color.surface, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  title: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface },
  sub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  badgeIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: DBX_BLUE, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: theme.color.surface, borderRadius: 14, borderWidth: 1, padding: 14, gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: "900" },
  cardTxt: { fontSize: 13, color: theme.color.onSurface, lineHeight: 19 },
  cardMeta: { fontSize: 11, color: theme.color.muted },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12 },
  primaryBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#DC2626", backgroundColor: "#FEE2E2" },
  secondaryBtnTxt: { color: "#DC2626", fontWeight: "900", fontSize: 14 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, backgroundColor: "#F1F5F9", borderRadius: 12, marginTop: 4 },
  infoTxt: { flex: 1, fontSize: 11, color: theme.color.muted, lineHeight: 16 },
});

/**
 * V29.ai — Google Drive: schermata di collegamento/scollegamento OAuth.
 *
 * Flusso mobile SEMPLIFICATO (Expo Go safe):
 *  - Su mobile e web utilizziamo il flusso legacy con state server-side.
 *  - Il redirect URI di Google punta a `https://advisoros.it/auth/google/callback`
 *    (già configurato nella Google Cloud Console + in backend .env).
 *  - Su mobile apriamo l'URL di autorizzazione con `WebBrowser.openAuthSessionAsync`,
 *    passando come `returnUrl` lo stesso redirect https. Quando Google reindirizza
 *    a quel URL il backend completa lo scambio del code lato server; nel frattempo
 *    il WebBrowser si chiude e noi ricarichiamo lo stato via `/google-drive/status`.
 *  - Nessun uso di `expo-auth-session` → funziona in Expo Go senza rebuild nativo.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

// Su web questa call chiude la popup di auth restituendo il controllo alla pagina.
try { WebBrowser.maybeCompleteAuthSession(); } catch { /* noop */ }

const GD_GREEN = "#0F9D58";
// Nota: il redirect URI https di Google è configurato SOLO lato backend
// (GOOGLE_DRIVE_REDIRECT_URI) e deve essere registrato in Google Cloud Console.

export default function GoogleDriveScreen() {
  const router = useRouter();
  // V50.z110 — Parametri dal deep-link di ritorno (frontend://google-drive?oauth=google&status=ok|err)
  const { oauth: oauthParam, status: oauthStatus } = useLocalSearchParams<{ oauth?: string; status?: string }>();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; google_email?: string; updated_at?: string; scopes?: string[] }>({ connected: false, configured: false });
  const [folders, setFolders] = useState<Array<{ folder_id: string; folder_name: string; picked_at?: string }>>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<any>("/google-drive/status");
      setStatus(r || { connected: false, configured: false });
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile leggere lo stato Google Drive");
    } finally { setLoading(false); }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      setFoldersLoading(true);
      const r = await api<{ folders: Array<{ folder_id: string; folder_name: string; picked_at?: string }> }>("/google-drive/folders");
      setFolders(r?.folders || []);
    } catch (e: any) {
      // Silenzioso: se non è connesso l'endpoint può fallire
    } finally { setFoldersLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (status.connected) loadFolders();
  }, [status.connected, loadFolders]);

  // V50.i — Ricarica cartelle quando la schermata torna in foreground
  // (utile dopo il picker che chiama router.back())
  useEffect(() => {
    if (Platform.OS === "web") return;
    // useFocusEffect è più corretto ma richiede import extra; qui basta un poll
    const t = setInterval(() => { if (status.connected) loadFolders(); }, 3000);
    return () => clearInterval(t);
  }, [status.connected, loadFolders]);

  const removeFolder = async (folder_id: string, folder_name: string) => {
    const doRemove = async () => {
      try {
        await api(`/google-drive/folders/${encodeURIComponent(folder_id)}`, { method: "DELETE" });
        await loadFolders();
      } catch (e: any) {
        notify("Errore", e?.message || "Rimozione fallita");
      }
    };
    if (Platform.OS === "web") {
      const ok = (globalThis as any).window.confirm(`Rimuovere "${folder_name}" da Axon?`);
      if (ok) await doRemove();
    } else {
      Alert.alert("Rimuovi cartella", `Rimuovere "${folder_name}" da Axon?`, [
        { text: "Annulla", style: "cancel" },
        { text: "Rimuovi", style: "destructive", onPress: doRemove },
      ]);
    }
  };

  // Reload status when web tab comes back to foreground
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
      // 1) Ottieni l'URL di autorizzazione dal backend (con state).
      const r = await api<{ authorization_url: string }>("/google-drive/oauth/start", { method: "POST", body: {} });
      const url = r?.authorization_url;
      if (!url) throw new Error("URL di autorizzazione non ricevuto");

      if (Platform.OS === "web") {
        // Web: redirect nella stessa tab, torneremo a /google-drive dopo il callback.
        (globalThis as any).window.location.assign(url);
        return;
      }

      // 2) Mobile: apri l'auth session nativa in-app.
      //    V50.z110 — `returnUrl` = DEEP-LINK dell'app (frontend://google-drive
      //    su APK, exp://… in Expo Go), NON l'https del backend: su Android un
      //    returnUrl https non viene mai intercettato dal custom tab (serve un
      //    App Link verificato), quindi il browser restava aperto sulla pagina
      //    del backend e l'app non riceveva il ritorno. Il backend, dopo aver
      //    scambiato il code lato server, reindirizza a questo stesso deep-link
      //    → il custom tab si chiude e torniamo qui con ?oauth=google&status=ok.
      const appReturnUrl = Linking.createURL("google-drive", { queryParams: { oauth: "google" } });
      const result = await WebBrowser.openAuthSessionAsync(url, appReturnUrl, {
        showInRecents: false,
        preferEphemeralSession: true,
      });
      // V29.aq — Il code/state viene scambiato UNA SOLA VOLTA, lato server, dalla
      // route GET /auth/google/callback nell'istante stesso in cui Google
      // reindirizza lì (vedi backend). Questo vale sia quando WebBrowser rileva
      // il redirect come "success" sia quando l'utente chiude il custom tab
      // prima che WebBrowser se ne accorga ("cancel"/"dismiss"): in entrambi i
      // casi il browser ha già raggiunto il callback e il backend ha già
      // consumato code+state. Un secondo scambio client-side con lo stesso
      // code/state fallirebbe sempre (state già cancellato, code già usato con
      // Google → invalid_grant), mostrando un falso errore anche quando il
      // collegamento è riuscito. Facciamo quindi polling di /google-drive/status
      // per accorgerci del collegamento non appena il backend lo ha salvato.
      if (result.type === "success" || result.type === "cancel" || result.type === "dismiss") {
        for (let i = 0; i < 14; i++) {
          try {
            const s = await api<any>("/google-drive/status");
            if (s?.connected) {
              setStatus(s);
              notify("Collegato", "Google Drive è ora collegato a Axon");
              return;
            }
          } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      await load();
    } catch (e: any) {
      notify("Errore connessione", e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  };

  // V50.z110 — Rientro dal deep-link: ricarica lo stato e avvisa l'utente.
  useFocusEffect(useCallback(() => {
    if (oauthParam !== "google") return;
    (async () => {
      await load();
      try {
        const s = await api<any>("/google-drive/status");
        if (s?.connected) notify("Collegato", "Google Drive è ora collegato a Axon");
        else if (oauthStatus === "err") notify("Collegamento non riuscito", "Riprova con \"Collega Google Drive\".");
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthParam, oauthStatus]));

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
          {status.configured && !status.connected && !!(status as any).redirect_uri && (
            <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 8 }} selectable testID="gd-redirect-uri">
              Redirect URI OAuth (deve essere registrato in Google Cloud Console): {(status as any).redirect_uri}
            </Text>
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

          {/* V50.i — Cartelle Axon (Google Picker) */}
          {status.connected && (
            <View style={styles.folderBlock}>
              <View style={styles.folderHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.folderTitle}>📂 Cartelle Axon</Text>
                  <Text style={styles.folderSub}>
                    Axon leggerà SOLO i file nelle cartelle che scegli qui. Puoi aggiungerne quante vuoi.
                  </Text>
                </View>
                {/* V50.o — Refresh manuale della lista cartelle */}
                <Pressable
                  testID="gd-refresh-folders-btn"
                  onPress={loadFolders}
                  hitSlop={10}
                  disabled={foldersLoading}
                  style={[styles.refreshBtn, foldersLoading && { opacity: 0.5 }]}
                >
                  {foldersLoading ? (
                    <ActivityIndicator size="small" color={GD_GREEN} />
                  ) : (
                    <Ionicons name="refresh" size={18} color={GD_GREEN} />
                  )}
                </Pressable>
              </View>

              {foldersLoading ? (
                <ActivityIndicator color={GD_GREEN} style={{ marginTop: 8 }} />
              ) : folders.length === 0 ? (
                <View style={styles.emptyFolders}>
                  <Ionicons name="folder-open-outline" size={26} color="#94A3B8" />
                  <Text style={styles.emptyTxt}>Nessuna cartella scelta ancora</Text>
                  <Text style={styles.emptyHint}>Tocca &ldquo;Scegli cartella&rdquo; per aprire il Google Picker</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {folders.map((f) => (
                    <View key={f.folder_id} style={styles.folderRow}>
                      <Ionicons name="folder" size={20} color={GD_GREEN} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.folderName} numberOfLines={1}>{f.folder_name}</Text>
                        <Text style={styles.folderId} numberOfLines={1}>{f.folder_id}</Text>
                      </View>
                      <Pressable
                        onPress={() => removeFolder(f.folder_id, f.folder_name)}
                        hitSlop={10}
                        style={styles.folderDelBtn}
                      >
                        <Ionicons name="trash-outline" size={18} color="#DC2626" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <Pressable
                testID="gd-pick-folder-btn"
                onPress={() => router.push("/google-drive-picker" as any)}
                style={styles.pickerBtn}
              >
                <Ionicons name="add-circle" size={20} color="#FFF" />
                <Text style={styles.pickerBtnTxt}>
                  {folders.length === 0 ? "Scegli cartella" : "Aggiungi altra cartella"}
                </Text>
              </Pressable>
            </View>
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
  // V29.bb — Stile Optima
  badgeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GD_GREEN,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
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
  // V50.i — Cartelle Axon
  folderBlock: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1.5,
    borderColor: theme.color.border,
  },
  folderHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  refreshBtn: {
    padding: 8, borderRadius: 999, backgroundColor: "#ECFDF5",
    borderWidth: 1, borderColor: "#A7F3D0",
    alignItems: "center", justifyContent: "center", minWidth: 34, minHeight: 34,
  },
  folderTitle: { fontSize: 15, fontWeight: "900", color: theme.color.onSurface },
  folderSub: { fontSize: 12, color: theme.color.muted, marginTop: 3, lineHeight: 17 },
  emptyFolders: {
    alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 18, paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed",
    backgroundColor: "#F8FAFC",
  },
  emptyTxt: { fontSize: 13, color: theme.color.onSurface, fontWeight: "700" },
  emptyHint: { fontSize: 11, color: theme.color.muted },
  folderRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: "#F1F5F9",
    borderWidth: 1, borderColor: "#E2E8F0",
  },
  folderName: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  folderId: { fontSize: 10, color: theme.color.muted, marginTop: 2 },
  folderDelBtn: { padding: 6, borderRadius: 8 },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 13, borderRadius: 12, backgroundColor: GD_GREEN,
  },
  pickerBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
});

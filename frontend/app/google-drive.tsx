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
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { buildOAuthReturn } from "@/src/utils/oauthReturn";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

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
      // V50.z558 — Rientro dal callback OAuth (pagina ricaricata): la sessione può non essere ancora pronta → NESSUN popup
      // «Not authenticated»; la pagina riprova da sola (vedi effetto oauth=google) e la guardia di autenticazione fa il resto.
      if (/not authenticated|401/i.test(String(e?.message || ""))) return;
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

  // V50.z155 — Stato indice Axon (file delle cartelle monitorate letti da Axon)
  type IdxStatus = { indexed_files: number; failed_files?: number; folders?: number; running?: boolean; refresh_frequency?: string; stats?: { scanned?: number; updated?: number; skipped?: number; failed?: number }; meta?: { status?: string; error?: string | null; last_run_at?: string; files_count?: number } };
  const [idx, setIdx] = useState<IdxStatus | null>(null);
  const [reindexing, setReindexing] = useState(false);
  // V50.z558 — Frequenza aggiornamento (Impostazioni → Google Drive)
  const FREQ_OPTIONS: Array<{ id: string; label: string }> = [
    { id: "hourly", label: "Ogni ora" }, { id: "daily", label: "Ogni giorno" }, { id: "weekly", label: "Ogni settimana" }, { id: "monthly", label: "Ogni mese" }, { id: "manual", label: "Manuale" },
  ];
  const [freq, setFreq] = useState<string>("hourly");
  const [freqSaving, setFreqSaving] = useState(false);
  const setFrequency = useCallback(async (f: string) => {
    const prev = freq;
    setFreq(f); setFreqSaving(true);
    try { await api("/google-drive/refresh-frequency", { method: "PUT", body: { frequency: f } }); }
    catch (e: any) { setFreq(prev); notify("Errore", e?.message || "Impossibile salvare la frequenza"); }
    finally { setFreqSaving(false); }
  }, [freq]);
  const loadIdx = useCallback(async () => {
    try {
      const r = await api<IdxStatus>("/google-drive/reindex/status");
      setIdx(r);
      if (r?.refresh_frequency) setFreq(r.refresh_frequency);
      return r;
    } catch { return null; }
  }, []);
  useEffect(() => {
    if (status.connected) loadIdx();
  }, [status.connected, folders.length, loadIdx]);
  const reindexNow = useCallback(async () => {
    setReindexing(true);
    try {
      await api("/google-drive/reindex", { method: "POST" });
      // Polling fino a fine indicizzazione (max ~3 min)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await loadIdx();
        if (r && !r.running) break;
      }
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile avviare l'indicizzazione");
    } finally { setReindexing(false); }
  }, [loadIdx]);
  const fmtIdxTime = (s?: string) => {
    if (!s) return "mai";
    try { return new Date(s).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return s; }
  };

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
      // V50.z154 — Passiamo al backend il deep-link di ritorno + package Android:
      // la pagina di callback userà intent:// (Chrome/Samsung) per riaprire l'app.
      const ret = Platform.OS === "web" ? null : buildOAuthReturn("google-drive", "google");
      // 1) Ottieni l'URL di autorizzazione dal backend (con state).
      const r = await api<{ authorization_url: string }>("/google-drive/oauth/start", { method: "POST", body: ret?.body || {} });
      const url = r?.authorization_url;
      if (!url) throw new Error("URL di autorizzazione non ricevuto");

      if (Platform.OS === "web" || !ret) {
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
      const appReturnUrl = ret.returnUrl;
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
  // V50.z558 — Dopo il callback Google la pagina viene ricaricata: riprova lo stato per qualche secondo (sessione in
  // ripristino) e NON mostrare mai popup di errore; mostra solo l'esito positivo quando lo stato è aggiornato.
  useFocusEffect(useCallback(() => {
    if (oauthParam !== "google") return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        try {
          const s = await api<any>("/google-drive/status");
          if (cancelled) return;
          setStatus(s || { connected: false, configured: false });
          setLoading(false);
          if (s?.connected) { notify("Collegato", "Google Drive è ora collegato a Axon"); return; }
          if (oauthStatus === "err") { notify("Collegamento non riuscito", "Riprova con \"Collega Google Drive\"."); return; }
          if (i >= 2) return; // stato letto ma non connesso: niente popup, la pagina mostra «Collega»
        } catch { /* sessione non ancora pronta: riprova */ }
        await new Promise((r) => setTimeout(r, 800));
      }
    })();
    return () => { cancelled = true; };
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
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
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
            <View style={[styles.card, { borderColor: '#F59E0B' }]}>
              <Ionicons name="warning" size={22} color="#F59E0B" />
              <Text style={styles.cardTxt}>Google Drive non è configurato lato server. Contatta l&apos;amministratore.</Text>
            </View>
          )}
          {status.configured && (
            <View style={[styles.card, { borderColor: status.connected ? GD_GREEN : HT.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name={status.connected ? "checkmark-circle" : "close-circle"} size={22} color={status.connected ? GD_GREEN : HT.muted} />
                <Text style={[styles.cardTitle, { color: status.connected ? GD_GREEN : HT.text }]}>
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
            <Text style={{ fontSize: 11, color: HT.muted, marginTop: 8 }} selectable testID="gd-redirect-uri">
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
                    Axon legge in automatico i file di queste cartelle (sottocartelle incluse). Puoi aggiungerne quante vuoi.
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
                  <Ionicons name="folder-open-outline" size={26} color={HT.muted} />
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

              {/* V50.z155 — Indice Axon: cosa vede davvero l'assistente */}
              {folders.length > 0 && (
                <View style={styles.idxCard} testID="gd-index-card">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="sparkles" size={16} color="#7C3AED" />
                    <Text style={styles.idxTitle}>Indice Axon</Text>
                    {(idx?.running || reindexing) && <ActivityIndicator size="small" color="#7C3AED" />}
                  </View>
                  <Text style={styles.idxMeta} testID="gd-index-count">
                    {idx ? `${idx.indexed_files} file letti da Axon` : "…"}
                    {idx && (idx.failed_files || 0) > 0 ? ` (${idx.failed_files} non leggibili)` : ""}
                    {idx?.meta?.last_run_at ? ` · aggiornato ${fmtIdxTime(idx.meta.last_run_at)}` : ""}
                    {idx?.running || reindexing ? " · indicizzazione in corso…" : ""}
                  </Text>
                  {idx?.stats && (idx.stats.scanned || 0) > 0 && (
                    <Text style={styles.idxHint} testID="gd-index-stats">Ultima scansione: {idx.stats.scanned} trovati · {idx.stats.updated || 0} aggiornati · {idx.stats.skipped || 0} invariati{(idx.stats.failed || 0) > 0 ? ` · ${idx.stats.failed} errori` : ""}</Text>
                  )}
                  {idx?.meta?.status === "error" && !!idx?.meta?.error && (
                    <Text style={styles.idxErr}>Ultimo errore: {idx.meta.error}</Text>
                  )}
                  {idx && idx.indexed_files === 0 && !idx.running && !reindexing && (
                    <Text style={styles.idxHint}>Nessun file indicizzato: tocca &ldquo;Aggiorna indice&rdquo; (PDF, testo, CSV, Documenti e Fogli Google nelle cartelle sopra, sottocartelle incluse).</Text>
                  )}
                  <Pressable
                    testID="gd-reindex-btn"
                    onPress={reindexNow}
                    disabled={reindexing || !!idx?.running}
                    style={[styles.idxBtn, (reindexing || idx?.running) && { opacity: 0.5 }]}
                  >
                    <Ionicons name="refresh" size={16} color="#7C3AED" />
                    <Text style={styles.idxBtnTxt}>Aggiorna indice ora</Text>
                  </Pressable>
                </View>
              )}

              {/* V50.z558 — Frequenza aggiornamento + Aggiorna ora */}
              <View style={styles.idxCard} testID="gd-freq-card">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="time-outline" size={16} color="#7C3AED" />
                  <Text style={styles.idxTitle}>Frequenza aggiornamento</Text>
                  {freqSaving && <ActivityIndicator size="small" color="#7C3AED" />}
                </View>
                <Text style={styles.idxHint}>Ogni quanto Axon rilegge le cartelle collegate. «Manuale» = solo con «Aggiorna ora».</Text>
                <View style={styles.freqRow}>
                  {FREQ_OPTIONS.map((o) => (
                    <Pressable key={o.id} onPress={() => setFrequency(o.id)} disabled={freqSaving} style={[styles.freqPill, freq === o.id && styles.freqPillOn]} testID={`gd-freq-${o.id}`}>
                      <Text style={[styles.freqPillTxt, freq === o.id && styles.freqPillTxtOn]}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  testID="gd-refresh-now-btn"
                  onPress={reindexNow}
                  disabled={reindexing || !!idx?.running}
                  style={[styles.idxBtn, (reindexing || idx?.running) && { opacity: 0.5 }]}
                >
                  {(reindexing || idx?.running) ? <ActivityIndicator size="small" color="#7C3AED" /> : <Ionicons name="flash" size={16} color="#7C3AED" />}
                  <Text style={styles.idxBtnTxt}>{(reindexing || idx?.running) ? "Rilettura in corso…" : "Aggiorna ora"}</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={18} color={HT.brand} />
            <Text style={styles.infoTxt}>
              Axon legge in automatico i file delle cartelle scelte (aggiornamento ogni 30 minuti e ad ogni nuova cartella). Puoi anche allegare un singolo file in chat con l&apos;icona G. Revoca l&apos;accesso in qualsiasi momento con Scollega.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11, color: HT.muted, marginTop: 2, fontWeight: "600" },
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
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 12, gap: 8, borderWidth: 1.5, borderColor: HT.border },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  cardMeta: { fontSize: 12, color: HT.muted, fontWeight: "600" },
  cardTxt: { fontSize: 13, color: HT.text, lineHeight: 18 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#DC2626', backgroundColor: HT.dangerTint },
  secondaryBtnTxt: { color: "#DC2626", fontWeight: "800", fontSize: 14 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, backgroundColor: HT.violetTint },
  infoTxt: { flex: 1, fontSize: 12, color: HT.text, lineHeight: 17 },
  // V50.i — Cartelle Axon
  folderBlock: {
    backgroundColor: HT.card,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1.5,
    borderColor: HT.border,
  },
  folderHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  refreshBtn: {
    padding: 8, borderRadius: 999, backgroundColor: HT.successTint,
    borderWidth: 1, borderColor: '#A7F3D0',
    alignItems: "center", justifyContent: "center", minWidth: 34, minHeight: 34,
  },
  folderTitle: { fontSize: 15, fontWeight: "900", color: HT.text },
  folderSub: { fontSize: 12, color: HT.muted, marginTop: 3, lineHeight: 17 },
  emptyFolders: {
    alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 18, paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: HT.border, borderStyle: "dashed",
    backgroundColor: HT.card2,
  },
  emptyTxt: { fontSize: 13, color: HT.text, fontWeight: "700" },
  emptyHint: { fontSize: 11, color: HT.muted },
  folderRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: HT.card2,
    borderWidth: 1, borderColor: HT.border,
  },
  folderName: { fontSize: 13, fontWeight: "800", color: HT.text },
  folderId: { fontSize: 10, color: HT.muted, marginTop: 2 },
  folderDelBtn: { padding: 6, borderRadius: 8 },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 13, borderRadius: 12, backgroundColor: GD_GREEN,
  },
  pickerBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  // V50.z155 — Indice Axon
  idxCard: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66', gap: 6 },
  idxTitle: { fontSize: 13, fontWeight: "900", color: HT.violet },
  idxMeta: { fontSize: 12, color: HT.text, fontWeight: "600" },
  idxErr: { fontSize: 11.5, color: "#DC2626", fontWeight: "600" },
  idxHint: { fontSize: 11.5, color: HT.muted, lineHeight: 16 },
  idxBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#7C3AED', backgroundColor: HT.card },
  idxBtnTxt: { color: "#7C3AED", fontWeight: "800", fontSize: 13 },
  freqRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  freqPill: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: HT.violet + '66', backgroundColor: HT.card, alignItems: "center", justifyContent: "center" },
  freqPillOn: { backgroundColor: HT.violet, borderColor: HT.violet },
  freqPillTxt: { color: HT.text, fontWeight: "700", fontSize: 13 },
  freqPillTxtOn: { color: "#FFF" },
});

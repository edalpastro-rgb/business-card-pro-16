/**
 * V50.i — Google Drive Folder Picker (WebView + Google Picker JS SDK).
 *
 * Flusso:
 *  1) GET /api/google-drive/picker-config → { api_key, app_id, oauth_token }
 *  2) Render WebView con HTML inline che carica Google Picker JS SDK
 *  3) L'utente seleziona 1+ cartelle → postMessage `{type:"picked", folders:[...]}`
 *  4) Salviamo le cartelle via POST /api/google-drive/folders
 *  5) router.back()
 *
 * Nota: il Picker funziona solo se l'utente è già connesso a Drive (per
 * ottenere l'access_token) e se sul progetto Cloud sono abilitate:
 *  - Google Picker API
 *  - Google Drive API
 * e se GOOGLE_API_KEY è configurata lato server.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Platform, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type PickerConfig = {
  api_key: string;
  app_id: string;
  client_id: string;
  oauth_token: string;
};

const GD_GREEN = "#0F9D58";

function buildPickerHtml(cfg: PickerConfig) {
  // NB: gli apici sono escape-safe perché usiamo JSON.stringify quando iniettiamo.
  const apiKey = JSON.stringify(cfg.api_key);
  const appId = JSON.stringify(cfg.app_id);
  const oauthToken = JSON.stringify(cfg.oauth_token);
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Google Picker</title>
<style>
  html, body { margin:0; padding:0; height:100%; background:#0F2438; color:#FFF;
               font-family:-apple-system,Segoe UI,Roboto,sans-serif; }
  #status { position:absolute; top:0; left:0; right:0; padding:14px;
            text-align:center; font-size:13px; color:rgba(255,255,255,0.75); }
  #err { color:#FCA5A5; font-weight:700; }
</style>
</head>
<body>
<div id="status">Caricamento Google Picker…</div>
<script>
  var API_KEY = ${apiKey};
  var APP_ID = ${appId};
  var OAUTH_TOKEN = ${oauthToken};

  function postToApp(obj) {
    var s = JSON.stringify(obj);
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(s);
      } else {
        // Fallback su web: navigate to a synthetic URL that RN capture via onNavigationStateChange
        window.location.href = "gdpicker://msg?data=" + encodeURIComponent(s);
      }
    } catch (e) {}
  }

  function showErr(msg) {
    var el = document.getElementById("status");
    if (el) { el.innerHTML = '<span id="err">' + msg + '</span>'; }
  }

  function onPickerApiLoad() {
    try {
      // V50.n — Vista FOLDERS con NAVIGAZIONE ricorsiva:
      //  • ViewId.FOLDERS mostra solo cartelle (senza file), navigabili
      //  • setSelectFolderEnabled(true) permette la selezione della cartella corrente
      //  • setIncludeFolders(true) mostra i sottolivelli
      //  • setMode(LIST) è più leggibile su mobile (una colonna, tap → navigazione)
      //  • MULTISELECT_ENABLED per scegliere più cartelle in una sessione
      //  • NAV_HIDDEN per pulire l'UI (l'utente non naviga tra viste)
      // NB: NON usare setMimeTypes("application/vnd.google-apps.folder") — su ViewId.FOLDERS
      // filtra troppo e blocca la navigazione dentro le sottocartelle.
      var view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setParent("root")
        .setMode(google.picker.DocsViewMode.LIST);

      var picker = new google.picker.PickerBuilder()
        .setAppId(APP_ID)
        .setOAuthToken(OAUTH_TOKEN)
        .setDeveloperKey(API_KEY)
        .setLocale("it")
        .setTitle("Scegli le cartelle Axon")
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setCallback(pickerCallback)
        .setOrigin(window.location.protocol + "//" + window.location.host)
        .build();
      picker.setVisible(true);
      // Segnala al bridge RN che il picker è aperto (debug)
      postToApp({ type: "picker_ready" });
    } catch (e) {
      showErr("Errore inizializzazione Picker: " + (e && e.message ? e.message : e));
      postToApp({ type: "error", error: String(e && e.message || e) });
    }
  }

  function pickerCallback(data) {
    if (!data || !data.action) return;
    if (data.action === google.picker.Action.PICKED) {
      var folders = (data.docs || []).map(function(d) {
        return { id: d.id, name: d.name || "Cartella" };
      });
      postToApp({ type: "picked", folders: folders });
    } else if (data.action === google.picker.Action.CANCEL) {
      postToApp({ type: "cancel" });
    }
  }

  // Carica gapi + picker
  var s = document.createElement("script");
  s.src = "https://apis.google.com/js/api.js";
  s.async = true; s.defer = true;
  s.onload = function() {
    try {
      gapi.load("picker", { callback: onPickerApiLoad, onerror: function(e){ showErr("gapi.load picker failed"); } });
    } catch (e) {
      showErr("gapi.load exception: " + e);
    }
  };
  s.onerror = function() { showErr("Impossibile caricare gapi (rete?)"); postToApp({ type:"error", error:"gapi load failed" }); };
  document.body.appendChild(s);
</script>
</body>
</html>`;
}

export default function GoogleDrivePickerScreen() {
  const router = useRouter();
  const [cfg, setCfg] = useState<PickerConfig | null>(null);
  const [err, setErr] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await api<PickerConfig>("/google-drive/picker-config");
        setCfg(c);
      } catch (e: any) {
        setErr(e?.message || "Impossibile ottenere la configurazione del picker");
      }
    })();
  }, []);

  const html = useMemo(() => (cfg ? buildPickerHtml(cfg) : ""), [cfg]);

  const handleMessage = async (raw: string) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === "picker_ready") {
        // Debug: picker aperto
        console.log("[Picker] pronto");
        return;
      }
      if (data.type === "picked" && Array.isArray(data.folders) && data.folders.length > 0) {
        setSaving(true);
        try {
          const r = await api<{ added: number }>("/google-drive/folders", {
            method: "POST",
            body: { folders: data.folders },
          });
          notify("Cartelle salvate", `${r?.added || data.folders.length} cartella/e aggiunta/e ad Axon`);
        } catch (e: any) {
          notify("Errore", e?.message || "Salvataggio cartelle fallito");
        } finally {
          setSaving(false);
          router.back();
        }
      } else if (data.type === "cancel") {
        router.back();
      } else if (data.type === "error") {
        setErr(data.error || "Errore nel picker");
      }
    } catch {
      // ignore
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Text style={styles.title}>Scegli cartelle Axon</Text>
        <View style={{ width: 26 }} />
      </View>

      {err ? (
        <View style={styles.errBox}>
          <Ionicons name="alert-circle" size={40} color="#FCA5A5" />
          <Text style={styles.errTitle}>Picker non disponibile</Text>
          <Text style={styles.errMsg}>{err}</Text>
          {err.toLowerCase().includes("api_key") || err.toLowerCase().includes("api key") ? (
            <Text style={styles.hint}>
              Chiedi all&apos;amministratore di configurare GOOGLE_API_KEY e abilitare Picker API su Google Cloud Console.
            </Text>
          ) : null}
          <Pressable style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnTxt}>Chiudi</Text>
          </Pressable>
        </View>
      ) : !cfg ? (
        <View style={styles.center}>
          <ActivityIndicator color={GD_GREEN} size="large" />
          <Text style={styles.hint}>Preparo Google Picker…</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView
            originWhitelist={["*"]}
            source={{ html, baseUrl: "https://business-card-pro-16.emergent.host" }}
            onMessage={(e) => handleMessage(e.nativeEvent.data)}
            onShouldStartLoadWithRequest={(req) => {
              // Intercept gdpicker:// fallback for older WebViews on web
              if (req.url.startsWith("gdpicker://msg")) {
                try {
                  const q = decodeURIComponent(req.url.split("data=")[1] || "");
                  handleMessage(q);
                } catch { /* noop */ }
                return false;
              }
              // Blocca l'apertura di link esterni (es. sign-in) nella stessa WebView
              // in favore del browser di sistema quando non è il picker stesso.
              if (req.url.startsWith("https://accounts.google.com") ||
                  req.url.startsWith("https://drive.google.com") ||
                  req.url.startsWith("https://docs.google.com") ||
                  req.url.startsWith("https://apis.google.com") ||
                  req.url.startsWith("about:")) {
                return true;
              }
              // Ambiente attuale della WebView (baseUrl)
              if (req.url.startsWith("https://business-card-pro-16.emergent.host")) {
                return true;
              }
              // Altri URL: aprili nel browser esterno
              try { Linking.openURL(req.url); } catch { /* noop */ }
              return false;
            }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.center}>
                <ActivityIndicator color={GD_GREEN} size="large" />
              </View>
            )}
            style={{ flex: 1, backgroundColor: "#0F2438" }}
          />
          {saving && (
            <View style={styles.savingOverlay}>
              <ActivityIndicator color="#FFF" size="large" />
              <Text style={styles.savingTxt}>Salvataggio cartelle…</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: "#0F2438",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 10 },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center", marginTop: 8 },
  errBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  errTitle: { color: "#FFF", fontSize: 18, fontWeight: "900", marginTop: 6 },
  errMsg: { color: "rgba(255,255,255,0.8)", fontSize: 13, textAlign: "center", lineHeight: 19 },
  btn: {
    marginTop: 20, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999,
    backgroundColor: "#EA580C",
  },
  btnTxt: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject as any,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  savingTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

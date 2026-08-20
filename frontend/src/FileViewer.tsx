import React, { useMemo } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { WebView } from "react-native-webview";
import { CalculatorFAB } from "@/src/CalculatorFAB";

type Props = {
  visible: boolean;
  fileName: string;
  mime: string;
  dataBase64: string;
  onClose: () => void;
  onShare?: () => void;
};

/**
 * V38S — Universal in-app file viewer.
 *
 * PDF is rendered via a self-contained **PDF.js** page (loaded from CDN inside
 * an iframe/WebView) so it stays inside the app on Android/mobile Chrome
 * (which normally hijack `application/pdf` responses into the OS Downloads).
 * Because PDF.js runs entirely client-side, this works even without network
 * once the CDN bundle is cached.
 *
 * HTML → rendered via srcDoc (web) / html source (native).
 * Images → <img> (web) / expo Image (native).
 *
 * The Calculator FAB is embedded so the user can compute while reading the
 * PDF / analysis without leaving the viewer.
 */
export function FileViewer({ visible, fileName, mime, dataBase64, onClose, onShare }: Props) {
  const isPdf = mime.toLowerCase().includes("pdf");
  const isImg = mime.toLowerCase().startsWith("image/");
  const isHtml = mime.toLowerCase().includes("html");
  const dataUri = useMemo(() => `data:${mime};base64,${dataBase64}`, [mime, dataBase64]);

  /**
   * Build a full HTML document that embeds PDF.js and renders the given
   * base64-encoded PDF into a canvas. Works on Android WebView + mobile
   * Chrome iframe without triggering the download dialog.
   */
  const pdfJsHtml = useMemo(() => {
    if (!isPdf || !dataBase64) return "";
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes"/>
<title>${escape(fileName)}</title>
<style>
  html, body { margin:0; padding:0; background:#1a1a1a; color:#fff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; height:100%; overflow-y:auto; }
  #toolbar { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(0,0,0,0.85); backdrop-filter:blur(6px); border-bottom:1px solid #333; }
  #toolbar button { background:#374151; color:#fff; border:none; padding:6px 12px; border-radius:8px; font-size:13px; cursor:pointer; }
  #toolbar button:hover { background:#4B5563; }
  #status { flex:1; font-size:12px; color:#9CA3AF; }
  #pageBox { padding:12px; display:flex; flex-direction:column; gap:12px; align-items:center; }
  canvas { max-width:100%; height:auto; background:#fff; box-shadow:0 4px 12px rgba(0,0,0,0.5); border-radius:4px; }
  #err { padding:20px; color:#F87171; text-align:center; }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="prev">◀</button>
    <span id="status">Caricamento…</span>
    <button id="next">▶</button>
    <button id="zoomOut">−</button>
    <button id="zoomIn">+</button>
  </div>
  <div id="pageBox"></div>
  <div id="err" style="display:none"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>
    (function(){
      if (!window['pdfjsLib']) {
        document.getElementById('err').style.display='block';
        document.getElementById('err').innerText = 'Impossibile caricare il visualizzatore PDF (rete assente).';
        return;
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      var b64 = ${JSON.stringify(dataBase64)};
      // Convert base64 -> Uint8Array
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var pdf = null;
      var current = 1;
      var scale = 1.2;
      var box = document.getElementById('pageBox');
      var status = document.getElementById('status');
      function renderPage(n){
        if (!pdf) return;
        pdf.getPage(n).then(function(page){
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          var ctx = canvas.getContext('2d');
          box.innerHTML = '';
          box.appendChild(canvas);
          page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function(){
            status.innerText = 'Pagina ' + n + ' / ' + pdf.numPages;
          });
        });
      }
      pdfjsLib.getDocument({ data: bytes }).promise.then(function(_pdf){
        pdf = _pdf;
        current = 1;
        renderPage(1);
      }).catch(function(err){
        document.getElementById('err').style.display='block';
        document.getElementById('err').innerText = 'Errore lettura PDF: ' + err.message;
      });
      document.getElementById('prev').onclick = function(){ if (pdf && current>1){ current--; renderPage(current); } };
      document.getElementById('next').onclick = function(){ if (pdf && current<pdf.numPages){ current++; renderPage(current); } };
      document.getElementById('zoomIn').onclick = function(){ scale = Math.min(3, scale + 0.2); renderPage(current); };
      document.getElementById('zoomOut').onclick = function(){ scale = Math.max(0.5, scale - 0.2); renderPage(current); };
    })();
  </script>
</body>
</html>`;
  }, [isPdf, dataBase64, fileName]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} testID="fileviewer-close">
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
          {onShare ? (
            <Pressable onPress={onShare} hitSlop={8} testID="fileviewer-share">
              <Ionicons name="share-social" size={22} color="#FFF" />
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        <View style={styles.body}>
          {!dataBase64 ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#FFF" />
              <Text style={styles.loadingTxt}>Caricamento…</Text>
            </View>
          ) : Platform.OS === "web" ? (
            isImg ? (
              // @ts-expect-error web only
              <img src={dataUri} alt={fileName} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : isPdf ? (
              // @ts-expect-error web only
              <iframe srcDoc={pdfJsHtml} title={fileName} style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#1a1a1a" }} />
            ) : isHtml ? (
              // @ts-expect-error web only
              <iframe srcDoc={(globalThis as any).atob ? (globalThis as any).atob(dataBase64) : ""} title={fileName} style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#FFF" }} />
            ) : (
              <UnsupportedType />
            )
          ) : isImg ? (
            <WebView
              source={{ uri: dataUri }}
              style={{ flex: 1, backgroundColor: "#111" }}
              originWhitelist={["*"]}
              scalesPageToFit
            />
          ) : isPdf ? (
            <WebView
              source={{ html: pdfJsHtml }}
              style={{ flex: 1, backgroundColor: "#111" }}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="always"
              onError={() => {}}
            />
          ) : isHtml ? (
            <WebView
              source={{ html: (globalThis as any).atob ? (globalThis as any).atob(dataBase64) : "" }}
              style={{ flex: 1, backgroundColor: "#FFF" }}
              originWhitelist={["*"]}
              javaScriptEnabled
            />
          ) : (
            <UnsupportedType />
          )}
        </View>
        {/* V38R/S — Calculator accessible while viewing the PDF / analysis */}
        {visible ? <CalculatorFAB /> : null}
      </View>
    </Modal>
  );
}

function UnsupportedType() {
  return (
    <View style={styles.loading}>
      <Ionicons name="document-outline" size={40} color="#FFF" />
      <Text style={styles.loadingTxt}>Tipo di file non visualizzabile in-app.{"\n"}Usa «Condividi» per aprirlo altrove.</Text>
    </View>
  );
}

function escape(s: string): string {
  return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 44 : 12,
    paddingBottom: 10,
    backgroundColor: theme.color.brandPrimary,
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, marginHorizontal: 12, textAlign: "center" },
  body: { flex: 1, backgroundColor: "#111", justifyContent: "center", alignItems: "center" },
  loading: { justifyContent: "center", alignItems: "center", gap: 10 },
  loadingTxt: { color: "#FFF", fontSize: 13, textAlign: "center" },
});

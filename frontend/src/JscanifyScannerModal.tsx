import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Platform } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

/**
 * V50.z85 — Document Scanner con jscanify (via WebView, cross-platform).
 * Su web usa <iframe srcDoc>, su native usa react-native-webview.
 * L'HTML embedded carica jscanify + OpenCV.js da CDN, l'utente scatta/carica
 * una foto, jscanify auto-rileva i 4 angoli e restituisce dataURL PNG pulito.
 */

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (file: { name: string; dataUrl: string; mime: string }) => void;
};

const SCANNER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<title>Scanner documenti</title>
<style>
  html,body{margin:0;padding:0;background:#0F172A;color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;height:100%;}
  #app{display:flex;flex-direction:column;height:100%;}
  header{padding:14px 16px;font-weight:700;font-size:15px;border-bottom:1px solid #1E293B;background:#0B1220;}
  main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:12px;}
  .btn{padding:12px 18px;background:#F59E0B;color:#0F172A;border:0;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;}
  .btn.secondary{background:transparent;color:#F8FAFC;border:1px solid #334155;}
  .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
  #preview{max-width:100%;max-height:60vh;border-radius:12px;border:1px solid #334155;background:#000;}
  #status{font-size:12px;color:#94A3B8;text-align:center;min-height:16px;}
  #hint{font-size:12px;color:#94A3B8;text-align:center;max-width:320px;line-height:1.4;}
  input[type=file]{display:none;}
</style>
</head>
<body>
<div id="app">
  <header>📄 Scanner Documenti · jscanify</header>
  <main>
    <div id="hint">Scatta o carica una foto: rileveremo i bordi e correggeremo la prospettiva.</div>
    <div class="row">
      <label class="btn" for="pickCam">📷 Scatta</label>
      <label class="btn" for="pickFile">🖼️ Galleria</label>
    </div>
    <input id="pickCam" type="file" accept="image/*" capture="environment"/>
    <input id="pickFile" type="file" accept="image/*"/>
    <div id="status">Caricamento libreria…</div>
    <img id="preview" style="display:none"/>
    <div class="row" id="actionRow" style="display:none">
      <button class="btn secondary" id="btnRetake">Rifai</button>
      <button class="btn" id="btnConfirm">Usa questa</button>
    </div>
  </main>
</div>
<script async src="https://docs.opencv.org/4.9.0/opencv.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jscanify@1.2.0/dist/jscanify.min.js"></script>
<script>
  const post = (payload) => {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(JSON.stringify(payload), "*");
      }
    } catch(e){}
  };
  let scanner = null, cvReady = false, lastCleanDataUrl = null;
  const $status = document.getElementById('status');
  const $prev = document.getElementById('preview');
  const $actions = document.getElementById('actionRow');
  function tryReady(){
    if (typeof jscanify !== 'undefined' && cvReady) {
      try { scanner = new jscanify(); } catch(e){}
      $status.textContent = 'Pronto. Scegli una foto.';
    } else if (!cvReady) {
      $status.textContent = 'Attendo OpenCV…';
    } else {
      $status.textContent = 'Attendo jscanify…';
    }
  }
  function waitCv(){
    if (window.cv && typeof window.cv.Mat === 'function') { cvReady = true; tryReady(); return; }
    if (window.cv && window.cv['onRuntimeInitialized']){
      window.cv['onRuntimeInitialized'] = () => { cvReady = true; tryReady(); };
    } else setTimeout(waitCv, 200);
  }
  waitCv();
  function handleFile(file){
    if (!file) return;
    $status.textContent = scanner ? 'Analisi in corso…' : 'Motore non pronto, uso originale…';
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (scanner) {
            const w = Math.min(1200, img.width);
            const h = Math.round(w * (img.height/img.width));
            const canvas = scanner.extractPaper(img, w, h);
            lastCleanDataUrl = canvas.toDataURL('image/png');
          } else {
            lastCleanDataUrl = e.target.result;
          }
          $prev.src = lastCleanDataUrl;
          $prev.style.display = 'block';
          $actions.style.display = 'flex';
          $status.textContent = scanner ? 'Documento rilevato. Conferma per allegare.' : 'Immagine caricata (senza correzione).';
        } catch(err) {
          lastCleanDataUrl = e.target.result;
          $prev.src = lastCleanDataUrl;
          $prev.style.display = 'block';
          $actions.style.display = 'flex';
          $status.textContent = 'Rilevamento fallito, uso originale.';
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  document.getElementById('pickCam').addEventListener('change', (e) => handleFile(e.target.files[0]));
  document.getElementById('pickFile').addEventListener('change', (e) => handleFile(e.target.files[0]));
  document.getElementById('btnRetake').addEventListener('click', () => {
    lastCleanDataUrl = null;
    $prev.style.display = 'none';
    $actions.style.display = 'none';
    $status.textContent = 'Pronto. Scegli una foto.';
  });
  document.getElementById('btnConfirm').addEventListener('click', () => {
    if (!lastCleanDataUrl) return;
    post({ type: 'scanned', dataUrl: lastCleanDataUrl, name: 'scanner_' + Date.now() + '.png' });
  });
</script>
</body>
</html>`;

export function JscanifyScannerModal({ visible, onClose, onScanned }: Props) {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "scanned" && data.dataUrl) {
        onScanned({ name: data.name || `scan_${Date.now()}.png`, dataUrl: data.dataUrl, mime: "image/png" });
        onClose();
      }
    } catch { /* ignore */ }
  }, [onScanned, onClose]);

  React.useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const handler = (evt: MessageEvent) => {
      try {
        const data = typeof evt.data === "string" ? JSON.parse(evt.data) : evt.data;
        if (data && data.type === "scanned" && data.dataUrl) {
          onScanned({ name: data.name || `scan_${Date.now()}.png`, dataUrl: data.dataUrl, mime: "image/png" });
          onClose();
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [visible, onScanned, onClose]);

  const body = useMemo(() => {
    if (Platform.OS === "web") {
      return (
        <iframe
          title="Scanner documenti"
          srcDoc={SCANNER_HTML}
          style={{ width: "100%", height: "100%", border: 0, backgroundColor: "#0F172A" }}
          onLoad={() => setLoading(false)}
        />
      );
    }
    return (
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: SCANNER_HTML }}
        onMessage={onMessage}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        style={{ flex: 1, backgroundColor: "#0F172A" }}
      />
    );
  }, [onMessage]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} testID="jscan-close">
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
          <Text style={styles.title}>Scanner documenti</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1 }}>{body}</View>
        {loading ? (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator color={theme.color.brandPrimary} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F172A" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#0B1220" },
  title: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  loader: { position: "absolute", top: "40%", left: 0, right: 0, alignItems: "center" },
});

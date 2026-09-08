import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Platform } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";

/**
 * V50.z85 / V50.z86 — Document Scanner MULTI-PAGINA con jscanify (WebView cross-platform).
 * Su web usa <iframe srcDoc>, su native usa react-native-webview.
 * L'HTML embedded carica jscanify + OpenCV.js + jsPDF da CDN.
 * Flusso:
 *   1. L'utente scatta/carica una foto → jscanify auto-rileva i 4 angoli e corregge.
 *   2. Bottoni: "Aggiungi pagina" (accumula) oppure "Termina e usa" (unisce in PDF).
 *   3. Il modal ritorna al RN un file `.pdf` (o un singolo `.png` se una sola pagina).
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
  header{padding:12px 16px;font-weight:700;font-size:14px;border-bottom:1px solid #1E293B;background:#0B1220;display:flex;align-items:center;justify-content:space-between;}
  header .count{font-size:12px;color:#F59E0B;font-weight:800;padding:3px 8px;border-radius:999px;background:#1E293B;}
  main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:12px;gap:10px;overflow:auto;}
  .btn{padding:11px 16px;background:#F59E0B;color:#0F172A;border:0;border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;}
  .btn.secondary{background:transparent;color:#F8FAFC;border:1px solid #334155;}
  .btn.success{background:#16A34A;color:#FFF;}
  .btn.danger{background:transparent;color:#F87171;border:1px solid #F87171;}
  .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
  #preview{max-width:100%;max-height:38vh;border-radius:12px;border:1px solid #334155;background:#000;object-fit:contain;}
  #status{font-size:12px;color:#94A3B8;text-align:center;min-height:16px;}
  #hint{font-size:12px;color:#94A3B8;text-align:center;max-width:320px;line-height:1.4;}
  input[type=file]{display:none;}
  #thumbs{display:flex;gap:6px;overflow-x:auto;padding:4px 0;max-width:100%;width:100%;}
  .thumb{position:relative;flex:0 0 auto;width:64px;height:80px;border-radius:8px;border:2px solid #334155;overflow:hidden;background:#000;}
  .thumb img{width:100%;height:100%;object-fit:cover;}
  .thumb .del{position:absolute;top:2px;right:2px;background:rgba(220,38,38,0.9);color:#FFF;border:0;width:20px;height:20px;border-radius:50%;font-size:12px;cursor:pointer;line-height:20px;padding:0;}
  .thumb .num{position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,0.7);color:#FFF;font-size:10px;padding:1px 5px;border-radius:6px;font-weight:800;}
</style>
</head>
<body>
<div id="app">
  <header>
    <div>📄 Scanner Documenti · <span id="mode">jscanify</span></div>
    <div class="count" id="pageCount">0 pagine</div>
  </header>
  <main>
    <div id="hint">Scatta/carica una pagina alla volta. Puoi aggiungere altre pagine prima di finire.</div>
    <div class="row" id="pickRow">
      <label class="btn" for="pickCam">📷 Scatta</label>
      <label class="btn" for="pickFile">🖼️ Galleria</label>
    </div>
    <input id="pickCam" type="file" accept="image/*" capture="environment"/>
    <input id="pickFile" type="file" accept="image/*"/>
    <div id="status">Caricamento libreria…</div>
    <img id="preview" style="display:none"/>
    <div class="row" id="actionRow" style="display:none">
      <button class="btn secondary" id="btnRetake">Rifai</button>
      <button class="btn" id="btnAdd">+ Aggiungi pagina</button>
      <button class="btn success" id="btnDone">✓ Termina e usa</button>
    </div>
    <div id="thumbs"></div>
    <div class="row" id="bottomRow" style="display:none">
      <button class="btn danger" id="btnCancel">Annulla tutto</button>
    </div>
  </main>
</div>
<script async src="https://docs.opencv.org/4.9.0/opencv.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jscanify@1.2.0/dist/jscanify.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
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
  let scanner = null, cvReady = false;
  const pages = []; // { dataUrl, w, h }
  let currentClean = null;
  const $status = document.getElementById('status');
  const $prev = document.getElementById('preview');
  const $actions = document.getElementById('actionRow');
  const $thumbs = document.getElementById('thumbs');
  const $bottomRow = document.getElementById('bottomRow');
  const $count = document.getElementById('pageCount');
  const $mode = document.getElementById('mode');
  function updateCount(){
    $count.textContent = pages.length + (pages.length === 1 ? ' pagina' : ' pagine');
    $bottomRow.style.display = pages.length > 0 ? 'flex' : 'none';
  }
  function tryReady(){
    if (typeof jscanify !== 'undefined' && cvReady) {
      try { scanner = new jscanify(); } catch(e){}
      $mode.textContent = 'jscanify pronto';
      $status.textContent = 'Pronto. Scegli una pagina.';
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
  function renderThumbs(){
    $thumbs.innerHTML = '';
    pages.forEach((p, idx) => {
      const div = document.createElement('div');
      div.className = 'thumb';
      const img = document.createElement('img'); img.src = p.dataUrl;
      const del = document.createElement('button'); del.textContent = '×'; del.className = 'del';
      del.onclick = (ev) => { ev.stopPropagation(); pages.splice(idx, 1); renderThumbs(); updateCount(); };
      const num = document.createElement('div'); num.className = 'num'; num.textContent = String(idx + 1);
      div.appendChild(img); div.appendChild(del); div.appendChild(num);
      $thumbs.appendChild(div);
    });
  }
  function handleFile(file){
    if (!file) return;
    $status.textContent = scanner ? 'Analisi in corso…' : 'Motore non pronto, uso originale…';
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let dataUrl, w = img.width, h = img.height;
          if (scanner) {
            const dw = Math.min(1200, img.width);
            const dh = Math.round(dw * (img.height/img.width));
            const canvas = scanner.extractPaper(img, dw, dh);
            dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            w = dw; h = dh;
          } else {
            dataUrl = e.target.result;
          }
          currentClean = { dataUrl, w, h };
          $prev.src = dataUrl;
          $prev.style.display = 'block';
          $actions.style.display = 'flex';
          $status.textContent = scanner ? 'Anteprima pagina · scegli l\\'azione.' : 'Immagine caricata (senza correzione).';
        } catch(err) {
          currentClean = { dataUrl: e.target.result, w: img.width, h: img.height };
          $prev.src = currentClean.dataUrl;
          $prev.style.display = 'block';
          $actions.style.display = 'flex';
          $status.textContent = 'Rilevamento fallito, uso originale.';
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  function resetPreview(){
    currentClean = null;
    $prev.style.display = 'none';
    $actions.style.display = 'none';
    // Reset input value in modo da poter riscegliere lo stesso file
    document.getElementById('pickCam').value = '';
    document.getElementById('pickFile').value = '';
    $status.textContent = pages.length > 0 ? ('Pagina ' + (pages.length + 1) + ': scegli una foto o termina.') : 'Pronto. Scegli una pagina.';
  }
  document.getElementById('pickCam').addEventListener('change', (e) => handleFile(e.target.files[0]));
  document.getElementById('pickFile').addEventListener('change', (e) => handleFile(e.target.files[0]));
  document.getElementById('btnRetake').addEventListener('click', () => resetPreview());
  document.getElementById('btnAdd').addEventListener('click', () => {
    if (!currentClean) return;
    pages.push(currentClean);
    renderThumbs();
    updateCount();
    resetPreview();
  });
  document.getElementById('btnCancel').addEventListener('click', () => {
    pages.length = 0;
    renderThumbs(); updateCount(); resetPreview();
  });
  document.getElementById('btnDone').addEventListener('click', async () => {
    // Se c'è una pagina pending, includila
    const list = pages.slice();
    if (currentClean) list.push(currentClean);
    if (list.length === 0) return;
    // Se una sola pagina → invia PNG diretto (retro-compat con singola immagine)
    if (list.length === 1) {
      // Convertiamo la JPEG in PNG per uniformità: non necessario, la data URL è già valida.
      post({ type: 'scanned', dataUrl: list[0].dataUrl, name: 'scanner_' + Date.now() + '.jpg', mime: 'image/jpeg' });
      return;
    }
    // Multi-pagina → genera PDF con jsPDF
    try {
      $status.textContent = 'Genero PDF…';
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) throw new Error('jsPDF non disponibile');
      // A4 in mm: 210 x 297. Adattiamo ogni pagina al foglio mantenendo aspect.
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const A4W = 210, A4H = 297, margin = 8;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (i > 0) pdf.addPage();
        const availW = A4W - margin * 2, availH = A4H - margin * 2;
        const ratio = Math.min(availW / p.w, availH / p.h);
        const w = p.w * ratio, h = p.h * ratio;
        const x = (A4W - w) / 2, y = (A4H - h) / 2;
        pdf.addImage(p.dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
      }
      const dataUrl = pdf.output('datauristring'); // "data:application/pdf;filename=..;base64,..."
      // Normalizziamo il MIME
      const idx = dataUrl.indexOf(',');
      const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
      const cleanUrl = 'data:application/pdf;base64,' + base64;
      post({ type: 'scanned', dataUrl: cleanUrl, name: 'scan_' + list.length + 'pagine_' + Date.now() + '.pdf', mime: 'application/pdf' });
    } catch (err) {
      $status.textContent = 'Errore generazione PDF: ' + (err && err.message ? err.message : err);
    }
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
        onScanned({ name: data.name || `scan_${Date.now()}.png`, dataUrl: data.dataUrl, mime: data.mime || "image/png" });
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
          onScanned({ name: data.name || `scan_${Date.now()}.png`, dataUrl: data.dataUrl, mime: data.mime || "image/png" });
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

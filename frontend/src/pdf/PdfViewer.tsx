// PdfViewer.tsx — V50.z400 — VISUALIZZATORE PDF INTERNO unico (Corporate Gym: manuali Drive, materiali area, ogni sezione).
// Nessun PDF esce dall'app: pdf.js dentro una WebView nativa (Android non sa renderizzare i PDF da solo → prima dava net::ERR_FAILED).
// Il PDF viene scaricato dalla pagina HTML (fetch con eventuale Authorization) e renderizzato pagina per pagina, con pinch-zoom e
// apertura diretta alla pagina richiesta (`page`, es. Obiezioni → 13). Header nativo: chiudi · titolo · pagina x/y · scarica.
import React, { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HT } from "@/src/homeTheme";

export type PdfViewerProps = { url: string; name: string; page?: number; authToken?: string | null; onClose: () => void; onDownload?: () => void | Promise<void>; downloading?: boolean };

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

function buildHtml(url: string, page: number, token: string | null, bg: string): string {
  const headers = token ? `{ "Authorization": "Bearer ${token}" }` : "{}";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<style>
  html,body{margin:0;padding:0;background:${bg};}
  #pages{padding:6px 0 24px;}
  .pg{position:relative;margin:0 auto 8px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);}
  .pg canvas{display:block;width:100%;height:100%;}
  .num{position:absolute;right:6px;bottom:4px;font:11px -apple-system,Roboto,sans-serif;color:#64748B;background:rgba(255,255,255,.85);padding:1px 6px;border-radius:8px;}
  #msg{color:#CBD5E1;font:15px -apple-system,Roboto,sans-serif;text-align:center;padding:40px 24px;}
</style></head><body><div id="msg">Caricamento del documento…</div><div id="pages"></div>
<script src="${PDFJS}/pdf.min.js"></script>
<script>
(function(){
  var RN = window.ReactNativeWebView; function send(o){ try{ RN && RN.postMessage(JSON.stringify(o)); }catch(e){} }
  function fail(m){ document.getElementById('msg').textContent = m; send({type:'error', message:m}); }
  if(!window.pdfjsLib){ fail('Visualizzatore non disponibile: controlla la connessione e riprova.'); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
  var startPage = ${page}, pdf = null, rendered = {}, pending = {}, scaleBase = 1, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  var W = function(){ return Math.max(320, document.documentElement.clientWidth - 12); };
  function b64ToBytes(b){ var s = atob(b), a = new Uint8Array(s.length); for (var i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a; }
  fetch(${JSON.stringify(url)}, { headers: ${headers} }).then(function(r){
    if(!r.ok) throw new Error('HTTP ' + r.status);
    var ct = (r.headers.get('content-type') || '');
    return ct.indexOf('json') >= 0 ? r.json().then(function(j){ return b64ToBytes(j.data_base64 || ''); }) : r.arrayBuffer().then(function(ab){ return new Uint8Array(ab); });
  }).then(function(data){ return pdfjsLib.getDocument({ data: data, cMapUrl: '${PDFJS}/cmaps/', cMapPacked: true }).promise; })
  .then(function(doc){
    pdf = doc; document.getElementById('msg').style.display = 'none';
    return pdf.getPage(1).then(function(p1){
      var vp = p1.getViewport({ scale: 1 }); scaleBase = W() / vp.width;
      var cont = document.getElementById('pages');
      for (var i = 1; i <= pdf.numPages; i++) {
        var d = document.createElement('div'); d.className = 'pg'; d.id = 'p' + i; d.dataset.n = i;
        d.style.width = Math.floor(vp.width * scaleBase) + 'px'; d.style.height = Math.floor(vp.height * scaleBase) + 'px';
        var n = document.createElement('span'); n.className = 'num'; n.textContent = i; d.appendChild(n); cont.appendChild(d);
      }
      send({ type: 'loaded', pages: pdf.numPages });
      var io = new IntersectionObserver(function(entries){ entries.forEach(function(e){ if (e.isIntersecting) render(parseInt(e.target.dataset.n)); }); }, { rootMargin: '600px 0px' });
      Array.prototype.forEach.call(cont.children, function(c){ io.observe(c); });
      var target = Math.min(Math.max(1, startPage), pdf.numPages);
      if (target > 1) setTimeout(function(){ var el = document.getElementById('p' + target); if (el) window.scrollTo(0, el.offsetTop - 4); }, 50);
      var t; window.addEventListener('scroll', function(){ clearTimeout(t); t = setTimeout(current, 120); }, { passive: true });
      current();
    });
  }).catch(function(e){ fail('Impossibile aprire il PDF: ' + (e && e.message ? e.message : e)); });
  function render(n){
    if (!pdf || rendered[n] || pending[n]) return; pending[n] = true;
    pdf.getPage(n).then(function(p){
      var box = document.getElementById('p' + n); var vp = p.getViewport({ scale: scaleBase });
      box.style.width = Math.floor(vp.width) + 'px'; box.style.height = Math.floor(vp.height) + 'px';
      var c = document.createElement('canvas'); c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      var ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
      return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function(){ box.insertBefore(c, box.firstChild); rendered[n] = true; pending[n] = false; });
    }).catch(function(){ pending[n] = false; });
  }
  function current(){
    var mid = window.scrollY + window.innerHeight / 2, best = 1, bd = 1e12;
    var kids = document.getElementById('pages').children;
    for (var i = 0; i < kids.length; i++) { var k = kids[i], c = k.offsetTop + k.offsetHeight / 2, d = Math.abs(c - mid); if (d < bd) { bd = d; best = i + 1; } }
    send({ type: 'page', page: best });
  }
})();
</script></body></html>`;
}

export function PdfViewer({ url, name, page = 1, authToken, onClose, onDownload, downloading }: PdfViewerProps) {
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<number | null>(null);
  const [cur, setCur] = useState(page);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const ref = useRef<WebView>(null);
  const html = useMemo(() => buildHtml(url, page, authToken || null, "#1E293B"), [url, page, authToken]);

  const onMessage = (e: any) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === "loaded") { setPages(m.pages); setError(null); }
      else if (m.type === "page") setCur(m.page);
      else if (m.type === "error") setError(m.message || "Errore");
    } catch { /* ignore */ }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="pdf-viewer">
      <View style={styles.head}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn} testID="pdf-viewer-close"><Ionicons name="close" size={24} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{name}</Text>
          <Text style={styles.sub} testID="pdf-viewer-pages">{pages ? `Pagina ${cur} di ${pages}` : error ? "Errore" : "Caricamento…"}</Text>
        </View>
        {onDownload ? (
          <Pressable onPress={onDownload} hitSlop={10} disabled={!!downloading} style={styles.iconBtn} testID="pdf-viewer-download">
            {downloading ? <ActivityIndicator color="#FFF" /> : <Ionicons name="download-outline" size={22} color="#FFF" />}
          </Pressable>
        ) : null}
      </View>
      {Platform.OS === "web" ? (
        <View style={styles.center}><Text style={styles.msg}>Anteprima disponibile nell&apos;app. Usa il pulsante Scarica.</Text></View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView
            key={reloadKey}
            ref={ref}
            originWhitelist={["*"]}
            source={{ html, baseUrl: "https://pdf.advisoros.local/" }}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            allowsInlineMediaPlayback
            setSupportMultipleWindows={false}
            scalesPageToFit={false}
            style={{ flex: 1, backgroundColor: "#1E293B" }}
            onError={() => setError("Visualizzatore non disponibile")}
            onShouldStartLoadWithRequest={(req) => req.url.startsWith("https://pdf.advisoros.local") || req.url === "about:blank" || req.url.startsWith("data:")}
          />
          {!pages && !error ? <View style={styles.overlay} pointerEvents="none"><ActivityIndicator color="#FFF" size="large" /></View> : null}
          {error ? (
            <View style={styles.overlay} testID="pdf-viewer-error">
              <Ionicons name="alert-circle-outline" size={40} color="#F87171" />
              <Text style={styles.msg}>{error}</Text>
              <Pressable onPress={() => { setError(null); setReloadKey((k) => k + 1); }} style={styles.retry} testID="pdf-viewer-retry"><Text style={styles.retryTxt}>Riprova</Text></Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F172A" },
  head: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "#0F172A" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontWeight: "800", fontSize: 15 }, sub: { color: "#94A3B8", fontSize: 11.5, marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 12, padding: 24, backgroundColor: "rgba(15,23,42,0.85)" },
  msg: { color: "#E2E8F0", fontSize: 14, textAlign: "center", lineHeight: 20 },
  retry: { backgroundColor: HT.violet, borderRadius: 12, paddingHorizontal: 18, minHeight: 44, alignItems: "center", justifyContent: "center" },
  retryTxt: { color: "#FFF", fontWeight: "800" },
});

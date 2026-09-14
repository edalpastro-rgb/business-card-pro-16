// LeafletMap.tsx — V50.z240 — Mappa Leaflet + OpenStreetMap dentro WebView (nativo) / iframe (web). Nessuna API key.
// Props: markers (lat/lon/color/label/popup html), center, onAction({action, id}) dai bottoni del popup.
// V50.z241 (Fase 2): `cluster` (Leaflet.markercluster quando i marker sono > 25) e `route` (polilinea + tappe numerate
// per il Giro Ottimale: origin → tappe → eventuale ritorno).
import React, { useEffect, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";

export type MapMarker = { id: string; lat: number; lon: number; color: string; title: string; sub?: string; actions?: { id: string; label: string }[] };
export type MapAction = { action: string; id: string };
export type MapRoute = { origin: { lat: number; lon: number; label?: string }; stops: { lat: number; lon: number; label?: string }[]; returnToOrigin?: boolean };

const CLUSTER_MIN = 25;

function buildHtml(markers: MapMarker[], center: [number, number], zoom: number, office?: { lat: number; lon: number } | null, me?: { lat: number; lon: number } | null, cluster?: boolean, route?: MapRoute | null) {
  const useCluster = !!cluster && markers.length > CLUSTER_MIN;
  const data = JSON.stringify({ markers, center, zoom, office, me, cluster: useCluster, route: route || null }).replace(/</g, "\\u003c");
  const clusterAssets = useCluster
    ? `<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/><link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/><script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>${clusterAssets}
<style>html,body,#m{margin:0;height:100%;width:100%;font-family:-apple-system,Roboto,Arial}.pin{width:18px;height:18px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.pop b{font-size:14px;color:#1B2B4B}.pop .s{font-size:12px;color:#475569;margin:2px 0 8px}.pop .a{display:flex;flex-wrap:wrap;gap:6px}.pop button{border:0;border-radius:999px;background:#EEF2FF;color:#3730A3;font-weight:700;font-size:12px;padding:6px 10px}
.pop button.p{background:#FF6B35;color:#fff}.me{width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)}.off{font-size:18px}
.seq{width:26px;height:26px;border-radius:50%;background:#FF6B35;color:#fff;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.seq.o{background:#1B2B4B;font-size:14px}
.marker-cluster-small,.marker-cluster-medium,.marker-cluster-large{background:rgba(27,43,75,.35)}.marker-cluster-small div,.marker-cluster-medium div,.marker-cluster-large div{background:#1B2B4B;color:#fff;font-weight:800}</style></head><body><div id="m"></div>
<script>
var D=${data};var map=L.map('m',{zoomControl:true}).setView(D.center,D.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
function send(o){var s=JSON.stringify(o);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else if(window.parent){window.parent.postMessage(s,'*')}}
window.act=function(a,id){send({action:a,id:id})};
var g=(D.cluster&&L.markerClusterGroup)?L.markerClusterGroup({maxClusterRadius:50,showCoverageOnHover:false}):L.featureGroup();
D.markers.forEach(function(k){var ic=L.divIcon({className:'',html:'<div class="pin" style="background:'+k.color+'"></div>',iconSize:[18,18],iconAnchor:[9,9]});
var btns=(k.actions||[]).map(function(a){return '<button class="'+(a.id==='giro'?'p':'')+'" onclick="act(\\''+a.id+'\\',\\''+k.id+'\\')">'+a.label+'</button>'}).join('');
L.marker([k.lat,k.lon],{icon:ic}).bindPopup('<div class="pop"><b>'+k.title+'</b><div class="s">'+(k.sub||'')+'</div><div class="a">'+btns+'</div></div>',{maxWidth:260}).addTo(g)});
g.addTo(map);
if(D.office){L.marker([D.office.lat,D.office.lon],{icon:L.divIcon({className:'',html:'<div class="off">🏢</div>',iconSize:[22,22],iconAnchor:[11,11]})}).bindPopup('<b>Ufficio</b>').addTo(map)}
var meM=null;function setMe(p){if(!p)return;if(meM){meM.setLatLng([p.lat,p.lon])}else{meM=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).bindPopup('<b>Tu sei qui</b>').addTo(map)}}
setMe(D.me);
var bounds=null;
if(D.route&&D.route.stops&&D.route.stops.length){var R=D.route;var pts=[[R.origin.lat,R.origin.lon]];
L.marker([R.origin.lat,R.origin.lon],{icon:L.divIcon({className:'',html:'<div class="seq o">🏁</div>',iconSize:[26,26],iconAnchor:[13,13]}),zIndexOffset:1000}).bindPopup('<b>Partenza</b><br/>'+(R.origin.label||'')).addTo(map);
R.stops.forEach(function(s,i){pts.push([s.lat,s.lon]);L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',html:'<div class="seq">'+(i+1)+'</div>',iconSize:[26,26],iconAnchor:[13,13]}),zIndexOffset:900}).bindPopup('<b>'+(i+1)+'. '+(s.label||'')+'</b>').addTo(map)});
if(R.returnToOrigin){pts.push([R.origin.lat,R.origin.lon])}
var line=L.polyline(pts,{color:'#FF6B35',weight:4,opacity:.9,dashArray:'8 6'}).addTo(map);bounds=line.getBounds()}
else if(D.markers.length>1){try{bounds=g.getBounds()}catch(e){}}
else if(D.markers.length===1){map.setView([D.markers[0].lat,D.markers[0].lon],12)}
if(bounds){try{map.fitBounds(bounds.pad(0.15))}catch(e){}}
function onMsg(m){if(m&&m.cmd==='center'){map.setView([m.lat,m.lon],m.zoom||13)}if(m&&m.cmd==='me'){setMe(m)}}
window.addEventListener('message',function(e){try{onMsg(typeof e.data==='string'?JSON.parse(e.data):e.data)}catch(x){}});
document.addEventListener('message',function(e){try{onMsg(JSON.parse(e.data))}catch(x){}});
</script></body></html>`;
}

export const LeafletMap = React.forwardRef<{ center: (lat: number, lon: number, zoom?: number) => void; setMe: (lat: number, lon: number) => void }, {
  markers: MapMarker[]; center: [number, number]; zoom?: number; office?: { lat: number; lon: number } | null; me?: { lat: number; lon: number } | null;
  onAction?: (a: MapAction) => void; testID?: string; cluster?: boolean; route?: MapRoute | null;
}>(function LeafletMap({ markers, center, zoom = 10, office, me, onAction, testID, cluster, route }, ref) {
  const html = useMemo(() => buildHtml(markers, center, zoom, office, me, cluster, route), [markers, center, zoom, office, me, cluster, route]);
  const webRef = useRef<any>(null);
  const iframeRef = useRef<any>(null);
  const post = (msg: object) => {
    const s = JSON.stringify(msg);
    if (Platform.OS === "web") iframeRef.current?.contentWindow?.postMessage(s, "*");
    else webRef.current?.postMessage(s);
  };
  React.useImperativeHandle(ref, () => ({ center: (lat, lon, z) => post({ cmd: "center", lat, lon, zoom: z || 13 }), setMe: (lat, lon) => post({ cmd: "me", lat, lon }) }), []);
  useEffect(() => {
    if (Platform.OS !== "web" || !onAction) return;
    const h = (e: MessageEvent) => { try { const m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; if (m && m.action && m.id) onAction(m); } catch {} };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [onAction]);
  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1 }} testID={testID}>
        <iframe ref={iframeRef} srcDoc={html} title="Mappa clienti" style={{ width: "100%", height: "100%", border: "none" }} />
      </View>
    );
  }
  return (
    <WebView ref={webRef} source={{ html, baseUrl: "https://tile.openstreetmap.org" }} originWhitelist={["*"]} style={{ flex: 1 }} testID={testID}
      javaScriptEnabled domStorageEnabled mixedContentMode="always"
      onMessage={(e) => { try { const m = JSON.parse(e.nativeEvent.data); if (m && m.action && m.id) onAction?.(m); } catch {} }} />
  );
});

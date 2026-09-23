// map-clients.tsx — V50.z240 — FEAT-GEO-001 Modulo A (Fase 1): Mappa Clienti. V50.z241 Fase 2: filtri area/città + clustering.
// Tab Mia/Team (Team solo Master), filtro stato, marker colorati (Team: colore per consulente), popup con azioni
// Scheda/Chiama/Naviga/WhatsApp/Aggiungi a Giro, centra su GPS (expo-location, ogni 30 s a schermo aperto) o ufficio.
// Selezione «Giro» persistita in AsyncStorage (`geo_giro_ids_v1`) e consumata da /optimal-route.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useNavChooser, joinAddr } from "@/src/NavChooser";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { LeafletMap, MapMarker } from "@/src/LeafletMap";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export const GIRO_KEY = "geo_giro_ids_v1";
type GeoContact = { contact_id: string; name: string; company: string; status: string; phone: string; address: string; city: string; area: string; lat: number | null; lon: number | null; owner_id?: string; owner_name?: string };
type Resp = { items: GeoContact[]; located: number; without_address: number; pending_geocode: number; team_allowed: boolean; members: Record<string, string>; office: { lat: number; lon: number; address: string } | null };

const STATUS_COLOR: Record<string, string> = { client: "#0066FF", prospect: "#00A651", inactive: "#F5B800", collaborator: "#7C3AED" };
const STATUS_LABEL: Record<string, string> = { all: "Tutti", client: "Clienti", prospect: "Prospect", inactive: "Inattivi", collaborator: "Collaboratori" };
const AREA_LABEL: Record<string, string> = { energy: "Energia", network: "Network" };
const TEAM_PALETTE = ["#2563EB", "#F97316", "#16A34A", "#DB2777", "#7C3AED", "#0891B2", "#CA8A04", "#DC2626"];
const DEFAULT_CENTER: [number, number] = [45.79, 11.91]; // Asolo (TV)

export default function MapClientsScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const navPad = usePageBottomPadding(8); // V50.z240 — sopra la bottom nav persistente
  const mapRef = useRef<any>(null);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [giro, setGiro] = useState<string[]>([]);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);

  useEffect(() => { AsyncStorage.getItem(GIRO_KEY).then((v) => { if (v) try { setGiro(JSON.parse(v)); } catch {} }); AsyncStorage.getItem("geo_map_scope_v1").then((v) => { if (v === "team") setScope("team"); }); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Resp>(`/geo/contacts-map?scope=${scope}`)); } catch (e: any) { notify("Mappa", e?.message || "Errore"); } finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { void load(); void AsyncStorage.setItem("geo_map_scope_v1", scope); }, [load, scope]);
  // se il backend ha ancora geocoding in coda, ricarica dopo 4 s
  useEffect(() => { if (data?.pending_geocode) { const t = setTimeout(() => void load(), 4000); return () => clearTimeout(t); } }, [data?.pending_geocode, load]);

  // GPS: chiedi solo al tap su 🎯; poi aggiorna ogni 30 s finché la schermata è aperta
  const gpsTimer = useRef<any>(null);
  const readGps = useCallback(async (silent = false) => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      let granted = perm.granted;
      if (!granted && !silent) {
        if (!perm.canAskAgain) { setGpsDenied(true); notify("Posizione disattivata", "Abilita la posizione nelle impostazioni del telefono per centrare la mappa su di te.", [{ text: "Apri impostazioni", onPress: () => Linking.openSettings() }, { text: "Ok" }]); return; }
        granted = (await Location.requestForegroundPermissionsAsync()).granted;
      }
      if (!granted) { setGpsDenied(true); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      setMe(pos); mapRef.current?.setMe(pos.lat, pos.lon);
      if (!silent) mapRef.current?.center(pos.lat, pos.lon, 12);
      if (!gpsTimer.current) gpsTimer.current = setInterval(() => void readGps(true), 30000);
    } catch (e: any) { if (!silent) notify("GPS", e?.message || "Posizione non disponibile"); }
  }, []);
  useEffect(() => () => { if (gpsTimer.current) clearInterval(gpsTimer.current); }, []);

  const ownerColors = useMemo(() => { const ids = Object.keys(data?.members || {}); const m: Record<string, string> = {}; ids.forEach((id, i) => { m[id] = TEAM_PALETTE[i % TEAM_PALETTE.length]; }); return m; }, [data?.members]);
  // V50.z241 (Fase 2) — filtri città / area (chips calcolate dai contatti caricati)
  const [city, setCity] = useState("all");
  const [area, setArea] = useState("all");
  const cities = useMemo(() => { const c: Record<string, number> = {}; (data?.items || []).forEach((i) => { const k = (i.city || "").trim(); if (k) c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 15); }, [data]);
  const areas = useMemo(() => { const c: Record<string, number> = {}; (data?.items || []).forEach((i) => { if (i.area) c[i.area] = (c[i.area] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); }, [data]);
  const visible = useMemo(() => (data?.items || []).filter((c) => c.lat != null && (status === "all" || c.status === status) && (city === "all" || (c.city || "").trim() === city) && (area === "all" || c.area === area)), [data, status, city, area]);
  const markers: MapMarker[] = useMemo(() => visible.map((c) => ({
    id: c.contact_id, lat: c.lat as number, lon: c.lon as number,
    color: scope === "team" ? (ownerColors[c.owner_id || ""] || HT.muted) : (STATUS_COLOR[c.status] || HT.muted),
    title: c.name + (c.company ? ` · ${c.company}` : ""),
    sub: `📍 ${c.address || c.city}${c.status ? ` · ${STATUS_LABEL[c.status] || c.status}` : ""}${c.phone ? `<br/>📞 ${c.phone}` : ""}${scope === "team" && c.owner_name ? `<br/>👤 ${c.owner_name}` : ""}`,
    actions: [{ id: "scheda", label: "Scheda" }, ...(c.phone ? [{ id: "call", label: "Chiama" }, { id: "wa", label: "WhatsApp" }] : []), { id: "nav", label: "Naviga" }, { id: "giro", label: giro.includes(c.contact_id) ? "✓ Nel giro" : "Aggiungi a Giro" }],
  })), [visible, scope, ownerColors, giro]);

  const navChooser = useNavChooser(); // V50.z253 — popup Google Maps / Waze / Apple Maps
  const onAction = useCallback(async ({ action, id }: { action: string; id: string }) => {
    const c = (data?.items || []).find((x) => x.contact_id === id); if (!c) return;
    if (action === "scheda") router.push(`/contact/${id}` as any);
    else if (action === "call") Linking.openURL(`tel:${c.phone.replace(/\s+/g, "")}`);
    else if (action === "wa") Linking.openURL(`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`);
    else if (action === "nav") navChooser.open({ lat: c.lat, lon: c.lon, label: c.name, address: joinAddr(c.address, c.city) });
    else if (action === "giro") {
      setGiro((prev) => { const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 10 ? (notify("Giro pieno", "Massimo 10 clienti per giro"), prev) : [...prev, id]; void AsyncStorage.setItem(GIRO_KEY, JSON.stringify(next)); return next; });
    }
  }, [data, router, navChooser]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; (data?.items || []).forEach((i) => { c[i.status] = (c[i.status] || 0) + 1; }); return c; }, [data]);
  const center: [number, number] = data?.office ? [data.office.lat, data.office.lon] : DEFAULT_CENTER;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {navChooser.element}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="map-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Mappa Clienti</Text><Text style={styles.sub}>{data ? `${visible.length} sulla mappa · ${data.without_address} senza indirizzo${data.pending_geocode ? ` · ${data.pending_geocode} in geocodifica…` : ""}` : "Caricamento…"}</Text></View>
        <View style={styles.tabs}>
          <Pressable onPress={() => setScope("mine")} style={[styles.tab, scope === "mine" && styles.tabOn]} testID="map-tab-mine"><Text style={[styles.tabTxt, scope === "mine" && styles.tabTxtOn]}>Mia</Text></Pressable>
          <Pressable onPress={() => data?.team_allowed && setScope("team")} disabled={!data?.team_allowed} style={[styles.tab, scope === "team" && styles.tabOn, !data?.team_allowed && { opacity: 0.4 }]} testID="map-tab-team"><Text style={[styles.tabTxt, scope === "team" && styles.tabTxtOn]}>Team</Text></Pressable>
        </View>
      </View>
      <View style={styles.filters}>
        {["all", "client", "prospect", "inactive"].map((s) => (
          <Pressable key={s} onPress={() => setStatus(s)} style={[styles.chip, status === s && styles.chipOn]} testID={`map-filter-${s}`}>
            {s !== "all" ? <View style={[styles.dot, { backgroundColor: STATUS_COLOR[s] }]} /> : null}
            <Text style={[styles.chipTxt, status === s && { color: "#FFF" }]}>{STATUS_LABEL[s]}{s !== "all" && counts[s] ? ` ${counts[s]}` : ""}</Text>
          </Pressable>
        ))}
      </View>
      {/* V50.z241 — filtri area + città */}
      {areas.length > 1 || cities.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters2} contentContainerStyle={{ gap: 6, paddingHorizontal: 10, alignItems: "center" }} testID="map-filters-geo">
          {city !== "all" || area !== "all" ? (
            <Pressable onPress={() => { setCity("all"); setArea("all"); }} style={[styles.chip, { backgroundColor: HT.dangerTint }]} testID="map-filter-reset"><Ionicons name="close" size={12} color="#DC2626" /><Text style={[styles.chipTxt, { color: "#DC2626" }]}>Reset</Text></Pressable>
          ) : null}
          {areas.length > 1 ? areas.map(([a, n]) => (
            <Pressable key={`a-${a}`} onPress={() => setArea(area === a ? "all" : a)} style={[styles.chip, area === a && styles.chipOn2]} testID={`map-area-${a}`}>
              <Ionicons name="pricetag" size={11} color={area === a ? "#FFF" : "#7C3AED"} /><Text style={[styles.chipTxt, area === a && { color: "#FFF" }]}>{AREA_LABEL[a] || a} {n}</Text>
            </Pressable>
          )) : null}
          {areas.length > 1 && cities.length > 1 ? <View style={styles.vsep} /> : null}
          {cities.length > 1 ? cities.map(([c, n]) => (
            <Pressable key={`c-${c}`} onPress={() => setCity(city === c ? "all" : c)} style={[styles.chip, city === c && styles.chipOn2]} testID={`map-city-${c}`}>
              <Ionicons name="location" size={11} color={city === c ? "#FFF" : "#0EA5E9"} /><Text style={[styles.chipTxt, city === c && { color: "#FFF" }]}>{c} {n}</Text>
            </Pressable>
          )) : null}
        </ScrollView>
      ) : null}
      <View style={{ flex: 1 }}>
        {loading && !data ? <ActivityIndicator color="#FF6B35" style={{ marginTop: 40 }} /> : (
          <LeafletMap ref={mapRef} markers={markers} center={center} zoom={10} office={data?.office} me={me} onAction={onAction} cluster testID="map-leaflet" />
        )}
        <View style={styles.ctrls}>
          <Pressable onPress={() => void readGps(false)} style={styles.ctrl} testID="map-center-me" accessibilityLabel="Centra sulla mia posizione"><Ionicons name="locate" size={20} color={gpsDenied ? HT.muted : HT.text} /></Pressable>
          {data?.office ? <Pressable onPress={() => mapRef.current?.center(data.office!.lat, data.office!.lon, 12)} style={styles.ctrl} testID="map-center-office"><Ionicons name="business" size={20} color={HT.text} /></Pressable> : null}
          <Pressable onPress={() => void load()} style={styles.ctrl} testID="map-reload"><Ionicons name="refresh" size={20} color={HT.text} /></Pressable>
        </View>
        {scope === "team" && data ? (
          <View style={styles.legend}>{Object.entries(data.members).map(([id, name]) => <View key={id} style={styles.legendRow}><View style={[styles.dot, { backgroundColor: ownerColors[id] }]} /><Text style={styles.legendTxt} numberOfLines={1}>{name}</Text></View>)}</View>
        ) : null}
      </View>
      <View style={[styles.footer, { paddingBottom: navPad - 40 }]}>
        <Text style={styles.footTxt}>{giro.length ? `${giro.length}/10 nel giro` : "Tocca un cliente → «Aggiungi a Giro»"}</Text>
        {giro.length ? <Pressable onPress={() => { setGiro([]); void AsyncStorage.removeItem(GIRO_KEY); }} hitSlop={8} testID="map-giro-clear"><Text style={styles.clear}>Svuota</Text></Pressable> : null}
        <Pressable onPress={() => router.push("/optimal-route" as any)} style={[styles.cta, !giro.length && { opacity: 0.6 }]} testID="map-goto-route">
          <Ionicons name="car-sport" size={18} color="#FFF" /><Text style={styles.ctaTxt}>{giro.length ? `Calcola giro (${giro.length})` : "Giro ottimale"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#1B2B4B' },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 }, sub: { color: "#CBD5E1", fontSize: 11 },
  tabs: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999, padding: 3 },
  tab: { paddingHorizontal: 12, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 999 }, tabOn: { backgroundColor: '#FF6B35' },
  tabTxt: { color: "#CBD5E1", fontWeight: "800", fontSize: 12 }, tabTxtOn: { color: "#FFF" },
  filters: { flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: HT.card, borderBottomWidth: 1, borderBottomColor: HT.border, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, minHeight: 32, borderRadius: 999, backgroundColor: HT.card2 }, chipOn: { backgroundColor: '#1B2B4B' },
  chipTxt: { fontSize: 12, fontWeight: "700", color: HT.text }, dot: { width: 10, height: 10, borderRadius: 5 },
  filters2: { maxHeight: 44, backgroundColor: HT.card, borderBottomWidth: 1, borderBottomColor: HT.border, paddingVertical: 6, flexGrow: 0 }, chipOn2: { backgroundColor: '#0EA5E9' },
  vsep: { width: 1, height: 22, backgroundColor: HT.border, marginHorizontal: 2 },
  ctrls: { position: "absolute", top: 10, right: 10, gap: 8 },
  ctrl: { width: 44, height: 44, borderRadius: 12, backgroundColor: HT.card, alignItems: "center", justifyContent: "center", ...(Platform.OS === "web" ? { boxShadow: "0 1px 4px rgba(0,0,0,0.25)" } as any : { elevation: 3 }) },
  legend: { position: "absolute", left: 10, bottom: 10, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 10, padding: 8, gap: 4, maxWidth: 180 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 }, legendTxt: { fontSize: 11, fontWeight: "700", color: HT.text, flexShrink: 1 },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 10, backgroundColor: HT.card, borderTopWidth: 1, borderTopColor: HT.border },
  footTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: HT.text2 }, clear: { color: "#DC2626", fontWeight: "800", fontSize: 12 },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: '#FF6B35', borderRadius: 999, paddingHorizontal: 14, minHeight: 44 }, ctaTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

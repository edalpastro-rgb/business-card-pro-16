// optimal-route.tsx — V50.z240 — FEAT-GEO-001 Modulo B (Fase 1): Giro Ottimale in 3 step.
// Step 1 selezione clienti (≤10, preselezionati dalla Mappa via AsyncStorage geo_giro_ids_v1) · Step 2 partenza (GPS / ufficio / indirizzo)
// · Step 3 risultato (POST /geo/optimal-route: tappe ordinate, km/min per tappa, totale, Naviga Google Maps / Chiama / Scheda).
// V50.z241 (Fase 2): mappa del percorso (polilinea + tappe numerate), orario di partenza con ETA per tappa, esporta PDF.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Linking } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { LeafletMap } from "@/src/LeafletMap";
import { exportRoutePdf, estimateTimes } from "@/src/utils/routePdf";
import { useAuth } from "@/src/auth";
import { useNavChooser, joinAddr } from "@/src/NavChooser";
import { KmEntry } from "@/src/utils/kmReportPdf";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const GIRO_KEY = "geo_giro_ids_v1";
const ORANGE = "#FF6B35"; const NAVY = HT.text;
type GeoContact = { contact_id: string; name: string; company: string; status: string; phone: string; address: string; city: string; lat: number | null; lon: number | null };
type Leg = GeoContact & { seq: number; leg_km: number; leg_min: number; cum_km: number; cum_min: number };
type RouteRes = { route_id: string; origin: { lat: number; lon: number; label: string }; legs: Leg[]; return: { leg_km: number; leg_min: number } | null; skipped: GeoContact[]; total_km: number; drive_min: number; stop_min: number; total_min: number };
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min` : `${m} min`);

export default function OptimalRouteScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const navPad = usePageBottomPadding(8); // V50.z240 — sopra la bottom nav persistente
  // V50.z259 — Deep link dal Navigatore Axon: /optimal-route?contacts=id1,id2 → clienti preselezionati
  const { contacts: contactsParam } = useLocalSearchParams<{ contacts?: string }>();
  useEffect(() => { api("/axon/nav/track", { method: "POST", body: { feature: "optimal_route" } }).catch(() => {}); }, []);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contacts, setContacts] = useState<GeoContact[]>([]);
  const [office, setOffice] = useState<{ lat: number; lon: number; address: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  // V50.z256 — filtro «non visitati da» (mesi) + pallino arancione; ultime visite da /visits/summary
  const [notSince, setNotSince] = useState<number>(0); // 0 = tutti, 1,2,3 mesi, 4 = 4+ mesi
  const [lastVisit, setLastVisit] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{ by_contact: Record<string, { last_at: string }> }>("/visits/summary")
      .then((r) => setLastVisit(Object.fromEntries(Object.entries(r.by_contact || {}).map(([k, v]) => [k, v.last_at]))))
      .catch(() => {});
  }, []);
  const monthsSince = (cid: string): number | null => { const at = lastVisit[cid]; if (!at) return null; return (Date.now() - new Date(at).getTime()) / (30 * 86400000); };
  const matchesNotSince = (cid: string, m: number) => { if (!m) return true; const ms = monthsSince(cid); return ms == null || ms >= m; };
  const [dep, setDep] = useState<"gps" | "office" | "custom">("office");
  const [custom, setCustom] = useState("");
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [back, setBack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RouteRes | null>(null);
  // V50.z241 — orario di partenza (default: prossimo quarto d'ora) → ETA per tappa; PDF
  const { user } = useAuth();
  const [startAt, setStartAt] = useState<Date>(() => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15); return d; });
  const [pdfBusy, setPdfBusy] = useState(false);
  const shiftStart = (min: number) => setStartAt((d) => new Date(d.getTime() + min * 60000));
  const hhmm = (d: Date) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const etas = useMemo(() => (res ? estimateTimes(res, startAt) : []), [res, startAt]);
  const routeForMap = useMemo(() => (res ? { origin: { lat: res.origin.lat, lon: res.origin.lon, label: res.origin.label }, stops: res.legs.map((l) => ({ lat: l.lat as number, lon: l.lon as number, label: l.name })), returnToOrigin: !!res.return } : null), [res]);
  const doPdf = async () => { if (!res) return; setPdfBusy(true); try { await exportRoutePdf(res, startAt, user?.name); } finally { setPdfBusy(false); } };

  useEffect(() => {
    (async () => {
      try {
        const [d, saved] = await Promise.all([api<{ items: GeoContact[]; office: any }>("/geo/contacts-map?scope=mine"), AsyncStorage.getItem(GIRO_KEY)]);
        setContacts(d.items.filter((c) => c.address)); setOffice(d.office);
        if (!d.office) setDep("gps");
        const pre = (contactsParam || "").split(",").map((x) => x.trim()).filter(Boolean);
        if (pre.length) {
          const known = new Set(d.items.map((c) => c.contact_id));
          const picked = pre.filter((id) => known.has(id)).slice(0, 10);
          if (picked.length) { setSel(picked); void AsyncStorage.setItem(GIRO_KEY, JSON.stringify(picked)); }
          else if (saved) try { setSel(JSON.parse(saved)); } catch {}
        } else if (saved) try { setSel(JSON.parse(saved)); } catch {}
      } catch (e: any) { notify("Giro", e?.message || "Errore"); } finally { setLoading(false); }
    })();
  }, []);
  const persist = (next: string[]) => { setSel(next); void AsyncStorage.setItem(GIRO_KEY, JSON.stringify(next)); };
  const toggle = (id: string) => { if (sel.includes(id)) persist(sel.filter((x) => x !== id)); else if (sel.length >= 10) notify("Massimo 10 clienti", "Rimuovi un cliente per aggiungerne un altro"); else persist([...sel, id]); };
  const list = useMemo(() => { const k = q.trim().toLowerCase(); return contacts.filter((c) => (!k || `${c.name} ${c.company} ${c.city}`.toLowerCase().includes(k)) && matchesNotSince(c.contact_id, notSince)); }, [contacts, q, notSince, lastVisit]); // eslint-disable-line react-hooks/exhaustive-deps

  const readGps = useCallback(async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const granted = perm.granted || (perm.canAskAgain ? (await Location.requestForegroundPermissionsAsync()).granted : false);
      if (!granted) { notify("Posizione non disponibile", "Consenti la posizione oppure scegli Ufficio / indirizzo.", [{ text: "Apri impostazioni", onPress: () => Linking.openSettings() }, { text: "Ok" }]); setDep(office ? "office" : "custom"); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGps({ lat: p.coords.latitude, lon: p.coords.longitude });
    } catch (e: any) { notify("GPS", e?.message || "Posizione non disponibile"); }
  }, [office]);
  useEffect(() => { if (step === 2 && dep === "gps" && !gps) void readGps(); }, [step, dep, gps, readGps]);

  const compute = async () => {
    if (dep === "gps" && !gps) { notify("GPS", "Posizione non ancora disponibile: attendi o scegli un'altra partenza"); return; }
    if (dep === "custom" && custom.trim().length < 5) { notify("Indirizzo", "Scrivi l'indirizzo di partenza"); return; }
    setBusy(true);
    try {
      const body: any = { contact_ids: sel, return_to_origin: back };
      if (dep === "gps") { body.origin_lat = gps!.lat; body.origin_lon = gps!.lon; } else if (dep === "custom") body.origin_address = custom.trim();
      setRes(await api<RouteRes>("/geo/optimal-route", { method: "POST", body })); setStep(3);
    } catch (e: any) { notify("Calcolo non riuscito", e?.message || "Errore"); } finally { setBusy(false); }
  };
  const navChooser = useNavChooser();
  const navTo = (l: { lat: number | null; lon: number | null; name?: string; address?: string; city?: string }) =>
    navChooser.open({ lat: l.lat, lon: l.lon, label: l.name, address: joinAddr(l.address, l.city) });

  // V50.z253 — Resoconto Km: spunta «Visita completata» per tappa/rientro → POST /geo/km-log (km dal percorso calcolato)
  const [kmDone, setKmDone] = useState<Record<number, KmEntry>>({});
  const [kmBusy, setKmBusy] = useState<number | null>(null);
  useEffect(() => {
    if (!res?.route_id) { setKmDone({}); return; }
    api<{ items: KmEntry[] }>(`/geo/km-log?route_id=${encodeURIComponent(res.route_id)}`)
      .then((r) => { const m: Record<number, KmEntry> = {}; (r.items || []).forEach((e) => { m[e.seq] = e; }); setKmDone(m); })
      .catch(() => {});
  }, [res?.route_id]);
  const toggleVisit = async (seq: number) => {
    if (!res || kmBusy !== null) return;
    setKmBusy(seq);
    try {
      const cur = kmDone[seq];
      if (cur) {
        await api(`/geo/km-log/${cur.entry_id}`, { method: "DELETE" });
        setKmDone((m) => { const n = { ...m }; delete n[seq]; return n; });
      } else {
        const today = new Date(); const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const r = await api<{ entry: KmEntry }>("/geo/km-log", { method: "POST", body: { route_id: res.route_id, seq, date } });
        setKmDone((m) => ({ ...m, [seq]: r.entry }));
      }
    } catch (e: any) { notify("Resoconto Km", e?.message || "Operazione non riuscita"); } finally { setKmBusy(null); }
  };
  const kmDoneTotal = Object.values(kmDone).reduce((a, e) => a + (Number(e.km) || 0), 0);
  const byId = (id: string) => contacts.find((c) => c.contact_id === id);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (step > 1 ? setStep((s) => (s - 1) as any) : router.back())} hitSlop={10} testID="route-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>🚗 Giro Ottimale</Text><Text style={styles.sub}>Step {step}/3 · {step === 1 ? "Seleziona i clienti" : step === 2 ? "Scegli la partenza" : "Percorso calcolato"}</Text></View>
        <Pressable onPress={() => router.push("/km-report" as any)} hitSlop={8} style={styles.headBtn} testID="route-km-report"><Ionicons name="speedometer" size={18} color="#FFF" /></Pressable>
        <Pressable onPress={() => router.push("/map-clients" as any)} hitSlop={8} style={styles.headBtn} testID="route-open-map"><Ionicons name="map" size={18} color="#FFF" /></Pressable>
      </View>
      {navChooser.element}
      <KScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: navPad + 70 }} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={ORANGE} style={{ marginTop: 40 }} /> : null}

        {!loading && step === 1 ? (<>
          <View style={styles.search}><Ionicons name="search" size={16} color={HT.muted} /><TextInput value={q} onChangeText={setQ} placeholder="Cerca per nome, azienda, città" placeholderTextColor={HT.muted} style={styles.searchIn} testID="route-search" /></View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }} testID="route-notsince-filter">
            <Text style={styles.meta}>Non visitati da:</Text>
            {[{ m: 0, l: "Tutti" }, { m: 1, l: "1 mese" }, { m: 2, l: "2 mesi" }, { m: 3, l: "3 mesi" }, { m: 4, l: "4 mesi+" }].map((f) => (
              <Pressable key={f.m} onPress={() => setNotSince(f.m)} style={[styles.chip, notSince === f.m && styles.chipOn]} testID={`route-notsince-${f.m}`}><Text style={[styles.chipTxt, notSince === f.m && { color: "#FFF" }]}>{f.l}</Text></Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={styles.count}>Selezionati: {sel.length}/10</Text>{sel.length ? <Pressable onPress={() => persist([])} hitSlop={8} testID="route-clear"><Text style={styles.clear}>Cancella selezione</Text></Pressable> : null}</View>
          {list.length === 0 ? <Text style={styles.empty}>Nessun contatto con indirizzo. Aggiungi l&apos;indirizzo nelle schede cliente.</Text> : list.map((c) => {
            const on = sel.includes(c.contact_id);
            return (
              <Pressable key={c.contact_id} onPress={() => toggle(c.contact_id)} style={[styles.row, on && styles.rowOn]} testID={`route-pick-${c.contact_id}`}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? ORANGE : HT.muted} />
                <View style={{ flex: 1 }}><Text style={styles.name} numberOfLines={1}>{c.name}{c.company ? ` · ${c.company}` : ""}</Text><Text style={styles.meta} numberOfLines={1}>📍 {c.address}{c.lat == null ? " · ⚠️ indirizzo non localizzato" : ""}</Text></View>
                {(() => { const ms = monthsSince(c.contact_id); const due = notSince ? true : ms == null || ms >= 1; return due ? <View style={styles.dueDot} testID={`route-due-${c.contact_id}`}><Text style={styles.dueTxt}>{ms == null ? "mai" : `${Math.floor(ms)}m`}</Text></View> : null; })()}
              </Pressable>
            );
          })}
        </>) : null}

        {!loading && step === 2 ? (<>
          <Text style={styles.label}>Punto di partenza</Text>
          {[{ k: "gps", t: "Posizione attuale (GPS)", s: gps ? `${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}` : "Rilevamento…" }, { k: "office", t: "Ufficio", s: office?.address || "Imposta l'indirizzo ufficio in Impostazioni" }, { k: "custom", t: "Indirizzo personalizzato", s: "Scrivi via, città" }].map((o) => (
            <Pressable key={o.k} onPress={() => (o.k === "office" && !office ? notify("Ufficio", "Indirizzo ufficio non impostato") : setDep(o.k as any))} style={[styles.row, dep === o.k && styles.rowOn]} testID={`route-dep-${o.k}`}>
              <Ionicons name={dep === o.k ? "radio-button-on" : "radio-button-off"} size={22} color={dep === o.k ? ORANGE : HT.muted} />
              <View style={{ flex: 1 }}><Text style={styles.name}>{o.t}</Text><Text style={styles.meta}>{o.s}</Text></View>
            </Pressable>
          ))}
          {dep === "custom" ? <TextInput value={custom} onChangeText={setCustom} placeholder="Es. Via Giorgione 66, Asolo" placeholderTextColor={HT.muted} style={styles.input} testID="route-custom-addr" /> : null}
          <Pressable onPress={() => setBack((v) => !v)} style={styles.row} testID="route-return-toggle"><Ionicons name={back ? "checkbox" : "square-outline"} size={22} color={back ? ORANGE : HT.muted} /><Text style={styles.name}>Ritorno al punto di partenza</Text></Pressable>
          <Text style={styles.hint}>Tappe: {sel.map((id) => byId(id)?.name).filter(Boolean).join(" · ")}</Text>
        </>) : null}

        {step === 3 && res ? (<>
          <View style={styles.summary} testID="route-summary">
            <Text style={styles.sumTitle}>📍 Partenza: {res.origin.label}</Text>
            <Text style={styles.sumBig}>{res.legs.length} clienti · {res.total_km} km · {fmtMin(res.total_min)}</Text>
            <Text style={styles.sumMeta}>Guida {fmtMin(res.drive_min)} + soste {fmtMin(res.stop_min)} (15 min a cliente) · stima su strada, senza traffico</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <Pressable onPress={() => navTo(res.legs[0])} style={styles.cta} testID="route-nav-first"><Ionicons name="navigate" size={16} color="#FFF" /><Text style={styles.ctaTxt}>Naviga tappa 1</Text></Pressable>
              <Pressable onPress={doPdf} disabled={pdfBusy} style={[styles.cta, { backgroundColor: '#7C3AED' }, pdfBusy && { opacity: 0.6 }]} testID="route-export-pdf">{pdfBusy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="document-text" size={16} color="#FFF" /><Text style={styles.ctaTxt}>Esporta PDF</Text></>}</Pressable>
              <Pressable onPress={() => { setRes(null); setStep(1); }} style={[styles.cta, { backgroundColor: "rgba(255,255,255,0.18)" }]} testID="route-recalc"><Ionicons name="refresh" size={16} color="#FFF" /><Text style={styles.ctaTxt}>Ricalcola</Text></Pressable>
            </View>
          </View>
          {/* V50.z241 — mappa del percorso */}
          <View style={styles.mapBox} testID="route-map">
            <LeafletMap markers={[]} center={[res.origin.lat, res.origin.lon]} zoom={11} route={routeForMap} testID="route-map-leaflet" />
          </View>
          {/* V50.z241 — orario di partenza → ETA */}
          <View style={styles.timeRow} testID="route-start-time">
            <Ionicons name="time-outline" size={18} color={NAVY} />
            <Text style={styles.name}>Partenza alle</Text>
            <Pressable onPress={() => shiftStart(-15)} style={styles.tBtn} hitSlop={6} testID="route-time-minus"><Ionicons name="remove" size={18} color={NAVY} /></Pressable>
            <Text style={styles.timeVal}>{hhmm(startAt)}</Text>
            <Pressable onPress={() => shiftStart(15)} style={styles.tBtn} hitSlop={6} testID="route-time-plus"><Ionicons name="add" size={18} color={NAVY} /></Pressable>
            <Text style={[styles.meta, { flex: 1, textAlign: "right" }]}>Fine ~{hhmm(new Date(startAt.getTime() + res.total_min * 60000))}</Text>
          </View>
          {/* V50.z253 — Resoconto Km: km registrati per questo giro */}
          <Pressable onPress={() => router.push("/km-report" as any)} style={styles.kmBar} testID="route-km-bar">
            <Ionicons name="speedometer" size={18} color="#0EA5E9" />
            <Text style={styles.kmBarTxt}>Visite completate: <Text style={{ fontWeight: "900" }}>{Object.keys(kmDone).length}</Text> · km registrati: <Text style={{ fontWeight: "900" }}>{kmDoneTotal.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</Text></Text>
            <Text style={styles.kmBarLink}>Resoconto Km ›</Text>
          </Pressable>
          {res.legs.map((l) => (
            <View key={l.contact_id} style={[styles.leg, kmDone[l.seq] && styles.legDone]} testID={`route-leg-${l.seq}`}>
              <View style={[styles.seq, kmDone[l.seq] && { backgroundColor: '#16A34A' }]}><Text style={styles.seqTxt}>{kmDone[l.seq] ? "✓" : l.seq}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{l.name}{l.company ? ` · ${l.company}` : ""}</Text>
                <Text style={styles.meta}>📍 {l.address}</Text>
                <Text style={styles.legKm}>➜ +{l.leg_km} km · +{l.leg_min} min   (totale {l.cum_km} km)</Text>
                {etas[l.seq - 1] ? <Text style={styles.eta}>🕐 Arrivo ~{hhmm(etas[l.seq - 1].arrive)} · riparti ~{hhmm(etas[l.seq - 1].leave)}</Text> : null}
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Pressable onPress={() => navTo(l)} style={styles.mini} testID={`route-nav-${l.seq}`}><Ionicons name="navigate" size={13} color={ORANGE} /><Text style={styles.miniTxt}>Naviga</Text></Pressable>
                  {l.phone ? <Pressable onPress={() => Linking.openURL(`tel:${l.phone.replace(/\s+/g, "")}`)} style={styles.mini}><Ionicons name="call" size={13} color={ORANGE} /><Text style={styles.miniTxt}>Chiama</Text></Pressable> : null}
                  <Pressable onPress={() => router.push(`/contact/${l.contact_id}` as any)} style={styles.mini}><Ionicons name="person" size={13} color={ORANGE} /><Text style={styles.miniTxt}>Scheda</Text></Pressable>
                  <Pressable onPress={() => toggleVisit(l.seq)} disabled={kmBusy !== null} style={[styles.mini, styles.visitBtn, kmDone[l.seq] && styles.visitBtnOn]} testID={`route-visit-${l.seq}`}>
                    {kmBusy === l.seq ? <ActivityIndicator size="small" color={kmDone[l.seq] ? "#FFF" : "#16A34A"} /> : <Ionicons name={kmDone[l.seq] ? "checkmark-circle" : "ellipse-outline"} size={14} color={kmDone[l.seq] ? "#FFF" : "#16A34A"} />}
                    <Text style={[styles.miniTxt, { color: kmDone[l.seq] ? "#FFF" : "#16A34A" }]}>{kmDone[l.seq] ? `Completata · ${l.leg_km} km` : "Visita completata"}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
          {res.return ? (
            <View style={[styles.leg, kmDone[0] && styles.legDone]}>
              <View style={[styles.seq, { backgroundColor: '#16A34A' }]}><Text style={styles.seqTxt}>🏁</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Ritorno a {res.origin.label}</Text>
                <Text style={styles.legKm}>➜ +{res.return.leg_km} km · +{res.return.leg_min} min</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Pressable onPress={() => navTo({ lat: res.origin.lat, lon: res.origin.lon, name: res.origin.label })} style={styles.mini} testID="route-nav-return"><Ionicons name="navigate" size={13} color={ORANGE} /><Text style={styles.miniTxt}>Naviga</Text></Pressable>
                  <Pressable onPress={() => toggleVisit(0)} disabled={kmBusy !== null} style={[styles.mini, styles.visitBtn, kmDone[0] && styles.visitBtnOn]} testID="route-visit-return">
                    <Ionicons name={kmDone[0] ? "checkmark-circle" : "ellipse-outline"} size={14} color={kmDone[0] ? "#FFF" : "#16A34A"} />
                    <Text style={[styles.miniTxt, { color: kmDone[0] ? "#FFF" : "#16A34A" }]}>{kmDone[0] ? `Rientro registrato · ${res.return.leg_km} km` : "Rientro completato"}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
          {res.skipped.length ? <Text style={styles.warn}>⚠️ Esclusi (indirizzo non localizzabile): {res.skipped.map((s) => s.name).join(", ")}</Text> : null}
        </>) : null}
      </KScrollView>
      {step < 3 && !loading ? (
        <View style={[styles.footer, { paddingBottom: navPad - 40 }]}>
          {step === 1 ? (
            <Pressable onPress={() => (sel.length ? setStep(2) : notify("Seleziona almeno un cliente"))} style={[styles.cta, { flex: 1 }, !sel.length && { opacity: 0.6 }]} testID="route-next"><Text style={styles.ctaTxt}>Avanti: partenza ({sel.length})</Text><Ionicons name="arrow-forward" size={16} color="#FFF" /></Pressable>
          ) : (
            <Pressable onPress={compute} disabled={busy} style={[styles.cta, { flex: 1 }, busy && { opacity: 0.6 }]} testID="route-compute">{busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="calculator" size={16} color="#FFF" /><Text style={styles.ctaTxt}>CALCOLA PERCORSO</Text></>}</Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: NAVY },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 }, sub: { color: "#CBD5E1", fontSize: 11 },
  headBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, borderWidth: 1, borderColor: HT.border }, searchIn: { flex: 1, fontSize: 14, color: NAVY },
  count: { flex: 1, fontSize: 12, fontWeight: "800", color: HT.text2 }, clear: { fontSize: 12, fontWeight: "800", color: "#DC2626" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.border, minHeight: 56 }, rowOn: { borderColor: ORANGE, backgroundColor: HT.brandTint },
  name: { fontSize: 14, fontWeight: "800", color: NAVY }, meta: { fontSize: 12, color: HT.muted, marginTop: 2 },
  empty: { textAlign: "center", color: HT.muted, padding: 20 }, label: { fontSize: 12, fontWeight: "800", color: HT.text2 },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, fontSize: 14, color: NAVY },
  hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  summary: { backgroundColor: NAVY, borderRadius: 16, padding: 14, gap: 4 }, sumTitle: { color: "#CBD5E1", fontSize: 12, fontWeight: "700" }, sumBig: { color: "#FFF", fontSize: 18, fontWeight: "900" }, sumMeta: { color: "#CBD5E1", fontSize: 11 },
  leg: { flexDirection: "row", gap: 10, backgroundColor: HT.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.border },
  seq: { width: 30, height: 30, borderRadius: 15, backgroundColor: ORANGE, alignItems: "center", justifyContent: "center" }, seqTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  legKm: { fontSize: 12, fontWeight: "800", color: "#0F766E", marginTop: 3 },
  mini: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: 999, backgroundColor: HT.brandTint }, miniTxt: { fontSize: 12, fontWeight: "800", color: ORANGE },
  // V50.z256 — filtro «non visitati da»
  chip: { paddingHorizontal: 10, minHeight: 30, justifyContent: "center", borderRadius: 15, borderWidth: 1, borderColor: HT.brandLine, backgroundColor: HT.brandTint }, chipOn: { backgroundColor: ORANGE, borderColor: ORANGE }, chipTxt: { fontSize: 11, fontWeight: "800", color: ORANGE },
  dueDot: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HT.brandTint, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: ORANGE }, dueTxt: { fontSize: 10, fontWeight: "900", color: ORANGE },
  // V50.z253 — Resoconto Km
  legDone: { borderColor: '#86EFAC', backgroundColor: HT.successTint },
  visitBtn: { backgroundColor: HT.successTint, borderWidth: 1, borderColor: '#86EFAC' }, visitBtnOn: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  kmBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.axonTint, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.axonLine, minHeight: 48 },
  kmBarTxt: { flex: 1, fontSize: 12, color: NAVY }, kmBarLink: { fontSize: 12, fontWeight: "800", color: "#0EA5E9" },
  warn: { fontSize: 12, color: HT.warning, fontWeight: "700" },
  mapBox: { height: 240, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: HT.border, backgroundColor: HT.border },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: HT.border },
  tBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" }, timeVal: { fontSize: 16, fontWeight: "900", color: NAVY, minWidth: 48, textAlign: "center" },
  eta: { fontSize: 12, color: HT.text2, marginTop: 2 },
  footer: { flexDirection: "row", paddingHorizontal: 12, paddingTop: 10, backgroundColor: HT.card, borderTopWidth: 1, borderTopColor: HT.border },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ORANGE, borderRadius: 999, paddingHorizontal: 14, minHeight: 46 }, ctaTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

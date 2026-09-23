/**
 * V50.z116 — Pagina Meteo (dentro l'app): condizioni attuali, dettagli di oggi,
 * allerte attive, previsioni 7 giorni, località modificabile (indirizzo di
 * residenza per-utente usato come fallback al GPS).
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal, TextInput, Alert as RNAlert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { ModuleErrorBoundary } from "@/src/shared";
import { getWeatherCoords, weatherIcon, fmtDayIt } from "@/src/utils/weather";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Day = { date: string; icon_key: string; label: string; temp_min?: number; temp_max?: number; precipitation_mm?: number; precipitation_prob?: number; wind_kmh?: number; uv_index?: number; sunrise?: string; sunset?: string };
type Forecast = { days: Day[]; current?: { temp?: number; feels_like?: number; humidity?: number; wind_kmh?: number; icon_key?: string; label?: string } | null; place?: string | null; needs_address?: boolean; address_error?: string | null; error?: string };
type Alert = { id: string; severity: "red" | "orange" | "yellow"; title: string; detail: string };

const SEV: Record<string, string> = { red: "#DC2626", orange: "#EA580C", yellow: "#CA8A04" };

export default function MeteoScreen() {
  return (
    <ModuleErrorBoundary moduleName="meteo">
      <MeteoInner />
    </ModuleErrorBoundary>
  );
}

function MeteoInner() {
  const router = useRouter();
  const [fc, setFc] = useState<Forecast | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addrModal, setAddrModal] = useState(false);
  const [addrDraft, setAddrDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // V50.z163 — Ricerca TEMPORANEA "Cerca meteo per città": consulta un'altra
  // località senza toccare l'indirizzo di residenza né le allerte della Home.
  // Stato solo locale alla pagina: tornando alla Home si perde (default ripristinato).
  const [cityQuery, setCityQuery] = useState("");
  const [cityActive, setCityActive] = useState<string | null>(null);
  const [citySearching, setCitySearching] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await getWeatherCoords();
      const body = c ? { lat: c.lat, lon: c.lon } : {};
      const [f, a] = await Promise.all([
        api<Forecast>("/weather/forecast", { method: "POST", body }),
        api<{ alerts: Alert[] }>("/weather/alerts", { method: "POST", body }).catch(() => ({ alerts: [] })),
      ]);
      setFc(f);
      setAlerts(a?.alerts || []);
    } catch (e: any) {
      setFc({ days: [], error: e?.message || "Errore di rete" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const searchCity = useCallback(async () => {
    const q = cityQuery.trim();
    if (!q) return;
    setCitySearching(true);
    setCityError(null);
    try {
      // Solo `address`: il backend fa il geocoding della città (nessuna coordinata GPS,
      // nessuna scrittura su user-settings). Se la città non viene trovata il server
      // ripiega sull'indirizzo di residenza → lo rileviamo confrontando `place`.
      const f = await api<Forecast>("/weather/forecast", { method: "POST", body: { address: q } });
      if (f?.needs_address || (f?.place || "").trim().toLowerCase() !== q.toLowerCase()) {
        setCityError(`Località «${q}» non trovata. Prova con città e provincia (es. "Verona" o "Bassano del Grappa VI").`);
        return;
      }
      setFc(f);
      setCityActive(q);
    } catch (e: any) {
      setCityError(e?.message || "Errore di rete");
    } finally {
      setCitySearching(false);
    }
  }, [cityQuery]);

  const resetCity = useCallback(() => {
    setCityActive(null);
    setCityQuery("");
    setCityError(null);
    setLoading(true);
    load();
  }, [load]);

  const openAddr = async () => {
    try { const us = await api<{ home_address?: string }>("/user-settings"); setAddrDraft(us?.home_address || ""); } catch { setAddrDraft(""); }
    setAddrModal(true);
  };
  const saveAddr = async () => {
    setSaving(true);
    try {
      await api("/user-settings", { method: "PUT", body: { home_address: addrDraft.trim() } });
      setAddrModal(false); setLoading(true); await load();
    } catch (e: any) {
      // V50.z151 — prima l'errore era silenzioso ("non succede nulla")
      RNAlert.alert("Salvataggio non riuscito", e?.message || "Controlla la connessione e riprova.");
    } finally { setSaving(false); }
  };

  const today = fc?.days?.[0];
  const cur = fc?.current;
  const icon = weatherIcon(cur?.icon_key || today?.icon_key);
  const hhmm = (s?: string) => (s ? s.slice(11, 16) : "—");

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Meteo</Text>
        <Pressable testID="meteo-edit-address" onPress={openAddr} hitSlop={10}>
          <Ionicons name="location-outline" size={22} color={HT.brand} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); if (cityActive) { setCityActive(null); setCityQuery(""); } load(); }} />}>
        {/* V50.z163 — Cerca meteo per città (temporaneo, separato dalla residenza) */}
        <View style={[styles.card, { marginBottom: 12 }]} testID="meteo-city-search">
          <Text style={styles.cardTitle}>Cerca meteo per città</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput
              testID="meteo-city-input"
              value={cityQuery}
              onChangeText={(t) => { setCityQuery(t); if (cityError) setCityError(null); }}
              placeholder="es. Milano, Roma, Cortina d'Ampezzo"
              placeholderTextColor={HT.muted}
              returnKeyType="search"
              onSubmitEditing={searchCity}
              autoCorrect={false}
              style={[styles.input, { flex: 1, marginTop: 0 }]}
            />
            <Pressable
              testID="meteo-city-search-btn"
              onPress={searchCity}
              disabled={citySearching || !cityQuery.trim()}
              style={[styles.primaryBtn, { marginTop: 0, paddingHorizontal: 14, opacity: citySearching || !cityQuery.trim() ? 0.5 : 1 }]}
            >
              {citySearching ? <ActivityIndicator color="#FFF" /> : <Ionicons name="search" size={18} color="#FFF" />}
            </Pressable>
          </View>
          {!!cityError && <Text style={[styles.muted, { color: "#DC2626", marginTop: 8 }]} testID="meteo-city-error">{cityError}</Text>}
          {cityActive ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }} testID="meteo-city-active">
              <Ionicons name="eye-outline" size={16} color={HT.brand} />
              <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>Stai consultando: <Text style={{ fontWeight: "800" }}>{cityActive}</Text></Text>
              <Pressable testID="meteo-city-reset" onPress={resetCity} hitSlop={8} style={{ minHeight: 32, justifyContent: "center" }}>
                <Text style={{ color: HT.brand, fontWeight: "800", fontSize: 12 }}>Torna alla mia posizione</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[styles.muted, { marginTop: 8 }]}>Consultazione temporanea: non modifica l&apos;indirizzo di residenza né le allerte in Home.</Text>
          )}
        </View>
        {loading ? (
          <ActivityIndicator color={HT.brand} style={{ marginTop: 40 }} />
        ) : fc?.needs_address ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{fc?.address_error ? "Indirizzo non riconosciuto" : "Imposta la tua località"}</Text>
            <Text style={styles.muted}>
              {fc?.address_error
                ? `Il GPS non è disponibile e non riesco a localizzare «${fc.address_error}». Prova a scrivere solo città e provincia (es. "Padova" oppure "Cittadella PD"), poi riprova.`
                : "Il GPS non è disponibile: inserisci il tuo indirizzo di residenza per vedere meteo e allerte della tua zona."}
            </Text>
            <Pressable testID="meteo-set-address" onPress={openAddr} style={styles.primaryBtn}><Text style={styles.primaryBtnTxt}>{fc?.address_error ? "Correggi indirizzo" : "Imposta indirizzo"}</Text></Pressable>
            <Pressable testID="meteo-retry" onPress={() => { setLoading(true); load(); }} style={{ alignSelf: "center", marginTop: 10, minHeight: 40, justifyContent: "center" }}>
              <Text style={{ color: HT.brand, fontWeight: "700" }}>Riprova</Text>
            </Pressable>
          </View>
        ) : fc?.error || !today ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Meteo non disponibile</Text>
            <Text style={styles.muted}>{fc?.error || "Nessun dato ricevuto dal servizio meteo."}</Text>
            <Pressable testID="meteo-retry" onPress={() => { setLoading(true); load(); }} style={styles.primaryBtn}><Text style={styles.primaryBtnTxt}>Riprova</Text></Pressable>
          </View>
        ) : (
          <>
            {/* Attuale */}
            <View style={[styles.hero, { backgroundColor: icon.color }]} testID="meteo-hero">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <Ionicons name={icon.name} size={64} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTemp}>{cur?.temp != null ? `${Math.round(cur.temp)}°` : today.temp_max != null ? `${Math.round(today.temp_max)}°` : "—"}</Text>
                  <Text style={styles.heroLabel}>{cur?.label || today.label}</Text>
                  <Pressable onPress={cityActive ? resetCity : openAddr} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }} testID="meteo-place">
                    <Ionicons name={cityActive ? "search" : "location"} size={12} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.heroPlace} numberOfLines={1}>{cityActive ? `${cityActive} (ricerca)` : (fc?.place || "Posizione attuale")}</Text>
                    <Ionicons name={cityActive ? "close-circle-outline" : "create-outline"} size={12} color="rgba(255,255,255,0.9)" />
                  </Pressable>
                </View>
              </View>
              <View style={styles.heroStats}>
                <Stat icon="thermometer-outline" label="Min / Max" value={`${Math.round(today.temp_min ?? 0)}° / ${Math.round(today.temp_max ?? 0)}°`} light />
                <Stat icon="water-outline" label="Umidità" value={cur?.humidity != null ? `${Math.round(cur.humidity)}%` : "—"} light />
                <Stat icon="body-outline" label="Percepita" value={cur?.feels_like != null ? `${Math.round(cur.feels_like)}°` : "—"} light />
              </View>
            </View>

            {/* Allerte */}
            {alerts.length > 0 && !cityActive && (
              <View style={{ gap: 8, marginTop: 12 }} testID="meteo-alerts">
                {alerts.map((a) => (
                  <View key={a.id} style={[styles.alert, { backgroundColor: SEV[a.severity] || SEV.yellow }]}>
                    <Ionicons name="flash" size={20} color="#FFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertTitle}>{a.title}</Text>
                      <Text style={styles.alertDetail}>{a.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Dettagli oggi */}
            <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={styles.cardTitle}>Oggi in dettaglio</Text>
              <View style={styles.grid}>
                <Stat icon="rainy-outline" label="Pioggia" value={`${today.precipitation_mm ?? 0} mm`} />
                <Stat icon="umbrella-outline" label="Prob. pioggia" value={today.precipitation_prob != null ? `${Math.round(today.precipitation_prob)}%` : "—"} />
                <Stat icon="flag-outline" label="Vento max" value={today.wind_kmh != null ? `${Math.round(today.wind_kmh)} km/h` : "—"} />
                <Stat icon="sunny-outline" label="Indice UV" value={today.uv_index != null ? `${Math.round(today.uv_index)}` : "—"} />
                <Stat icon="arrow-up-circle-outline" label="Alba" value={hhmm(today.sunrise)} />
                <Stat icon="arrow-down-circle-outline" label="Tramonto" value={hhmm(today.sunset)} />
              </View>
            </View>

            {/* 7 giorni */}
            <View style={[styles.card, { marginTop: 12 }]} testID="meteo-days">
              <Text style={styles.cardTitle}>Prossimi 7 giorni</Text>
              {fc!.days.map((d, i) => {
                const ic = weatherIcon(d.icon_key);
                return (
                  <View key={d.date} style={[styles.dayRow, i === 0 && { backgroundColor: HT.card2 }]}>
                    <Text style={styles.dayName}>{fmtDayIt(d.date, i)}</Text>
                    <Ionicons name={ic.name} size={22} color={ic.color} />
                    <Text style={styles.dayLabel} numberOfLines={1}>{d.label}</Text>
                    <Text style={styles.dayRain}>{d.precipitation_prob != null ? `${Math.round(d.precipitation_prob)}%` : ""}</Text>
                    <Text style={styles.dayTemp}>{Math.round(d.temp_min ?? 0)}° <Text style={{ fontWeight: "900" }}>{Math.round(d.temp_max ?? 0)}°</Text></Text>
                  </View>
                );
              })}
              <Text style={[styles.muted, { marginTop: 8, fontSize: 10.5 }]}>Dati Open-Meteo · soglie allerta ispirate a Protezione Civile</Text>
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={addrModal} transparent animationType="fade" onRequestClose={() => setAddrModal(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Indirizzo di residenza</Text>
            <Text style={styles.muted}>Usato per meteo e allerte quando il GPS non è disponibile. Ogni utente ha il proprio.</Text>
            <TextInput testID="meteo-address-input" value={addrDraft} onChangeText={setAddrDraft} placeholder="es. Via Roma 10, Torino" placeholderTextColor={HT.muted} style={styles.input} autoFocus />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => setAddrModal(false)} style={[styles.primaryBtn, { flex: 1, backgroundColor: HT.card2 }]}><Text style={[styles.primaryBtnTxt, { color: HT.text }]}>Annulla</Text></Pressable>
              <Pressable testID="meteo-address-save" onPress={saveAddr} disabled={saving} style={[styles.primaryBtn, { flex: 1, opacity: saving ? 0.6 : 1 }]}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnTxt}>Salva</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ icon, label, value, light }: { icon: any; label: string; value: string; light?: boolean }) {
  const c = light ? "#FFF" : HT.text;
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={16} color={light ? "rgba(255,255,255,0.9)" : HT.brand} />
      <Text style={[styles.statLabel, light && { color: "rgba(255,255,255,0.85)" }]}>{label}</Text>
      <Text style={[styles.statValue, { color: c }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  hero: { borderRadius: 18, padding: 16 },
  heroTemp: { fontSize: 44, fontWeight: "900", color: "#FFF", lineHeight: 48 },
  heroLabel: { fontSize: 15, fontWeight: "700", color: "#FFF" },
  heroPlace: { fontSize: 12, color: "rgba(255,255,255,0.9)", flexShrink: 1 },
  heroStats: { flexDirection: "row", marginTop: 14, gap: 8 },
  card: { backgroundColor: HT.card2, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: HT.border },
  cardTitle: { fontSize: 14, fontWeight: "800", color: HT.text, marginBottom: 8 },
  muted: { fontSize: 12, color: HT.muted },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, flexBasis: "30%", alignItems: "center", gap: 2, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.04)" },
  statLabel: { fontSize: 10.5, color: HT.muted, fontWeight: "600" },
  statValue: { fontSize: 13, fontWeight: "800" },
  alert: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  alertTitle: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  alertDetail: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 2 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 10 },
  dayName: { width: 74, fontSize: 12.5, fontWeight: "700", color: HT.text },
  dayLabel: { flex: 1, fontSize: 12, color: HT.muted },
  dayRain: { width: 38, fontSize: 11.5, color: "#0284C7", fontWeight: "700", textAlign: "right" },
  dayTemp: { width: 66, fontSize: 13, color: HT.muted, textAlign: "right" },
  primaryBtn: { marginTop: 12, backgroundColor: HT.brand, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 44 },
  primaryBtnTxt: { color: "#FFF", fontWeight: "800" },
  modalBack: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: HT.card2, borderRadius: 16, padding: 18 },
  input: { marginTop: 8, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: HT.text, backgroundColor: HT.card2 },
});

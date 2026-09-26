// voice-profiles.tsx — V50.z372 — «Voci autorizzate» (Profilo → Impostazioni → Voce): impronta del proprietario (stato, qualità,
// ri-registrazione), interruttore «Axon risponde solo alle voci registrate», sensibilità del riconoscimento, e — solo Master —
// le VOCI SECONDARIE (collaboratori/famiglia) con permessi spuntabili fino all'«accesso totale», pausa ed eliminazione.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { vpApi, type VpProfile, type VpStatus, type VpPermissionKey } from "@/src/violawake/voiceprintApi";

const LEVELS: { key: "strict" | "normal" | "tolerant"; label: string; desc: string }[] = [
  { key: "strict", label: "Rigorosa", desc: "Massima sicurezza, può ignorarti se sei raffreddato o c'è molto rumore" },
  { key: "normal", label: "Normale", desc: "Consigliata" },
  { key: "tolerant", label: "Tollerante", desc: "Più permissiva in ambienti rumorosi" },
];

export default function VoiceProfilesScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [st, setSt] = useState<VpStatus | null>(null);
  const [items, setItems] = useState<VpProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([vpApi.status(), vpApi.profiles()]);
      setSt(a); setItems(b.items);
    } catch (e: any) { notify("Voci autorizzate", e?.message || "Caricamento non riuscito"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setEnabled = async (on: boolean) => { setBusy("enabled"); try { setSt(await vpApi.settings({ enabled: on })); } catch (e: any) { notify("Voci autorizzate", e?.message); } finally { setBusy(null); } };
  const setLevel = async (level: "strict" | "normal" | "tolerant") => { setBusy("level"); try { setSt(await vpApi.settings({ level })); } catch (e: any) { notify("Voci autorizzate", e?.message); } finally { setBusy(null); } };
  const patch = async (p: VpProfile, body: Parameters<typeof vpApi.patchProfile>[1]) => {
    setBusy(p.profile_id);
    try { const r = await vpApi.patchProfile(p.profile_id, body); setItems((xs) => xs.map((x) => (x.profile_id === p.profile_id ? r.profile : x))); }
    catch (e: any) { notify("Voci autorizzate", e?.message || "Modifica non riuscita"); } finally { setBusy(null); }
  };
  const remove = async (p: VpProfile) => {
    if (!(await confirmAsync("Elimina voce", `Rimuovere la voce di ${p.name}? ${p.role === "owner" ? "Senza la tua impronta Axon tornerà a rispondere a chiunque." : "Non potrà più usare Axon."}`))) return;
    setBusy(p.profile_id);
    try { await vpApi.deleteProfile(p.profile_id); await load(); } catch (e: any) { notify("Voci autorizzate", e?.message); } finally { setBusy(null); }
  };

  const mine = st?.my_profile || null;
  const secondaries = items.filter((p) => p.role === "secondary");
  const keys: VpPermissionKey[] = (st?.permission_keys as VpPermissionKey[]) || ["briefing", "chat", "crm", "device", "critical"];
  const labels = st?.permission_labels || ({} as Record<string, string>);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="voice-profiles-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Voci autorizzate</Text><Text style={s.sub}>Impronta vocale · chi può parlare con Axon</Text></View>
        <Ionicons name="finger-print" size={22} color={HT.violet} />
      </View>
      {loading ? <ActivityIndicator color={HT.violet} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: pagePad }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
          {/* Stato + proprietario */}
          <View style={[s.card, { borderColor: st?.enforced ? HT.success : HT.border }]} testID="voice-profiles-owner-card">
            <View style={s.row}>
              <View style={[s.icon, { backgroundColor: st?.enforced ? HT.successTint : HT.violetTint }]}><Ionicons name={st?.enforced ? "shield-checkmark" : "shield-outline"} size={20} color={st?.enforced ? HT.success : HT.violet} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{st?.enforced ? "Axon risponde solo alle voci registrate" : mine ? "Riconoscimento voce in pausa" : "Nessuna impronta vocale"}</Text>
                <Text style={s.meta} testID="voice-profiles-status">{mine ? `La tua voce · ${Math.round(mine.quality?.speech_sec || 0)} s di parlato · coerenza ${Math.round((mine.quality?.consistency || 0) * 100)}% · riconosciuta ${mine.matches || 0} volte` : "Registra la tua voce: Axon ignorerà in silenzio chiunque altro."}</Text>
              </View>
            </View>
            {mine ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => router.push({ pathname: "/voice-enroll", params: { role: "owner", profile_id: mine.profile_id } } as any)} style={[s.btn, s.ghost, { flex: 1 }]} testID="voice-profiles-reenroll"><Ionicons name="refresh" size={16} color={HT.text} /><Text style={[s.btnTxt, { color: HT.text }]}>Registra di nuovo</Text></Pressable>
                <Pressable onPress={() => remove(mine)} style={[s.btn, { backgroundColor: HT.dangerTint, paddingHorizontal: 14 }]} testID="voice-profiles-delete-owner"><Ionicons name="trash" size={16} color={HT.danger} /></Pressable>
              </View>
            ) : (
              <Pressable onPress={() => router.push({ pathname: "/voice-enroll", params: { role: "owner" } } as any)} style={s.btn} testID="voice-profiles-enroll-owner"><Ionicons name="mic" size={18} color="#FFF" /><Text style={s.btnTxt}>Registra la tua voce (≈ {Math.ceil((st?.min_speech_sec || 120) / 60)} min)</Text></Pressable>
            )}
            {mine ? (
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <Text style={s.label}>Ignora le voci sconosciute</Text>
                {busy === "enabled" ? <ActivityIndicator color={HT.violet} /> : <Switch value={!!st?.enabled} onValueChange={setEnabled} trackColor={{ true: HT.violet }} testID="voice-profiles-enabled" />}
              </View>
            ) : null}
            {!st?.engine_ready ? <Text style={s.warn}>{st?.engine_error ? `Motore non disponibile: ${st.engine_error}` : "Motore di riconoscimento in preparazione al primo utilizzo (qualche secondo)."}</Text> : null}
          </View>

          {/* Sensibilità */}
          {mine ? (
            <View style={s.card} testID="voice-profiles-level-card">
              <Text style={s.cardTitle}>Sensibilità del riconoscimento</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {LEVELS.map((l) => { const on = st?.level === l.key; return (
                  <Pressable key={l.key} onPress={() => setLevel(l.key)} style={[s.chip, on && s.chipOn]} testID={`voice-profiles-level-${l.key}`}><Text style={[s.chipTxt, on && { color: "#FFF" }]}>{l.label}</Text></Pressable>
                ); })}
              </View>
              <Text style={s.meta}>{LEVELS.find((l) => l.key === st?.level)?.desc || `Soglia personalizzata ${st?.threshold}`}. Se Axon non ti riconosce all'esterno, passa a «Tollerante» o registra di nuovo la voce in quell'ambiente.</Text>
            </View>
          ) : null}

          {/* Voci secondarie (Master) */}
          {st?.is_master ? (
            <>
              <View style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}>
                <Text style={s.section}>Voci secondarie</Text>
                <Pressable onPress={() => router.push({ pathname: "/voice-enroll", params: { role: "secondary" } } as any)} disabled={!mine} style={[s.addBtn, !mine && { opacity: 0.5 }]} testID="voice-profiles-add-secondary"><Ionicons name="person-add" size={16} color="#FFF" /><Text style={s.btnTxt}>Aggiungi voce</Text></Pressable>
              </View>
              <Text style={s.meta}>Collaboratori o familiari che possono parlare con Axon dal tuo account. Spunta cosa possono fare: i comandi critici richiedono comunque PIN o impronta.{!mine ? " Registra prima la tua voce." : ""}</Text>
              {secondaries.length === 0 ? <View style={s.empty}><Ionicons name="people-outline" size={22} color={HT.muted} /><Text style={s.meta}>Nessuna voce secondaria</Text></View> : null}
              {secondaries.map((p) => {
                const all = keys.every((k) => !!p.permissions?.[k]);
                return (
                  <View key={p.profile_id} style={[s.card, p.status === "paused" && { opacity: 0.7 }]} testID={`voice-profile-${p.profile_id}`}>
                    <View style={s.row}>
                      <View style={s.icon}><Ionicons name="person" size={18} color={HT.violet} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cardTitle}>{p.name}</Text>
                        <Text style={s.meta}>{p.status === "paused" ? "In pausa · " : ""}{Math.round(p.quality?.speech_sec || 0)} s · coerenza {Math.round((p.quality?.consistency || 0) * 100)}% · riconosciuta {p.matches || 0} volte</Text>
                      </View>
                      {busy === p.profile_id ? <ActivityIndicator color={HT.violet} /> : <Switch value={p.status === "active"} onValueChange={(v) => patch(p, { status: v ? "active" : "paused" })} trackColor={{ true: HT.violet }} testID={`voice-profile-active-${p.profile_id}`} />}
                    </View>
                    <Pressable onPress={() => patch(p, { permissions: Object.fromEntries(keys.map((k) => [k, !all])) as any })} style={[s.permRow, all && { backgroundColor: HT.violetTint }]} testID={`voice-profile-full-${p.profile_id}`}>
                      <Ionicons name={all ? "checkbox" : "square-outline"} size={22} color={HT.violet} /><Text style={[s.label, { fontWeight: "900" }]}>Accesso totale</Text>
                    </Pressable>
                    {keys.map((k) => { const on = !!p.permissions?.[k]; return (
                      <Pressable key={k} onPress={() => patch(p, { permissions: { [k]: !on } })} style={s.permRow} testID={`voice-profile-perm-${k}-${p.profile_id}`}>
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? HT.violet : HT.muted} /><Text style={s.label}>{labels[k] || k}</Text>
                      </Pressable>
                    ); })}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable onPress={() => router.push({ pathname: "/voice-enroll", params: { role: "secondary", name: p.name, profile_id: p.profile_id } } as any)} style={[s.btn, s.ghost, { flex: 1 }]} testID={`voice-profile-reenroll-${p.profile_id}`}><Ionicons name="refresh" size={16} color={HT.text} /><Text style={[s.btnTxt, { color: HT.text }]}>Registra di nuovo</Text></Pressable>
                      <Pressable onPress={() => remove(p)} style={[s.btn, { backgroundColor: HT.dangerTint, paddingHorizontal: 14 }]} testID={`voice-profile-delete-${p.profile_id}`}><Ionicons name="trash" size={16} color={HT.danger} /></Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  section: { fontSize: 15, fontWeight: "900", color: HT.text },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "900", color: HT.text }, meta: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  label: { fontSize: 14, fontWeight: "700", color: HT.text, flex: 1 },
  warn: { fontSize: 12, color: HT.warning, fontWeight: "700" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: HT.violet, paddingHorizontal: 12 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  ghost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, borderRadius: 999, backgroundColor: HT.violet, paddingHorizontal: 14 },
  chip: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 42, borderRadius: 21, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  chipOn: { backgroundColor: HT.violet, borderColor: HT.violet }, chipTxt: { fontSize: 13, fontWeight: "800", color: HT.text },
  permRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 6, borderRadius: 10 },
  empty: { alignItems: "center", gap: 6, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: HT.border, borderStyle: "dashed" },
});

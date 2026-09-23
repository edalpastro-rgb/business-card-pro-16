// V50.z315 — Schermata «Viola» (ViolaWake): stato dell'ascolto, attivazione modulo azienda (Master,
// servizio opzionale a sovrapprezzo), interruttore personale, permessi microfono (contratto: spiega →
// chiedi → se negato «Apri Impostazioni»), test del flusso e ultimi eventi.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, TextInput, ActivityIndicator, Platform, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { useViolaWake } from "@/src/violawake/ViolaWakeProvider";
import { violaApi } from "@/src/violawake/api";
import type { ViolaEvent, ViolaState } from "@/src/violawake/types";

const C = theme.color;
const VIOLA = "#8B5CF6"; // identità Viola/Axon (uguale in chiaro e scuro)

const STATE_LABEL: Record<ViolaState, string> = {
  off: "Spento", unsupported: "Non disponibile qui", needs_key: "Motore non configurato", no_permission: "Microfono non autorizzato",
  starting: "Avvio…", listening: "In ascolto", capturing: "Ti ascolto…", thinking: "Elaboro…", speaking: "Sto rispondendo", error: "Errore",
};
const STATE_COLOR: Partial<Record<ViolaState, string>> = { listening: C.success, capturing: C.error, speaking: VIOLA, thinking: C.warning, error: C.error, no_permission: C.warning, needs_key: C.warning };

const KIND_LABEL: Record<string, string> = { wake: "Wake-word", command: "Comando", trigger: "Trigger", chat: "Chat Axon", cancelled: "Annullato", error: "Errore", permission: "Permessi" };

export default function ViolaWakeScreen() {
  const router = useRouter();
  const v = useViolaWake();
  const [events, setEvents] = useState<ViolaEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [testCmd, setTestCmd] = useState("che appuntamenti ho domani?");

  const loadEvents = useCallback(async () => {
    try { setEvents((await violaApi.events(20)).items); } catch { /* noop */ }
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents, v.state]);

  const onRefresh = async () => { setRefreshing(true); await v.refresh(); await loadEvents(); setRefreshing(false); };

  const toggleUser = async (on: boolean) => {
    setBusy("user");
    try {
      if (on && v.supported) {
        const ok = await v.askPermission();
        if (!ok) { notify("Microfono", v.permission && !v.permission.canAskAgain ? "Permesso negato: aprilo dalle Impostazioni del telefono." : "Serve il microfono per sentire «Viola»."); }
      }
      await v.updateSettings({ enabled: on });
    } catch (e: any) { notify("ViolaWake", e?.message || "Operazione non riuscita"); }
    finally { setBusy(null); }
  };

  const toggleModule = async (on: boolean) => {
    setBusy("module");
    try { await v.setModule(on, on ? "Attivato dal Master (servizio opzionale)" : undefined); }
    catch (e: any) { notify("ViolaWake", e?.message || "Operazione non riuscita"); }
    finally { setBusy(null); }
  };

  const moduleOn = !!v.module?.enabled;
  const userOn = !!v.settings?.enabled;
  const stColor = STATE_COLOR[v.state] || C.muted;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn} testID="viola-back"><Ionicons name="chevron-back" size={22} color={C.onSurfaceInverse} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Viola · comandi vocali</Text>
          <Text style={s.hSub}>Di' «{v.keywordLabel}» e parla con Axon, a mani libere</Text>
        </View>
        <Ionicons name="ear" size={22} color={C.onSurfaceInverse} />
      </View>

      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {/* Stato */}
        <View style={[s.card, { borderColor: stColor }]} testID="viola-state-card">
          <View style={s.row}>
            <View style={[s.stateDot, { backgroundColor: stColor }]} />
            <Text style={s.stateTxt} testID="viola-state">{STATE_LABEL[v.state]}</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.small}>{Platform.OS === "web" ? "web" : Platform.OS}</Text>
          </View>
          {v.lastTranscript ? <Text style={s.quote}>Hai detto: «{v.lastTranscript}»</Text> : null}
          {v.lastReply ? <Text style={s.reply}>{v.lastReply}</Text> : null}
          {v.error ? <Text style={s.err} testID="viola-error">{v.error}</Text> : null}
          {!v.supported ? (
            <View style={s.infoBox}>
              <Ionicons name="phone-portrait" size={16} color={C.warning} />
              <Text style={s.infoTxt}>L'ascolto in background funziona solo nell'app installata (build Android/iOS), non su web o Expo Go. Qui puoi configurare il modulo e provare i comandi scritti.</Text>
            </View>
          ) : null}
          {v.supported && !v.hasKey ? (
            <View style={s.infoBox} testID="viola-engine-fallback">
              <Ionicons name="ear-outline" size={16} color={C.info} />
              <Text style={s.infoTxt}>Motore: riconoscimento vocale del telefono in ascolto continuo (nessuna chiave, nessun costo). Su iOS resta attivo con l'app in primo piano; su Android anche a schermo bloccato. Inserendo la chiave Picovoice (EXPO_PUBLIC_PICOVOICE_ACCESS_KEY) l'app passa da sola a Porcupine offline.</Text>
            </View>
          ) : null}
        </View>

        {/* Modulo azienda (Master) */}
        <View style={s.card} testID="viola-module-card">
          <View style={s.row}>
            <Ionicons name="business" size={18} color={VIOLA} />
            <Text style={s.cardTitle}>Modulo ViolaWake per l'azienda</Text>
            <View style={{ flex: 1 }} />
            {v.isMaster ? (
              busy === "module" ? <ActivityIndicator color={VIOLA} /> : <Switch value={moduleOn} onValueChange={toggleModule} trackColor={{ true: VIOLA }} testID="viola-module-switch" />
            ) : (
              <Text style={[s.badge, { backgroundColor: moduleOn ? C.success : C.muted }]}>{moduleOn ? "ATTIVO" : "NON ATTIVO"}</Text>
            )}
          </View>
          <Text style={s.hint}>
            Servizio opzionale, spento di default: si attiva su richiesta dell'azienda (sovrapprezzo). Quando è attivo, ogni collaboratore può accendere l'ascolto sul proprio telefono.
            {!v.isMaster && !moduleOn ? " Chiedi al tuo Master di attivarlo." : ""}
          </Text>
          {v.module?.note ? <Text style={s.small}>{v.module.note}</Text> : null}
        </View>

        {/* Interruttore personale */}
        <View style={[s.card, !moduleOn && { opacity: 0.55 }]} testID="viola-user-card">
          <View style={s.row}>
            <Ionicons name="mic" size={18} color={VIOLA} />
            <Text style={s.cardTitle}>Ascolto sul mio telefono</Text>
            <View style={{ flex: 1 }} />
            {busy === "user" ? <ActivityIndicator color={VIOLA} /> : <Switch value={userOn} disabled={!moduleOn} onValueChange={toggleUser} trackColor={{ true: VIOLA }} testID="viola-user-switch" />}
          </View>
          <Text style={s.hint}>Il microfono resta sul telefono: «Viola» viene riconosciuta in locale (Porcupine se c’è la chiave Picovoice, altrimenti il riconoscimento vocale di sistema), niente audio al cloud finché non senti il segnale. Poi il comando viene trascritto dal telefono {v.onDeviceStt ? "(on-device)" : ""} e passato ad Axon.</Text>

          {/* Permessi — contratto */}
          {v.supported && v.permission && !v.permission.granted ? (
            <View style={s.permBox} testID="viola-perm-box">
              <Text style={s.permTitle}>Serve il microfono</Text>
              <Text style={s.hint}>Solo per sentire la parola «Viola» e il comando che segue. Nessuna registrazione salvata.</Text>
              {v.permission.canAskAgain ? (
                <Pressable style={s.btn} onPress={() => void v.askPermission()} testID="viola-perm-ask"><Ionicons name="mic" size={16} color={C.onSurfaceInverse} /><Text style={s.btnTxt}>Consenti microfono</Text></Pressable>
              ) : (
                <Pressable style={[s.btn, { backgroundColor: C.warning }]} onPress={v.openSettings} testID="viola-perm-settings"><Ionicons name="settings" size={16} color={C.onSurfaceInverse} /><Text style={s.btnTxt}>Apri Impostazioni</Text></Pressable>
              )}
            </View>
          ) : null}

          {/* Opzioni */}
          {moduleOn && v.settings ? (
            <View style={{ gap: 10, marginTop: 6 }}>
              <OptRow label="Risposta parlata" value={v.settings.speak_reply} onChange={(x) => void v.updateSettings({ speak_reply: x })} testID="viola-opt-speak" />
              <OptRow label="Vibrazione alla rilevazione" value={v.settings.confirm_sound} onChange={(x) => void v.updateSettings({ confirm_sound: x })} testID="viola-opt-haptic" />
              <View style={s.row}>
                <Text style={s.optLbl}>Sensibilità</Text>
                <View style={{ flex: 1 }} />
                {[0.4, 0.6, 0.8].map((lv) => (
                  <Pressable key={lv} onPress={() => void v.updateSettings({ sensitivity: lv })} style={[s.chip, Math.abs((v.settings?.sensitivity ?? 0.6) - lv) < 0.01 && s.chipOn]} testID={`viola-sens-${lv}`}>
                    <Text style={[s.chipTxt, Math.abs((v.settings?.sensitivity ?? 0.6) - lv) < 0.01 && { color: C.onSurfaceInverse }]}>{lv === 0.4 ? "Bassa" : lv === 0.6 ? "Media" : "Alta"}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.row}>
                <Text style={s.optLbl}>Trascrizione</Text>
                <View style={{ flex: 1 }} />
                {(["device", "whisper"] as const).map((e) => (
                  <Pressable key={e} onPress={() => void v.updateSettings({ stt_engine: e })} style={[s.chip, v.settings?.stt_engine === e && s.chipOn]} testID={`viola-stt-${e}`}>
                    <Text style={[s.chipTxt, v.settings?.stt_engine === e && { color: C.onSurfaceInverse }]}>{e === "device" ? "Telefono (gratis)" : "Whisper (cloud)"}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* Test */}
        <View style={s.card} testID="viola-test-card">
          <View style={s.row}><Ionicons name="flask" size={18} color={VIOLA} /><Text style={s.cardTitle}>Prova il flusso</Text></View>
          <Text style={s.hint}>Esempi: «briefing», «controlla tutto», «com'è andata la settimana» (trigger) · «che appuntamenti ho domani?», «cerca sul web il prezzo del PUN oggi» (chat Axon con risposta parlata) · «annulla».</Text>
          <View style={[s.row, { gap: 8 }]}>
            <TextInput value={testCmd} onChangeText={setTestCmd} placeholder="Scrivi il comando come lo diresti" placeholderTextColor={C.muted} style={s.input} testID="viola-test-input" onSubmitEditing={() => void v.runCommand(testCmd)} returnKeyType="send" />
            <Pressable style={s.btnSq} onPress={() => void v.runCommand(testCmd)} disabled={!moduleOn && !v.isMaster} testID="viola-test-run"><Ionicons name="send" size={18} color={C.onSurfaceInverse} /></Pressable>
          </View>
          {v.supported ? (
            <Pressable style={[s.btn, { alignSelf: "flex-start" }]} onPress={v.simulateWake} testID="viola-test-wake"><Ionicons name="mic" size={16} color={C.onSurfaceInverse} /><Text style={s.btnTxt}>Simula «{v.keywordLabel}» e ascolta il comando</Text></Pressable>
          ) : null}
        </View>

        {/* Eventi */}
        <View style={s.card} testID="viola-events-card">
          <View style={s.row}><Ionicons name="list" size={18} color={VIOLA} /><Text style={s.cardTitle}>Ultimi eventi</Text></View>
          {events.length === 0 ? <Text style={s.hint}>Nessun evento ancora.</Text> : events.map((e) => (
            <View key={e.event_id} style={s.evRow}>
              <Text style={[s.badge, { backgroundColor: e.kind === "error" ? C.error : e.kind === "wake" ? VIOLA : C.brandSecondary }]}>{KIND_LABEL[e.kind] || e.kind}</Text>
              <Text style={s.evTxt} numberOfLines={2}>{e.transcript || e.detail || "—"}</Text>
              <Text style={s.small}>{new Date(e.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
          ))}
        </View>

        <Text style={s.foot}>
          {Platform.OS === "android"
            ? (v.backgroundService
              ? "Android: servizio in primo piano attivo — mentre l'ascolto è acceso vedi la notifica fissa «Viola in ascolto» e il microfono resta attivo anche a schermo bloccato. Dalla notifica puoi spegnerlo."
              : "Android: questa build non include ancora il servizio in primo piano «Viola in ascolto» (serve una nuova build): l'ascolto continua con app aperta o in secondo piano recente.")
            : "iOS: funziona con app aperta e a schermo spento (audio in background); Apple non consente il microfono sempre acceso con app chiusa."}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function OptRow({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  return (
    <View style={s.row}>
      <Text style={s.optLbl}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Switch value={value} onValueChange={onChange} trackColor={{ true: VIOLA }} testID={testID} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: VIOLA },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  hTitle: { color: C.onSurfaceInverse, fontSize: 18, fontWeight: "800" },
  hSub: { color: C.onSurfaceInverse, opacity: 0.9, fontSize: 12, marginTop: 2 },
  body: { padding: 16, gap: 12, paddingBottom: 120 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { color: C.onSurface, fontSize: 15, fontWeight: "800" },
  hint: { color: C.onSurfaceTertiary, fontSize: 12, lineHeight: 17 },
  small: { color: C.muted, fontSize: 11 },
  stateDot: { width: 12, height: 12, borderRadius: 6 },
  stateTxt: { color: C.onSurface, fontSize: 16, fontWeight: "900" },
  quote: { color: C.onSurface, fontSize: 13, fontStyle: "italic" },
  reply: { color: VIOLA, fontSize: 13, fontWeight: "700" },
  err: { color: C.error, fontSize: 12, fontWeight: "700" },
  infoBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 10, backgroundColor: C.surfaceTertiary },
  infoTxt: { flex: 1, color: C.onSurfaceTertiary, fontSize: 12, lineHeight: 17 },
  badge: { color: C.onSurfaceInverse, fontSize: 10, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, letterSpacing: 0.5 },
  permBox: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.warning, backgroundColor: C.surfaceTertiary },
  permTitle: { color: C.onSurface, fontSize: 14, fontWeight: "800" },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: VIOLA, justifyContent: "center" },
  btnTxt: { color: C.onSurfaceInverse, fontSize: 14, fontWeight: "800" },
  btnSq: { width: 48, height: 48, borderRadius: 12, backgroundColor: VIOLA, alignItems: "center", justifyContent: "center" },
  optLbl: { color: C.onSurface, fontSize: 14, fontWeight: "600" },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceTertiary, minHeight: 34, justifyContent: "center" },
  chipOn: { backgroundColor: VIOLA, borderColor: VIOLA },
  chipTxt: { color: C.onSurfaceTertiary, fontSize: 12, fontWeight: "700" },
  input: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, color: C.onSurface, paddingHorizontal: 12, fontSize: 14 },
  evRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.divider },
  evTxt: { flex: 1, color: C.onSurface, fontSize: 12 },
  foot: { color: C.muted, fontSize: 11, lineHeight: 15, paddingHorizontal: 4 },
});

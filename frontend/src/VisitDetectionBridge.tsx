// VisitDetectionBridge.tsx — V50.z256 — Montato in app/_layout: avvia/ferma il tracking secondo le impostazioni,
// mostra il popup Tempo Reale («Sei da X? Visita effettuata?» Sì/No + nota) e il recap Fine Giornata (spunte pre-selezionate).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, AppState, Platform } from "react-native";
import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import {
  VisitCandidate, VisitDetectionSettings, loadVisitSettings, onVisitEvent, maybeTriggerRecap, startForegroundWatch, stopForegroundWatch,
  startBackgroundUpdates, stopBackgroundUpdates, scheduleEveningRecapNotification, refreshGeoContacts, todayLocal,
} from "@/src/visitDetection";

const SKY = "#0EA5E9";

export function VisitDetectionBridge({ userId }: { userId?: string | null }) {
  const [settings, setSettings] = useState<VisitDetectionSettings | null>(null);
  const [rt, setRt] = useState<VisitCandidate[] | null>(null);          // popup tempo reale
  const [recapDate, setRecapDate] = useState<string | null>(null);      // recap serale
  const settingsRef = useRef<VisitDetectionSettings | null>(null);

  const applySettings = useCallback(async (s: VisitDetectionSettings) => {
    settingsRef.current = s; setSettings(s);
    if (s.enabled) {
      await refreshGeoContacts();
      await startForegroundWatch();
      await startBackgroundUpdates();
    } else { stopForegroundWatch(); await stopBackgroundUpdates(); }
    await scheduleEveningRecapNotification(s);
    void maybeTriggerRecap(s);
  }, []);

  useEffect(() => {
    if (!userId) { stopForegroundWatch(); return; }
    let alive = true;
    loadVisitSettings().then((s) => { if (alive) void applySettings(s); });
    const off = onVisitEvent((ev) => {
      if (ev.type === "candidates") setRt((cur) => (cur ? [...cur, ...ev.items] : ev.items));
      else if (ev.type === "recap") setRecapDate(ev.date);
      else if (ev.type === "settings") void applySettings(ev.settings);
    });
    const check = () => { const s = settingsRef.current; if (s) void maybeTriggerRecap(s); };
    const iv = setInterval(check, 5 * 60 * 1000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") check(); });
    let notifSub: any = null;
    if (Platform.OS !== "web") {
      notifSub = Notifications.addNotificationResponseReceivedListener((resp) => {
        const d: any = resp.notification.request.content.data || {};
        if (d.type === "visit_recap" || d.type === "visit_candidates") setRecapDate(d.date || todayLocal());
      });
    }
    return () => { alive = false; off(); clearInterval(iv); sub.remove(); notifSub?.remove?.(); };
  }, [userId, applySettings]);

  if (!userId || !settings) return null;
  return (
    <>
      {rt && rt.length > 0 ? <RealtimeVisitModal items={rt} onDone={() => setRt(null)} /> : null}
      {recapDate ? <EveningRecapModal date={recapDate} onClose={() => setRecapDate(null)} /> : null}
    </>
  );
}

// ---------- Popup Tempo Reale ----------
function RealtimeVisitModal({ items, onDone }: { items: VisitCandidate[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const cur = items[idx];
  const next = () => { setNotes(""); if (idx + 1 < items.length) setIdx(idx + 1); else onDone(); };
  const answer = async (yes: boolean) => {
    if (!cur) return;
    setBusy(true);
    try {
      if (yes) await api("/visits/confirm", { method: "POST", body: { contact_id: cur.contact_id, notes, stay_minutes: cur.stay_minutes, lat: cur.lat, lon: cur.lon, at: cur.started_at, date: cur.date, source: "gps", cand_id: cur.cand_id } });
      else await api(`/visits/candidates/${cur.cand_id}/dismiss`, { method: "POST" });
      // Più clienti nel raggio: confermato uno, gli altri della stessa sosta si scartano
      if (yes) {
        const others = items.filter((x, i) => i !== idx && x.started_at === cur.started_at);
        await Promise.all(others.map((o) => api(`/visits/candidates/${o.cand_id}/dismiss`, { method: "POST" }).catch(() => {})));
        setBusy(false); onDone(); return;
      }
    } catch (e: any) { notify("Visita", e?.message || "Operazione non riuscita"); }
    setBusy(false); next();
  };
  if (!cur) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDone}><KModalBody>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="visit-realtime-modal">
          <View style={styles.iconWrap}><Ionicons name="location" size={26} color="#FFF" /></View>
          <Text style={styles.title}>Sei da {cur.contact_name}?</Text>
          <Text style={styles.sub}>Sosta di ~{cur.stay_minutes} min{cur.city ? ` · ${cur.city}` : ""}{items.length > 1 ? ` · ${idx + 1}/${items.length} clienti nel raggio` : ""}. Visita effettuata?</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Nota rapida (opzionale)…" placeholderTextColor={HT.muted} style={styles.input} multiline testID="visit-realtime-notes" />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => answer(false)} disabled={busy} style={[styles.btn, styles.btnNo]} testID="visit-realtime-no"><Ionicons name="close" size={18} color={HT.text} /><Text style={styles.btnNoTxt}>No</Text></Pressable>
            <Pressable onPress={() => answer(true)} disabled={busy} style={[styles.btn, styles.btnYes]} testID="visit-realtime-yes">{busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark" size={18} color="#FFF" /><Text style={styles.btnYesTxt}>Sì, visita effettuata</Text></>}</Pressable>
          </View>
          <Pressable onPress={onDone} style={{ paddingVertical: 10, alignItems: "center" }} testID="visit-realtime-later"><Text style={{ color: HT.muted, fontWeight: "700", fontSize: 12 }}>Decido nel recap di fine giornata</Text></Pressable>
        </View>
      </View>
    </KModalBody></Modal>
  );
}

// ---------- Recap Fine Giornata ----------
export function EveningRecapModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [items, setItems] = useState<VisitCandidate[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ items: VisitCandidate[] }>(`/visits/candidates?date=${date}`)
      .then((r) => { setItems(r.items || []); setChecked(Object.fromEntries((r.items || []).map((c) => [c.cand_id, true]))); })
      .catch(() => setItems([]));
  }, [date]);
  const confirmAll = async () => {
    if (!items) return;
    setBusy(true);
    try {
      for (const c of items) {
        if (checked[c.cand_id]) await api("/visits/confirm", { method: "POST", body: { contact_id: c.contact_id, stay_minutes: c.stay_minutes, lat: c.lat, lon: c.lon, at: c.started_at, date: c.date, source: "gps", cand_id: c.cand_id } });
        else await api(`/visits/candidates/${c.cand_id}/dismiss`, { method: "POST" });
      }
      const n = items.filter((c) => checked[c.cand_id]).length;
      notify("Visite confermate", `${n} ${n === 1 ? "visita registrata" : "visite registrate"} · km aggiunti al Resoconto Km.`);
      onClose();
    } catch (e: any) { notify("Recap visite", e?.message || "Operazione non riuscita"); } finally { setBusy(false); }
  };
  const hhmm = (iso: string) => { try { return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { maxHeight: "80%" }]} testID="visit-recap-modal">
          <View style={[styles.iconWrap, { backgroundColor: '#7C3AED' }]}><Ionicons name="moon" size={24} color="#FFF" /></View>
          <Text style={styles.title}>Recap visite di oggi</Text>
          <Text style={styles.sub}>Soste rilevate dal GPS: togli la spunta a quelle NON effettuate e conferma in un tap.</Text>
          {!items ? <ActivityIndicator color={SKY} style={{ marginVertical: 20 }} /> : items.length === 0 ? (
            <Text style={[styles.sub, { marginVertical: 12 }]}>Nessuna sosta rilevata oggi.</Text>
          ) : (
            <KScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }}>
              {items.map((c) => {
                const on = !!checked[c.cand_id];
                return (
                  <Pressable key={c.cand_id} onPress={() => setChecked((m) => ({ ...m, [c.cand_id]: !on }))} style={[styles.row, on && styles.rowOn]} testID={`visit-recap-${c.cand_id}`}>
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? SKY : HT.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{c.contact_name}</Text>
                      <Text style={styles.rowMeta}>{hhmm(c.started_at)} · ~{c.stay_minutes} min{c.city ? ` · ${c.city}` : ""}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </KScrollView>
          )}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnNo]} testID="visit-recap-close"><Text style={styles.btnNoTxt}>Più tardi</Text></Pressable>
            <Pressable onPress={confirmAll} disabled={busy || !items?.length} style={[styles.btn, styles.btnYes, (!items?.length) && { opacity: 0.5 }]} testID="visit-recap-confirm">{busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark-done" size={18} color="#FFF" /><Text style={styles.btnYesTxt}>Conferma</Text></>}</Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 },
  sheet: { width: "100%", maxWidth: 380, backgroundColor: HT.card2, borderRadius: 20, padding: 18, gap: 10 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: SKY, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text, textAlign: "center" },
  sub: { fontSize: 13, color: HT.muted, textAlign: "center", lineHeight: 18 },
  input: { backgroundColor: HT.card2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: HT.border, minHeight: 60, color: HT.text, fontSize: 13, textAlignVertical: "top" },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, minHeight: 48, paddingHorizontal: 10 },
  btnNo: { backgroundColor: HT.card2 }, btnNoTxt: { fontWeight: "800", color: HT.text },
  btnYes: { backgroundColor: '#16A34A', flex: 2 }, btnYesTxt: { fontWeight: "800", color: "#FFF" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2, minHeight: 52 },
  rowOn: { borderColor: SKY, backgroundColor: HT.axonTint },
  rowTitle: { fontSize: 14, fontWeight: "800", color: HT.text }, rowMeta: { fontSize: 11, color: HT.muted, marginTop: 1 },
});

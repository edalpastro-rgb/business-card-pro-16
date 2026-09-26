// src/ChatQueuePanel.tsx — V50.z223 — Tab «Coda» della chat: bozze in coda (⏳ in coda · 🔄 in elaborazione · ✅ inviato) con
// posizione/ETA e azioni [Invia ora] [Modifica] [Cancella] [Priorità]. Sopra: tab delle chat parallele (sessioni) con [+].
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type QueueItem = { draft_id: string; content: string; status: "pending" | "processing" | "done" | "failed"; priority: "URGENT" | "HIGH" | "NORMAL"; position_in_queue?: number; estimated_time?: string; session_id?: string | null; created_at?: string; error?: string; retry_count?: number };
export type ChatTab = { session_id: string; title: string; count: number; queued: number };
const PURPLE = "#7C3AED";
const PRIO_NEXT: Record<QueueItem["priority"], QueueItem["priority"]> = { NORMAL: "HIGH", HIGH: "URGENT", URGENT: "NORMAL" };
const PRIO_LABEL: Record<QueueItem["priority"], string> = { URGENT: "🔴 Urgente", HIGH: "🟠 Alta", NORMAL: "⚪ Normale" };
const STATUS_ICON: Record<QueueItem["status"], string> = { pending: "⏳", processing: "🔄", done: "✅", failed: "🔴" };

export function ChatQueuePanel({ items, recentDone, failed, onChanged, onSendNow, busy }: { items: QueueItem[]; recentDone: QueueItem[]; failed: QueueItem[]; onChanged: () => void; onSendNow: (it: QueueItem) => void; busy: boolean }) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const patch = async (id: string, body: Record<string, unknown>) => { try { await api(`/chat/queue/${id}`, { method: "PATCH", body }); } catch {} onChanged(); };
  const del = async (id: string) => { try { await api(`/chat/queue/${id}`, { method: "DELETE" }); } catch {} onChanged(); };
  // V50.z225 — Riprova bozze fallite (singola / tutte): tornano pending e ripartono da sole
  const retry = async (id: string) => { try { await api(`/chat/queue/${id}/retry`, { method: "POST" }); } catch {} onChanged(); };
  const retryAll = async () => { try { await api("/chat/queue/retry-all", { method: "POST" }); } catch {} onChanged(); };

  return (
    <KScrollView style={styles.wrap} contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled" testID="chat-queue-panel">
      {failed.length > 0 && (
        <View style={styles.failedBox} testID="queue-failed-section">
          <View style={[styles.row, { alignItems: "center" }]}>
            <Text style={[styles.h, { color: HT.danger, flex: 1 }]}>🔴 Non riuscite ({failed.length})</Text>
            {failed.length > 1 && <Btn icon="refresh" label="Riprova tutte" onPress={() => void retryAll()} primary testID="queue-retry-all" />}
          </View>
          <Text style={styles.muted}>Axon non è riuscito a rispondere a queste domande. Nessuna è andata persa: riprova quando vuoi.</Text>
          {failed.map((it) => (
            <View key={it.draft_id} style={[styles.card, styles.cardFailed]} testID={`queue-failed-${it.draft_id}`}>
              <View style={styles.row}>
                <Text style={styles.icon}>{STATUS_ICON.failed}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txt} numberOfLines={3}>{it.content}</Text>
                  <Text style={[styles.meta, { color: HT.danger }]} numberOfLines={2}>{it.error ? `Errore: ${it.error}` : "Errore sconosciuto"}{it.retry_count ? ` · tentativi: ${it.retry_count}` : ""}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Btn icon="refresh" label="Riprova" onPress={() => void retry(it.draft_id)} primary testID={`queue-retry-${it.draft_id}`} />
                <Btn icon="trash-outline" label="Cancella" onPress={() => void del(it.draft_id)} danger testID={`queue-del-${it.draft_id}`} />
              </View>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.h}>📝 Bozze in coda ({items.length})</Text>
      {items.length === 0 && <Text style={styles.muted}>Nessuna bozza. Scrivi pure mentre Axon lavora: i messaggi entrano qui e partono da soli, uno alla volta, in ordine di priorità.</Text>}
      {items.map((it) => (
        <View key={it.draft_id} style={[styles.card, it.status === "processing" && styles.cardActive]} testID={`queue-item-${it.draft_id}`}>
          <View style={styles.row}>
            <Text style={styles.icon}>{STATUS_ICON[it.status]}</Text>
            <View style={{ flex: 1 }}>
              {editing?.id === it.draft_id ? (
                <TextInput value={editing.text} onChangeText={(t) => setEditing({ id: it.draft_id, text: t })} multiline autoFocus style={styles.input} testID={`queue-edit-input-${it.draft_id}`} />
              ) : <Text style={styles.txt} numberOfLines={3}>{it.content}</Text>}
              <Text style={styles.meta}>
                {it.status === "processing" ? "In elaborazione…" : `In coda · pos. ${it.position_in_queue} · ETA ${it.estimated_time}`} · {PRIO_LABEL[it.priority]}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            {editing?.id === it.draft_id ? (
              <>
                <Btn icon="checkmark" label="Salva" onPress={() => { const t = editing.text.trim(); setEditing(null); if (t) void patch(it.draft_id, { content: t }); }} primary testID={`queue-save-${it.draft_id}`} />
                <Btn icon="close" label="Annulla" onPress={() => setEditing(null)} testID={`queue-cancel-edit-${it.draft_id}`} />
              </>
            ) : (
              <>
                {it.status === "pending" && <Btn icon="send" label={busy ? "Salta la fila" : "Invia ora"} onPress={() => onSendNow(it)} primary testID={`queue-send-${it.draft_id}`} />}
                {it.status === "pending" && <Btn icon="create-outline" label="Modifica" onPress={() => setEditing({ id: it.draft_id, text: it.content })} testID={`queue-edit-${it.draft_id}`} />}
                {it.status === "pending" && <Btn icon="flag-outline" label="Priorità" onPress={() => void patch(it.draft_id, { priority: PRIO_NEXT[it.priority] })} testID={`queue-prio-${it.draft_id}`} />}
                <Btn icon="trash-outline" label="Cancella" onPress={() => void del(it.draft_id)} danger testID={`queue-del-${it.draft_id}`} />
              </>
            )}
          </View>
        </View>
      ))}
      {recentDone.length > 0 && (
        <>
          <Text style={[styles.h, { marginTop: 6 }]}>Elaborate di recente</Text>
          {recentDone.slice(0, 5).map((it) => (
            <View key={it.draft_id} style={styles.doneRow} testID={`queue-done-${it.draft_id}`}>
              <Text style={styles.icon}>{STATUS_ICON[it.status]}</Text>
              <Text style={[styles.txt, { flex: 1, color: HT.muted }]} numberOfLines={1}>{it.content}</Text>
              <Pressable onPress={() => void del(it.draft_id)} hitSlop={8} testID={`queue-done-del-${it.draft_id}`}><Ionicons name="close" size={16} color={HT.muted} /></Pressable>
            </View>
          ))}
        </>
      )}
    </KScrollView>
  );
}

function Btn({ icon, label, onPress, primary, danger, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; danger?: boolean; testID: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, primary && styles.btnPrimary, danger && styles.btnDanger]} testID={testID}>
      <Ionicons name={icon} size={14} color={primary ? "#FFF" : danger ? HT.danger : PURPLE} />
      <Text style={[styles.btnTxt, primary && { color: "#FFF" }, danger && { color: HT.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function ChatTabsBar({ tabs, current, onSelect, onNew }: { tabs: ChatTab[]; current: string | null; onSelect: (sid: string) => void; onNew: () => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.tabs} keyboardShouldPersistTaps="handled" testID="chat-tabs">
      {/* «Nuova» per prima: il bottone «Inizio» (assoluto, in alto a destra) non la copre */}
      <Pressable onPress={onNew} style={[styles.tab, styles.tabNew]} testID="chat-tab-new"><Ionicons name="add" size={16} color={HT.violet} /><Text style={[styles.tabTxt, { color: HT.violet }]}>Nuova</Text></Pressable>
      {tabs.map((t) => {
        const on = t.session_id === current;
        return (
          <Pressable key={t.session_id} onPress={() => onSelect(t.session_id)} style={[styles.tab, on && styles.tabOn]} testID={`chat-tab-${t.session_id}`}>
            <Text style={[styles.tabTxt, on && { color: "#FFF" }]} numberOfLines={1}>{t.title}</Text>
            {t.queued > 0 && <View style={styles.tabBadge}><Text style={styles.tabBadgeTxt}>{t.queued}</Text></View>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: HT.bg },
  h: { fontSize: 13, fontWeight: "900", color: HT.violet },
  muted: { fontSize: 12.5, color: HT.muted, lineHeight: 17 },
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 10, gap: 8, borderWidth: 1, borderColor: HT.violetTint },
  cardActive: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  cardFailed: { borderColor: HT.danger + '66', backgroundColor: HT.dangerTint },
  failedBox: { gap: 8, padding: 10, borderRadius: 14, backgroundColor: HT.dangerTint, borderWidth: 1, borderColor: HT.danger + '66' },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  icon: { fontSize: 16, marginTop: 1 },
  txt: { fontSize: 13.5, color: HT.text, fontWeight: "600", lineHeight: 18 },
  meta: { fontSize: 11, color: HT.muted, marginTop: 3 },
  input: { borderWidth: 1, borderColor: HT.violet, borderRadius: 10, padding: 8, fontSize: 13.5, color: HT.text, minHeight: 60, backgroundColor: HT.card },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: HT.violet + '66', backgroundColor: HT.card },
  btnPrimary: { backgroundColor: PURPLE, borderColor: HT.violet },
  btnDanger: { borderColor: HT.danger + '66', backgroundColor: HT.dangerTint },
  btnTxt: { fontSize: 12, fontWeight: "800", color: HT.violet },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 6 },
  tabs: { flexDirection: "row", gap: 6, paddingLeft: 10, paddingRight: 100, paddingVertical: 6, alignItems: "center" },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: HT.violetTint, maxWidth: 160 },
  tabOn: { backgroundColor: PURPLE },
  tabNew: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.violet + '66' },
  tabTxt: { fontSize: 12, fontWeight: "800", color: HT.violet },
  tabBadge: { backgroundColor: '#F97316', borderRadius: 999, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tabBadgeTxt: { color: "#FFF", fontSize: 9.5, fontWeight: "900" },
});

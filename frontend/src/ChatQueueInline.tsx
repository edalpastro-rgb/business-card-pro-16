// src/ChatQueueInline.tsx — V50.z301 — Bozze in coda mostrate DENTRO la chat (sotto l'ultima risposta), come bolle utente
// «in attesa»: ⏳ in coda (pos. N · ETA) · 🔄 in elaborazione · con [Invia ora] (URGENT, salta la coda) · [Modifica] inline · [Elimina].
// Prima erano visibili solo nella tab «Coda»: l'utente vedeva il testo sparire dall'input e pensava che il messaggio fosse perso.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import type { QueueItem } from "@/src/ChatQueuePanel";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const ORANGE = "#F97316";

export function ChatQueueInline({ items, onChanged, onSendNow }: { items: QueueItem[]; onChanged: () => void; onSendNow: (it: QueueItem) => void }) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  if (items.length === 0) return null;
  const save = async () => {
    if (!editing || !editing.text.trim()) return;
    try { await api(`/chat/queue/${editing.id}`, { method: "PATCH", body: { content: editing.text.trim() } }); } catch {}
    setEditing(null); onChanged();
  };
  const del = async (id: string) => { try { await api(`/chat/queue/${id}`, { method: "DELETE" }); } catch {} onChanged(); };
  const ordinal = (n?: number) => (n ? `${n}° in coda` : "in coda");
  return (
    <View style={{ gap: 8 }} testID="chat-queue-inline">
      {items.map((it) => {
        const processing = it.status === "processing";
        const isEditing = editing?.id === it.draft_id;
        return (
          <View key={it.draft_id} style={[s.bubble, processing && s.bubbleProcessing]} testID={`queue-inline-${it.draft_id}`}>
            <View style={s.head}>
              <Text style={s.status}>{processing ? "🔄 In elaborazione…" : `⏳ ${ordinal(it.position_in_queue)}${it.estimated_time && it.estimated_time !== "ora" ? ` · ~${it.estimated_time.replace("s", " s")}` : ""}`}</Text>
              {it.priority === "URGENT" ? <Text style={s.prio}>🔴 Urgente</Text> : it.priority === "HIGH" ? <Text style={s.prio}>🟠 Alta</Text> : null}
            </View>
            {isEditing ? (
              <View style={{ gap: 6 }}>
                <TextInput value={editing.text} onChangeText={(t) => setEditing({ id: it.draft_id, text: t })} style={s.input} multiline autoFocus testID={`queue-inline-edit-input-${it.draft_id}`} />
                <View style={s.row}>
                  <Btn icon="checkmark" label="Salva" onPress={() => void save()} primary testID={`queue-inline-save-${it.draft_id}`} />
                  <Btn icon="close" label="Annulla" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : (
              <>
                <Text style={s.txt}>{it.content}</Text>
                {!processing ? (
                  <View style={s.row}>
                    <Btn icon="flash" label="Invia ora" onPress={() => onSendNow(it)} primary testID={`queue-inline-now-${it.draft_id}`} />
                    <Btn icon="create-outline" label="Modifica" onPress={() => setEditing({ id: it.draft_id, text: it.content })} testID={`queue-inline-edit-${it.draft_id}`} />
                    <Btn icon="trash-outline" label="Elimina" onPress={() => void del(it.draft_id)} danger testID={`queue-inline-del-${it.draft_id}`} />
                  </View>
                ) : null}
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Btn({ icon, label, onPress, primary, danger, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; danger?: boolean; testID?: string }) {
  const color = primary ? "#FFF" : danger ? HT.danger : "#7C2D12";
  return (
    <Pressable onPress={onPress} style={[s.btn, primary && { backgroundColor: ORANGE, borderColor: ORANGE }, danger && { borderColor: HT.danger + '66' }]} hitSlop={4} testID={testID} accessibilityLabel={label}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[s.btnTxt, { color }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bubble: { alignSelf: "flex-end", maxWidth: "88%", minWidth: "60%", backgroundColor: HT.brandTint, borderWidth: 1, borderColor: '#FDBA74', borderStyle: "dashed", borderRadius: 16, borderBottomRightRadius: 4, padding: 10, gap: 6 },
  bubbleProcessing: { borderStyle: "solid", backgroundColor: HT.brandTint },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  status: { fontSize: 11, fontWeight: "800", color: "#FDBA74" },
  prio: { fontSize: 11, fontWeight: "800", color: "#FDBA74" },
  txt: { fontSize: 15, color: HT.text, lineHeight: 21 },
  row: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: 10, borderWidth: 1, borderColor: HT.brandLine, backgroundColor: HT.card },
  btnTxt: { fontSize: 12, fontWeight: "800" },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: '#FDBA74', borderRadius: 10, padding: 8, fontSize: 15, color: HT.text, minHeight: 44 },
});

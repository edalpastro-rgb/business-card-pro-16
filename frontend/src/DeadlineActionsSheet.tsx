import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";

// V50.z153 — Azioni su una singola scadenza (bolletta):
//   1. Disattiva avviso → sparisce da Home / Scadenze / conteggi (salvato sul server)
//   2. Nuova data scadenza → sovrascrive la data letta dalla bolletta e riattiva l'avviso
//   3. Sostituisci bolletta → apre la scheda contatto sul tab Bollette
// NOTA: niente Pressable backdrop con onPress (vedi V50.z59-fix2): la
// digitazione nel TextInput chiuderebbe il sheet. Chiusura via X / back Android.

export type DeadlineItem = {
  bill_id: string;
  expiry_date?: string;
  nome_offerta?: string | null;
  fornitore?: string | null;
  source?: string;
  contact?: { contact_id?: string; first_name?: string; last_name?: string } | null;
};

type Props = {
  item: DeadlineItem | null;
  onClose: () => void;
  onChanged: () => void;
};

const C = {
  primary: "#FF6B35",
  navy: "#1B2B4B",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  infoSoft: "#DBEAFE",
  info: "#0369A1",
};

function isoToIt(s?: string): string {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(s);
}

// Auto-format "gg/mm/aaaa" while typing (digits only)
function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const p = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return p.join("/");
}

function notify(title: string, msg: string) {
  if (Platform.OS === "web") window.alert(`${title}\n${msg}`);
  else Alert.alert(title, msg);
}

export function DeadlineActionsSheet({ item, onClose, onChanged }: Props) {
  const router = useRouter();
  const bottomPad = useBottomSheetPadding();
  const [mode, setMode] = useState<"menu" | "date">("menu");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState<"dismiss" | "expiry" | null>(null);

  useEffect(() => {
    if (item) { setMode("menu"); setDate(""); setBusy(null); }
  }, [item?.bill_id]);

  if (!item) return null;

  const c = item.contact || {};
  const who = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contatto";
  const offer = item.nome_offerta || item.fornitore || "Contratto";

  const dismiss = async () => {
    setBusy("dismiss");
    try {
      await api(`/deadlines/${item.bill_id}/dismiss`, { method: "POST" });
      onChanged();
      onClose();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile disattivare l'avviso");
    } finally {
      setBusy(null);
    }
  };

  const saveExpiry = async () => {
    const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) { notify("Data non valida", "Inserisci la data nel formato GG/MM/AAAA"); return; }
    setBusy("expiry");
    try {
      await api(`/deadlines/${item.bill_id}/expiry`, { method: "PUT", body: { expiry_date: date } });
      onChanged();
      onClose();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile salvare la nuova data");
    } finally {
      setBusy(null);
    }
  };

  const replaceBill = () => {
    onClose();
    if (c.contact_id) router.push(`/contact/${c.contact_id}?tab=bills` as any);
  };

  return (
    <Modal transparent visible={!!item} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: bottomPad + 12 }]} testID="deadline-actions-sheet">
          <View style={styles.handle} />
          <View style={styles.hdrRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.hdrTitle} numberOfLines={1}>{who}</Text>
              <Text style={styles.hdrSub} numberOfLines={1}>
                {offer} · scade il {isoToIt(item.expiry_date)}{item.source === "manuale" ? " (manuale)" : ""}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} testID="deadline-actions-close" style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={theme.color.onSurface} />
            </Pressable>
          </View>

          {mode === "menu" ? (
            <View style={{ gap: 10 }}>
              <Pressable
                testID="deadline-action-dismiss"
                onPress={dismiss}
                disabled={!!busy}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <View style={[styles.actionIcon, { backgroundColor: C.dangerSoft }]}>
                  {busy === "dismiss" ? <ActivityIndicator size="small" color={C.danger} /> : <Ionicons name="notifications-off" size={18} color={C.danger} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Disattiva avviso</Text>
                  <Text style={styles.actionSub}>Nasconde questa scadenza da Home e Scadenze. Si riattiva con una nuova data o una nuova bolletta.</Text>
                </View>
              </Pressable>

              <Pressable
                testID="deadline-action-newdate"
                onPress={() => setMode("date")}
                disabled={!!busy}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <View style={[styles.actionIcon, { backgroundColor: C.infoSoft }]}>
                  <Ionicons name="calendar" size={18} color={C.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Nuova data scadenza</Text>
                  <Text style={styles.actionSub}>Imposta manualmente la scadenza del contratto e riattiva l&apos;avviso.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
              </Pressable>

              <Pressable
                testID="deadline-action-replace"
                onPress={replaceBill}
                disabled={!!busy || !c.contact_id}
                style={({ pressed }) => [styles.action, pressed && styles.pressed, !c.contact_id && { opacity: 0.5 }]}
              >
                <View style={[styles.actionIcon, { backgroundColor: C.successSoft }]}>
                  <Ionicons name="document-attach" size={18} color={C.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>Sostituisci bolletta</Text>
                  <Text style={styles.actionSub}>Apri la scheda contatto: caricando una nuova bolletta l&apos;avviso si aggiorna da solo.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={styles.label}>Nuova data di scadenza</Text>
              <TextInput
                testID="deadline-newdate-input"
                value={date}
                onChangeText={(t) => setDate(maskDate(t))}
                placeholder="GG/MM/AAAA"
                placeholderTextColor={theme.color.muted}
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveExpiry}
                style={styles.input}
              />
              <Text style={styles.hint}>Data attuale: {isoToIt(item.expiry_date) || "—"}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable testID="deadline-newdate-back" onPress={() => setMode("menu")} style={[styles.btn, styles.btnGhost]} disabled={!!busy}>
                  <Text style={[styles.btnTxt, { color: theme.color.onSurface }]}>Indietro</Text>
                </Pressable>
                <Pressable testID="deadline-newdate-save" onPress={saveExpiry} style={[styles.btn, styles.btnPrimary]} disabled={!!busy}>
                  {busy === "expiry" ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={[styles.btnTxt, { color: "#FFF" }]}>Salva e riattiva</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 10 },
  hdrRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  hdrTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  hdrSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  action: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 14, minHeight: 56,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  pressed: { opacity: 0.85 },
  actionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  actionSub: { fontSize: 11.5, color: theme.color.muted, marginTop: 2, lineHeight: 15 },
  label: { fontSize: 13, fontWeight: "800", color: C.navy },
  input: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: "700",
    letterSpacing: 1, color: theme.color.onSurface, backgroundColor: theme.color.surfaceSecondary,
  },
  hint: { fontSize: 12, color: theme.color.muted },
  btn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  btnPrimary: { backgroundColor: C.primary },
  btnTxt: { fontSize: 14, fontWeight: "800" },
});

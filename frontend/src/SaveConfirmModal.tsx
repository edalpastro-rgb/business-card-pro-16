import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, TextInput, Pressable, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  defaultName: string;   // suggested name without extension
  extension: string;     // ".pdf" | ".html" | ".png" — appended to the display + return
  onCancel: () => void;
  onConfirm: (finalName: string) => Promise<void> | void;
  color?: string;
};

/**
 * V38R — Confirm/rename modal shown before saving a file to the cabinet.
 * The default name is prefilled with `${contact}-${type}-YYYY-MM-DD_HH-MM`
 * and the user can edit it. Returns the final name (WITH extension).
 */
export function SaveConfirmModal({ visible, title, subtitle, defaultName, extension, onCancel, onConfirm, color }: Props) {
  const safeBottom = useSafeBottom(); // V29.aq
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible) { setName(defaultName); setBusy(false); }
  }, [visible, defaultName]);

  const submit = async () => {
    const trimmed = (name || "").trim().replace(/[/\\?%*:|"<>]/g, "-");
    if (!trimmed) return;
    setBusy(true);
    try {
      const final = trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? trimmed : `${trimmed}${extension}`;
      await onConfirm(final);
    } finally {
      setBusy(false);
    }
  };

  const accent = color || HT.brand;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <Pressable style={styles.back} onPress={busy ? undefined : onCancel}>
        <Pressable style={[styles.card, { paddingBottom: 18 + safeBottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.head}>
            <View style={[styles.icoBox, { backgroundColor: accent + "22" }]}>
              <Ionicons name="save" size={22} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title || "Salva file"}</Text>
              {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
            </View>
          </View>
          <Text style={styles.lbl}>Nome del file</Text>
          <View style={styles.inputRow}>
            <TextInput
              testID="save-confirm-input"
              value={name}
              onChangeText={setName}
              placeholder="Nome file"
              placeholderTextColor={HT.muted}
              autoFocus
              style={styles.input}
              editable={!busy}
              selectTextOnFocus
            />
            <Text style={styles.ext}>{extension}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable testID="save-confirm-cancel" onPress={onCancel} disabled={busy} style={[styles.btn, { backgroundColor: HT.card2 }]}>
              <Text style={[styles.btnTxt, { color: HT.text }]}>Annulla</Text>
            </Pressable>
            <Pressable testID="save-confirm-ok" onPress={submit} disabled={busy || !name.trim()} style={[styles.btn, { backgroundColor: accent, opacity: (busy || !name.trim()) ? 0.6 : 1 }]}>
              {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={[styles.btnTxt, { color: "#FFF" }]}>Salva</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Build a default filename using contact name + kind + local timestamp.
 * e.g.  Rossi Mario - Analisi luce - 2026-06-19_14-30
 */
export function suggestFileName(contactName: string | undefined, kind: string, when?: Date): string {
  const d = when || new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const base = (contactName || "Cliente").replace(/[/\\?%*:|"<>]/g, "-").trim();
  const k = kind.replace(/[/\\?%*:|"<>]/g, "-").trim();
  return `${base} - ${k} - ${stamp}`;
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(15,23,42,0.6)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: HT.card, borderRadius: 16, padding: 18 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  icoBox: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  lbl: { fontSize: 12, fontWeight: "700", color: HT.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  inputRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, backgroundColor: HT.card2 },
  input: { flex: 1, paddingVertical: Platform.OS === "ios" ? 12 : 8, fontSize: 14, color: HT.text },
  ext: { fontSize: 13, color: HT.muted, fontFamily: Platform.select({ ios: "Courier", android: "monospace" }) },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  btnTxt: { fontSize: 14, fontWeight: "800" },
});

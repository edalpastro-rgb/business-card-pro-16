import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator, ScrollView, Image, Platform, NativeSyntheticEvent, TextInputChangeEventData } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { pickAvatarBase64 } from "@/src/image-picker";
import { useAuth } from "@/src/auth";

/**
 * v2.17 — Reusable "Configura intestazione" modal for Bill Analysis & CTE reports.
 * Wraps the 4 branding fields exposed by `PUT /api/auth/profile`:
 *   - company_name  → shown as report header title
 *   - company_logo_base64 → shown top-left of every generated report
 *   - report_slogan → tagline under the title
 *   - report_contacts → footer with phone/email/website
 *
 * Values persist on the user document and are automatically picked up by the
 * backend endpoints `_build_analysis_html` / `_build_cte_report_html` on every
 * report generation, so the caller doesn't need to refresh anything besides
 * `refreshUser()` (invoked internally on save).
 */
type Props = { visible: boolean; onClose: () => void };

/**
 * StableTextInput — uncontrolled TextInput that avoids re-render on every keystroke.
 * Reads its initial value from `initialValue` when `resetKey` changes (e.g. modal opens),
 * writes to parent via `onCommit` only on blur or when the modal saves. This fixes the
 * bug where the parent's re-render (triggered by live preview state) reset the caret
 * or dropped characters mid-typing on web / Android.
 */
type StableInputHandle = { getValue: () => string };
const StableTextInput = React.memo(React.forwardRef<StableInputHandle, {
  initialValue: string;
  onCommit: (v: string) => void;
  resetKey: any;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  style?: any;
  testID?: string;
}>(function StableTextInput({ initialValue, onCommit, resetKey, placeholder, maxLength, multiline, style, testID }, ref) {
  const valueRef = useRef<string>(initialValue || "");
  const inputRef = useRef<TextInput>(null);

  // On modal (re)open, sync ref + native input from parent
  // NOTE: we intentionally depend only on `resetKey`, not `initialValue`.
  // Re-syncing on every parent state change would reintroduce the very
  // re-render bug this component is designed to avoid.
  useEffect(() => {
    valueRef.current = initialValue || "";
    if (Platform.OS === "web") {
      // Force update the underlying HTMLInputElement without re-rendering
      const el: any = inputRef.current;
      if (el && typeof el.value !== "undefined") {
        el.value = initialValue || "";
      }
    } else {
      inputRef.current?.setNativeProps({ text: initialValue || "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Expose imperative getter so parent can flush the latest typed value on Save
  React.useImperativeHandle(ref, () => ({ getValue: () => valueRef.current }), []);

  const handleChange = useCallback((e: NativeSyntheticEvent<TextInputChangeEventData>) => {
    valueRef.current = e.nativeEvent.text ?? "";
  }, []);
  const handleBlur = useCallback(() => {
    onCommit(valueRef.current);
  }, [onCommit]);

  return (
    <TextInput
      ref={inputRef}
      testID={testID}
      defaultValue={initialValue}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      placeholderTextColor="#94A3B8"
      style={style}
      maxLength={maxLength}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : undefined}
    />
  );
}));

export function ReportHeaderConfigModal({ visible, onClose }: Props) {
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");
  const [slogan, setSlogan] = useState("");
  const [contacts, setContacts] = useState("");
  const [logoB64, setLogoB64] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // Imperative refs so we can flush the latest typed value on Save (in case user
  // taps Save without blurring the field first — common on iOS keyboard "Save" tap)
  const nameRef = useRef<StableInputHandle>(null);
  const sloganRef = useRef<StableInputHandle>(null);
  const contactsRef = useRef<StableInputHandle>(null);

  // v2.17 — Auto-load current values from user profile when the modal opens
  const reset = useCallback(() => {
    setName(user?.company_name || "");
    setSlogan((user as any)?.report_slogan || "");
    setContacts((user as any)?.report_contacts || "");
    setLogoB64(user?.company_logo_base64 || "");
  }, [user]);

  useEffect(() => { if (visible) reset(); }, [visible, reset]);

  const pickLogo = async () => {
    setLogoBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) setLogoB64(b64);
    } catch (e: any) {
      notify("Errore logo", e?.message || "");
    } finally { setLogoBusy(false); }
  };

  const clearLogo = async () => {
    const ok = await confirmAsync("Rimuovi logo", "Vuoi togliere il logo aziendale dall'intestazione?");
    if (!ok) return;
    setLogoB64("");
  };

  const save = async () => {
    setSaving(true);
    try {
      // Flush any un-blurred typing from all three inputs before persisting
      const latestName = (nameRef.current?.getValue() ?? name).trim().slice(0, 80);
      const latestSlogan = (sloganRef.current?.getValue() ?? slogan).trim().slice(0, 140);
      const latestContacts = (contactsRef.current?.getValue() ?? contacts).trim().slice(0, 240);
      await api("/auth/profile", {
        method: "PUT",
        body: {
          company_name: latestName,
          report_slogan: latestSlogan,
          report_contacts: latestContacts,
          company_logo_base64: logoB64,
        },
      });
      await refresh();
      notify("Intestazione salvata ✅", "I prossimi report useranno questa intestazione.");
      onClose();
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally { setSaving(false); }
  };

  const logoUri = logoB64 ? (logoB64.startsWith("data:") ? logoB64 : `data:image/png;base64,${logoB64}`) : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.back}>
        <View style={styles.card}>
          <View style={styles.hdr}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Configura intestazione</Text>
              <Text style={styles.sub}>Appare in cima ai report fatture e CTE comparativa.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} testID="rhc-close">
              <Ionicons name="close" size={22} color={theme.color.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 14 }}>
            {/* Live preview */}
            <View style={styles.preview}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {logoUri ? (
                  <Image source={{ uri: logoUri }} style={styles.previewLogo} resizeMode="contain" />
                ) : (
                  <View style={[styles.previewLogo, { backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="business" size={18} color={theme.color.brandPrimary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewName} numberOfLines={1}>{name || "Nome della tua azienda"}</Text>
                  {!!slogan && <Text style={styles.previewSlogan} numberOfLines={1}>{slogan}</Text>}
                </View>
              </View>
              {!!contacts && <Text style={styles.previewContacts} numberOfLines={3}>{contacts}</Text>}
            </View>

            <Text style={styles.lbl}>Logo aziendale</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="rhc-logo-pick" onPress={pickLogo} disabled={logoBusy} style={[styles.uploadBtn, { flex: 1 }]}>
                {logoBusy ? (
                  <ActivityIndicator color={theme.color.brandPrimary} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={16} color={theme.color.brandPrimary} />
                    <Text style={styles.uploadTxt}>{logoUri ? "Cambia logo" : "Carica logo"}</Text>
                  </>
                )}
              </Pressable>
              {logoUri && (
                <Pressable testID="rhc-logo-clear" onPress={clearLogo} style={[styles.uploadBtn, { flex: 0.6, borderColor: "#DC2626" }]}>
                  <Ionicons name="trash-outline" size={16} color="#DC2626" />
                  <Text style={[styles.uploadTxt, { color: "#DC2626" }]}>Rimuovi</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.lbl}>Nome azienda</Text>
            <StableTextInput
              ref={nameRef}
              testID="rhc-company-name"
              initialValue={name}
              onCommit={setName}
              resetKey={visible}
              placeholder="Es. Dal Pastro Energie"
              style={styles.input}
              maxLength={80}
            />

            <Text style={styles.lbl}>Slogan / Payoff (facoltativo)</Text>
            <StableTextInput
              ref={sloganRef}
              testID="rhc-slogan"
              initialValue={slogan}
              onCommit={setSlogan}
              resetKey={visible}
              placeholder="Es. Il tuo consulente energia di fiducia"
              style={styles.input}
              maxLength={140}
            />

            <Text style={styles.lbl}>Contatti (facoltativo)</Text>
            <StableTextInput
              ref={contactsRef}
              testID="rhc-contacts"
              initialValue={contacts}
              onCommit={setContacts}
              resetKey={visible}
              placeholder={"Tel. +39 333 1234567\ninfo@daltua.it\nwww.daltua.it"}
              style={[styles.input, { minHeight: 80 }]}
              multiline
              maxLength={240}
            />
            <Text style={styles.hint}>Puoi inserire più righe: telefono, email, sito, indirizzo studio…</Text>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: "#F1F5F9" }]}>
              <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
            </Pressable>
            <Pressable
              testID="rhc-save"
              onPress={save}
              disabled={saving}
              style={[styles.btn, { backgroundColor: theme.color.brandPrimary, flex: 2 }]}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={16} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "800", marginLeft: 6 }}>Salva intestazione</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "94%" },
  hdr: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  title: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  preview: {
    backgroundColor: "#FFF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.color.border,
    marginBottom: 4, borderBottomWidth: 3, borderBottomColor: theme.color.brandPrimary,
  },
  previewLogo: { width: 44, height: 44, borderRadius: 8 },
  previewName: { fontSize: 15, fontWeight: "800", color: "#1E3A5F" },
  previewSlogan: { fontSize: 11, color: theme.color.muted, marginTop: 2, fontStyle: "italic" },
  previewContacts: { fontSize: 11, color: theme.color.muted, marginTop: 8, lineHeight: 15 },
  lbl: { fontSize: 12, fontWeight: "700", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: theme.color.onSurface },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 4, fontStyle: "italic" },
  uploadBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderWidth: 2, borderStyle: "dashed", borderColor: theme.color.brandPrimary, borderRadius: 10, padding: 10 },
  uploadTxt: { fontWeight: "700", fontSize: 12, color: theme.color.brandPrimary },
  footer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row" },
});

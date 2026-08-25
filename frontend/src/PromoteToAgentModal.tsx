import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";

/**
 * V29 — Modal "Promuovi ad agente" (solo Master).
 * Converte il contatto in account collaboratore + Biglietto da Visita con QR
 * + invia email di benvenuto con credenziali via SMTP configurato.
 */

type Props = {
  visible: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  contactEmail?: string;
  onPromoted?: () => void;
};

type Result = {
  ok: boolean;
  user_id: string;
  email: string;
  name: string;
  password: string;
  areas: string[];
  business_card_id?: string;
  email_status: "queued" | "smtp_missing" | "skipped";
  email_error?: string | null;
};

const C = {
  primary: "#EA580C",
  primarySoft: "#FFF7ED",
  text: "#111820",
  muted: "#64748B",
  border: "#E5E7EB",
  bg: "#FFFFFF",
  navy: "#1B2B4B",
  danger: "#DC2626",
  ok: "#16A34A",
};

const AREA_OPTIONS: { id: "energy" | "network"; label: string; icon: any }[] = [
  { id: "energy", label: "Energia", icon: "flash" },
  { id: "network", label: "Network", icon: "people" },
];

export function PromoteToAgentModal({
  visible,
  onClose,
  contactId,
  contactName,
  contactEmail,
  onPromoted,
}: Props) {
  const router = useRouter();
  const [areas, setAreas] = useState<Array<"energy" | "network">>([
    "energy",
    "network",
  ]);
  const [sendEmail, setSendEmail] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "email" | "password" | "both">(null);

  const toggleArea = (a: "energy" | "network") => {
    setAreas((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };

  const confirm = useCallback(async () => {
    if (areas.length === 0) {
      setError("Seleziona almeno un'area operativa.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await api<Result>(`/contacts/${contactId}/promote-to-agent`, {
        method: "POST",
        body: { areas, send_welcome_email: sendEmail },
      });
      setResult(r);
      onPromoted?.();
    } catch (e: any) {
      setError(e?.message || "Errore durante la promozione");
    } finally {
      setLoading(false);
    }
  }, [contactId, areas, sendEmail, onPromoted]);

  const copyToClipboard = useCallback(async (what: "email" | "password" | "both") => {
    if (!result) return;
    let value = "";
    if (what === "email") value = result.email;
    else if (what === "password") value = result.password;
    else value = `Email: ${result.email}\nPassword: ${result.password}`;
    try {
      await Clipboard.setStringAsync(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch (e) {
      notify("Impossibile copiare", String(e));
    }
  }, [result]);

  const handleClose = () => {
    // Se abbiamo un risultato, avvertiamo il Master che la password non sarà più visibile
    setResult(null);
    setError(null);
    setCopied(null);
    onClose();
  };

  const openCard = () => {
    router.push("/business-card" as any);
    handleClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      testID="promote-agent-modal"
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grip} />
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {!result ? (
              <>
                <View style={styles.header}>
                  <View style={styles.hIcon}>
                    <Ionicons name="rocket" size={20} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Promuovi ad agente</Text>
                    <Text style={styles.subtitle}>Converti {contactName} in collaboratore</Text>
                  </View>
                </View>

                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color={C.muted} />
                  <Text style={styles.infoTxt}>
                    Verrà creato un account collaboratore con un Biglietto da Visita personalizzato con QR.
                    Le credenziali saranno inviate via email (se SMTP configurato) e mostrate a te una sola volta.
                  </Text>
                </View>

                <Text style={styles.label}>Aree operative</Text>
                <View style={styles.areasRow}>
                  {AREA_OPTIONS.map((a) => {
                    const active = areas.includes(a.id);
                    return (
                      <Pressable
                        key={a.id}
                        testID={`promote-area-${a.id}`}
                        onPress={() => toggleArea(a.id)}
                        style={[styles.areaPill, active && styles.areaPillActive]}
                      >
                        <Ionicons name={a.icon} size={16} color={active ? "#FFF" : C.primary} />
                        <Text style={[styles.areaPillTxt, active && { color: "#FFF" }]}>{a.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>Email di benvenuto</Text>
                <Pressable
                  testID="promote-toggle-email"
                  onPress={() => setSendEmail((v) => !v)}
                  style={[styles.toggleRow, sendEmail && styles.toggleRowActive]}
                >
                  <View style={[styles.checkbox, sendEmail && styles.checkboxOn]}>
                    {sendEmail && <Ionicons name="checkmark" size={14} color="#FFF" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleTxt}>Invia credenziali via email</Text>
                    <Text style={styles.toggleSub}>
                      {contactEmail ? `A: ${contactEmail}` : "Nessuna email nel contatto"}
                    </Text>
                  </View>
                </Pressable>

                {error ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={C.danger} />
                    <Text style={styles.errorTxt}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.actionsRow}>
                  <Pressable style={styles.btnGhost} onPress={handleClose} testID="promote-cancel">
                    <Text style={styles.btnGhostTxt}>Annulla</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btnPrimary, loading && { opacity: 0.7 }]}
                    onPress={confirm}
                    disabled={loading}
                    testID="promote-confirm"
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <>
                        <Ionicons name="rocket" size={16} color="#FFF" />
                        <Text style={styles.btnPrimaryTxt}>Promuovi</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.header}>
                  <View style={[styles.hIcon, { backgroundColor: "#DCFCE7" }]}>
                    <Ionicons name="checkmark" size={20} color={C.ok} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Account creato!</Text>
                    <Text style={styles.subtitle}>{result.name}</Text>
                  </View>
                </View>

                {result.email_status === "queued" ? (
                  <View style={styles.emailOkBox}>
                    <Ionicons name="mail" size={16} color={C.ok} />
                    <Text style={styles.emailOkTxt}>
                      Email di benvenuto inviata a {result.email}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.emailWarnBox}>
                    <Ionicons name="warning" size={16} color="#B45309" />
                    <Text style={styles.emailWarnTxt}>
                      {result.email_error || "Email non inviata: condividi manualmente le credenziali qui sotto."}
                    </Text>
                  </View>
                )}

                <Text style={styles.warnPassword}>
                  ⚠️ Le credenziali sono visibili UNA SOLA VOLTA. Copiale ora se necessario.
                </Text>

                <View style={styles.credBox}>
                  <View style={styles.credRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.credLabel}>Email</Text>
                      <Text style={styles.credVal} selectable>{result.email}</Text>
                    </View>
                    <Pressable style={styles.copyBtn} onPress={() => copyToClipboard("email")} testID="promote-copy-email">
                      <Ionicons name={copied === "email" ? "checkmark" : "copy-outline"} size={16} color={C.primary} />
                    </Pressable>
                  </View>
                  <View style={styles.credRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.credLabel}>Password</Text>
                      <Text style={[styles.credVal, styles.mono]} selectable>{result.password}</Text>
                    </View>
                    <Pressable style={styles.copyBtn} onPress={() => copyToClipboard("password")} testID="promote-copy-password">
                      <Ionicons name={copied === "password" ? "checkmark" : "copy-outline"} size={16} color={C.primary} />
                    </Pressable>
                  </View>
                  <Pressable style={styles.copyBothBtn} onPress={() => copyToClipboard("both")} testID="promote-copy-both">
                    <Ionicons name={copied === "both" ? "checkmark" : "copy"} size={14} color={C.primary} />
                    <Text style={styles.copyBothTxt}>{copied === "both" ? "Copiate!" : "Copia entrambe"}</Text>
                  </Pressable>
                </View>

                <View style={styles.doneRow}>
                  <Pressable style={styles.btnGhost} onPress={handleClose} testID="promote-done">
                    <Text style={styles.btnGhostTxt}>Chiudi</Text>
                  </Pressable>
                  <Pressable style={styles.btnPrimary} onPress={openCard} testID="promote-open-card">
                    <Ionicons name="qr-code" size={16} color="#FFF" />
                    <Text style={styles.btnPrimaryTxt}>Vai al biglietto</Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: "88%",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.2, shadowOffset: { width: 0, height: -4 }, shadowRadius: 12 },
      android: { elevation: 24 },
      default: {},
    } as any),
  },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  hIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.muted, marginTop: 2 },
  infoBox: {
    flexDirection: "row", gap: 8, padding: 12, backgroundColor: "#F8FAFC",
    borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "flex-start", marginBottom: 16,
  },
  infoTxt: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "800", color: C.navy, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  areasRow: { flexDirection: "row", gap: 8, marginBottom: 18, flexWrap: "wrap" },
  areaPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primary + "60",
  },
  areaPillActive: { backgroundColor: C.primary, borderColor: C.primary },
  areaPillTxt: { fontSize: 13, fontWeight: "700", color: C.primary },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: "#FBFCFD", marginBottom: 16,
  },
  toggleRowActive: { borderColor: C.primary + "60", backgroundColor: C.primarySoft },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: C.primary, borderColor: C.primary },
  toggleTxt: { fontSize: 14, fontWeight: "700", color: C.text },
  toggleSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  errorBox: {
    flexDirection: "row", gap: 8, padding: 10, backgroundColor: "#FEE2E2",
    borderRadius: 10, alignItems: "center", marginBottom: 12,
  },
  errorTxt: { flex: 1, fontSize: 13, color: C.danger, fontWeight: "600" },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  btnGhost: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" },
  btnGhostTxt: { fontSize: 14, fontWeight: "700", color: C.navy },
  btnPrimary: {
    flex: 1, flexDirection: "row", gap: 8, paddingVertical: 13, borderRadius: 12,
    alignItems: "center", justifyContent: "center", backgroundColor: C.primary,
  },
  btnPrimaryTxt: { fontSize: 14, fontWeight: "800", color: "#FFF" },

  emailOkBox: {
    flexDirection: "row", gap: 8, alignItems: "center", padding: 10,
    backgroundColor: "#DCFCE7", borderRadius: 10, marginBottom: 12,
  },
  emailOkTxt: { flex: 1, fontSize: 13, color: "#166534", fontWeight: "600" },
  emailWarnBox: {
    flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10,
    backgroundColor: "#FEF3C7", borderRadius: 10, marginBottom: 12,
  },
  emailWarnTxt: { flex: 1, fontSize: 12.5, color: "#92400E" },
  warnPassword: { fontSize: 12, color: C.danger, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  credBox: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    backgroundColor: "#F8FAFC", padding: 12, gap: 8, marginBottom: 16,
  },
  credRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  credLabel: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  credVal: { fontSize: 15, fontWeight: "700", color: C.text, marginTop: 2 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as any, letterSpacing: 0.5 },
  copyBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.primarySoft,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.primary + "40",
  },
  copyBothBtn: {
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    paddingVertical: 8, borderRadius: 10, backgroundColor: C.primarySoft,
    borderWidth: 1, borderColor: C.primary + "40", marginTop: 4,
  },
  copyBothTxt: { fontSize: 12.5, fontWeight: "800", color: C.primary },
  doneRow: { flexDirection: "row", gap: 10 },
});

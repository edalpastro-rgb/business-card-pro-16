import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";

import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
/**
 * V29.o — Master-only flow "Promuovi contatto ad agente".
 * 1. Search field per trovare il contatto (nome/email/codice)
 * 2. Selezione contatto
 * 3. Checklist di autorizzazioni (aree operative + toggle email + business card)
 * 4. Conferma → POST /contacts/{cid}/promote-to-agent
 * 5. Mostra credenziali provvisorie una-sola-volta con copy
 */

type ContactLite = {
  contact_id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  contact_code?: string;
  status?: string;
  linked_user_id?: string | null;
};

type Result = {
  ok: boolean;
  user_id: string;
  email: string;
  name: string;
  password: string;
  areas: string[];
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
  { id: "energy", label: "Area Energia", icon: "flash" },
  { id: "network", label: "Area Network", icon: "people" },
];

export function MasterPromoteModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"search" | "auth" | "result">("search");
  const bottomPad = useBottomSheetPadding();
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ContactLite | null>(null);
  const [areas, setAreas] = useState<Array<"energy" | "network">>(["energy", "network"]);
  const [sendEmail, setSendEmail] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const safeBottom = useSafeBottom(); // V29.aq
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<null | "email" | "password" | "both">(null);
  const [err, setErr] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api<{ items: ContactLite[] }>("/contacts");
      setContacts((r?.items || []).filter(c => c.status !== "collaborator" && !c.linked_user_id && c.email));
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (visible && step === "search" && contacts.length === 0) loadContacts();
  }, [visible, step, contacts.length, loadContacts]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return contacts.slice(0, 40);
    return contacts.filter((c) => {
      const hay = `${c.first_name || ""} ${c.last_name || ""} ${c.email || ""} ${c.contact_code || ""} ${c.phone || ""}`.toLowerCase();
      return hay.includes(s);
    }).slice(0, 60);
  }, [contacts, q]);

  const reset = () => {
    setStep("search"); setQ(""); setSelected(null); setAreas(["energy", "network"]);
    setSendEmail(true); setResult(null); setErr(null); setCopied(null);
  };
  const handleClose = () => { reset(); onClose(); };

  const toggleArea = (a: "energy" | "network") => {
    setAreas((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const doPromote = async () => {
    if (!selected) return;
    if (areas.length === 0) { setErr("Seleziona almeno un'area operativa."); return; }
    setErr(null); setConfirming(true);
    try {
      const r = await api<Result>(`/contacts/${selected.contact_id}/promote-to-agent`, {
        method: "POST",
        body: { areas, send_welcome_email: sendEmail },
      });
      setResult(r);
      setStep("result");
    } catch (e: any) {
      setErr(e?.message || "Errore durante la promozione");
    } finally { setConfirming(false); }
  };

  const copy = async (what: "email" | "password" | "both") => {
    if (!result) return;
    const v = what === "email" ? result.email
      : what === "password" ? result.password
      : `Email: ${result.email}\nPassword: ${result.password}`;
    try { await Clipboard.setStringAsync(v); setCopied(what); setTimeout(() => setCopied(null), 1500); }
    catch (e) { notify("Impossibile copiare", String(e)); }
  };

  const fullName = (c?: ContactLite | null) => c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose} testID="master-promote-modal">
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={[styles.sheet, { paddingBottom: safeBottom + 12 }, { paddingBottom: bottomPad }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grip} />
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* STEP: Search */}
            {step === "search" && (
              <>
                <View style={styles.header}>
                  <View style={styles.hIcon}><Ionicons name="rocket" size={20} color={C.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Promuovi ad agente</Text>
                    <Text style={styles.subtitle}>Cerca l'agente o collaboratore da promuovere</Text>
                  </View>
                </View>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={16} color={C.muted} />
                  <TextInput
                    testID="master-promote-search"
                    value={q}
                    onChangeText={setQ}
                    placeholder="Cerca per nome, email o codice…"
                    placeholderTextColor={C.muted}
                    style={styles.searchInput}
                    autoFocus
                  />
                  {q ? <Pressable onPress={() => setQ("")}><Ionicons name="close-circle" size={16} color={C.muted} /></Pressable> : null}
                </View>
                {loading ? (
                  <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
                ) : filtered.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="information-circle" size={18} color={C.muted} />
                    <Text style={styles.emptyTxt}>Nessun contatto disponibile per la promozione. Assicurati che abbia un'email valida.</Text>
                  </View>
                ) : (
                  filtered.map((c) => (
                    <Pressable
                      key={c.contact_id}
                      testID={`master-promote-item-${c.contact_id}`}
                      onPress={() => { setSelected(c); setStep("auth"); }}
                      style={styles.contactRow}
                    >
                      <View style={styles.avatar}><Text style={styles.avatarTxt}>{(c.first_name?.[0] || "?") + (c.last_name?.[0] || "")}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactName} numberOfLines={1}>{fullName(c) || "Contatto"}</Text>
                        <Text style={styles.contactMeta} numberOfLines={1}>{c.email || "—"}{c.contact_code ? ` · ${c.contact_code}` : ""}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={C.muted} />
                    </Pressable>
                  ))
                )}
              </>
            )}

            {/* STEP: Authorizations checklist */}
            {step === "auth" && selected && (
              <>
                <View style={styles.header}>
                  <Pressable onPress={() => setStep("search")} hitSlop={8} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={18} color={C.navy} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Autorizzazioni</Text>
                    <Text style={styles.subtitle}>{fullName(selected)} · {selected.email}</Text>
                  </View>
                </View>

                <Text style={styles.label}>Aree operative concesse</Text>
                {AREA_OPTIONS.map((a) => {
                  const active = areas.includes(a.id);
                  return (
                    <Pressable
                      key={a.id}
                      testID={`auth-area-${a.id}`}
                      onPress={() => toggleArea(a.id)}
                      style={[styles.checkRow, active && styles.checkRowActive]}
                    >
                      <View style={[styles.check, active && styles.checkOn]}>
                        {active && <Ionicons name="checkmark" size={14} color="#FFF" />}
                      </View>
                      <Ionicons name={a.icon} size={16} color={active ? C.primary : C.muted} />
                      <Text style={[styles.checkTxt, active && { color: C.text }]}>{a.label}</Text>
                    </Pressable>
                  );
                })}

                <Text style={[styles.label, { marginTop: 14 }]}>Opzioni onboarding</Text>
                <Pressable
                  testID="auth-send-email"
                  onPress={() => setSendEmail((v) => !v)}
                  style={[styles.checkRow, sendEmail && styles.checkRowActive]}
                >
                  <View style={[styles.check, sendEmail && styles.checkOn]}>
                    {sendEmail && <Ionicons name="checkmark" size={14} color="#FFF" />}
                  </View>
                  <Ionicons name="mail" size={16} color={sendEmail ? C.primary : C.muted} />
                  <Text style={[styles.checkTxt, sendEmail && { color: C.text }]}>Invia email di benvenuto con credenziali</Text>
                </Pressable>
                <View style={[styles.checkRow, { opacity: 0.7 }]}>
                  <View style={[styles.check, styles.checkOn]}><Ionicons name="checkmark" size={14} color="#FFF" /></View>
                  <Ionicons name="qr-code" size={16} color={C.primary} />
                  <Text style={styles.checkTxt}>Genera Biglietto da Visita con QR (automatico)</Text>
                </View>

                {err && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={14} color={C.danger} />
                    <Text style={styles.errorTxt}>{err}</Text>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <Pressable style={styles.btnGhost} onPress={() => setStep("search")} disabled={confirming}>
                    <Text style={styles.btnGhostTxt}>Indietro</Text>
                  </Pressable>
                  <Pressable
                    testID="auth-confirm"
                    style={[styles.btnPrimary, confirming && { opacity: 0.7 }]}
                    onPress={doPromote}
                    disabled={confirming}
                  >
                    {confirming ? <ActivityIndicator color="#FFF" /> : (
                      <>
                        <Ionicons name="rocket" size={16} color="#FFF" />
                        <Text style={styles.btnPrimaryTxt}>Conferma promozione</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            )}

            {/* STEP: Result */}
            {step === "result" && result && (
              <>
                <View style={styles.header}>
                  <View style={[styles.hIcon, { backgroundColor: "#DCFCE7" }]}>
                    <Ionicons name="checkmark" size={20} color={C.ok} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Account creato</Text>
                    <Text style={styles.subtitle}>{result.name}</Text>
                  </View>
                </View>
                {result.email_status === "queued" ? (
                  <View style={styles.emailOk}>
                    <Ionicons name="mail" size={16} color={C.ok} />
                    <Text style={styles.emailOkTxt}>Email di benvenuto inviata a {result.email}</Text>
                  </View>
                ) : (
                  <View style={styles.emailWarn}>
                    <Ionicons name="warning" size={16} color="#B45309" />
                    <Text style={styles.emailWarnTxt}>{result.email_error || "Email non inviata: condividi manualmente le credenziali."}</Text>
                  </View>
                )}
                <Text style={styles.warnPwd}>⚠️ Credenziali visibili UNA SOLA VOLTA. Copiale ora.</Text>
                <View style={styles.credBox}>
                  <View style={styles.credRow}>
                    <View style={{ flex: 1 }}><Text style={styles.credLabel}>Email</Text><Text style={styles.credVal} selectable>{result.email}</Text></View>
                    <Pressable style={styles.copyBtn} onPress={() => copy("email")}>
                      <Ionicons name={copied === "email" ? "checkmark" : "copy-outline"} size={16} color={C.primary} />
                    </Pressable>
                  </View>
                  <View style={styles.credRow}>
                    <View style={{ flex: 1 }}><Text style={styles.credLabel}>Password</Text><Text style={[styles.credVal, styles.mono]} selectable>{result.password}</Text></View>
                    <Pressable style={styles.copyBtn} onPress={() => copy("password")}>
                      <Ionicons name={copied === "password" ? "checkmark" : "copy-outline"} size={16} color={C.primary} />
                    </Pressable>
                  </View>
                  <Pressable style={styles.copyBoth} onPress={() => copy("both")}>
                    <Ionicons name={copied === "both" ? "checkmark" : "copy"} size={14} color={C.primary} />
                    <Text style={styles.copyBothTxt}>{copied === "both" ? "Copiate!" : "Copia entrambe"}</Text>
                  </Pressable>
                </View>
                <Pressable style={styles.btnPrimary} onPress={handleClose}>
                  <Text style={styles.btnPrimaryTxt}>Chiudi</Text>
                </Pressable>
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
    backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, maxHeight: "88%",
  },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  backBtn: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  hIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 14, padding: 0 },
  contactRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 6, backgroundColor: "#FBFCFD",
  },
  avatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: C.primary, fontWeight: "800", fontSize: 13 },
  contactName: { fontSize: 14, fontWeight: "700", color: C.text },
  contactMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  emptyBox: { flexDirection: "row", gap: 8, padding: 14, borderRadius: 10, backgroundColor: "#F8FAFC" },
  emptyTxt: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },

  label: { fontSize: 11, fontWeight: "800", color: C.navy, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  checkRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: "#FBFCFD", marginBottom: 6,
  },
  checkRowActive: { backgroundColor: C.primarySoft, borderColor: C.primary + "50" },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },
  checkTxt: { flex: 1, fontSize: 13.5, color: C.muted, fontWeight: "700" },
  errorBox: { flexDirection: "row", gap: 6, padding: 8, backgroundColor: "#FEE2E2", borderRadius: 8, marginTop: 8 },
  errorTxt: { flex: 1, fontSize: 12, color: C.danger, fontWeight: "600" },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnGhost: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" },
  btnGhostTxt: { fontSize: 14, fontWeight: "700", color: C.navy },
  btnPrimary: {
    flex: 1, flexDirection: "row", gap: 8, paddingVertical: 13, borderRadius: 12,
    alignItems: "center", justifyContent: "center", backgroundColor: C.primary, marginTop: 6,
  },
  btnPrimaryTxt: { fontSize: 14, fontWeight: "800", color: "#FFF" },

  emailOk: { flexDirection: "row", gap: 8, padding: 10, backgroundColor: "#DCFCE7", borderRadius: 10, marginBottom: 12, alignItems: "center" },
  emailOkTxt: { flex: 1, fontSize: 13, color: "#166534", fontWeight: "600" },
  emailWarn: { flexDirection: "row", gap: 8, padding: 10, backgroundColor: "#FEF3C7", borderRadius: 10, marginBottom: 12 },
  emailWarnTxt: { flex: 1, fontSize: 12.5, color: "#92400E" },
  warnPwd: { fontSize: 12, color: C.danger, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  credBox: { borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: "#F8FAFC", padding: 12, gap: 8, marginBottom: 16 },
  credRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  credLabel: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  credVal: { fontSize: 15, fontWeight: "700", color: C.text, marginTop: 2 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as any, letterSpacing: 0.5 },
  copyBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.primary + "40" },
  copyBoth: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primary + "40" },
  copyBothTxt: { fontSize: 12.5, fontWeight: "800", color: C.primary },
});

import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, TextInput, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { uriToBase64 } from "@/src/utils/media";
import { notify, confirmAsync } from "@/src/utils/notify";
import { DEFAULT_PARAMS, QuickBillType } from "@/src/BillsSection";
import { CalculatorFAB } from "@/src/CalculatorFAB";
import { BillFieldRow } from "@/src/BillFieldRenderers";

type Draft = {
  draft_id: string;
  bill_type: QuickBillType;
  pdf_name: string;
  status: "pending" | "analyzing" | "done" | "error" | "cancelled";
  error_message?: string | null;
  extracted?: Record<string, any> | null;
  label?: string | null;
  created_at: string;
  analyzed_at?: string | null;
  contact_id?: string | null;
};

type ContactLite = { contact_id: string; first_name: string; last_name: string; phone?: string; email?: string };

// V38P — subset used when picking a bill from the Master's own file cabinet
type MasterFileLite = { file_id: string; category: string; name: string; mime: string; size: number; created_at: string };

const SECTION_META: Record<QuickBillType, { label: string; color: string; icon: any; emoji: string }> = {
  luce: { label: "Luce", color: "#F59E0B", icon: "flash", emoji: "💡" },
  gas: { label: "Gas", color: "#DC2626", icon: "flame", emoji: "🔥" },
  telco: { label: "Telco", color: "#0891B2", icon: "call", emoji: "📞" },
};

const STATUS_META = {
  pending: { label: "In coda…", color: "#6B7280", icon: "hourglass-outline" as const },
  analyzing: { label: "Analisi in corso…", color: "#0891B2", icon: "sync" as const },
  done: { label: "Analizzata", color: "#16A34A", icon: "checkmark-circle" as const },
  error: { label: "Errore", color: "#DC2626", icon: "warning" as const },
  cancelled: { label: "Annullata", color: "#78716C", icon: "close-circle" as const },
};

export default function BillQuickScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<QuickBillType | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pendingUpload, setPendingUpload] = useState<null | { bill_type: QuickBillType; asset: { name?: string; mimeType?: string; uri: string } }>(null);
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set());
  const [customParam, setCustomParam] = useState("");
  const [customParams, setCustomParams] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  // V38U — Verifica agevolazioni fiscali (fiscal-check config for this analysis)
  const [fiscalCheck, setFiscalCheck] = useState<{
    verify_iva: null | 10 | 22;          // null = disabled, 10 or 22 = expected value
    verify_accise_gas: boolean;          // default true for gas bills
    verify_pcv_annullato: boolean;       // default false; only for luce
  }>({ verify_iva: null, verify_accise_gas: true, verify_pcv_annullato: false });

  const [associateTarget, setAssociateTarget] = useState<null | Draft>(null);
  const [contactsList, setContactsList] = useState<ContactLite[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // V38P — Source picker: "Dispositivo" vs "File Master" before Document Picker
  const [sourcePickerFor, setSourcePickerFor] = useState<null | QuickBillType>(null);
  const [masterFilePicker, setMasterFilePicker] = useState<null | QuickBillType>(null);
  const [masterFiles, setMasterFiles] = useState<MasterFileLite[]>([]);
  const [loadingMasterFiles, setLoadingMasterFiles] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Draft[] }>("/bill-drafts");
      setDrafts(r.items || []);
    } catch (e: any) {
      console.warn("drafts load err", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while any draft is pending/analyzing
  useEffect(() => {
    const active = drafts.some((d) => d.status === "pending" || d.status === "analyzing");
    if (!active) return;
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [drafts, load]);

  const openParamsModal = (bill_type: QuickBillType, asset: any) => {
    const defs = DEFAULT_PARAMS[bill_type];
    const on = new Set<string>();
    defs.forEach((p) => { if (p.defaultOn) on.add(p.id); });
    setSelectedParams(on);
    setCustomParams([]);
    setCustomParam("");
    setLabelInput("");
    setPendingUpload({ bill_type, asset });
  };

  const uploadPdf = async (bill_type: QuickBillType) => {
    // V38P — show source picker (Device vs Master files) instead of jumping
    // straight into the DocumentPicker.
    setSourcePickerFor(bill_type);
  };

  const pickFromDevice = async () => {
    if (!sourcePickerFor) return;
    const bill_type = sourcePickerFor;
    setSourcePickerFor(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      openParamsModal(bill_type, res.assets[0]);
    } catch (e: any) {
      notify("Errore selezione", e?.message || "");
    }
  };

  const openMasterFilePicker = async () => {
    if (!sourcePickerFor) return;
    const bill_type = sourcePickerFor;
    setSourcePickerFor(null);
    setMasterFilePicker(bill_type);
    setLoadingMasterFiles(true);
    try {
      // Prefer bills category first, then any PDF from generic files
      const [bills, files] = await Promise.all([
        api<{ items: MasterFileLite[] }>("/master-files?category=bills"),
        api<{ items: MasterFileLite[] }>("/master-files?category=files"),
      ]);
      const combined: MasterFileLite[] = [];
      (bills.items || []).forEach((i) => combined.push(i));
      (files.items || []).filter((i) => (i.mime || "").includes("pdf") || i.name.toLowerCase().endsWith(".pdf")).forEach((i) => combined.push(i));
      setMasterFiles(combined);
    } catch (e: any) {
      notify("Errore caricamento file", e?.message || "");
    } finally { setLoadingMasterFiles(false); }
  };

  const pickFromMaster = async (mf: MasterFileLite) => {
    if (!masterFilePicker) return;
    const bill_type = masterFilePicker;
    setMasterFilePicker(null);
    try {
      // Fetch the file base64
      const full = await api<{ data_base64: string; name: string; mime: string; size: number }>(`/master-files/${mf.file_id}`);
      if (!full?.data_base64) { notify("File vuoto", ""); return; }
      // Pipe into params flow using a synthetic asset with data-URL uri
      const dataUri = `data:${full.mime || "application/pdf"};base64,${full.data_base64}`;
      openParamsModal(bill_type, { name: full.name || mf.name, mimeType: full.mime || "application/pdf", uri: dataUri });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const confirmUploadWithParams = async () => {
    if (!pendingUpload) return;
    const { bill_type, asset } = pendingUpload;
    try {
      setUploading(bill_type);
      setPendingUpload(null);
      const b64 = await uriToBase64(asset.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 12 * 1024 * 1024) { notify("PDF troppo grande", "Max 12 MB."); setUploading(null); return; }
      const paramLabels: string[] = [];
      const defs = DEFAULT_PARAMS[bill_type];
      for (const p of defs) if (selectedParams.has(p.id)) paramLabels.push(p.label);
      for (const cp of customParams) paramLabels.push(cp);
      // V38U — Fiscal-check verification directives appended to the analysis
      // params so the LLM knows what to compare and flag.
      const fc = fiscalCheck;
      if (fc.verify_iva !== null) paramLabels.push(`__verifica_iva__=${fc.verify_iva}`);
      if (bill_type === "gas" && fc.verify_accise_gas) paramLabels.push("__verifica_accise_gas__=0.012498");
      if (bill_type === "luce" && fc.verify_pcv_annullato) paramLabels.push("__verifica_pcv_annullato__=1");
      await api("/bill-drafts", {
        method: "POST",
        body: {
          bill_type,
          pdf_base64: b64,
          pdf_name: asset.name || `fattura-${bill_type}.pdf`,
          pdf_mime: asset.mimeType || "application/pdf",
          analysis_params: paramLabels,
          label: labelInput.trim() || undefined,
        },
      });
      await load();
    } catch (e: any) {
      notify("Errore caricamento", e?.message || "");
    } finally { setUploading(null); }
  };

  const deleteDraft = async (draft_id: string) => {
    const ok = await confirmAsync("Elimina bozza", "Vuoi eliminare questa bozza di analisi?");
    if (!ok) return;
    try {
      await api(`/bill-drafts/${draft_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const reanalyze = async (draft_id: string) => {
    try {
      await api(`/bill-drafts/${draft_id}/reanalyze`, { method: "POST" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const openAssociate = async (d: Draft) => {
    setAssociateTarget(d);
    if (contactsList.length === 0) {
      try {
        const r = await api<{ items: ContactLite[] }>("/contacts");
        setContactsList(r.items || []);
      } catch {}
    }
  };

  const doAssociate = async (contact_id: string) => {
    if (!associateTarget) return;
    setBusyAction("associate");
    try {
      const r = await api<{ contact_id: string; bill_id: string }>(`/bill-drafts/${associateTarget.draft_id}/associate`, {
        method: "POST",
        body: { contact_id },
      });
      setAssociateTarget(null);
      await load();
      notify("Bolletta associata ✅", "La fattura è stata spostata sulla scheda del cliente.");
      // Deep-link to the contact's bill tab
      router.push(`/contact/${r.contact_id}?tab=bills` as any);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setBusyAction(null); }
  };

  const createContactFromDraft = async (d: Draft) => {
    const ok = await confirmAsync("Crea cliente", `Vuoi creare un nuovo cliente usando i dati estratti dalla bolletta ${SECTION_META[d.bill_type].label}?`);
    if (!ok) return;
    setBusyAction(`create-${d.draft_id}`);
    try {
      const r = await api<{ contact_id: string; bill_id: string }>(`/bill-drafts/${d.draft_id}/create-contact`, { method: "POST" });
      await load();
      notify("Cliente creato ✅", "Il nuovo cliente è stato creato e la bolletta associata.");
      router.push(`/contact/${r.contact_id}` as any);
    } catch (e: any) {
      notify("Impossibile creare cliente", e?.message || "");
    } finally { setBusyAction(null); }
  };

  const filteredContacts = (() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contactsList;
    return contactsList.filter((c) => {
      const nm = `${c.first_name} ${c.last_name}`.toLowerCase();
      return nm.includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q);
    });
  })();

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Analizza bolletta</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.introCard}>
          <Ionicons name="sparkles" size={22} color="#EA580C" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.introTitle}>Analisi bolletta senza cliente registrato</Text>
            <Text style={styles.introTxt}>Carica il PDF di una bolletta (Luce, Gas o Telco) per estrarre i dati con AI. Potrai salvarla come bozza, associarla a un cliente esistente, o creare un nuovo cliente dai dati estratti.</Text>
          </View>
        </View>

        <Text style={styles.sectionH}>Nuova analisi</Text>
        <View style={styles.uploadRow}>
          {(["luce", "gas", "telco"] as QuickBillType[]).map((bt) => {
            const meta = SECTION_META[bt];
            return (
              <Pressable
                key={bt}
                testID={`quick-upload-${bt}`}
                onPress={() => uploadPdf(bt)}
                disabled={uploading === bt}
                style={[styles.uploadBtn, { borderColor: meta.color }]}
              >
                {uploading === bt ? (
                  <ActivityIndicator color={meta.color} />
                ) : (
                  <>
                    <Text style={{ fontSize: 22 }}>{meta.emoji}</Text>
                    <Text style={[styles.uploadTxt, { color: meta.color }]}>{meta.label}</Text>
                  </>
                )}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionH}>Bozze ({drafts.length})</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
        ) : drafts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="documents-outline" size={40} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessuna bozza. Carica una bolletta qui sopra per iniziare.</Text>
          </View>
        ) : (
          drafts.map((d) => {
            const meta = SECTION_META[d.bill_type];
            const stMeta = STATUS_META[d.status] || STATUS_META.pending;
            const isExp = !!expanded[d.draft_id];
            const ext = d.extracted || {};
            return (
              <View key={d.draft_id} style={[styles.card, { borderColor: meta.color }]} testID={`draft-card-${d.draft_id}`}>
                <Pressable onPress={() => setExpanded((e) => ({ ...e, [d.draft_id]: !e[d.draft_id] }))} style={styles.cardHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Text style={{ fontSize: 20 }}>{meta.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{d.label || d.pdf_name}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Ionicons name={stMeta.icon} size={12} color={stMeta.color} />
                        <Text style={[styles.cardStatus, { color: stMeta.color }]}>{stMeta.label}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Pressable
                      testID={`draft-delete-${d.draft_id}`}
                      onPress={() => deleteDraft(d.draft_id)}
                      hitSlop={8}
                      style={styles.iconBtn}
                    >
                      <Ionicons name="trash" size={16} color="#DC2626" />
                    </Pressable>
                    <Ionicons name={isExp ? "chevron-up" : "chevron-down"} size={20} color={theme.color.muted} />
                  </View>
                </Pressable>
                {isExp && (
                  <View style={styles.cardBody}>
                    {d.status === "error" && d.error_message ? (
                      <View style={styles.errorBox}>
                        <Ionicons name="warning" size={16} color="#DC2626" />
                        <Text style={styles.errorTxt}>{d.error_message}</Text>
                      </View>
                    ) : null}
                    {d.status === "done" && Object.keys(ext).length > 0 && (
                      <View style={{ gap: 6 }}>
                        {Object.entries(ext).map(([k, v]) => (
                          <BillFieldRow key={k} name={k} value={v} accent={meta.color} />
                        ))}
                      </View>
                    )}
                    <View style={styles.actionsRow}>
                      {(d.status === "error" || d.status === "cancelled") && (
                        <Pressable
                          testID={`draft-reanalyze-${d.draft_id}`}
                          onPress={() => reanalyze(d.draft_id)}
                          style={[styles.actionBtn, { backgroundColor: "#F1F5F9", borderColor: theme.color.border }]}
                        >
                          <Ionicons name="refresh" size={14} color={theme.color.brandPrimary} />
                          <Text style={[styles.actionTxt, { color: theme.color.brandPrimary }]}>Riprova</Text>
                        </Pressable>
                      )}
                      {d.status === "done" && (
                        <>
                          <Pressable
                            testID={`draft-associate-${d.draft_id}`}
                            onPress={() => openAssociate(d)}
                            style={[styles.actionBtn, { backgroundColor: theme.color.brandPrimary }]}
                          >
                            <Ionicons name="link" size={14} color="#FFF" />
                            <Text style={[styles.actionTxt, { color: "#FFF" }]}>Associa a cliente</Text>
                          </Pressable>
                          <Pressable
                            testID={`draft-create-contact-${d.draft_id}`}
                            onPress={() => createContactFromDraft(d)}
                            disabled={busyAction === `create-${d.draft_id}`}
                            style={[styles.actionBtn, { backgroundColor: "#16A34A" }]}
                          >
                            {busyAction === `create-${d.draft_id}` ? (
                              <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                              <Ionicons name="person-add" size={14} color="#FFF" />
                            )}
                            <Text style={[styles.actionTxt, { color: "#FFF" }]}>Crea cliente</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Params modal */}
      <Modal visible={!!pendingUpload} animationType="slide" transparent onRequestClose={() => setPendingUpload(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Configura analisi AI</Text>
            <Text style={styles.modalSub}>Scegli i parametri che vuoi estrarre. Puoi aggiungerne di personalizzati.</Text>
            {pendingUpload && (
              <ScrollView style={{ maxHeight: 380, marginVertical: 12 }}>
                <TextInput
                  testID="quick-label-input"
                  value={labelInput}
                  onChangeText={setLabelInput}
                  placeholder="Etichetta (facoltativa, es. 'Prospect Via Roma')"
                  placeholderTextColor="#94A3B8"
                  style={styles.labelInput}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {DEFAULT_PARAMS[pendingUpload.bill_type].map((p) => {
                    const on = selectedParams.has(p.id);
                    return (
                      <Pressable
                        key={p.id}
                        testID={`quick-param-${p.id}`}
                        onPress={() => {
                          setSelectedParams((prev) => {
                            const nx = new Set(prev);
                            if (nx.has(p.id)) nx.delete(p.id); else nx.add(p.id);
                            return nx;
                          });
                        }}
                        style={[styles.paramPill, on && { backgroundColor: SECTION_META[pendingUpload.bill_type].color, borderColor: SECTION_META[pendingUpload.bill_type].color }]}
                      >
                        {on && <Ionicons name="checkmark" size={12} color="#FFF" />}
                        <Text style={[styles.paramTxt, on && { color: "#FFF" }]}>{p.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.modalSub, { marginTop: 12 }]}>Parametri personalizzati</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  <TextInput
                    testID="quick-custom-param-input"
                    value={customParam}
                    onChangeText={setCustomParam}
                    placeholder="Es. Sconto giovani, Bonus fedeltà…"
                    placeholderTextColor="#94A3B8"
                    style={[styles.labelInput, { flex: 1 }]}
                  />
                  <Pressable
                    testID="quick-add-custom-btn"
                    onPress={() => {
                      const t = customParam.trim();
                      if (!t) return;
                      setCustomParams((p) => [...p, t]);
                      setCustomParam("");
                    }}
                    style={{ backgroundColor: theme.color.brandPrimary, paddingHorizontal: 14, borderRadius: 8, justifyContent: "center" }}
                  >
                    <Text style={{ color: "#FFF", fontWeight: "700" }}>+</Text>
                  </Pressable>
                </View>
                {customParams.length > 0 && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {customParams.map((cp, idx) => (
                      <Pressable
                        key={`${cp}-${idx}`}
                        onPress={() => setCustomParams((p) => p.filter((_, i) => i !== idx))}
                        style={[styles.paramPill, { backgroundColor: "#FEF3C7", borderColor: "#B45309" }]}
                      >
                        <Text style={[styles.paramTxt, { color: "#B45309" }]}>{cp}</Text>
                        <Ionicons name="close" size={12} color="#B45309" />
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* V38U — Verifica agevolazioni fiscali */}
                <View style={styles.fiscalBox}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Ionicons name="shield-checkmark" size={16} color="#059669" />
                    <Text style={styles.fiscalTitle}>Verifica agevolazioni fiscali</Text>
                  </View>
                  <Text style={styles.fiscalHint}>Neo evidenzierà in rosso le righe non conformi e calcolerà lo scostamento su 12 mesi.</Text>

                  {/* IVA — luce + gas */}
                  <Text style={styles.fiscalLbl}>IVA prevista</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                    {[10, 22].map((v) => {
                      const active = fiscalCheck.verify_iva === v;
                      return (
                        <Pressable
                          key={v}
                          testID={`fiscal-iva-${v}`}
                          onPress={() => setFiscalCheck((s) => ({ ...s, verify_iva: active ? null : (v as 10 | 22) }))}
                          style={[styles.fiscalOpt, active && { backgroundColor: "#059669", borderColor: "#059669" }]}
                        >
                          <Ionicons name={active ? "checkbox" : "square-outline"} size={14} color={active ? "#FFF" : "#059669"} />
                          <Text style={[styles.fiscalOptTxt, active && { color: "#FFF" }]}>IVA {v}%</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Accise agevolate — solo gas */}
                  {pendingUpload.bill_type === "gas" && (
                    <>
                      <Text style={styles.fiscalLbl}>Accise gas</Text>
                      <Pressable
                        testID="fiscal-accise-gas"
                        onPress={() => setFiscalCheck((s) => ({ ...s, verify_accise_gas: !s.verify_accise_gas }))}
                        style={[styles.fiscalOpt, fiscalCheck.verify_accise_gas && { backgroundColor: "#059669", borderColor: "#059669" }]}
                      >
                        <Ionicons name={fiscalCheck.verify_accise_gas ? "checkbox" : "square-outline"} size={14} color={fiscalCheck.verify_accise_gas ? "#FFF" : "#059669"} />
                        <Text style={[styles.fiscalOptTxt, fiscalCheck.verify_accise_gas && { color: "#FFF" }]}>Accise agevolate 0,012498 €/Smc</Text>
                      </Pressable>
                    </>
                  )}

                  {/* PCV — solo luce */}
                  {pendingUpload.bill_type === "luce" && (
                    <>
                      <Text style={styles.fiscalLbl}>PCV / Costi fissi</Text>
                      <Pressable
                        testID="fiscal-pcv"
                        onPress={() => setFiscalCheck((s) => ({ ...s, verify_pcv_annullato: !s.verify_pcv_annullato }))}
                        style={[styles.fiscalOpt, fiscalCheck.verify_pcv_annullato && { backgroundColor: "#059669", borderColor: "#059669" }]}
                      >
                        <Ionicons name={fiscalCheck.verify_pcv_annullato ? "checkbox" : "square-outline"} size={14} color={fiscalCheck.verify_pcv_annullato ? "#FFF" : "#059669"} />
                        <Text style={[styles.fiscalOptTxt, fiscalCheck.verify_pcv_annullato && { color: "#FFF" }]}>PCV annullato nel contratto</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </ScrollView>
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                testID="quick-cancel-btn"
                onPress={() => setPendingUpload(null)}
                style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}
              >
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="quick-confirm-btn"
                onPress={confirmUploadWithParams}
                disabled={selectedParams.size === 0 && customParams.length === 0}
                style={[styles.modalBtn, { backgroundColor: "#EA580C", opacity: (selectedParams.size === 0 && customParams.length === 0) ? 0.5 : 1 }]}
              >
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Avvia analisi AI</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Associate contact modal */}
      <Modal visible={!!associateTarget} animationType="slide" transparent onRequestClose={() => setAssociateTarget(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Associa a un cliente</Text>
            <Text style={styles.modalSub}>Seleziona il cliente a cui associare questa bolletta.</Text>
            <TextInput
              testID="quick-assoc-search"
              value={contactSearch}
              onChangeText={setContactSearch}
              placeholder="Cerca per nome, telefono o email…"
              placeholderTextColor="#94A3B8"
              style={[styles.labelInput, { marginTop: 10 }]}
            />
            <ScrollView style={{ maxHeight: 340, marginVertical: 10 }}>
              {filteredContacts.length === 0 && (
                <Text style={{ color: theme.color.muted, textAlign: "center", padding: 16, fontStyle: "italic" }}>
                  Nessun cliente trovato.
                </Text>
              )}
              {filteredContacts.map((c) => (
                <Pressable
                  key={c.contact_id}
                  testID={`quick-assoc-pick-${c.contact_id}`}
                  onPress={() => doAssociate(c.contact_id)}
                  disabled={busyAction === "associate"}
                  style={styles.assocRow}
                >
                  <View style={styles.assocAvatar}>
                    <Text style={{ color: theme.color.brandPrimary, fontWeight: "800" }}>{(c.first_name?.[0] || "?").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assocName} numberOfLines={1}>{`${c.first_name} ${c.last_name}`.trim() || "(senza nome)"}</Text>
                    <Text style={styles.assocSub} numberOfLines={1}>{c.phone || c.email || ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              testID="quick-assoc-cancel"
              onPress={() => setAssociateTarget(null)}
              style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}
            >
              <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Chiudi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* V38O — Always-visible calculator FAB */}
      <CalculatorFAB />

      {/* V38P — Source picker: Dispositivo vs File Master */}
      <Modal visible={!!sourcePickerFor} animationType="fade" transparent onRequestClose={() => setSourcePickerFor(null)}>
        <Pressable style={styles.modalBack} onPress={() => setSourcePickerFor(null)}>
          <Pressable style={[styles.modalCard, { padding: 20 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Da dove vuoi caricare?</Text>
            <Text style={styles.modalSub}>Puoi scegliere un PDF dal dispositivo oppure una fattura già salvata nei tuoi file Master.</Text>
            <View style={{ gap: 8, marginTop: 14 }}>
              <Pressable testID="bq-src-device" onPress={pickFromDevice} style={[styles.srcBtn, { backgroundColor: "#EA580C" }]}>
                <Ionicons name="cloud-upload" size={18} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.srcTitle}>Da dispositivo</Text>
                  <Text style={styles.srcSub}>Scegli un PDF dal telefono</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#FFF" />
              </Pressable>
              <Pressable testID="bq-src-master" onPress={openMasterFilePicker} style={[styles.srcBtn, { backgroundColor: "#0891B2" }]}>
                <Ionicons name="folder-open" size={18} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.srcTitle}>Dai file Master</Text>
                  <Text style={styles.srcSub}>Scegli da &lsquo;I miei file&rsquo; (Fatture / File)</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#FFF" />
              </Pressable>
              <Pressable onPress={() => setSourcePickerFor(null)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, marginTop: 6 }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* V38P — Master file picker (list of PDFs already saved in the Master cabinet) */}
      <Modal visible={!!masterFilePicker} animationType="slide" transparent onRequestClose={() => setMasterFilePicker(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Scegli fattura dai file Master</Text>
            <Text style={styles.modalSub}>Sono elencati i PDF salvati nelle sezioni Fatture e File del Master.</Text>
            <ScrollView style={{ maxHeight: 380, marginTop: 12 }}>
              {loadingMasterFiles ? (
                <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
              ) : masterFiles.length === 0 ? (
                <Text style={{ color: theme.color.muted, textAlign: "center", padding: 20, fontStyle: "italic" }}>
                  Nessun PDF salvato. Aggiungi fatture in &lsquo;I miei file&rsquo;.
                </Text>
              ) : (
                masterFiles.map((mf) => (
                  <Pressable
                    key={mf.file_id}
                    testID={`bq-master-pick-${mf.file_id}`}
                    onPress={() => pickFromMaster(mf)}
                    style={styles.assocRow}
                  >
                    <View style={[styles.assocAvatar, { backgroundColor: "#FED7AA" }]}>
                      <Ionicons name="document" size={18} color="#EA580C" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assocName} numberOfLines={1}>{mf.name}</Text>
                      <Text style={styles.assocSub} numberOfLines={1}>
                        {(mf.size / 1024).toFixed(0)} KB · {new Date(mf.created_at).toLocaleDateString("it-IT")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable onPress={() => setMasterFilePicker(null)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, marginTop: 8 }]}>
              <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Chiudi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  introCard: { flexDirection: "row", backgroundColor: "#FFF7ED", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FED7AA", marginBottom: 16 },
  introTitle: { fontSize: 14, fontWeight: "800", color: "#9A3412" },
  introTxt: { fontSize: 12, color: "#9A3412", marginTop: 4, lineHeight: 17 },
  sectionH: { fontSize: 13, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6, marginBottom: 8 },
  uploadRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  uploadBtn: { flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", paddingVertical: 16, borderRadius: 12, borderWidth: 2, backgroundColor: theme.color.surface, gap: 6, borderStyle: "dashed" },
  uploadTxt: { fontWeight: "800", fontSize: 13 },
  emptyCard: { alignItems: "center", padding: 30, backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, borderStyle: "dashed" },
  emptyTxt: { color: theme.color.muted, fontSize: 13, textAlign: "center", marginTop: 10, maxWidth: 300 },
  card: { backgroundColor: theme.color.surface, borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  cardStatus: { fontSize: 11, fontWeight: "600" },
  iconBtn: { padding: 6, borderRadius: 6 },
  cardBody: { padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border, gap: 8 },
  kvRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.border },
  kvKey: { flex: 1, fontSize: 12, fontWeight: "600", color: theme.color.muted },
  kvVal: { flex: 2, fontSize: 12, color: theme.color.onSurface },
  blockRow: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.border },
  blockLabel: { fontSize: 12, fontWeight: "700", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  paramSubBox: { gap: 3, backgroundColor: "#F8FAFC", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: theme.color.border },
  paramSubRow: { flexDirection: "row", paddingVertical: 3 },
  paramSubKey: { flex: 1, fontSize: 11, fontWeight: "600", color: theme.color.muted },
  paramSubVal: { flex: 2, fontSize: 12, color: theme.color.onSurface },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingRight: 4 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletTxt: { flex: 1, fontSize: 12, lineHeight: 17, color: theme.color.onSurface },
  chartWrap: { marginTop: 4, backgroundColor: "#F8FAFC", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: theme.color.border },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  chartTotal: { fontSize: 11, fontWeight: "700", color: theme.color.onSurface },
  chartMax: { fontSize: 10, color: theme.color.muted },
  barCol: { alignItems: "center", marginHorizontal: 3, width: 34 },
  barValue: { fontSize: 9, color: theme.color.muted, marginBottom: 2, minHeight: 12 },
  barTrack: { width: 26, height: 120, backgroundColor: "#E2E8F0", borderRadius: 4, justifyContent: "flex-end", overflow: "hidden" },
  barFill: { width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { fontSize: 10, color: theme.color.muted, marginTop: 3, fontWeight: "600" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#FEE2E2", borderRadius: 8 },
  errorTxt: { flex: 1, fontSize: 12, color: "#991B1B" },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  actionTxt: { fontSize: 12, fontWeight: "700" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  modalSub: { fontSize: 12, color: theme.color.muted, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  labelInput: { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: theme.color.onSurface },
  paramPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  // V38U — Fiscal check styles
  fiscalBox: { marginTop: 16, padding: 12, borderRadius: 10, backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" },
  fiscalTitle: { fontSize: 13, fontWeight: "800", color: "#065F46" },
  fiscalHint: { fontSize: 11, color: "#047857", marginBottom: 8, lineHeight: 15 },
  fiscalLbl: { fontSize: 11, fontWeight: "700", color: "#065F46", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 10 },
  fiscalOpt: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: "#059669", backgroundColor: "#FFF", marginTop: 4, alignSelf: "flex-start" },
  fiscalOptTxt: { fontSize: 12, fontWeight: "700", color: "#065F46" },
  paramTxt: { fontSize: 12, fontWeight: "600", color: theme.color.onSurface },
  assocRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, gap: 10, marginBottom: 6 },
  assocAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.color.brandTertiary, justifyContent: "center", alignItems: "center" },
  assocName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  assocSub: { fontSize: 11, color: theme.color.muted },
  srcBtn: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10 },
  srcTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  srcSub: { color: "#FFFFFFCC", fontSize: 11, marginTop: 2 },
});

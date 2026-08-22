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
import { ModuleErrorBoundary } from "@/src/shared";
import { BillFieldRow } from "@/src/BillFieldRenderers";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { ReportHeaderConfigModal } from "@/src/ReportHeaderConfigModal";

// ---------- Types ----------

type BillType = QuickBillType;

type Draft = {
  draft_id: string;
  bill_type: BillType;
  pdf_name: string;
  status: "pending" | "analyzing" | "done" | "error" | "cancelled";
  error_message?: string | null;
  extracted?: Record<string, any> | null;
  analysis_params?: string[] | null;
  label?: string | null;
  created_at: string;
  analyzed_at?: string | null;
  contact_id?: string | null;
};

type Offer = {
  offer_id: string;
  bill_type: BillType;
  label: string;
  pdf_name: string;
  status: "pending" | "analyzing" | "done" | "error";
  error_message?: string | null;
  extracted?: Record<string, any> | null;
  created_at: string;
};

type ContactLite = { contact_id: string; first_name: string; last_name: string; phone?: string; email?: string };
type MasterFileLite = { file_id: string; category: string; name: string; mime: string; size: number; created_at: string };

const SECTION_META: Record<BillType, { label: string; icon: any; color: string; emoji: string }> = {
  luce: { label: "Luce", icon: "flash", color: "#F59E0B", emoji: "💡" },
  gas: { label: "Gas", icon: "flame", color: "#DC2626", emoji: "🔥" },
  telco: { label: "Telco", icon: "call", color: "#0891B2", emoji: "📞" },
};

const STATUS_META = {
  pending: { label: "In coda…", color: "#6B7280", icon: "hourglass-outline" as const },
  analyzing: { label: "Analisi in corso…", color: "#0891B2", icon: "sync" as const },
  done: { label: "Analizzata", color: "#16A34A", icon: "checkmark-circle" as const },
  error: { label: "Errore", color: "#DC2626", icon: "warning" as const },
  cancelled: { label: "Annullata", color: "#78716C", icon: "close-circle" as const },
};

function humanKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

// ---------- Route ----------

export default function BillQuickRoute() {
  return (
    <ModuleErrorBoundary moduleName="invoice-analysis">
      <BillQuickScreen />
    </ModuleErrorBoundary>
  );
}

function BillQuickScreen() {
  const router = useRouter();

  // Data
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload
  const [uploading, setUploading] = useState<BillType | null>(null);
  const [uploadingOffer, setUploadingOffer] = useState<BillType | null>(null);

  // Company Offers (mirror of BillsSection)
  const [showOffers, setShowOffers] = useState(false);
  const [manualTxt, setManualTxt] = useState<Record<BillType, string>>({ luce: "", gas: "", telco: "" });
  const [savingManual, setSavingManual] = useState<BillType | null>(null);

  // Expand/collapse drafts
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Params modal
  const [pendingUpload, setPendingUpload] = useState<null | { bill_type: BillType; asset: { name?: string; mimeType?: string; uri: string } }>(null);
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set());
  const [customParam, setCustomParam] = useState("");
  const [customParams, setCustomParams] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  // Fiscal check (kept — master-side bonus feature)
  const [fiscalCheck, setFiscalCheck] = useState<{
    verify_iva: null | 10 | 22;
    verify_accise_gas: boolean;
    verify_pcv_annullato: boolean;
  }>({ verify_iva: null, verify_accise_gas: true, verify_pcv_annullato: false });

  // Associate modal
  const [associateTarget, setAssociateTarget] = useState<null | Draft>(null);
  const [contactsList, setContactsList] = useState<ContactLite[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Source picker
  const [sourcePickerFor, setSourcePickerFor] = useState<null | BillType>(null);
  const [masterFilePicker, setMasterFilePicker] = useState<null | BillType>(null);
  const [masterFiles, setMasterFiles] = useState<MasterFileLite[]>([]);
  const [loadingMasterFiles, setLoadingMasterFiles] = useState(false);
  // v2.17 — Report header (branding) configuration modal
  const [headerCfgOpen, setHeaderCfgOpen] = useState(false);

  // ---------- Data loading ----------

  const load = useCallback(async () => {
    try {
      const [rd, ro] = await Promise.all([
        api<{ items: Draft[] }>("/bill-drafts"),
        api<{ items: Offer[] }>("/company-offers"),
      ]);
      setDrafts(rd.items || []);
      setOffers(ro.items || []);
    } catch (e: any) {
      console.warn("bill-quick load err", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while any draft/offer is still analyzing
  useEffect(() => {
    const active = drafts.some((d) => d.status === "pending" || d.status === "analyzing")
      || offers.some((o) => o.status === "pending" || o.status === "analyzing");
    if (!active) return;
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [drafts, offers, load]);

  // ---------- Grouped drafts ----------

  const grouped: Record<BillType, Draft[]> = {
    luce: drafts.filter((d) => d.bill_type === "luce"),
    gas: drafts.filter((d) => d.bill_type === "gas"),
    telco: drafts.filter((d) => d.bill_type === "telco"),
  };

  // ---------- Upload flow (bills) ----------

  const uploadPdf = (bill_type: BillType) => {
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
      const full = await api<{ data_base64: string; name: string; mime: string; size: number }>(`/master-files/${mf.file_id}`);
      if (!full?.data_base64) { notify("File vuoto", ""); return; }
      const dataUri = `data:${full.mime || "application/pdf"};base64,${full.data_base64}`;
      openParamsModal(bill_type, { name: full.name || mf.name, mimeType: full.mime || "application/pdf", uri: dataUri });
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const openParamsModal = (bill_type: BillType, asset: any) => {
    const defs = DEFAULT_PARAMS[bill_type];
    const on = new Set<string>();
    defs.forEach((p) => { if (p.defaultOn) on.add(p.label); });
    setSelectedParams(on);
    setCustomParams([]);
    setCustomParam("");
    setLabelInput("");
    setFiscalCheck({ verify_iva: null, verify_accise_gas: bill_type === "gas", verify_pcv_annullato: false });
    setPendingUpload({ bill_type, asset });
  };

  const toggleParam = (label: string) => {
    setSelectedParams((prev) => {
      const nx = new Set(prev);
      if (nx.has(label)) nx.delete(label); else nx.add(label);
      return nx;
    });
  };

  const addCustomParam = () => {
    const t = customParam.trim();
    if (!t) return;
    setCustomParams((p) => (p.includes(t) ? p : [...p, t]));
    setCustomParam("");
  };

  const removeCustomParam = (p: string) => setCustomParams((prev) => prev.filter((x) => x !== p));

  const cancelPendingUpload = () => {
    setPendingUpload(null);
    setSelectedParams(new Set());
    setCustomParams([]);
    setCustomParam("");
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
      const paramLabels: string[] = Array.from(selectedParams);
      for (const cp of customParams) if (!paramLabels.includes(cp)) paramLabels.push(cp);
      const fc = fiscalCheck;
      if (fc.verify_iva !== null) paramLabels.push(`__verifica_iva__=${fc.verify_iva}`);
      if (bill_type === "gas" && fc.verify_accise_gas) paramLabels.push("__verifica_accise_gas__=0.012498");
      if ((bill_type === "luce" || bill_type === "gas") && fc.verify_pcv_annullato) paramLabels.push("__verifica_pcv_annullato__=1");
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

  // ---------- Draft actions ----------

  const deleteDraft = async (draft_id: string) => {
    const ok = await confirmAsync("Elimina", "Vuoi eliminare questa analisi?");
    if (!ok) return;
    try {
      await api(`/bill-drafts/${draft_id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const cancelDraft = async (draft_id: string) => {
    try {
      await api(`/bill-drafts/${draft_id}/cancel`, { method: "POST" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const reanalyze = async (draft_id: string) => {
    try {
      await api(`/bill-drafts/${draft_id}/reanalyze`, { method: "POST" });
      await load();
    } catch (e: any) { notify("Errore", e?.message || ""); }
  };

  const openBillPdf = async (draft_id: string) => {
    try {
      const r = await api<{ pdf_base64: string; pdf_mime: string; pdf_name: string }>(`/bill-drafts/${draft_id}/pdf`);
      if (!r?.pdf_base64) { notify("PDF vuoto", ""); return; }
      const dataUri = `data:${r.pdf_mime || "application/pdf"};base64,${r.pdf_base64}`;
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) w.document.write(`<iframe src="${dataUri}" style="border:0;width:100vw;height:100vh"></iframe>`);
      } else {
        // On native, open via Linking (data URI). Best-effort — most native
        // viewers won't accept base64 URIs directly, but this preserves parity.
        const { Linking } = await import("react-native");
        await Linking.openURL(dataUri);
      }
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
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
      notify("Bolletta associata ✅", "L'analisi è stata copiata sulla scheda del cliente.");
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

  // ---------- Company Offer actions ----------

  const uploadOffer = async (bill_type: BillType) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      setUploadingOffer(bill_type);
      const asset = res.assets[0];
      const b64 = await uriToBase64(asset.uri);
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 12 * 1024 * 1024) { notify("PDF troppo grande", "Max 12 MB."); setUploadingOffer(null); return; }
      await api(`/company-offers`, {
        method: "POST",
        body: {
          bill_type,
          pdf_base64: b64,
          pdf_name: asset.name || `offerta-${bill_type}.pdf`,
          pdf_mime: asset.mimeType || "application/pdf",
          label: asset.name || `Offerta ${bill_type}`,
        },
      });
      await load();
    } catch (e: any) {
      notify("Errore caricamento offerta", e?.message || "");
    } finally { setUploadingOffer(null); }
  };

  const saveManualOffer = async (bill_type: BillType) => {
    const text = (manualTxt[bill_type] || "").trim();
    if (!text) return;
    setSavingManual(bill_type);
    try {
      await api("/company-offers", {
        method: "POST",
        body: {
          bill_type,
          manual_text: text,
          label: `Condizioni ${SECTION_META[bill_type].label} — testo`,
        },
      });
      setManualTxt((m) => ({ ...m, [bill_type]: "" }));
      await load();
    } catch (e: any) {
      notify("Errore salvataggio", e?.message || "");
    } finally { setSavingManual(null); }
  };

  const deleteOffer = (offer: Offer) => {
    confirmAsync("Elimina offerta", `Vuoi eliminare "${offer.label || offer.pdf_name}"?`).then(async (ok) => {
      if (!ok) return;
      try { await api(`/company-offers/${offer.offer_id}`, { method: "DELETE" }); await load(); }
      catch (e: any) { notify("Errore", e?.message || ""); }
    });
  };

  const filteredContacts = (() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contactsList;
    return contactsList.filter((c) => {
      const nm = `${c.first_name} ${c.last_name}`.toLowerCase();
      return nm.includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q);
    });
  })();

  // ---------- Render ----------

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
        {/* Intro card — mirrors BillsSection */}
        <View style={styles.introCard}>
          <Ionicons name="sparkles" size={20} color={theme.color.brandPrimary} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.introTitle}>Fatture Energia · AI Claude Sonnet 5</Text>
            <Text style={styles.introTxt}>
              Carica le fatture in PDF: Luce, Gas o Telco. L&apos;AI estrae automaticamente POD/PDR, consumi, offerte, scadenze, IVA e altro. Potrai associare l&apos;analisi a un cliente esistente o crearne uno nuovo dai dati estratti.
            </Text>
          </View>
        </View>

        {/* v2.17 — Configura intestazione report (branding) */}
        <Pressable
          testID="bq-header-cfg-btn"
          onPress={() => setHeaderCfgOpen(true)}
          style={{
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            backgroundColor: "#0F172A", paddingVertical: 12, borderRadius: 12, marginBottom: 16,
          }}
        >
          <Ionicons name="settings-outline" size={18} color="#FFF" />
          <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 }}>Configura intestazione report</Text>
        </Pressable>

        {/* Company Offers accordion — identical to BillsSection */}
        <View style={styles.offersCard}>
          <Pressable onPress={() => setShowOffers((v) => !v)} style={styles.offersHeader}>
            <Ionicons name="briefcase" size={18} color="#7C3AED" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.offersTitle}>Offerte aziendali ({offers.length})</Text>
              <Text style={styles.offersSub}>Carica le condizioni economiche della tua offerta per confrontarla con quella attuale del cliente.</Text>
            </View>
            <Ionicons name={showOffers ? "chevron-up" : "chevron-down"} size={20} color="#7C3AED" />
          </Pressable>
          {showOffers && (
            <View style={{ padding: 12, paddingTop: 0 }}>
              {(Object.keys(SECTION_META) as BillType[]).map((bt) => {
                const meta = SECTION_META[bt];
                const myOffers = offers.filter((o) => o.bill_type === bt);
                return (
                  <View key={bt} style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <Text style={{ fontWeight: "700", fontSize: 12, color: meta.color }}>{meta.emoji} {meta.label}</Text>
                      <Text style={{ fontSize: 10, color: theme.color.muted }}>({myOffers.length})</Text>
                    </View>
                    <Pressable
                      testID={`offer-upload-${bt}`}
                      onPress={() => uploadOffer(bt)}
                      disabled={uploadingOffer === bt}
                      style={[styles.uploadBtn, { borderColor: "#7C3AED", paddingVertical: 8 }]}
                    >
                      {uploadingOffer === bt ? (
                        <ActivityIndicator color="#7C3AED" />
                      ) : (
                        <>
                          <Ionicons name="cloud-upload-outline" size={16} color="#7C3AED" />
                          <Text style={[styles.uploadTxt, { color: "#7C3AED", fontSize: 12 }]}>Carica condizioni economiche</Text>
                        </>
                      )}
                    </Pressable>
                    <View style={{ marginTop: 8, gap: 6 }}>
                      <TextInput
                        testID={`offer-manual-text-${bt}`}
                        value={manualTxt[bt]}
                        onChangeText={(t) => setManualTxt((m) => ({ ...m, [bt]: t }))}
                        placeholder="…oppure inserisci qui le condizioni economiche (prezzi €/kWh, quota fissa, servizi extra, penali…)"
                        placeholderTextColor="#94A3B8"
                        style={{ backgroundColor: "#FFF", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: "#DDD6FE", minHeight: 70, textAlignVertical: "top", color: theme.color.onSurface, fontSize: 12 }}
                        multiline
                      />
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <View style={{ flex: 1 }}>
                          <VoiceDictationButton
                            compact
                            testID={`offer-manual-mic-${bt}`}
                            label="Detta"
                            onTranscript={(txt) => setManualTxt((m) => ({ ...m, [bt]: (m[bt] ? m[bt] + " " : "") + txt }))}
                          />
                        </View>
                        <Pressable
                          testID={`offer-manual-save-${bt}`}
                          onPress={() => saveManualOffer(bt)}
                          disabled={savingManual === bt || !manualTxt[bt]?.trim()}
                          style={[styles.uploadBtn, { flex: 1, borderColor: "#16A34A", backgroundColor: manualTxt[bt]?.trim() ? "#16A34A" : "#94A3B8", paddingVertical: 8 }]}
                        >
                          {savingManual === bt ? (
                            <ActivityIndicator color="#FFF" />
                          ) : (
                            <>
                              <Ionicons name="save-outline" size={14} color="#FFF" />
                              <Text style={[styles.uploadTxt, { color: "#FFF", fontSize: 12 }]}>Salva testo</Text>
                            </>
                          )}
                        </Pressable>
                      </View>
                    </View>
                    {myOffers.map((o) => {
                      const st = STATUS_META[o.status] || STATUS_META.pending;
                      return (
                        <View key={o.offer_id} style={styles.offerCard}>
                          <Ionicons name="document-outline" size={16} color="#7C3AED" />
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={styles.offerCardTitle} numberOfLines={1}>{o.label || o.pdf_name}</Text>
                            <View style={styles.statusRow}>
                              <Ionicons name={st.icon} size={11} color={st.color} />
                              <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                              {o.status === "done" && o.extracted?.fornitore ? (
                                <Text style={styles.metaTxt}> · {String(o.extracted.fornitore).slice(0, 22)}</Text>
                              ) : null}
                            </View>
                          </View>
                          <Pressable onPress={() => deleteOffer(o)} testID={`offer-delete-${o.offer_id}`} style={{ padding: 6 }}>
                            <Ionicons name="trash-outline" size={16} color="#DC2626" />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Bills grouped sections — identical to BillsSection */}
        {loading && (
          <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
        )}
        {!loading && (Object.keys(SECTION_META) as BillType[]).map((bt) => {
          const meta = SECTION_META[bt];
          const bills = grouped[bt] || [];
          return (
            <View key={bt} style={styles.section}>
              <View style={[styles.sectionHeader, { backgroundColor: meta.color }]}>
                <Text style={styles.sectionTitle}>{meta.label}</Text>
                <Text style={styles.sectionCount}>{bills.length}</Text>
              </View>

              <Pressable
                testID={`bill-upload-${bt}`}
                onPress={() => uploadPdf(bt)}
                disabled={uploading === bt}
                style={[styles.uploadBtn, { borderColor: meta.color }]}
              >
                {uploading === bt ? (
                  <ActivityIndicator color={meta.color} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={20} color={meta.color} />
                    <Text style={[styles.uploadTxt, { color: meta.color }]}>Carica fattura PDF</Text>
                  </>
                )}
              </Pressable>

              {bills.length === 0 ? (
                <Text style={styles.emptyTxt}>Ancora nessuna analisi {meta.label.toLowerCase()}.</Text>
              ) : (
                bills.map((d) => {
                  const st = STATUS_META[d.status] || STATUS_META.pending;
                  const isOpen = !!expanded[d.draft_id];
                  const ex = d.extracted || {};
                  return (
                    <View key={d.draft_id} style={styles.billCard} testID={`draft-card-${d.draft_id}`}>
                      <Pressable
                        onPress={() => setExpanded((s) => ({ ...s, [d.draft_id]: !s[d.draft_id] }))}
                        style={styles.billHeader}
                      >
                        <Ionicons name="document-text" size={22} color={meta.color} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.billName} numberOfLines={1}>{d.label || d.pdf_name}</Text>
                          <View style={styles.statusRow}>
                            <Ionicons name={st.icon} size={12} color={st.color} />
                            <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                            {d.status === "done" && ex.fornitore ? (
                              <Text style={styles.metaTxt}> · {String(ex.fornitore).slice(0, 22)}</Text>
                            ) : null}
                          </View>
                        </View>
                        {(d.status === "pending" || d.status === "analyzing") && (
                          <Pressable
                            testID={`draft-cancel-header-${d.draft_id}`}
                            onPress={(e: any) => { e?.stopPropagation?.(); cancelDraft(d.draft_id); }}
                            hitSlop={8}
                            style={{ padding: 6, marginRight: 4 }}
                          >
                            <Ionicons name="stop-circle" size={20} color="#EA580C" />
                          </Pressable>
                        )}
                        <Pressable
                          testID={`draft-delete-header-${d.draft_id}`}
                          onPress={(e: any) => { e?.stopPropagation?.(); deleteDraft(d.draft_id); }}
                          hitSlop={8}
                          style={{ padding: 6, marginRight: 4 }}
                        >
                          <Ionicons name="trash-outline" size={18} color="#DC2626" />
                        </Pressable>
                        <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
                      </Pressable>

                      {isOpen && (
                        <View style={styles.billBody}>
                          {d.status === "error" && (
                            <View style={styles.errorBox}>
                              <Text style={styles.errorTxt}>{d.error_message || "Errore di analisi"}</Text>
                            </View>
                          )}
                          {d.status === "done" && (
                            <View style={styles.dataBox}>
                              {Object.entries(ex).map(([k, v]) => {
                                if (v === null || v === undefined || v === "") return null;
                                if (k === "consumi_mensili_kwh" || k === "consumi_mensili_smc" || k === "parametri_richiesti" || k === "note_ai" || k === "fiscal_check") {
                                  return (
                                    <BillFieldRow
                                      key={k}
                                      name={k}
                                      value={v}
                                      accent={meta.color}
                                    />
                                  );
                                }
                                if (k === "servizi_inclusi" && Array.isArray(v)) {
                                  return (
                                    <View key={k} style={styles.kvRow}>
                                      <Text style={styles.kvKey}>{humanKey(k)}</Text>
                                      <Text style={styles.kvVal}>{v.join(", ")}</Text>
                                    </View>
                                  );
                                }
                                if (Array.isArray(v) || (typeof v === "object" && v !== null)) return null;
                                return (
                                  <View key={k} style={styles.kvRow}>
                                    <Text style={styles.kvKey}>{humanKey(k)}</Text>
                                    <Text style={styles.kvVal}>{String(v)}</Text>
                                  </View>
                                );
                              })}
                              {Object.keys(ex).length === 0 && (
                                <Text style={styles.emptyTxt}>Nessun dato estratto.</Text>
                              )}
                            </View>
                          )}

                          <View style={styles.actionsRow}>
                            <Pressable testID={`draft-view-${d.draft_id}`} onPress={() => openBillPdf(d.draft_id)} style={[styles.actBtn, { backgroundColor: "#F1F5F9" }]}>
                              <Ionicons name="eye-outline" size={14} color={theme.color.onSurface} />
                              <Text style={styles.actBtnTxt}>Apri PDF</Text>
                            </Pressable>
                            {(d.status === "pending" || d.status === "analyzing") && (
                              <Pressable
                                testID={`draft-cancel-${d.draft_id}`}
                                onPress={() => cancelDraft(d.draft_id)}
                                style={[styles.actBtn, { backgroundColor: "#FEF3C7" }]}
                              >
                                <Ionicons name="stop-circle-outline" size={14} color="#B45309" />
                                <Text style={[styles.actBtnTxt, { color: "#B45309" }]}>Annulla analisi</Text>
                              </Pressable>
                            )}
                            {(d.status === "error" || d.status === "done" || d.status === "cancelled") && (
                              <Pressable testID={`draft-reanalyze-${d.draft_id}`} onPress={() => reanalyze(d.draft_id)} style={[styles.actBtn, { backgroundColor: "#DBEAFE" }]}>
                                <Ionicons name="refresh" size={14} color="#1D4ED8" />
                                <Text style={[styles.actBtnTxt, { color: "#1D4ED8" }]}>Ri-analizza</Text>
                              </Pressable>
                            )}
                            {d.status === "done" && (
                              <>
                                <Pressable
                                  testID={`draft-associate-${d.draft_id}`}
                                  onPress={() => openAssociate(d)}
                                  style={[styles.actBtn, { backgroundColor: "#DCFCE7" }]}
                                >
                                  <Ionicons name="link" size={14} color="#166534" />
                                  <Text style={[styles.actBtnTxt, { color: "#166534" }]}>Associa a cliente</Text>
                                </Pressable>
                                <Pressable
                                  testID={`draft-create-contact-${d.draft_id}`}
                                  onPress={() => createContactFromDraft(d)}
                                  disabled={busyAction === `create-${d.draft_id}`}
                                  style={[styles.actBtn, { backgroundColor: "#E0E7FF" }]}
                                >
                                  {busyAction === `create-${d.draft_id}` ? (
                                    <ActivityIndicator size="small" color="#3730A3" />
                                  ) : (
                                    <Ionicons name="person-add" size={14} color="#3730A3" />
                                  )}
                                  <Text style={[styles.actBtnTxt, { color: "#3730A3" }]}>Crea cliente</Text>
                                </Pressable>
                              </>
                            )}
                            <Pressable testID={`draft-delete-${d.draft_id}`} onPress={() => deleteDraft(d.draft_id)} style={[styles.actBtn, { backgroundColor: "#FEE2E2" }]}>
                              <Ionicons name="trash-outline" size={14} color="#DC2626" />
                              <Text style={[styles.actBtnTxt, { color: "#DC2626" }]}>Elimina</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Params modal — mirrors BillsSection */}
      <Modal visible={!!pendingUpload} animationType="slide" transparent onRequestClose={cancelPendingUpload}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" }}>
            {pendingUpload && (() => {
              const bt = pendingUpload.bill_type;
              const meta = SECTION_META[bt];
              const defs = DEFAULT_PARAMS[bt];
              return (
                <>
                  <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 20 }}>{meta.emoji}</Text>
                        <View>
                          <Text style={{ fontSize: 15, fontWeight: "800", color: theme.color.onSurface }}>Parametri da estrarre</Text>
                          <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 1 }} numberOfLines={1}>
                            {pendingUpload.asset.name || `fattura-${bt}.pdf`}
                          </Text>
                        </View>
                      </View>
                      <Pressable onPress={cancelPendingUpload} hitSlop={8} testID="bill-config-close">
                        <Ionicons name="close" size={22} color={theme.color.onSurface} />
                      </Pressable>
                    </View>
                    <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 8, lineHeight: 15 }}>
                      Scegli quali parametri vuoi che l&apos;AI estragga con priorità. Puoi anche aggiungerne di personalizzati.
                    </Text>
                  </View>

                  <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 12 }}>
                    <TextInput
                      testID="quick-label-input"
                      value={labelInput}
                      onChangeText={setLabelInput}
                      placeholder="Etichetta (facoltativa, es. 'Prospect Via Roma')"
                      placeholderTextColor="#94A3B8"
                      style={styles.labelInput}
                    />

                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 12, marginBottom: 6 }}>PARAMETRI STANDARD</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {defs.map((p) => {
                        const on = selectedParams.has(p.label);
                        return (
                          <Pressable
                            key={p.id}
                            testID={`param-${p.id}`}
                            onPress={() => toggleParam(p.label)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 20,
                              borderWidth: 1,
                              borderColor: on ? meta.color : theme.color.border,
                              backgroundColor: on ? meta.color + "18" : "#FFF",
                            }}
                          >
                            <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? meta.color : theme.color.muted} />
                            <Text style={{ fontSize: 12, color: on ? meta.color : theme.color.onSurface, fontWeight: on ? "700" : "500" }}>{p.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {customParams.length > 0 && (
                      <>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 14, marginBottom: 6 }}>PARAMETRI PERSONALIZZATI</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                          {customParams.map((p) => (
                            <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F3E8FF", borderWidth: 1, borderColor: "#7C3AED" }}>
                              <Ionicons name="sparkles" size={13} color="#7C3AED" />
                              <Text style={{ fontSize: 12, color: "#5B21B6", fontWeight: "700" }}>{p}</Text>
                              <Pressable onPress={() => removeCustomParam(p)} hitSlop={6}>
                                <Ionicons name="close-circle" size={14} color="#7C3AED" />
                              </Pressable>
                            </View>
                          ))}
                        </View>
                      </>
                    )}

                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 14, marginBottom: 6 }}>AGGIUNGI PARAMETRO PERSONALIZZATO</Text>
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <TextInput
                        testID="bill-config-custom-input"
                        value={customParam}
                        onChangeText={setCustomParam}
                        onSubmitEditing={addCustomParam}
                        placeholder="Es. Bonus sociale, Rateizzazione, IVA agevolata…"
                        placeholderTextColor={theme.color.muted}
                        style={{ flex: 1, backgroundColor: "#FFF", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.color.border, fontSize: 13, color: theme.color.onSurface }}
                      />
                      <Pressable
                        onPress={addCustomParam}
                        disabled={!customParam.trim()}
                        testID="bill-config-add-custom"
                        style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: customParam.trim() ? "#7C3AED" : "#CBD5E1", flexDirection: "row", alignItems: "center", gap: 4 }}
                      >
                        <Ionicons name="add" size={16} color="#FFF" />
                        <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>Aggiungi</Text>
                      </Pressable>
                    </View>

                    {/* Fiscal-check (master-side bonus) */}
                    <View style={styles.fiscalBox}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <Ionicons name="shield-checkmark" size={16} color="#059669" />
                        <Text style={styles.fiscalTitle}>Verifica agevolazioni fiscali (opzionale)</Text>
                      </View>
                      <Text style={styles.fiscalHint}>Neo evidenzierà in rosso le righe non conformi e calcolerà lo scostamento su 12 mesi.</Text>

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

                      {bt === "gas" && (
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

                      {(bt === "luce" || bt === "gas") && (
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

                  <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: "#FFF", gap: 8 }}>
                    <Text style={{ fontSize: 11, color: theme.color.muted, textAlign: "center" }}>
                      Selezionati: <Text style={{ fontWeight: "800", color: meta.color }}>{selectedParams.size}</Text> parametri
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable onPress={cancelPendingUpload} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: "#F1F5F9", alignItems: "center" }} testID="bill-config-cancel">
                        <Text style={{ color: theme.color.onSurface, fontWeight: "700", fontSize: 14 }}>Annulla</Text>
                      </Pressable>
                      <Pressable
                        onPress={confirmUploadWithParams}
                        disabled={selectedParams.size === 0 && customParams.length === 0}
                        style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: (selectedParams.size === 0 && customParams.length === 0) ? "#CBD5E1" : meta.color, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                        testID="bill-config-confirm"
                      >
                        <Ionicons name="sparkles" size={16} color="#FFF" />
                        <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 14 }}>Avvia analisi AI</Text>
                      </Pressable>
                    </View>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Source picker: Device vs Master files */}
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

      {/* Master file picker */}
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

      {/* Associate contact modal */}
      <Modal visible={!!associateTarget} animationType="slide" transparent onRequestClose={() => setAssociateTarget(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Associa a un cliente</Text>
            <Text style={styles.modalSub}>Seleziona il cliente a cui associare questa analisi. Il PDF e l&apos;analisi HTML verranno copiati nella sezione File del cliente.</Text>
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

      <CalculatorFAB />
      {/* v2.17 — Report header (branding) config modal */}
      <ReportHeaderConfigModal visible={headerCfgOpen} onClose={() => setHeaderCfgOpen(false)} />
    </SafeAreaView>
  );
}

// ---------- Styles (mirror BillsSection) ----------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },

  // Intro (mirror BillsSection)
  introCard: {
    flexDirection: "row",
    backgroundColor: "#EEF2FF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: "flex-start",
  },
  introTitle: { fontSize: 13, fontWeight: "800", color: theme.color.brandPrimary },
  introTxt: { fontSize: 11, color: theme.color.muted, marginTop: 2, lineHeight: 15 },

  // Sections
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  sectionTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  sectionCount: { color: "#FFF", fontWeight: "800", fontSize: 13, backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },

  uploadBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  uploadTxt: { fontWeight: "700", fontSize: 13 },

  emptyTxt: { fontSize: 12, color: theme.color.muted, fontStyle: "italic", textAlign: "center", paddingVertical: 8 },

  billCard: {
    backgroundColor: theme.color.surface,
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: "hidden",
  },
  billHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  billName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2, gap: 3 },
  statusTxt: { fontSize: 11, fontWeight: "600" },
  metaTxt: { fontSize: 11, color: theme.color.muted },
  billBody: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.color.border },

  errorBox: { backgroundColor: "#FEE2E2", borderRadius: 8, padding: 10, marginTop: 10 },
  errorTxt: { color: "#991B1B", fontSize: 12 },
  dataBox: { marginTop: 8, backgroundColor: "#FAFBFF", borderRadius: 8, padding: 8, overflow: "hidden" },
  kvRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#EEF2FF", alignItems: "flex-start" },
  kvKey: { fontSize: 11, fontWeight: "700", color: theme.color.muted, width: 110, paddingRight: 6 },
  kvVal: { fontSize: 11, color: theme.color.onSurface, flex: 1, flexShrink: 1, flexWrap: "wrap" },

  actionsRow: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actBtnTxt: { fontSize: 11, fontWeight: "700", color: theme.color.onSurface },

  // Offers (mirror BillsSection)
  offersCard: {
    backgroundColor: "#F5F3FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    marginBottom: 16,
    overflow: "hidden",
  },
  offersHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  offersTitle: { fontSize: 13, fontWeight: "800", color: "#7C3AED" },
  offersSub: { fontSize: 11, color: theme.color.muted, marginTop: 2, lineHeight: 14 },
  offerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#EDE9FE",
  },
  offerCardTitle: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },

  // Modals
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  modalSub: { fontSize: 12, color: theme.color.muted, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  labelInput: { backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 13, color: theme.color.onSurface },

  // Fiscal
  fiscalBox: { marginTop: 16, padding: 12, borderRadius: 10, backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" },
  fiscalTitle: { fontSize: 13, fontWeight: "800", color: "#065F46" },
  fiscalHint: { fontSize: 11, color: "#047857", marginBottom: 8, lineHeight: 15 },
  fiscalLbl: { fontSize: 11, fontWeight: "700", color: "#065F46", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 10 },
  fiscalOpt: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: "#059669", backgroundColor: "#FFF", marginTop: 4, alignSelf: "flex-start" },
  fiscalOptTxt: { fontSize: 12, fontWeight: "700", color: "#065F46" },

  // Associate rows
  assocRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, gap: 10, marginBottom: 6 },
  assocAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.color.brandTertiary, justifyContent: "center", alignItems: "center" },
  assocName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  assocSub: { fontSize: 11, color: theme.color.muted },
  srcBtn: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10 },
  srcTitle: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  srcSub: { color: "#FFFFFFCC", fontSize: 11, marginTop: 2 },
});

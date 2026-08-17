import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { uriToBase64 } from "@/src/utils/media";

type BillType = "luce" | "gas" | "telco";

type Bill = {
  bill_id: string;
  contact_id: string;
  bill_type: BillType;
  pdf_name: string;
  pdf_size?: number;
  status: "pending" | "analyzing" | "done" | "error";
  error_message?: string | null;
  extracted?: Record<string, any> | null;
  created_at: string;
  analyzed_at?: string | null;
};

type Grouped = { luce: Bill[]; gas: Bill[]; telco: Bill[] };

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
};

export function BillsSection({ contactId, contactName }: { contactId: string; contactName?: string }) {
  const [grouped, setGrouped] = useState<Grouped>({ luce: [], gas: [], telco: [] });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<BillType | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportBusy, setReportBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ grouped: Grouped }>(`/contacts/${contactId}/bills`);
      setGrouped(r.grouped);
    } catch (e: any) {
      console.warn("bills load", e?.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while any bill is pending/analyzing
  useEffect(() => {
    const flat: Bill[] = [...grouped.luce, ...grouped.gas, ...grouped.telco];
    const anyActive = flat.some((b) => b.status === "pending" || b.status === "analyzing");
    if (!anyActive) return;
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [grouped, load]);

  const uploadPdf = async (bill_type: BillType) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setUploading(bill_type);
      let b64: string;
      if (Platform.OS === "web") {
        // On web the URI is often a blob URL — use fetch+FileReader via uriToBase64
        b64 = await uriToBase64(asset.uri);
      } else {
        b64 = await uriToBase64(asset.uri);
      }
      const bytes = Math.round((b64.length * 3) / 4);
      if (bytes > 12 * 1024 * 1024) {
        notify("PDF troppo grande", "Massimo 12 MB per fattura.");
        setUploading(null);
        return;
      }
      await api(`/contacts/${contactId}/bills`, {
        method: "POST",
        body: {
          bill_type,
          pdf_base64: b64,
          pdf_name: asset.name || `fattura-${bill_type}.pdf`,
          pdf_mime: asset.mimeType || "application/pdf",
        },
      });
      await load();
    } catch (e: any) {
      console.warn("upload bill err", e);
      notify("Errore caricamento", e?.message || "Impossibile caricare la fattura");
    } finally {
      setUploading(null);
    }
  };

  const deleteBill = (bill: Bill) => {
    notify(
      "Elimina fattura",
      `Vuoi rimuovere "${bill.pdf_name}"?`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Elimina",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/contacts/${contactId}/bills/${bill.bill_id}`, { method: "DELETE" });
              await load();
            } catch (e: any) {
              notify("Errore", e?.message || "");
            }
          },
        },
      ]
    );
  };

  const reanalyze = async (bill: Bill) => {
    try {
      await api(`/contacts/${contactId}/bills/${bill.bill_id}/reanalyze`, { method: "POST" });
      await load();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    }
  };

  const openBillPdf = async (bill: Bill) => {
    try {
      const r = await api<{ pdf_base64: string; pdf_mime: string; pdf_name: string }>(`/contacts/${contactId}/bills/${bill.bill_id}/pdf`);
      let b64 = r.pdf_base64 || "";
      if (b64.startsWith("data:")) b64 = b64.split(",", 1)[1] || b64;
      const dataUrl = `data:${r.pdf_mime || "application/pdf"};base64,${b64}`;
      if (Platform.OS === "web") {
        // Open in new tab
        const win = (globalThis as any).window;
        if (win?.open) win.open(dataUrl, "_blank");
        return;
      }
      // Native: write to cache and share/preview
      const FileSystem = await import("expo-file-system/legacy");
      const path = `${FileSystem.cacheDirectory}${bill.pdf_name || "fattura.pdf"}`;
      await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        Linking.openURL(path);
      }
    } catch (e: any) {
      notify("Errore apertura PDF", e?.message || "");
    }
  };

  const generateReport = async () => {
    try {
      setReportBusy(true);
      const rep = await api<any>(`/contacts/${contactId}/bills/report`);
      const html = buildReportHtml(rep, contactName);
      if (Platform.OS === "web") {
        // Fallback: open a printable window
        const win = (globalThis as any).window;
        if (win?.open) {
          const w = win.open("", "_blank");
          if (w) {
            w.document.write(html);
            w.document.close();
            setTimeout(() => { try { w.print(); } catch {} }, 400);
          }
        }
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        notify("Report generato", uri);
      }
    } catch (e: any) {
      notify("Errore report", e?.message || "");
    } finally {
      setReportBusy(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 30 }} color={theme.color.brandPrimary} />;
  }

  const totalDone = grouped.luce.filter((b) => b.status === "done").length
    + grouped.gas.filter((b) => b.status === "done").length
    + grouped.telco.filter((b) => b.status === "done").length;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <View style={styles.introCard}>
        <Ionicons name="sparkles" size={20} color={theme.color.brandPrimary} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.introTitle}>Fatture Energia · AI Claude Sonnet 5</Text>
          <Text style={styles.introTxt}>Carica le fatture in PDF: Luce, Gas o Telco. L&apos;AI estrae automaticamente POD/PDR, consumi, offerte, scadenze, IVA e altro.</Text>
        </View>
      </View>

      {(Object.keys(SECTION_META) as BillType[]).map((bt) => {
        const meta = SECTION_META[bt];
        const bills = grouped[bt] || [];
        return (
          <View key={bt} style={styles.section}>
            <View style={[styles.sectionHeader, { backgroundColor: meta.color }]}>
              <Text style={styles.sectionTitle}>{meta.emoji} {meta.label}</Text>
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
              <Text style={styles.emptyTxt}>Ancora nessuna fattura {meta.label.toLowerCase()}.</Text>
            ) : (
              bills.map((b) => {
                const st = STATUS_META[b.status] || STATUS_META.pending;
                const isOpen = !!expanded[b.bill_id];
                const ex = b.extracted || {};
                return (
                  <View key={b.bill_id} style={styles.billCard}>
                    <Pressable
                      onPress={() => setExpanded((s) => ({ ...s, [b.bill_id]: !s[b.bill_id] }))}
                      style={styles.billHeader}
                      testID={`bill-card-${b.bill_id}`}
                    >
                      <Ionicons name="document-text" size={22} color={meta.color} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.billName} numberOfLines={1}>{b.pdf_name}</Text>
                        <View style={styles.statusRow}>
                          <Ionicons name={st.icon} size={12} color={st.color} />
                          <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                          {b.status === "done" && ex.fornitore ? (
                            <Text style={styles.metaTxt}> · {String(ex.fornitore).slice(0, 22)}</Text>
                          ) : null}
                        </View>
                      </View>
                      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
                    </Pressable>

                    {isOpen && (
                      <View style={styles.billBody}>
                        {b.status === "error" && (
                          <View style={styles.errorBox}>
                            <Text style={styles.errorTxt}>{b.error_message || "Errore di analisi"}</Text>
                          </View>
                        )}

                        {b.status === "done" && (
                          <View style={styles.dataBox}>
                            {Object.entries(ex).map(([k, v]) => {
                              if (v === null || v === undefined || v === "") return null;
                              const value = Array.isArray(v) ? JSON.stringify(v) : String(v);
                              return (
                                <View key={k} style={styles.kvRow}>
                                  <Text style={styles.kvKey}>{humanKey(k)}</Text>
                                  <Text style={styles.kvVal}>{value}</Text>
                                </View>
                              );
                            })}
                            {Object.keys(ex).length === 0 && (
                              <Text style={styles.emptyTxt}>Nessun dato estratto.</Text>
                            )}
                          </View>
                        )}

                        <View style={styles.actionsRow}>
                          <Pressable testID={`bill-view-${b.bill_id}`} onPress={() => openBillPdf(b)} style={[styles.actBtn, { backgroundColor: "#F1F5F9" }]}>
                            <Ionicons name="eye-outline" size={14} color={theme.color.onSurface} />
                            <Text style={styles.actBtnTxt}>Apri PDF</Text>
                          </Pressable>
                          {(b.status === "error" || b.status === "done") && (
                            <Pressable testID={`bill-reanalyze-${b.bill_id}`} onPress={() => reanalyze(b)} style={[styles.actBtn, { backgroundColor: "#DBEAFE" }]}>
                              <Ionicons name="refresh" size={14} color="#1D4ED8" />
                              <Text style={[styles.actBtnTxt, { color: "#1D4ED8" }]}>Ri-analizza</Text>
                            </Pressable>
                          )}
                          <Pressable testID={`bill-delete-${b.bill_id}`} onPress={() => deleteBill(b)} style={[styles.actBtn, { backgroundColor: "#FEE2E2" }]}>
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

      <Pressable
        testID="bills-report-btn"
        disabled={totalDone === 0 || reportBusy}
        onPress={generateReport}
        style={[styles.reportBtn, { opacity: totalDone === 0 || reportBusy ? 0.5 : 1 }]}
      >
        {reportBusy ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Ionicons name="document-attach" size={20} color="#FFF" />
            <Text style={styles.reportBtnTxt}>Genera Report PDF ({totalDone} fatture)</Text>
          </>
        )}
      </Pressable>
      {totalDone === 0 && (
        <Text style={[styles.emptyTxt, { textAlign: "center", marginTop: 6 }]}>
          Il report sarà disponibile quando almeno una fattura sarà stata analizzata.
        </Text>
      )}
    </ScrollView>
  );
}

function humanKey(k: string): string {
  const map: Record<string, string> = {
    fornitore: "Fornitore",
    cliente: "Cliente",
    codice_cliente: "Codice cliente",
    pod: "POD",
    pod_count: "Numero POD",
    pdr: "PDR",
    pdr_count: "Numero PDR",
    tensione: "Tensione",
    potenza_impegnata_kw: "Potenza impegnata (kW)",
    consumo_totale_12m_kwh: "Consumo totale 12 mesi (kWh)",
    consumo_medio_mensile_kwh: "Consumo medio mensile (kWh)",
    consumi_mensili_kwh: "Consumi mensili",
    consumo_totale_12m_smc: "Consumo totale 12 mesi (SMC)",
    consumo_medio_mensile_smc: "Consumo medio mensile (SMC)",
    consumi_mensili_smc: "Consumi mensili SMC",
    nome_offerta: "Nome offerta",
    data_attivazione: "Data attivazione",
    data_scadenza: "Data scadenza",
    durata_contratto_mesi: "Durata contratto (mesi)",
    iva_percentuale: "IVA %",
    accisa_eur_smc: "Accisa €/SMC",
    spread_eur_kwh: "Spread €/kWh",
    spread_eur_smc: "Spread €/SMC",
    prezzo_energia_eur_kwh: "Prezzo energia €/kWh",
    prezzo_gas_eur_smc: "Prezzo gas €/SMC",
    importo_totale_eur: "Importo totale €",
    periodo_fattura: "Periodo fattura",
    tipo_connessione: "Tipo connessione",
    velocita_download_mbps: "Velocità download (Mbps)",
    velocita_upload_mbps: "Velocità upload (Mbps)",
    numero_telefono: "Numero telefono",
    servizi_inclusi: "Servizi inclusi",
    costo_mensile_eur: "Costo mensile €",
    costo_annuale_eur: "Costo annuale €",
    codice_migrazione: "Codice migrazione",
    penale_disdetta_eur: "Penale disdetta €",
    note_ai: "Note AI",
    parse_error: "Errore parsing",
  };
  return map[k] || k.replace(/_/g, " ");
}

function esc(s: any): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderExtractedTable(ex: Record<string, any>): string {
  const rows = Object.entries(ex)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const val = Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : String(v);
      return `<tr><td style="padding:4px 8px;background:#F1F5F9;font-weight:600;font-size:11px;">${esc(humanKey(k))}</td><td style="padding:4px 8px;font-size:11px;">${esc(val)}</td></tr>`;
    }).join("");
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;border:1px solid #E5E7EB;">${rows}</table>`;
}

function buildReportHtml(rep: any, contactName?: string): string {
  const c = rep?.contact || {};
  const name = contactName || `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cliente";
  const generated = new Date(rep?.generated_at || Date.now()).toLocaleString("it-IT");
  const s = rep?.ai_suggestions || {};
  const grouped = rep?.grouped || {};
  const sections: { key: "luce" | "gas" | "telco"; label: string; color: string; emoji: string }[] = [
    { key: "luce", label: "Luce", color: "#F59E0B", emoji: "💡" },
    { key: "gas", label: "Gas", color: "#DC2626", emoji: "🔥" },
    { key: "telco", label: "Telco", color: "#0891B2", emoji: "📞" },
  ];
  const sectionsHtml = sections.map((sec) => {
    const items = grouped[sec.key] || [];
    if (items.length === 0) return "";
    const cards = items.map((it: any) => `
      <div style="margin-bottom:16px;border:1px solid ${sec.color};border-radius:8px;overflow:hidden;">
        <div style="background:${sec.color};color:#FFF;padding:6px 10px;font-weight:700;font-size:12px;">${esc(it.pdf_name || "Fattura")}</div>
        ${renderExtractedTable(it.extracted || {})}
      </div>`).join("");
    return `
      <h2 style="color:${sec.color};border-bottom:2px solid ${sec.color};padding-bottom:4px;">${sec.emoji} ${sec.label} (${items.length})</h2>
      ${cards}
    `;
  }).join("");

  const suggBlock = (list: any) => Array.isArray(list) && list.length
    ? `<ul style="margin:6px 0 12px 20px;padding:0;">${list.map((x: any) => `<li style="margin-bottom:4px;font-size:12px;">${esc(x)}</li>`).join("")}</ul>`
    : "";
  const prioColor = s.priorita_azione === "alta" ? "#DC2626" : s.priorita_azione === "media" ? "#F59E0B" : "#16A34A";
  const suggestionsHtml = s.riepilogo_generale || s.suggerimenti_luce || s.suggerimenti_gas || s.suggerimenti_telco ? `
    <div style="margin-top:24px;background:#F8FAFC;border-left:4px solid #6366F1;padding:14px;border-radius:6px;">
      <h2 style="margin:0 0 10px 0;color:#6366F1;">🤖 Analisi AI e suggerimenti</h2>
      ${s.riepilogo_generale ? `<p style="font-size:13px;line-height:1.5;">${esc(s.riepilogo_generale)}</p>` : ""}
      ${s.punti_forza ? `<h3 style="color:#16A34A;font-size:13px;margin:10px 0 4px;">✓ Punti di forza</h3>${suggBlock(s.punti_forza)}` : ""}
      ${s.punti_debolezza ? `<h3 style="color:#DC2626;font-size:13px;margin:10px 0 4px;">✗ Criticità</h3>${suggBlock(s.punti_debolezza)}` : ""}
      ${s.suggerimenti_luce ? `<h3 style="color:#F59E0B;font-size:13px;margin:10px 0 4px;">💡 Consigli Luce</h3>${suggBlock(s.suggerimenti_luce)}` : ""}
      ${s.suggerimenti_gas ? `<h3 style="color:#DC2626;font-size:13px;margin:10px 0 4px;">🔥 Consigli Gas</h3>${suggBlock(s.suggerimenti_gas)}` : ""}
      ${s.suggerimenti_telco ? `<h3 style="color:#0891B2;font-size:13px;margin:10px 0 4px;">📞 Consigli Telco</h3>${suggBlock(s.suggerimenti_telco)}` : ""}
      ${s.risparmio_stimato_annuo_eur ? `<div style="margin-top:12px;padding:10px;background:#DCFCE7;border-radius:6px;"><b style="color:#166534;">Risparmio stimato annuo:</b> € ${esc(s.risparmio_stimato_annuo_eur)}</div>` : ""}
      ${s.priorita_azione ? `<div style="margin-top:8px;font-size:12px;"><b>Priorità azione:</b> <span style="color:${prioColor};text-transform:uppercase;font-weight:800;">${esc(s.priorita_azione)}</span></div>` : ""}
    </div>
  ` : "";

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"/>
<title>Report Fatture — ${esc(name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0F172A; margin: 32px; }
  h1 { color: #1F2937; border-bottom: 3px solid #6366F1; padding-bottom: 8px; }
  h2 { margin-top: 20px; }
  .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #6B7280; margin-bottom: 20px; }
</style>
</head>
<body>
  <h1>📊 Report Fatture Energia</h1>
  <div class="header-info">
    <div><b>Cliente:</b> ${esc(name)}${c.contact_code ? ` (${esc(c.contact_code)})` : ""}</div>
    <div><b>Generato:</b> ${esc(generated)}</div>
  </div>
  ${sectionsHtml || "<p><i>Nessuna fattura analizzata.</i></p>"}
  ${suggestionsHtml}
  <div style="margin-top:36px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center;">
    Report generato automaticamente da Dal Pastro CRM con analisi AI · Claude Sonnet 5
  </div>
</body></html>`;
}

const styles = StyleSheet.create({
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
  dataBox: { marginTop: 8, backgroundColor: "#FAFBFF", borderRadius: 8, padding: 8 },
  kvRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#EEF2FF" },
  kvKey: { fontSize: 11, fontWeight: "700", color: theme.color.muted, width: 130 },
  kvVal: { fontSize: 11, color: theme.color.onSurface, flex: 1 },
  actionsRow: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actBtnTxt: { fontSize: 11, fontWeight: "700", color: theme.color.onSurface },
  reportBtn: {
    marginTop: 24,
    backgroundColor: "#6366F1",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
  },
  reportBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});

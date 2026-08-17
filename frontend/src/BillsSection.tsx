import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform, Linking } from "react-native";
import Svg, { Rect, Text as SvgText, Line } from "react-native-svg";
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

export function BillsSection({ contactId, contactName }: { contactId: string; contactName?: string }) {
  const [grouped, setGrouped] = useState<Grouped>({ luce: [], gas: [], telco: [] });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showOffers, setShowOffers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<BillType | null>(null);
  const [uploadingOffer, setUploadingOffer] = useState<BillType | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportBusy, setReportBusy] = useState(false);
  const [comparisonBusy, setComparisonBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, ro] = await Promise.all([
        api<{ grouped: Grouped }>(`/contacts/${contactId}/bills`),
        api<{ items: Offer[] }>(`/company-offers`),
      ]);
      setGrouped(r.grouped);
      setOffers(ro.items || []);
    } catch (e: any) {
      console.warn("bills load", e?.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while any bill/offer is pending/analyzing
  useEffect(() => {
    const flatBills: Bill[] = [...grouped.luce, ...grouped.gas, ...grouped.telco];
    const anyActive = flatBills.some((b) => b.status === "pending" || b.status === "analyzing")
      || offers.some((o) => o.status === "pending" || o.status === "analyzing");
    if (!anyActive) return;
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [grouped, offers, load]);

  const uploadOffer = async (bill_type: BillType) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setUploadingOffer(bill_type);
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
          label: asset.name?.replace(/\.pdf$/i, "") || `Offerta ${bill_type}`,
        },
      });
      await load();
    } catch (e: any) {
      notify("Errore caricamento offerta", e?.message || "");
    } finally {
      setUploadingOffer(null);
    }
  };

  const deleteOffer = (offer: Offer) => {
    notify("Elimina offerta", `Rimuovere "${offer.label || offer.pdf_name}"?`, [
      { text: "Annulla", style: "cancel" },
      { text: "Elimina", style: "destructive", onPress: async () => {
        try { await api(`/company-offers/${offer.offer_id}`, { method: "DELETE" }); await load(); }
        catch (e: any) { notify("Errore", e?.message || ""); }
      }},
    ]);
  };

  const generateComparison = async () => {
    try {
      setComparisonBusy(true);
      const rep = await api<any>(`/contacts/${contactId}/bills/comparison`);
      const html = buildComparisonHtml(rep, contactName);
      if (Platform.OS === "web") {
        const win = (globalThis as any).window;
        if (win?.open) {
          const w = win.open("", "_blank");
          if (w) { w.document.write(html); w.document.close(); setTimeout(() => { try { w.print(); } catch {} }, 400); }
        }
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      }
    } catch (e: any) {
      notify("Errore comparazione", e?.message || "");
    } finally {
      setComparisonBusy(false);
    }
  };

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
      if (Platform.OS === "web") {
        // Convert base64 -> Blob -> object URL (avoids blank data-URL PDFs in modern browsers)
        try {
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: r.pdf_mime || "application/pdf" });
          const url = URL.createObjectURL(blob);
          const win = (globalThis as any).window;
          const tab = win?.open(url, "_blank");
          if (!tab) {
            // Popup blocked → fallback: force download
            const a = win.document.createElement("a");
            a.href = url;
            a.download = r.pdf_name || "fattura.pdf";
            win.document.body.appendChild(a);
            a.click();
            win.document.body.removeChild(a);
          }
          // Revoke later so the tab has time to load
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (er: any) {
          notify("Errore apertura PDF", er?.message || "Impossibile aprire il file");
        }
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

      {/* Company Offers accordion */}
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
                              // Special renderings
                              if (k === "consumi_mensili_kwh" || k === "consumi_mensili_smc") {
                                const unit = k.endsWith("kwh") ? "kWh" : "SMC";
                                return (
                                  <View key={k} style={{ marginVertical: 6 }}>
                                    <Text style={[styles.kvKey, { marginBottom: 4 }]}>Consumi mensili ({unit})</Text>
                                    <ConsumoBarChart data={v} unit={unit} color={SECTION_META[b.bill_type]?.color || "#6366F1"} />
                                  </View>
                                );
                              }
                              if (k === "note_ai") {
                                const items = normalizeNotes(v);
                                if (items.length === 0) return null;
                                return (
                                  <View key={k} style={{ marginTop: 6 }}>
                                    <Text style={[styles.kvKey, { marginBottom: 4 }]}>Note AI</Text>
                                    {items.map((it, idx) => (
                                      <View key={idx} style={styles.bulletRow}>
                                        <Text style={styles.bulletDot}>•</Text>
                                        <Text style={styles.bulletTxt}>{it}</Text>
                                      </View>
                                    ))}
                                  </View>
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
                              if (Array.isArray(v) || (typeof v === "object" && v !== null)) return null; // handled above
                              const value = String(v);
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

      {/* Comparison Button */}
      {(() => {
        const doneOffers = offers.filter((o) => o.status === "done");
        const canCompare = totalDone > 0 && doneOffers.length > 0;
        return (
          <>
            <Pressable
              testID="bills-compare-btn"
              disabled={!canCompare || comparisonBusy}
              onPress={generateComparison}
              style={[styles.compareBtn, { opacity: !canCompare || comparisonBusy ? 0.5 : 1 }]}
            >
              {comparisonBusy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="git-compare" size={20} color="#FFF" />
                  <Text style={styles.reportBtnTxt}>Confronta con Offerta Aziendale</Text>
                </>
              )}
            </Pressable>
            {!canCompare && (
              <Text style={[styles.emptyTxt, { textAlign: "center", marginTop: 6 }]}>
                Serve almeno una fattura analizzata e un&apos;offerta aziendale analizzata (stesso tipo).
              </Text>
            )}
          </>
        );
      })()}
    </ScrollView>
  );
}

const MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

type ConsumoPoint = { mese: string; value: number };

function normalizeConsumi(raw: any, unit: string): ConsumoPoint[] {
  if (!raw) return [];
  const arr: any[] = Array.isArray(raw) ? raw : [];
  if (arr.length === 0) return [];
  const key = unit.toLowerCase(); // "kwh" | "smc"
  const points: ConsumoPoint[] = arr.map((it: any) => {
    if (typeof it === "number") return { mese: "", value: it };
    if (it && typeof it === "object") {
      const mese = String(it.mese ?? it.month ?? "").trim();
      let value = it[key] ?? it.value ?? it.consumo ?? it.kwh ?? it.smc ?? 0;
      value = Number(value);
      if (!isFinite(value)) value = 0;
      return { mese, value };
    }
    return { mese: "", value: 0 };
  });
  // Align to 12 months if we have less
  if (points.length < 12 && points.length > 0) {
    // pad with zeros keeping existing labels
    const padded = points.slice();
    while (padded.length < 12) padded.push({ mese: "", value: 0 });
    return padded.slice(0, 12);
  }
  return points.slice(0, 12);
}

function pointLabel(p: ConsumoPoint, idx: number): string {
  if (p.mese) {
    // Map italian short names like "gen"/"gennaio" to Gen etc
    const m = p.mese.slice(0, 3).toLowerCase();
    const match = MONTHS_IT.find((mm) => mm.toLowerCase() === m);
    if (match) return match;
    return p.mese.slice(0, 3).replace(/^\w/, (x) => x.toUpperCase());
  }
  return MONTHS_IT[idx] || "";
}

function ConsumoBarChart({ data, unit, color }: { data: any; unit: string; color: string }) {
  const points = normalizeConsumi(data, unit);
  if (points.length === 0) return <Text style={{ fontSize: 11, color: theme.color.muted }}>Nessun dato di consumo.</Text>;
  const width = 320;
  const height = 160;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.value));
  // Compute nice Y ticks (4 levels)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const barGap = 3;
  const barW = (chartW / points.length) - barGap;
  return (
    <View style={{ backgroundColor: "#FFF", borderRadius: 8, padding: 6, borderWidth: 1, borderColor: theme.color.border }}>
      <Svg width={width} height={height}>
        {/* Y grid + labels */}
        {yTicks.map((t, i) => {
          const y = padT + chartH - (chartH * (t / max));
          return (
            <React.Fragment key={i}>
              <Line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#E5E7EB" strokeWidth={1} />
              <SvgText x={padL - 4} y={y + 3} fontSize={8} fill="#6B7280" textAnchor="end">{t}</SvgText>
            </React.Fragment>
          );
        })}
        {/* Bars */}
        {points.map((p, i) => {
          const h = (p.value / max) * chartH;
          const x = padL + i * (barW + barGap);
          const y = padT + chartH - h;
          return (
            <React.Fragment key={i}>
              <Rect x={x} y={y} width={barW} height={h} fill={color} rx={2} />
              {/* Value label above bar */}
              {p.value > 0 && (
                <SvgText x={x + barW / 2} y={y - 2} fontSize={7} fill="#374151" textAnchor="middle">{p.value}</SvgText>
              )}
              {/* Month label */}
              <SvgText x={x + barW / 2} y={height - padB + 10} fontSize={8} fill="#6B7280" textAnchor="middle">{pointLabel(p, i)}</SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      <Text style={{ fontSize: 10, color: theme.color.muted, textAlign: "right", marginTop: 2 }}>Unità: {unit}</Text>
    </View>
  );
}

function normalizeNotes(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((x) => x.trim().length > 0);
  const s = String(v).trim();
  if (!s) return [];
  // Split on bullets, newlines, semicolons, or numbered list markers
  const parts = s.split(/(?:\n|;|\u2022|\-\s|\d+\.\s)/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [s];
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

function renderConsumiSvg(rawData: any, unit: string, color: string): string {
  const points = normalizeConsumi(rawData, unit);
  if (points.length === 0) return "";
  const width = 480;
  const height = 200;
  const padL = 40;
  const padR = 10;
  const padT = 14;
  const padB = 34;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.value));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const barGap = 4;
  const barW = (chartW / points.length) - barGap;
  const grid = yTicks.map((t) => {
    const y = padT + chartH - (chartH * (t / max));
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#E5E7EB" stroke-width="1"/>
            <text x="${padL - 4}" y="${y + 3}" font-size="9" fill="#6B7280" text-anchor="end">${t}</text>`;
  }).join("");
  const bars = points.map((p, i) => {
    const h = (p.value / max) * chartH;
    const x = padL + i * (barW + barGap);
    const y = padT + chartH - h;
    const label = pointLabel(p, i);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="3"/>
            ${p.value > 0 ? `<text x="${x + barW / 2}" y="${y - 2}" font-size="8" fill="#374151" text-anchor="middle">${p.value}</text>` : ""}
            <text x="${x + barW / 2}" y="${height - padB + 12}" font-size="9" fill="#6B7280" text-anchor="middle">${esc(label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}${bars}<text x="${width - padR}" y="${height - 4}" font-size="9" fill="#6B7280" text-anchor="end">Unità: ${unit}</text></svg>`;
}

function renderExtractedTable(ex: Record<string, any>, sectionColor = "#6366F1"): string {
  const rows: string[] = [];
  let chartHtml = "";
  let notesHtml = "";
  const consumoKey = ex.consumi_mensili_kwh ? "consumi_mensili_kwh" : ex.consumi_mensili_smc ? "consumi_mensili_smc" : null;
  const consumoUnit = consumoKey?.endsWith("kwh") ? "kWh" : "SMC";
  Object.entries(ex).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    if (k === "consumi_mensili_kwh" || k === "consumi_mensili_smc") {
      const svg = renderConsumiSvg(v, consumoUnit, sectionColor);
      if (svg) chartHtml = `<div style="margin:8px 0;"><div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Consumi mensili (${consumoUnit})</div>${svg}</div>`;
      return;
    }
    if (k === "note_ai") {
      const items = normalizeNotes(v);
      if (items.length === 0) return;
      notesHtml = `<div style="margin:8px 0;"><div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Note AI</div><ul style="margin:0 0 0 18px;padding:0;">${items.map((it) => `<li style="font-size:11px;margin-bottom:3px;line-height:1.4;">${esc(it)}</li>`).join("")}</ul></div>`;
      return;
    }
    if (k === "servizi_inclusi" && Array.isArray(v)) {
      rows.push(`<tr><td style="padding:4px 8px;background:#F1F5F9;font-weight:600;font-size:11px;">${esc(humanKey(k))}</td><td style="padding:4px 8px;font-size:11px;">${esc(v.join(", "))}</td></tr>`);
      return;
    }
    if (Array.isArray(v) || (typeof v === "object" && v !== null)) return;
    const val = String(v);
    rows.push(`<tr><td style="padding:4px 8px;background:#F1F5F9;font-weight:600;font-size:11px;">${esc(humanKey(k))}</td><td style="padding:4px 8px;font-size:11px;">${esc(val)}</td></tr>`);
  });
  const tableHtml = rows.length ? `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;border:1px solid #E5E7EB;">${rows.join("")}</table>` : "";
  return `${tableHtml}${chartHtml}${notesHtml}`;
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
      <div style="margin-bottom:16px;border:1px solid ${sec.color};border-radius:8px;overflow:hidden;padding-bottom:8px;">
        <div style="background:${sec.color};color:#FFF;padding:6px 10px;font-weight:700;font-size:12px;">${esc(it.pdf_name || "Fattura")}</div>
        <div style="padding:8px;">${renderExtractedTable(it.extracted || {}, sec.color)}</div>
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
      ${s.riepilogo_generale ? (() => {
        const rItems = normalizeNotes(s.riepilogo_generale);
        return rItems.length > 1
          ? `<ul style="margin:6px 0 12px 20px;padding:0;">${rItems.map((it) => `<li style="font-size:12px;line-height:1.5;margin-bottom:4px;">${esc(it)}</li>`).join("")}</ul>`
          : `<p style="font-size:13px;line-height:1.5;">${esc(rItems[0] || "")}</p>`;
      })() : ""}
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

function ulList(items: any): string {
  const list = normalizeNotes(items);
  if (list.length === 0) return "";
  return `<ul style="margin:4px 0 8px 20px;padding:0;">${list.map((it) => `<li style="font-size:12px;margin-bottom:3px;line-height:1.5;">${esc(it)}</li>`).join("")}</ul>`;
}

function buildComparisonHtml(rep: any, contactName?: string): string {
  const c = rep?.contact || {};
  const name = contactName || `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cliente";
  const generated = new Date(rep?.generated_at || Date.now()).toLocaleString("it-IT");
  const items = Array.isArray(rep?.items) ? rep.items : [];
  const totalSaving = rep?.risparmio_totale_annuo_eur ? Number(rep.risparmio_totale_annuo_eur) : items.reduce((acc: number, it: any) => acc + (Number(it?.comparison?.risparmio_annuo_stimato_eur) || 0), 0);

  const sectionMeta = (bt: string) => ({
    luce: { label: "Luce", color: "#F59E0B", emoji: "💡" },
    gas: { label: "Gas", color: "#DC2626", emoji: "🔥" },
    telco: { label: "Telco", color: "#0891B2", emoji: "📞" },
  } as any)[bt] || { label: bt, color: "#6366F1", emoji: "📄" };

  const rec = (r: string) => r === "consigliato" ? { color: "#16A34A", label: "✅ CONSIGLIATO" }
    : r === "sconsigliato" ? { color: "#DC2626", label: "⛔ SCONSIGLIATO" }
    : { color: "#F59E0B", label: "⚖️ NEUTRO" };

  const sections = items.map((it: any) => {
    const sm = sectionMeta(it.bill_type);
    const cmp = it.comparison || {};
    const r = rec(cmp.raccomandazione || "neutro");
    const saving = cmp.risparmio_annuo_stimato_eur ? `€ ${cmp.risparmio_annuo_stimato_eur}` : "—";
    const perc = cmp.risparmio_percentuale ? ` (${cmp.risparmio_percentuale}%)` : "";
    return `
      <div style="margin-top:18px;border:1px solid ${sm.color};border-radius:8px;overflow:hidden;">
        <div style="background:${sm.color};color:#FFF;padding:8px 12px;font-weight:800;font-size:14px;display:flex;justify-content:space-between;">
          <span>${sm.emoji} ${sm.label}</span>
          <span style="background:rgba(255,255,255,0.25);padding:2px 8px;border-radius:8px;font-size:11px;">${esc(r.label)}</span>
        </div>
        <div style="padding:12px;">
          <div style="display:flex;gap:12px;margin-bottom:10px;">
            <div style="flex:1;padding:8px;background:#FEE2E2;border-radius:6px;">
              <div style="font-size:10px;color:#991B1B;font-weight:700;text-transform:uppercase;">Offerta attuale cliente</div>
              <div style="font-size:12px;font-weight:800;margin-top:2px;">${esc(it.bill?.extracted?.fornitore || "n/d")}</div>
              <div style="font-size:11px;color:#374151;">${esc(it.bill?.extracted?.nome_offerta || "")}</div>
            </div>
            <div style="flex:1;padding:8px;background:#DCFCE7;border-radius:6px;">
              <div style="font-size:10px;color:#166534;font-weight:700;text-transform:uppercase;">Nostra offerta</div>
              <div style="font-size:12px;font-weight:800;margin-top:2px;">${esc(it.offer?.extracted?.fornitore || "n/d")}</div>
              <div style="font-size:11px;color:#374151;">${esc(it.offer?.extracted?.nome_offerta || it.offer?.label || "")}</div>
            </div>
          </div>

          ${cmp.sintesi ? `<h4 style="margin:8px 0 4px;color:#374151;font-size:13px;">Sintesi</h4>${ulList(cmp.sintesi)}` : ""}
          ${cmp.vantaggi_offerta_aziendale ? `<h4 style="margin:8px 0 4px;color:#16A34A;font-size:13px;">✓ Vantaggi della nostra offerta</h4>${ulList(cmp.vantaggi_offerta_aziendale)}` : ""}
          ${cmp.svantaggi_offerta_aziendale ? `<h4 style="margin:8px 0 4px;color:#DC2626;font-size:13px;">✗ Svantaggi</h4>${ulList(cmp.svantaggi_offerta_aziendale)}` : ""}
          ${cmp.motivazione_raccomandazione ? `<h4 style="margin:8px 0 4px;color:#6366F1;font-size:13px;">Motivazione</h4>${ulList(cmp.motivazione_raccomandazione)}` : ""}
          ${cmp.azione_consigliata ? `<h4 style="margin:8px 0 4px;color:#0891B2;font-size:13px;">Azioni consigliate</h4>${ulList(cmp.azione_consigliata)}` : ""}

          <div style="margin-top:10px;padding:10px;background:#F3E8FF;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:700;color:#5B21B6;">Risparmio annuo stimato</span>
            <span style="font-size:16px;font-weight:900;color:#5B21B6;">${esc(saving)}${esc(perc)}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"/>
<title>Confronto Offerte — ${esc(name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0F172A; margin: 32px; }
  h1 { color: #7C3AED; border-bottom: 3px solid #7C3AED; padding-bottom: 8px; }
  .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #6B7280; margin-bottom: 16px; }
  .total-saving { margin-top:20px; padding:14px; background:linear-gradient(90deg,#7C3AED,#6366F1); color:#FFF; border-radius:10px; text-align:center; }
</style>
</head>
<body>
  <h1>⚖️ Confronto Offerte Energia</h1>
  <div class="header-info">
    <div><b>Cliente:</b> ${esc(name)}${c.contact_code ? ` (${esc(c.contact_code)})` : ""}</div>
    <div><b>Generato:</b> ${esc(generated)}</div>
  </div>
  <div class="total-saving">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.85;">Risparmio annuo totale stimato</div>
    <div style="font-size:28px;font-weight:900;margin-top:4px;">€ ${esc(Math.round(totalSaving))}</div>
  </div>
  ${sections || "<p><i>Nessuna coppia fattura/offerta confrontabile.</i></p>"}
  <div style="margin-top:36px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center;">
    Confronto generato automaticamente con Claude Sonnet 5 · Dal Pastro CRM
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
  bulletRow: { flexDirection: "row", paddingVertical: 2, alignItems: "flex-start" },
  bulletDot: { fontSize: 12, color: theme.color.brandPrimary, width: 14, marginTop: 1 },
  bulletTxt: { fontSize: 11, color: theme.color.onSurface, flex: 1, lineHeight: 15 },
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
  compareBtn: {
    marginTop: 12,
    backgroundColor: "#7C3AED",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
  },
  offersCard: {
    backgroundColor: "#F5F3FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    marginBottom: 16,
    overflow: "hidden",
  },
  offersHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
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
});

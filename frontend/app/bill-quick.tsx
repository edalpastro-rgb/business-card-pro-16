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

  const [associateTarget, setAssociateTarget] = useState<null | Draft>(null);
  const [contactsList, setContactsList] = useState<ContactLite[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      openParamsModal(bill_type, res.assets[0]);
    } catch (e: any) {
      notify("Errore selezione", e?.message || "");
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
                          <FieldRow key={k} name={k} value={v} accent={meta.color} />
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
    </SafeAreaView>
  );
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatVal(v: any): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// V38O — Field renderers for the extracted-data KV list.
//
//   - Monthly-consumption arrays (`consumi_mensili_kwh` / `consumi_mensili_smc`)
//     render as a horizontal bar chart (month labels on X, value on Y).
//   - `parametri_richiesti` renders as an inline mini-list of label:value rows.
//   - `note_ai` renders as a bulleted list, one bullet per array entry.
//   - Everything else falls back to a plain KV row.
type FieldRowProps = { name: string; value: any; accent: string };

function FieldRow({ name, value, accent }: FieldRowProps) {
  const label = humanizeKey(name);
  // Consumi mensili — bar chart
  if ((name === "consumi_mensili_kwh" || name === "consumi_mensili_smc") && Array.isArray(value) && value.length > 0) {
    const key: "kwh" | "smc" = name === "consumi_mensili_kwh" ? "kwh" : "smc";
    return (
      <View style={styles.blockRow}>
        <Text style={styles.blockLabel}>{label}</Text>
        <ConsumptionBarChart data={value as any[]} valueKey={key} accent={accent} />
      </View>
    );
  }
  // Parametri richiesti — vertical sub-rows
  if (name === "parametri_richiesti" && value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, any>);
    if (entries.length === 0) return null;
    return (
      <View style={styles.blockRow}>
        <Text style={styles.blockLabel}>{label}</Text>
        <View style={styles.paramSubBox}>
          {entries.map(([k, v]) => (
            <View key={k} style={styles.paramSubRow}>
              <Text style={styles.paramSubKey} numberOfLines={2}>{humanizeKey(k)}</Text>
              <Text style={styles.paramSubVal} numberOfLines={3}>{formatVal(v)}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  // Note AI — bulleted list
  if (name === "note_ai") {
    let items: string[] = [];
    if (Array.isArray(value)) items = value.map((x) => String(x).trim()).filter(Boolean);
    else if (typeof value === "string") items = value.split(/[\r\n]+/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    if (items.length === 0) return null;
    return (
      <View style={styles.blockRow}>
        <Text style={styles.blockLabel}>{label}</Text>
        <View style={{ gap: 4, marginTop: 4 }}>
          {items.map((t, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: accent }]} />
              <Text style={styles.bulletTxt}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  // Fallback KV row
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{label}</Text>
      <Text style={styles.kvVal}>{formatVal(value)}</Text>
    </View>
  );
}

function ConsumptionBarChart({ data, valueKey, accent }: { data: any[]; valueKey: "kwh" | "smc"; accent: string }) {
  const items = data
    .map((it) => ({ mese: String(it?.mese ?? "").slice(0, 3), value: Number(it?.[valueKey] ?? 0) }))
    .filter((it) => it.mese && Number.isFinite(it.value));
  if (items.length === 0) return <Text style={styles.kvVal}>—</Text>;
  const maxV = Math.max(...items.map((it) => it.value), 1);
  const CHART_H = 120;
  const unit = valueKey === "kwh" ? "kWh" : "Smc";
  const totalV = items.reduce((s, it) => s + it.value, 0);
  return (
    <View style={styles.chartWrap}>
      <View style={styles.chartHeader}>
        <Text style={styles.chartTotal}>Totale: {Math.round(totalV).toLocaleString("it-IT")} {unit}</Text>
        <Text style={styles.chartMax}>Max: {Math.round(maxV).toLocaleString("it-IT")} {unit}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6 }}>
        {items.map((it, idx) => {
          const h = Math.max(2, Math.round((it.value / maxV) * CHART_H));
          return (
            <View key={idx} style={styles.barCol}>
              <Text style={styles.barValue}>{Math.round(it.value)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: h, backgroundColor: accent }]} />
              </View>
              <Text style={styles.barLabel}>{it.mese}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
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
  paramTxt: { fontSize: 12, fontWeight: "600", color: theme.color.onSurface },
  assocRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, gap: 10, marginBottom: 6 },
  assocAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.color.brandTertiary, justifyContent: "center", alignItems: "center" },
  assocName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  assocSub: { fontSize: 11, color: theme.color.muted },
});

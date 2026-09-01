/**
 * V49 — CompanyContactSheet
 *
 * Bottom sheet mostrato dalla Home quando l'utente tocca il bottone
 * "COMUNICA CON L'AZIENDA". Mostra:
 *   • Nome dell'azienda (titolo)
 *   • Email di servizio (tap → mailto:)
 *   • Elenco di numeri di telefono di servizio con etichetta (tap → tel:)
 *
 * Il pannello è configurabile SOLO dal Master (role="owner" && !parent_user_id):
 * toccando "Modifica" può aggiungere/modificare/eliminare numeri, nome ed email.
 * Le altre utenze (agenti/collaboratori) vedono soltanto i dati in modalità
 * consultazione. La configurazione è persistita tramite il modello backend
 * `/settings` (campi communica_azienda_*) così è condivisa in tutto il tenant.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { pickCommonFile } from "@/src/utils/filePicker";
import { FileViewer } from "@/src/FileViewer";
import * as FileSystem from "expo-file-system/legacy";

type Phone = { id: string; label: string; number: string };

type CompanyContactData = {
  communica_azienda_name?: string;
  communica_azienda_email?: string;
  communica_azienda_phones?: Phone[];
};

// V49 — Company PDF (Comunica con l'azienda)
type CompanyDoc = {
  doc_id: string;
  name: string;
  mime?: string;
  size?: number;
  created_at?: string;
};

// V49 — Suggested contact extracted by Axon from a PDF
type ExtractedContact = {
  id: string;
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  label?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

const genId = () => `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const C = {
  primary: "#FF6B35",
  navy: "#1B2B4B",
  muted: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F8FAFC",
  green: "#16A34A",
};

export function CompanyContactSheet({ visible, onClose }: Props) {
  const { user } = useAuth();
  const bottomPad = useBottomSheetPadding();
  const isMaster = user?.role === "owner" && !user?.parent_user_id;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompanyContactData>({});
  const [editMode, setEditMode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhones, setDraftPhones] = useState<Phone[]>([]);
  const [saving, setSaving] = useState(false);

  // V49 — Company PDFs (upload, viewer, delete, AI contact extraction)
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<{ name: string; mime: string; data: string } | null>(null);
  const [viewerLoading, setViewerLoading] = useState<string | null>(null); // doc_id being fetched
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<{ docName: string; items: ExtractedContact[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<CompanyContactData & Record<string, unknown>>("/settings");
      setData({
        communica_azienda_name: s.communica_azienda_name || "",
        communica_azienda_email: s.communica_azienda_email || "",
        communica_azienda_phones: Array.isArray(s.communica_azienda_phones)
          ? (s.communica_azienda_phones as Phone[]).filter((p) => p && p.id)
          : [],
      });
    } catch (e) {
      console.warn("company-sheet load", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const r = await api<{ items: CompanyDoc[] }>("/company-docs");
      setDocs(Array.isArray(r.items) ? r.items : []);
    } catch (e) {
      console.warn("company-docs load", e);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setEditMode(false);
      load();
      loadDocs();
    }
  }, [visible, load, loadDocs]);

  // Sync draft when entering edit mode
  useEffect(() => {
    if (editMode) {
      setDraftName(data.communica_azienda_name || "");
      setDraftEmail(data.communica_azienda_email || "");
      setDraftPhones(
        (data.communica_azienda_phones || []).map((p) => ({ ...p })),
      );
    }
  }, [editMode, data]);

  const phones = useMemo<Phone[]>(
    () => data.communica_azienda_phones || [],
    [data],
  );

  const callNumber = (num: string) => {
    const clean = (num || "").replace(/\s+/g, "");
    if (!clean) return;
    const url = `tel:${clean}`;
    if (Platform.OS === "web") {
      try {
        window.location.href = url;
      } catch {
        /* ignore */
      }
    } else {
      Linking.openURL(url).catch(() =>
        Alert.alert("Chiamata non disponibile", "Impossibile avviare la chiamata."),
      );
    }
  };

  const openMail = (email: string) => {
    if (!email) return;
    const url = `mailto:${email.trim()}`;
    if (Platform.OS === "web") {
      try {
        window.location.href = url;
      } catch {
        /* ignore */
      }
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const addDraftPhone = () => {
    setDraftPhones((prev) => [...prev, { id: genId(), label: "", number: "" }]);
  };

  const updateDraftPhone = (id: string, key: "label" | "number", value: string) => {
    setDraftPhones((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)),
    );
  };

  const removeDraftPhone = (id: string) => {
    setDraftPhones((prev) => prev.filter((p) => p.id !== id));
  };

  // ────────────── V49 · PDF upload / view / delete / AI extract ──────────────
  const uploadDoc = async () => {
    if (!isMaster || uploading) return;
    setUploading(true);
    try {
      const { asset, error, base64 } = await pickCommonFile({ multiple: false });
      if (error || !asset) {
        if (error) Alert.alert("Errore selezione", error);
        return;
      }
      const mime = (asset.mimeType || "").toLowerCase();
      const name = (asset.name || "documento.pdf").toString();
      if (!mime.includes("pdf") && !name.toLowerCase().endsWith(".pdf")) {
        Alert.alert("Formato non supportato", "Al momento sono accettati solo file PDF.");
        return;
      }
      let b64 = base64 || (asset as { _base64?: string })._base64 || "";
      if (!b64 && asset.uri) {
        try {
          if (asset.uri.startsWith("data:")) {
            const c = asset.uri.indexOf(",");
            if (c > 0) b64 = asset.uri.slice(c + 1);
          } else if (Platform.OS === "web") {
            const resp = await fetch(asset.uri);
            const blob = await resp.blob();
            b64 = await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onerror = () => rej(new Error("FileReader error"));
              r.onload = () => {
                const s = String(r.result || "");
                const cc = s.indexOf(",");
                res(cc >= 0 ? s.slice(cc + 1) : s);
              };
              r.readAsDataURL(blob);
            });
          } else {
            b64 = await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        } catch (e: any) {
          Alert.alert("Errore lettura", e?.message || String(e));
          return;
        }
      }
      if (!b64) {
        Alert.alert("File vuoto", "Impossibile leggere il PDF selezionato.");
        return;
      }
      await api("/company-docs", {
        method: "POST",
        body: { name, mime: "application/pdf", file_base64: b64 },
      });
      await loadDocs();
    } catch (e: any) {
      Alert.alert("Upload fallito", e?.message || String(e));
    } finally {
      setUploading(false);
    }
  };

  const openDoc = async (doc: CompanyDoc) => {
    if (viewerLoading) return;
    setViewerLoading(doc.doc_id);
    try {
      const r = await api<{ file_base64: string; mime?: string; name?: string }>(
        `/company-docs/${doc.doc_id}/file`,
      );
      if (!r?.file_base64) {
        Alert.alert("Errore", "Impossibile caricare il PDF.");
        return;
      }
      setViewer({
        name: r.name || doc.name || "documento.pdf",
        mime: r.mime || doc.mime || "application/pdf",
        data: r.file_base64,
      });
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aprire il documento.");
    } finally {
      setViewerLoading(null);
    }
  };

  const deleteDoc = (doc: CompanyDoc) => {
    if (!isMaster) return;
    const confirmMsg = `Vuoi davvero eliminare "${doc.name}"?`;
    const doDelete = async () => {
      try {
        await api(`/company-docs/${doc.doc_id}`, { method: "DELETE" });
        setDocs((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));
      } catch (e: any) {
        Alert.alert("Errore", e?.message || "Impossibile eliminare il documento.");
      }
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(confirmMsg)) {
        void doDelete();
      }
    } else {
      Alert.alert("Elimina documento", confirmMsg, [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const extractContacts = async (doc: CompanyDoc) => {
    if (!isMaster || extractingId) return;
    setExtractingId(doc.doc_id);
    try {
      const r = await api<{ contacts: ExtractedContact[]; total: number }>(
        `/company-docs/${doc.doc_id}/extract-contacts`,
        { method: "POST" },
      );
      const items = Array.isArray(r?.contacts) ? r.contacts : [];
      setExtractResult({ docName: doc.name, items });
      if (items.length === 0) {
        Alert.alert("Nessun contatto trovato", "Axon non ha trovato contatti utili in questo PDF.");
      }
    } catch (e: any) {
      Alert.alert("Errore Axon", e?.message || "Estrazione non riuscita.");
    } finally {
      setExtractingId(null);
    }
  };

  const addExtractedToPanel = async (c: ExtractedContact) => {
    // Append phone to current settings (if present); otherwise nothing to add.
    // If only email is present we can't push a phone entry, but we can inform.
    if (!c.phone) {
      Alert.alert(
        "Contatto senza telefono",
        c.email
          ? `Questo contatto ha solo l'email "${c.email}". Aggiornala manualmente nell'email di servizio se necessario.`
          : "Nessun numero utilizzabile.",
      );
      return;
    }
    setSaving(true);
    try {
      const current = await api<Record<string, unknown>>("/settings");
      const existing = Array.isArray((current as any).communica_azienda_phones)
        ? ((current as any).communica_azienda_phones as Phone[])
        : [];
      const label = (c.label || c.name || c.role || "Contatto").trim();
      const number = c.phone.trim();
      // Skip duplicates (same normalized number)
      const norm = (n: string) => n.replace(/[^\d+]/g, "");
      if (existing.some((p) => norm(p.number) === norm(number))) {
        Alert.alert("Numero già presente", "Questo numero è già configurato nel pannello.");
        return;
      }
      const nextPhones: Phone[] = [
        ...existing,
        { id: genId(), label, number },
      ];
      const body = {
        ...current,
        communica_azienda_phones: nextPhones,
      };
      delete (body as any)._id;
      delete (body as any).user_id;
      const updated = await api<CompanyContactData>("/settings", { method: "PUT", body });
      setData({
        communica_azienda_name: updated.communica_azienda_name || "",
        communica_azienda_email: updated.communica_azienda_email || "",
        communica_azienda_phones: updated.communica_azienda_phones || [],
      });
      // Remove added item from result list
      setExtractResult((prev) =>
        prev ? { ...prev, items: prev.items.filter((x) => x.id !== c.id) } : prev,
      );
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aggiungere il contatto.");
    } finally {
      setSaving(false);
    }
  };

  const formatSize = (n?: number) => {
    if (!n || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      // Filter out entries with no number; keep label if present
      const cleaned = draftPhones
        .map((p) => ({
          id: p.id || genId(),
          label: (p.label || "").trim(),
          number: (p.number || "").trim(),
        }))
        .filter((p) => p.number.length > 0);
      // Load current settings so we don't overwrite unrelated fields on PUT.
      const current = await api<Record<string, unknown>>("/settings");
      const body = {
        ...current,
        communica_azienda_name: draftName.trim(),
        communica_azienda_email: draftEmail.trim(),
        communica_azienda_phones: cleaned,
      };
      // Remove non-model fields from the body to avoid validation errors.
      delete (body as any)._id;
      delete (body as any).user_id;
      const updated = await api<CompanyContactData>("/settings", {
        method: "PUT",
        body,
      });
      setData({
        communica_azienda_name: updated.communica_azienda_name || "",
        communica_azienda_email: updated.communica_azienda_email || "",
        communica_azienda_phones: updated.communica_azienda_phones || [],
      });
      setEditMode(false);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile salvare le modifiche.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[styles.sheet, { paddingBottom: bottomPad + 12 }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          <View style={styles.hdrRow}>
            <View style={styles.hdrIcon}>
              <Ionicons name="business" size={20} color="#FFF" />
            </View>
            <Text style={styles.hdrLabel} numberOfLines={1}>
              Comunica con l&apos;azienda
            </Text>
            {isMaster && !editMode && (
              <Pressable
                onPress={() => setEditMode(true)}
                hitSlop={8}
                style={styles.editBtn}
                testID="company-sheet-edit"
              >
                <Ionicons name="create" size={16} color={C.primary} />
                <Text style={styles.editBtnTxt}>Modifica</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onClose}
              hitSlop={10}
              testID="company-sheet-close"
              style={{ marginLeft: 4 }}
            >
              <Ionicons name="close" size={22} color={C.navy} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            {editMode ? (
              // ─────────── EDIT MODE (Master) ───────────
              <>
                <Text style={styles.fieldLbl}>Nome azienda</Text>
                <TextInput
                  testID="company-sheet-name-input"
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder="Es. AdvisorOS S.r.l."
                  placeholderTextColor={C.muted}
                  style={styles.input}
                />

                <Text style={[styles.fieldLbl, { marginTop: 6 }]}>Email di servizio</Text>
                <TextInput
                  testID="company-sheet-email-input"
                  value={draftEmail}
                  onChangeText={setDraftEmail}
                  placeholder="Es. info@advisoros.it"
                  placeholderTextColor={C.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={styles.input}
                />

                <View style={styles.phonesHdr}>
                  <Text style={styles.fieldLbl}>Numeri di telefono di servizio</Text>
                  <Pressable
                    onPress={addDraftPhone}
                    style={styles.addBtn}
                    testID="company-sheet-add-phone"
                  >
                    <Ionicons name="add" size={16} color="#FFF" />
                    <Text style={styles.addBtnTxt}>Aggiungi</Text>
                  </Pressable>
                </View>

                {draftPhones.length === 0 ? (
                  <Text style={styles.empty}>
                    Nessun numero. Tocca &quot;Aggiungi&quot; per inserire il primo.
                  </Text>
                ) : (
                  draftPhones.map((p) => (
                    <View key={p.id} style={styles.phoneEditRow}>
                      <View style={{ flex: 1, gap: 6 }}>
                        <TextInput
                          testID={`company-sheet-phone-label-${p.id}`}
                          value={p.label}
                          onChangeText={(t) => updateDraftPhone(p.id, "label", t)}
                          placeholder="Etichetta (es. Assistenza Consulenti)"
                          placeholderTextColor={C.muted}
                          style={[styles.input, { fontSize: 13 }]}
                        />
                        <TextInput
                          testID={`company-sheet-phone-number-${p.id}`}
                          value={p.number}
                          onChangeText={(t) => updateDraftPhone(p.id, "number", t)}
                          placeholder="Numero (es. +39 02 1234 5678)"
                          placeholderTextColor={C.muted}
                          keyboardType="phone-pad"
                          style={[styles.input, { fontSize: 13 }]}
                        />
                      </View>
                      <Pressable
                        onPress={() => removeDraftPhone(p.id)}
                        hitSlop={6}
                        style={styles.trashBtn}
                        testID={`company-sheet-remove-phone-${p.id}`}
                      >
                        <Ionicons name="trash" size={16} color="#DC2626" />
                      </Pressable>
                    </View>
                  ))
                )}

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => setEditMode(false)}
                    style={styles.btnGhost}
                    disabled={saving}
                    testID="company-sheet-cancel"
                  >
                    <Text style={styles.btnGhostTxt}>Annulla</Text>
                  </Pressable>
                  <Pressable
                    onPress={saveChanges}
                    style={[styles.btnSave, saving && { opacity: 0.6 }]}
                    disabled={saving}
                    testID="company-sheet-save"
                  >
                    <Ionicons name="save" size={16} color="#FFF" />
                    <Text style={styles.btnSaveTxt}>{saving ? "Salvo…" : "Salva"}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              // ─────────── VIEW MODE ───────────
              <>
                <Text style={styles.companyName}>
                  {data.communica_azienda_name?.trim() || (loading ? "Caricamento…" : "Azienda")}
                </Text>

                {data.communica_azienda_email ? (
                  <Pressable
                    onPress={() => openMail(data.communica_azienda_email || "")}
                    style={styles.emailRow}
                    testID="company-sheet-email"
                  >
                    <View style={[styles.rowIcon, { backgroundColor: "#DBEAFE" }]}>
                      <Ionicons name="mail" size={18} color="#1D4ED8" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>Email</Text>
                      <Text style={styles.rowValue} numberOfLines={1}>
                        {data.communica_azienda_email}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.muted} />
                  </Pressable>
                ) : null}

                {phones.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="call" size={22} color={C.muted} />
                    <Text style={styles.emptyTxt}>Nessun numero configurato</Text>
                    {isMaster ? (
                      <Text style={styles.emptySub}>
                        Tocca &quot;Modifica&quot; per aggiungere numeri di servizio
                      </Text>
                    ) : (
                      <Text style={styles.emptySub}>
                        Chiedi al tuo Master di configurare i numeri di servizio
                      </Text>
                    )}
                  </View>
                ) : (
                  phones.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => callNumber(p.number)}
                      style={styles.phoneRow}
                      testID={`company-sheet-call-${p.id}`}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: "#DCFCE7" }]}>
                        <Ionicons name="call" size={18} color={C.green} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          {p.label || "Contatto"}
                        </Text>
                        <Text style={styles.rowValueBig} numberOfLines={1}>
                          {p.number}
                        </Text>
                      </View>
                      <View style={styles.callBadge}>
                        <Ionicons name="call" size={14} color="#FFF" />
                      </View>
                    </Pressable>
                  ))
                )}

                {/* V49 — Documenti aziendali (PDF) + AI extraction */}
                <View style={styles.docsHdrRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="document-attach" size={16} color={C.navy} />
                    <Text style={styles.sectionTitle}>Documenti aziendali</Text>
                  </View>
                  {isMaster && (
                    <Pressable
                      onPress={uploadDoc}
                      disabled={uploading}
                      style={[styles.addBtn, uploading && { opacity: 0.6 }]}
                      testID="company-sheet-upload-doc"
                    >
                      {uploading ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Ionicons name="cloud-upload" size={14} color="#FFF" />
                          <Text style={styles.addBtnTxt}>Carica PDF</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>

                {docsLoading ? (
                  <ActivityIndicator style={{ marginVertical: 16 }} color={C.primary} />
                ) : docs.length === 0 ? (
                  <View style={styles.emptyBoxSmall}>
                    <Ionicons name="document-text-outline" size={22} color={C.muted} />
                    <Text style={styles.emptyTxt}>Nessun PDF caricato</Text>
                    {isMaster ? (
                      <Text style={styles.emptySub}>Tocca &quot;Carica PDF&quot; per aggiungere un documento aziendale</Text>
                    ) : (
                      <Text style={styles.emptySub}>Chiedi al tuo Master di caricare i documenti aziendali</Text>
                    )}
                  </View>
                ) : (
                  docs.map((d) => (
                    <View key={d.doc_id} style={styles.docCard}>
                      <Pressable
                        onPress={() => openDoc(d)}
                        style={styles.docTopRow}
                        testID={`company-sheet-doc-${d.doc_id}`}
                      >
                        <View style={[styles.rowIcon, { backgroundColor: "#FEE2E2" }]}>
                          {viewerLoading === d.doc_id ? (
                            <ActivityIndicator size="small" color="#DC2626" />
                          ) : (
                            <Ionicons name="document-text" size={18} color="#DC2626" />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.docName} numberOfLines={1}>
                            {d.name || "documento.pdf"}
                          </Text>
                          <Text style={styles.docMeta}>
                            {formatSize(d.size)}
                            {d.size && d.created_at ? " · " : ""}
                            {d.created_at
                              ? new Date(d.created_at).toLocaleDateString("it-IT", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })
                              : ""}
                          </Text>
                        </View>
                        <Ionicons name="eye" size={18} color={C.muted} />
                      </Pressable>

                      {isMaster && (
                        <View style={styles.docActionsRow}>
                          <Pressable
                            onPress={() => extractContacts(d)}
                            disabled={extractingId === d.doc_id}
                            style={[
                              styles.axonBtn,
                              extractingId === d.doc_id && { opacity: 0.6 },
                            ]}
                            testID={`company-sheet-extract-${d.doc_id}`}
                          >
                            {extractingId === d.doc_id ? (
                              <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                              <>
                                <Ionicons name="sparkles" size={14} color="#FFF" />
                                <Text style={styles.axonBtnTxt}>Estrai contatti con Axon</Text>
                              </>
                            )}
                          </Pressable>
                          <Pressable
                            onPress={() => deleteDoc(d)}
                            hitSlop={6}
                            style={styles.trashBtnSmall}
                            testID={`company-sheet-delete-doc-${d.doc_id}`}
                          >
                            <Ionicons name="trash" size={16} color="#DC2626" />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ))
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Pressable>

      {/* V49 — In-app PDF viewer */}
      {viewer && (
        <FileViewer
          visible={!!viewer}
          fileName={viewer.name}
          mime={viewer.mime}
          dataBase64={viewer.data}
          onClose={() => setViewer(null)}
        />
      )}

      {/* V49 — Extracted contacts result modal */}
      <Modal
        transparent
        visible={!!extractResult}
        animationType="slide"
        onRequestClose={() => setExtractResult(null)}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: bottomPad + 12 }]}>
            <View style={styles.handle} />
            <View style={styles.hdrRow}>
              <View style={[styles.hdrIcon, { backgroundColor: "#7C3AED" }]}>
                <Ionicons name="sparkles" size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hdrLabel} numberOfLines={1}>
                  Contatti trovati da Axon
                </Text>
                <Text style={styles.extractSub} numberOfLines={1}>
                  {extractResult?.docName || ""}
                </Text>
              </View>
              <Pressable onPress={() => setExtractResult(null)} hitSlop={10} testID="company-sheet-extract-close">
                <Ionicons name="close" size={22} color={C.navy} />
              </Pressable>
            </View>
            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ padding: 16, gap: 10 }}
            >
              {(extractResult?.items || []).length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="search" size={22} color={C.muted} />
                  <Text style={styles.emptyTxt}>Nessun contatto suggerito</Text>
                  <Text style={styles.emptySub}>
                    Axon non ha trovato altri contatti da suggerire in questo PDF.
                  </Text>
                </View>
              ) : (
                (extractResult?.items || []).map((c) => (
                  <View key={c.id} style={styles.extractCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docName} numberOfLines={1}>
                        {c.label || c.name || c.role || "Contatto"}
                      </Text>
                      {!!c.phone && (
                        <Text style={styles.extractLine} numberOfLines={1}>
                          📞 {c.phone}
                        </Text>
                      )}
                      {!!c.email && (
                        <Text style={styles.extractLine} numberOfLines={1}>
                          ✉️ {c.email}
                        </Text>
                      )}
                    </View>
                    <Pressable
                      onPress={() => addExtractedToPanel(c)}
                      disabled={saving || !c.phone}
                      style={[
                        styles.axonBtn,
                        { paddingHorizontal: 12 },
                        (saving || !c.phone) && { opacity: 0.5 },
                      ]}
                      testID={`company-sheet-add-extracted-${c.id}`}
                    >
                      <Ionicons name="add-circle" size={14} color="#FFF" />
                      <Text style={styles.axonBtnTxt}>
                        {c.phone ? "Aggiungi" : "Solo email"}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    marginBottom: 6,
  },
  hdrRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF0F4",
  },
  hdrIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  hdrLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: C.navy,
    letterSpacing: -0.2,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#FFF1E9",
    borderWidth: 1,
    borderColor: C.primary,
  },
  editBtnTxt: { fontSize: 12, fontWeight: "800", color: C.primary },
  companyName: {
    fontSize: 22,
    fontWeight: "900",
    color: C.navy,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.bg,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 11, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  rowValue: { fontSize: 14, fontWeight: "700", color: C.navy, marginTop: 2 },
  rowValueBig: { fontSize: 18, fontWeight: "900", color: C.navy, letterSpacing: -0.3, marginTop: 2 },
  callBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLbl: { fontSize: 12, fontWeight: "800", color: C.navy, letterSpacing: -0.1 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: C.navy,
    backgroundColor: "#FFF",
  },
  phonesHdr: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: C.primary,
  },
  addBtnTxt: { fontSize: 12, fontWeight: "800", color: "#FFF" },
  phoneEditRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: C.bg,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  trashBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  empty: { fontSize: 12, color: C.muted, fontStyle: "italic", textAlign: "center", padding: 12 },
  emptyBox: {
    alignItems: "center",
    padding: 20,
    gap: 6,
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.border,
  },
  emptyTxt: { fontSize: 14, fontWeight: "800", color: C.navy },
  emptySub: { fontSize: 11, color: C.muted, textAlign: "center" },
  actionsRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "#F1F5F9" },
  btnGhostTxt: { fontSize: 13, fontWeight: "800", color: "#64748B" },
  btnSave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.primary,
  },
  btnSaveTxt: { fontSize: 13, fontWeight: "800", color: "#FFF" },
  // V49 — Documenti aziendali + estrazione Axon
  docsHdrRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: C.navy, letterSpacing: -0.2 },
  emptyBoxSmall: {
    alignItems: "center",
    padding: 14,
    gap: 4,
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.border,
  },
  docCard: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    gap: 8,
  },
  docTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  docName: { fontSize: 13, fontWeight: "800", color: C.navy },
  docMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  docActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 8,
  },
  axonBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#7C3AED",
  },
  axonBtnTxt: { fontSize: 12, fontWeight: "800", color: "#FFF" },
  trashBtnSmall: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  extractSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  extractCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  extractLine: { fontSize: 12, color: "#334155", marginTop: 2, fontWeight: "600" },
});

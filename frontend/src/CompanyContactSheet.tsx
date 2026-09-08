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
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system/legacy";

type Phone = { id: string; label: string; number: string };

// V50.z58 — Company Web Links ("Link utili" in Comunica con l'azienda)
type CompanyLink = { link_id: string; title: string; url: string; icon: string; order?: number };

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

  // V50.z58 — Link utili (tenant-scoped, gestibili solo dal Master)
  const [links, setLinks] = useState<CompanyLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkEditor, setLinkEditor] = useState<{ mode: "add" | "edit"; link_id?: string; title: string; url: string; icon: string } | null>(null);
  const [linkSaving, setLinkSaving] = useState(false);
  const [webView, setWebView] = useState<{ title: string; url: string } | null>(null);
  const [linkImporting, setLinkImporting] = useState(false);

  const loadLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const r = await api<{ items: CompanyLink[] }>("/company-web-links");
      setLinks(Array.isArray(r.items) ? r.items : []);
    } catch (e) {
      console.warn("company-web-links load", e);
    } finally {
      setLinksLoading(false);
    }
  }, []);

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
      loadLinks();
    }
  }, [visible, load, loadDocs, loadLinks]);

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

  // V50.z58 — CRUD Link utili
  const openLinkEditor = (link?: CompanyLink) => {
    if (link) {
      setLinkEditor({ mode: "edit", link_id: link.link_id, title: link.title, url: link.url, icon: link.icon || "🔗" });
    } else {
      setLinkEditor({ mode: "add", title: "", url: "", icon: "🔗" });
    }
  };

  const saveLinkEditor = async () => {
    if (!linkEditor) return;
    const title = linkEditor.title.trim();
    const url = linkEditor.url.trim();
    if (!title || !url) {
      Alert.alert("Campi mancanti", "Inserisci titolo e URL.");
      return;
    }
    setLinkSaving(true);
    try {
      if (linkEditor.mode === "edit" && linkEditor.link_id) {
        await api(`/company-web-links/${linkEditor.link_id}`, {
          method: "PUT",
          body: { title, url, icon: linkEditor.icon },
        });
      } else {
        await api("/company-web-links", {
          method: "POST",
          body: { title, url, icon: linkEditor.icon },
        });
      }
      setLinkEditor(null);
      await loadLinks();
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Salvataggio non riuscito.");
    } finally {
      setLinkSaving(false);
    }
  };

  const removeLink = (lk: CompanyLink) => {
    const doDelete = async () => {
      try {
        await api(`/company-web-links/${lk.link_id}`, { method: "DELETE" });
        await loadLinks();
      } catch (e: any) {
        Alert.alert("Errore", e?.message || "Eliminazione non riuscita.");
      }
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`Eliminare "${lk.title}"?`)) void doDelete();
    } else {
      Alert.alert("Elimina link", `Vuoi davvero eliminare "${lk.title}"?`, [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const importFromMyWeb = async () => {
    setLinkImporting(true);
    try {
      const r = await api<{ added: number }>("/company-web-links/import-from-my-web", { method: "POST" });
      await loadLinks();
      Alert.alert("Import completato", r.added > 0 ? `Importati ${r.added} link da My Web.` : "Nessun nuovo link da importare (sono già presenti).");
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Import non riuscito.");
    } finally {
      setLinkImporting(false);
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
                        {/* V50.z57 — Nome del bottone: campo dedicato con
                            label chiaro, maxLength 60 e multi-riga per far
                            vedere al Master l'intero testo mentre digita. */}
                        <Text style={styles.editSubLbl}>Nome del bottone</Text>
                        <TextInput
                          testID={`company-sheet-phone-label-${p.id}`}
                          value={p.label}
                          onChangeText={(t) => updateDraftPhone(p.id, "label", t)}
                          placeholder="Es. Assistenza tecnica consulenti"
                          placeholderTextColor={C.muted}
                          maxLength={60}
                          multiline
                          style={[styles.input, styles.inputLabelMulti]}
                        />
                        <Text style={styles.editSubLbl}>Numero</Text>
                        <TextInput
                          testID={`company-sheet-phone-number-${p.id}`}
                          value={p.number}
                          onChangeText={(t) => updateDraftPhone(p.id, "number", t)}
                          placeholder="Es. +39 02 1234 5678"
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
                        {/* V50.z57 — Nome bottone: rimosso `numberOfLines={1}`
                            per permettere nomi più lunghi (fino a 2 righe).
                            Il Master può inserire nomi descrittivi come
                            "Assistenza tecnica consulenti energia". */}
                        <Text style={styles.rowLabel} numberOfLines={2}>
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

                {/* V50.z58 — Link utili (aziendali, gestibili dal Master).
                    Ogni link si apre in WebView interna (Modal) senza uscire
                    dall'app. Il Master aggiunge/modifica/elimina; gli agenti
                    li vedono in sola lettura. */}
                <View style={styles.docsHdrRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                    <Ionicons name="link" size={16} color={C.navy} />
                    <Text style={styles.sectionTitle}>Link utili</Text>
                  </View>
                  {isMaster && (
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Pressable
                        onPress={importFromMyWeb}
                        disabled={linkImporting}
                        style={[styles.addBtn, { backgroundColor: "#7C3AED" }, linkImporting && { opacity: 0.6 }]}
                        testID="company-sheet-import-my-web"
                      >
                        {linkImporting ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <>
                            <Ionicons name="download" size={14} color="#FFF" />
                            <Text style={styles.addBtnTxt}>Da My Web</Text>
                          </>
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => openLinkEditor()}
                        style={styles.addBtn}
                        testID="company-sheet-add-link"
                      >
                        <Ionicons name="add" size={14} color="#FFF" />
                        <Text style={styles.addBtnTxt}>Aggiungi</Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                {linksLoading ? (
                  <ActivityIndicator color={C.navy} style={{ marginVertical: 8 }} />
                ) : links.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyTxt}>
                      {isMaster
                        ? "Nessun link. Tocca \"Aggiungi\" o importa quelli della tua sezione My Web."
                        : "Il tuo Master non ha ancora configurato i link utili."}
                    </Text>
                  </View>
                ) : (
                  links.map((lk) => (
                    <View key={lk.link_id} style={styles.linkRow}>
                      <Pressable
                        onPress={() => setWebView({ title: lk.title, url: lk.url })}
                        style={styles.linkRowInner}
                        testID={`company-sheet-open-link-${lk.link_id}`}
                      >
                        <Text style={styles.linkIcon}>{lk.icon || "🔗"}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.linkTitle} numberOfLines={2}>{lk.title}</Text>
                          <Text style={styles.linkUrl} numberOfLines={1}>
                            {(lk.url || "").replace(/^https?:\/\//, "")}
                          </Text>
                        </View>
                        <Ionicons name="open-outline" size={18} color={C.muted} />
                      </Pressable>
                      {isMaster && (
                        <View style={styles.linkActions}>
                          <Pressable
                            onPress={() => openLinkEditor(lk)}
                            hitSlop={6}
                            style={styles.linkActionBtn}
                            testID={`company-sheet-edit-link-${lk.link_id}`}
                          >
                            <Ionicons name="pencil" size={14} color={C.navy} />
                          </Pressable>
                          <Pressable
                            onPress={() => removeLink(lk)}
                            hitSlop={6}
                            style={styles.linkActionBtn}
                            testID={`company-sheet-delete-link-${lk.link_id}`}
                          >
                            <Ionicons name="trash" size={14} color="#DC2626" />
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

      {/* V50.z58 — Link editor (add/edit): Master-only */}
      {linkEditor && (
        <Modal
          transparent
          visible={!!linkEditor}
          animationType="slide"
          onRequestClose={() => setLinkEditor(null)}
        >
          <Pressable style={styles.backdrop} onPress={() => setLinkEditor(null)}>
            <View style={styles.linkSheet} onStartShouldSetResponder={() => true}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {linkEditor.mode === "edit" ? "Modifica link" : "Nuovo link"}
              </Text>
              <Text style={styles.fieldLbl}>Nome (titolo del bottone)</Text>
              <TextInput
                value={linkEditor.title}
                onChangeText={(t) => setLinkEditor({ ...linkEditor, title: t })}
                placeholder="Es. Portale ENEL Consulenti"
                placeholderTextColor={C.muted}
                maxLength={80}
                style={styles.input}
                testID="company-sheet-link-title"
              />
              <Text style={[styles.fieldLbl, { marginTop: 8 }]}>URL</Text>
              <TextInput
                value={linkEditor.url}
                onChangeText={(t) => setLinkEditor({ ...linkEditor, url: t })}
                placeholder="www.esempio.com"
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                keyboardType="url"
                style={styles.input}
                testID="company-sheet-link-url"
              />
              <Text style={[styles.fieldLbl, { marginTop: 8 }]}>Icona</Text>
              <View style={styles.iconRow}>
                {LINK_ICONS.map((emo) => (
                  <Pressable
                    key={emo}
                    onPress={() => setLinkEditor({ ...linkEditor, icon: emo })}
                    style={[styles.iconOpt, linkEditor.icon === emo && styles.iconOptActive]}
                    testID={`company-sheet-link-icon-${emo}`}
                  >
                    <Text style={{ fontSize: 20 }}>{emo}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.actionsRow}>
                <Pressable
                  onPress={() => setLinkEditor(null)}
                  style={styles.btnGhost}
                  disabled={linkSaving}
                  testID="company-sheet-link-cancel"
                >
                  <Text style={styles.btnGhostTxt}>Annulla</Text>
                </Pressable>
                <Pressable
                  onPress={saveLinkEditor}
                  style={[styles.btnSave, linkSaving && { opacity: 0.6 }]}
                  disabled={linkSaving}
                  testID="company-sheet-link-save"
                >
                  {linkSaving ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="save" size={16} color="#FFF" />
                      <Text style={styles.btnSaveTxt}>Salva</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Modal>
      )}

      {/* V50.z58 — WebView interna: apre l'URL dentro l'app.
          Riusa FileViewer che embed WebView + header con back + share. */}
      {webView && (
        <Modal visible={!!webView} animationType="slide" onRequestClose={() => setWebView(null)}>
          <InAppWebViewer
            title={webView.title}
            url={webView.url}
            onClose={() => setWebView(null)}
          />
        </Modal>
      )}
    </Modal>
  );
}

// V50.z58 — Icone disponibili per i Link utili
const LINK_ICONS = ["🔗","⚡","🔥","📊","📰","🏦","💼","📞","🌐","📈","🛒","💰","🎯","🔧","📱","📧","📅","🎓","⭐","🚀"];

// V50.z58 — In-app WebView per aprire i Link utili senza uscire dall'app.
// Componente separato per usare i hook.
function InAppWebViewer({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const openExternal = () => {
    Linking.openURL(url).catch(() => Alert.alert("Errore", "Impossibile aprire il link nel browser"));
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={inAppWebStyles.header}>
        <Pressable onPress={onClose} hitSlop={8} testID="inapp-webview-close">
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={inAppWebStyles.title} numberOfLines={1}>{title || "Link"}</Text>
        <Pressable onPress={openExternal} hitSlop={8} testID="inapp-webview-external">
          <Ionicons name="open-outline" size={22} color="#FFF" />
        </Pressable>
      </View>
      <View style={{ flex: 1, backgroundColor: "#FFF" }}>
        {Platform.OS === "web" ? (
          // @ts-expect-error web only
          <iframe src={url} title={title} style={{ width: "100%", height: "100%", border: "none" }} />
        ) : (
          <WebView
            source={{ uri: url }}
            style={{ flex: 1 }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(e: any) => {
              setLoading(false);
              setErrMsg(e?.nativeEvent?.description || "Impossibile caricare la pagina");
            }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            originWhitelist={["*"]}
          />
        )}
        {loading && Platform.OS !== "web" ? (
          <View style={inAppWebStyles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color="#0EA5E9" />
          </View>
        ) : null}
        {errMsg ? (
          <View style={inAppWebStyles.errBox}>
            <Ionicons name="warning" size={22} color="#DC2626" />
            <Text style={inAppWebStyles.errTxt}>{errMsg}</Text>
            <Pressable onPress={openExternal} style={inAppWebStyles.errBtn}>
              <Text style={inAppWebStyles.errBtnTxt}>Apri nel browser</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const inAppWebStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 44 : 12,
    paddingBottom: 10,
    backgroundColor: "#0F172A",
  },
  title: { color: "#FFF", fontSize: 15, fontWeight: "700", flex: 1, marginHorizontal: 12, textAlign: "center" },
  loader: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)" },
  errBox: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, backgroundColor: "#FFF" },
  errTxt: { color: "#DC2626", fontSize: 13, textAlign: "center" },
  errBtn: { backgroundColor: "#0EA5E9", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  errBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});

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
  // V50.z57 — Sotto-label per ogni campo modificabile del bottone (edit-mode)
  editSubLbl: { fontSize: 11, fontWeight: "700", color: C.muted, marginTop: 2, marginBottom: -2 },
  // Multi-line input per il nome del bottone (fino a 3 righe visibili prima dello scroll interno)
  inputLabelMulti: { fontSize: 13, minHeight: 42, textAlignVertical: "top" },
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

  // V50.z58 — Link utili
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  linkRowInner: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  linkIcon: { fontSize: 26 },
  linkTitle: { fontSize: 14, fontWeight: "800", color: C.navy },
  linkUrl: { fontSize: 11, color: C.muted, marginTop: 2 },
  linkActions: { flexDirection: "row", gap: 6 },
  linkActionBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center",
  },
  // Editor link modal
  linkSheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 16, paddingBottom: 30,
  },
  sheetHandle: {
    alignSelf: "center", width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#CBD5E1", marginBottom: 12,
  },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: C.navy, marginBottom: 10 },
  iconRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  iconOpt: { padding: 8, borderRadius: 10, backgroundColor: "#F1F5F9" },
  iconOptActive: { backgroundColor: "#DBEAFE", borderWidth: 2, borderColor: C.primary },
});

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
import { KScrollView, KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { Modal, View, Text, StyleSheet, Pressable, Linking, TextInput, Platform, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useRole } from "@/src/useRole"; // V50.z436 — permessi centralizzati
import { useBottomSheetPadding } from "@/src/utils/bottomSheetInsets";
import { pickCommonFile } from "@/src/utils/filePicker";
import { FileViewer } from "@/src/FileViewer";
import { InAppWebViewer } from "@/src/InAppWebViewer";
import { notify } from "@/src/utils/notify";
import * as FileSystem from "expo-file-system/legacy";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

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
  navy: HT.text,
  muted: HT.muted,
  border: "#E2E8F0",
  bg: HT.card2,
  green: "#16A34A",
};

export function CompanyContactSheet({ visible, onClose }: Props) {
  const { user } = useAuth();
  const bottomPad = useBottomSheetPadding();
  const { isMaster } = useRole();

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
  // V50.z63 — Picker "Da My Web": mostra tutti i link personali con checkbox
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLinks, setPickerLinks] = useState<CompanyLink[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);

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

  // V50.z145 — "Modifica" consente SOLO di modificare/eliminare i contatti esistenti
  // (estratti dal PDF o già presenti). L'inserimento manuale avviene dal bottone
  // separato "+ Aggiungi contatto" in view-mode (form inline, nessun modal annidato).
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addNumber, setAddNumber] = useState("");

  const addManualContact = async () => {
    const label = addLabel.trim();
    const number = addNumber.trim();
    if (!number) {
      Alert.alert("Numero mancante", "Inserisci il numero di telefono.");
      return;
    }
    setSaving(true);
    try {
      const current = await api<Record<string, unknown>>("/settings");
      const existing = Array.isArray((current as any).communica_azienda_phones)
        ? ((current as any).communica_azienda_phones as Phone[])
        : [];
      const norm = (n: string) => n.replace(/[^\d+]/g, "");
      if (existing.some((p) => norm(p.number) === norm(number))) {
        Alert.alert("Numero già presente", "Questo numero è già configurato nel pannello.");
        return;
      }
      const body = {
        ...current,
        communica_azienda_phones: [...existing, { id: genId(), label: label || "Contatto", number }],
      };
      delete (body as any)._id;
      delete (body as any).user_id;
      const updated = await api<CompanyContactData>("/settings", { method: "PUT", body });
      setData({
        communica_azienda_name: updated.communica_azienda_name || "",
        communica_azienda_email: updated.communica_azienda_email || "",
        communica_azienda_phones: updated.communica_azienda_phones || [],
      });
      setAddLabel("");
      setAddNumber("");
      setAddOpen(false);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aggiungere il contatto.");
    } finally {
      setSaving(false);
    }
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

  // V50.z63 — Apri picker: carica My Web e mostra checkbox
  const openMyWebPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerSelected(new Set());
    try {
      const r = await api<{ items: CompanyLink[] }>("/web-links");
      const items = Array.isArray(r.items) ? r.items : [];
      setPickerLinks(items);
      // Pre-seleziona quelli non ancora presenti in company-web-links
      const existingUrls = new Set(links.map((l) => l.url));
      const toPreselect = new Set<string>();
      items.forEach((it) => {
        if (!existingUrls.has(it.url)) toPreselect.add(it.link_id);
      });
      setPickerSelected(toPreselect);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare My Web");
      setPickerOpen(false);
    } finally {
      setPickerLoading(false);
    }
  };

  const togglePickerLink = (id: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runImportSelected = async () => {
    if (pickerSelected.size === 0) {
      notify("Selezione vuota", "Seleziona almeno un link da importare.");
      return;
    }
    setLinkImporting(true);
    try {
      const r = await api<{ added: number; skipped_duplicate: number; source_total: number }>(
        "/company-web-links/import-from-my-web",
        { method: "POST", body: { link_ids: Array.from(pickerSelected) } },
      );
      if (r.added === 0 && r.skipped_duplicate > 0) {
        notify("Già presenti", `I ${r.skipped_duplicate} link selezionati sono già in Link utili.`);
      } else {
        notify(
          "Import completato ✅",
          `Importati ${r.added} link${r.skipped_duplicate ? ` (${r.skipped_duplicate} duplicati saltati)` : ""}.`,
        );
      }
      setPickerOpen(false);
    } catch (e: any) {
      notify("Errore import", e?.message || "Import non riuscito.");
    } finally {
      await loadLinks();
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
    ><KModalBody>
      {/* V50.z59-fix2 — Rimosso il backdrop <Pressable onPress={onClose}>: il
          re-render causato dagli input di editing (phone label, ecc.) scatenava
          un tap event sintetico sul backdrop, chiudendo il sheet appena
          l'utente digitava. Ora il sheet si chiude via bottone X (già in header),
          bottone Annulla (edit-mode), o back Android (onRequestClose). */}
      <View style={styles.backdrop} pointerEvents="box-none">
        <View
          style={[styles.sheet, { paddingBottom: bottomPad + 12 }]}
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

          <KScrollView
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
                </View>
                <Text style={[styles.editSubLbl, { marginBottom: 4 }]}>
                  Qui puoi correggere etichetta e numero dei contatti esistenti. Per un nuovo numero usa «+ Aggiungi contatto».
                </Text>

                {draftPhones.length === 0 ? (
                  <Text style={styles.empty}>
                    Nessun numero da modificare. Chiudi e usa &quot;+ Aggiungi contatto&quot;.
                  </Text>
                ) : (
                  draftPhones.map((p) => (
                    <View key={p.id} style={styles.phoneEditRow}>
                      <View style={{ flex: 1, gap: 6 }}>
                        {/* V50.z59-fix2 — Rimosso `multiline` che causava
                            reflow ad ogni carattere → il sheet padre
                            (Pressable backdrop) intercettava un tap sintetico
                            e chiudeva il modal. Il campo resta single-line con
                            maxLength 60 → i nomi lunghi vengono comunque
                            salvati e mostrati su 2 righe in view-mode. */}
                        <Text style={styles.editSubLbl}>Nome del bottone</Text>
                        <TextInput
                          testID={`company-sheet-phone-label-${p.id}`}
                          value={p.label}
                          onChangeText={(t) => updateDraftPhone(p.id, "label", t)}
                          placeholder="Es. Assistenza tecnica consulenti"
                          placeholderTextColor={C.muted}
                          maxLength={60}
                          style={[styles.input, { fontSize: 13 }]}
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

                {/* V50.z82 — Bottone rapido "Invia richiesta info" al Master */}
                <Pressable
                  testID="company-sheet-open-info-req"
                  onPress={() => { onClose(); setTimeout(() => { try { router.push("/info-requests?mode=compose" as any); } catch { /* ignore */ } }, 100); }}
                  style={infoReqStyles.row}
                >
                  <View style={[styles.rowIcon, { backgroundColor: HT.warningTint }]}>
                    <Ionicons name="chatbubble-ellipses" size={18} color={HT.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={infoReqStyles.title}>Invia richiesta info</Text>
                    <Text style={infoReqStyles.sub}>Fai una domanda al Master aziendale</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.muted} />
                </Pressable>

                {data.communica_azienda_email ? (
                  <Pressable
                    onPress={() => openMail(data.communica_azienda_email || "")}
                    style={styles.emailRow}
                    testID="company-sheet-email"
                  >
                    <View style={[styles.rowIcon, { backgroundColor: HT.axonTint }]}>
                      <Ionicons name="mail" size={18} color={HT.axon} />
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
                        Tocca &quot;+ Aggiungi contatto&quot; per inserire il primo numero
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
                      <View style={[styles.rowIcon, { backgroundColor: HT.successTint }]}>
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

                {/* V50.z145 — Inserimento manuale di un nuovo contatto (indipendente dal PDF) */}
                {isMaster && !addOpen && (
                  <Pressable
                    onPress={() => setAddOpen(true)}
                    style={styles.addContactBtn}
                    testID="company-sheet-add-contact"
                  >
                    <Ionicons name="add-circle" size={18} color={C.primary} />
                    <Text style={styles.addContactTxt}>+ Aggiungi contatto</Text>
                  </Pressable>
                )}
                {isMaster && addOpen && (
                  <View style={styles.addContactBox} testID="company-sheet-add-contact-form">
                    <Text style={styles.fieldLbl}>Nuovo contatto</Text>
                    <Text style={styles.editSubLbl}>Etichetta (nome del bottone)</Text>
                    <TextInput
                      testID="company-sheet-add-contact-label"
                      value={addLabel}
                      onChangeText={setAddLabel}
                      placeholder="Es. Assistenza tecnica consulenti"
                      placeholderTextColor={C.muted}
                      maxLength={60}
                      style={[styles.input, { fontSize: 13 }]}
                    />
                    <Text style={styles.editSubLbl}>Numero di telefono</Text>
                    <TextInput
                      testID="company-sheet-add-contact-number"
                      value={addNumber}
                      onChangeText={setAddNumber}
                      placeholder="Es. +39 02 1234 5678"
                      placeholderTextColor={C.muted}
                      keyboardType="phone-pad"
                      style={[styles.input, { fontSize: 13 }]}
                    />
                    <View style={styles.actionsRow}>
                      <Pressable
                        onPress={() => { setAddOpen(false); setAddLabel(""); setAddNumber(""); }}
                        style={styles.btnGhost}
                        disabled={saving}
                        testID="company-sheet-add-contact-cancel"
                      >
                        <Text style={styles.btnGhostTxt}>Annulla</Text>
                      </Pressable>
                      <Pressable
                        onPress={addManualContact}
                        style={[styles.btnSave, (saving || !addNumber.trim()) && { opacity: 0.6 }]}
                        disabled={saving || !addNumber.trim()}
                        testID="company-sheet-add-contact-save"
                      >
                        <Ionicons name="checkmark" size={16} color="#FFF" />
                        <Text style={styles.btnSaveTxt}>{saving ? "Salvo…" : "Salva contatto"}</Text>
                      </Pressable>
                    </View>
                  </View>
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
                        <View style={[styles.rowIcon, { backgroundColor: HT.dangerTint }]}>
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
                        onPress={openMyWebPicker}
                        disabled={linkImporting}
                        style={[styles.addBtn, { backgroundColor: '#7C3AED' }, linkImporting && { opacity: 0.6 }]}
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
          </KScrollView>
        </View>
      </View>

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
              <View style={[styles.hdrIcon, { backgroundColor: '#7C3AED' }]}>
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
            <KScrollView
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
            </KScrollView>
          </View>
        </View>
      </Modal>

      {/* V50.z58 — Link editor (add/edit): Master-only */}
      {/* V50.z63 — Picker "Da My Web" con checkbox per selezione singola.
          Master-only. Precompila i checkbox su tutti i link NON già presenti. */}
      {pickerOpen && (
        <Modal
          transparent
          visible={pickerOpen}
          animationType="slide"
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={styles.backdrop} pointerEvents="box-none">
            <View style={styles.linkSheet}>
              <View style={styles.sheetHandle} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={styles.sheetTitle}>Importa da My Web</Text>
                <Pressable
                  onPress={() => setPickerOpen(false)}
                  hitSlop={10}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" }}
                  testID="my-web-picker-close"
                >
                  <Ionicons name="close" size={18} color={C.muted} />
                </Pressable>
              </View>
              {pickerLoading ? (
                <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} />
              ) : pickerLinks.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTxt}>Nessun link in My Web. Aggiungili prima dalla schermata My Web.</Text>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: C.muted, fontWeight: "700" }}>
                      Seleziona i link da importare ({pickerSelected.size}/{pickerLinks.length})
                    </Text>
                    <Pressable
                      onPress={() => {
                        if (pickerSelected.size === pickerLinks.length) setPickerSelected(new Set());
                        else setPickerSelected(new Set(pickerLinks.map((x) => x.link_id)));
                      }}
                      testID="my-web-picker-toggle-all"
                    >
                      <Text style={{ fontSize: 12, color: C.primary, fontWeight: "800" }}>
                        {pickerSelected.size === pickerLinks.length ? "Deseleziona tutti" : "Seleziona tutti"}
                      </Text>
                    </Pressable>
                  </View>
                  <KScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
                    {pickerLinks.map((lk) => {
                      const checked = pickerSelected.has(lk.link_id);
                      const already = links.some((l) => l.url === lk.url);
                      return (
                        <Pressable
                          key={lk.link_id}
                          onPress={() => togglePickerLink(lk.link_id)}
                          style={styles.pickerRow}
                          testID={`my-web-picker-item-${lk.link_id}`}
                        >
                          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                            {checked ? <Ionicons name="checkmark" size={14} color="#FFF" /> : null}
                          </View>
                          <Text style={{ fontSize: 22 }}>{lk.icon || "🔗"}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.linkTitle} numberOfLines={1}>{lk.title}</Text>
                            <Text style={styles.linkUrl} numberOfLines={1}>
                              {(lk.url || "").replace(/^https?:\/\//, "")}
                            </Text>
                          </View>
                          {already ? (
                            <View style={styles.alreadyBadge}>
                              <Text style={styles.alreadyBadgeTxt}>già presente</Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </KScrollView>
                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={() => setPickerOpen(false)}
                      style={styles.btnGhost}
                      disabled={linkImporting}
                      testID="my-web-picker-cancel"
                    >
                      <Text style={styles.btnGhostTxt}>Annulla</Text>
                    </Pressable>
                    <Pressable
                      onPress={runImportSelected}
                      style={[styles.btnSave, (linkImporting || pickerSelected.size === 0) && { opacity: 0.5 }]}
                      disabled={linkImporting || pickerSelected.size === 0}
                      testID="my-web-picker-import"
                    >
                      {linkImporting ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Ionicons name="download" size={16} color="#FFF" />
                          <Text style={styles.btnSaveTxt}>Importa ({pickerSelected.size})</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}

      {linkEditor && (
        <Modal
          transparent
          visible={!!linkEditor}
          animationType="slide"
          onRequestClose={() => setLinkEditor(null)}
        ><KModalBody>
          {/* V50.z59 — Bug fix: rimosso il Pressable backdrop con onPress che
              chiudeva il modal. Il re-render del componente causato da
              onChangeText veniva interpretato come tap sulla backdrop dal
              WebView (bug nested-Modal + react-native-keyboard-controller),
              chiudendo il modal appena l'utente digitava un carattere.
              L'utente chiude via Annulla o back Android (onRequestClose). */}
          <View style={styles.backdrop} pointerEvents="box-none">
            <View style={styles.linkSheet}>
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
          </View>
        </KModalBody></Modal>
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
    </KModalBody></Modal>
  );
}

// V50.z58 — Icone disponibili per i Link utili
const LINK_ICONS = ["🔗","⚡","🔥","📊","📰","🏦","💼","📞","🌐","📈","🛒","💰","🎯","🔧","📱","📧","📅","🎓","⭐","🚀"];

// V50.z74 — InAppWebViewer estratto in `@/src/InAppWebViewer` (era qui una copia inline).

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: HT.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: HT.borderStrong,
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
    borderBottomColor: HT.border,
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
    backgroundColor: HT.brandTint,
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
    backgroundColor: HT.card,
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
    backgroundColor: HT.card,
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
  // V50.z145 — "+ Aggiungi contatto" (view-mode) + form inline
  addContactBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: C.primary,
    backgroundColor: HT.brandTint,
  },
  addContactTxt: { fontSize: 14, fontWeight: "800", color: C.primary },
  addContactBox: {
    gap: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HT.brandLine,
    backgroundColor: HT.brandTint,
  },
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
    backgroundColor: HT.dangerTint,
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
  btnGhost: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: HT.card2 },
  btnGhostTxt: { fontSize: 13, fontWeight: "800", color: HT.muted },
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
    backgroundColor: HT.card,
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
    borderTopColor: HT.card2,
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
    backgroundColor: '#7C3AED',
  },
  axonBtnTxt: { fontSize: 12, fontWeight: "800", color: "#FFF" },
  trashBtnSmall: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: HT.dangerTint,
    alignItems: "center",
    justifyContent: "center",
  },
  extractSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  extractCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: HT.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  extractLine: { fontSize: 12, color: HT.text2, marginTop: 2, fontWeight: "600" },

  // V50.z58 — Link utili
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: HT.card,
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
    backgroundColor: HT.card2, alignItems: "center", justifyContent: "center",
  },
  // Editor link modal
  linkSheet: {
    backgroundColor: HT.card,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 16, paddingBottom: 30,
  },
  sheetHandle: {
    alignSelf: "center", width: 40, height: 4, borderRadius: 2,
    backgroundColor: HT.borderStrong, marginBottom: 12,
  },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: C.navy, marginBottom: 10 },
  iconRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  iconOpt: { padding: 8, borderRadius: 10, backgroundColor: HT.card2 },
  iconOptActive: { backgroundColor: HT.axonTint, borderWidth: 2, borderColor: C.primary },
  // V50.z63 — Picker My Web con checkbox
  pickerRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: HT.borderStrong,
    alignItems: "center", justifyContent: "center",
    backgroundColor: HT.card,
  },
  checkboxOn: { backgroundColor: C.primary, borderColor: C.primary },
  alreadyBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, backgroundColor: HT.card2,
  },
  alreadyBadgeTxt: { fontSize: 10, color: C.muted, fontWeight: "700" },
});

// V50.z82 — Stili bottone "Invia richiesta info"
const infoReqStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#F59E0B33", backgroundColor: HT.warningTint },
  title: { fontSize: 14, fontWeight: "800", color: C.navy },
  sub: { fontSize: 11, color: C.muted, marginTop: 2 },
});

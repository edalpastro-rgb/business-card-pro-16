import { useState, useEffect, useRef, useMemo } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Contacts from "expo-contacts";
import { launchLibraryUniversal, launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import * as DocumentPicker from "expo-document-picker";
import { pickCommonFile } from "@/src/utils/filePicker";
import { useAudioRecorder, AudioModule, RecordingPresets } from "expo-audio";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { scheduleBirthdayReminder } from "@/src/notifications";
import { uriToBase64DataUrl, uriToBase64, base64ByteSize } from "@/src/utils/media";
import { notify, confirmAsync } from "@/src/utils/notify";
import { QRScannerModal } from "@/src/QRScannerModal";
import { ModuleErrorBoundary } from "@/src/shared";

type PendingAttachment = {
  local_id: string;
  kind: "photo" | "audio" | "video" | "file";
  photo_base64?: string;
  audio_base64?: string; audio_mime?: string;
  video_base64?: string; video_mime?: string;
  file_base64?: string; file_name?: string; file_mime?: string; file_size?: number;
};

type ContactLite = {
  contact_id: string;
  first_name: string;
  last_name: string;
  phone?: string;
  phone_alt?: string;
  email?: string;
  email_alt?: string;
};
type Group = { group_id: string; name: string; color: string };
type CustomArea = { id: string; name: string; color: string; icon?: string };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; custom_areas: CustomArea[] };

const AREA_COLOR_SWATCHES = ["#1B6CB0", "#C83232", "#2D7A5A", "#B77C14", "#7A2E8E", "#0B7285", "#E67700", "#6B7280"];

export default function NewContactRoute() {
  return (
    <ModuleErrorBoundary moduleName="contacts">
      <NewContactScreen />
    </ModuleErrorBoundary>
  );
}

function NewContactScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id;
  const isEdit = !!editId;
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [emailAttachments, setEmailAttachments] = useState<PendingAttachment[]>([]);
  const [generalAttachments, setGeneralAttachments] = useState<PendingAttachment[]>([]);
  const [recordingFor, setRecordingFor] = useState<null | "email" | "general">(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const webRecRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; target: "email" | "general" } | null>(null);
  const [newAreaModal, setNewAreaModal] = useState(false);
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaColor, setNewAreaColor] = useState(AREA_COLOR_SWATCHES[0]);
  const [form, setForm] = useState({
    first_name: "", last_name: "",
    phone: "", phone_alt: "", whatsapp: "",
    email: "", email_alt: "", telegram: "",
    address_street: "", address_number: "", address_zip: "", address_city: "", address_province: "",
    work_address: "", residence_address: "",
    birth_date: "", fiscal_code: "", vat_number: "",
    website: "", linkedin: "", instagram: "", facebook: "",
    birthday_alert_days_before: 1,
    birthday_auto_send: false,
    birthday_message: "",
    birthday_message_link: "",
    // V38H — birthday sender/recipient + active-client flag
    birthday_sender_email: "",
    birthday_recipient_email: "",
    is_active_client: false,
    anniversaries: [] as { name: string; date: string }[],
    area: (allowed[0] || "energy") as "energy" | "network",
    additional_areas: [] as string[],
    source: "personal" as "personal" | "referral",
    referral_type: "" as "" | "direct" | "from_contact",
    referred_by_contact_id: "",
    referral_note: "", email_note: "", general_note: "",
    tags: [] as string[],
    tag_input: "",
    group_ids: [] as string[],
    photos: [] as string[],
    avatar_base64: "",
  });
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [postCreateModal, setPostCreateModal] = useState<{ contact_id: string; name: string } | null>(null);
  // V38H — user's sender emails (main + additional) for the birthday email picker
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [bdayGenerating, setBdayGenerating] = useState(false);
  // V38I — QR code scanner
  const [showQrScanner, setShowQrScanner] = useState(false);
  // V38J — duplicate contact detection (name / phone / email)
  const [dupModal, setDupModal] = useState<null | { matches: ContactLite[] }>(null);
  const bypassDupRef = useRef(false);

  useEffect(() => {
    api<{ items: ContactLite[] }>("/contacts").then((r) => setContacts(r.items)).catch(() => {});
    api<{ items: Group[] }>("/groups").then((r) => setAvailableGroups(r.items)).catch(() => {});
    api<Settings>("/settings").then((s) => setSettings(s)).catch(() => {});
    // V38H — load user emails (main + additional)
    api<{ user: any }>("/auth/me").then((r) => {
      const me = r?.user || {};
      const list = [me.email, ...(Array.isArray(me.additional_emails) ? me.additional_emails : [])].filter(Boolean);
      setUserEmails(Array.from(new Set(list)));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit || !editId) return;
    (async () => {
      try {
        const c: any = await api(`/contacts/${editId}`);
        setForm((f) => ({
          ...f,
          first_name: c.first_name || "", last_name: c.last_name || "",
          phone: c.phone || "", phone_alt: c.phone_alt || "", whatsapp: c.whatsapp || "",
          email: c.email || "", email_alt: c.email_alt || "", telegram: c.telegram || "",
          address_street: c.address_street || "", address_number: c.address_number || "",
          address_zip: c.address_zip || "", address_city: c.address_city || "", address_province: c.address_province || "",
          work_address: c.work_address || "", residence_address: c.residence_address || "",
          birth_date: c.birth_date || "",
          birthday_alert_days_before: c.birthday_alert_days_before ?? 1,
          birthday_auto_send: !!c.birthday_auto_send,
          birthday_message: c.birthday_message || "",
          birthday_message_link: c.birthday_message_link || "",
          birthday_sender_email: c.birthday_sender_email || "",
          birthday_recipient_email: c.birthday_recipient_email || "",
          is_active_client: !!c.is_active_client,
          fiscal_code: c.fiscal_code || "", vat_number: c.vat_number || "",
          website: c.website || "", linkedin: c.linkedin || "",
          instagram: c.instagram || "", facebook: c.facebook || "",
          area: (c.area === "network" ? "network" : "energy"),
          additional_areas: c.additional_areas || [],
          source: (c.source === "referral" ? "referral" : "personal"),
          referral_type: c.referral_type || "",
          referred_by_contact_id: c.referred_by_contact_id || "",
          referral_note: c.referral_note || "",
          email_note: c.email_note || "",
          general_note: c.general_note || "",
          tags: c.tags || [],
          group_ids: c.group_ids || [],
          anniversaries: c.anniversaries || [],
        }));
      } catch (e) { console.warn(e); }
    })();
  }, [isEdit, editId]);

  const [phoneContactsModal, setPhoneContactsModal] = useState<Contacts.Contact[] | null>(null);
  const [phoneImportSearch, setPhoneImportSearch] = useState("");
  const [phoneImportSelected, setPhoneImportSelected] = useState<Set<string>>(new Set());
  const [phoneImportBusy, setPhoneImportBusy] = useState(false);
  const [phoneImportProgress, setPhoneImportProgress] = useState<{ done: number; total: number } | null>(null);

  const filteredPhoneContacts = useMemo(() => {
    const src = phoneContactsModal || [];
    const q = phoneImportSearch.trim().toLowerCase();
    if (!q) return src;
    return src.filter((c: any) => {
      const fullName = (c.name || `${c.firstName || ""} ${c.lastName || ""}`).toLowerCase();
      const phone = (c.phoneNumbers?.[0]?.number || "").toLowerCase();
      return fullName.includes(q) || phone.includes(q);
    });
  }, [phoneContactsModal, phoneImportSearch]);

  // AI helper state
  const [aiMode, setAiMode] = useState<null | "card" | "url" | "voice">(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiUrl, setAiUrl] = useState("");
  const [aiPreview, setAiPreview] = useState<Record<string, string> | null>(null);
  const [aiTranscript, setAiTranscript] = useState<string>("");

  const openAI = (m: "card" | "url" | "voice") => {
    setAiMode(m); setAiUrl(""); setAiPreview(null); setAiTranscript("");
  };
  const closeAI = () => { setAiMode(null); setAiPreview(null); };

  const applyAIFields = (data: Record<string, string>) => {
    // Merge company/role/website/linkedin into general_note if not empty
    const extras: string[] = [];
    if (data.company) extras.push(`Azienda: ${data.company}`);
    if (data.role) extras.push(`Ruolo: ${data.role}`);
    if (data.website) extras.push(`Sito: ${data.website}`);
    if (data.linkedin) extras.push(`LinkedIn: ${data.linkedin}`);
    if (data.notes) extras.push(data.notes);
    const notesPart = extras.length
      ? (form.general_note ? form.general_note + "\n" + extras.join("\n") : extras.join("\n"))
      : form.general_note;
    setForm((f) => ({
      ...f,
      first_name: data.first_name || f.first_name,
      last_name: data.last_name || f.last_name,
      phone: data.phone || f.phone,
      phone_alt: data.phone_alt || f.phone_alt,
      email: data.email || f.email,
      email_alt: data.email_alt || f.email_alt,
      address_street: data.address_street || f.address_street,
      address_city: data.address_city || f.address_city,
      address_zip: data.address_zip || f.address_zip,
      address_province: data.address_province || f.address_province,
      whatsapp: data.whatsapp || f.whatsapp,
      telegram: data.telegram || f.telegram,
      birth_date: data.birth_date || f.birth_date,
      general_note: notesPart,
    }));
    closeAI();
  };

  const runAIUrl = async () => {
    if (!aiUrl.trim()) { notify("Inserisci un URL"); return; }
    setAiBusy(true);
    try {
      const r = await api<{ contact: Record<string, string> }>("/ai/contact-from-url", { method: "POST", body: { url: aiUrl.trim() } });
      setAiPreview(r.contact || {});
    } catch (e: any) {
      notify("Errore AI", e?.message || "Impossibile estrarre dati");
    } finally { setAiBusy(false); }
  };

  const runAICard = async () => {
    const useBase64 = Platform.OS !== "web";
    const res = await launchCameraUniversal({ quality: 0.6, base64: useBase64 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let dataUrl: string;
    if (a.uri && a.uri.startsWith("data:")) dataUrl = a.uri;
    else if (a.base64) dataUrl = `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
    else if (a.uri) dataUrl = await uriToBase64DataUrl(a.uri, a.mimeType || "image/jpeg");
    else return;
    setAiBusy(true);
    try {
      const r = await api<{ contact: Record<string, string> }>("/ai/contact-from-card", { method: "POST", body: { image_base64: dataUrl } });
      setAiPreview(r.contact || {});
    } catch (e: any) {
      notify("Errore OCR", e?.message || "Impossibile leggere il biglietto");
    } finally { setAiBusy(false); }
  };

  const runAIVoice = async () => {
    if (Platform.OS === "web") {
      // Reuse web recorder (already defined)
      if (recordingFor !== "general") {
        await startRecWebFor("general");
        notify("Registrazione", "Parla ora — tocca ancora il bottone per fermare.");
        return;
      }
      const st = webRecRef.current;
      setRecordingFor(null);
      if (!st) return;
      await new Promise<void>((resolve) => { st.mr.onstop = () => resolve(); st.mr.stop(); });
      st.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(st.chunks, { type: "audio/webm" });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read failed"));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      webRecRef.current = null;
      setAiBusy(true);
      try {
        const r = await api<{ contact: Record<string, string>; transcript: string }>("/ai/contact-from-voice", { method: "POST", body: { audio_base64: dataUrl, mime: "audio/webm" } });
        setAiTranscript(r.transcript || "");
        setAiPreview(r.contact || {});
      } catch (e: any) {
        notify("Errore trascrizione", e?.message || "");
      } finally { setAiBusy(false); }
      return;
    }
    // Native path
    if (recordingFor === "general") {
      // stop and transcribe
      setRecordingFor(null);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      const b64 = await uriToBase64(uri);
      setAiBusy(true);
      try {
        const r = await api<{ contact: Record<string, string>; transcript: string }>("/ai/contact-from-voice", { method: "POST", body: { audio_base64: b64, mime: "audio/m4a" } });
        setAiTranscript(r.transcript || "");
        setAiPreview(r.contact || {});
      } catch (e: any) { notify("Errore", e?.message || ""); }
      finally { setAiBusy(false); }
    } else {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) { notify("Permesso microfono negato"); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingFor("general");
      notify("Registrazione", "Parla ora — tocca ancora il bottone per fermare.");
    }
  };

  const importFromPhone = async () => {
    if (Platform.OS === "web") {
      notify("Non disponibile", "L'importazione dalla rubrica funziona solo su cellulare (app Expo Go o build nativa).");
      return;
    }
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        notify("Permesso negato", "Serve accesso alla rubrica per importare.");
        return;
      }
      // Try native picker first (iOS only in current expo-contacts)
      const anyContacts = Contacts as any;
      if (typeof anyContacts.presentContactPickerAsync === "function") {
        try {
          const c = await anyContacts.presentContactPickerAsync();
          if (c) { fillFromContact(c); return; }
        } catch (e) { console.warn("native picker failed, fallback to list", e); }
      }
      // Fallback: fetch all contacts and show list modal
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.FirstName, Contacts.Fields.LastName,
          Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails,
          Contacts.Fields.Addresses, Contacts.Fields.Birthday,
        ],
        sort: Contacts.SortTypes.LastName,
      });
      if (!data || data.length === 0) {
        notify("Nessun contatto", "La tua rubrica risulta vuota.");
        return;
      }
      setPhoneImportSearch("");
      setPhoneImportSelected(new Set());
      setPhoneContactsModal(data);
    } catch (e: any) {
      notify("Errore importazione", e?.message || "Impossibile accedere alla rubrica");
    }
  };

  // Build a minimal contact payload from a phone Contacts entry
  const contactToPayload = (c: any) => {
    const first_name = c.firstName || c.name?.split(" ")[0] || "";
    const last_name = c.lastName || (c.name?.split(" ").slice(1).join(" ")) || "";
    return {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      phone: c.phoneNumbers?.[0]?.number || "",
      phone_alt: c.phoneNumbers?.[1]?.number || "",
      email: c.emails?.[0]?.email || "",
      email_alt: c.emails?.[1]?.email || "",
      address_street: c.addresses?.[0]?.street || "",
      address_city: c.addresses?.[0]?.city || "",
      address_zip: c.addresses?.[0]?.postalCode || "",
      address_province: c.addresses?.[0]?.region || "",
      birth_date: c.birthday ? `${c.birthday.day || ""}/${c.birthday.month || ""}/${c.birthday.year || ""}` : "",
      area: (form.area || "energy"),
    };
  };

  const togglePhoneSelected = (id: string) => {
    setPhoneImportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visible = filteredPhoneContacts;
    setPhoneImportSelected((prev) => {
      const allSelected = visible.length > 0 && visible.every((c) => c.id && prev.has(c.id));
      const next = new Set(prev);
      if (allSelected) {
        visible.forEach((c) => c.id && next.delete(c.id));
      } else {
        visible.forEach((c) => c.id && next.add(c.id));
      }
      return next;
    });
  };

  const commitMultiImport = async () => {
    if (!phoneContactsModal) return;
    const selectedIds = phoneImportSelected;
    if (selectedIds.size === 0) return;
    const selected = phoneContactsModal.filter((c) => c.id && selectedIds.has(c.id));
    if (selected.length === 0) return;
    // Single selection → keep classic behavior (fill current form)
    if (selected.length === 1) {
      fillFromContact(selected[0]);
      return;
    }
    // Multi selection → create N contacts in parallel (bounded), then navigate to list
    setPhoneImportBusy(true);
    setPhoneImportProgress({ done: 0, total: selected.length });
    let created = 0;
    let failed = 0;
    let skipped = 0; // V38J — duplicate contacts skipped during import
    try {
      // Create sequentially to keep it simple + show progress; typical N <= 50
      for (const c of selected) {
        const payload = contactToPayload(c);
        if (!payload.first_name && !payload.last_name && !payload.phone) {
          failed += 1;
        } else {
          // V38J — skip if a contact with same phone/email/full-name already exists
          const dupHit = isDuplicateOfExisting(payload);
          if (dupHit) {
            skipped += 1;
          } else {
            try {
              await api("/contacts", { method: "POST", body: payload });
              created += 1;
            } catch {
              failed += 1;
            }
          }
        }
        setPhoneImportProgress({ done: created + failed + skipped, total: selected.length });
      }
      const parts = [`Creati ${created} contatti`];
      if (skipped > 0) parts.push(`${skipped} già esistenti saltati`);
      if (failed > 0) parts.push(`${failed} falliti`);
      notify("Importazione completata", parts.join(" · "));
      setPhoneContactsModal(null);
      setPhoneImportSelected(new Set());
      // Navigate to contacts list to show them
      router.replace("/(tabs)/contatti");
    } finally {
      setPhoneImportBusy(false);
      setPhoneImportProgress(null);
    }
  };

  // V38I — Parse a QR-code payload and prefill the form.
  // Supports: vCard (BEGIN:VCARD…END:VCARD), MECARD:…, JSON, plain URL/email/phone.
  const applyQrData = (raw: string) => {
    if (!raw) return;
    const patch: Partial<typeof form> = {};
    const noteBits: string[] = [];

    const setIfEmpty = (key: keyof typeof form, value: string) => {
      if (value && !(form as any)[key]) (patch as any)[key] = value.trim();
    };
    const addNote = (label: string, value: string) => {
      if (value && value.trim()) noteBits.push(`${label}: ${value.trim()}`);
    };

    const s = raw.trim();

    // 1) JSON payload
    try {
      const j = JSON.parse(s);
      if (j && typeof j === "object") {
        const g = (k: string) => (j[k] ?? j[k.toLowerCase()] ?? "").toString();
        setIfEmpty("first_name", g("first_name") || g("firstName") || g("name") || "");
        setIfEmpty("last_name", g("last_name") || g("lastName") || g("surname") || "");
        addNote("Azienda", g("company") || g("organization") || "");
        addNote("Ruolo", g("role") || g("title") || "");
        setIfEmpty("email", g("email"));
        setIfEmpty("email_alt", g("email_alt") || g("emailAlt") || "");
        setIfEmpty("phone", g("phone") || g("tel") || g("mobile") || "");
        setIfEmpty("phone_alt", g("phone_alt") || g("phone2") || g("workPhone") || "");
        setIfEmpty("address_street", g("address_street") || g("address") || g("street") || "");
        setIfEmpty("address_city", g("address_city") || g("city") || "");
        setIfEmpty("address_zip", g("address_zip") || g("zip") || g("postalCode") || "");
        setIfEmpty("address_province", g("address_province") || g("province") || g("state") || "");
        setIfEmpty("website", g("website") || g("url") || "");
        const noteMerged = [form.general_note, ...noteBits].filter(Boolean).join("\n");
        if (noteBits.length > 0) (patch as any).general_note = noteMerged;
        setForm({ ...form, ...patch });
        notify("Contatto letto dal QR", "Campi precompilati dal codice.");
        return;
      }
    } catch {}

    // 2) vCard
    if (/^BEGIN:VCARD/i.test(s)) {
      const grabs: Record<string, string> = {};
      s.split(/\r?\n/).forEach((line) => {
        const idx = line.indexOf(":");
        if (idx < 0) return;
        const head = line.slice(0, idx).toUpperCase();
        const val = line.slice(idx + 1);
        if (head.startsWith("FN")) grabs.FN = val;
        else if (head.startsWith("N")) grabs.N = val;
        else if (head.startsWith("ORG")) grabs.ORG = val;
        else if (head.startsWith("TITLE")) grabs.TITLE = val;
        else if (head.startsWith("EMAIL")) grabs.EMAIL = grabs.EMAIL ? grabs.EMAIL : val;
        else if (head.startsWith("TEL")) {
          if (!grabs.TEL) grabs.TEL = val;
          else if (!grabs.TEL2) grabs.TEL2 = val;
        }
        else if (head.startsWith("ADR")) grabs.ADR = val;
        else if (head.startsWith("URL")) grabs.URL = val;
      });
      if (grabs.N) {
        const [last, first] = grabs.N.split(";");
        setIfEmpty("first_name", first || "");
        setIfEmpty("last_name", last || "");
      } else if (grabs.FN) {
        const parts = grabs.FN.trim().split(/\s+/);
        setIfEmpty("first_name", parts[0] || "");
        setIfEmpty("last_name", parts.slice(1).join(" ") || "");
      }
      addNote("Azienda", grabs.ORG || "");
      addNote("Ruolo", grabs.TITLE || "");
      setIfEmpty("email", grabs.EMAIL || "");
      setIfEmpty("phone", grabs.TEL || "");
      setIfEmpty("phone_alt", grabs.TEL2 || "");
      setIfEmpty("website", grabs.URL || "");
      if (grabs.ADR) {
        // ADR:;;street;city;province;zip;country
        const parts = grabs.ADR.split(";");
        setIfEmpty("address_street", parts[2] || "");
        setIfEmpty("address_city", parts[3] || "");
        setIfEmpty("address_province", parts[4] || "");
        setIfEmpty("address_zip", parts[5] || "");
      }
      if (noteBits.length > 0) {
        const noteMerged = [form.general_note, ...noteBits].filter(Boolean).join("\n");
        (patch as any).general_note = noteMerged;
      }
      setForm({ ...form, ...patch });
      notify("vCard letta", "Campi precompilati dal QR.");
      return;
    }

    // 3) MECARD:
    if (/^MECARD:/i.test(s)) {
      const body = s.replace(/^MECARD:/i, "");
      const kv: Record<string, string> = {};
      body.split(";").forEach((seg) => {
        const idx = seg.indexOf(":");
        if (idx < 0) return;
        kv[seg.slice(0, idx).toUpperCase()] = seg.slice(idx + 1);
      });
      if (kv.N) {
        const [last, first] = kv.N.split(",");
        setIfEmpty("first_name", first || "");
        setIfEmpty("last_name", last || "");
      }
      addNote("Azienda", kv.ORG || "");
      setIfEmpty("email", kv.EMAIL || "");
      setIfEmpty("phone", kv.TEL || "");
      setIfEmpty("website", kv.URL || "");
      if (noteBits.length > 0) {
        const noteMerged = [form.general_note, ...noteBits].filter(Boolean).join("\n");
        (patch as any).general_note = noteMerged;
      }
      setForm({ ...form, ...patch });
      notify("MECARD letta", "Campi precompilati dal QR.");
      return;
    }

    // 4) mailto / tel / http URL / plain
    if (/^mailto:/i.test(s)) {
      setIfEmpty("email", s.replace(/^mailto:/i, "").split("?")[0]);
    } else if (/^tel:/i.test(s)) {
      setIfEmpty("phone", s.replace(/^tel:/i, ""));
    } else if (/^https?:/i.test(s)) {
      setIfEmpty("website", s);
    } else if (/^[+\d][\d\s\-()]{5,}$/.test(s)) {
      setIfEmpty("phone", s);
    } else if (s.includes("@")) {
      setIfEmpty("email", s);
    } else {
      // Fallback: put in first_name if empty, otherwise general_note
      if (!form.first_name) setIfEmpty("first_name", s.slice(0, 40));
      else {
        const merged = [form.general_note, s].filter(Boolean).join("\n");
        (patch as any).general_note = merged;
      }
    }
    setForm({ ...form, ...patch });
    notify("QR letto", "Contenuto applicato al form.");
  };

  const fillFromContact = (c: any) => {
    setForm((f) => ({
      ...f,
      first_name: c.firstName || c.name?.split(" ")[0] || f.first_name,
      last_name: c.lastName || (c.name?.split(" ").slice(1).join(" ")) || f.last_name,
      phone: c.phoneNumbers?.[0]?.number || f.phone,
      phone_alt: c.phoneNumbers?.[1]?.number || f.phone_alt,
      email: c.emails?.[0]?.email || f.email,
      email_alt: c.emails?.[1]?.email || f.email_alt,
      address_street: c.addresses?.[0]?.street || f.address_street,
      address_city: c.addresses?.[0]?.city || f.address_city,
      address_zip: c.addresses?.[0]?.postalCode || f.address_zip,
      address_province: c.addresses?.[0]?.region || f.address_province,
      birth_date: c.birthday ? `${c.birthday.day || ""}/${c.birthday.month || ""}/${c.birthday.year || ""}` : f.birth_date,
    }));
    setPhoneContactsModal(null);
  };

  const pickPhoto = async (fromCamera: boolean) => {
    try {
      const useBase64 = Platform.OS !== "web";
      const res = fromCamera
        ? await launchCameraUniversal({ quality: 0.5, base64: useBase64 })
        : await launchLibraryUniversal({ mediaTypes: "images", quality: 0.5, base64: useBase64 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      let dataUri: string;
      if (a.uri && a.uri.startsWith("data:")) dataUri = a.uri;
      else if (a.base64) dataUri = `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
      else if (a.uri) dataUri = await uriToBase64DataUrl(a.uri, a.mimeType || "image/jpeg");
      else return;
      if (base64ByteSize(dataUri) > 8 * 1024 * 1024) { notify("Foto troppo grande", "Max ~8 MB"); return; }
      setForm({ ...form, photos: [...form.photos, dataUri] });
    } catch (e: any) {
      console.warn("pickPhoto err", e);
      notify("Impossibile caricare la foto", e?.message || "");
    }
  };

  const removePhoto = (idx: number) => {
    setForm({ ...form, photos: form.photos.filter((_, i) => i !== idx) });
  };

  // Media pickers for note field attachments
  const addAttachmentFor = (target: "email" | "general", att: PendingAttachment) => {
    const setter = target === "email" ? setEmailAttachments : setGeneralAttachments;
    setter((prev) => [...prev, att]);
  };
  const removeAttachment = (target: "email" | "general", local_id: string) => {
    const setter = target === "email" ? setEmailAttachments : setGeneralAttachments;
    setter((prev) => prev.filter((a) => a.local_id !== local_id));
  };

  const pickPhotoFor = async (target: "email" | "general", fromCamera: boolean) => {
    try {
      const useBase64 = Platform.OS !== "web";
      const res = fromCamera
        ? await launchCameraUniversal({ quality: 0.5, base64: useBase64 })
        : await launchLibraryUniversal({ mediaTypes: "images", quality: 0.5, base64: useBase64 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      let uri: string;
      if (a.uri && a.uri.startsWith("data:")) uri = a.uri;
      else if (a.base64) uri = `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
      else if (a.uri) uri = await uriToBase64DataUrl(a.uri, a.mimeType || "image/jpeg");
      else return;
      if (base64ByteSize(uri) > 8 * 1024 * 1024) { notify("Foto troppo grande", "Max ~8 MB"); return; }
      addAttachmentFor(target, { local_id: `${Date.now()}`, kind: "photo", photo_base64: uri });
    } catch (e: any) {
      console.warn("pickPhotoFor err", e);
      notify("Impossibile caricare la foto", e?.message || "");
    }
  };

  const pickFileFor = async (target: "email" | "general") => {
    try {
      // v2.20 — centralized common-formats picker + validation
      const { asset, error } = await pickCommonFile();
      if (error) { notify("Formato non supportato", error); return; }
      if (!asset) return;
      const b64 = await uriToBase64(asset.uri);
      if (base64ByteSize(b64) > 15 * 1024 * 1024) { notify("File troppo grande", "Max 15 MB"); return; }
      addAttachmentFor(target, {
        local_id: `${Date.now()}`,
        kind: "file",
        file_base64: b64,
        file_name: asset.name,
        file_mime: asset.mimeType || "application/octet-stream",
        file_size: asset.size || 0,
      });
    } catch (e: any) {
      console.warn("pickFileFor err", e);
      notify("Impossibile caricare il file", e?.message || "");
    }
  };

  const startRecFor = async (target: "email" | "general") => {
    try {
      if (Platform.OS === "web") return await startRecWebFor(target);
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) { notify("Permesso microfono negato"); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingFor(target);
    } catch (e: any) {
      console.warn("startRec err", e);
      notify("Impossibile registrare", e?.message || "");
    }
  };

  const stopRecFor = async () => {
    if (!recordingFor) return;
    try {
      if (Platform.OS === "web") return await stopRecWebFor();
      const target = recordingFor;
      setRecordingFor(null);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      const b64 = await uriToBase64(uri);
      addAttachmentFor(target, { local_id: `${Date.now()}`, kind: "audio", audio_base64: b64, audio_mime: "audio/m4a" });
    } catch (e: any) { console.warn(e); }
  };

  const startRecWebFor = async (target: "email" | "general") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.start();
      webRecRef.current = { mr, chunks, stream, target };
      setRecordingFor(target);
    } catch (e: any) {
      notify("Microfono non accessibile", e?.message || "");
    }
  };

  const stopRecWebFor = async () => {
    const st = webRecRef.current;
    setRecordingFor(null);
    if (!st) return;
    await new Promise<void>((resolve) => { st.mr.onstop = () => resolve(); st.mr.stop(); });
    st.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    const blob = new Blob(st.chunks, { type: "audio/webm" });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    addAttachmentFor(st.target, { local_id: `${Date.now()}`, kind: "audio", audio_base64: b64, audio_mime: "audio/webm" });
    webRecRef.current = null;
  };

  // V38J — Duplicate contact detection helpers
  const normalizePhone = (s: string) => (s || "").replace(/[\s\-()+]/g, "").replace(/^0+/, "");
  const normalizeText = (s: string) => (s || "").toLowerCase().trim();
  const isDuplicateOfExisting = (p: { first_name?: string; last_name?: string; phone?: string; phone_alt?: string; email?: string; email_alt?: string }): ContactLite | null => {
    const first = normalizeText(p.first_name || "");
    const last = normalizeText(p.last_name || "");
    const p1 = normalizePhone(p.phone || "");
    const p2 = normalizePhone(p.phone_alt || "");
    const e1 = normalizeText(p.email || "");
    const e2 = normalizeText(p.email_alt || "");
    for (const c of contacts) {
      if (isEdit && editId && c.contact_id === editId) continue;
      const cF = normalizeText(c.first_name);
      const cL = normalizeText(c.last_name);
      const cP1 = normalizePhone(c.phone || "");
      const cP2 = normalizePhone(c.phone_alt || "");
      const cE1 = normalizeText(c.email || "");
      const cE2 = normalizeText(c.email_alt || "");
      const nameMatch = first && cF && first === cF && (!last || !cL || last === cL);
      const phoneMatch = (p1 && (p1 === cP1 || p1 === cP2)) || (p2 && (p2 === cP1 || p2 === cP2));
      const emailMatch = (e1 && (e1 === cE1 || e1 === cE2)) || (e2 && (e2 === cE1 || e2 === cE2));
      if (nameMatch || phoneMatch || emailMatch) return c;
    }
    return null;
  };
  const findPossibleDuplicates = (): ContactLite[] => {
    const hits: ContactLite[] = [];
    // Reuse per-contact check but iterate to collect ALL matches
    const first = normalizeText(form.first_name);
    const last = normalizeText(form.last_name);
    const p1 = normalizePhone(form.phone);
    const p2 = normalizePhone(form.phone_alt);
    const e1 = normalizeText(form.email);
    const e2 = normalizeText(form.email_alt);
    for (const c of contacts) {
      if (isEdit && editId && c.contact_id === editId) continue;
      const cF = normalizeText(c.first_name);
      const cL = normalizeText(c.last_name);
      const cP1 = normalizePhone(c.phone || "");
      const cP2 = normalizePhone(c.phone_alt || "");
      const cE1 = normalizeText(c.email || "");
      const cE2 = normalizeText(c.email_alt || "");
      const nameMatch = first && cF && first === cF && (!last || !cL || last === cL);
      const phoneMatch = (p1 && (p1 === cP1 || p1 === cP2)) || (p2 && (p2 === cP1 || p2 === cP2));
      const emailMatch = (e1 && (e1 === cE1 || e1 === cE2)) || (e2 && (e2 === cE1 || e2 === cE2));
      if (nameMatch || phoneMatch || emailMatch) hits.push(c);
    }
    const seen = new Set<string>();
    return hits.filter((h) => (seen.has(h.contact_id) ? false : (seen.add(h.contact_id), true)));
  };

  const submit = async () => {
    if (!form.first_name.trim()) return;
    // V38J — Duplicate detection: check name/phone/email against tenant contacts
    // (skipped in edit mode and when user explicitly chose "Salva come nuovo")
    if (!isEdit && !bypassDupRef.current) {
      const matches = findPossibleDuplicates();
      if (matches.length > 0) {
        setDupModal({ matches });
        return;
      }
    }
    setBusy(true);
    try {
      const { tag_input, photos, ...payload } = form;
      const body: any = { ...payload };
      body.address = [
        [form.address_street, form.address_number].filter(Boolean).join(" "),
        form.address_city, form.address_province, form.address_zip
      ].filter(Boolean).join(", ");
      if (!body.referred_by_contact_id) delete body.referred_by_contact_id;
      if (!body.referral_type) delete body.referral_type;
      if (!body.birth_date) delete body.birth_date;

      let contactId: string;
      if (isEdit && editId) {
        await api(`/contacts/${editId}`, { method: "PUT", body });
        contactId = editId;
      } else {
        const c = await api<{ contact_id: string }>("/contacts", { method: "POST", body });
        contactId = c.contact_id;
      }

      // attach photos as notes with kind="photo" (only new ones during create)
      if (!isEdit) {
        for (const p of photos) {
          try { await api(`/contacts/${contactId}/notes`, { method: "POST", body: { kind: "photo", photo_base64: p } }); } catch {}
        }
      }

      // Upload pending attachments for email_note & general_note
      const uploadAttachments = async (list: PendingAttachment[], category: "email" | "general") => {
        for (const att of list) {
          try {
            const noteBody: any = { kind: att.kind, category };
            if (att.kind === "photo") noteBody.photo_base64 = att.photo_base64;
            if (att.kind === "audio") { noteBody.audio_base64 = att.audio_base64; noteBody.audio_mime = att.audio_mime; }
            if (att.kind === "video") { noteBody.video_base64 = att.video_base64; noteBody.video_mime = att.video_mime; }
            if (att.kind === "file") { noteBody.file_base64 = att.file_base64; noteBody.file_name = att.file_name; noteBody.file_mime = att.file_mime; noteBody.file_size = att.file_size; }
            await api(`/contacts/${contactId}/notes`, { method: "POST", body: noteBody });
          } catch (e) { console.warn("upload attachment failed", e); }
        }
      };
      await uploadAttachments(emailAttachments, "email");
      await uploadAttachments(generalAttachments, "general");
      // schedule birthday reminder if birth_date present
      if (form.birth_date && form.birth_date.length >= 5) {
        try {
          await scheduleBirthdayReminder(contactId, `${form.first_name} ${form.last_name}`.trim(), form.birth_date, form.birthday_alert_days_before);
        } catch {}
      }
      if (isEdit) {
        router.replace(`/contact/${contactId}`);
      } else {
        // Show post-creation modal offering to create an appointment right away
        setPostCreateModal({
          contact_id: contactId,
          name: `${form.first_name} ${form.last_name}`.trim() || "il nuovo contatto",
        });
      }
    } finally { setBusy(false); }
  };

  const addTag = () => {
    const t = form.tag_input.trim();
    if (!t) return;
    if (form.tags.includes(t)) return;
    setForm({ ...form, tags: [...form.tags, t], tag_input: "" });
  };

  const removeTag = (t: string) => setForm({ ...form, tags: form.tags.filter((x) => x !== t) });

  // Build all available areas: built-in + custom from settings
  const allAreas: { id: string; name: string; color: string; builtin?: boolean }[] = [
    ...(allowed.includes("energy") ? [{ id: "energy", name: settings?.energy_title || "Consulente Energetico", color: settings?.energy_color || theme.color.energy, builtin: true }] : []),
    ...(allowed.includes("network") ? [{ id: "network", name: settings?.network_title || "Networker", color: settings?.network_color || theme.color.network, builtin: true }] : []),
    ...(settings?.custom_areas || []).map((a) => ({ id: a.id, name: a.name, color: a.color })),
  ];

  const toggleArea = (areaId: string) => {
    // If it's not selected anywhere, add it. If already selected as primary → do nothing (must have primary). If additional → remove.
    const isPrimary = form.area === areaId;
    const isAdditional = form.additional_areas.includes(areaId);
    if (!isPrimary && !isAdditional) {
      // Add: first check if we have a primary yet
      if (!form.area || !allAreas.some((a) => a.id === form.area)) {
        setForm({ ...form, area: (areaId === "energy" || areaId === "network") ? (areaId as "energy" | "network") : form.area, additional_areas: (areaId !== "energy" && areaId !== "network") ? [...form.additional_areas, areaId] : form.additional_areas });
      } else {
        setForm({ ...form, additional_areas: [...form.additional_areas, areaId] });
      }
    } else if (isAdditional) {
      setForm({ ...form, additional_areas: form.additional_areas.filter((x) => x !== areaId) });
    } else if (isPrimary && form.additional_areas.length > 0) {
      // Promote another to primary if it's a built-in
      const nextBuiltIn = form.additional_areas.find((x) => x === "energy" || x === "network");
      if (nextBuiltIn) {
        setForm({ ...form, area: nextBuiltIn as "energy" | "network", additional_areas: form.additional_areas.filter((x) => x !== nextBuiltIn) });
      }
    }
  };
  const isAreaSelected = (areaId: string) => form.area === areaId || form.additional_areas.includes(areaId);

  const saveNewCustomArea = async () => {
    if (!newAreaName.trim() || !settings) return;
    const newArea: CustomArea = {
      id: `area_${Date.now().toString(36)}`,
      name: newAreaName.trim(),
      color: newAreaColor,
    };
    const updated = { ...settings, custom_areas: [...(settings.custom_areas || []), newArea] };
    try {
      const saved = await api<Settings>("/settings", { method: "PUT", body: updated });
      setSettings(saved);
      // Auto-select the newly created area
      setForm({ ...form, additional_areas: [...form.additional_areas, newArea.id] });
      setNewAreaModal(false);
      setNewAreaName("");
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile salvare");
    }
  };

  // Groups inline management
  const [groupModal, setGroupModal] = useState<{ mode: "create" | "edit"; group_id?: string; name: string; color: string } | null>(null);

  const openNewGroup = () => setGroupModal({ mode: "create", name: "", color: AREA_COLOR_SWATCHES[0] });
  const openEditGroup = (g: Group) => setGroupModal({ mode: "edit", group_id: g.group_id, name: g.name, color: g.color });

  const saveGroupModal = async () => {
    if (!groupModal || !groupModal.name.trim()) return;
    try {
      if (groupModal.mode === "create") {
        const created = await api<{ group_id: string; name: string; color: string }>("/groups", {
          method: "POST",
          body: { name: groupModal.name.trim(), color: groupModal.color, description: "" },
        });
        // reload
        const r = await api<{ items: Group[] }>("/groups");
        setAvailableGroups(r.items);
        // auto-assign
        setForm({ ...form, group_ids: [...form.group_ids, created.group_id] });
      } else if (groupModal.mode === "edit" && groupModal.group_id) {
        await api(`/groups/${groupModal.group_id}`, {
          method: "PUT",
          body: { name: groupModal.name.trim(), color: groupModal.color },
        });
        const r = await api<{ items: Group[] }>("/groups");
        setAvailableGroups(r.items);
      }
      setGroupModal(null);
    } catch (e: any) {
      notify("Errore", e?.message || "Salvataggio fallito");
    }
  };

  const deleteGroupInline = (g: Group) => {
    notify("Elimina gruppo", `Vuoi eliminare "${g.name}"? Tutti i contatti perderanno l'associazione.`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive", onPress: async () => {
          await api(`/groups/${g.group_id}`, { method: "DELETE" });
          const r = await api<{ items: Group[] }>("/groups");
          setAvailableGroups(r.items);
          setForm({ ...form, group_ids: form.group_ids.filter((x) => x !== g.group_id) });
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? "Modifica contatto" : "Nuovo contatto"}</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <Pressable testID="import-phone-btn" onPress={importFromPhone} style={styles.importBtn}>
            <Ionicons name="download-outline" size={18} color={theme.color.brandPrimary} />
            <Text style={styles.importBtnTxt}>Importa dalla rubrica telefono</Text>
          </Pressable>

          <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
            <Pressable testID="ai-card-btn" onPress={() => openAI("card")} style={[styles.aiBtn, { backgroundColor: "#8B5CF6" }]}>
              <Ionicons name="scan" size={16} color="#FFF" />
              <Text style={styles.aiBtnTxt}>Biglietto</Text>
            </Pressable>
            <Pressable testID="ai-qr-btn" onPress={() => setShowQrScanner(true)} style={[styles.aiBtn, { backgroundColor: "#059669" }]}>
              <Ionicons name="qr-code" size={16} color="#FFF" />
              <Text style={styles.aiBtnTxt}>QR</Text>
            </Pressable>
            <Pressable testID="ai-url-btn" onPress={() => openAI("url")} style={[styles.aiBtn, { backgroundColor: "#0891B2" }]}>
              <Ionicons name="link" size={16} color="#FFF" />
              <Text style={styles.aiBtnTxt}>Da URL</Text>
            </Pressable>
            <Pressable testID="ai-voice-btn" onPress={() => openAI("voice")} style={[styles.aiBtn, { backgroundColor: "#DC2626" }]}>
              <Ionicons name="mic" size={16} color="#FFF" />
              <Text style={styles.aiBtnTxt}>Dettato</Text>
            </Pressable>
          </View>

          <Section title="Anagrafica">
            <Row>
              <Field flex={1} label="Nome *" testID="c-first-name" value={form.first_name} onChangeText={(t: string) => setForm({ ...form, first_name: t })} />
              <Field flex={1} label="Cognome" testID="c-last-name" value={form.last_name} onChangeText={(t: string) => setForm({ ...form, last_name: t })} />
            </Row>
          </Section>

          <Section title="Aree di appartenenza *">
            <Text style={styles.hintTxt}>Puoi selezionare più aree contemporaneamente. La prima selezionata è quella principale (colora la scheda).</Text>
            <View style={styles.pillsRow}>
              {allAreas.map((a) => {
                const on = isAreaSelected(a.id);
                const primary = form.area === a.id;
                return (
                  <Pressable
                    key={a.id}
                    testID={`c-area-${a.id}`}
                    onPress={() => toggleArea(a.id)}
                    style={[styles.pill, { flexDirection: "row", alignItems: "center" }, on && { backgroundColor: a.color, borderColor: a.color }]}
                  >
                    {on && <Ionicons name="checkmark" size={14} color="#FFF" style={{ marginRight: 4 }} />}
                    <Text style={[styles.pillTxt, on && styles.pillTxtActive]}>{a.name}{primary ? " ★" : ""}</Text>
                  </Pressable>
                );
              })}
              <Pressable testID="c-area-new" onPress={() => setNewAreaModal(true)} style={[styles.pill, { flexDirection: "row", alignItems: "center", borderStyle: "dashed", borderColor: theme.color.brandPrimary }]}>
                <Ionicons name="add" size={14} color={theme.color.brandPrimary} style={{ marginRight: 4 }} />
                <Text style={[styles.pillTxt, { color: theme.color.brandPrimary }]}>Nuova area</Text>
              </Pressable>
            </View>
            {(form.area || form.additional_areas.length > 0) && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.hintTxt}>
                  {[form.area && allAreas.find((a) => a.id === form.area)?.name, ...form.additional_areas.map((id) => allAreas.find((a) => a.id === id)?.name)].filter(Boolean).join(" · ")}
                </Text>
              </View>
            )}
          </Section>

          <Section title="Gruppi">
            <Text style={styles.hintTxt}>Assegna il contatto ai gruppi (per invii bulk email/WhatsApp/Telegram). Tocca a lungo un gruppo per rinominarlo o eliminarlo.</Text>
            <View style={styles.pillsRow}>
              {availableGroups.map((g) => {
                const on = form.group_ids.includes(g.group_id);
                return (
                  <Pressable
                    key={g.group_id}
                    testID={`c-group-${g.group_id}`}
                    onPress={() => setForm({
                      ...form,
                      group_ids: on ? form.group_ids.filter((x) => x !== g.group_id) : [...form.group_ids, g.group_id],
                    })}
                    onLongPress={() => {
                      notify(g.name, "Cosa vuoi fare?", [
                        { text: "Annulla", style: "cancel" },
                        { text: "Rinomina / colore", onPress: () => openEditGroup(g) },
                        { text: "Elimina", style: "destructive", onPress: () => deleteGroupInline(g) },
                      ]);
                    }}
                    style={[styles.pill, { flexDirection: "row", alignItems: "center" }, on && { backgroundColor: g.color, borderColor: g.color }]}
                  >
                    {on && <Ionicons name="checkmark-circle" size={14} color="#FFF" style={{ marginRight: 4 }} />}
                    <View style={[styles.dot, { backgroundColor: on ? "#FFF" : g.color }]} />
                    <Text style={[styles.pillTxt, on && styles.pillTxtActive]}>{g.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                testID="c-group-new"
                onPress={openNewGroup}
                style={[styles.pill, { flexDirection: "row", alignItems: "center", borderStyle: "dashed", borderColor: theme.color.brandPrimary }]}
              >
                <Ionicons name="add" size={14} color={theme.color.brandPrimary} style={{ marginRight: 4 }} />
                <Text style={[styles.pillTxt, { color: theme.color.brandPrimary }]}>Nuovo gruppo</Text>
              </Pressable>
            </View>
            {form.group_ids.length > 0 && (
              <View style={styles.selectedBox}>
                <Ionicons name="checkmark-circle" size={16} color={theme.color.success} />
                <Text style={styles.selectedTxt}>
                  Assegnato a {form.group_ids.length} grupp{form.group_ids.length === 1 ? "o" : "i"}: {form.group_ids.map((id) => availableGroups.find((g) => g.group_id === id)?.name).filter(Boolean).join(", ")}
                </Text>
              </View>
            )}
          </Section>

          <Section title="Dati anagrafici">
            <Text style={styles.lbl}>Data di nascita / Compleanno</Text>
            {Platform.OS === "web" ? (
              <View style={{ marginBottom: 4 }}>
                {/* @ts-expect-error web-only */}
                <input
                  type="date"
                  data-testid="c-birth-date-web"
                  value={(() => {
                    const p = form.birth_date.split("/");
                    if (p.length === 3) {
                      const y = p[2].padStart(4, "0"), m = p[1].padStart(2, "0"), d = p[0].padStart(2, "0");
                      return `${y}-${m}-${d}`;
                    }
                    return "";
                  })()}
                  onChange={(e: any) => {
                    const v = e.target.value;
                    if (!v) { setForm({ ...form, birth_date: "" }); return; }
                    const [y, m, d] = v.split("-");
                    setForm({ ...form, birth_date: `${d}/${m}/${y}` });
                  }}
                  style={webDateInputStyle}
                />
              </View>
            ) : (
              <Field label="" testID="c-birth-date" value={form.birth_date} onChangeText={(t: string) => setForm({ ...form, birth_date: t })} placeholder="gg/mm/aaaa" />
            )}

            {form.birth_date.length >= 5 && (
              <>
                <Text style={styles.lbl}>Avviso compleanno</Text>
                <View style={styles.pillsRow}>
                  {[
                    { d: 0, label: "Solo il giorno" },
                    { d: 1, label: "1 giorno prima" },
                    { d: 2, label: "2 giorni prima" },
                  ].map((o) => (
                    <Pressable key={o.d} testID={`c-bday-alert-${o.d}`} onPress={() => setForm({ ...form, birthday_alert_days_before: o.d })} style={[styles.pill, form.birthday_alert_days_before === o.d && styles.pillActive]}>
                      <Text style={[styles.pillTxt, form.birthday_alert_days_before === o.d && styles.pillTxtActive]}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.switchLbl}>Invia automaticamente messaggio</Text>
                  <Pressable testID="c-bday-auto" onPress={() => setForm({ ...form, birthday_auto_send: !form.birthday_auto_send })}>
                    <Ionicons name={form.birthday_auto_send ? "toggle" : "toggle-outline"} size={38} color={form.birthday_auto_send ? theme.color.success : theme.color.muted} />
                  </Pressable>
                </View>
                {form.birthday_auto_send && (
                  <>
                    <View style={styles.rowBetween}>
                      <Text style={styles.switchLbl}>Cliente ancora attivo</Text>
                      <Pressable testID="c-bday-active" onPress={() => setForm({ ...form, is_active_client: !form.is_active_client })}>
                        <Ionicons name={form.is_active_client ? "toggle" : "toggle-outline"} size={38} color={form.is_active_client ? theme.color.success : theme.color.muted} />
                      </Pressable>
                    </View>
                    <Text style={styles.hintTxt}>
                      Se attivo, il messaggio ringrazierà il cliente per la continua fiducia e lo inviterà a contattarti per informazioni.
                    </Text>

                    {/* V38H — Sender email picker */}
                    {userEmails.length > 0 && (
                      <>
                        <Text style={styles.lbl}>Email mittente</Text>
                        <View style={styles.pillsRow}>
                          {userEmails.map((em) => (
                            <Pressable
                              key={em}
                              testID={`c-bday-from-${em}`}
                              onPress={() => setForm({ ...form, birthday_sender_email: em })}
                              style={[styles.pill, form.birthday_sender_email === em && styles.pillActive]}
                            >
                              <Text style={[styles.pillTxt, form.birthday_sender_email === em && styles.pillTxtActive]} numberOfLines={1}>{em}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <Text style={styles.hintTxt}>Puoi aggiungere altri indirizzi in Profilo → Email aggiuntive.</Text>
                      </>
                    )}

                    {/* V38H — Recipient email picker (from contact.email/email_alt) */}
                    {(form.email || form.email_alt) && (
                      <>
                        <Text style={styles.lbl}>Email destinatario</Text>
                        <View style={styles.pillsRow}>
                          {[form.email, form.email_alt].filter(Boolean).map((em) => (
                            <Pressable
                              key={em as string}
                              testID={`c-bday-to-${em}`}
                              onPress={() => setForm({ ...form, birthday_recipient_email: em as string })}
                              style={[styles.pill, form.birthday_recipient_email === em && styles.pillActive]}
                            >
                              <Text style={[styles.pillTxt, form.birthday_recipient_email === em && styles.pillTxtActive]} numberOfLines={1}>{em as string}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    )}
                  </>
                )}
                {form.birthday_auto_send && (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                      <Text style={styles.lbl}>Messaggio compleanno {isEdit ? "" : "(opzionale)"}</Text>
                      {isEdit && editId && (
                        <Pressable
                          testID="c-bday-generate-ai"
                          disabled={bdayGenerating}
                          onPress={async () => {
                            try {
                              setBdayGenerating(true);
                              const r = await api<{ message: string }>(
                                `/contacts/${editId}/birthday/generate-message`,
                                { method: "POST" }
                              );
                              if (r?.message) {
                                setForm({ ...form, birthday_message: r.message });
                                notify("Messaggio generato", "L'AI ha creato un nuovo messaggio personalizzato.");
                              }
                            } catch (e: any) {
                              notify("Errore AI", e?.message || "Impossibile generare il messaggio");
                            } finally {
                              setBdayGenerating(false);
                            }
                          }}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: "#EDE9FE" }}
                        >
                          {bdayGenerating ? (
                            <ActivityIndicator size="small" color="#7C3AED" />
                          ) : (
                            <Ionicons name="sparkles" size={14} color="#7C3AED" />
                          )}
                          <Text style={{ color: "#7C3AED", fontSize: 12, fontWeight: "700" }}>Genera con AI</Text>
                        </Pressable>
                      )}
                    </View>
                    <Field
                      label=""
                      testID="c-bday-msg"
                      value={form.birthday_message}
                      onChangeText={(t: string) => setForm({ ...form, birthday_message: t })}
                      placeholder={isEdit ? "Tocca 'Genera con AI' o scrivi manualmente…" : "Salva prima il contatto per usare la generazione AI."}
                      multiline
                    />
                  </>
                )}
                {form.birthday_auto_send && (
                  <Field label="Link da allegare (opzionale)" testID="c-bday-link" value={form.birthday_message_link} onChangeText={(t: string) => setForm({ ...form, birthday_message_link: t })} placeholder="https://..." autoCapitalize="none" />
                )}
              </>
            )}
            <Row>
              <Field flex={1} label="Codice Fiscale" testID="c-fiscal-code" value={form.fiscal_code} onChangeText={(t: string) => setForm({ ...form, fiscal_code: t.toUpperCase() })} />
              <Field flex={1} label="Partita IVA" testID="c-vat" value={form.vat_number} onChangeText={(t: string) => setForm({ ...form, vat_number: t })} />
            </Row>

            <View style={{ marginTop: 12 }}>
              <Text style={styles.lbl}>Ricorrenze importanti</Text>
              <Text style={styles.hintTxt}>Es. Data iscrizione, Anniversario matrimonio, Data primo contratto...</Text>
              {form.anniversaries.map((ann, idx) => (
                <View key={idx} style={styles.annRow}>
                  <TextInput
                    testID={`c-ann-name-${idx}`}
                    placeholder="Nome ricorrenza"
                    placeholderTextColor="#94A3B8"
                    value={ann.name}
                    onChangeText={(t) => {
                      const list = [...form.anniversaries];
                      list[idx] = { ...list[idx], name: t };
                      setForm({ ...form, anniversaries: list });
                    }}
                    style={[styles.input, { flex: 1, marginRight: 6 }]}
                  />
                  {Platform.OS === "web" ? (
                    // @ts-expect-error web
                    <input
                      type="date"
                      data-testid={`c-ann-date-${idx}`}
                      value={(() => {
                        const p = (ann.date || "").split("/");
                        if (p.length === 3) return `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
                        return "";
                      })()}
                      onChange={(e: any) => {
                        const v = e.target.value;
                        const list = [...form.anniversaries];
                        if (!v) { list[idx] = { ...list[idx], date: "" }; }
                        else {
                          const [y, m, d] = v.split("-");
                          list[idx] = { ...list[idx], date: `${d}/${m}/${y}` };
                        }
                        setForm({ ...form, anniversaries: list });
                      }}
                      style={webDateInputStyle}
                    />
                  ) : (
                    <TextInput
                      testID={`c-ann-date-${idx}`}
                      placeholder="gg/mm/aaaa"
                      placeholderTextColor="#94A3B8"
                      value={ann.date}
                      onChangeText={(t) => {
                        const list = [...form.anniversaries];
                        list[idx] = { ...list[idx], date: t };
                        setForm({ ...form, anniversaries: list });
                      }}
                      style={[styles.input, { width: 130 }]}
                    />
                  )}
                  <Pressable
                    testID={`c-ann-remove-${idx}`}
                    onPress={() => {
                      const list = form.anniversaries.filter((_, i) => i !== idx);
                      setForm({ ...form, anniversaries: list });
                    }}
                    style={{ padding: 8, marginLeft: 4 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.color.error} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                testID="c-ann-add"
                onPress={() => setForm({ ...form, anniversaries: [...form.anniversaries, { name: "", date: "" }] })}
                style={[styles.pill, { flexDirection: "row", alignItems: "center", borderStyle: "dashed", borderColor: theme.color.brandPrimary, alignSelf: "flex-start", marginTop: 6 }]}
              >
                <Ionicons name="add" size={14} color={theme.color.brandPrimary} style={{ marginRight: 4 }} />
                <Text style={[styles.pillTxt, { color: theme.color.brandPrimary }]}>Aggiungi ricorrenza</Text>
              </Pressable>
            </View>
          </Section>

          <Section title="Contatti">
            <Field label="Telefono cellulare" testID="c-phone" value={form.phone} onChangeText={(t: string) => setForm({ ...form, phone: t })} keyboardType="phone-pad" />
            <Row>
              <Field flex={1} label="Telefono fisso" testID="c-phone-alt" value={form.phone_alt} onChangeText={(t: string) => setForm({ ...form, phone_alt: t })} keyboardType="phone-pad" />
              <Field flex={1} label="WhatsApp" testID="c-whatsapp" value={form.whatsapp} onChangeText={(t: string) => setForm({ ...form, whatsapp: t })} keyboardType="phone-pad" />
            </Row>
            <Field label="Email principale" testID="c-email" value={form.email} onChangeText={(t: string) => setForm({ ...form, email: t })} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Email 2°" testID="c-email-alt" value={form.email_alt} onChangeText={(t: string) => setForm({ ...form, email_alt: t })} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Telegram (username, es. @mario)" testID="c-telegram" value={form.telegram} onChangeText={(t: string) => setForm({ ...form, telegram: t })} autoCapitalize="none" />
          </Section>

          <Section title="Indirizzo">
            <Row>
              <Field flex={3} label="Via" testID="c-street" value={form.address_street} onChangeText={(t: string) => setForm({ ...form, address_street: t })} placeholder="Via Verdi" />
              <Field flex={1} label="N. civico" testID="c-number" value={form.address_number} onChangeText={(t: string) => setForm({ ...form, address_number: t })} placeholder="15" />
            </Row>
            <Row>
              <Field flex={2} label="Città" testID="c-city" value={form.address_city} onChangeText={(t: string) => setForm({ ...form, address_city: t })} />
              <Field flex={1} label="CAP" testID="c-zip" value={form.address_zip} onChangeText={(t: string) => setForm({ ...form, address_zip: t })} keyboardType="number-pad" />
              <Field flex={1} label="Prov." testID="c-prov" value={form.address_province} onChangeText={(t: string) => setForm({ ...form, address_province: t.toUpperCase().slice(0, 2) })} />
            </Row>
            <Field
              label="Indirizzo di lavoro"
              testID="c-work-address"
              value={form.work_address}
              onChangeText={(t: string) => setForm({ ...form, work_address: t })}
              placeholder="Es. Via Roma 10, 20100 Milano MI"
            />
            <Field
              label="Indirizzo di residenza"
              testID="c-residence-address"
              value={form.residence_address}
              onChangeText={(t: string) => setForm({ ...form, residence_address: t })}
              placeholder="Es. Via Dante 5, 35100 Padova PD"
            />
          </Section>

          <Section title="Origine e riferimento">
            <Text style={styles.lbl}>Origine</Text>
            <View style={styles.pillsRow}>
              <Pressable testID="c-source-personal" onPress={() => setForm({ ...form, source: "personal", referral_type: "", referred_by_contact_id: "" })} style={[styles.pill, form.source === "personal" && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === "personal" && styles.pillTxtActive]}>Conoscenza personale</Text>
              </Pressable>
              <Pressable testID="c-source-ref-direct" onPress={() => setForm({ ...form, source: "referral", referral_type: "direct", referred_by_contact_id: "" })} style={[styles.pill, form.source === "referral" && form.referral_type === "direct" && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === "referral" && form.referral_type === "direct" && styles.pillTxtActive]}>Referenza diretta personale</Text>
              </Pressable>
              <Pressable testID="c-source-ref-contact" onPress={() => setForm({ ...form, source: "referral", referral_type: "from_contact" })} style={[styles.pill, form.source === "referral" && form.referral_type === "from_contact" && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === "referral" && form.referral_type === "from_contact" && styles.pillTxtActive]}>Referenza da altro contatto</Text>
              </Pressable>
            </View>

            {form.source === "referral" && form.referral_type === "from_contact" && (
              <>
                <Text style={styles.lbl}>Chi lo ha segnalato</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {contacts.length === 0 ? (
                    <Text style={{ color: theme.color.muted, fontSize: 12, paddingVertical: 8 }}>Ancora nessun contatto in rubrica</Text>
                  ) : contacts.map((c) => (
                    <Pressable key={c.contact_id} onPress={() => setForm({ ...form, referred_by_contact_id: c.contact_id })} style={[styles.pill, form.referred_by_contact_id === c.contact_id && styles.pillActive]}>
                      <Text style={[styles.pillTxt, form.referred_by_contact_id === c.contact_id && styles.pillTxtActive]}>{c.first_name} {c.last_name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

            {form.source === "referral" && (
              <>
                <View style={{ height: 8 }} />
                <Field label="Nota alla referenza" testID="c-referral-note" value={form.referral_note} onChangeText={(t: string) => setForm({ ...form, referral_note: t })} multiline />
              </>
            )}

            <Text style={styles.lbl}>Tag</Text>
            <View style={styles.tagRow}>
              <TextInput
                testID="c-tag-input"
                value={form.tag_input}
                onChangeText={(t) => setForm({ ...form, tag_input: t })}
                onSubmitEditing={addTag}
                style={[styles.input, { flex: 1 }]}
                placeholder="Es. VIP, energia+gas"
                placeholderTextColor="#94A3B8"
                returnKeyType="done"
              />
              <Pressable testID="c-tag-add" onPress={addTag} style={styles.tagAddBtn}>
                <Ionicons name="add" size={20} color="#FFF" />
              </Pressable>
            </View>
            {form.tags.length > 0 && (
              <View style={styles.tagsWrap}>
                {form.tags.map((t) => (
                  <Pressable key={t} onPress={() => removeTag(t)} style={styles.tagChip}>
                    <Text style={styles.tagChipTxt}>{t}</Text>
                    <Ionicons name="close" size={12} color={theme.color.brandPrimary} />
                  </Pressable>
                ))}
              </View>
            )}
          </Section>

          <Section title="Foto contatto">
            <View style={styles.photoRow}>
              <Pressable testID="photo-camera" onPress={() => pickPhoto(true)} style={styles.photoAddBtn}>
                <Ionicons name="camera" size={22} color={theme.color.brandPrimary} />
                <Text style={styles.photoAddTxt}>Foto camera</Text>
              </Pressable>
              <Pressable testID="photo-gallery" onPress={() => pickPhoto(false)} style={styles.photoAddBtn}>
                <Ionicons name="image" size={22} color={theme.color.brandPrimary} />
                <Text style={styles.photoAddTxt}>Da galleria</Text>
              </Pressable>
            </View>
            {form.photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
                {form.photos.map((p, i) => (
                  <Pressable key={i} onPress={() => removePhoto(i)}>
                    <View style={styles.photoThumb}>
                      <Image source={{ uri: p }} style={styles.photoThumbImg} />
                      <View style={styles.photoThumbRemove}><Ionicons name="close" size={14} color="#FFF" /></View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Section>

          <Pressable testID="c-toggle-more" onPress={() => setShowMore(!showMore)} style={styles.toggleMore}>
            <Text style={styles.toggleMoreTxt}>{showMore ? "Nascondi" : "Mostra"} campi aggiuntivi (web, social, note)</Text>
            <Ionicons name={showMore ? "chevron-up" : "chevron-down"} size={16} color={theme.color.brandPrimary} />
          </Pressable>

          {showMore && (
            <>
              <Section title="Web & Social">
                <Field label="Sito web" testID="c-website" value={form.website} onChangeText={(t: string) => setForm({ ...form, website: t })} autoCapitalize="none" />
                <Field label="LinkedIn" testID="c-linkedin" value={form.linkedin} onChangeText={(t: string) => setForm({ ...form, linkedin: t })} autoCapitalize="none" />
                <Field label="Instagram" testID="c-instagram" value={form.instagram} onChangeText={(t: string) => setForm({ ...form, instagram: t })} autoCapitalize="none" />
                <Field label="Facebook" testID="c-facebook" value={form.facebook} onChangeText={(t: string) => setForm({ ...form, facebook: t })} autoCapitalize="none" />
              </Section>

              <Section title="Note">
                <Field label="Nota email condivisibile" testID="c-email-note" value={form.email_note} onChangeText={(t: string) => setForm({ ...form, email_note: t })} multiline />
                <NoteMediaBar
                  target="email"
                  recording={recordingFor === "email"}
                  onPhotoCam={() => pickPhotoFor("email", true)}
                  onPhotoGal={() => pickPhotoFor("email", false)}
                  onFile={() => pickFileFor("email")}
                  onRecStart={() => startRecFor("email")}
                  onRecStop={stopRecFor}
                />
                <AttachmentsPreview list={emailAttachments} onRemove={(id) => removeAttachment("email", id)} />

                <View style={{ height: 12 }} />

                <Field label="Note generali" testID="c-general-note" value={form.general_note} onChangeText={(t: string) => setForm({ ...form, general_note: t })} multiline />
                <NoteMediaBar
                  target="general"
                  recording={recordingFor === "general"}
                  onPhotoCam={() => pickPhotoFor("general", true)}
                  onPhotoGal={() => pickPhotoFor("general", false)}
                  onFile={() => pickFileFor("general")}
                  onRecStart={() => startRecFor("general")}
                  onRecStop={stopRecFor}
                />
                <AttachmentsPreview list={generalAttachments} onRemove={(id) => removeAttachment("general", id)} />
              </Section>
            </>
          )}

          <Pressable testID="c-save-btn" onPress={submit} style={styles.saveBtn} disabled={busy || !form.first_name.trim()}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>{isEdit ? "Salva modifiche" : "Salva contatto"}</Text>}
          </Pressable>
          {isEdit && editId && (
            <Pressable
              testID="c-delete-btn"
              onPress={async () => {
                const ok = await confirmAsync(
                  "Eliminare la scheda cliente?",
                  `Verranno rimossi definitivamente il contatto "${form.first_name} ${form.last_name}".trim() e tutti i suoi dati (note, file, fatture, appuntamenti, chiamate). L'operazione è irreversibile.`
                );
                if (!ok) return;
                try {
                  setBusy(true);
                  await api(`/contacts/${editId}`, { method: "DELETE" });
                  notify("Cliente eliminato", "La scheda è stata rimossa.");
                  router.replace("/(tabs)/contatti");
                } catch (e: any) {
                  notify("Errore", e?.message || "Impossibile eliminare");
                } finally {
                  setBusy(false);
                }
              }}
              style={styles.deleteBtn}
              disabled={busy}
            >
              <Ionicons name="trash-outline" size={16} color="#DC2626" />
              <Text style={styles.deleteBtnTxt}>Elimina scheda cliente</Text>
            </Pressable>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={newAreaModal} transparent animationType="fade" onRequestClose={() => setNewAreaModal(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuova area personalizzata</Text>
            <Text style={styles.hintTxt}>Es. Assicurazioni, Immobiliare, Formazione...</Text>
            <Text style={styles.lbl}>Nome area</Text>
            <TextInput
              testID="new-area-name"
              value={newAreaName}
              onChangeText={setNewAreaName}
              placeholder="Nome della nuova area"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />
            <Text style={styles.lbl}>Colore</Text>
            <View style={styles.swatches}>
              {AREA_COLOR_SWATCHES.map((c) => (
                <Pressable key={c} onPress={() => setNewAreaColor(c)} style={[styles.swatch, { backgroundColor: c }, newAreaColor === c && styles.swatchActive]}>
                  {newAreaColor === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setNewAreaModal(false)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable testID="new-area-save" onPress={saveNewCustomArea} disabled={!newAreaName.trim()} style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary, opacity: newAreaName.trim() ? 1 : 0.5 }]}>
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Crea</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!groupModal} transparent animationType="fade" onRequestClose={() => setGroupModal(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{groupModal?.mode === "create" ? "Nuovo gruppo" : "Modifica gruppo"}</Text>
            <Text style={styles.hintTxt}>Es. Clienti VIP, Prospect, Team, Fornitori...</Text>
            <Text style={styles.lbl}>Nome</Text>
            <TextInput
              testID="c-group-modal-name"
              value={groupModal?.name || ""}
              onChangeText={(t) => setGroupModal((m) => m ? { ...m, name: t } : m)}
              placeholder="Nome del gruppo"
              placeholderTextColor="#94A3B8"
              autoFocus
              style={styles.input}
            />
            <Text style={styles.lbl}>Colore</Text>
            <View style={styles.swatches}>
              {AREA_COLOR_SWATCHES.map((c) => (
                <Pressable key={c} onPress={() => setGroupModal((m) => m ? { ...m, color: c } : m)} style={[styles.swatch, { backgroundColor: c }, groupModal?.color === c && styles.swatchActive]}>
                  {groupModal?.color === c && <Ionicons name="checkmark" size={16} color="#FFF" />}
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setGroupModal(null)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="c-group-modal-save"
                onPress={saveGroupModal}
                disabled={!groupModal?.name?.trim()}
                style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary, opacity: groupModal?.name?.trim() ? 1 : 0.5 }]}
              >
                <Text style={{ color: "#FFF", fontWeight: "700" }}>{groupModal?.mode === "create" ? "Crea" : "Salva"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Phone contacts multi-select picker */}
      <Modal visible={!!phoneContactsModal} animationType="slide" transparent onRequestClose={() => setPhoneContactsModal(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: "700", color: theme.color.onSurface }}>Importa dalla rubrica</Text>
                <Text style={{ fontSize: 11, color: theme.color.muted, marginTop: 2 }}>Seleziona uno o più contatti</Text>
              </View>
              <Pressable onPress={() => setPhoneContactsModal(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            {/* Search */}
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 10 }}>
                <Ionicons name="search" size={16} color={theme.color.muted} />
                <TextInput
                  value={phoneImportSearch}
                  onChangeText={setPhoneImportSearch}
                  placeholder="Cerca per nome o numero…"
                  placeholderTextColor={theme.color.muted}
                  style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 8, color: theme.color.onSurface, fontSize: 14 }}
                  testID="phone-import-search"
                />
                {!!phoneImportSearch && (
                  <Pressable hitSlop={8} onPress={() => setPhoneImportSearch("")}>
                    <Ionicons name="close-circle" size={18} color={theme.color.muted} />
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Pressable
                  onPress={toggleSelectAllVisible}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}
                  testID="phone-import-select-all"
                >
                  <Ionicons
                    name={
                      filteredPhoneContacts.length > 0 &&
                      filteredPhoneContacts.every((c: any) => c.id && phoneImportSelected.has(c.id))
                        ? "checkbox"
                        : "square-outline"
                    }
                    size={20}
                    color={theme.color.brandPrimary}
                  />
                  <Text style={{ fontSize: 13, color: theme.color.brandPrimary, fontWeight: "600" }}>
                    Seleziona tutti ({filteredPhoneContacts.length})
                  </Text>
                </Pressable>
                <Text style={{ fontSize: 12, color: theme.color.muted }}>
                  Selezionati: {phoneImportSelected.size}
                </Text>
              </View>
            </View>
            <ScrollView>
              {filteredPhoneContacts.map((c: any) => {
                const selected = c.id ? phoneImportSelected.has(c.id) : false;
                const displayName = c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "(senza nome)";
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => c.id && togglePhoneSelected(c.id)}
                    style={{
                      padding: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.color.border,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      backgroundColor: selected ? "#EFF6FF" : "transparent",
                    }}
                    testID={c.id ? `phone-import-row-${c.id}` : undefined}
                  >
                    <Ionicons
                      name={selected ? "checkbox" : "square-outline"}
                      size={22}
                      color={selected ? theme.color.brandPrimary : theme.color.muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: theme.color.onSurface }}>{displayName}</Text>
                      {!!c.phoneNumbers?.[0]?.number && (
                        <Text style={{ fontSize: 12, color: theme.color.muted, marginTop: 2 }}>{c.phoneNumbers[0].number}</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
              {filteredPhoneContacts.length === 0 && (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={{ color: theme.color.muted, fontSize: 13 }}>Nessun contatto trovato</Text>
                </View>
              )}
            </ScrollView>
            {/* Footer with Import button */}
            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: theme.color.border, backgroundColor: "#FFF" }}>
              {phoneImportBusy && phoneImportProgress ? (
                <View style={{ alignItems: "center", gap: 6 }}>
                  <ActivityIndicator color={theme.color.brandPrimary} />
                  <Text style={{ fontSize: 12, color: theme.color.muted }}>
                    Importazione in corso… {phoneImportProgress.done}/{phoneImportProgress.total}
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={commitMultiImport}
                  disabled={phoneImportSelected.size === 0}
                  style={{
                    backgroundColor: phoneImportSelected.size === 0 ? "#CBD5E1" : theme.color.brandPrimary,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                  testID="phone-import-confirm"
                >
                  <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 15 }}>
                    {phoneImportSelected.size <= 1
                      ? `Importa contatto`
                      : `Crea ${phoneImportSelected.size} nuovi contatti`}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Post-creation success modal: offer to create an appointment for the new contact */}
      <Modal
        visible={!!postCreateModal}
        animationType="fade"
        transparent
        onRequestClose={() => {
          const id = postCreateModal?.contact_id;
          setPostCreateModal(null);
          if (id) router.replace(`/contact/${id}`);
        }}
      >
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <View style={{ alignItems: "center", marginBottom: 10 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#DCFCE7", justifyContent: "center", alignItems: "center", marginBottom: 8 }}>
                <Ionicons name="checkmark-circle" size={40} color="#16A34A" />
              </View>
              <Text style={[styles.modalTitle, { textAlign: "center" }]}>Contatto salvato ✅</Text>
              <Text style={{ fontSize: 13, color: theme.color.muted, textAlign: "center", marginTop: 4 }}>
                Vuoi programmare subito un appuntamento con {postCreateModal?.name}?
              </Text>
            </View>
            <View style={{ gap: 10, marginTop: 8 }}>
              <Pressable
                testID="post-create-appt-btn"
                onPress={() => {
                  const id = postCreateModal?.contact_id;
                  const name = postCreateModal?.name || "";
                  setPostCreateModal(null);
                  if (id) {
                    router.replace(`/appointment/new?contact_id=${encodeURIComponent(id)}&contact_name=${encodeURIComponent(name)}`);
                  }
                }}
                style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary, flexDirection: "row", justifyContent: "center", gap: 8 }]}
              >
                <Ionicons name="calendar" size={18} color="#FFF" />
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Crea appuntamento per questo contatto</Text>
              </Pressable>
              <Pressable
                testID="post-create-skip-btn"
                onPress={() => {
                  const id = postCreateModal?.contact_id;
                  setPostCreateModal(null);
                  if (id) router.replace(`/contact/${id}`);
                }}
                style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, flexDirection: "row", justifyContent: "center", gap: 8 }]}
              >
                <Ionicons name="arrow-forward" size={18} color={theme.color.onSurface} />
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Salta, vai alla scheda</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI helper modal */}
      <Modal visible={!!aiMode} animationType="slide" transparent onRequestClose={closeAI}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.color.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: theme.color.onSurface }}>
                {aiMode === "card" ? "📸 Scanner biglietto" : aiMode === "url" ? "🔗 Estrai da URL" : "🎤 Dettato vocale"}
              </Text>
              <Pressable onPress={closeAI} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              {aiMode === "url" && (
                <>
                  <Text style={{ fontSize: 13, color: theme.color.muted }}>Incolla un URL (LinkedIn, sito aziendale, profilo…). L&apos;AI estrae i dati.</Text>
                  <TextInput
                    testID="ai-url-input"
                    value={aiUrl}
                    onChangeText={setAiUrl}
                    placeholder="https://…"
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="none"
                    keyboardType="url"
                    style={{ backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, color: theme.color.onSurface }}
                  />
                  <Pressable testID="ai-url-go" onPress={runAIUrl} disabled={aiBusy} style={{ backgroundColor: theme.color.brandPrimary, padding: 12, borderRadius: 10, alignItems: "center" }}>
                    {aiBusy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "800" }}>Estrai dati</Text>}
                  </Pressable>
                </>
              )}
              {aiMode === "card" && (
                <>
                  <Text style={{ fontSize: 13, color: theme.color.muted }}>Scatta una foto del biglietto da visita. L&apos;AI riconosce i campi.</Text>
                  <Pressable testID="ai-card-go" onPress={runAICard} disabled={aiBusy} style={{ backgroundColor: "#8B5CF6", padding: 14, borderRadius: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
                    <Ionicons name="camera" size={18} color="#FFF" />
                    {aiBusy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "800" }}>Scatta biglietto</Text>}
                  </Pressable>
                </>
              )}
              {aiMode === "voice" && (
                <>
                  <Text style={{ fontSize: 13, color: theme.color.muted }}>Tocca per iniziare/fermare. Es: &quot;Mario Rossi, telefono 335 1234567, email mario@rossi.it, indirizzo via Roma 10 Milano&quot;.</Text>
                  <Pressable testID="ai-voice-go" onPress={runAIVoice} disabled={aiBusy} style={{ backgroundColor: recordingFor === "general" ? "#DC2626" : "#16A34A", padding: 14, borderRadius: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
                    <Ionicons name={recordingFor === "general" ? "stop-circle" : "mic"} size={20} color="#FFF" />
                    <Text style={{ color: "#FFF", fontWeight: "800" }}>{recordingFor === "general" ? "Ferma registrazione" : (aiBusy ? "Elaborazione…" : "Inizia dettato")}</Text>
                  </Pressable>
                  {aiTranscript ? <Text style={{ fontSize: 12, color: theme.color.muted, fontStyle: "italic" }}>&quot;{aiTranscript}&quot;</Text> : null}
                </>
              )}

              {aiPreview && (
                <View style={{ marginTop: 12, backgroundColor: "#F1F5F9", borderRadius: 12, padding: 12, gap: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: theme.color.brandPrimary }}>🤖 Anteprima AI — verifica prima di salvare</Text>
                  {Object.entries(aiPreview).map(([k, v]) => (
                    <View key={k} style={{ flexDirection: "row", gap: 8 }}>
                      <Text style={{ fontSize: 12, color: theme.color.muted, fontWeight: "700", width: 100 }}>{k}</Text>
                      <Text style={{ fontSize: 12, color: theme.color.onSurface, flex: 1 }}>{String(v)}</Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <Pressable onPress={closeAI} style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border, alignItems: "center" }}>
                      <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
                    </Pressable>
                    <Pressable testID="ai-apply-btn" onPress={() => applyAIFields(aiPreview)} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: theme.color.success, alignItems: "center" }}>
                      <Text style={{ color: "#FFF", fontWeight: "800" }}>Applica al form</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* QR Scanner modal (V38I) */}
      <QRScannerModal
        visible={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onScanned={(data) => {
          setShowQrScanner(false);
          applyQrData(data);
        }}
      />

      {/* V38J — Duplicate contact detection modal */}
      <Modal visible={!!dupModal} animationType="fade" transparent onRequestClose={() => setDupModal(null)}>
        <View style={styles.modalBack}>
          <View style={[styles.modalCard, { maxWidth: 460 }]}>
            <View style={{ alignItems: "center", marginBottom: 8 }}>
              <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#FEF3C7", justifyContent: "center", alignItems: "center", marginBottom: 8 }}>
                <Ionicons name="alert-circle" size={30} color="#B45309" />
              </View>
              <Text style={[styles.modalTitle, { textAlign: "center" }]}>Contatto già esistente?</Text>
              <Text style={{ fontSize: 12, color: theme.color.muted, textAlign: "center", marginTop: 4 }}>
                {dupModal?.matches.length === 1
                  ? "Trovato 1 contatto con dati simili:"
                  : `Trovati ${dupModal?.matches.length} contatti con dati simili:`}
              </Text>
            </View>
            <ScrollView style={{ maxHeight: 240, marginVertical: 8 }}>
              {(dupModal?.matches || []).map((m) => {
                const nm = `${m.first_name} ${m.last_name}`.trim() || "(senza nome)";
                const contact = m.phone || m.phone_alt || m.email || m.email_alt || "";
                return (
                  <Pressable
                    key={m.contact_id}
                    testID={`dup-goto-${m.contact_id}`}
                    onPress={() => {
                      setDupModal(null);
                      router.replace(`/contact/${m.contact_id}`);
                    }}
                    style={{ flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: theme.color.border, marginBottom: 6, gap: 10 }}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.color.brandTertiary, justifyContent: "center", alignItems: "center" }}>
                      <Text style={{ color: theme.color.brandPrimary, fontWeight: "800" }}>{(m.first_name?.[0] || "?").toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: theme.color.onSurface }} numberOfLines={1}>{nm}</Text>
                      {contact ? (
                        <Text style={{ fontSize: 11, color: theme.color.muted }} numberOfLines={1}>{contact}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ gap: 8, marginTop: 6 }}>
              {/* V38X — New button: open existing contact directly in edit mode */}
              {dupModal?.matches.length === 1 && (
                <Pressable
                  testID="dup-update-existing-btn"
                  onPress={() => {
                    const target = dupModal!.matches[0];
                    setDupModal(null);
                    router.replace(`/contact/edit/${target.contact_id}`);
                  }}
                  style={[styles.modalBtn, { backgroundColor: "#16A34A", flexDirection: "row", justifyContent: "center", gap: 8 }]}
                >
                  <Ionicons name="create" size={18} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "700" }}>Aggiorna scheda esistente</Text>
                </Pressable>
              )}
              <Pressable
                testID="dup-save-new-btn"
                onPress={() => {
                  bypassDupRef.current = true;
                  setDupModal(null);
                  // Trigger submit again (bypass will let it through)
                  setTimeout(() => { submit(); }, 60);
                }}
                style={[styles.modalBtn, { backgroundColor: "#F97316", flexDirection: "row", justifyContent: "center", gap: 8 }]}
              >
                <Ionicons name="add-circle" size={18} color="#FFF" />
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Salva come nuovo contatto</Text>
              </Pressable>
              <Pressable
                testID="dup-cancel-btn"
                onPress={() => setDupModal(null)}
                style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, flexDirection: "row", justifyContent: "center", gap: 8 }]}
              >
                <Ionicons name="close" size={18} color={theme.color.onSurface} />
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Text style={{ fontSize: 11, color: theme.color.muted, textAlign: "center", marginTop: 4, fontStyle: "italic" }}>
                {dupModal?.matches.length === 1
                  ? "Aggiorna il contatto trovato oppure salvane uno nuovo se è un cliente diverso."
                  : "Tocca un contatto qui sopra per aprire la sua scheda esistente."}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function NoteMediaBar({ target, recording, onPhotoCam, onPhotoGal, onFile, onRecStart, onRecStop }: any) {
  return (
    <View style={mediaBarStyles.row}>
      <Pressable testID={`att-${target}-camera`} onPress={onPhotoCam} style={[mediaBarStyles.btn, { backgroundColor: theme.color.brandSecondary }]}>
        <Ionicons name="camera" size={14} color="#FFF" />
        <Text style={mediaBarStyles.txt}>Scatta foto</Text>
      </Pressable>
      <Pressable testID={`att-${target}-gallery`} onPress={onPhotoGal} style={[mediaBarStyles.btn, { backgroundColor: "#8B5CF6" }]}>
        <Ionicons name="image" size={14} color="#FFF" />
        <Text style={mediaBarStyles.txt}>Importa foto</Text>
      </Pressable>
      <Pressable testID={`att-${target}-file`} onPress={onFile} style={[mediaBarStyles.btn, { backgroundColor: "#0891B2" }]}>
        <Ionicons name="attach" size={14} color="#FFF" />
        <Text style={mediaBarStyles.txt}>Allega file</Text>
      </Pressable>
      <Pressable
        testID={`att-${target}-audio`}
        onPress={recording ? onRecStop : onRecStart}
        style={[mediaBarStyles.btn, { backgroundColor: recording ? theme.color.error : theme.color.warning }]}
      >
        <Ionicons name={recording ? "stop-circle" : "mic"} size={14} color="#FFF" />
        <Text style={mediaBarStyles.txt}>{recording ? "Stop" : "Registra audio"}</Text>
      </Pressable>
    </View>
  );
}

function AttachmentsPreview({ list, onRemove }: { list: PendingAttachment[]; onRemove: (id: string) => void }) {
  if (list.length === 0) return null;
  return (
    <View style={attStyles.wrap}>
      <Text style={attStyles.hint}>{list.length} allegat{list.length === 1 ? "o" : "i"} pronti da salvare</Text>
      <View style={attStyles.grid}>
        {list.map((a) => (
          <View key={a.local_id} style={attStyles.chip}>
            {a.kind === "photo" && a.photo_base64 ? (
              <Image source={{ uri: a.photo_base64 }} style={attStyles.thumb} />
            ) : (
              <View style={attStyles.iconBox}>
                <Ionicons
                  name={a.kind === "audio" ? "musical-notes" : a.kind === "video" ? "videocam" : "document"}
                  size={20} color={theme.color.brandPrimary}
                />
              </View>
            )}
            <Text style={attStyles.name} numberOfLines={1}>
              {a.kind === "photo" ? "Foto" : a.kind === "audio" ? "Vocale" : a.kind === "video" ? "Video" : (a.file_name || "File")}
            </Text>
            <Pressable onPress={() => onRemove(a.local_id)} style={attStyles.rmBtn} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={theme.color.error} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const mediaBarStyles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: theme.radius.pill },
  txt: { color: "#FFF", fontWeight: "700", fontSize: 11 },
});
const attStyles = StyleSheet.create({
  wrap: { marginTop: 8, padding: 10, backgroundColor: "#F0F9FF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "#BAE6FD" },
  hint: { color: theme.color.info, fontSize: 11, fontWeight: "700", marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, padding: 6, backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, maxWidth: 200 },
  thumb: { width: 36, height: 36, borderRadius: 6 },
  iconBox: { width: 36, height: 36, borderRadius: 6, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 12, color: theme.color.onSurface, flex: 1 },
  rmBtn: { padding: 2 },
});

function Section({ title, children }: { title: string; children: any }) {  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: any }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}

function Field({ label, multiline, flex, ...rest }: any) {
  return (
    <View style={{ marginTop: 8, flex: flex }}>
      <Text style={styles.lbl}>{label}</Text>
      <TextInput
        {...rest}
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: "top" }]}
        placeholderTextColor="#94A3B8"
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  content: { padding: 16, paddingBottom: 140 },
  section: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border, marginTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface },
  pillsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 13 },
  pillTxtActive: { color: "#FFF" },
  tagRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  tagAddBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.brandPrimary, alignItems: "center", justifyContent: "center" },
  tagsWrap: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  tagChipTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  switchLbl: { fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  toggleMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, paddingVertical: 10 },
  toggleMoreTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 13 },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.brandPrimary, borderStyle: "dashed" },
  aiBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, borderRadius: theme.radius.md },
  aiBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  importBtnTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 14 },
  photoRow: { flexDirection: "row", gap: 10 },
  photoAddBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.surface, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  photoAddTxt: { color: theme.color.brandPrimary, fontWeight: "600", fontSize: 13 },
  photoThumb: { position: "relative", width: 80, height: 80 },
  photoThumbImg: { width: 80, height: 80, borderRadius: theme.radius.md },
  photoThumbRemove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.color.error, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFF" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FEE2E2", paddingVertical: 12, borderRadius: theme.radius.md, marginTop: 10, borderWidth: 1, borderColor: "#FCA5A5" },
  deleteBtnTxt: { color: "#DC2626", fontWeight: "700", fontSize: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  linkChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brandTertiary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, alignSelf: "flex-start" },
  linkChipTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
  hintTxt: { color: theme.color.muted, fontSize: 12, marginBottom: 8, fontStyle: "italic" },
  annRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  selectedBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: theme.radius.md, padding: 10, marginTop: 10, borderWidth: 1, borderColor: theme.color.success },
  selectedTxt: { flex: 1, color: theme.color.success, fontSize: 12, fontWeight: "600" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface, marginBottom: 8 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: theme.color.onSurface },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center" },
});

const webDateInputStyle: any = {
  width: "100%",
  backgroundColor: theme.color.surface,
  border: `1px solid ${theme.color.border}`,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 15,
  color: theme.color.onSurface,
  fontFamily: "inherit",
  outline: "none",
};

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Linking, Platform, Image, Modal } from "react-native";
import { KModalBody } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { LinearGradient } from "expo-linear-gradient"; // V50.z335 — header dark premium
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect, router as expoRouter } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets, createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { pickCommonFile } from "@/src/utils/filePicker";
import { notify } from "@/src/utils/notify";
import { openInAppLink } from "@/src/utils/openInAppLink";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { PendingBadge } from "@/src/OfflineBanner"; // V50.z281
import { theme } from "@/src/theme";
import { ContactContractsSection } from "@/src/ContactContractsSection"; // V50.z262 — tab Contratti
import { pickAvatarBase64 } from "@/src/image-picker";
import { CalculatorFAB } from "@/src/CalculatorFAB";
import { shareText, shareDataUri } from "@/src/share";
import { openTelegram } from "@/src/utils/telegram";
import { BillsSection } from "@/src/BillsSection";
import { ContactVisitsSection } from "@/src/ContactVisitsSection"; // V50.z256 — Frequenza ripasso + Storico visite
import { ShareSheet, ShareTarget } from "@/src/ShareSheet";
import { FileViewer } from "@/src/FileViewer";
import { VoiceDictationButton } from "@/src/VoiceDictationButton";
import { ContactAudioSection } from "@/src/ContactAudioSection";
import { ContactCallsSection } from "@/src/ContactCallsSection";
import { ContactAppointmentsSection } from "@/src/ContactAppointmentsSection";
import { ContactReferralsSection } from "@/src/ContactReferralsSection";
import { ContactReferencesSection } from "@/src/ContactReferencesSection";
import { useActiveCall } from "@/src/CallTimerBar";
import { CallActionSheet, CallTarget } from "@/src/CallActionSheet";
import { CallScriptOverlay } from "@/src/CallScriptOverlay";
import { launchLibraryUniversal, launchCameraUniversal } from "@/src/utils/imagePickerCompat";
import { ModuleErrorBoundary } from "@/src/shared";
import { DocumentScannerModal } from "@/src/DocumentScannerModal";
import { ContactReferralsTab } from "@/src/ContactReferralsTab";
import { DeadlinesSection } from "@/src/DeadlinesSection";
import { PromoteToAgentModal } from "@/src/PromoteToAgentModal";
import { AxonAnalysesSection } from "@/src/AxonAnalysesSection";
import { AxonProfileCard } from "@/src/AxonProfileCard";
import { ContactInfoRequestsSection } from "@/src/ContactInfoRequestsSection";
import { ContactMailAttachmentsSection } from "@/src/ContactMailAttachmentsSection";
import { IdentityDocsSection } from "@/src/IdentityDocsSection"; // V50.z267
import { ContactCustomFieldsSection } from "@/src/ContactCustomFieldsSection";
import { ContactReviewsSection } from "@/src/ContactReviewsSection";
import { ContactDistanceBadge } from "@/src/ContactDistanceBadge"; // V50.z241 — «📍 X km da te»
import { useDraft } from "@/src/utils/appStatePersist"; // V50.z242 — BUG-STATE-001: bozza nota
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Note = { id: string; kind: "text" | "audio" | "photo" | "video" | "file" | "link"; category?: "general" | "email" | "referral" | null; text?: string; audio_base64?: string; audio_mime?: string; photo_base64?: string; video_base64?: string; video_mime?: string; file_base64?: string; file_name?: string; file_mime?: string; file_size?: number; link_url?: string; link_title?: string; created_at: string; duration_ms?: number };
type CFile = { id: string; name: string; mime: string; size: number; created_at: string; data_base64?: string };
type Contact = {
  contact_id: string; first_name: string; last_name: string; phone: string; email: string; address: string;
  phone_alt?: string; whatsapp?: string; email_alt?: string; telegram?: string;
  // V50.z278 — anagrafica adattiva da biglietto da visita
  company?: string; role?: string; fax?: string;
  phones?: { label: string; number: string; type: string; primary?: boolean }[]; emails?: { label: string; address: string; primary?: boolean }[];
  people?: { name: string; role?: string; phone?: string; email?: string }[]; contact_prefs?: { channels?: string[]; best_time?: string; note?: string };
  _pending?: boolean; // V50.z281 — in attesa di sincronizzazione (offline)
  business_card?: { data_base64: string; back_data_base64?: string; mime?: string; created_at?: string } | null;
  address_street?: string; address_number?: string; address_zip?: string; address_city?: string; address_province?: string;
  work_address?: string; residence_address?: string;
  birth_date?: string; fiscal_code?: string; vat_number?: string; anniversaries?: { name: string; date: string }[];
  website?: string; linkedin?: string; instagram?: string; facebook?: string;
  area: "energy" | "network"; additional_areas?: string[]; area_subcategories?: Record<string, string>; area_categories?: Record<string, { category?: string; subcategory?: string }>; source: string; referral_note: string; email_note: string; general_note: string;
  tags?: string[]; group_ids?: string[]; referred_by_contact_id?: string;
  notes: Note[]; files: CFile[]; avatar_base64?: string;
  assigned_to_user_id?: string;
  contact_code?: string;
  status?: "prospect" | "collaborator" | "client";
  linked_user_id?: string;
  custom_fields?: Record<string, any> | null;
  preferred_address?: "main" | "legacy" | "work" | "residence" | null;
};

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  prospect: { label: "Prospect", color: "#0891B2", icon: "person-outline" },
  collaborator: { label: "Collaboratore", color: "#7C3AED", icon: "people" },
  client: { label: "Cliente", color: "#16A34A", icon: "briefcase" },
};

export default function ContactDetailRoute() {
  return (
    <ModuleErrorBoundary moduleName="contacts">
      <ContactDetail />
    </ModuleErrorBoundary>
  );
}

function ContactDetail() {
  const { id, refs: refsParam, tab: tabParam } = useLocalSearchParams<{ id: string; refs?: string; tab?: string }>();
  const router = useRouter();
  const [c, setC] = useState<Contact | null>(null);
  const [tab, setTab] = useState<"info" | "notes" | "files" | "bills" | "contracts" | "audio" | "calls" | "appts" | "visits" | "refs" | "reviews">("info");
  // V50.z101 — Popup "Vuoi programmare la richiesta recensione?" quando lo status
  // del contatto transita a "client". Compariamo lo stato precedente conservato
  // in una ref, e apriamo la modale review-request se la transizione avviene.
  const prevStatusRef = useRef<string | null>(null);
  const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
  const [reviewsAutoOpen, setReviewsAutoOpen] = useState(false);

  // V27 — Deep-link to Referenze tab via ?refs=1 (used by chain flow after saving an appointment)
  useEffect(() => {
    if (refsParam === "1") setTab("refs");
  }, [refsParam]);
  // V50.z259 — Deep link Navigatore Axon: /contact/{id}?tab=visits|notes|bills|…
  useEffect(() => {
    const ok = ["info", "notes", "files", "bills", "contracts", "audio", "calls", "appts", "visits", "refs", "reviews"];
    if (tabParam && ok.includes(tabParam)) setTab(tabParam as any);
  }, [tabParam]);
  const [noteText, setNoteText] = useState("");
  useDraft(`draft_contact_note_${id}`, noteText, setNoteText); // V50.z242 — la nota in scrittura sopravvive a background/riavvio
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeCategory, setActiveCategory] = useState<null | "general" | "email" | "referral">(null);
  const [groups, setGroups] = useState<Array<{ group_id: string; name: string; color: string }>>([]);
  const [settings, setSettings] = useState<any>(null);
  const [team, setTeam] = useState<Array<{ user_id: string; name: string; role: string }>>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [callScriptOpen, setCallScriptOpen] = useState(false);
  // V50.z335 — Azioni di contatto secondarie (Script, SMS, Invia su WhatsApp, Telegram, social, web) raggruppate in «Altro»
  const [commMoreOpen, setCommMoreOpen] = useState(false);
  // V28.r — Barra timer globale (sostituisce il modal a schermo intero V28.f).
  const activeCall = useActiveCall();
  const [callsRefreshTick, setCallsRefreshTick] = useState(0);
  // V50.z71 — Distanze indirizzi (km) + override origine (per contatto)
  const [distances, setDistances] = useState<Record<string, number | null>>({});
  const [distanceOrigin, setDistanceOrigin] = useState<string>("");
  const [originOverrideOpen, setOriginOverrideOpen] = useState(false);
  const [originDraft, setOriginDraft] = useState<string>("");
  const [distLoading, setDistLoading] = useState(false);

  // V28.r — Quando la barra timer termina la chiamata (active passa a null),
  // refreshiamo la lista comunicazioni per mostrare la durata registrata.
  const prevActiveRef = useRef<boolean>(false);
  useEffect(() => {
    const isActive = !!activeCall.active;
    if (prevActiveRef.current && !isActive) {
      // Transizione: active -> null (chiamata terminata)
      setCallsRefreshTick((t) => t + 1);
    }
    prevActiveRef.current = isActive;
  }, [activeCall.active]);

  // V50.z101 — Rileva transizione status → "client" e mostra popup opzionale
  // "Vuoi programmare la richiesta di recensione?".
  useEffect(() => {
    if (!c?.status) return;
    const prev = prevStatusRef.current;
    if (prev !== null && prev !== "client" && c.status === "client") {
      setReviewPromptOpen(true);
    }
    prevStatusRef.current = c.status;
  }, [c?.status]);

  // V50.z71 — Al primo caricamento delle settings, popola l'origine di default con l'ufficio
  useEffect(() => {
    if (!distanceOrigin && settings?.office_address) {
      setDistanceOrigin(settings.office_address);
    }
  }, [settings?.office_address, distanceOrigin]);

  // V50.z71 — Ricalcola distanze quando cambia origine o gli indirizzi del contatto
  useEffect(() => {
    if (!c || !distanceOrigin) return;
    const items: Array<{ key: string; addr: string }> = [];
    const structAddr = [c.address_street, [c.address_zip, c.address_city].filter(Boolean).join(" "), c.address_province].filter(Boolean).join(", ").trim();
    if (structAddr) items.push({ key: "main", addr: structAddr });
    const legAddr = (c.address || "").trim();
    if (legAddr && legAddr !== structAddr) items.push({ key: "legacy", addr: legAddr });
    if (c.work_address) items.push({ key: "work", addr: c.work_address });
    if (c.residence_address) items.push({ key: "residence", addr: c.residence_address });
    if (items.length === 0) return;
    let cancelled = false;
    (async () => {
      setDistLoading(true);
      try {
        const res = await api<{ origin_valid: boolean; distances_km: (number | null)[] }>("/geocode/distances", {
          method: "POST",
          body: { origin: distanceOrigin, targets: items.map((i) => i.addr) },
        });
        if (cancelled) return;
        const map: Record<string, number | null> = {};
        items.forEach((it, idx) => {
          map[it.key] = res.distances_km?.[idx] ?? null;
        });
        setDistances(map);
      } catch {
        if (!cancelled) setDistances({});
      } finally {
        if (!cancelled) setDistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [c?.contact_id, c?.address, c?.address_street, c?.address_city, c?.address_zip, c?.address_province, c?.work_address, c?.residence_address, distanceOrigin]);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [viewerFile, setViewerFile] = useState<CFile | null>(null);
  // V50.z424 — stato cliente attivo / data attivazione (anche retroattiva), modificabile in ogni momento dalla scheda
  const [activeEdit, setActiveEditState] = useState(false);
  const [activeDraft, setActiveDraft] = useState<{ active: boolean; since: string }>({ active: true, since: "" });
  const setActiveEdit = (open: boolean) => {
    if (open && c) setActiveDraft({ active: !!(c as any).is_active_client, since: (c as any).client_since || new Date().toISOString().slice(0, 10) });
    setActiveEditState(open);
  };
  const saveActive = async () => {
    if (activeDraft.active && !/^\d{4}-\d{2}-\d{2}$/.test(activeDraft.since)) { notify("Data non valida", "Usa il formato AAAA-MM-GG (es. 2025-01-15)"); return; }
    try {
      await api(`/contacts/${id}`, { method: "PUT", body: { is_active_client: activeDraft.active, client_since: activeDraft.active ? activeDraft.since : null, ...(activeDraft.active ? { status: "client" } : {}) } });
      setActiveEditState(false);
      await load();
    } catch (e: any) { notify("Errore", e?.message || "Salvataggio non riuscito"); }
  };
  const [scannerOpen, setScannerOpen] = useState(false);
  const { user } = useAuth();
  const canAssign = user?.role === "owner" || user?.role === "admin";
  // V28.z — Master-only edit del codice cliente
  const isMaster = user?.role === "owner" && !user?.parent_user_id;
  const [contactCodeEdit, setContactCodeEdit] = useState<string>("");
  const [contactCodeSaving, setContactCodeSaving] = useState(false);
  // V29 — Promuovi ad agente modal (solo Master)
  const [promoteOpen, setPromoteOpen] = useState(false);
  useEffect(() => { setContactCodeEdit(c?.contact_code || ""); }, [c?.contact_code]);
  const saveContactCode = async () => {
    const next = contactCodeEdit.trim();
    if (next === (c?.contact_code || "")) return;
    try {
      setContactCodeSaving(true);
      await api(`/contacts/${id}`, { method: "PUT", body: { contact_code: next } });
      setC((prev) => prev ? { ...prev, contact_code: next } : prev);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setContactCodeSaving(false); }
  };

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // V50.z247 — Riproduzione note vocali: player imperativo su FILE in cache (niente `useAudioPlayer(data:…)`: su Android il
  // cambio sorgente base64 di diversi MB + `play()` sul player rilasciato faceva CRASHARE l'app). Un solo player alla volta.
  const [playingNoteId, setPlayingNoteId] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const playerSubRef = useRef<{ remove: () => void } | null>(null);
  const stopPlayback = useCallback(() => {
    try { playerSubRef.current?.remove(); } catch {}
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    playerSubRef.current = null; playerRef.current = null;
    setPlayingNoteId(null);
  }, []);
  useEffect(() => () => { stopPlayback(); }, [stopPlayback]);

  const load = useCallback(async () => {
    setC(await api<Contact>(`/contacts/${id}`));
    try {
      const [gr, st] = await Promise.all([
        api<{ items: any[] }>("/groups"),
        api<any>("/settings"),
      ]);
      setGroups(gr.items || []);
      setSettings(st);
    } catch {}
    if (canAssign) {
      try {
        const t = await api<{ items: { user_id: string; name: string; role: string }[] }>("/team/members");
        setTeam(t.items || []);
      } catch {}
    }
  }, [id, canAssign]);

  const doAssign = async (assignee: string | null) => {
    try {
      await api(`/contacts/${id}/assign`, { method: "PUT", body: { assignee_user_id: assignee } });
      setAssignOpen(false);
      load();
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined") window.alert("Errore: " + (e?.message || ""));
    }
  };

  // V27 — Change contact status (Prospect | Collaboratore | Cliente)
  // V28.c — No longer called from the contact detail (status is now edited via
  // the edit form). Kept as a helper in case future flows need it. eslint-disable
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _setStatus = async (status: "prospect" | "collaborator" | "client") => {
    try {
      await api(`/contacts/${id}`, { method: "PUT", body: { status } });
      load();
    } catch (e: any) {
      if (typeof window !== "undefined") window.alert("Errore: " + (e?.message || ""));
    }
  };

  // V28.c — Auto-log a communication event (phone/sms/whatsapp/email/telegram)
  // Fires the POST /calls/log with the appropriate channel so the "Comunicazioni"
  // timeline stays in sync. Fire-and-forget — never blocks the user's action.
  // V28.f — For phone calls, also captures the log_id so the timer can later
  // PATCH its duration_sec on close.
  const logComm = (channel: "phone" | "sms" | "whatsapp" | "email" | "telegram", phone?: string) => {
    return api<{ log: { log_id: string } }>("/calls/log", {
      method: "POST",
      body: {
        contact_id: id,
        phone: phone || undefined,
        channel,
        outcome_id: channel === "phone" ? "auto_started" : `auto_${channel}`,
        note: "",
        duration_sec: 0,
      },
    })
      .then((res) => {
        setCallsRefreshTick((t) => t + 1);
        return res?.log?.log_id || null;
      })
      .catch(() => null);
  };
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!c) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} /></SafeAreaView>;

  const color = c.area === "energy" ? theme.color.energy : theme.color.network;
  const hasSecondaryComm = !!(c.phone || c.telegram || c.linkedin || c.instagram || c.facebook || c.website || ((c.whatsapp || c.phone) && settings?.wa_referral_template));

  // Helpers per aprire navigazione con Waze e Google Maps su qualsiasi indirizzo (stringa libera)
  const openWazeAddr = (addr: string) => {
    if (!addr) return;
    Linking.openURL(`https://www.waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes`);
  };
  const openGoogleMapsAddr = (addr: string) => {
    if (!addr) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
  };

  // V50.z71 — Toggle "indirizzo preferito" (persistente sul contatto).
  const togglePreferredAddress = async (kind: "main" | "legacy" | "work" | "residence") => {
    if (!c) return;
    const next = c.preferred_address === kind ? null : kind;
    // Optimistic
    setC({ ...c, preferred_address: next });
    try {
      await api(`/contacts/${id}`, { method: "PUT", body: { preferred_address: next } });
    } catch (e: any) {
      // rollback in caso di errore
      setC(c);
      notify("Errore", e?.message || "Impossibile aggiornare l'indirizzo preferito");
    }
  };

  // V50.z70 — Blocco riutilizzabile: mostra una riga indirizzo con i propri bottoni Waze/Maps,
  // + stella preferito (V50.z71) + distanza in km dall'origine configurata (V50.z71).
  const AddressBlock = ({
    icon,
    label,
    addr,
    testIdPrefix,
    kind,
  }: {
    icon: any;
    label: string;
    addr: string;
    testIdPrefix: string;
    kind: "main" | "legacy" | "work" | "residence";
  }) => {
    if (!addr || !addr.trim()) return null;
    const isPreferred = c?.preferred_address === kind;
    const km = distances[kind];
    return (
      <View style={[styles.addrBlock, isPreferred && styles.addrBlockPreferred]}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
          <View style={{ flex: 1 }}>
            <InfoRow icon={icon} label={isPreferred ? `${label} · ⭐ preferito` : label} value={addr} />
          </View>
          <Pressable
            testID={`${testIdPrefix}-star`}
            onPress={() => togglePreferredAddress(kind)}
            hitSlop={8}
            style={styles.starBtn}
            accessibilityLabel={isPreferred ? "Rimuovi preferito" : "Imposta come preferito"}
          >
            <Ionicons
              name={isPreferred ? "star" : "star-outline"}
              size={20}
              color={isPreferred ? "#F59E0B" : HT.muted}
            />
          </Pressable>
        </View>
        <View style={styles.navBtnRow}>
          <Pressable
            testID={`${testIdPrefix}-waze-btn`}
            onPress={() => openWazeAddr(addr)}
            style={styles.wazeInline}
          >
            <Ionicons name="navigate" size={14} color="#FFF" />
            <Text style={styles.wazeInlineTxt}>Waze</Text>
          </Pressable>
          <Pressable
            testID={`${testIdPrefix}-maps-btn`}
            onPress={() => openGoogleMapsAddr(addr)}
            style={[styles.wazeInline, { backgroundColor: '#4285F4' }]}
          >
            <Ionicons name="map" size={14} color="#FFF" />
            <Text style={styles.wazeInlineTxt}>Google Maps</Text>
          </Pressable>
          {distanceOrigin ? (
            <View style={styles.kmBadge}>
              <Ionicons name="speedometer-outline" size={13} color={HT.axon} />
              <Text style={styles.kmBadgeTxt}>
                {distLoading && km === undefined
                  ? "…"
                  : km === null
                  ? "posizione non trovata"
                  : km !== undefined
                  ? `≈ ${km.toFixed(1)} km`
                  : "…"}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  // V50.z70 — Costruisco la lista completa degli indirizzi da mostrare, evitando duplicati.
  const structuredAddr = [c.address_street, [c.address_zip, c.address_city].filter(Boolean).join(" "), c.address_province]
    .filter(Boolean)
    .join(", ")
    .trim();
  const legacyAddr = (c.address || "").trim();
  // Mostro `address` (legacy) solo se non è già uguale a quello strutturato (evita duplicati per utenti migrati)
  const showLegacyAddr = legacyAddr && legacyAddr !== structuredAddr;

  // V50.z71 — Ordino i blocchi: preferito in cima, poi gli altri nell'ordine naturale.
  type AddrKind = "main" | "legacy" | "work" | "residence";
  const addressBlocks: Array<{ kind: AddrKind; addr: string; icon: any; label: string; testIdPrefix: string } | null> = [
    structuredAddr ? { kind: "main" as AddrKind, addr: structuredAddr, icon: "location-outline", label: "Indirizzo", testIdPrefix: "address" } : null,
    showLegacyAddr ? { kind: "legacy" as AddrKind, addr: legacyAddr, icon: "location-outline", label: structuredAddr ? "Indirizzo alternativo" : "Indirizzo", testIdPrefix: structuredAddr ? "address-legacy" : "address" } : null,
    c.work_address ? { kind: "work" as AddrKind, addr: c.work_address, icon: "briefcase-outline", label: "Indirizzo di lavoro", testIdPrefix: "work-address" } : null,
    c.residence_address ? { kind: "residence" as AddrKind, addr: c.residence_address, icon: "home-outline", label: "Indirizzo di residenza", testIdPrefix: "residence-address" } : null,
  ];
  const orderedBlocks = addressBlocks
    .filter((b): b is NonNullable<typeof addressBlocks[number]> => !!b)
    .sort((a, b) => {
      const aPref = c.preferred_address === a.kind;
      const bPref = c.preferred_address === b.kind;
      if (aPref && !bPref) return -1;
      if (!aPref && bPref) return 1;
      return 0;
    });

  const addTextNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "text", text: noteText, category: activeCategory } });
      setNoteText(""); await load();
    } finally { setBusy(false); }
  };

  const startRecording = async () => {
    if (Platform.OS === "web") { alert("Registrazione audio non disponibile su web preview"); return; }
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  const stopRecording = async () => {
    setRecording(false);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      await api(`/contacts/${id}/notes`, {
        method: "POST",
        body: { kind: "audio", audio_base64: b64, audio_mime: "audio/m4a", category: activeCategory },
      });
      await load();
    } catch (e) { console.warn(e); }
    finally { setBusy(false); }
  };

  const playNote = async (n: Note) => {
    if (!n.audio_base64) return;
    if (playingNoteId === n.id) { stopPlayback(); return; }
    stopPlayback();
    const mime = n.audio_mime || "audio/m4a";
    try {
      let uri: string;
      if (Platform.OS === "web") {
        uri = `data:${mime};base64,${n.audio_base64}`;
      } else {
        const ext = mime.includes("mp3") || mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : "m4a";
        uri = `${FileSystem.cacheDirectory}voice_note_${n.id}.${ext}`;
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) await FileSystem.writeAsStringAsync(uri, n.audio_base64, { encoding: FileSystem.EncodingType.Base64 });
      }
      const player = createAudioPlayer({ uri }, { updateInterval: 300 });
      playerRef.current = player;
      playerSubRef.current = player.addListener("playbackStatusUpdate", (st: any) => { if (st?.didJustFinish) stopPlayback(); });
      setPlayingNoteId(n.id);
      player.play();
    } catch (e: any) {
      stopPlayback();
      notify("Riproduzione non riuscita", e?.message || "Impossibile riprodurre la nota vocale.");
    }
  };

  const deleteNote = async (nid: string) => {
    await api(`/contacts/${id}/notes/${nid}`, { method: "DELETE" });
    load();
  };

  const addPhotoNote = async (fromCamera: boolean) => {
    const res = fromCamera
      ? await launchCameraUniversal({ quality: 0.5, base64: Platform.OS === "web" })
      : await launchLibraryUniversal({ mediaTypes: "images", quality: 0.5, base64: Platform.OS === "web" });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let uri: string;
    if (a.uri && a.uri.startsWith("data:")) {
      uri = a.uri;
    } else {
      let b64 = a.base64;
      if (!b64) {
        try { b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }); } catch { return; }
      }
      uri = `data:${a.mimeType || "image/jpeg"};base64,${b64}`;
    }
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "photo", photo_base64: uri, category: activeCategory } });
      await load();
    } finally { setBusy(false); }
  };

  const addVideoNote = async (fromCamera: boolean) => {
    const res = fromCamera
      ? await launchCameraUniversal({ mediaTypes: "videos", quality: 0.5, base64: Platform.OS === "web" })
      : await launchLibraryUniversal({ mediaTypes: "videos", quality: 0.5, base64: Platform.OS === "web" });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let b64 = a.base64;
    if (a.uri && a.uri.startsWith("data:")) {
      const commaIdx = a.uri.indexOf(",");
      b64 = commaIdx >= 0 ? a.uri.slice(commaIdx + 1) : "";
    } else if (!b64) {
      try { b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }); } catch { return; }
    }
    // Sanity check size to avoid huge payloads (limit ~15MB base64)
    if (b64 && b64.length > 20 * 1024 * 1024) {
      alert("Video troppo grande (max ~15MB). Registra un clip più breve o riduci la qualità.");
      return;
    }
    const mime = a.mimeType || "video/mp4";
    const uri = `data:${mime};base64,${b64}`;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "video", video_base64: uri, video_mime: mime, category: activeCategory } });
      await load();
    } finally { setBusy(false); }
  };

  const addLinkNote = async () => {
    if (!linkUrl.trim()) return;
    setBusy(true);
    try {
      await api(`/contacts/${id}/notes`, { method: "POST", body: { kind: "link", link_url: linkUrl, link_title: noteText, category: activeCategory } });
      setLinkUrl(""); setNoteText(""); setShowLinkInput(false);
      await load();
    } finally { setBusy(false); }
  };

  const pickFile = async () => {
    // v2.20 — accept all common formats (PDF/images/docs/sheets/JSON) + validation
    const { asset, error } = await pickCommonFile();
    if (error) { notify("Formato non supportato", error); return; }
    if (!asset) return;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await api(`/contacts/${id}/files`, {
        method: "POST",
        body: { name: asset.name, mime: asset.mimeType || "application/octet-stream", data_base64: b64, size: asset.size || 0 },
      });
      await load();
    } finally { setBusy(false); }
  };

  const addFileNote = async () => {
    // v2.20 — same common-formats validator on note attachments
    const { asset, error } = await pickCommonFile();
    if (error) { notify("Formato non supportato", error); return; }
    if (!asset) return;
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      if (b64.length > 20 * 1024 * 1024) {
        alert("File troppo grande (max ~15MB).");
        return;
      }
      await api(`/contacts/${id}/notes`, {
        method: "POST",
        body: {
          kind: "file",
          file_base64: b64,
          file_name: asset.name,
          file_mime: asset.mimeType || "application/octet-stream",
          file_size: asset.size || 0,
          category: activeCategory,
        },
      });
      await load();
    } finally { setBusy(false); }
  };

  const deleteFile = async (fid: string) => {
    await api(`/contacts/${id}/files/${fid}`, { method: "DELETE" });
    load();
  };

  const shareContact = async () => {
    if (!c) return;
    const lines = [
      `${c.first_name} ${c.last_name}`.trim(),
      c.phone ? `📞 ${c.phone}` : "",
      c.phone_alt ? `📞 ${c.phone_alt}` : "",
      c.whatsapp ? `💬 WhatsApp: ${c.whatsapp}` : "",
      c.email ? `✉️ ${c.email}` : "",
      c.email_alt ? `✉️ ${c.email_alt}` : "",
      c.telegram ? `Telegram: ${c.telegram}` : "",
      c.address ? `📍 ${c.address}` : "",
      c.website ? `🌐 ${c.website}` : "",
      c.general_note ? `\n${c.general_note}` : "",
    ].filter(Boolean).join("\n");
    await shareText(lines, `Scheda ${c.first_name} ${c.last_name}`);
  };

  const shareFile = (f: CFile) => {
    if (!f.data_base64) return;
    setShareTarget({
      id: f.id,
      name: f.name,
      mime: f.mime,
      data_base64: f.data_base64,
      contactId: id,
    });
  };

  const shareNote = async (n: Note) => {
    try {
      if (n.kind === "text") await shareText(n.text || "");
      else if (n.kind === "link") await shareText(`${n.link_title || ""}\n${n.link_url || ""}`.trim());
      else if (n.kind === "audio" && n.audio_base64) await shareDataUri(`data:${n.audio_mime || "audio/m4a"};base64,${n.audio_base64}`, `vocale-${n.id}.m4a`, n.audio_mime || "audio/m4a");
      else if (n.kind === "photo" && n.photo_base64) await shareDataUri(n.photo_base64, `foto-${n.id}.jpg`, "image/jpeg");
      else if (n.kind === "video" && n.video_base64) await shareDataUri(n.video_base64, `video-${n.id}.mp4`, n.video_mime || "video/mp4");
      else if (n.kind === "file" && n.file_base64) await shareDataUri(`data:${n.file_mime};base64,${n.file_base64}`, n.file_name || `file-${n.id}`, n.file_mime || "application/octet-stream");
    } catch (e) { console.warn(e); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* V50.z335 — Header dark premium: gradiente navy con accento del colore dell'area/gruppo (niente più rosso piatto) */}
      <View style={styles.heroCompact} testID="contact-hero">
        <LinearGradient
          colors={[color + "66", color + "14", "rgba(11,22,38,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <View style={[styles.heroAccentLine, { backgroundColor: color }]} pointerEvents="none" />
        <View style={styles.heroTopRow}>
          <Pressable
            testID="back-btn"
            onPress={() => {
              try {
                if (router.canGoBack && router.canGoBack()) router.back();
                else router.replace("/(tabs)/contatti");
              } catch {
                router.replace("/(tabs)/contatti");
              }
            }}
            hitSlop={12}
            style={{ padding: 4 }}
          >
            <Ionicons name="chevron-back" size={24} color={HT.text} />
          </Pressable>
          <Pressable
            testID="contact-avatar-btn"
            onPress={async () => {
              const b64 = await pickAvatarBase64();
              if (b64) { await api(`/contacts/${id}`, { method: "PUT", body: { avatar_base64: b64 } }); await load(); }
            }}
            style={styles.avatarWrapCompact}
          >
            {c.avatar_base64 ? (
              <Image source={{ uri: c.avatar_base64 }} style={styles.avatarImgCompact} />
            ) : c.website ? (
              // V38U — Auto-load favicon via Google Favicon API when a website
              // is present and no explicit avatar has been set yet.
              <Image
                source={{ uri: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.website.replace(/^https?:\/\//, "").split("/")[0])}&sz=128` }}
                style={styles.avatarImgCompact}
              />
            ) : (
              <View style={[styles.avatarCompact, { backgroundColor: color + "33", borderColor: color }]}>
                <Text style={[styles.avatarTxtCompact, { color: "#FFF" }]}>{c.first_name[0]?.toUpperCase()}{c.last_name[0]?.toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.avatarBadgeCompact}>
              <Ionicons name="camera" size={9} color="#FFF" />
            </View>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.nameCompact} numberOfLines={1} ellipsizeMode="tail">
              {c.first_name} {c.last_name}{c.contact_code ? ` · ${c.contact_code}` : ""}
            </Text>
            <PendingBadge pending={c._pending} />
            <Text style={styles.areaTagCompact} numberOfLines={1}>
              {c.area === "energy" ? "Consulente Energetico" : "Networker"} · {c.source === "referral" ? "Referenza" : "Conoscenza"}
            </Text>
          </View>
          <Pressable testID="share-contact" onPress={shareContact} hitSlop={8} style={{ padding: 6 }}>
            <Ionicons name="share-social-outline" size={20} color={HT.text} />
          </Pressable>
          <Pressable testID="edit-contact" onPress={() => router.push(`/contact/edit/${id}`)} hitSlop={8} style={{ padding: 6 }}>
            <Ionicons name="create-outline" size={20} color={HT.text} />
          </Pressable>
        </View>

        {canAssign && !(c.assigned_to_user_id && c.assigned_to_user_id === user?.user_id) && (
          <Pressable testID="assign-btn" onPress={() => setAssignOpen(!assignOpen)} style={styles.assignPill}>
            <Ionicons name="person" size={11} color={HT.brand} />
            <Text style={styles.assignPillTxt}>
              {c.assigned_to_user_id
                ? "Assegnato: " + (team.find((m) => m.user_id === c.assigned_to_user_id)?.name || c.assigned_to_user_id.slice(0, 8))
                : "Non assegnato — tocca per assegnare"}
            </Text>
            <Ionicons name={assignOpen ? "chevron-up" : "chevron-down"} size={11} color={HT.brand} />
          </Pressable>
        )}
        {canAssign && !(c.assigned_to_user_id && c.assigned_to_user_id === user?.user_id) && assignOpen && (
          <View style={{ marginTop: 6, backgroundColor: HT.card, borderRadius: 10, borderWidth: 1, borderColor: HT.border, padding: 6 }}>
            <Pressable testID="assign-none" onPress={() => doAssign(null)} style={{ padding: 8 }}>
              <Text style={{ color: HT.muted, fontStyle: "italic" }}>— Nessuno (orfano) —</Text>
            </Pressable>
            {team.map((m) => (
              <Pressable
                key={m.user_id}
                testID={`assign-to-${m.user_id}`}
                onPress={() => doAssign(m.user_id)}
                style={{ padding: 8, borderTopWidth: 1, borderTopColor: HT.border }}
              >
                <Text style={{ color: HT.text, fontWeight: c.assigned_to_user_id === m.user_id ? "800" : "500" }}>
                  {c.assigned_to_user_id === m.user_id ? "✓ " : ""}{m.name}{m.role === "admin" ? " ★" : m.role === "owner" ? " 👑" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* V28.c — Status shown as a read-only label (editable only from the edit form) */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {c.status ? (
          (() => {
            const meta = STATUS_META[c.status] || STATUS_META.prospect;
            return (
              <View style={[styles.statusLabel, { backgroundColor: meta.color + "22", borderColor: meta.color + "66" }]} testID="contact-status-label">
                <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
                <Ionicons name={meta.icon} size={12} color={meta.color} />
                <Text style={[styles.statusLabelTxt, { color: meta.color }]}>{meta.label}</Text>
              </View>
            );
          })()
        ) : null}
        {/* V50.z241 — distanza dal cliente (GPS o ufficio) */}
        <ContactDistanceBadge contactId={id} hasAddress={!!(c.address_street || c.address_city || c.address || c.work_address || c.residence_address)} />
        </View>
      </View>

      {/* V50.z335 — Tab bar: icone più grandi con etichetta, scorrevole, stile dark */}
      <View style={styles.tabsWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} testID="contact-tabs">
        {(["info", "notes", "files", "bills", "contracts", "audio", "calls", "appts", "visits", "refs", "reviews"] as const).map((t) => {
          const iconName: any = t === "info" ? "person"
            : t === "notes" ? "create"
            : t === "files" ? "folder"
            : t === "bills" ? "flash"
            : t === "contracts" ? "document-text"
            : t === "audio" ? "mic"
            : t === "calls" ? "chatbubbles"
            : t === "refs" ? "share-social"
            : t === "reviews" ? "star"
            : t === "visits" ? "location"
            : "calendar";
          const label = t === "info" ? "Info" : t === "notes" ? "Note" : t === "files" ? "File" : t === "bills" ? "Fatture" : t === "contracts" ? "Contratti" : t === "audio" ? "Audio" : t === "calls" ? "Comunic." : t === "refs" ? "Referenze" : t === "reviews" ? "Recensioni" : t === "visits" ? "Visite" : "Appuntam.";
          const active = tab === t;
          const activeColor = t === "bills" ? HT.brand : t === "reviews" ? HT.warning : t === "visits" ? HT.axon : HT.brand;
          const iconColor = active ? activeColor : HT.muted;
          return (
            <Pressable
              key={t}
              testID={`tab-${t}`}
              onPress={() => setTab(t)}
              accessibilityLabel={label}
              style={[styles.tabIcon, active && { backgroundColor: activeColor + "1F", borderColor: activeColor + "66" }]}
            >
              <Ionicons name={iconName} size={22} color={iconColor} />
              <Text style={[styles.tabLbl, active && { color: activeColor }]} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      </View>

      {tab === "bills" ? (
        // V50.g — `flex: 1` necessario altrimenti la BillsSection (che al
        // suo interno usa `<View flex:1><ScrollView>...`) collassa ad altezza
        // 0 e mostra solo la DeadlinesSection. Regressione segnalata
        // dall'utente: "sull'anagrafica è scomparsa l'icona analisi fatture".
        <View style={{ flex: 1 }}>
          <DeadlinesSection contactId={id} />
          <BillsSection
            contactId={id}
            contactName={`${c.first_name} ${c.last_name}`.trim()}
            onContactFilesChanged={load}
          />
        </View>
      ) : tab === "contracts" ? (
        <ContactContractsSection contactId={id} />
      ) : tab === "audio" ? (
        <ContactAudioSection contactId={id} />
      ) : tab === "calls" ? (
        <ContactCallsSection
          contactId={id}
          contactName={`${c.first_name} ${c.last_name}`.trim()}
          contactPhone={c.phone}
          refreshTick={callsRefreshTick}
          onCallStarted={() => {
            // V28.e — direct call: log + tel: link, no intermediate modal
            if (c.phone) {
              logComm("phone", c.phone);
              const num = c.phone.replace(/\s/g, "");
              Linking.openURL(`tel:${num}`).catch(() => {});
            }
          }}
        />
      ) : tab === "appts" ? (
        <ContactAppointmentsSection contactId={id} />
      ) : tab === "visits" ? (
        <ContactVisitsSection contactId={id} initialEvery={(c as any)?.revisit_every_days} />
      ) : tab === "refs" ? (
        <ContactReferralsTab
          contactId={id}
          contactName={`${c.first_name} ${c.last_name}`.trim()}
          contactPhone={c.phone}
        />
      ) : tab === "reviews" ? (
        <ContactReviewsSection
          contactId={id}
          contactName={`${c.first_name} ${c.last_name}`.trim()}
          contactPhone={c.phone}
          contactWhatsapp={c.whatsapp}
          contactEmail={c.email}
          contactTelegram={c.telegram}
          autoOpenNew={reviewsAutoOpen}
          onAutoOpenHandled={() => setReviewsAutoOpen(false)}
        />
      ) : (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {tab === "info" && (
          <>
            {(() => {
              const areaMap: Record<string, { name: string; color: string }> = {
                energy: { name: settings?.energy_title || "Consulente Energetico", color: settings?.energy_color || theme.color.energy },
                network: { name: settings?.network_title || "Networker", color: settings?.network_color || theme.color.network },
              };
              (settings?.custom_areas || []).forEach((a: any) => { areaMap[a.id] = { name: a.name, color: a.color }; });
              const contactAreas: string[] = [c.area, ...(c.additional_areas || [])].filter(Boolean);
              const contactGroupObjs = (c.group_ids || []).map((gid) => groups.find((g) => g.group_id === gid)).filter(Boolean) as Array<{ group_id: string; name: string; color: string }>;
              if (contactAreas.length === 0 && contactGroupObjs.length === 0) return null;
              return (
                <View style={styles.compactCard}>
                  <View style={styles.compactRow}>
                    {contactAreas.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginRight: 10, flexShrink: 1 }}>
                        <Text style={styles.compactRowLabel}>Aree</Text>
                        {contactAreas.map((aid, i) => {
                          const info = areaMap[aid] || { name: aid, color: HT.muted };
                          return (
                            <View key={`a-${aid}`} style={[styles.areaBadgeMini, { backgroundColor: info.color, maxWidth: "100%" }]}>
                              {i === 0 && <Ionicons name="star" size={9} color="#FFF" />}
                              <Text style={styles.areaBadgeMiniTxt} numberOfLines={1}>
                                {info.name}
                                {c.area_categories?.[aid]?.category ? ` › ${c.area_categories[aid].category}` : ""}
                                {c.area_categories?.[aid]?.subcategory ? ` › ${c.area_categories[aid].subcategory}` : (!c.area_categories?.[aid]?.category && c.area_subcategories?.[aid] ? ` › ${c.area_subcategories[aid]}` : "")}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    {contactGroupObjs.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, flexShrink: 1 }}>
                        <Text style={styles.compactRowLabel}>Gruppi</Text>
                        {contactGroupObjs.map((g) => (
                          <Pressable key={g.group_id} onPress={() => router.push(`/groups/${g.group_id}`)} style={[styles.groupBadgeMini, { borderColor: g.color, maxWidth: "100%" }]}>
                            <View style={[styles.groupBadgeMiniDot, { backgroundColor: g.color }]} />
                            <Text style={[styles.groupBadgeMiniTxt, { color: g.color }]} numberOfLines={1}>{g.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              );
            })()}

            <ContactReferralsSection
              contactId={id}
              contactName={`${c.first_name} ${c.last_name}`.trim()}
            />

            {/* V29.av — Codice Cliente card RIMOSSA da qui: spostata in fondo
                alla pagina come riga compatta (elemento secondario). Vedi
                blocco `codeCompactRow` sotto la sezione "Comunica con". */}

            {/* V28.q — Bidirectional peer references */}
            <ContactReferencesSection
              contactId={id}
              contactName={`${c.first_name} ${c.last_name}`.trim()}
            />

            {/* V29.i — Profilo Axon e V29.g — Analisi Axon sono spostati in fondo (v2.ao) */}

            <View style={styles.card}>
              <Text style={styles.commSectionTitle}>Comunica con {c.first_name}</Text>
              {/* V50.z335 — Azioni principali grandi (Chiama · WhatsApp · Email) */}
              <View style={styles.commPrimaryRow}>
                {c.phone ? (
                  <Pressable
                    testID="comm-call"
                    onPress={async () => {
                      const num = (c.phone || "").replace(/\s/g, "");
                      // V28.r — Avvia SUBITO la barra timer globale (visibile in ogni schermata),
                      // POI parte il POST per il log e infine il dialer OS. Quando il POST torna
                      // colleghiamo il log_id così "Termina" può PATCH-are la durata.
                      activeCall.startCall({
                        contactName: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
                        contactPhone: c.phone,
                      });
                      const logIdPromise = logComm("phone", c.phone);
                      Linking.openURL(`tel:${num}`).catch(() => {});
                      const logId = await logIdPromise;
                      activeCall.setLogId(logId);
                    }}
                    style={[styles.commBtnPrimary, { backgroundColor: '#0F766E' }]}
                  >
                    <Ionicons name="call" size={22} color="#FFF" /><Text style={styles.commBtnPrimaryTxt}>Chiama</Text>
                  </Pressable>
                ) : null}
                {(c.whatsapp || c.phone) ? (
                  <Pressable testID="comm-whatsapp" onPress={() => {
                    const raw = (c.whatsapp || c.phone) || "";
                    const num = raw.replace(/[^\d+]/g, "");
                    logComm("whatsapp", raw);
                    Linking.openURL(`https://wa.me/${num}`);
                  }} style={[styles.commBtnPrimary, { backgroundColor: '#25D366' }]}>
                    <Ionicons name="logo-whatsapp" size={22} color="#FFF" /><Text style={styles.commBtnPrimaryTxt}>WhatsApp</Text>
                  </Pressable>
                ) : null}
                {c.email ? (
                  <Pressable testID="comm-email" onPress={() => { logComm("email"); Linking.openURL(`mailto:${c.email}`); }} style={[styles.commBtnPrimary, { backgroundColor: '#2563EB' }]}>
                    <Ionicons name="mail" size={22} color="#FFF" /><Text style={styles.commBtnPrimaryTxt}>Email</Text>
                  </Pressable>
                ) : null}
              </View>
              {/* Azioni secondarie raggruppate in «Altro» */}
              {hasSecondaryComm ? (
                <Pressable testID="comm-more-toggle" onPress={() => setCommMoreOpen((v) => !v)} style={styles.commMoreBtn}>
                  <Ionicons name="ellipsis-horizontal-circle-outline" size={16} color={HT.text2} />
                  <Text style={styles.commMoreTxt}>{commMoreOpen ? "Meno" : "Altro"}</Text>
                  <Ionicons name={commMoreOpen ? "chevron-up" : "chevron-down"} size={14} color={HT.text2} />
                </Pressable>
              ) : null}
              {commMoreOpen ? (
              <View style={styles.commGrid} testID="comm-secondary">
                {c.phone ? (
                  <Pressable
                    testID="comm-script"
                    onPress={() => setCallScriptOpen(true)}
                    style={[styles.commBtnSecondary, { borderColor: HT.borderStrong }]}
                  >
                    <Ionicons name="document-text" size={16} color={HT.text2} /><Text style={[styles.commBtnSecondaryTxt, { color: HT.text2 }]}>Script</Text>
                  </Pressable>
                ) : null}
                {c.phone ? (
                  <Pressable testID="comm-sms" onPress={() => { logComm("sms", c.phone); Linking.openURL(`sms:${c.phone.replace(/\s/g, "")}`); }} style={[styles.commBtnSecondary, { borderColor: theme.color.brandSecondary + "66" }]}>
                    <Ionicons name="chatbubble-ellipses" size={16} color={theme.color.brandSecondary} /><Text style={[styles.commBtnSecondaryTxt, { color: theme.color.brandSecondary }]}>SMS</Text>
                  </Pressable>
                ) : null}
                {/* V29.aq — Bottone "Invia su WhatsApp": apre WhatsApp con numero
                    cliente precompilato e testo dello script (wa_referral_template
                    configurato dal Master in Impostazioni) già inserito nel campo
                    messaggio. Placeholder {name} sostituito col nome del cliente. */}
                {(c.whatsapp || c.phone) && (settings?.wa_referral_template) ? (
                  <Pressable testID="comm-whatsapp-script" onPress={() => {
                    const raw = (c.whatsapp || c.phone) || "";
                    const num = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
                    const firstName = (c.first_name || (c.name || "").split(" ")[0] || "").trim();
                    const tpl = String(settings?.wa_referral_template || "").replace(/\{name\}/g, firstName);
                    const url = `https://wa.me/${num}?text=${encodeURIComponent(tpl)}`;
                    logComm("whatsapp", raw);
                    if (Platform.OS === "web") {
                      try { window.open(url, "_blank"); } catch { /* ignore */ }
                    } else {
                      Linking.openURL(url).catch(() => {});
                    }
                  }} style={[styles.commBtnSecondary, { borderColor: '#128C7E' + "66" }]}>
                    <Ionicons name="send" size={16} color={"#128C7E"} /><Text style={[styles.commBtnSecondaryTxt, { color: "#128C7E" }]}>Invia su WhatsApp</Text>
                  </Pressable>
                ) : null}
                {c.telegram ? (
                  <Pressable testID="comm-telegram" onPress={() => { logComm("telegram"); openTelegram(c.telegram || ""); }} style={[styles.commBtnSecondary, { borderColor: '#0088CC' + "66" }]}>
                    <Ionicons name="paper-plane" size={16} color={"#0088CC"} /><Text style={[styles.commBtnSecondaryTxt, { color: "#0088CC" }]}>Telegram</Text>
                  </Pressable>
                ) : null}
                {c.linkedin ? (
                  <Pressable testID="comm-linkedin" onPress={() => Linking.openURL(c.linkedin!.startsWith("http") ? c.linkedin! : `https://linkedin.com/${c.linkedin!.replace(/^\//, "")}`)} style={[styles.commBtnSecondary, { borderColor: '#0A66C2' + "66" }]}>
                    <Ionicons name="logo-linkedin" size={16} color={"#0A66C2"} /><Text style={[styles.commBtnSecondaryTxt, { color: "#0A66C2" }]}>LinkedIn</Text>
                  </Pressable>
                ) : null}
                {c.instagram ? (
                  <Pressable testID="comm-instagram" onPress={() => {
                    const u = c.instagram!.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
                    Linking.openURL(`https://instagram.com/${u}`);
                  }} style={[styles.commBtnSecondary, { borderColor: '#E4405F' + "66" }]}>
                    <Ionicons name="logo-instagram" size={16} color={"#E4405F"} /><Text style={[styles.commBtnSecondaryTxt, { color: "#E4405F" }]}>Instagram</Text>
                  </Pressable>
                ) : null}
                {c.facebook ? (
                  <Pressable testID="comm-facebook" onPress={() => Linking.openURL(c.facebook!.startsWith("http") ? c.facebook! : `https://facebook.com/${c.facebook!}`)} style={[styles.commBtnSecondary, { borderColor: '#1877F2' + "66" }]}>
                    <Ionicons name="logo-facebook" size={16} color={"#1877F2"} /><Text style={[styles.commBtnSecondaryTxt, { color: "#1877F2" }]}>Facebook</Text>
                  </Pressable>
                ) : null}
                {c.website ? (
                  <Pressable
                    testID="comm-web"
                    onPress={() => {
                      const u = c.website!.trim();
                      const full = u.startsWith("http://") || u.startsWith("https://") ? u : `https://${u}`;
                      Linking.openURL(full);
                    }}
                    style={[styles.commBtnSecondary, { borderColor: '#0EA5E9' + "66" }]}
                  >
                    <Ionicons name="globe" size={16} color={"#0EA5E9"} /><Text style={[styles.commBtnSecondaryTxt, { color: "#0EA5E9" }]}>Web</Text>
                  </Pressable>
                ) : null}
              </View>
              ) : null}
            </View>

            <View style={styles.card}>
            {c.tags && c.tags.length > 0 && (
              <View style={styles.tagsWrap}>
                {c.tags.map((t) => (
                  <View key={t} style={styles.tagChip}><Text style={styles.tagChipTxt}>{t}</Text></View>
                ))}
              </View>
            )}
            {c.company ? <InfoRow icon="business-outline" label="Azienda" value={c.company} /> : null}
            {/* V50.z424 — dati societari (import da cartella / scheda azienda) + stato cliente attivo con data attivazione */}
            {(c as any).legal_form ? <InfoRow icon="ribbon-outline" label="Forma giuridica" value={(c as any).legal_form} /> : null}
            {c.vat_number ? <InfoRow icon="card-outline" label="Partita IVA" value={c.vat_number} /> : null}
            {(c as any).pec ? <InfoRow icon="mail-unread-outline" label="PEC" value={(c as any).pec} href={`mailto:${(c as any).pec}`} /> : null}
            {(c as any).sdi_code ? <InfoRow icon="barcode-outline" label="Codice SDI" value={(c as any).sdi_code} /> : null}
            {(c as any).bank_name || (c as any).iban ? <InfoRow icon="cash-outline" label="Banca / IBAN" value={[(c as any).bank_name, (c as any).iban].filter(Boolean).join(" · ")} /> : null}
            {c.status === "client" || (c as any).is_active_client ? (
              <Pressable testID="contact-active-row" onPress={() => setActiveEdit(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
                <Ionicons name={(c as any).is_active_client ? "checkmark-circle" : "pause-circle-outline"} size={20} color={(c as any).is_active_client ? HT.success : HT.muted} />
                <Text style={{ color: HT.text, fontWeight: "700", fontSize: 13, flex: 1 }}>
                  {(c as any).is_active_client ? `Cliente attivo${(c as any).client_since ? ` dal ${String((c as any).client_since).split("-").reverse().join("/")}` : ""}` : "Cliente disattivato"}
                </Text>
                <Text style={{ color: HT.violet, fontWeight: "800", fontSize: 12 }}>Modifica</Text>
              </Pressable>
            ) : null}
            {activeEdit ? (
              <View style={{ gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 }} testID="contact-active-editor">
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: HT.text2, fontWeight: "700", fontSize: 13 }}>Cliente attivo</Text>
                  <Pressable testID="contact-active-toggle" onPress={() => setActiveDraft((d) => ({ ...d, active: !d.active }))} hitSlop={8}>
                    <Ionicons name={activeDraft.active ? "toggle" : "toggle-outline"} size={36} color={activeDraft.active ? HT.success : HT.muted} />
                  </Pressable>
                </View>
                {activeDraft.active ? (
                  <TextInput testID="contact-active-since" value={activeDraft.since} onChangeText={(v) => setActiveDraft((d) => ({ ...d, since: v }))} placeholder="Attivo dal (AAAA-MM-GG, anche retroattiva)" placeholderTextColor={HT.muted}
                    style={{ borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: HT.text, minHeight: 44 }} />
                ) : null}
                <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end" }}>
                  <Pressable onPress={() => setActiveEdit(false)} style={{ paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: HT.muted, fontWeight: "700" }}>Annulla</Text></Pressable>
                  <Pressable testID="contact-active-save" onPress={saveActive} style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: HT.violet, borderRadius: 10 }}><Text style={{ color: "#fff", fontWeight: "800" }}>Salva</Text></Pressable>
                </View>
              </View>
            ) : null}
            {c.role ? <InfoRow icon="briefcase-outline" label="Ruolo" value={c.role} /> : null}
            {(c.phones || []).length ? (c.phones || []).map((p, i) => (
              <InfoRow key={`ph-${i}`} icon={p.type === "fax" ? "print-outline" : p.type === "landline" ? "call-outline" : "phone-portrait-outline"} label={`${p.primary ? "★ " : ""}${p.label || "Telefono"}${p.type === "fax" ? " (fax)" : p.type === "landline" ? " (fisso)" : ""}`} value={p.number} href={p.type === "fax" ? undefined : `tel:${p.number.replace(/[^\d+]/g, "")}`} />
            )) : (<>
              <InfoRow icon="call-outline" label="Telefono principale" value={c.phone || "—"} />
              {c.phone_alt ? <InfoRow icon="call-outline" label="Telefono 2°" value={c.phone_alt} /> : null}
              {c.fax ? <InfoRow icon="print-outline" label="Fax" value={c.fax} /> : null}
            </>)}
            {c.whatsapp ? <InfoRow icon="logo-whatsapp" label="WhatsApp" value={c.whatsapp} /> : null}
            {(c.emails || []).length ? (c.emails || []).map((e, i) => (
              <InfoRow key={`em-${i}`} icon="mail-outline" label={`${e.primary ? "★ " : ""}${e.label || "Email"}`} value={e.address} href={`mailto:${e.address}`} />
            )) : (<>
              <InfoRow icon="mail-outline" label="Email principale" value={c.email || "—"} />
              {c.email_alt ? <InfoRow icon="mail-outline" label="Email 2°" value={c.email_alt} /> : null}
            </>)}
            {(c.contact_prefs?.channels || []).length || c.contact_prefs?.best_time ? (
              <InfoRow icon="chatbubbles-outline" label="Preferenze di contatto" value={[(c.contact_prefs?.channels || []).map((ch) => ({ call: "Telefonata", whatsapp: "WhatsApp", email: "Email", sms: "SMS" } as Record<string, string>)[ch] || ch).join(", "), c.contact_prefs?.best_time].filter(Boolean).join(" · ")} />
            ) : null}
            {(c.people || []).map((p, i) => (
              <InfoRow key={`pp-${i}`} icon="people-outline" label={`Referente: ${p.name}${p.role ? ` (${p.role})` : ""}`} value={[p.phone, p.email].filter(Boolean).join(" · ") || "—"} href={p.phone ? `tel:${p.phone.replace(/[^\d+]/g, "")}` : undefined} />
            ))}
            {c.business_card?.data_base64 ? (
              <View style={{ marginTop: 6, gap: 6 }} testID="contact-business-card">
                <Text style={styles.infoLabel}>Biglietto da visita</Text>
                <Pressable onPress={() => setViewerFile({ id: "business_card", name: `Biglietto ${c.first_name} ${c.last_name}.jpg`, mime: c.business_card!.mime || "image/jpeg", size: 0, created_at: c.business_card!.created_at || "", data_base64: c.business_card!.data_base64 })} testID="contact-business-card-open">
                  <Image source={{ uri: `data:${c.business_card.mime || "image/jpeg"};base64,${c.business_card.data_base64}` }} style={{ width: "100%", height: 160, borderRadius: 12, backgroundColor: HT.card2 }} resizeMode="contain" />
                </Pressable>
                {c.business_card.back_data_base64 ? (
                  <Pressable onPress={() => setViewerFile({ id: "business_card_back", name: `Biglietto ${c.first_name} ${c.last_name} (retro).jpg`, mime: c.business_card!.mime || "image/jpeg", size: 0, created_at: c.business_card!.created_at || "", data_base64: c.business_card!.back_data_base64! })} testID="contact-business-card-back-open">
                    <Image source={{ uri: `data:${c.business_card.mime || "image/jpeg"};base64,${c.business_card.back_data_base64}` }} style={{ width: "100%", height: 160, borderRadius: 12, backgroundColor: HT.card2 }} resizeMode="contain" />
                    <Text style={[styles.infoLabel, { textAlign: "center", marginTop: 2 }]}>Retro</Text>
                  </Pressable>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setViewerFile({ id: "business_card", name: `Biglietto ${c.first_name} ${c.last_name}.jpg`, mime: c.business_card!.mime || "image/jpeg", size: 0, created_at: c.business_card!.created_at || "", data_base64: c.business_card!.data_base64 })} style={styles.cardBtn}><Ionicons name="eye-outline" size={16} color={HT.brand} /><Text style={styles.cardBtnTxt}>Apri</Text></Pressable>
                  {c.business_card.back_data_base64 ? <Pressable onPress={() => shareFile({ id: "business_card_back", name: `Biglietto ${c.first_name} ${c.last_name} (retro).jpg`, mime: c.business_card!.mime || "image/jpeg", size: 0, created_at: c.business_card!.created_at || "", data_base64: c.business_card!.back_data_base64! })} style={styles.cardBtn} testID="contact-business-card-back-share"><Ionicons name="share-social-outline" size={16} color={HT.brand} /><Text style={styles.cardBtnTxt}>Retro</Text></Pressable> : null}
                  <Pressable onPress={() => shareFile({ id: "business_card", name: `Biglietto ${c.first_name} ${c.last_name}.jpg`, mime: c.business_card!.mime || "image/jpeg", size: 0, created_at: c.business_card!.created_at || "", data_base64: c.business_card!.data_base64 })} style={styles.cardBtn} testID="contact-business-card-share"><Ionicons name="share-social-outline" size={16} color={HT.brand} /><Text style={styles.cardBtnTxt}>Condividi</Text></Pressable>
                </View>
              </View>
            ) : null}
            {(c.address_street || c.address_city) || showLegacyAddr || c.work_address || c.residence_address ? (
              <View style={{ marginTop: 4 }}>
                {distanceOrigin ? (
                  <View style={styles.originRow}>
                    <Ionicons name="business-outline" size={13} color={HT.muted} />
                    <Text style={styles.originLbl}>Distanze da: </Text>
                    <Text style={styles.originVal} numberOfLines={1}>{distanceOrigin}</Text>
                    <Pressable
                      testID="distance-origin-edit"
                      onPress={() => { setOriginDraft(distanceOrigin); setOriginOverrideOpen(true); }}
                      hitSlop={8}
                    >
                      <Ionicons name="create-outline" size={14} color={HT.brand} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    testID="distance-origin-set"
                    onPress={() => { setOriginDraft(""); setOriginOverrideOpen(true); }}
                    style={styles.originSetBtn}
                  >
                    <Ionicons name="speedometer-outline" size={14} color={HT.brand} />
                    <Text style={styles.originSetTxt}>Calcola distanze da un indirizzo</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
            {orderedBlocks.map((b) => (
              <AddressBlock key={b.kind} icon={b.icon} label={b.label} addr={b.addr} testIdPrefix={b.testIdPrefix} kind={b.kind} />
            ))}
            {c.birth_date ? <InfoRow icon="gift-outline" label="Data di nascita / Compleanno" value={c.birth_date} /> : null}
            {(c.anniversaries || []).map((ann: any, i: number) => (
              <InfoRow key={`ann-${i}`} icon="calendar-outline" label={ann.name || "Ricorrenza"} value={ann.date || "—"} />
            ))}
            {c.fiscal_code ? <InfoRow icon="card-outline" label="Codice Fiscale" value={c.fiscal_code} /> : null}
            {c.vat_number ? <InfoRow icon="business-outline" label="Partita IVA" value={c.vat_number} /> : null}
            {c.website ? <InfoRow icon="globe-outline" label="Sito web" value={c.website} href={c.website.startsWith("http") ? c.website : `https://${c.website}`} /> : null}
            {c.linkedin ? <InfoRow icon="logo-linkedin" label="LinkedIn" value={c.linkedin} /> : null}
            {c.instagram ? <InfoRow icon="logo-instagram" label="Instagram" value={c.instagram} /> : null}
            {c.facebook ? <InfoRow icon="logo-facebook" label="Facebook" value={c.facebook} /> : null}
            {c.referral_note ? <InfoRow icon="star-outline" label="Nota referenza" value={c.referral_note} /> : null}
            {c.email_note ? <InfoRow icon="chatbox-outline" label="Nota email" value={c.email_note} /> : null}
            {c.general_note ? <InfoRow icon="document-text-outline" label="Note generali" value={c.general_note} /> : null}
          </View>
          </>
        )}

        {tab === "notes" && (
          <>
            <View style={styles.card}>
              <Text style={styles.categoryTitle}>Categoria della nota</Text>
              <View style={styles.categoryRow}>
                {[
                  { k: null, label: "Nota semplice", color: HT.brand, icon: "document-text" },
                  { k: "general", label: "Note generali", color: "#2D7A5A", icon: "list" },
                  { k: "email", label: "Nota email condivisibile", color: HT.text, icon: "mail" },
                  { k: "referral", label: "Referenza", color: "#B77C14", icon: "people" },
                ].map((c: any) => {
                  const on = activeCategory === c.k;
                  return (
                    <Pressable
                      key={String(c.k)}
                      testID={`note-cat-${c.k ?? "all"}`}
                      onPress={() => setActiveCategory(c.k)}
                      style={[styles.catChip, { flexDirection: "row", alignItems: "center" }, on && { backgroundColor: c.color, borderColor: c.color }]}
                    >
                      <Ionicons name={c.icon} size={12} color={on ? "#FFF" : c.color} style={{ marginRight: 4 }} />
                      <Text style={[styles.catChipTxt, { color: on ? "#FFF" : c.color }]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.catHint}>
                {activeCategory === "general" ? "Le note salvate qui sono organizzate come Note generali." :
                 activeCategory === "email" ? "Queste note vengono incluse quando condividi la scheda via email." :
                 activeCategory === "referral" ? "Note relative a chi ti ha segnalato il contatto." :
                 "Aggiungi rapidamente una nota. Puoi cambiare categoria in qualsiasi momento."}
              </Text>
              <TextInput
                testID="note-text-input"
                value={noteText}
                onChangeText={setNoteText}
                placeholder={showLinkInput ? "Etichetta del link (opzionale)" : "Scrivi una nota..."}
                placeholderTextColor={HT.muted}
                style={[styles.input, { minHeight: showLinkInput ? 44 : 80, textAlignVertical: "top" }]}
                multiline={!showLinkInput}
              />
              {!showLinkInput && (
                <VoiceDictationButton
                  testID="voice-dictation-note"
                  label="Detta la nota"
                  onTranscript={(txt) => {
                    setNoteText((prev) => {
                      const clean = txt.trim();
                      if (!prev) return clean;
                      // Append with space, avoiding double punctuation
                      const sep = /[\s\.\,\;\:\!\?]$/.test(prev) ? " " : " ";
                      return prev + sep + clean;
                    });
                  }}
                />
              )}
              {showLinkInput && (
                <TextInput
                  testID="note-link-input"
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="https://..."
                  placeholderTextColor={HT.muted}
                  autoCapitalize="none"
                  keyboardType="url"
                  style={[styles.input, { marginTop: 8 }]}
                />
              )}
              <View style={styles.noteBtnRow}>
                {!showLinkInput && (
                  <Pressable testID="note-add-text" onPress={addTextNote} style={styles.smallBtn} disabled={busy}>
                    <Ionicons name="document-text" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Testo</Text>
                  </Pressable>
                )}
                {showLinkInput ? (
                  <Pressable testID="note-add-link" onPress={addLinkNote} style={[styles.smallBtn, { backgroundColor: HT.success }]}>
                    <Ionicons name="checkmark" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Salva link</Text>
                  </Pressable>
                ) : (
                  <Pressable testID="note-toggle-link" onPress={() => setShowLinkInput(true)} style={[styles.smallBtn, { backgroundColor: HT.axon }]}>
                    <Ionicons name="link" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Link/Video</Text>
                  </Pressable>
                )}
                <Pressable testID="note-photo-camera" onPress={() => addPhotoNote(true)} style={[styles.smallBtn, { backgroundColor: theme.color.brandSecondary }]}>
                  <Ionicons name="camera" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Scatta foto</Text>
                </Pressable>
                <Pressable testID="note-photo-gallery" onPress={() => addPhotoNote(false)} style={[styles.smallBtn, { backgroundColor: '#8B5CF6' }]}>
                  <Ionicons name="image" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Importa foto</Text>
                </Pressable>
                <Pressable testID="note-video-camera" onPress={() => addVideoNote(true)} style={[styles.smallBtn, { backgroundColor: '#DB2777' }]}>
                  <Ionicons name="videocam" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Registra video</Text>
                </Pressable>
                <Pressable testID="note-video-gallery" onPress={() => addVideoNote(false)} style={[styles.smallBtn, { backgroundColor: '#7C3AED' }]}>
                  <Ionicons name="film" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Importa video</Text>
                </Pressable>
                <Pressable testID="note-attach-file" onPress={addFileNote} style={[styles.smallBtn, { backgroundColor: '#0891B2' }]}>
                  <Ionicons name="attach" size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>Allega file</Text>
                </Pressable>
                <Pressable testID="note-record-toggle" onPress={recording ? stopRecording : startRecording} style={[styles.smallBtn, { backgroundColor: recording ? HT.danger : HT.warning }]}>
                  <Ionicons name={recording ? "stop" : "mic"} size={16} color="#FFF" /><Text style={styles.smallBtnTxt}>{recording ? "Stop" : "Registra audio"}</Text>
                </Pressable>
              </View>
            </View>
            {c.notes && c.notes.length > 0 ? c.notes.map((n) => (
              <View key={n.id} style={styles.noteCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.noteMeta}>
                    {n.kind === "audio" ? "Vocale" : n.kind === "photo" ? "Foto" : n.kind === "video" ? "Video" : n.kind === "file" ? "File" : n.kind === "link" ? "Link" : "Testo"}
                    {n.category ? ` · ${n.category === "general" ? "🗂️ Generali" : n.category === "email" ? "📧 Email" : "👥 Referenza"}` : ""}
                    {" · "}{new Date(n.created_at).toLocaleString("it-IT")}
                  </Text>
                  {n.kind === "text" && <Text style={styles.noteTxt}>{n.text}</Text>}
                  {n.kind === "audio" && (
                    <Pressable testID={`play-${n.id}`} onPress={() => void playNote(n)} style={styles.playBtn}>
                      <Ionicons name={playingNoteId === n.id ? "stop" : "play"} size={16} color={HT.brand} />
                      <Text style={styles.playBtnTxt}>{playingNoteId === n.id ? "Stop" : "Ascolta"}</Text>
                    </Pressable>
                  )}
                  {n.kind === "photo" && n.photo_base64 && (
                    <Image source={{ uri: n.photo_base64 }} style={styles.notePhoto} />
                  )}
                  {n.kind === "video" && n.video_base64 && (
                    <View style={styles.videoWrap}>
                      {Platform.OS === "web" ? (
                        // @ts-expect-error web element
                        <video src={n.video_base64} controls style={{ width: 240, height: 180, borderRadius: 10, backgroundColor: '#000' }} />
                      ) : (
                        <Pressable onPress={async () => {
                          const uri = n.video_base64!;
                          const b64 = uri.includes(",") ? uri.split(",")[1] : uri;
                          const path = `${FileSystem.cacheDirectory}video-${n.id}.mp4`;
                          try {
                            await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
                            await Linking.openURL(path);
                          } catch (e) { console.warn(e); }
                        }} style={styles.videoPlaceholder}>
                          <Ionicons name="play-circle" size={48} color="#FFF" />
                          <Text style={{ color: "#FFF", fontWeight: "700", marginTop: 4 }}>Riproduci video</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                  {n.kind === "link" && n.link_url && (
                    <Pressable onPress={() => {
                      // V50.z108 — WebView interna per link http/https.
                      const u = n.link_url!;
                      if (u.startsWith("http")) openInAppLink(router, u, { title: n.link_title, contactId: id as string });
                      else Linking.openURL(u).catch(() => {});
                    }} style={styles.linkBox}>
                      <Ionicons name="link" size={16} color={HT.brand} />
                      <Text style={styles.linkTxt} numberOfLines={2}>{n.link_title || n.link_url}</Text>
                    </Pressable>
                  )}
                  {n.kind === "file" && n.file_base64 && (
                    <Pressable
                      onPress={async () => {
                        try {
                          if (Platform.OS === "web") {
                            const uri = `data:${n.file_mime};base64,${n.file_base64}`;
                            const a = document.createElement("a");
                            a.href = uri; a.download = n.file_name || "file"; document.body.appendChild(a); a.click(); a.remove();
                            return;
                          }
                          const path = `${FileSystem.cacheDirectory}${n.file_name || "file"}`;
                          await FileSystem.writeAsStringAsync(path, n.file_base64!, { encoding: FileSystem.EncodingType.Base64 });
                          await Linking.openURL(path);
                        } catch (e) { console.warn(e); }
                      }}
                      style={styles.linkBox}
                    >
                      <Ionicons name={n.file_mime?.includes("pdf") ? "document-text" : "document"} size={20} color={HT.brand} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.linkTxt} numberOfLines={1}>{n.file_name || "File"}</Text>
                        <Text style={{ fontSize: 11, color: HT.muted }}>{Math.round((n.file_size || 0) / 1024)} KB</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
                <Pressable testID={`share-note-${n.id}`} onPress={() => shareNote(n)} style={{ marginRight: 6 }}><Ionicons name="share-social-outline" size={18} color={HT.brand} /></Pressable>
                <Pressable testID={`del-note-${n.id}`} onPress={() => deleteNote(n.id)}><Ionicons name="trash-outline" size={18} color={HT.danger} /></Pressable>
              </View>
            )) : <Text style={styles.emptyTxt}>Nessuna nota</Text>}
          </>
        )}

        {tab === "files" && (
          <>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="file-add-btn" onPress={pickFile} style={[styles.addFileBtn, { flex: 1 }]} disabled={busy}>
                <Ionicons name="cloud-upload-outline" size={20} color={HT.brand} />
                <Text style={styles.addFileTxt}>Carica</Text>
              </Pressable>
              <Pressable testID="file-scan-btn" onPress={() => setScannerOpen(true)} style={[styles.addFileBtn, { flex: 1, borderColor: '#FF6B35' }]} disabled={busy}>
                <Ionicons name="scan-outline" size={20} color="#FF6B35" />
                <Text style={[styles.addFileTxt, { color: "#FF6B35" }]}>Scanner</Text>
              </Pressable>
            </View>
            {/* V50.z357 — Step 8: cartella «CRT» con i PDF compilati da Axon, separata dagli altri file */}
            {c.files?.some((f: any) => f.folder === "CRT") ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }} testID="contact-folder-crt">
                <Ionicons name="folder" size={18} color="#10B981" />
                <Text style={{ color: HT.text, fontWeight: "900", fontSize: 13 }}>CRT · contratti compilati</Text>
                <Text style={{ color: HT.muted, fontSize: 12 }}>({c.files.filter((f: any) => f.folder === "CRT").length})</Text>
              </View>
            ) : null}
            {/* V50.z424 — file importati da cartella: ordinati per percorso originale, con intestazione della sottocartella */}
            {c.files && c.files.length > 0 ? [...c.files].sort((a: any, b: any) => ((a.folder === "CRT" ? -1 : 0) - (b.folder === "CRT" ? -1 : 0)) || String(a.folder || "").localeCompare(String(b.folder || "")) || String(a.name).localeCompare(String(b.name))).map((f, idx, arr) => (
              <React.Fragment key={f.id}>
              {!!(f as any).folder && (f as any).folder !== "CRT" && (idx === 0 || (arr[idx - 1] as any).folder !== (f as any).folder) ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }} testID={`contact-folder-${idx}`}>
                  <Ionicons name="folder-outline" size={16} color={HT.violet} />
                  <Text style={{ color: HT.text2, fontWeight: "800", fontSize: 12 }} numberOfLines={1}>{(f as any).folder}</Text>
                </View>
              ) : null}
              <Pressable
                testID={`file-open-${f.id}`}
                onPress={() => setViewerFile(f)}
                style={styles.fileCard}
              >
                <Ionicons name={f.mime.startsWith("image/") ? "image-outline" : "document-outline"} size={22} color={HT.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.fileMeta}>{Math.round((f.size || 0) / 1024)} KB · {new Date(f.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                </View>
                <Pressable
                  testID={`share-file-${f.id}`}
                  onPress={(e: any) => { e?.stopPropagation?.(); shareFile(f); }}
                  hitSlop={8}
                  style={{ marginRight: 6 }}
                >
                  <Ionicons name="share-social-outline" size={18} color={HT.brand} />
                </Pressable>
                <Pressable
                  testID={`del-file-${f.id}`}
                  onPress={(e: any) => { e?.stopPropagation?.(); deleteFile(f.id); }}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={HT.danger} />
                </Pressable>
              </Pressable>
              </React.Fragment>
            )) : <Text style={styles.emptyTxt}>Nessun file</Text>}
            {/* V50.z25 — Allegati dalle mail (Auto-CRM) */}
            <ContactMailAttachmentsSection contactId={id as string} />
            {/* V50.z267 — Documenti di riconoscimento del cliente: OCR → aggiorna CF / data di nascita / indirizzo se mancanti */}
            <View style={{ marginTop: 14 }}>
              <IdentityDocsSection subjectType="contact" subjectId={id as string} onExtracted={async (d) => {
                const upd: Record<string, string> = {};
                if (!c.fiscal_code && d.tax_id) upd.fiscal_code = d.tax_id;
                if (!c.birth_date && d.birth_date) upd.birth_date = d.birth_date;
                if (!c.first_name && d.first_name) upd.first_name = d.first_name;
                if (!c.last_name && d.last_name) upd.last_name = d.last_name;
                if (!(c as any).residence_address && d.address) upd.residence_address = [d.address, d.city].filter(Boolean).join(", ");
                if (Object.keys(upd).length) { try { await api(`/contacts/${id}`, { method: "PUT", body: upd }); await load(); } catch {} }
              }} />
            </View>
          </>
        )}

        {/* V29.o — Profilo Axon + Analisi Axon spostati in fondo (tab Info + Note + File) */}
        {(tab === "info" || tab === "notes" || tab === "files") && (
          <>
            <AxonProfileCard contactId={id} />
            <AxonAnalysesSection contactId={id} />
            {/* V50.z83 — Richieste info & chat collegate al cliente */}
            <ContactInfoRequestsSection contactId={id as string} />
          </>
        )}

        {/* V50.z67 — Sezione Campi Personalizzati (visibili solo se definiti dal Master) */}
        {tab === "info" && (
          <ContactCustomFieldsSection
            contactId={id as string}
            initialValues={c.custom_fields || {}}
            onSaved={load}
          />
        )}

        {/* V29.av — Codice Cliente: riga compatta inline (etichetta + valore),
            spostata in fondo alla pagina. Solo Master può editare tap-and-inline. */}
        {tab === "info" && (
          <View style={styles.codeCompactRow}>
            <Ionicons name="pricetag-outline" size={14} color={HT.muted} />
            <Text style={styles.codeCompactLabel}>Codice cliente:</Text>
            {isMaster ? (
              <>
                <TextInput
                  testID="contact-code-input"
                  value={contactCodeEdit}
                  onChangeText={setContactCodeEdit}
                  onBlur={saveContactCode}
                  onSubmitEditing={saveContactCode}
                  placeholder="—"
                  placeholderTextColor={HT.muted}
                  style={styles.codeCompactInput}
                />
                {contactCodeSaving ? (
                  <ActivityIndicator size="small" color={HT.brand} />
                ) : (
                  <Pressable testID="contact-code-save" onPress={saveContactCode} hitSlop={8}>
                    <Ionicons name="save-outline" size={16} color={HT.brand} />
                  </Pressable>
                )}
              </>
            ) : (
              <Text style={styles.codeCompactValue} numberOfLines={1}>{c.contact_code || "—"}</Text>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
      )}
      <CallActionSheet
        visible={!!callTarget}
        target={callTarget}
        onClose={() => setCallTarget(null)}
        onCompleted={(res) => {
          const contactId = callTarget?.contact_id || null;
          setCallTarget(null);
          setCallsRefreshTick((n) => n + 1);
          load();
          // Se l'esito è "Presa Appuntamento", apri Nuovo Appuntamento pre-compilato
          if (res?.outcome_id === "call_appointment" && contactId) {
            router.push(`/appointment/new?contact_id=${contactId}`);
          }
        }}
      />
      {(tab === "notes" || tab === "files" || tab === "bills") && <CalculatorFAB />}
      <ShareSheet
        visible={!!shareTarget}
        target={shareTarget}
        onClose={() => setShareTarget(null)}
      />
      <FileViewer
        visible={!!viewerFile}
        fileName={viewerFile?.name || ""}
        mime={viewerFile?.mime || "application/octet-stream"}
        dataBase64={viewerFile?.data_base64 || ""}
        onClose={() => setViewerFile(null)}
        onShare={viewerFile ? () => { const f = viewerFile; setViewerFile(null); shareFile(f); } : undefined}
      />
      <DocumentScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        defaultName={`Scan-${c?.first_name || ""}-${new Date().toISOString().slice(0,10)}`.replace(/\s+/g, "-")}
        hintTitle={`Scansione documento per ${c?.first_name || ""} ${c?.last_name || ""}`.trim()}
        contactId={String(id)}
        source="contact"
        onSaved={async ({ page_count }) => {
          // V50.z226 — il salvataggio (file cliente + I miei file › Scanner) avviene dentro DocumentScannerModal
          await load();
          notify("Scansione salvata", `${page_count} pagina/e unite in PDF.`);
        }}
      />
      <CallScriptOverlay
        visible={callScriptOpen}
        onClose={() => setCallScriptOpen(false)}
        contactName={`${c?.first_name || ""} ${c?.last_name || ""}`.trim()}
        contactPhone={c?.phone}
      />
      <PromoteToAgentModal
        visible={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        contactId={id}
        contactName={`${c?.first_name || ""} ${c?.last_name || ""}`.trim()}
        contactEmail={c?.email}
        onPromoted={load}
      />

      {/* V50.z101 — Popup opzionale: contatto diventato "Cliente" → programma recensione */}
      <Modal visible={reviewPromptOpen} transparent animationType="fade" onRequestClose={() => setReviewPromptOpen(false)}>
        <View style={styles.reviewPromptBackdrop} pointerEvents="box-none">
          <View style={styles.reviewPromptSheet}>
            <View style={styles.reviewPromptIcon}>
              <Ionicons name="star" size={28} color="#F59E0B" />
            </View>
            <Text style={styles.reviewPromptTitle}>Nuovo cliente 🎉</Text>
            <Text style={styles.reviewPromptSub}>
              {(c?.first_name || "Il contatto")} è ora un cliente. Vuoi programmare l&apos;invio della richiesta di recensione?
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable
                style={[styles.reviewPromptBtn, { backgroundColor: HT.card2 }]}
                onPress={() => setReviewPromptOpen(false)}
                testID="review-prompt-later"
              >
                <Text style={[styles.reviewPromptBtnTxt, { color: HT.text }]}>Più tardi</Text>
              </Pressable>
              <Pressable
                style={[styles.reviewPromptBtn, { backgroundColor: '#F59E0B' }]}
                onPress={() => {
                  setReviewPromptOpen(false);
                  setTab("reviews");
                  setReviewsAutoOpen(true);
                }}
                testID="review-prompt-open"
              >
                <Ionicons name="calendar" size={16} color="#FFF" />
                <Text style={[styles.reviewPromptBtnTxt, { color: "#FFF" }]}>Programma richiesta</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* V50.z71 — Modal per impostare/cambiare l'indirizzo di partenza per calcolo distanze */}
      <Modal visible={originOverrideOpen} transparent animationType="fade" onRequestClose={() => setOriginOverrideOpen(false)}><KModalBody>
        <View style={styles.originModalBackdrop} pointerEvents="box-none">
          <View style={styles.originModalSheet}>
            <Text style={styles.originModalTitle}>Indirizzo di partenza</Text>
            <Text style={styles.originModalSub}>
              Da qui verranno calcolate le distanze verso ogni indirizzo del contatto.
              {settings?.office_address ? " Default = indirizzo ufficio." : ""}
            </Text>
            <TextInput
              testID="distance-origin-input"
              value={originDraft}
              onChangeText={setOriginDraft}
              placeholder="es. Corso Italia 42, Milano"
              placeholderTextColor={HT.muted}
              style={styles.originModalInput}
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {settings?.office_address && originDraft.trim() !== settings.office_address ? (
                <Pressable
                  testID="distance-origin-reset"
                  onPress={() => setOriginDraft(settings.office_address)}
                  style={[styles.originModalBtn, styles.originModalBtnGhost]}
                >
                  <Ionicons name="business-outline" size={14} color={HT.text} />
                  <Text style={styles.originModalBtnGhostTxt}>Usa ufficio</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setOriginOverrideOpen(false)}
                style={[styles.originModalBtn, styles.originModalBtnGhost, { flex: 1 }]}
              >
                <Text style={styles.originModalBtnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable
                testID="distance-origin-save"
                onPress={() => {
                  setDistanceOrigin(originDraft.trim());
                  setDistances({});
                  setOriginOverrideOpen(false);
                }}
                style={[styles.originModalBtn, { flex: 1, backgroundColor: HT.brand }]}
              >
                <Ionicons name="checkmark" size={16} color="#FFF" />
                <Text style={styles.originModalBtnTxt}>Calcola</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KModalBody></Modal>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, href }: { icon: any; label: string; value: string; href?: string }) {
  const clickable = !!href;
  // V50.z335 — riga dati come mini-card dark con icona in box tinto
  const content = (
    <View style={styles.infoRow}>
      <View style={[styles.infoIconBox, clickable && { backgroundColor: HT.axonTint }]}>
        <Ionicons name={icon} size={16} color={clickable ? HT.axon : HT.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, clickable && { color: HT.axon }]}>{value}</Text>
      </View>
      {clickable ? <Ionicons name="open-outline" size={16} color={HT.axon} /> : null}
    </View>
  );
  if (clickable && href) {
    return (
      <Pressable onPress={() => {
        // V50.z108 — WebView interna per URL http/https (mantiene bottom nav).
        if (href.startsWith("http")) openInAppLink(expoRouter, href, { title: label });
        else Linking.openURL(href).catch(() => {});
      }} testID={`info-open-${label.toLowerCase().replace(/\s/g, "-")}`}>
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  cardBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  cardBtnTxt: { fontWeight: "800", fontSize: 13, color: HT.brand },
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  hero: { padding: 20, paddingTop: 4, alignItems: "center" },
  heroCompact: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: HT.bg, borderBottomWidth: 1, borderBottomColor: HT.border, overflow: "hidden", position: "relative" },
  heroAccentLine: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  heroTopRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  avatarWrap: { position: "relative", marginBottom: 10 },
  avatarWrapCompact: { position: "relative", marginLeft: 4 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  avatarCompact: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarImgCompact: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: HT.borderStrong },
  avatarBadge: { position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: HT.card },
  avatarBadgeCompact: { position: "absolute", right: -1, bottom: -1, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: HT.card },
  avatarTxt: { color: "#FFF", fontSize: 26, fontWeight: "700" },
  avatarTxtCompact: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  name: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  nameCompact: { color: HT.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  areaTag: { color: "rgba(255,255,255,0.85)", marginTop: 4, fontSize: 12 },
  areaTagCompact: { color: HT.text2, fontSize: 11.5, marginTop: 2, fontWeight: "600" },
  assignPill: { marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: HT.brandTint, borderRadius: 20 },
  assignPillTxt: { fontSize: 11, color: HT.brand, fontWeight: "700" },
  // V28.c — Read-only status label (edit only via edit form)
  statusLabel: { marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabelTxt: { fontSize: 11, fontWeight: "800" },
  statusRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: HT.card, borderWidth: 1.5 },
  statusChipTxt: { fontSize: 11, fontWeight: "800" },
  tabsWrap: { backgroundColor: HT.bg, borderBottomWidth: 1, borderBottomColor: HT.border },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  tabIcon: { minWidth: 64, paddingVertical: 8, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 12, borderWidth: 1, borderColor: "transparent", backgroundColor: HT.glass },
  tabLbl: { fontSize: 9.5, fontWeight: "800", color: HT.muted, letterSpacing: 0.2 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: HT.brand },
  tabTxt: { fontWeight: "600", color: HT.muted, fontSize: 12 },
  tabTxtActive: { color: HT.brand },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: HT.border, gap: 12 },
  infoRow: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  infoIconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  infoLabel: { fontSize: 10.5, color: HT.muted, textTransform: "uppercase", fontWeight: "800", letterSpacing: 0.4 },
  infoValue: { fontSize: 15, color: HT.text, marginTop: 2, fontWeight: "600" },
  input: { backgroundColor: HT.card2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, padding: 10, color: HT.text },
  noteBtnRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill },
  smallBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  noteCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border, marginTop: 8 },
  noteMeta: { fontSize: 11, color: HT.muted, marginBottom: 4 },
  noteTxt: { fontSize: 14, color: HT.text },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: HT.brandTint, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  playBtnTxt: { color: HT.brand, fontWeight: "700", fontSize: 12 },
  addFileBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.card, padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.brand, borderStyle: "dashed" },
  addFileTxt: { color: HT.brand, fontWeight: "700" },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border, marginTop: 8 },
  fileName: { fontSize: 14, fontWeight: "600", color: HT.text },
  fileMeta: { fontSize: 11, color: HT.muted, marginTop: 2 },
  emptyTxt: { textAlign: "center", color: HT.muted, marginTop: 20 },
  tagChip: { backgroundColor: HT.brandTint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  tagChipTxt: { color: HT.brand, fontWeight: "700", fontSize: 11 },
  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  notePhoto: { width: "100%", height: 180, borderRadius: theme.radius.md, marginTop: 6 },
  linkBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.brandTint, padding: 10, borderRadius: theme.radius.md, marginTop: 6 },
  linkTxt: { color: HT.brand, fontWeight: "600", flex: 1 },
  wazeInline: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.brand, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  wazeInlineTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  navBtnRow: { flexDirection: "row", gap: 8, marginLeft: 30, marginTop: 6, flexWrap: "wrap", alignItems: "center" },
  // V50.z71 — Address block + preferred + km badge + origin editor
  addrBlock: { paddingVertical: 4, marginBottom: 6 },
  addrBlockPreferred: { backgroundColor: HT.warningTint, borderRadius: 10, borderWidth: 1, borderColor: '#FBBF24', padding: 6, marginBottom: 8 },
  starBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  kmBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: HT.axonTint, borderWidth: 1, borderColor: HT.axonLine },
  kmBadgeTxt: { fontSize: 11, fontWeight: "700", color: HT.axon },
  originRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, marginBottom: 6 },
  originLbl: { fontSize: 11, fontWeight: "700", color: HT.muted },
  originVal: { flex: 1, fontSize: 12, color: HT.text, fontWeight: "600" },
  originSetBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: HT.brand, alignSelf: "flex-start", marginBottom: 6 },
  originSetTxt: { fontSize: 12, fontWeight: "700", color: HT.brand },
  originModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  originModalSheet: { backgroundColor: HT.card, borderRadius: 14, padding: 18 },
  originModalTitle: { fontSize: 16, fontWeight: "800", color: HT.text },
  originModalSub: { fontSize: 12, color: HT.muted, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  originModalInput: { borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: HT.card2, color: HT.text },
  originModalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  originModalBtnGhost: { backgroundColor: HT.card2 },
  originModalBtnGhostTxt: { color: HT.text, fontWeight: "700", fontSize: 13 },
  originModalBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  // V50.z101 — Popup transizione a "Cliente" → richiesta recensione
  reviewPromptBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  reviewPromptSheet: { backgroundColor: HT.card, borderRadius: 16, padding: 22, alignItems: "center" },
  reviewPromptIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: HT.warningTint, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  reviewPromptTitle: { fontSize: 18, fontWeight: "800", color: HT.text, textAlign: "center" },
  reviewPromptSub: { fontSize: 13, color: HT.muted, textAlign: "center", marginTop: 6, lineHeight: 18 },
  reviewPromptBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10 },
  reviewPromptBtnTxt: { fontSize: 13, fontWeight: "800" },
  commSectionTitle: { fontSize: 13, fontWeight: "700", color: HT.brand, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  // V29.av — Codice cliente compatto (elemento secondario in fondo pagina)
  codeCompactRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: HT.card2,
    borderRadius: 8, borderWidth: 1, borderColor: HT.border,
  },
  codeCompactLabel: {
    fontSize: 12, color: HT.muted, fontWeight: "600",
  },
  codeCompactValue: {
    flex: 1, fontSize: 13, fontWeight: "700", color: HT.text,
  },
  codeCompactInput: {
    flex: 1, fontSize: 13, fontWeight: "700",
    color: HT.text, paddingVertical: 2, paddingHorizontal: 0,
  },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  areaBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill },
  areaBadgeTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  groupBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill, borderWidth: 1.5, backgroundColor: HT.card },
  groupBadgeDot: { width: 8, height: 8, borderRadius: 4 },
  groupBadgeTxt: { fontWeight: "700", fontSize: 12 },
  videoWrap: { marginTop: 6 },
  videoPlaceholder: { width: 240, height: 180, borderRadius: 10, backgroundColor: HT.card2, alignItems: "center", justifyContent: "center" },
  categoryTitle: { fontSize: 11, fontWeight: "700", color: HT.text2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  catChipTxt: { fontWeight: "700", fontSize: 11 },
  catHint: { color: HT.muted, fontSize: 11, marginTop: 8, marginBottom: 4, fontStyle: "italic" },
  commGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  commBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: theme.radius.md, minWidth: 108, flexGrow: 1, justifyContent: "center" },
  commBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  // V50.z335 — azioni principali grandi + secondarie ghost in «Altro»
  commPrimaryRow: { flexDirection: "row", gap: 10 },
  commBtnPrimary: { flex: 1, minWidth: 96, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, borderRadius: 14 },
  commBtnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  commMoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.glass, minHeight: 36 },
  commMoreTxt: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  commBtnSecondary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, backgroundColor: HT.glass, flexGrow: 1, justifyContent: "center", minHeight: 40 },
  commBtnSecondaryTxt: { fontWeight: "800", fontSize: 12 },
  // V29.c — Compact Aree + Gruppi card
  compactCard: {
    backgroundColor: HT.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: HT.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  compactRowLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    color: HT.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginRight: 2,
  },
  compactBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  areaBadgeMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  areaBadgeMiniTxt: { color: "#FFF", fontWeight: "700", fontSize: 10 },
  groupBadgeMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: HT.card,
  },
  groupBadgeMiniDot: { width: 6, height: 6, borderRadius: 3 },
  groupBadgeMiniTxt: { fontWeight: "700", fontSize: 10 },
  // V29 — Promuovi ad agente
  promoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HT.brandLine,
    backgroundColor: HT.brandTint,
    marginBottom: 12,
  },
  promoteIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EA580C',
    alignItems: "center",
    justifyContent: "center",
  },
  promoteTitle: { fontSize: 14, fontWeight: "800", color: "#FDBA74" },
  promoteSub: { fontSize: 12, color: "#FDBA74", opacity: 0.75, marginTop: 2, lineHeight: 16 },
  collabInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HT.success + '66',
    backgroundColor: HT.successTint,
    marginBottom: 12,
  },
  collabInfoTxt: { flex: 1, fontSize: 13, color: HT.success, fontWeight: "600" },
});

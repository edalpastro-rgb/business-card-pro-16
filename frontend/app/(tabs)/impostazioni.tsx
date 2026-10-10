import React, { useCallback, useEffect, useRef, useState } from "react";
import { syncTtsModeFromSetting } from "@/src/utils/ttsGate"; // V50.z454
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Image, Share, Platform, Linking } from "react-native";
import { KScrollView } from "@/src/ui/keyboard"; // V50.z374 — tastiera: campo attivo sempre visibile
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SettingsGroupButton, SettingsLinkRows, ChangePasswordCard, ChangeEmailCard, SECTION_META, type SettingsSection } from "@/src/SettingsHub"; // V50.z249 · V50.z405 cambio email
import { api, BACKEND_URL } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useRole } from "@/src/useRole"; // V50.z436 — permessi centralizzati
import { ConsultantSettings } from "@/src/ConsultantSettings";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "@/src/theme";
import { AreasManager } from "@/src/AreasManager";
import { pickAvatarBase64 } from "@/src/image-picker";
import { notify, confirmAsync } from "@/src/utils/notify";
import { openInAppLink } from "@/src/utils/openInAppLink";
import { ModuleErrorBoundary } from "@/src/shared";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { DesktopGrid } from "@/src/ui/DesktopGrid";
import { TtsEngineCard } from "@/src/TtsEngineCard";
import { AxonInitiativeCard } from "@/src/AxonInitiativeCard"; // V50.z419 // V50.z414 — motore TTS (Dispositivo · Google TTS / Server) con anteprima // V50.z409 — desktop: hub a 2 colonne, sotto-sezioni centrate a 860 px
import { useResponsive, SIDEBAR_W, CONTENT_MAX_W } from "@/src/hooks/useResponsive";
import { invalidateTableBrandHeader } from "@/src/ChatTableExport";
import { AxonMemoryEntryCard } from "@/src/AxonMemoryEntryCard"; // V50.z192 — Profilo → Memoria AxonOS
import { FindPhoneSoundCard } from "@/src/findPhone/FindPhoneSoundCard"; // V50.z493
import { AppInfoCard } from "@/src/AppInfoCard"; // V50.z208 — Piano attivo + versione APK
import { PromoRedeemCard } from "@/src/PromoCodeField"; // V50.z320 — codice promozionale
import { ReferralCard } from "@/src/ReferralCard"; // V50.z322 — Invita un amico
import { resetOnboardingFlags } from "@/src/permissions/devicePermissions"; // V50.z516 — Rivedi introduzione
import { PunAlertCard } from "@/src/PunAlertCard"; // V50.z325 — Avviso soglia PUN
import { AxonPersonalizeCard } from "@/src/AxonPersonalizeCard"; // V50.z456 — Personalizza Axon (Super Master / Lite)
import { HomeLayoutCard } from "@/src/home/HomeLayoutCard"; // V50.z505 — Personalizza la Home (blocchi, ordine, posizione) — solo Super Master
import { SetupProcessingBadge } from "@/src/SetupProcessingBadge"; // V50.z216 — Blocco 5
import { ResetTestDataCard } from "@/src/ResetTestDataCard";
import { CompressAllCard } from "@/src/CompressAllCard"; // V50.z364 — Comprimi tutto (Master) // V50.z288 — Azzera dati di test (Master)
import { AxonToneLevelPicker } from "@/src/AxonToneLevelPicker"; // V50.z218 — Blocco 6: tono a 5 livelli (5 = Fantasiosa)
import { FutureInterestsAlert } from "@/src/FutureInterestsAlert"; // V50.z219 — interessi futuri dal wizard
import { VisitDetectionSettings } from "@/src/VisitDetectionSettings"; // V50.z256 — Rilevamento Visite
import { SetupEntryCard } from "@/src/SetupEntryCard"; // V50.z211 — Configurazione guidata
import { ThemePicker } from "@/src/ThemePicker"; // V50.z338 — Aspetto: Chiaro · Grigio · Scuro
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Settings = {
  energy_title: string; energy_color: string;
  network_title: string; network_color: string;
  app_name?: string;
  custom_appointment_types?: string[];
  custom_product_categories?: { name: string; subs?: string[] }[];
  custom_areas?: { id: string; name: string; color: string; icon?: string; description?: string; subcategories?: string[]; allowed_roles?: string[]; archived?: boolean }[];
  area_meta?: Record<string, any>;
  // V27 — templates configurable by Master, used by agents
  wa_referral_template?: string;
  call_script?: string;
  // V50.z71 — Indirizzo ufficio per calcolo distanze
  office_address?: string;
};


// V50.z41 — Header categorizzato per Impostazioni (palette AdvisorOS Pro)
function CatHeader({ color, label, icon }: { color: string; label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, marginTop: 2 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: color + "22" }}>
        <Ionicons name={icon} size={12} color={color} />
      </View>
      <Text style={{ fontSize: 12, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase", color }}>{label}</Text>
      <View style={{ flex: 1, height: 2, borderRadius: 1, marginLeft: 4, backgroundColor: color + "33" }} />
    </View>
  );
}

export default function ImpostazioniRoute() {
  return (
    <ModuleErrorBoundary moduleName="profile">
      <ImpostazioniScreen />
    </ModuleErrorBoundary>
  );
}

function ImpostazioniScreen() {
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  // V50.z249 — Ristrutturazione: hub (nessuna sezione) → bottoni raggruppati; `?section=` mostra solo i blocchi della sezione.
  // V50.z407 — BUG NAVIGAZIONE: la sezione era nell'URL (?section=) → «indietro» usciva dalla tab (Home) e riaprendo la tab
  // restava l'ultima sezione. Ora la sezione è STATO LOCALE: indietro = torna all'hub Profilo, blur della tab = reset all'hub;
  // il parametro ?section= (deep link dal pannello Master) viene letto una volta al focus e poi svuotato.
  const params = useLocalSearchParams<{ section?: string }>();
  const paramRef = useRef(params.section); paramRef.current = params.section;
  const [sec, setSec] = useState<SettingsSection | null>(null);
  // V50.z416 — alias «assistente» (usato dai link del navigatore Axon: /impostazioni?section=assistente) → sezione "axon"
  const normSection = (v: unknown): unknown => (v === "assistente" || v === "assistant" ? "axon" : v);
  const isSection = (v: unknown): v is SettingsSection => (["security", "billing", "branding", "integrations", "general", "axon"] as const).includes(v as any);
  useFocusEffect(useCallback(() => {
    { const ps = normSection(paramRef.current); if (isSection(ps)) { setSec(ps); router.setParams({ section: "" } as any); } }
    return () => setSec(null);
  }, [router]));
  // V50.z414 — il parametro ?section= cambia mentre la schermata è già a fuoco (deep link dalla chat Axon su web): reagisci comunque
  useEffect(() => {
    { const ps = normSection(params.section); if (isSection(ps)) { setSec(ps); router.setParams({ section: "" } as any); } }
  }, [params.section]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSection = (k: SettingsSection) => setSec(k);
  const backToHub = () => setSec(null);
  // V50.z516 — «Rivedi introduzione»: azzera i flag di tour e permessi (locali + server) e riparte dal Tour
  const replayIntro = async () => {
    if (!(await confirmAsync("Rivedi introduzione", "Ripartirai dall'inizio: tour di benvenuto, voce di Axon e, sul telefono, i permessi del dispositivo. Le tue impostazioni e i tuoi dati non cambiano."))) return;
    if (user?.user_id) await resetOnboardingFlags(user.user_id);
    api("/user-settings", { method: "PUT", body: { onboarding_done: false } }).catch(() => {});
    router.push("/tour" as any);
  };
  const { isMaster: isOwner, isConsultant } = useRole(); // V50.z436 — prima: !parent_user_id (non controllava il ruolo)
  const pagePad = usePageBottomPadding();
  const { isDesktop, width: winW } = useResponsive();
  const deskPadX = isDesktop ? Math.max(16, (Math.min(winW - SIDEBAR_W, CONTENT_MAX_W) - 860) / 2) : 16; // V50.z409
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // V38H — additional emails management
  const [emailInput, setEmailInput] = useState("");
  const [emailsBusy, setEmailsBusy] = useState(false);
  const [aptTypeInput, setAptTypeInput] = useState("");
  const [prodCatInput, setProdCatInput] = useState("");
  const [subInputs, setSubInputs] = useState<Record<number, string>>({});
  const [assistantName, setAssistantName] = useState<string>("Neo");
  const [assistantNameSaved, setAssistantNameSaved] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"text" | "voice" | "both">("text");
  // V45 — Badge counter for pending rule proposals (Master only).
  const [pendingProposals, setPendingProposals] = useState<number>(0);
  const [assistantVoice, setAssistantVoice] = useState<string>("sara");
  const assistantSaveTimer = React.useRef<any>(null);

  // Bug 9 — Dati Master & Biglietto da Visita
  type MasterInfo = {
    user_id: string;
    name: string;
    email: string;
    role: string;
    role_label: string;
    title: string;
    phone: string;
    company_name: string;
    website: string;
    address: string;
    tagline: string;
    avatar_base64: string;
    logo_base64: string;
    photo_base64: string;
    accent_color: string;
    additional_emails: string[];
    business_card: { card_id: string | null; slug: string | null };
  };
  const [master, setMaster] = useState<MasterInfo | null>(null);

  const persistAndReload = async (next: Settings) => {
    setS(next);
    try { await api("/settings", { method: "PUT", body: next }); } catch {}
  };

  const addAptType = () => {
    if (!s) return;
    const t = aptTypeInput.trim();
    if (!t) return;
    const list = s.custom_appointment_types || [];
    if (list.includes(t)) return;
    persistAndReload({ ...s, custom_appointment_types: [...list, t] });
    setAptTypeInput("");
  };
  const removeAptType = (t: string) => {
    if (!s) return;
    persistAndReload({ ...s, custom_appointment_types: (s.custom_appointment_types || []).filter((x) => x !== t) });
  };
  const addProdCat = () => {
    if (!s) return;
    const name = prodCatInput.trim();
    if (!name) return;
    const list = s.custom_product_categories || [];
    if (list.some((c) => c.name === name)) return;
    persistAndReload({ ...s, custom_product_categories: [...list, { name, subs: [] }] });
    setProdCatInput("");
  };
  const removeProdCat = (idx: number) => {
    if (!s) return;
    const next = [...(s.custom_product_categories || [])];
    next.splice(idx, 1);
    persistAndReload({ ...s, custom_product_categories: next });
  };
  const addSub = (idx: number) => {
    if (!s) return;
    const v = (subInputs[idx] || "").trim();
    if (!v) return;
    const next = [...(s.custom_product_categories || [])];
    const cat = { ...next[idx] };
    cat.subs = [...(cat.subs || []), v];
    next[idx] = cat;
    persistAndReload({ ...s, custom_product_categories: next });
    setSubInputs({ ...subInputs, [idx]: "" });
  };
  const removeSub = (idx: number, sub: string) => {
    if (!s) return;
    const next = [...(s.custom_product_categories || [])];
    const cat = { ...next[idx] };
    cat.subs = (cat.subs || []).filter((x) => x !== sub);
    next[idx] = cat;
    persistAndReload({ ...s, custom_product_categories: next });
  };

  const changeAvatar = async () => {
    setAvatarBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) {
        await api("/auth/profile", { method: "PUT", body: { avatar_base64: b64 } });
        await refresh();
      }
    } finally { setAvatarBusy(false); }
  };

  // V38I — Branding (logo + agency name) for PDF reports
  const [companyName, setCompanyName] = useState<string>(user?.company_name || "");
  const [companyNameSaved, setCompanyNameSaved] = useState(false);
  // V38U — Report header extras (slogan + contacts)
  const [reportSlogan, setReportSlogan] = useState<string>((user as any)?.report_slogan || "");
  const [reportContacts, setReportContacts] = useState<string>((user as any)?.report_contacts || "");
  const [logoBusy, setLogoBusy] = useState(false);
  const companyNameTimer = React.useRef<any>(null);
  const sloganTimer = React.useRef<any>(null);
  const contactsTimer = React.useRef<any>(null);
  useEffect(() => { setCompanyName(user?.company_name || ""); }, [user?.company_name]);
  const userSlogan = (user as any)?.report_slogan;
  const userContacts = (user as any)?.report_contacts;
  useEffect(() => { setReportSlogan(userSlogan || ""); }, [userSlogan]);
  useEffect(() => { setReportContacts(userContacts || ""); }, [userContacts]);
  const saveCompanyName = (v: string) => {
    setCompanyName(v);
    setCompanyNameSaved(false);
    if (companyNameTimer.current) clearTimeout(companyNameTimer.current);
    companyNameTimer.current = setTimeout(async () => {
      try {
        await api("/auth/profile", { method: "PUT", body: { company_name: v.trim().slice(0, 80) } });
        await refresh();
        setCompanyNameSaved(true);
        setTimeout(() => setCompanyNameSaved(false), 1800);
      } catch (e: any) { notify("Errore", e?.message || ""); }
    }, 600);
  };
  // V38U — debounced saves for slogan + contacts
  const saveReportSlogan = (v: string) => {
    setReportSlogan(v);
    if (sloganTimer.current) clearTimeout(sloganTimer.current);
    sloganTimer.current = setTimeout(async () => {
      try {
        await api("/auth/profile", { method: "PUT", body: { report_slogan: v.trim().slice(0, 140) } });
        await refresh();
      } catch (e: any) { notify("Errore", e?.message || ""); }
    }, 600);
  };
  const saveReportContacts = (v: string) => {
    setReportContacts(v);
    if (contactsTimer.current) clearTimeout(contactsTimer.current);
    contactsTimer.current = setTimeout(async () => {
      try {
        await api("/auth/profile", { method: "PUT", body: { report_contacts: v.trim().slice(0, 240) } });
        await refresh();
      } catch (e: any) { notify("Errore", e?.message || ""); }
    }, 600);
  };
  const uploadCompanyLogo = async () => {
    setLogoBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) {
        await api("/auth/profile", { method: "PUT", body: { company_logo_base64: b64 } });
        await refresh();
      }
    } catch (e: any) { notify("Errore logo", e?.message || ""); }
    finally { setLogoBusy(false); }
  };
  const removeCompanyLogo = async () => {
    const ok = await confirmAsync("Rimuovi logo", "Vuoi togliere il logo aziendale dai report?");
    if (!ok) return;
    setLogoBusy(true);
    try {
      await api("/auth/profile", { method: "PUT", body: { company_logo_base64: "" } });
      await refresh();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setLogoBusy(false); }
  };

  // V50.z140 — Header tabelle AxonOS (logo + nome azienda in testa a ogni tabella esportata dalla chat)
  const [tableHdrName, setTableHdrName] = useState<string>(user?.table_header_name || "");
  const [tableHdrSaved, setTableHdrSaved] = useState(false);
  const [tableLogoBusy, setTableLogoBusy] = useState(false);
  const tableHdrTimer = React.useRef<any>(null);
  useEffect(() => { setTableHdrName(user?.table_header_name || ""); }, [user?.table_header_name]);
  const saveTableHdrName = (v: string) => {
    setTableHdrName(v);
    setTableHdrSaved(false);
    if (tableHdrTimer.current) clearTimeout(tableHdrTimer.current);
    tableHdrTimer.current = setTimeout(async () => {
      try {
        await api("/auth/profile", { method: "PUT", body: { table_header_name: v.trim().slice(0, 80) } });
        await refresh();
        invalidateTableBrandHeader();
        setTableHdrSaved(true);
        setTimeout(() => setTableHdrSaved(false), 1800);
      } catch (e: any) { notify("Errore", e?.message || ""); }
    }, 600);
  };
  const uploadTableLogo = async () => {
    setTableLogoBusy(true);
    try {
      const b64 = await pickAvatarBase64();
      if (b64) {
        await api("/auth/profile", { method: "PUT", body: { table_header_logo_base64: b64 } });
        await refresh();
        invalidateTableBrandHeader();
      }
    } catch (e: any) { notify("Errore logo", e?.message || ""); }
    finally { setTableLogoBusy(false); }
  };
  const removeTableLogo = async () => {
    const ok = await confirmAsync("Rimuovi logo", "Vuoi togliere il logo dall'header delle tabelle?");
    if (!ok) return;
    setTableLogoBusy(true);
    try {
      await api("/auth/profile", { method: "PUT", body: { table_header_logo_base64: "" } });
      await refresh();
      invalidateTableBrandHeader();
    } catch (e: any) { notify("Errore", e?.message || ""); }
    finally { setTableLogoBusy(false); }
  };

  const load = useCallback(async () => setS(await api<Settings>("/settings")), []);
  useEffect(() => { load(); }, [load]);

  // Load user-level settings (assistant name / mode / voice)
  useEffect(() => {
    (async () => {
      try {
        const us = await api<{ assistant_name?: string; assistant_response_mode?: string; assistant_voice?: string }>("/user-settings");
        if (us?.assistant_name) setAssistantName(us.assistant_name);
        if (us?.assistant_response_mode) setAssistantMode(us.assistant_response_mode as any);
        syncTtsModeFromSetting(us?.assistant_response_mode); // V50.z454 — gate TTS globale
        if (us?.assistant_voice) setAssistantVoice(us.assistant_voice);
      } catch {}
    })();
  }, []);

  // Bug 9 — carica dati Master (nome, ruolo, telefono, email, biglietto da visita)
  const loadMaster = useCallback(async () => {
    try {
      const m = await api<MasterInfo>("/master/info");
      setMaster(m);
    } catch {}
  }, []);
  useEffect(() => { loadMaster(); }, [loadMaster]);

  // V45 — Poll pending rule proposals count so the "Insegna ad Axon" link
  // shows a red badge when new suggestions are ready to review.
  useEffect(() => {
    if (user?.parent_user_id || user?.role !== "owner") return;
    let alive = true;
    const fetchCount = async () => {
      try {
        const r = await api<{ pending: number }>("/axon/rule-proposals/count-pending");
        if (alive) setPendingProposals(r.pending || 0);
      } catch { /* silent */ }
    };
    fetchCount();
    const t = setInterval(fetchCount, 30000); // refresh every 30s
    return () => { alive = false; clearInterval(t); };
  }, [user?.parent_user_id, user?.role]);

  const publicCardUrl = useCallback(() => {
    if (!master?.business_card?.card_id) return "";
    const backend = BACKEND_URL || "";
    const slug = master.business_card.slug;
    if (slug) return `${backend}/api/bc/${slug}`;
    return `${backend}/api/master/business-card/public/${master.business_card.card_id}`;
  }, [master]);

  const shareMasterCard = async () => {
    const url = publicCardUrl();
    if (!url) {
      notify("Biglietto non pronto", "Configura prima il biglietto da visita del Master.");
      return;
    }
    const name = master?.name || master?.company_name || "il Master";
    const message = `Biglietto da visita di ${name}\n${url}`;
    try {
      if (Platform.OS === "web" && typeof (globalThis as any).navigator !== "undefined" && !(navigator as any).share) {
        try { await (navigator as any).clipboard?.writeText?.(url); notify("Link copiato", url); } catch {}
        return;
      }
      await Share.share({ message, url });
    } catch {}
  };

  const openPhone = (phone: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`).catch(() => {});
  };
  const openEmail = (email: string) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {});
  };
  const openWebsite = (url: string) => {
    if (!url) return;
    const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    // V50.z108 — WebView interna (mantiene bottom nav).
    openInAppLink(router, u, { title: "Sito web" });
  };

  const saveAssistantMode = async (m: "text" | "voice" | "both") => {
    setAssistantMode(m);
    try {
      syncTtsModeFromSetting(m); // V50.z454 — «Solo testo» → zero audio immediato, prima ancora del salvataggio
      await api("/user-settings", { method: "PUT", body: { assistant_response_mode: m } });
    } catch {}
  };

  const saveAssistantVoice = async (v: string) => {
    setAssistantVoice(v);
    try {
      await api("/user-settings", { method: "PUT", body: { assistant_voice: v } });
    } catch {}
  };

  const saveAssistantName = (name: string) => {
    setAssistantName(name);
    setAssistantNameSaved(false);
    if (assistantSaveTimer.current) clearTimeout(assistantSaveTimer.current);
    assistantSaveTimer.current = setTimeout(async () => {
      const trimmed = (name || "").trim().slice(0, 40) || "Neo";
      try {
        await api("/user-settings", { method: "PUT", body: { assistant_name: trimmed } });
        setAssistantNameSaved(true);
        setTimeout(() => setAssistantNameSaved(false), 1800);
      } catch {}
    }, 600);
  };

  const save = async () => {
    if (!s) return;
    setSaving(true); setOk(false);
    try { await api("/settings", { method: "PUT", body: s }); setOk(true); }
    finally { setSaving(false); setTimeout(() => setOk(false), 2000); }
  };

  if (isConsultant) return <ConsultantSettings />; // V50.z436 — consulente: solo nome Axon, voce, ascolto costante
  if (!s) return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={[styles.header, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
        {sec ? (
          <Pressable onPress={backToHub} hitSlop={10} testID="settings-back" accessibilityLabel="Indietro">
            <Ionicons name="chevron-back" size={24} color={HT.text} />
          </Pressable>
        ) : null}
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{sec ? SECTION_META[sec].title : "Profilo & Impostazioni"}</Text>
      </View>
      <KScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: pagePad, paddingHorizontal: sec === null ? 16 : deskPadX }}>
        {/* V50.z249 — HUB: card Profilo Master (foto, nome, ruolo, azienda) + bottoni raggruppati */}
        {sec === null && (<>
          <DesktopGrid gap={16}>
          <View style={{ gap: 16 }}>
          <View style={styles.card} testID="profile-master-card">
            <View style={styles.profileHead}>
              <Pressable testID="profile-avatar-btn" onPress={changeAvatar} style={styles.avatarWrap} disabled={avatarBusy}>
                {user?.avatar_base64 ? <Image source={{ uri: user.avatar_base64 }} style={styles.avatarImg} /> : <View style={styles.avatar}><Text style={styles.avatarTxt}>{user?.name?.[0]?.toUpperCase()}</Text></View>}
                <View style={styles.avatarBadge}>{avatarBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="camera" size={14} color="#FFF" />}</View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user?.name}</Text>
                <Text style={styles.email}>{user?.email}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Text style={styles.roleBadge}>{isOwner ? "Master · Owner" : "Collaboratore"}</Text>
                  {companyName ? <Text style={{ fontSize: 12, color: HT.muted, marginTop: 6 }} numberOfLines={1}>🏢 {companyName}</Text> : null}
                </View>
              </View>
            </View>
          </View>
          {/* V50.z338 — Aspetto: switcher tema (3 card preview) */}
          <ThemePicker />
          </View>
          <View style={{ gap: 10 }}>
          <SettingsGroupButton section="billing" onPress={() => openSection("billing")} />
            <Pressable onPress={() => router.push("/axon-notifications?tab=prefs" as any)} style={hubStyles.group} testID="settings-group-notifications">
              <View style={[hubStyles.groupIcon, { backgroundColor: "#F59E0B1A" }]}><Ionicons name="notifications" size={22} color="#F59E0B" /></View>
              <View style={{ flex: 1 }}><Text style={hubStyles.groupTitle}>Notifiche e Avvisi</Text><Text style={hubStyles.groupSub}>Push, promemoria, copie team, livelli di urgenza</Text></View>
              <Ionicons name="chevron-forward" size={18} color={HT.muted} />
            </Pressable>
            <SettingsGroupButton section="security" onPress={() => openSection("security")} />
            {isOwner ? <SettingsGroupButton section="branding" onPress={() => openSection("branding")} /> : null}
            <SettingsGroupButton section="integrations" onPress={() => openSection("integrations")} />
            <SettingsGroupButton section="general" onPress={() => openSection("general")} />
            {/* V50.z516 — Rivedi introduzione: riparte dal Tour e dai permessi di Axon (azzerati i flag locali + server) */}
            <Pressable onPress={replayIntro} style={hubStyles.group} testID="settings-group-replay-intro">
              <View style={[hubStyles.groupIcon, { backgroundColor: "#0EA5E91A" }]}><Ionicons name="play-circle" size={22} color="#0EA5E9" /></View>
              <View style={{ flex: 1 }}><Text style={hubStyles.groupTitle}>Rivedi introduzione</Text><Text style={hubStyles.groupSub}>Riparti dall'inizio: tour di benvenuto, voce di Axon e permessi del telefono</Text></View>
              <Ionicons name="chevron-forward" size={18} color={HT.muted} />
            </Pressable>
            {isOwner ? (
              // V50.z260 — Strumenti di sviluppo → Report Stress Test Axon
              <Pressable onPress={() => router.push("/axon-stress-report" as any)} style={hubStyles.group} testID="settings-group-devtools">
                <View style={[hubStyles.groupIcon, { backgroundColor: "#7C3AED1A" }]}><Ionicons name="flask" size={22} color="#7C3AED" /></View>
                <View style={{ flex: 1 }}><Text style={hubStyles.groupTitle}>Strumenti di sviluppo</Text><Text style={hubStyles.groupSub}>Report Stress Test Axon: qualità risposte e deep link</Text></View>
                <Ionicons name="chevron-forward" size={18} color={HT.muted} />
              </Pressable>
            ) : null}
            {isOwner ? <CompressAllCard /> : null}
            {isOwner ? <ResetTestDataCard /> : null}
          </View>
          </DesktopGrid>
          <Text style={{ fontSize: 11, color: HT.muted, textAlign: "center" }}>Le impostazioni dell'assistente AxonOS (nome, voce, tono, header tabelle, memoria, Insegna ad Axon) sono in AxonOS Center.</Text>
        </>)}
        {/* V50.z249 — Sicurezza: PIN/biometria Spazio Personale, blocco app & 2FA, cambio password */}
        {sec === "security" && (<>
          <SettingsLinkRows rows={[
            { label: "PIN e biometria · Spazio Personale", sub: "Cambia PIN, FaceID/impronta, recupero via email", icon: "finger-print", href: "/spazio-personale", testID: "sec-personal-lock" },
            { label: "Blocco app & Autenticazione a due fattori", sub: "Blocco con PIN all'apertura, 2FA, dispositivi", icon: "shield-checkmark", href: "/security", testID: "sec-app-lock" },
            // V50.z293 — registro dispositivi (1 telefono + 1 tablet + 1 PC), team e log accessi per il Master
            { label: "Dispositivi collegati", sub: "1 telefono + 1 tablet + 1 PC per account · team e log accessi (Master)", icon: "phone-portrait", href: "/devices", testID: "sec-devices" },
            { label: "Come proteggiamo i tuoi dati", icon: "shield-half", href: "/security-info", testID: "sec-info" },
          ]} />
          <ChangeEmailCard />
          <ChangePasswordCard />
          {/* V50.z407 — Logout: chiude la sessione sul server (POST /auth/logout) e torna al login */}
          <Pressable onPress={() => logout()} style={[styles.logoutBtn, { marginTop: 4 }]} testID="security-logout">
            <Ionicons name="log-out-outline" size={18} color={HT.danger} /><Text style={styles.logoutTxt}>Esci dall&apos;account</Text>
          </Pressable>
        </>)}
        {/* V50.z249 — Integrazioni */}
        {sec === "integrations" && (
          <SettingsLinkRows rows={[
            { label: "SMTP · invio email", sub: "Server, porta, credenziali per le comunicazioni", icon: "mail", href: "/smtp", testID: "int-smtp" },
            { label: "Account email (IMAP / Outlook)", sub: "Caselle collegate al CRM", icon: "mail-unread", href: "/email-accounts", testID: "int-email" },
            { label: "Google Drive", sub: "Backup e documenti", icon: "logo-google", href: "/google-drive", testID: "int-drive" },
            { label: "Dropbox", icon: "cloud", href: "/dropbox", testID: "int-dropbox" },
            { label: "Outlook", icon: "logo-microsoft", href: "/outlook", testID: "int-outlook" },
            { label: "API & integrazioni AxonOS (Business / Home)", sub: "Home Assistant, servizi esterni", icon: "code-slash", href: "/axon-integrations", testID: "int-api" },
            // V50.z315 — ViolaWake: modulo opzionale wake-word «Viola» → Axon a mani libere
            { label: "Comandi vocali a mani libere «Axon»", sub: "Di’ «Axon» e parla con l’assistente (modulo opzionale per azienda)", icon: "ear", href: "/viola-wake", testID: "int-viola" },
          ]} />
        )}
        {/* V50.z249 — Personalizzazione aziendale: pannello logo/P.IVA/firma + blocchi esistenti (branding PDF, sede, email) */}
        {sec === "branding" && (
          <SettingsLinkRows rows={[{ label: "Logo aziendale, P.IVA e firma documenti", sub: "Logo nell'header per tutta l'organizzazione, ragione sociale, firma PDF", icon: "business", href: "/personalizzazione-aziendale", testID: "brand-org" },
            // V50.z290 — editor del Libretto illustrativo / presentazione AdvisorOS (Master): prima raggiungibile solo dal bottone in fondo al libretto
            { label: "Libretto illustrativo e presentazione AdvisorOS", sub: "Modifica testi, sezioni e mockup del libretto; anteprima e PDF", icon: "book", href: "/libretto-editor", testID: "brand-libretto-editor" },
            { label: "Anteprima libretto (PDF)", sub: "Come lo vedono collaboratori e clienti", icon: "reader", href: "/libretto", testID: "brand-libretto-view" },
          ]} />
        )}
        {/* V50.z249 — Preferenze generali: lingua e tema */}
        {sec === "general" && (
          <View style={styles.card} testID="general-prefs-card">
            <Text style={styles.sectionTitle}>Lingua e tema</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <View style={hubStyles.pill}><Ionicons name="language" size={14} color={HT.brand} /><Text style={hubStyles.pillTxt}>Italiano</Text></View>
              <View style={hubStyles.pill}><Ionicons name="sunny" size={14} color={HT.brand} /><Text style={hubStyles.pillTxt}>Tema chiaro</Text></View>
            </View>
            <Text style={styles.hint}>Altre lingue e il tema scuro arriveranno nei prossimi aggiornamenti.</Text>
          </View>
        )}
        {/* V50.z487 — Permessi del dispositivo (GPS, microfono, fotocamera, rubrica): la voce che Axon indicava come «Impostazioni → Permessi» ora esiste */}
        {sec === "general" && (
          <Pressable onPress={() => router.push({ pathname: "/permessi", params: { standalone: "1" } } as any)} style={styles.card} testID="general-permissions-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="shield-checkmark" size={20} color={HT.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Permessi del dispositivo</Text>
                <Text style={styles.hint}>Posizione (GPS), microfono, fotocamera e rubrica: stato reale e attivazione.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={HT.muted} />
            </View>
          </Pressable>
        )}
        {/* V50.z256 — Rilevamento Visite (GPS) */}
        {sec === "general" && (
          <View style={styles.card} testID="visit-detection-card">
            <VisitDetectionSettings />
          </View>
        )}
        {sec === "billing" && (<>
        {/* V50.z208 — In cima, sempre visibile: piano attivo + versione APK installata (tap → dettagli aggiornamento) */}
        <AppInfoCard />
        {/* V50.z320 — Codice promozionale (settimane/mesi gratis, premium, crediti) + storico */}
        <PromoRedeemCard />
        {/* V50.z322 — Invita un amico: codice personale, condivisione, amici arrivati */}
        <ReferralCard />
        {/* V50.z211 — Configurazione guidata «Set Up and Go» (accesso in qualsiasi momento, anche dopo «Dopo») */}
        <SetupEntryCard />
        <SetupProcessingBadge compact />
        <FutureInterestsAlert />
        </>)}
        {sec === "axon" && (<>
        {/* V50.z192 — Profilo → Memoria AxonOS: cosa sa Axon di me */}
        <AxonMemoryEntryCard />
        {/* V50.z493 — suono dello squillo «Trova il mio telefono» (preset o registrazione) */}
        <FindPhoneSoundCard />
        </>)}
        {/* V50.z249 — vecchia card profilo rimossa: ora nella HUB in cima */}

        {/* V50.z52 — Master card RIMOSSA: già disponibile nell'hub
            "Impostazioni & Configurazioni" del Master (→ Biglietto da visita
            + Anagrafica & DB Master). Evita duplicazione UI. */}

        {sec === "branding" && (<>
        {/* V38H — Additional emails management (used as sender for birthday/comms) */}
        <View style={styles.linkCard}>
          <Ionicons name="mail-open" size={26} color={HT.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Email aggiuntive</Text>
            <Text style={styles.linkSub}>Indirizzi da usare come mittente (auguri, comunicazioni)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {(user?.additional_emails || []).map((em) => (
                <View key={em} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: HT.axonTint, borderWidth: 1, borderColor: HT.axonTint }}>
                  <Text style={{ fontSize: 11, color: HT.brand, fontWeight: "600" }}>{em}</Text>
                  <Pressable
                    testID={`profile-email-del-${em}`}
                    onPress={async () => {
                      const ok = await confirmAsync("Rimuovi email", `Rimuovere "${em}" dagli indirizzi aggiuntivi?`);
                      if (!ok) return;
                      try {
                        setEmailsBusy(true);
                        const next = (user?.additional_emails || []).filter((e) => e !== em);
                        await api("/auth/profile", { method: "PUT", body: { additional_emails: next } });
                        await refresh();
                      } catch (e: any) {
                        notify("Errore", e?.message || "");
                      } finally {
                        setEmailsBusy(false);
                      }
                    }}
                    hitSlop={6}
                  >
                    <Ionicons name="close-circle" size={14} color={HT.brand} />
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
              <TextInput
                testID="profile-email-input"
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="Aggiungi email (es. lavoro@…)"
                placeholderTextColor={HT.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: HT.card2, fontSize: 12, color: HT.text }}
              />
              <Pressable
                testID="profile-email-add"
                disabled={emailsBusy || !emailInput.trim().includes("@")}
                onPress={async () => {
                  const em = emailInput.trim().toLowerCase();
                  if (!em.includes("@")) return;
                  const existing = user?.additional_emails || [];
                  if (existing.includes(em) || user?.email === em) {
                    setEmailInput("");
                    return;
                  }
                  try {
                    setEmailsBusy(true);
                    await api("/auth/profile", { method: "PUT", body: { additional_emails: [...existing, em] } });
                    setEmailInput("");
                    await refresh();
                  } catch (e: any) {
                    notify("Errore", e?.message || "");
                  } finally {
                    setEmailsBusy(false);
                  }
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: HT.brand, opacity: (!emailInput.trim().includes("@") || emailsBusy) ? 0.5 : 1 }}
              >
                {emailsBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>+</Text>}
              </Pressable>
            </View>
          </View>
        </View>

        </>)}
        {/* V50.z52 — Link cards di navigazione RIMOSSI (Team, Script,
            Axon Center, Libretto, Tour, Invita, Gruppi, Sicurezza, Drive,
            Dropbox): tutti presenti nell'hub "Impostazioni & Configurazioni"
            del Master. Qui restano SOLO i form di configurazione. */}

        {sec === "branding" && (<>
        {/* V38I — Branding aziendale for PDF reports (owner only) */}
        {!user?.parent_user_id && (
          <View style={styles.card} testID="branding-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: HT.warningTint, justifyContent: "center", alignItems: "center" }}>
                <Ionicons name="ribbon" size={20} color={HT.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <CatHeader color={HT.text2} label="Amministrazione · Branding" icon="business" />
                <Text style={{ fontSize: 12, color: HT.muted, marginTop: 2 }}>
                  Logo e nome che appaiono sui PDF (report Fatture, confronti offerte)
                </Text>
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Nome agenzia / studio</Text>
            <TextInput
              testID="branding-name-input"
              value={companyName}
              onChangeText={saveCompanyName}
              style={styles.input}
              placeholder="Es. Dal Pastro Consulting"
              placeholderTextColor={HT.muted}
              maxLength={80}
            />
            <Text style={{ fontSize: 11, color: companyNameSaved ? "#16A34A" : HT.muted, marginTop: 4 }}>
              {companyNameSaved ? "✓ Nome agenzia salvato" : "Salvataggio automatico dopo la digitazione."}
            </Text>

            <Text style={[styles.label, { marginTop: 14 }]}>Logo agenzia</Text>
            {/* V38X — Wider aspect ratio + white BG + generous padding so the logo shows completely without cropping. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
              <View
                style={{
                  width: 160,
                  height: 90,
                  borderRadius: 12,
                  backgroundColor: HT.card,
                  borderWidth: 1,
                  borderColor: HT.border,
                  justifyContent: "center",
                  alignItems: "center",
                  overflow: "hidden",
                  padding: 8,
                }}
              >
                {user?.company_logo_base64 ? (
                  <Image
                    source={{ uri: user.company_logo_base64 }}
                    resizeMode="contain"
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : (
                  <Ionicons name="image" size={36} color={HT.muted} />
                )}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Pressable
                  testID="branding-logo-upload"
                  onPress={uploadCompanyLogo}
                  disabled={logoBusy}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: HT.brand, opacity: logoBusy ? 0.5 : 1 }}
                >
                  {logoBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="cloud-upload" size={16} color="#FFF" />}
                  <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>{user?.company_logo_base64 ? "Cambia logo" : "Carica logo"}</Text>
                </Pressable>
                {user?.company_logo_base64 && (
                  <Pressable
                    testID="branding-logo-remove"
                    onPress={removeCompanyLogo}
                    disabled={logoBusy}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8, backgroundColor: HT.dangerTint, borderWidth: 1, borderColor: '#FCA5A5' }}
                  >
                    <Ionicons name="trash" size={14} color="#DC2626" />
                    <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 12 }}>Rimuovi</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <Text style={{ fontSize: 11, color: HT.muted, marginTop: 8, fontStyle: "italic" }}>
              Consigliato: PNG/JPG orizzontale, max 500 KB, sfondo trasparente/bianco.
            </Text>

            {/* V38U — Slogan + Contatti visualizzati come intestazione dei report */}
            <Text style={[styles.label, { marginTop: 14 }]}>Slogan (facoltativo)</Text>
            <TextInput
              testID="branding-slogan-input"
              value={reportSlogan}
              onChangeText={saveReportSlogan}
              style={styles.input}
              placeholder="Es. Consulenza energetica trasparente"
              placeholderTextColor={HT.muted}
              maxLength={140}
            />
            <Text style={[styles.label, { marginTop: 14 }]}>Contatti agenzia (facoltativo)</Text>
            <TextInput
              testID="branding-contacts-input"
              value={reportContacts}
              onChangeText={saveReportContacts}
              style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
              placeholder="Es. Tel. 049 123 456 · info@dalpastro.it · Via Roma 12, Padova"
              placeholderTextColor={HT.muted}
              multiline
              maxLength={240}
            />
            <Text style={{ fontSize: 11, color: HT.muted, marginTop: 6, fontStyle: "italic" }}>
              Slogan e contatti verranno mostrati in cima a ogni report / analisi / comparazione.
            </Text>
          </View>
        )}
        </>)}

        {sec === "axon" && (<>
        {/* V50.z140 — Header tabelle AxonOS (owner only) */}
        {!user?.parent_user_id && (
          <View style={styles.card} testID="table-header-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: HT.violetTint, justifyContent: "center", alignItems: "center" }}>
                <Ionicons name="grid" size={20} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <CatHeader color="#7C3AED" label="AI & Axon · Header tabella" icon="grid" />
                <Text style={{ fontSize: 12, color: HT.muted, marginTop: 2 }}>
                  Logo e nome azienda mostrati in testa a ogni tabella generata da AxonOS ed esportata (PDF / immagine)
                </Text>
              </View>
            </View>

            {/* Anteprima header */}
            <View style={{ marginTop: 14, backgroundColor: HT.card, borderRadius: 10, borderWidth: 1, borderColor: HT.border, borderBottomWidth: 3, borderBottomColor: '#7C3AED', padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }} testID="table-header-preview">
              {user?.table_header_logo_base64 ? (
                <Image source={{ uri: user.table_header_logo_base64 }} resizeMode="contain" style={{ width: 44, height: 32 }} />
              ) : (
                <View style={{ width: 44, height: 32, borderRadius: 6, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="image-outline" size={16} color="#7C3AED" />
                </View>
              )}
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "800", color: HT.text }} numberOfLines={1}>
                {tableHdrName || user?.company_name || "Nome azienda"}
              </Text>
              <Text style={{ fontSize: 10, color: HT.muted }}>Tabella AxonOS</Text>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Nome azienda</Text>
            <TextInput
              testID="table-header-name-input"
              value={tableHdrName}
              onChangeText={saveTableHdrName}
              style={styles.input}
              placeholder="Es. Dal Pastro Energie"
              placeholderTextColor={HT.muted}
              maxLength={80}
            />
            <Text style={{ fontSize: 11, color: tableHdrSaved ? "#16A34A" : HT.muted, marginTop: 4 }}>
              {tableHdrSaved ? "✓ Nome salvato" : "Salvataggio automatico dopo la digitazione."}
            </Text>

            <Text style={[styles.label, { marginTop: 14 }]}>Logo aziendale</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
              <View style={{ width: 160, height: 90, borderRadius: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, justifyContent: "center", alignItems: "center", overflow: "hidden", padding: 8 }}>
                {user?.table_header_logo_base64 ? (
                  <Image source={{ uri: user.table_header_logo_base64 }} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
                ) : (
                  <Ionicons name="image" size={36} color={HT.muted} />
                )}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Pressable
                  testID="table-header-logo-upload"
                  onPress={uploadTableLogo}
                  disabled={tableLogoBusy}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: '#7C3AED', opacity: tableLogoBusy ? 0.5 : 1 }}
                >
                  {tableLogoBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="cloud-upload" size={16} color="#FFF" />}
                  <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 12 }}>{user?.table_header_logo_base64 ? "Cambia logo" : "Carica logo"}</Text>
                </Pressable>
                {user?.table_header_logo_base64 && (
                  <Pressable
                    testID="table-header-logo-remove"
                    onPress={removeTableLogo}
                    disabled={tableLogoBusy}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8, backgroundColor: HT.dangerTint, borderWidth: 1, borderColor: '#FCA5A5' }}
                  >
                    <Ionicons name="trash" size={14} color="#DC2626" />
                    <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 12 }}>Rimuovi</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <Text style={{ fontSize: 11, color: HT.muted, marginTop: 8, fontStyle: "italic" }}>
              Se lasci vuoti nome e logo, le tabelle useranno il Branding aziendale qui sopra. Vale anche per le tabelle viste dai collaboratori.
            </Text>
          </View>
        )}
        </>)}

        {sec === "axon" && (<>
        {/* V50.z456 — Personalizza Axon: personalità + stile (si nasconde da sola se non consentita) */}
        <AxonPersonalizeCard />
        {/* V50.z325 — Avviso soglia PUN (media parziale del mese) */}
        <PunAlertCard />
        {/* AI Assistant customization — available to all users */}
        <View style={styles.card} testID="assistant-name-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: HT.violetTint, justifyContent: "center", alignItems: "center" }}>
              <Ionicons name="sparkles" size={20} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <CatHeader color="#7C3AED" label="AI & Axon · Assistente" icon="sparkles" />
              <Text style={{ fontSize: 12, color: HT.muted, marginTop: 2 }}>
                Personalizza il nome del tuo assistente personale
              </Text>
            </View>
          </View>
          {/* V50.z181 — Preferenze notifiche push AxonOS */}
          <Pressable testID="open-axon-notifications-prefs" onPress={() => router.push("/axon-notifications?tab=prefs" as any)} style={[dashLinkStyles.row, { marginTop: 10 }]}>
            <View style={dashLinkStyles.iconBox}>
              <Ionicons name="notifications" size={16} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dashLinkStyles.title}>Notifiche push AxonOS</Text>
              <Text style={dashLinkStyles.sub}>Sessioni Gym, richiamate urgenti, crediti, report, messaggi critici</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
          {/* V50.z228 — Le mie aree: mini-wizard per area, stato «Configurazione incompleta», aree personalizzate */}
          <Pressable testID="open-le-mie-aree" onPress={() => router.push("/le-mie-aree" as any)} style={[dashLinkStyles.row, { marginTop: 10 }]}>
            <View style={dashLinkStyles.iconBox}>
              <Ionicons name="flash" size={16} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dashLinkStyles.title}>Le mie aree</Text>
              <Text style={dashLinkStyles.sub}>Attiva e configura le aree di AxonOS: carica un documento e lui legge i dati. Aree personalizzate e scadenze</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
          {/* V50.z197 — Blocco 8: Integrazioni AxonOS a due sfere (Business / Home) */}
          <Pressable testID="open-axon-integrations" onPress={() => router.push("/axon-integrations" as any)} style={[dashLinkStyles.row, { marginTop: 10 }]}>
            <View style={dashLinkStyles.iconBox}>
              <Ionicons name="link" size={16} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dashLinkStyles.title}>Integrazioni AxonOS</Text>
              <Text style={dashLinkStyles.sub}>🔵 Business · 🟢 Home — Google Calendar, Contatti, Drive, Dropbox, Domotica: un tap</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>
          <Text style={[styles.label, { marginTop: 12 }]}>Nome dell&apos;assistente</Text>
          <TextInput
            testID="assistant-name-input"
            value={assistantName}
            onChangeText={saveAssistantName}
            style={styles.input}
            placeholder="Neo"
            placeholderTextColor={HT.muted}
            maxLength={40}
          />
          <Text style={{ fontSize: 11, color: assistantNameSaved ? "#16A34A" : HT.muted, marginTop: 4 }}>
            {assistantNameSaved ? "✓ Salvato" : `Tocca il pulsante viola con il robot in basso a destra per chattare con ${assistantName || "Neo"}.`}
          </Text>

          {/* Response mode picker */}
          <Text style={[styles.label, { marginTop: 14 }]}>Modalità di risposta</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            {([
              { key: "text", label: "Solo testo", icon: "chatbox-ellipses" },
              { key: "voice", label: "Solo voce", icon: "volume-high" },
              { key: "both", label: "Voce e testo", icon: "megaphone" },
            ] as const).map((opt) => {
              const active = assistantMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  testID={`assistant-mode-${opt.key}`}
                  onPress={() => saveAssistantMode(opt.key)}
                  style={[
                    { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", borderWidth: 1 },
                    active
                      ? { backgroundColor: HT.violetTint, borderColor: '#7C3AED' }
                      : { backgroundColor: HT.card2, borderColor: HT.border },
                  ]}
                >
                  <Ionicons name={opt.icon as any} size={18} color={active ? "#7C3AED" : HT.muted} />
                  <Text style={{ fontSize: 11, marginTop: 4, color: active ? "#7C3AED" : HT.text, fontWeight: active ? "700" : "500", textAlign: "center" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* V50.z218 — Blocco 6: tono di AxonOS (1 Istituzionale … 5 Fantasiosa) */}
          <AxonToneLevelPicker />

          {/* V50.z414 — Motore vocale (sempre visibile, anche in modalità testo: serve al replay/lettura delle risposte) */}
          <TtsEngineCard />
          {/* V50.z419 — Livello di iniziativa (collaboratore): 1 colore pallino · 2 riga in chat · 3 inizia lui */}
          <AxonInitiativeCard />

          {(assistantMode === "voice" || assistantMode === "both") && (
            <>
              <Text style={[styles.label, { marginTop: 14 }]}>Voce dell&apos;assistente</Text>
              {/* V50.z271 — pagina dedicata con anteprima voci + lingua delle risposte */}
              <Pressable onPress={() => router.push("/axon-voice" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, marginBottom: 4 }} testID="settings-axon-voice-link">
                <Ionicons name="volume-high-outline" size={16} color={HT.brand} />
                <Text style={{ color: HT.brand, fontWeight: "800", fontSize: 13 }}>Tutte le voci con anteprima e lingua delle risposte ›</Text>
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {[
                  { key: "sara", label: "Sara (F, locale gratis)" },
                  { key: "nicola", label: "Nicola (M, locale gratis)" },
                  { key: "nova", label: "Nova (F, chiara)" },
                  { key: "shimmer", label: "Shimmer (F, calda)" },
                  { key: "alloy", label: "Alloy (neutra)" },
                  { key: "onyx", label: "Onyx (M, grave)" },
                  { key: "echo", label: "Echo (M, morbida)" },
                  { key: "fable", label: "Fable (narrativa)" },
                ].map((v) => {
                  const active = assistantVoice === v.key;
                  return (
                    <Pressable
                      key={v.key}
                      testID={`assistant-voice-${v.key}`}
                      onPress={() => saveAssistantVoice(v.key)}
                      style={[
                        { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1 },
                        active
                          ? { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }
                          : { backgroundColor: HT.card2, borderColor: HT.border },
                      ]}
                    >
                      <Text style={{ fontSize: 12, color: active ? "#FFF" : HT.text, fontWeight: "600" }}>
                        {v.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        </>)}
        {/* V50.z52 — SMTP link RIMOSSO: presente nell'hub Master → Comunicazioni. */}

        {/* V50.z16 — Neo Memory rimosso: ora dentro Axon Center (💾 Memoria Assistente) */}

        {sec === "branding" && (<>
        {!user?.parent_user_id && (
        <View style={styles.card}>
          {/* Sezioni "Script telefonata (widget floating)" e "Messaggio WhatsApp Chiedi Referenze"
              RIMOSSE su richiesta: lo Script resta configurabile dall'hub Master → "Script Telefonata". */}
          <CatHeader color="#F97316" label="Sede · Indirizzo ufficio" icon="business" />
          <Text style={styles.label}>Indirizzo ufficio</Text>
          <TextInput
            testID="settings-office-address"
            value={s.office_address || ""}
            onChangeText={(t) => setS({ ...s, office_address: t })}
            style={styles.input}
            placeholder="es. Corso Italia 42, Milano MI"
            placeholderTextColor={HT.muted}
            autoCapitalize="words"
          />
          <Text style={{ fontSize: 11, color: HT.muted, marginTop: 4 }}>
            Origine di default per il calcolo delle distanze mostrate nelle schede cliente. Ogni agente può sovrascriverlo temporaneamente dalla scheda.
          </Text>
        </View>
        )}
        </>)}

        {sec === "general" && (<>
        {/* V50.z505 — Personalizza la Home (solo Super Master: la card si nasconde da sola se allowed=false) */}
        <HomeLayoutCard />
        {!user?.parent_user_id && (
        <View style={styles.card}>
          <CatHeader color="#0EA5E9" label="CRM · Personalizza aree" icon="briefcase" />

          {/* V50.z81 — Link a "Personalizza Home" (widget dashboard configurabili) */}
          <Pressable
            testID="open-dashboard-config"
            onPress={() => router.push("/dashboard-config" as any)}
            style={dashLinkStyles.row}
          >
            <View style={dashLinkStyles.iconBox}>
              <Ionicons name="grid" size={16} color={HT.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dashLinkStyles.title}>Personalizza Home</Text>
              <Text style={dashLinkStyles.sub}>Widget dashboard: mostra/nascondi e riordina</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HT.muted} />
          </Pressable>

          <Text style={styles.label}>Nome App</Text>
          <TextInput
            testID="settings-app-name"
            value={s.app_name || "Dal Pastro CRM"}
            onChangeText={(t) => setS({ ...s, app_name: t })}
            style={styles.input}
            placeholder="Nome della tua app"
            placeholderTextColor={HT.muted}
          />

          <Pressable testID="settings-save" onPress={save} style={[styles.saveBtn, { marginTop: 10 }]} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>{ok ? "Salvato ✓" : "Salva nome app"}</Text>}
          </Pressable>
        </View>
        )}
        </>)}

        {/* V50.z113 — CRM · Aree: albero Area > Sottocategoria (card collassabili, colore a scomparsa,
            descrizione uso, permessi, Archivia/Elimina, Nuova area). Le modifiche salvano subito. */}
        {sec === "general" && (<>
        {!user?.parent_user_id && (
        <View style={styles.card}>
          <CatHeader color="#0EA5E9" label="CRM · Aree" icon="git-branch" />
          <AreasManager
            settings={s as any}
            onSave={(next) => persistAndReload({ ...s, ...(next as any) })}
            onReset={async () => {
              try {
                const r = await api<Settings>("/settings/areas/reset", { method: "POST" });
                setS(r);
                notify("Aree azzerate", "Riparti da zero: Energia e Network sono pronte.");
              } catch (e: any) { notify("Errore", e?.message || "Impossibile azzerare"); }
            }}
          />
        </View>
        )}
        </>)}

        {sec === "general" && (<>
        {!user?.parent_user_id && (
        <View style={styles.card}>
          <CatHeader color="#0EA5E9" label="CRM · Aree merceologiche & Appuntamenti" icon="calendar" />
          <Text style={styles.hint}>Modifica e crea nuove aree merceologiche degli appuntamenti (Piano Marketing / Energia / Ant / Dare seguito / Demo prodotti sono predefinite). Puoi eliminarle toccandole.</Text>
          <View style={styles.addRow}>
            <TextInput
              testID="apt-type-input"
              value={aptTypeInput}
              onChangeText={setAptTypeInput}
              placeholder="Es. Aggiornamento cliente"
              placeholderTextColor={HT.muted}
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={() => addAptType()}
            />
            <Pressable testID="apt-type-add" onPress={addAptType} style={styles.addBtn}>
              <Ionicons name="add" size={20} color="#FFF" />
            </Pressable>
          </View>
          {(s.custom_appointment_types || []).length > 0 && (
            <View style={styles.chipsWrap}>
              {(s.custom_appointment_types || []).map((t) => (
                <Pressable key={t} onPress={() => removeAptType(t)} style={styles.chip}>
                  <Text style={styles.chipTxt}>{t}</Text>
                  <Ionicons name="close" size={12} color={HT.brand} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
        )}
        </>)}

        {sec === "general" && (<>
        {!user?.parent_user_id && (
        <View style={styles.card}>
          <CatHeader color="#10B981" label="Anagrafica & DB · Categorie prodotti" icon="id-card" />
          <Text style={styles.hint}>Categorie oltre a &quot;Demo prodotti&quot; (Artistry / Nutrilite / Home). Aggiungi la categoria, poi le sotto-categorie</Text>
          <View style={styles.addRow}>
            <TextInput
              testID="prod-cat-input"
              value={prodCatInput}
              onChangeText={setProdCatInput}
              placeholder="Nome categoria (es. Alta cosmesi)"
              placeholderTextColor={HT.muted}
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable testID="prod-cat-add" onPress={addProdCat} style={styles.addBtn}>
              <Ionicons name="add" size={20} color="#FFF" />
            </Pressable>
          </View>
          {(s.custom_product_categories || []).map((cat, idx) => (
            <View key={cat.name} style={styles.catCard}>
              <View style={styles.catHead}>
                <Text style={styles.catName}>{cat.name}</Text>
                <Pressable onPress={() => removeProdCat(idx)}><Ionicons name="trash-outline" size={16} color={HT.danger} /></Pressable>
              </View>
              <View style={styles.addRow}>
                <TextInput
                  value={subInputs[idx] || ""}
                  onChangeText={(t) => setSubInputs({ ...subInputs, [idx]: t })}
                  placeholder="Aggiungi sotto-categoria"
                  placeholderTextColor={HT.muted}
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable onPress={() => addSub(idx)} style={styles.addBtn}>
                  <Ionicons name="add" size={18} color="#FFF" />
                </Pressable>
              </View>
              <View style={styles.chipsWrap}>
                {(cat.subs || []).map((sub) => (
                  <Pressable key={sub} onPress={() => removeSub(idx, sub)} style={styles.chip}>
                    <Text style={styles.chipTxt}>{sub}</Text>
                    <Ionicons name="close" size={12} color={HT.brand} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
        )}
        </>)}

        {/* V50.z52 — Logout RIMOSSO: presente nell'hub Master (in fondo). */}
      </KScrollView>
    </SafeAreaView>
  );
}


// V45 — Red badge for the "Insegna ad Axon" link when there are pending suggestions.
const imp45Styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -5,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    borderWidth: 2,
    borderColor: HT.card,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "800", letterSpacing: -0.3 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.card2 },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: HT.text },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, padding: 16, borderWidth: 1, borderColor: HT.border },
  profileHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: HT.brandTint, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  // V29.bc — Stile Optima
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: HT.brand,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: HT.card,
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  avatarTxt: { color: HT.brand, fontWeight: "700", fontSize: 20 },
  name: { fontSize: 16, fontWeight: "700", color: HT.text },
  email: { fontSize: 13, color: HT.muted, marginTop: 2 },
  roleBadge: { alignSelf: "flex-start", marginTop: 6, backgroundColor: HT.brandTint, color: HT.brand, fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, overflow: "hidden" },
  linkCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border },
  linkTitle: { fontSize: 15, fontWeight: "700", color: HT.text },
  linkSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: HT.text, marginBottom: 12 },
  label: { fontSize: 12, color: HT.text2, fontWeight: "600", marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: HT.card2, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: HT.border, color: HT.text },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: HT.text },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  hexPreview: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: HT.border },
  saveBtn: { backgroundColor: HT.brand, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center", marginTop: 16 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.card, padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border },
  logoutTxt: { color: HT.danger, fontWeight: "700" },
  hint: { fontSize: 11, color: HT.muted, marginBottom: 8, fontStyle: "italic" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  addBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HT.brandTint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  chipTxt: { color: HT.brand, fontWeight: "700", fontSize: 12 },
  catCard: { backgroundColor: HT.card2, borderRadius: theme.radius.md, padding: 10, borderWidth: 1, borderColor: HT.border, marginTop: 10 },
  catHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  catName: { fontSize: 14, fontWeight: "700", color: HT.text },
  // Bug 9 — Dati Master & Biglietto da Visita
  masterCard: {
    backgroundColor: HT.card,
    borderRadius: theme.radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: HT.border,
    shadowColor: HT.text,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  masterHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  masterAvatarWrap: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", borderWidth: 2, borderColor: HT.card, backgroundColor: HT.brandTint },
  masterAvatar: { width: 56, height: 56, borderRadius: 28 },
  masterName: { fontSize: 17, fontWeight: "800", color: HT.text, flexShrink: 1 },
  masterBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: '#F59E0B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  masterBadgeTxt: { color: "#FFF", fontWeight: "800", fontSize: 10, letterSpacing: 0.3 },
  masterTitle: { fontSize: 13, color: HT.brand, fontWeight: "700", marginTop: 2 },
  masterCompany: { fontSize: 12, color: HT.text2, marginTop: 1 },
  masterTagline: { fontSize: 12, color: HT.muted, fontStyle: "italic", marginTop: 4 },
  masterDivider: { height: 1, backgroundColor: HT.border, marginVertical: 12 },
  masterRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  masterIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  masterRowLabel: { fontSize: 11, color: HT.muted, fontWeight: "600" },
  masterRowValue: { fontSize: 14, color: HT.text, fontWeight: "600", marginTop: 1 },
  masterEmpty: { fontSize: 12, color: HT.muted, fontStyle: "italic", paddingVertical: 4 },
  masterActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  masterBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: theme.radius.md },
  masterBtnPrimary: { backgroundColor: HT.brand },
  masterBtnPrimaryTxt: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  masterBtnGhost: { backgroundColor: HT.brandTint, borderWidth: 1, borderColor: HT.border },
  masterBtnGhostTxt: { color: HT.brand, fontWeight: "700", fontSize: 13 },
});

// V50.z81 — Stili link "Personalizza Home"
const dashLinkStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card2 },
  iconBox: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: HT.brand + "22" },
  title: { fontSize: 14, fontWeight: "800", color: HT.text },
  sub: { fontSize: 11, color: HT.muted, marginTop: 2 },
});

// V50.z249 — stili hub locali (bottone gruppo Notifiche + pill preferenze)
const hubStyles = StyleSheet.create({
  group: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card2, borderRadius: 16, padding: 14, minHeight: 64, borderWidth: 1, borderColor: HT.border },
  groupIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  groupTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  groupSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 999, backgroundColor: HT.brandTint },
  pillTxt: { fontSize: 13, fontWeight: "700", color: HT.brand },
});

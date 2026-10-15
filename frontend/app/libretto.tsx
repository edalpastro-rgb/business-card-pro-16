/**
 * V50.l — Libretto Informativo AdvisorOS + AxonOS
 *
 * Schermata full-page con guida operativa completa dell'app.
 * Include pulsante di export PDF (expo-print + expo-sharing) con logo brand.
 */
import { fetchOrgSignature } from "@/src/BrandHeaderImage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notify } from "@/src/utils/notify";
import { LIBRETTO_SECTIONS, LIBRETTO_META, LibrettoSection, LibrettoMeta, LIBRETTO_IMAGE_MAP, resolveSectionImage, withCorporateGymSection } from "@/src/libretto/libretto-content";
import { withExtraSections } from "@/src/libretto/libretto-extra"; // V50.z469 — Feature 12: nuove sezioni + FAQ
import { getAppVersion, getAppLastUpdateDate, buildVersionBadge } from "@/src/libretto/appVersion";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

import { WowIntro } from "@/src/WowIntro";
import { BrainPlus, brainPlusHtml, BRAIN_PLUS_SECTION_IDS } from "@/src/BrainPlus"; // V50.z190 — claim AxonOS Brain+
import { BrandLogosBlock, tuttunizzatoreHtml } from "@/src/Tuttunizzatore"; // V50.z191 — loghi impilati (solo sezione di chiusura e PDF)
import { LP } from "@/src/landing/palette"; // V50.z527 — cover e pulsanti header allineati alla landing
import { TourStories } from "@/src/TourStories"; // V50.z244 — Tour Guidato: 4 storie utente al posto delle slide funzionalità
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
const ADVISOR_LOGO = require("@/assets/images/advisoros-logo-transparent.png");
const AXON_LOGO = require("@/assets/images/axonos-logo-white.png"); // V50.z352 — grafica nuova (bianco su navy)
const ADVISOR_ICON = require("@/assets/images/advisoros-icon-1024.png");

/** Legge un asset locale come base64 per embedderlo nell'HTML del PDF. */
async function assetToBase64(mod: number): Promise<string> {
  try {
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    if (!uri) return "";
    // Su web l'URI è già HTTP, expo-file-system non serve
    if (Platform.OS === "web") {
      try {
        const resp = await fetch(uri);
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const r = String(reader.result || "");
            const i = r.indexOf("base64,");
            resolve(i >= 0 ? r.slice(i + 7) : "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch { return ""; }
    }
    return await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
  } catch {
    return "";
  }
}

function buildPdfHtml(logoAdvisorB64: string, logoAxonB64: string, sectionImages: Record<string, string>, sections: LibrettoSection[], meta: LibrettoMeta, orgSig = ""): string {
  const dataUri = (b64: string) => (b64 ? `data:image/png;base64,${b64}` : "");
  const jpgUri = (b64: string) => (b64 ? `data:image/jpeg;base64,${b64}` : "");
  const cover = `
    <div class="cover">
      <div class="cover-logos">
        ${logoAdvisorB64 ? `<img class="cover-logo" src="${dataUri(logoAdvisorB64)}" />` : ""}
        ${logoAxonB64 ? `<img class="cover-logo-axon" src="${dataUri(logoAxonB64)}" />` : ""}
        ${tuttunizzatoreHtml({ dark: true, size: 18 })}
      </div>
      <div class="cover-title">${meta.title}</div>
      ${brainPlusHtml({ dark: true, size: 26, tagline: true, align: "center" })}
      <div class="cover-sub">${meta.subtitle}</div>
      <div class="cover-version">${meta.version}</div>
      <div class="cover-footer">${meta.footer}${orgSig ? `<br/><span class="org-sig">${orgSig}</span>` : ""}</div>
    </div>
  `;

  const toc = `
    <div class="toc page-break">
      <h2>Indice</h2>
      <ol>
        ${sections.map((s) => `<li><span class="toc-em">${s.emoji}</span> ${s.title}</li>`).join("")}
      </ol>
    </div>
  `;

  const sectionsHtml = sections.map((s) => {
    const faqs = s.faqs?.length ? `<div class="faqs"><b>❓ Domande frequenti</b>${s.faqs.map((f) => `<p><b>${f.q}</b><br/>${f.a}</p>`).join("")}</div>` : ""; // V50.z469
    const tips = s.tips
      ? `<ul class="tips">${s.tips.map((t) => `<li><span class="tip-em">${t.emoji}</span> ${t.text}</li>`).join("")}</ul>${faqs}`
      : faqs;
    // Priorità: data URL uploaded > base64 dell'asset bundled (risolto dal chiamante)
    let imgHtml = "";
    if (s.image_data_url && s.image_data_url.startsWith("data:")) {
      imgHtml = `<div class="screenshot"><img src="${s.image_data_url}" alt="${escapeHtml(s.title)}" /></div>`;
    } else {
      const imgB64 = sectionImages[s.id];
      if (imgB64) {
        imgHtml = `<div class="screenshot"><img src="${jpgUri(imgB64)}" alt="${escapeHtml(s.title)}" /></div>`;
      }
    }
    const mockup = s.mockup
      ? `<div class="mockup">
           <div class="mockup-title">${s.mockup.title}</div>
           <pre class="mockup-body">${s.mockup.lines.map((l) => escapeHtml(l)).join("\n")}</pre>
         </div>`
      : "";
    const warning = s.warning ? `<div class="warning">⚠️ ${s.warning}</div>` : "";
    const highlight = s.highlight ? `<div class="highlight" style="background:${s.color}">${escapeHtml(s.highlight)}</div>` : "";
    const bullets = s.bullets?.length ? `<ul class="bullets">${s.bullets.map((b) => `<li><span class="bdot" style="background:${s.color}"></span>${escapeHtml(b.text)}</li>`).join("")}</ul>` : "";
    return `
      <section class="sec page-break" style="border-left-color:${s.color}">
        <div class="sec-header" style="background:${s.color}">
          <span class="sec-emoji">${s.emoji}</span>
          <div class="sec-titles">
            <div class="sec-title">${s.title}</div>
            ${s.subtitle ? `<div class="sec-sub">${s.subtitle}</div>` : ""}
          </div>
        </div>
        <div class="sec-body">
          ${BRAIN_PLUS_SECTION_IDS.has(s.id) ? brainPlusHtml({ dark: false, size: 20, tagline: s.id === "intro" || s.id === "chiusura" }) : ""}
          ${highlight}
          ${s.paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("")}
          ${bullets}
          ${imgHtml}
          ${mockup}
          ${tips}
          ${warning}
          ${s.id === "chiusura" ? `<div class="brand-close">${logoAdvisorB64 ? `<img class="cover-logo" src="${dataUri(logoAdvisorB64)}" />` : ""}${logoAxonB64 ? `<img class="cover-logo-axon" src="${dataUri(logoAxonB64)}" />` : ""}${tuttunizzatoreHtml({ dark: true, size: 16 })}</div>` : ""}
        </div>
      </section>
    `;
  }).join("");

  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"/>
<title>${meta.title}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, sans-serif; color: #0F172A; }
  .page-break { page-break-before: always; }
  .cover {
    width: 100%; min-height: 100vh; padding: 60px 40px;
    background: linear-gradient(160deg, #0F2438 0%, #1C4869 55%, #0F2438 100%);
    color: #FFF; display: flex; flex-direction: column; justify-content: center; align-items: center;
  }
  .cover-logos { display: flex; flex-direction: column; gap: 10px; align-items: center; margin-bottom: 40px; }
  .cover-logo { max-height: 96px; max-width: 240px; object-fit: contain; }
  .cover-logo-axon { max-height: 58px; max-width: 144px; object-fit: contain; }
  .brand-close { display: flex; flex-direction: column; align-items: center; gap: 8px; background: #0F2438; border-radius: 14px; padding: 22px 16px; margin-top: 14px; }
  .brand-close .cover-logo { max-height: 70px; max-width: 200px; }
  .brand-close .cover-logo-axon { max-height: 42px; max-width: 120px; }
  .cover-title { font-size: 46px; font-weight: 900; letter-spacing: -1px; text-align: center; margin-bottom: 12px; }
  .cover-sub { font-size: 18px; opacity: 0.85; text-align: center; margin-bottom: 40px; }
  .cover-version { font-size: 13px; color: #FBBF24; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .cover-footer { position: absolute; bottom: 40px; font-size: 11px; opacity: 0.6; }
  .org-sig { display: inline-block; margin-top: 6px; font-size: 10.5px; opacity: 0.95; font-style: italic; } /* V50.z233 — firma aziendale (Personalizzazione Aziendale) */
  .org-sig-end { margin-top: 28px; padding-top: 10px; border-top: 1px solid #E2E8F0; color: #64748B; font-size: 10.5px; font-style: italic; text-align: center; }
  .toc { padding: 40px; }
  .toc h2 { font-size: 30px; color: #1C4869; margin-bottom: 20px; }
  .toc ol { padding-left: 22px; line-height: 2; font-size: 14px; }
  .toc-em { display: inline-block; width: 24px; }
  .sec { border-left: 6px solid #1C4869; margin: 0; }
  .sec-header { padding: 22px 30px; color: #FFF; display: flex; align-items: center; gap: 16px; }
  .sec-emoji { font-size: 40px; line-height: 1; }
  .sec-title { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; }
  .sec-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
  .sec-body { padding: 22px 34px 30px; font-size: 13.5px; line-height: 1.65; }
  .sec-body p { margin: 0 0 12px 0; }
  .mockup { background: #0F172A; color: #E2E8F0; border-radius: 10px; padding: 14px 18px; margin: 14px 0; }
  .mockup-title { color: #FBBF24; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  .mockup-body { font-family: "Menlo", "Consolas", monospace; font-size: 12px; margin: 0; white-space: pre-wrap; }
  .screenshot { text-align: center; margin: 16px 0; }
  .screenshot img { max-width: 55%; max-height: 380px; border-radius: 12px; box-shadow: 0 6px 20px rgba(15,23,42,0.15); border: 1px solid #E2E8F0; }
  .highlight { color: #fff; font-weight: 800; font-size: 15px; line-height: 1.45; border-radius: 12px; padding: 14px 16px; margin: 0 0 12px; }
  .bullets { list-style: none; padding: 0; margin: 10px 0 0; }
  .bullets li { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 13px; font-weight: 700; border-bottom: 1px solid #EEF2F7; }
  .bdot { width: 12px; height: 12px; border-radius: 4px; display: inline-block; flex: 0 0 12px; }
  .tips { list-style: none; padding: 0; margin: 14px 0 0; }
  .faqs { margin-top: 12px; padding: 10px 12px; background: #F1F5F9; border-radius: 8px; font-size: 12px; } .faqs p { margin: 6px 0 0; }
  .tips li { padding: 8px 12px; margin-bottom: 6px; background: #FEF3C7; border-radius: 8px; font-size: 12.5px; }
  .tip-em { display: inline-block; width: 22px; }
  .warning { margin-top: 14px; padding: 12px 16px; background: #FEF2F2; border-left: 4px solid #DC2626; color: #7F1D1D; font-size: 12.5px; border-radius: 4px; }
</style></head><body>
${cover}
${toc}
${sectionsHtml}
${orgSig ? `<div class="org-sig-end">${orgSig}</div>` : ""}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LIBRETTO_SEEN_KEY = "libretto_seen_v1";

export default function LibrettoScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ onboarding?: string; section?: string; q?: string }>();
  const isOnboarding = params.onboarding === "1";
  // V50.z469 — Feature 12: ricerca in tempo reale, indice cliccabile, deep link ?section=<id> (usato anche da Axon: [[NAV:/libretto?section=…]])
  const [query, setQuery] = useState<string>(typeof params.q === "string" ? params.q : "");
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});
  const pendingSection = useRef<string | null>(typeof params.section === "string" ? params.section : null);
  const scrollToSection = useCallback((id: string) => {
    const y = sectionY.current[id];
    if (typeof y === "number") { scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }); return true; }
    return false;
  }, []);
  useEffect(() => { if (typeof params.section === "string" && params.section) { pendingSection.current = params.section; setQuery(""); setTimeout(() => { if (scrollToSection(params.section as string)) pendingSection.current = null; }, 350); } }, [params.section, scrollToSection]);
  const [exporting, setExporting] = useState(false);
  // V50.n — usa insets nativi per la sticky bar
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  const bottomInset = Math.max(insets.bottom, 12);

  // V50.v — Contenuto remoto (editabile dal Super Master) con fallback statico
  const [sections, setSections] = useState<LibrettoSection[]>(() => withExtraSections(LIBRETTO_SECTIONS));
  const [meta, setMeta] = useState<LibrettoMeta>(LIBRETTO_META);
  const [canEdit, setCanEdit] = useState(false);
  // V50.z179 — badge versione dinamico: versione reale dell'app + data ultimo aggiornamento (build)
  const [versionBadge, setVersionBadge] = useState<string>(() => buildVersionBadge(getAppVersion(), null, LIBRETTO_META.version));
  useEffect(() => {
    getAppLastUpdateDate().then((d) => setVersionBadge(buildVersionBadge(getAppVersion(), d, LIBRETTO_META.version)));
  }, []);

  useEffect(() => {
    (async () => {
      // Verifica se l'utente è il Super Master per mostrare il pulsante "Modifica"
      try {
        const me = await api<any>("/auth/me");
        const isOwner = (me?.role || "member") === "owner";
        // Prova a fare un PUT dry-check? Meglio esporre l'informazione dal backend
        // via un piccolo endpoint. Per semplicità qui: mostriamo il bottone solo
        // se l'utente è owner; il backend rifiuta se non è il Super Master.
        // Aggiungiamo un check attraverso /libretto/permission (usa API già disponibile).
        try {
          const perm = await api<any>("/libretto/permission");
          setCanEdit(!!perm?.can_edit);
        } catch {
          setCanEdit(isOwner);
        }
      } catch { /* silent */ }
      // Carica contenuto libretto dal backend, se presente
      try {
        const r = await api<any>("/libretto/content");
        if (r && !r.is_default && Array.isArray(r.sections) && r.sections.length > 0) {
          setSections(withExtraSections(withCorporateGymSection(r.sections as LibrettoSection[])));
          if (r.meta) setMeta(r.meta as LibrettoMeta);
        }
      } catch { /* fallback statico */ }
    })();
  }, []);

  // V50.z133 — Il tour deve comparire UNA sola volta per dispositivo: appena
  // viene mostrato in modalità onboarding marchiamo il device (chiave locale
  // per-utente), così anche se l'utente esce con back/tab bar senza premere
  // "Ho capito"/"Salta" non ricompare a ogni riapertura. Il flag server
  // `onboarding_done` resta impostato solo da conclusione/salto (sotto).
  useEffect(() => {
    if (!isOnboarding || !user?.user_id) return;
    AsyncStorage.setItem(`onboarding_done_${user.user_id}`, "1").catch(() => {});
  }, [isOnboarding, user?.user_id]);

  // V50.z136 — Intro animata offline all'inizio del tour (sostituisce il video tutorial YouTube).
  const [introVisible, setIntroVisible] = useState(isOnboarding);
  useEffect(() => { if (isOnboarding) setIntroVisible(true); }, [isOnboarding]);

  // V50.z111 — Il tour è "fatto" SOLO quando l'utente lo conclude o lo salta:
  // flag per-utente lato server (user-settings.onboarding_done) + cache locale.
  const dismissOnboarding = useCallback(async () => {
    try { await AsyncStorage.setItem(LIBRETTO_SEEN_KEY, "1"); } catch { /* noop */ }
    if (user?.user_id) {
      try { await AsyncStorage.setItem(`onboarding_done_${user.user_id}`, "1"); } catch { /* noop */ }
    }
    api("/user-settings", { method: "PUT", body: { onboarding_done: true } }).catch(() => {});
    // V50.z211 — dopo il Tour (concluso o saltato): schermata permessi → popup «Set Up and Go»
    router.replace("/permessi" as any);
  }, [router, user?.user_id]);

  const norm = (t: string) => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const visibleSections = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return sections;
    const toks = q.split(/\s+/).filter(Boolean);
    return sections.filter((s) => {
      const hay = norm([s.title, s.subtitle, s.highlight, ...(s.paragraphs || []), ...(s.tips || []).map((t) => t.text), ...(s.bullets || []).map((b) => b.text), ...(s.faqs || []).flatMap((f) => [f.q, f.a])].filter(Boolean).join(" "));
      return toks.every((t) => hay.includes(t));
    });
  }, [sections, query]);

  const onExport = useCallback(async () => {
    try {
      setExporting(true);
      // 1) Prepara i loghi in base64
      const [logoAdvisor, logoAxon] = await Promise.all([
        assetToBase64(ADVISOR_LOGO),
        assetToBase64(AXON_LOGO),
      ]);
      // 2) Prepara gli screenshot delle sezioni in base64 (in parallelo).
      // Solo per le sezioni che usano image_key (asset bundled). Le sezioni
      // che hanno image_data_url usano direttamente il data URL nel PDF.
      const sectionImages: Record<string, string> = {};
      await Promise.all(
        sections
          .filter((s) => !s.image_data_url && s.image_key && LIBRETTO_IMAGE_MAP[s.image_key])
          .map(async (s) => {
            try {
              const mod = LIBRETTO_IMAGE_MAP[s.image_key as string];
              const b64 = await assetToBase64(mod);
              if (b64) sectionImages[s.id] = b64;
            } catch { /* skip */ }
          }),
      );
      // 3) Costruisci HTML
      const orgSig = await fetchOrgSignature(); // V50.z233 — firma aziendale nel PDF del Libretto
      const html = buildPdfHtml(logoAdvisor, logoAxon, sectionImages, sections, { ...meta, version: versionBadge }, orgSig);
      // 4) Genera PDF
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      // 5) Condividi
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Libretto Informativo AdvisorOS",
          UTI: "com.adobe.pdf",
        });
      } else if (Platform.OS === "web") {
        (globalThis as any).window.open(uri, "_blank");
      } else {
        notify("PDF pronto", `Salvato in: ${uri}`);
      }
    } catch (e: any) {
      notify("Errore export", e?.message || "Impossibile creare il PDF");
    } finally {
      setExporting(false);
    }
  }, [sections, meta, versionBadge]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {isOnboarding && introVisible && <WowIntro onDone={() => setIntroVisible(false)} />}
      {/* Header */}
      <View style={styles.headerBar}>
        {isOnboarding ? (
          <View style={styles.backBtn}>
            <Ionicons name="sparkles" size={22} color="#FBBF24" />
          </View>
        ) : (
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#FFF" />
          </Pressable>
        )}
        <Text style={styles.headerTitle}>{isOnboarding ? "Tour Guidato" : "Libretto Informativo"}</Text>
        {/* V50.o — In onboarding: "Salta" nell'header (necessario per uscire).
            V50.z527 — Libretto: «PDF» e «Modifica» come pulsanti compatti nell'header, a destra del titolo (tolti dal fondo pagina). */}
        {isOnboarding ? (
          <Pressable
            onPress={dismissOnboarding}
            hitSlop={10}
            testID="onboarding-skip-btn"
            style={styles.skipBtn}
          >
            <Text style={styles.skipBtnTxt}>Salta</Text>
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        ) : (
          <View style={styles.headerActions}>
            <Pressable onPress={onExport} disabled={exporting} hitSlop={6} testID="libretto-pdf-btn" accessibilityLabel="Scarica Manuale PDF" style={[styles.headerBtn, styles.headerBtnPrimary, exporting && { opacity: 0.7 }]}>
              {exporting ? <ActivityIndicator color={LP.onBrand} size="small" /> : <Ionicons name="download-outline" size={16} color={LP.onBrand} />}
              <Text style={styles.headerBtnTxt}>PDF</Text>
            </Pressable>
            {canEdit ? (
              <Pressable onPress={() => router.push("/libretto-editor" as any)} hitSlop={6} testID="libretto-edit-btn" accessibilityLabel="Modifica libretto" style={styles.headerBtn}>
                <Ionicons name="create-outline" size={16} color={LP.axon} />
                <Text style={[styles.headerBtnTxt, { color: LP.axon }]}>Modifica</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          // V50.z527 — Riserva spazio per la sticky solo in onboarding (PDF/Modifica sono nell'header)
          { paddingBottom: (isOnboarding ? 160 : 40) + bottomInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover — V50.z527: stile pulito allineato alla landing (niente loghi, motto, Brain+ né tagline) */}
        <View style={styles.cover}>
          <Text style={styles.coverEyebrow}>{isOnboarding ? "TOUR GUIDATO" : "GUIDA OPERATIVA"}</Text>
          <Text style={styles.coverTitle}>{isOnboarding ? "Benvenuto in AdvisorOS" : meta.title}</Text>
          <View style={styles.coverRule} />
          <Text style={styles.coverSub}>
            {isOnboarding
              ? "Quattro momenti di una giornata vera, raccontati da chi lavora come te. Scorri, poi tocca «Iniziamo!» in fondo."
              : meta.subtitle}
          </Text>
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeTxt} testID="libretto-version-badge">{versionBadge}</Text>
          </View>
        </View>

        {/* V50.z469 — Feature 12: ricerca + indice cliccabile (solo Libretto, non in onboarding) */}
        {!isOnboarding ? (
          <View style={styles.searchWrap} testID="libretto-search">
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={HT.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Cerca nel libretto (es. PUN, appuntamenti, rubrica…)" placeholderTextColor={HT.muted} style={styles.searchInput} autoCorrect={false} testID="libretto-search-input" returnKeyType="search" />
              {query ? <Pressable onPress={() => setQuery("")} hitSlop={8} testID="libretto-search-clear"><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
            </View>
            {query.trim().length >= 2 ? (
              <Text style={styles.searchCount} testID="libretto-search-count">{visibleSections.length ? `${visibleSections.length} sezioni trovate` : "Nessuna sezione corrisponde: prova con un'altra parola o chiedi ad Axon."}</Text>
            ) : (
              <View style={styles.indexWrap} testID="libretto-index">
                {sections.map((s) => (
                  <Pressable key={s.id} onPress={() => scrollToSection(s.id)} style={[styles.indexChip, { borderColor: s.color }]} testID={`libretto-index-${s.id}`}>
                    <Text style={styles.indexEmoji}>{s.emoji}</Text>
                    <Text style={styles.indexTxt} numberOfLines={1}>{s.title.replace(/^\d+\s*·\s*/, "")}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : null}
        {/* V50.z244 — Tour Guidato: 4 storie utente in prima persona (le sezioni funzionalità restano nel Libretto) */}
        {isOnboarding ? <TourStories /> : visibleSections.map((s) => (
          <View key={s.id} onLayout={(e) => { sectionY.current[s.id] = e.nativeEvent.layout.y; if (pendingSection.current === s.id) { pendingSection.current = null; setTimeout(() => scrollToSection(s.id), 50); } }}>
            <SectionCard section={s} highlightId={params.section === s.id ? s.id : undefined} />
          </View>
        ))}

        {/* Footer */}
        <View style={styles.footerBox}>
          <Image source={ADVISOR_ICON} style={styles.footerIcon} resizeMode="contain" />
          <Text style={styles.footerTxt}>{meta.footer}</Text>
          <Text style={styles.footerTxt}>Per assistenza: support@advisoros.it</Text>
        </View>
      </ScrollView>

      {/* V50.n — Sticky footer sempre presente:
            • Bottone "Scarica Manuale d'uso PDF" (per tutti)
            • V50.z6 — Se Super Master (canEdit) e non in onboarding: "Modifica libretto"
            • In modalità onboarding: sopra c'è anche "Ho capito · Iniziamo!" */}
      {/* V50.z527 — Sticky footer SOLO in onboarding («Sicurezza» + «Iniziamo!»); PDF/Modifica sono nell'header. */}
      {isOnboarding ? (
      <View style={[styles.stickyCta, { paddingBottom: bottomInset + 10 }]}>
            <Pressable
              onPress={() => router.push("/security-info" as any)}
              testID="onboarding-security-btn"
              style={[styles.stickyBtn, { backgroundColor: '#3B82F6', marginBottom: 10 }]}
            >
              <Ionicons name="shield-checkmark" size={18} color="#FFF" />
              <Text style={styles.stickyBtnTxt}>🔒 Leggi la Sicurezza AdvisorOS</Text>
            </Pressable>
            <Pressable onPress={dismissOnboarding} testID="onboarding-start-btn" style={styles.stickyBtn}>
              <Ionicons name="rocket" size={18} color="#FFF" />
              <Text style={styles.stickyBtnTxt}>Ho capito · Iniziamo!</Text>
            </Pressable>
      </View>
      ) : null}
    </SafeAreaView>
  );
}

function SectionCard({ section, highlightId }: { section: LibrettoSection; highlightId?: string }) {
  const router = useRouter(); // V50.z561 — link diretti
  const imgSrc = resolveSectionImage(section);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  return (
    <View style={[styles.sec, highlightId ? { borderWidth: 2, borderColor: "#FBBF24" } : null]} testID={`libretto-section-${section.id}`}>
      <View style={[styles.secHeader, { backgroundColor: section.color }]}>
        <Text style={styles.secEmoji}>{section.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.secTitle}>{section.title}</Text>
          {section.subtitle ? <Text style={styles.secSub}>{section.subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.secBody}>
        {BRAIN_PLUS_SECTION_IDS.has(section.id) ? (
          <BrainPlus dark={false} size={20} tagline={section.id === "intro" || section.id === "chiusura"} style={{ marginBottom: 8 }} testID={`libretto-brainplus-${section.id}`} />
        ) : null}
        {section.highlight ? (
          <View style={[styles.highlight, { backgroundColor: section.color }]} testID={`libretto-highlight-${section.id}`}>
            <Text style={styles.highlightTxt}>{section.highlight}</Text>
          </View>
        ) : null}
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={styles.secP}>
            {p}
          </Text>
        ))}
        {section.bullets?.length ? (
          <View style={styles.bullets} testID={`libretto-bullets-${section.id}`}>
            {section.bullets.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bulletIcon, { backgroundColor: section.color }]}>
                  <Ionicons name={b.icon as any} size={22} color="#FFF" />
                </View>
                <Text style={styles.bulletTxt}>{b.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {imgSrc ? (
          <View style={styles.screenshotWrap}>
            <Image source={imgSrc as any} style={section.image_wide ? styles.bannerImg : styles.screenshotImg} resizeMode="contain" />
          </View>
        ) : null}
        {section.icons?.length ? (
          <View style={styles.secIcons} testID={`libretto-icons-${section.id}`}>
            {section.icons.map((ic) => (
              LIBRETTO_IMAGE_MAP[ic.image_key] ? (
                <View key={ic.image_key} style={styles.secIcon}>
                  <Image source={LIBRETTO_IMAGE_MAP[ic.image_key]} style={styles.secIconImg} resizeMode="contain" />
                  {/* V50.z527 — etichetta sempre visibile: se manca nel contenuto salvato, ricavata dalla image_key */}
                  <Text style={styles.secIconLbl}>{ic.label || ic.image_key.replace(/^[a-z]+_/, "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())}</Text>
                </View>
              ) : null
            ))}
          </View>
        ) : null}
        {section.mockup ? (
          <View style={styles.mockup}>
            <Text style={styles.mockupTitle}>{section.mockup.title}</Text>
            {section.mockup.lines.map((line, i) => (
              <Text key={i} style={styles.mockupLine}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {section.tips?.length ? (
          <View style={styles.tips}>
            {section.tips.map((t, i) => (
              <View key={i} style={styles.tip}>
                <Text style={styles.tipEmoji}>{t.emoji}</Text>
                <Text style={styles.tipTxt}>{t.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {/* V50.z469 — FAQ della sezione (espandibili) */}
        {section.faqs?.length ? (
          <View style={styles.faqWrap} testID={`libretto-faq-${section.id}`}>
            <Text style={styles.faqTitle}>❓ Domande frequenti</Text>
            {section.faqs.map((f, i) => (
              <Pressable key={i} onPress={() => setOpenFaq(openFaq === i ? null : i)} style={styles.faqItem} testID={`libretto-faq-${section.id}-${i}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name={openFaq === i ? "chevron-down" : "chevron-forward"} size={16} color={section.color} />
                  <Text style={styles.faqQ}>{f.q}</Text>
                </View>
                {openFaq === i ? <Text style={styles.faqA}>{f.a}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {/* V50.z561 — Link diretti della sezione (Manuale d'uso, Mappa dell'app) */}
        {section.links?.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {section.links.map((l, i) => (
              <Pressable key={i} onPress={() => router.push(l.href as any)} style={[styles.linkBtn, { borderColor: section.color }]} testID={`libretto-link-${section.id}-${i}`}>
                <Ionicons name={(l.icon as any) || "open-outline"} size={15} color={section.color} />
                <Text style={[styles.linkBtnTxt, { color: section.color }]}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {section.warning ? (
          <View style={styles.warning}>
            <Ionicons name="warning" size={16} color="#DC2626" />
            <Text style={styles.warningTxt}>{section.warning}</Text>
          </View>
        ) : null}
        {section.id === "chiusura" ? (
          <View style={{ backgroundColor: '#0F2438', borderRadius: 14, paddingVertical: 22, paddingHorizontal: 16, marginTop: 8 }}>
            <BrandLogosBlock advisorLogo={ADVISOR_LOGO} axonLogo={AXON_LOGO} width={150} dark testID="libretto-brand-block-close" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F2438' },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0F2438',
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backBtn: { padding: 6, minWidth: 36 },
  // V50.z527 — pulsanti compatti nell'header (stile landing: arancio «OS» per il primario, ciano Axon per il secondario)
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: LP.axonLine, backgroundColor: LP.axonGlow },
  headerBtnPrimary: { backgroundColor: LP.brand, borderColor: LP.brand },
  headerBtnTxt: { color: LP.onBrand, fontSize: 12, fontWeight: "900", letterSpacing: 0.2 },
  // V50.o — Salta onboarding in alto a destra
  skipBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
  },
  skipBtnTxt: { color: "rgba(255,255,255,0.85)", fontWeight: "700", fontSize: 13, letterSpacing: 0.2 },
  // V50.v — Pulsante "Modifica" per Super Master
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(251,191,36,0.15)",
    borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
  },
  editBtnTxt: { color: "#FBBF24", fontWeight: "800", fontSize: 12, letterSpacing: 0.3 },
  headerTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  pdfBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EA580C',
    minWidth: 76,
    justifyContent: "center",
  },
  pdfBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  scroll: { flex: 1, backgroundColor: HT.card2 },
  scrollContent: { paddingBottom: 60 },
  // Cover — V50.z527: pulita, palette landing (LP)
  cover: {
    paddingVertical: 36,
    paddingHorizontal: 24,
    backgroundColor: LP.surface,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: LP.border,
  },
  coverEyebrow: { color: LP.axon, fontSize: 11, fontWeight: "800", letterSpacing: 2.5, marginBottom: 10 },
  coverTitle: {
    color: LP.onSurface,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
    textAlign: "center",
  },
  coverRule: { width: 44, height: 3, borderRadius: 2, backgroundColor: LP.brand, marginTop: 14, marginBottom: 12 },
  coverSub: {
    color: LP.onSurface2,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 18,
  },
  coverBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: LP.brandGlow,
    borderWidth: 1,
    borderColor: LP.brandLine,
  },
  coverBadgeTxt: { color: LP.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  // Sezioni
  sec: {
    marginHorizontal: 12,
    marginTop: 14,
    backgroundColor: HT.card,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: HT.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  secHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  secEmoji: { fontSize: 30 },
  secTitle: { color: "#FFF", fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  secSub: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 3 },
  secBody: { padding: 18 },
  secP: { fontSize: 13.5, lineHeight: 21, color: HT.text, marginBottom: 10 },
  highlight: { borderRadius: 14, padding: 16, marginBottom: 12 },
  highlightTxt: { color: "#FFF", fontSize: 18, lineHeight: 26, fontWeight: "900", letterSpacing: 0.2 },
  bullets: { gap: 8, marginTop: 6, marginBottom: 6 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  bulletIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bulletTxt: { flex: 1, fontSize: 15, fontWeight: "800", color: HT.text, lineHeight: 20 },
  bannerImg: { width: "100%", height: 112, borderRadius: 10 },
  secIcons: { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 10 },
  secIcon: { alignItems: "center", gap: 4, width: 120 },
  secIconImg: { width: 110, height: 80 },
  secIconLbl: { fontSize: 12, fontWeight: "800", color: HT.text, textAlign: "center" },
  screenshotWrap: {
    alignItems: "center",
    marginTop: 10,
    marginBottom: 6,
    padding: 8,
    borderRadius: 14,
    backgroundColor: HT.card2,
    borderWidth: 1,
    borderColor: HT.border,
  },
  screenshotImg: {
    width: "88%",
    height: 260,
    borderRadius: 10,
    backgroundColor: HT.card,
  },
  mockup: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    marginBottom: 6,
  },
  mockupTitle: {
    color: "#FBBF24",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  mockupLine: {
    color: "#E2E8F0",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  tips: { marginTop: 10, gap: 6 },
  // V50.z469 — ricerca / indice / FAQ
  searchWrap: { marginBottom: 14, gap: 10 },
  // V50.z532 — ricerca e indice seguono il TEMA (prima bianco fisso: su Luce/Pearl le etichette dei bottoni erano invisibili)
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, color: HT.text, fontSize: 15, paddingVertical: 10 },
  searchCount: { color: "#CBD5E1", fontSize: 12.5, fontWeight: "600" },
  indexWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  indexChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 36, backgroundColor: HT.card, maxWidth: "100%" },
  indexEmoji: { fontSize: 13 },
  indexTxt: { color: HT.text, fontSize: 12, fontWeight: "700", maxWidth: 190, flexShrink: 1 },
  faqWrap: { marginTop: 12, backgroundColor: "rgba(15,36,56,0.05)", borderRadius: 12, padding: 10, gap: 4 },
  faqTitle: { fontSize: 13, fontWeight: "800", color: HT.text, marginBottom: 4 },
  linkBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, backgroundColor: HT.card },
  linkBtnTxt: { fontSize: 13, fontWeight: "800" },
  faqItem: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border, minHeight: 40, justifyContent: "center" },
  faqQ: { flex: 1, fontSize: 13.5, fontWeight: "700", color: HT.text },
  faqA: { fontSize: 13, lineHeight: 19, color: HT.text2, marginTop: 6, marginLeft: 24 },
  tip: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: HT.warningTint,
  },
  tipEmoji: { fontSize: 16 },
  tipTxt: { flex: 1, fontSize: 12.5, color: "#FDBA74", lineHeight: 18 },
  warning: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: HT.dangerTint,
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
    alignItems: "flex-start",
  },
  warningTxt: { flex: 1, fontSize: 12.5, color: HT.danger, lineHeight: 18 },
  // Footer
  footerBox: {
    alignItems: "center",
    padding: 30,
    marginTop: 20,
    gap: 8,
  },
  footerIcon: { width: 60, height: 60, borderRadius: 12, marginBottom: 6 },
  footerTxt: { fontSize: 11, color: HT.muted, textAlign: "center" },
  // V50.m — Sticky CTA per onboarding
  stickyCta: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: "rgba(15,36,56,0.98)",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  stickyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 15, borderRadius: 999,
    backgroundColor: '#EA580C',
    shadowColor: "#EA580C", shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  stickyBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 15, letterSpacing: 0.3 },
});

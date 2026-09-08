// V50.z105 — Landing page pubblica AdvisorOS (PROMPT 28)
// Struttura i18n con IT default, EN/ES pronti per traduzioni.
// Route: /adv-landing (accessibile senza login)

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";

type Lang = "it" | "en" | "es";

const C = {
  bg: "#0A0F1E",
  bgAlt: "#111827",
  card: "#141B2E",
  cardAlt: "#1B2438",
  border: "#26314B",
  text: "#E5EAF3",
  textMuted: "#8B95AC",
  textFaint: "#5D6786",
  blue: "#3B82F6",
  blueDeep: "#1E40AF",
  blueSoft: "#3B82F622",
  orange: "#F97316",
  orangeSoft: "#F9731622",
  success: "#10B981",
  danger: "#F43F5E",
};

const COPY_IT = {
  brand: "AdvisorOS",
  nav: { home: "Home", features: "Funzioni", pricing: "Prezzi", faq: "FAQ", cta: "Provalo" },
  hero: {
    badge: "✨ AI-native CRM · 2026",
    headline: "Il primo CRM per consulenti con AI nativa che lavora come un secondo cervello.",
    subtitle: "Non uno strumento generico. Un ecosistema che si adatta a te al 100%, conosce i tuoi clienti, analizza i loro documenti e ti prepara prima di ogni incontro.",
    ctaApp: "App Store",
    ctaPlay: "Google Play",
  },
  slogans: [
    "Un solo tap. Tutto il tuo cliente.",
    "L'unico CRM che ti ascolta.",
    "Mentre guidi, AdvisorOS lavora.",
    "AdvisorOS non è un software che usi. È un ecosistema che lavora per te, si adatta a te al 100%: basta automazioni e integrazioni, benvenuta crescita adattiva e responsiva.",
    "AdvisorOS si adegua al cliente. Non il contrario.",
    "Il primo CRM per consulenti con AI nativa che lavora come un secondo cervello.",
  ],
  costs: {
    title: "Quanto ti costa lavorare senza AdvisorOS?",
    withoutTitle: "Senza AdvisorOS",
    without: [
      { label: "CRM professionale", cost: "€ 60–200 / mese" },
      { label: "Email marketing", cost: "€ 40–150 / mese" },
      { label: "WhatsApp Business API", cost: "€ 100–400 / mese" },
      { label: "Calendario & reminder pro", cost: "€ 20–60 / mese" },
      { label: "Social media manager", cost: "€ 300–1.200 / mese" },
      { label: "Automazioni & workflow (Zapier/Make)", cost: "€ 50–500 / mese" },
    ],
    withoutTotal: "Fino a € 3.000 / mese",
    withTitle: "Con AdvisorOS",
    with: [
      { label: "Canone fisso mensile", detail: "Tutto già dentro" },
      { label: "Budget flessibile AxonOS", detail: "Paghi solo l'AI che usi" },
      { label: "Zero tool esterni", detail: "Nessuna integrazione da configurare" },
      { label: "Aggiornamenti continui", detail: "Nuove funzionalità sempre incluse" },
    ],
    withNote: "Un solo strumento. Un solo canone. Zero sorprese.",
  },
  featuresTitle: "Le funzioni principali",
  featuresSub: "Tutto quello che ti serve, integrato nativamente. Ogni funzione parla con AxonOS.",
  featureGroups: [
    { color: C.blue, icon: "people", title: "Gestione contatti e anagrafica", items: [
      { icon: "person", title: "Scheda cliente completa", body: "Tutti i dati personali e contrattuali in un'unica vista." },
      { icon: "create", title: "Campi personalizzati", body: "Il master crea campi su misura (testo, numero, data, checkbox)." },
      { icon: "cloud-upload", title: "Import CSV / Excel", body: "Mappatura intelligente dei campi con AI." },
      { icon: "alert-circle", title: "Avviso campi non riconosciuti", body: "Crea sul momento o ignora, la scelta è tua." },
      { icon: "clipboard", title: "Report importazione", body: "Contatti caricati, campi ignorati, errori: tutto tracciato." },
      { icon: "navigate", title: "Waze & Google Maps", body: "Navigazione in un tap da ogni indirizzo." },
      { icon: "chatbubbles", title: "Script telefonata e WhatsApp", body: "Testi preimpostati per ogni cliente." },
      { icon: "pricetags", title: "Tagging e categorie", body: "Organizzazione flessibile dei contatti." },
    ]},
    { color: C.orange, icon: "calendar", title: "Calendario e appuntamenti", items: [
      { icon: "grid", title: "Vista giornaliera, settimanale, mensile", body: "Un calendario che ti segue in ogni momento." },
      { icon: "partly-sunny", title: "Meteo & Protezione Civile", body: "Previsioni e allerte accanto a ogni evento." },
      { icon: "share-social", title: "Condivisione con il cliente", body: "WhatsApp o email con file, foto e audio allegati." },
      { icon: "alarm", title: "Promemoria automatici", body: "Il cliente riceve un avviso X ore prima." },
      { icon: "sparkles", title: "Briefing AxonOS", body: "Prima di ogni incontro: profilo cliente, scadenze e argomenti." },
    ]},
    { color: C.blue, icon: "chatbubble-ellipses", title: "Comunicazione", items: [
      { icon: "mail", title: "Casella email integrata", body: "Leggi e rispondi senza uscire dall'app." },
      { icon: "logo-whatsapp", title: "WhatsApp diretto dalla scheda", body: "Un tap per scrivere al tuo cliente." },
      { icon: "business", title: "Area 'Comunica con l'azienda'", body: "Numeri, documenti e link utili sempre a portata." },
      { icon: "options", title: "Bottoni personalizzabili", body: "Il master decide etichette e ordini." },
      { icon: "megaphone", title: "Broadcast aggiornamenti", body: "Promozioni e contenuti agli utenti in un click." },
    ]},
    { color: C.orange, icon: "document-text", title: "Analisi documenti", items: [
      { icon: "flash", title: "Analisi bolletta Luce & Gas", body: "Confronto offerte automatizzato." },
      { icon: "search", title: "OCR documento", body: "Riconoscimento dati automatico." },
      { icon: "scan", title: "Scanner con Jscanify", body: "Correzione prospettiva automatica multi-pagina." },
      { icon: "grid", title: "Parser Excel & CSV", body: "AxonOS legge e analizza qualsiasi foglio caricato." },
      { icon: "trending-up", title: "PUN aggiornato", body: "Prezzo Unico Nazionale energia in tempo reale." },
    ]},
    { color: C.blue, icon: "sparkles", title: "AxonOS — AI nativo integrato al 100%", items: [
      { icon: "chatbubbles", title: "Assistente conversazionale", body: "Sempre attivo, contestualizzato sul cliente." },
      { icon: "globe", title: "Ricerca web in tempo reale", body: "Tavily API integrata." },
      { icon: "cloud-done", title: "Sync persistente Google Drive", body: "Documenti sempre indicizzati." },
      { icon: "cloud-upload", title: "Upload file, foto, scanner", body: "Da dispositivo, galleria o scansione." },
      { icon: "library", title: "Knowledge base interna", body: "Documenti, FAQ e dati ricorrenti." },
      { icon: "document-attach", title: "Auto-attach documenti", body: "AxonOS carica i documenti pertinenti prima di rispondere." },
      { icon: "flash", title: "Briefing pre-appuntamento", body: "Analisi profilo cliente automatica." },
      { icon: "people", title: "Analisi lead", body: "Preparazione risposta personalizzata." },
      { icon: "bookmark", title: "Estrazione contenuti web", body: "Da qualsiasi pagina alla tua Knowledge Base." },
    ]},
    { color: C.orange, icon: "link", title: "My Web", items: [
      { icon: "bookmark", title: "Raccolta link personalizzati", body: "Nome + apertura in WebView interna." },
      { icon: "create", title: "Aggiungi / modifica / rimuovi", body: "In qualsiasi momento, con un tap." },
      { icon: "home", title: "Nessuna uscita dall'app", body: "Tutto dentro AdvisorOS." },
    ]},
    { color: C.blue, icon: "notifications", title: "Notifiche e automazioni", items: [
      { icon: "options", title: "Notifiche configurabili", body: "Messaggi, scadenze, appuntamenti, alert meteo…" },
      { icon: "toggle", title: "Attivazione singola", body: "Ogni categoria on/off separatamente." },
      { icon: "alarm", title: "Sveglia integrata", body: "Orario persistente, suono e volume regolabili." },
      { icon: "star", title: "Sondaggio qualità automatico", body: "Via WhatsApp/email al momento della conversione." },
      { icon: "bulb", title: "Monitoraggio funzioni non usate", body: "AxonOS suggerisce proattivamente cosa esplorare." },
    ]},
    { color: C.orange, icon: "shield-checkmark", title: "Pannello Master", items: [
      { icon: "grid", title: "Dashboard configurabile", body: "Widget a scelta: contatti, appuntamenti, meteo, PUN…" },
      { icon: "people", title: "Gestione utenti per tier", body: "Paganti, Test, AxonOS — con storico." },
      { icon: "person", title: "Scheda per ogni utente", body: "Dettagli + storico completo di utilizzo." },
      { icon: "megaphone", title: "Messaggi singoli o di gruppo", body: "Broadcast per categoria utenti." },
      { icon: "mail-unread", title: "Modulo lead pubblico", body: "AxonOS analizza e prepara la risposta. Tu approvi." },
      { icon: "library", title: "Knowledge base AxonOS", body: "Aggiungi documenti e regole quando vuoi." },
      { icon: "checkmark-done", title: "Approvazione recensioni", body: "Solo quelle che approvi vanno pubbliche." },
    ]},
    { color: C.blue, icon: "school", title: "Area clienti", items: [
      { icon: "newspaper", title: "Sezione dedicata non-master", body: "Contenuti curati dal master." },
      { icon: "videocam", title: "Articoli, aggiornamenti, tutorial", body: "Pubblicati direttamente in-app." },
      { icon: "list", title: "Sondaggi a scelta multipla", body: "Raccogli feedback in tempo reale." },
      { icon: "help-circle", title: "Test con domande e risposte", body: "Formazione integrata." },
      { icon: "folder-open", title: "Contenuti per categoria", body: "Organizzati e sempre navigabili." },
    ]},
  ],
  securityTitle: "La tua sicurezza, la nostra priorità.",
  securityItems: [
    { icon: "lock-closed", title: "Connessione sempre cifrata", body: "Tutti i dati viaggiano protetti da HTTPS in ogni momento, su qualsiasi dispositivo." },
    { icon: "server", title: "Dati al sicuro sul server", body: "Tutte le informazioni dei tuoi clienti sono cifrate con standard bancario AES-256." },
    { icon: "cloud-done", title: "Backup automatici", body: "Il database viene salvato ogni ora, ogni giorno, ogni settimana e ogni mese. Recupero fino a 7 giorni al minuto esatto." },
    { icon: "key", title: "Credenziali protette", body: "Le tue API key sono cifrate con chiave unica dedicata e monitoraggio manomissioni attivo." },
    { icon: "shield-checkmark", title: "Server sicuro e aggiornato", body: "L'infrastruttura si aggiorna automaticamente contro le nuove minacce, senza interruzioni." },
    { icon: "checkmark-done", title: "Avvio verificato", body: "Il sistema parte solo da software certificato e non manomesso, ogni volta." },
  ],
  faqTitle: "Domande frequenti",
  faq: [
    { q: "Cos'è AdvisorOS?", a: "Il primo CRM per consulenti con AI nativa integrata al 100%. Non un chatbot aggiunto sopra un software: un ecosistema che conosce i tuoi clienti, analizza i loro documenti, cerca informazioni in tempo reale e si adatta al tuo modo di lavorare." },
    { q: "Per chi è adatto?", a: "Per consulenti che gestiscono clienti con contratti, documenti e appuntamenti e vogliono lavorare in modo più intelligente senza dipendere da decine di tool esterni." },
    { q: "Come funziona AxonOS?", a: "È l'AI nativa di AdvisorOS. Conosce i tuoi clienti, analizza i loro documenti, cerca informazioni sul web in tempo reale e ti prepara un briefing completo prima di ogni appuntamento. Lavora per te prima, durante e dopo ogni interazione." },
    { q: "Posso provarlo?", a: "Sì, contattaci per una demo personalizzata." },
    { q: "Quanto costa?", a: "Canone fisso mensile tutto incluso più budget flessibile per l'utilizzo di AxonOS. Nessun costo aggiuntivo a sorpresa." },
    { q: "È conforme GDPR?", a: "Sì, AdvisorOS è progettato nel rispetto della normativa europea sulla privacy. I tuoi dati e quelli dei tuoi clienti sono protetti secondo la normativa europea vigente." },
    { q: "I miei dati sono al sicuro?", a: "Sì. Connessione HTTPS sempre attiva, cifratura AES-256 su tutti i dati, backup automatici con recovery fino a 7 giorni al minuto, credenziali protette con cifratura KMS dedicata e server con aggiornamenti automatici continui." },
  ],
  finalCta: { title: "Pronto a lavorare in modo diverso?", subtitle: "Più di 250+ consulenti usano già AdvisorOS ogni giorno." },
  footer: {
    tagline: "Il tuo secondo cervello per la consulenza.",
    copyright: "© 2026 AdvisorOS. Tutti i diritti riservati.",
    links: [
      { label: "Privacy", url: "https://advisoros.it/privacy" },
      { label: "Termini", url: "https://advisoros.it/terms" },
      { label: "Contatti", url: "mailto:info@advisoros.it" },
    ],
  },
};

const COPY_EN = COPY_IT; // TODO: English translation
const COPY_ES = COPY_IT; // TODO: Spanish translation
const COPY_MAP: Record<Lang, typeof COPY_IT> = { it: COPY_IT, en: COPY_EN, es: COPY_ES };

const APP_STORE_URL = "https://apps.apple.com/app/advisoros";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.advisoros";

export default function AdvLandingPage() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const [lang, setLang] = useState<Lang>("it");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const t = useMemo(() => COPY_MAP[lang], [lang]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, title: "AdvisorOS" }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
        <View style={styles.navBar}>
          <View style={styles.brandRow}>
            <View style={styles.brandLogoDot} />
            <Text style={styles.brandName}>{t.brand}</Text>
          </View>
          <View style={styles.langSwitcher}>
            {(["it", "en", "es"] as Lang[]).map((l) => (
              <Pressable key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnActive]} testID={`lang-${l}`}>
                <Text style={[styles.langBtnTxt, lang === l && { color: "#FFF", fontWeight: "800" }]}>{l.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* HERO */}
          <View style={[styles.hero, isDesktop && styles.heroDesktop]}>
            <View style={styles.heroGlowA} />
            <View style={styles.heroGlowB} />
            <View style={styles.heroBadgeWrap}>
              <Text style={styles.heroBadge}>{t.hero.badge}</Text>
            </View>
            <Text style={[styles.heroHeadline, isDesktop && { fontSize: 46, maxWidth: 900, textAlign: "center" }]}>{t.hero.headline}</Text>
            <Text style={[styles.heroSubtitle, isDesktop && { fontSize: 18, maxWidth: 700, textAlign: "center" }]}>{t.hero.subtitle}</Text>
            <View style={[styles.storeRow, isDesktop && { justifyContent: "center" }]}>
              <StoreButton kind="ios" label={t.hero.ctaApp} url={APP_STORE_URL} />
              <StoreButton kind="android" label={t.hero.ctaPlay} url={PLAY_STORE_URL} />
            </View>
            <View style={styles.slogansRow}>
              <SloganChip text={t.slogans[0]} />
              <SloganChip text={t.slogans[1]} />
              <SloganChip text={t.slogans[4]} />
            </View>
          </View>

          {/* COSTS */}
          <SectionTitle title={t.costs.title} />
          <View style={[styles.costsWrap, isDesktop && styles.costsWrapDesktop]}>
            <View style={[styles.costCard, { borderColor: C.danger + "44" }]}>
              <View style={[styles.costHeader, { backgroundColor: C.danger + "18" }]}>
                <Ionicons name="close-circle" size={22} color={C.danger} />
                <Text style={[styles.costHeaderTxt, { color: C.danger }]}>{t.costs.withoutTitle}</Text>
              </View>
              {t.costs.without.map((c, i) => (
                <View key={i} style={styles.costRow}>
                  <Text style={styles.costLabel}>{c.label}</Text>
                  <Text style={styles.costValue}>{c.cost}</Text>
                </View>
              ))}
              <View style={[styles.costRow, styles.costTotalRow]}>
                <Text style={styles.costTotalLbl}>Totale</Text>
                <Text style={[styles.costTotalVal, { color: C.danger }]}>{t.costs.withoutTotal}</Text>
              </View>
            </View>
            <View style={[styles.costCard, { borderColor: C.blue + "66" }]}>
              <View style={[styles.costHeader, { backgroundColor: C.blue + "22" }]}>
                <Ionicons name="checkmark-circle" size={22} color={C.blue} />
                <Text style={[styles.costHeaderTxt, { color: C.blue }]}>{t.costs.withTitle}</Text>
              </View>
              {t.costs.with.map((c, i) => (
                <View key={i} style={styles.costRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.costLabel}>{c.label}</Text>
                    <Text style={styles.costDetail}>{c.detail}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={C.success} />
                </View>
              ))}
              <View style={[styles.costRow, styles.costTotalRow]}>
                <Text style={[styles.costTotalLbl, { color: C.blue }]}>{t.costs.withNote}</Text>
              </View>
            </View>
          </View>

          <QuoteBanner text={t.slogans[2]} />

          {/* FEATURES */}
          <SectionTitle title={t.featuresTitle} subtitle={t.featuresSub} />
          {t.featureGroups.map((g, gi) => (
            <View key={gi} style={styles.featGroup}>
              <View style={[styles.featGroupHeader, { borderColor: g.color + "55" }]}>
                <View style={[styles.featGroupIcon, { backgroundColor: g.color + "22" }]}>
                  <Ionicons name={g.icon as any} size={22} color={g.color} />
                </View>
                <Text style={styles.featGroupTitle}>{g.title}</Text>
              </View>
              <View style={[styles.featGrid, isDesktop && styles.featGridDesktop]}>
                {g.items.map((it, ii) => (
                  <View key={ii} style={[styles.featCard, isDesktop && { width: "31%" }]}>
                    <View style={[styles.featIcon, { backgroundColor: g.color + "18", borderColor: g.color + "44" }]}>
                      <Ionicons name={it.icon as any} size={18} color={g.color} />
                    </View>
                    <Text style={styles.featTitle}>{it.title}</Text>
                    <Text style={styles.featBody}>{it.body}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}

          <QuoteBanner text={t.slogans[3]} large />

          {/* SECURITY */}
          <SectionTitle title={t.securityTitle} accent={C.blue} />
          <View style={[styles.secGrid, isDesktop && styles.secGridDesktop]}>
            {t.securityItems.map((s, i) => (
              <View key={i} style={[styles.secCard, isDesktop && { width: "48%" }]}>
                <View style={styles.secIconBox}>
                  <Ionicons name={s.icon as any} size={22} color={C.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.secTitle}>{s.title}</Text>
                  <Text style={styles.secBody}>{s.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* FAQ */}
          <SectionTitle title={t.faqTitle} />
          <View style={styles.faqWrap}>
            {t.faq.map((f, i) => {
              const open = openFaq === i;
              return (
                <Pressable key={i} onPress={() => setOpenFaq(open ? null : i)} style={styles.faqCard} testID={`faq-${i}`}>
                  <View style={styles.faqHead}>
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <Ionicons name={open ? "remove-circle" : "add-circle"} size={22} color={open ? C.orange : C.blue} />
                  </View>
                  {open ? <Text style={styles.faqA}>{f.a}</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {/* FINAL CTA */}
          <View style={styles.finalCta}>
            <View style={styles.finalGlowA} />
            <Text style={styles.finalTitle}>{t.finalCta.title}</Text>
            <View style={[styles.storeRow, { justifyContent: "center", marginTop: 16 }]}>
              <StoreButton kind="ios" label={t.hero.ctaApp} url={APP_STORE_URL} />
              <StoreButton kind="android" label={t.hero.ctaPlay} url={PLAY_STORE_URL} />
            </View>
            <Text style={styles.finalSub}>{t.finalCta.subtitle}</Text>
          </View>

          {/* FOOTER */}
          <View style={styles.footer}>
            <View style={styles.brandRow}>
              <View style={styles.brandLogoDot} />
              <Text style={styles.brandName}>{t.brand}</Text>
            </View>
            <Text style={styles.footerTag}>{t.footer.tagline}</Text>
            <View style={styles.footerLinks}>
              {t.footer.links.map((l, i) => (
                <Pressable key={i} onPress={() => Linking.openURL(l.url)}>
                  <Text style={styles.footerLink}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.footerCopy}>{t.footer.copyright}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function StoreButton({ kind, label, url }: { kind: "ios" | "android"; label: string; url: string }) {
  return (
    <Pressable style={styles.storeBtn} onPress={() => Linking.openURL(url)} testID={`store-${kind}`}>
      <Ionicons name={kind === "ios" ? "logo-apple" : "logo-google-playstore"} size={22} color="#FFF" />
      <View>
        <Text style={styles.storeBtnSmall}>{kind === "ios" ? "Scarica su" : "Disponibile su"}</Text>
        <Text style={styles.storeBtnBig}>{label}</Text>
      </View>
    </Pressable>
  );
}

function SectionTitle({ title, subtitle, accent }: { title: string; subtitle?: string; accent?: string }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <View style={[styles.sectionAccent, { backgroundColor: accent || C.orange }]} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

function QuoteBanner({ text, large }: { text: string; large?: boolean }) {
  return (
    <View style={styles.quoteBanner}>
      <Ionicons name="chatbox-ellipses" size={20} color={C.orange} />
      <Text style={[styles.quoteTxt, large && { fontSize: 18 }]}>&ldquo;{text}&rdquo;</Text>
    </View>
  );
}

function SloganChip({ text }: { text: string }) {
  return (
    <View style={styles.sloganChip}>
      <Text style={styles.sloganTxt}>&ldquo;{text}&rdquo;</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  navBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bg,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandLogoDot: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.blue },
  brandName: { color: C.text, fontSize: 18, fontWeight: "800", letterSpacing: 0.3 },
  langSwitcher: { flexDirection: "row", gap: 4, backgroundColor: C.card, padding: 3, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  langBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  langBtnActive: { backgroundColor: C.blue },
  langBtnTxt: { color: C.textMuted, fontSize: 11, fontWeight: "700" },

  hero: { padding: 24, paddingTop: 40, paddingBottom: 60, overflow: "hidden", position: "relative" },
  heroDesktop: { paddingTop: 80, paddingBottom: 100, alignItems: "center" },
  heroGlowA: { position: "absolute", top: -100, left: -60, width: 300, height: 300, borderRadius: 150, backgroundColor: C.blue + "22" },
  heroGlowB: { position: "absolute", bottom: -80, right: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: C.orange + "1E" },
  heroBadgeWrap: { alignSelf: "flex-start", marginBottom: 24 },
  heroBadge: {
    color: C.orange, backgroundColor: C.orangeSoft,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    fontSize: 12, fontWeight: "700",
    borderWidth: 1, borderColor: C.orange + "44",
  },
  heroHeadline: { color: C.text, fontSize: 30, fontWeight: "800", lineHeight: 38, marginBottom: 16 },
  heroSubtitle: { color: C.textMuted, fontSize: 15, lineHeight: 22, marginBottom: 28 },

  storeRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  storeBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12, backgroundColor: "#000",
    borderWidth: 1, borderColor: C.border,
  },
  storeBtnSmall: { color: C.textMuted, fontSize: 10 },
  storeBtnBig: { color: "#FFF", fontSize: 15, fontWeight: "800" },

  slogansRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 30 },
  sloganChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.blueSoft, borderWidth: 1, borderColor: C.blue + "44",
  },
  sloganTxt: { color: C.blue, fontSize: 12, fontStyle: "italic", fontWeight: "600" },

  sectionTitleWrap: { padding: 24, paddingBottom: 12, alignItems: "flex-start" },
  sectionAccent: { width: 44, height: 4, borderRadius: 2, marginBottom: 8 },
  sectionTitle: { color: C.text, fontSize: 24, fontWeight: "800", lineHeight: 30 },
  sectionSub: { color: C.textMuted, fontSize: 14, marginTop: 6 },

  costsWrap: { padding: 20, gap: 16 },
  costsWrapDesktop: { flexDirection: "row", paddingHorizontal: 40 },
  costCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, padding: 20 },
  costHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginBottom: 14 },
  costHeaderTxt: { fontSize: 14, fontWeight: "800" },
  costRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  costLabel: { color: C.text, fontSize: 13, flex: 1, fontWeight: "600" },
  costDetail: { color: C.textMuted, fontSize: 11, marginTop: 2 },
  costValue: { color: C.textMuted, fontSize: 12, fontWeight: "700" },
  costTotalRow: { borderBottomWidth: 0, paddingTop: 14, marginTop: 4 },
  costTotalLbl: { color: C.text, fontSize: 14, fontWeight: "800", flex: 1 },
  costTotalVal: { fontSize: 18, fontWeight: "900" },

  quoteBanner: {
    marginHorizontal: 24, marginVertical: 12,
    padding: 20, borderRadius: 14,
    flexDirection: "row", gap: 12, alignItems: "center",
    backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.orange + "33",
  },
  quoteTxt: { color: C.text, fontSize: 15, fontStyle: "italic", flex: 1, lineHeight: 22, fontWeight: "600" },

  featGroup: { paddingHorizontal: 20, marginBottom: 24 },
  featGroupHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, marginBottom: 14,
  },
  featGroupIcon: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featGroupTitle: { color: C.text, fontSize: 17, fontWeight: "800", flex: 1 },
  featGrid: { gap: 10 },
  featGridDesktop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  featCard: {
    backgroundColor: C.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 10,
  },
  featIcon: {
    width: 36, height: 36, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    marginBottom: 8, borderWidth: 1,
  },
  featTitle: { color: C.text, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  featBody: { color: C.textMuted, fontSize: 12, lineHeight: 17 },

  secGrid: { padding: 20, gap: 12 },
  secGridDesktop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  secCard: {
    flexDirection: "row", gap: 12, padding: 16, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.blue + "33",
    marginBottom: 10,
  },
  secIconBox: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: C.blueSoft,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.blue + "55",
  },
  secTitle: { color: C.text, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  secBody: { color: C.textMuted, fontSize: 12, lineHeight: 17 },

  faqWrap: { padding: 20, gap: 8 },
  faqCard: { padding: 16, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  faqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  faqQ: { color: C.text, fontSize: 14, fontWeight: "700", flex: 1 },
  faqA: { color: C.textMuted, fontSize: 13, lineHeight: 20, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },

  finalCta: {
    padding: 40, paddingTop: 60, paddingBottom: 60,
    alignItems: "center", overflow: "hidden", position: "relative",
    backgroundColor: C.cardAlt, marginTop: 20,
  },
  finalGlowA: { position: "absolute", top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: C.orange + "22" },
  finalTitle: { color: C.text, fontSize: 26, fontWeight: "900", textAlign: "center", lineHeight: 32 },
  finalSub: { color: C.textMuted, fontSize: 13, marginTop: 16, textAlign: "center" },

  footer: { padding: 30, alignItems: "center", borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg, gap: 10 },
  footerTag: { color: C.textMuted, fontSize: 13, marginTop: 4 },
  footerLinks: { flexDirection: "row", gap: 20, marginTop: 12 },
  footerLink: { color: C.blue, fontSize: 13, fontWeight: "700" },
  footerCopy: { color: C.textFaint, fontSize: 11, marginTop: 12 },
});

// V50.z465 — Bug 2/15: PRIVACY POLICY INTERNA. Schermata dedicata con il testo scritto nel codice (niente browser, niente
// advisoros.it/privacy). Contenuti standard GDPR per un CRM che NON condivide dati con terze parti. Raggiunta da onboarding,
// login e Help (route /privacy-policy).
import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { HT } from "@/src/homeTheme";

const UPDATED = "Giugno 2026";

const SECTIONS: { title: string; body: string }[] = [
  { title: "1. Titolare del trattamento", body: "Il titolare del trattamento è il titolare dell'account AdvisorOS (il «Master») che ti ha invitato o presso cui ti sei registrato, in qualità di soggetto che decide finalità e mezzi del trattamento dei dati inseriti nel CRM. Per qualsiasi richiesta puoi scrivere a support@advisoros.it o usare la sezione Help → «Richiesta cancellazione dati» dell'app." },
  { title: "2. Quali dati trattiamo", body: "• Dati di registrazione: nome, cognome, email, telefono, password (conservata solo in forma cifrata).\n• Dati dell'anagrafica del consulente: ragione sociale, partita IVA, indirizzo, recapiti, eventuali documenti d'identità caricati volontariamente.\n• Dati dei clienti che inserisci nel CRM: anagrafiche, recapiti, appuntamenti, note, documenti, contratti e comunicazioni.\n• Dati tecnici: identificativo del dispositivo per le notifiche, registri di accesso, versione dell'app, eventuali segnalazioni di errore.\n• Contenuti che condividi con l'assistente Axon (messaggi, allegati, registrazioni vocali trascritte) per ottenere le risposte richieste." },
  { title: "3. Finalità e basi giuridiche", body: "• Erogare il servizio AdvisorOS (gestione clienti, agenda, documenti, assistente Axon): esecuzione del contratto (art. 6.1.b GDPR).\n• Sicurezza, prevenzione abusi, assistenza tecnica: legittimo interesse (art. 6.1.f).\n• Adempimenti di legge (fiscali, contabili): obbligo legale (art. 6.1.c).\n• Comunicazioni di servizio (promemoria, avvisi di onboarding, notifiche push): esecuzione del contratto; puoi disattivarle dalle Impostazioni.\n• Funzioni facoltative basate su consenso (art. 6.1.a), revocabile in ogni momento: accesso alla rubrica del telefono, alla fotocamera, alla posizione, al microfono." },
  { title: "4. Nessuna condivisione con terze parti", body: "I dati che inserisci in AdvisorOS NON vengono venduti, ceduti, né condivisi con terze parti per finalità proprie di marketing o profilazione. I dati restano all'interno dell'infrastruttura del servizio e sono accessibili solo a te, agli utenti del tuo stesso account autorizzati dal Master secondo i ruoli impostati, e al personale tecnico strettamente necessario alla manutenzione." },
  { title: "5. Fornitori tecnici (responsabili del trattamento)", body: "Per funzionare, l'app utilizza fornitori tecnici nominati responsabili del trattamento ai sensi dell'art. 28 GDPR, che agiscono solo su nostre istruzioni e non possono usare i dati per fini propri: hosting e database (server in Unione Europea), invio email transazionali, notifiche push, servizi di intelligenza artificiale per l'assistente Axon e la trascrizione vocale (i contenuti inviati sono trattati per generare la risposta e non sono usati per addestrare modelli), ricerca web su tua richiesta. L'elenco aggiornato è disponibile su richiesta a support@advisoros.it." },
  { title: "6. Assistente Axon e intelligenza artificiale", body: "Axon elabora i tuoi messaggi e i dati del CRM per fornirti risposte, riepiloghi e automazioni. Le risposte sono generate automaticamente e possono contenere errori: verifica sempre le informazioni rilevanti. Le valutazioni (pollice su/giù) e le correzioni che fornisci vengono usate, in forma anonimizzata, per migliorare il comportamento dell'assistente. Puoi limitare ciò che Axon può leggere tramite le impostazioni di privacy dell'app." },
  { title: "7. Conservazione", body: "I dati sono conservati per tutta la durata dell'account e fino a 12 mesi dalla sua chiusura, salvo obblighi di legge che impongano tempi diversi (es. 10 anni per documenti fiscali). I registri tecnici sono conservati al massimo 12 mesi. Alla cancellazione dell'account i dati personali vengono eliminati o resi anonimi." },
  { title: "8. Sicurezza", body: "Adottiamo misure tecniche e organizzative adeguate: connessioni cifrate (HTTPS/TLS), password cifrate, controllo degli accessi per ruolo, backup, protezione contro accessi non autorizzati e monitoraggio degli abusi. Sei responsabile della custodia delle tue credenziali e del dispositivo." },
  { title: "9. I tuoi diritti", body: "Hai diritto di ottenere l'accesso ai tuoi dati, la rettifica, la cancellazione, la limitazione del trattamento, la portabilità e di opporti al trattamento (artt. 15-22 GDPR), oltre a revocare i consensi prestati. Puoi esercitarli dall'app (Help → Richiesta cancellazione dati) o scrivendo a support@advisoros.it. Hai inoltre diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it)." },
  { title: "10. Dati dei tuoi clienti", body: "Quando inserisci nel CRM dati di tuoi clienti o potenziali clienti, agisci come titolare (o incaricato del tuo Master) di tali dati: sei tenuto a informare gli interessati e a trattare i loro dati nel rispetto del GDPR. AdvisorOS ti mette a disposizione gli strumenti per esportarli, correggerli e cancellarli." },
  { title: "11. Minori", body: "Il servizio è destinato a professionisti maggiorenni. Non raccogliamo consapevolmente dati di minori di 18 anni." },
  { title: "12. Modifiche", body: `La presente informativa può essere aggiornata; la versione in vigore è sempre consultabile da questa schermata. Ultimo aggiornamento: ${UPDATED}.` },
];

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as any))} style={s.back} hitSlop={8} testID="privacy-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <Text style={s.hTitle}>Privacy policy</Text>
      </View>
      <ScrollView contentContainerStyle={s.body} testID="privacy-policy-screen">
        <View style={s.hero}><Ionicons name="shield-checkmark" size={28} color="#FFF" /><Text style={s.heroTxt}>Informativa sul trattamento dei dati personali (artt. 13-14 Reg. UE 2016/679 – GDPR)</Text></View>
        <Text style={s.intro}>AdvisorOS è un CRM per consulenti: i dati che inserisci servono solo a farti lavorare meglio. Non li vendiamo, non li condividiamo con terze parti e non li usiamo per pubblicità.</Text>
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={s.card}>
            <Text style={s.title}>{sec.title}</Text>
            <Text style={s.txt}>{sec.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: HT.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: HT.text },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#7C3AED", borderRadius: 16, padding: 16 },
  heroTxt: { flex: 1, color: "#FFF", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  intro: { fontSize: 14, color: HT.text, lineHeight: 21 },
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: HT.border, gap: 6 },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  txt: { fontSize: 13.5, color: HT.text, lineHeight: 20 },
});

// faq.tsx — V50.z329 — Domande frequenti (accordion) · raggiungibile da Help Center e dal Navigatore Axon.
// In fondo: «Scopri di più su AxonOS» → landing pubblica advisoros.it (dominio principale; advisoros.cloud → redirect).
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, LayoutAnimation, Platform, UIManager } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

export const LANDING_URL = process.env.EXPO_PUBLIC_LANDING_URL || "https://advisoros.it";

export const FAQ_ITEMS: { q: string; a: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { icon: "school-outline", q: "Come carico un contratto esempio per addestrare Axon?", a: "Vai nella sezione Compilazione CRT, blocco Modelli di addestramento. Clicca \"Carica contratto compilato di esempio\" e seleziona il file da Drive, Dropbox o dal tuo dispositivo. Axon lo analizza e impara automaticamente la struttura e i campi da compilare." },
  { icon: "swap-vertical-outline", q: "Posso modificare l'ordine delle pagine nel documento finale?", a: "Sì. Prima di salvare puoi trascinare le sezioni nell'ordine che preferisci, oppure impostare un ordine predefinito nel pannello Master che si applica automaticamente a ogni nuovo documento." },
  { icon: "save-outline", q: "Dove si salva il documento compilato?", a: "Al termine della compilazione puoi scegliere: cartella del cliente, database Master, condivisione via email o link, o stampa diretta via WiFi. Puoi salvare in più posti contemporaneamente." },
  { icon: "documents-outline", q: "Axon può compilare qualsiasi tipo di contratto?", a: "Axon funziona con qualsiasi documento PDF che hai caricato come modello. Più esempi compilati gli fornisci, più diventa preciso. Contratti energia, telco, bancari, assicurativi — se hai il modello, Axon lo compila." },
  { icon: "create-outline", q: "Cosa succede se Axon sbaglia a compilare un campo?", a: "Prima di salvare puoi revisionare e correggere ogni campo manualmente. Axon mostra in anteprima tutto il documento compilato e segnala i campi su cui non è sicuro." },
  { icon: "phone-portrait-outline", q: "Posso usare AdvisorOS da mobile e desktop contemporaneamente?", a: "Sì. AdvisorOS è sincronizzato in tempo reale su tutti i dispositivi. Puoi iniziare una pratica da desktop e completarla da mobile senza perdere nulla." },
  { icon: "add-circle-outline", q: "Come aggiungo un nuovo fornitore o modello di contratto?", a: "Dalla sezione Compilazione CRT, carica il modulo vuoto del nuovo fornitore e un esempio compilato. Axon lo riconosce automaticamente e lo aggiunge ai modelli disponibili." },
  { icon: "lock-closed-outline", q: "I dati dei miei clienti sono al sicuro?", a: "Tutti i dati dei clienti sono crittografati e accessibili solo a te e ai collaboratori che autorizzi. Nessun dato viene condiviso con terze parti." },
  { icon: "people-outline", q: "Posso condividere l'accesso con un collaboratore?", a: "Sì. Dal pannello Master puoi aggiungere collaboratori con livelli di accesso personalizzati — puoi decidere cosa possono vedere e cosa possono modificare." },
  { icon: "calendar-outline", q: "Come funziona il briefing pre-appuntamento di Axon?", a: "Prima di ogni appuntamento in calendario Axon ti invia un riepilogo automatico: chi incontri, cosa ha acquistato in passato, chi lo ha referenziato, le scadenze aperte e i punti da affrontare. Tutto senza che tu debba chiedere nulla." },
];

export default function FaqScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [open, setOpen] = useState<number | null>(0);
  const toggle = (i: number) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => (o === i ? null : i)); };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="faq-back"><Ionicons name="chevron-back" size={24} color={theme.color.onSurface} /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Domande frequenti</Text><Text style={styles.sub}>Le risposte rapide su Axon e AdvisorOS</Text></View>
        <View style={styles.headIcon}><Ionicons name="help-circle" size={22} color={theme.color.brandPrimary} /></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad + 24, gap: 10 }} testID="faq-list">
        {FAQ_ITEMS.map((it, i) => {
          const on = open === i;
          return (
            <Pressable key={it.q} onPress={() => toggle(i)} style={[styles.item, on && styles.itemOpen]} testID={`faq-item-${i}`} accessibilityRole="button" accessibilityState={{ expanded: on }}>
              <View style={styles.row}>
                <View style={[styles.icon, on && { backgroundColor: theme.color.brandPrimary }]}><Ionicons name={it.icon} size={18} color={on ? theme.color.onBrandPrimary : theme.color.brandPrimary} /></View>
                <Text style={[styles.q, on && { color: theme.color.brandPrimary }]}>{it.q}</Text>
                <Ionicons name={on ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
              </View>
              {on ? <Text style={styles.a} testID={`faq-answer-${i}`}>{it.a}</Text> : null}
            </Pressable>
          );
        })}

        <Pressable onPress={() => void Linking.openURL(LANDING_URL)} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} testID="faq-landing-link" accessibilityRole="link">
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Scopri di più su AxonOS</Text>
            <Text style={styles.ctaSub}>Il cervello dentro AdvisorOS: apre advisoros.it</Text>
          </View>
          <Ionicons name="open-outline" size={20} color={theme.color.onBrandPrimary} />
        </Pressable>
        <Text style={styles.foot}>Non trovi la risposta? Chiedi ad Axon dalla chat o scrivi al supporto dall&apos;Help Center.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: theme.color.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  headIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  item: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 14, gap: 10 },
  itemOpen: { borderColor: theme.color.brandSecondary, backgroundColor: theme.color.brandTertiary },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  q: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.color.onSurface, lineHeight: 20 },
  a: { fontSize: 14, lineHeight: 21, color: theme.color.onSurfaceTertiary, paddingLeft: 44 },
  cta: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.color.brandPrimary, borderRadius: 16, padding: 16, minHeight: 64 },
  ctaTitle: { color: theme.color.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  ctaSub: { color: theme.color.onBrandPrimary, opacity: 0.85, fontSize: 12, marginTop: 2 },
  foot: { fontSize: 12, color: theme.color.muted, textAlign: "center", marginTop: 4 },
});

// ComparisonPreview.tsx — V50.z252 — Anteprima in miniatura del PDF comparativo (dati di esempio)
// Usato nel pannello «Configura Analisi Fatture» mentre si scelgono stile, layout e sezioni.
// Web: iframe srcDoc · Nativo: react-native-webview. Il documento viene ridimensionato con CSS zoom per stare nel riquadro.
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { theme } from "@/src/theme";

/** Report di esempio con la stessa forma della risposta di /bills/comparison (1 fornitura luce). */
export const SAMPLE_COMPARISON_REPORT = {
  contact: { first_name: "Mario", last_name: "Rossi", contact_code: "CL-0042" },
  risparmio_totale_annuo_eur: 312,
  generated_at: new Date().toISOString(),
  items: [
    {
      bill_type: "luce",
      bill: { pdf_name: "bolletta-luce.pdf", extracted: { fornitore: "Enel Energia", spread: 0.045, costi_fissi: "12,50 €/mese", tipo_prezzo: "variabile" } },
      offer: { label: "Offerta Business Flex", extracted: { fornitore: "La tua azienda", nome_offerta: "Business Flex PUN", spread: 0.018, costi_fissi: "0,00 €", tipo_prezzo: "PUN + spread" } },
      comparison: {
        tipo_fornitura: "luce",
        sintesi: ["Spread ridotto del 60%", "Quota fissa azzerata", "Nessun vincolo di durata"],
        risparmio_annuo_stimato_eur: 312,
        raccomandazione: "consigliato",
        azione_consigliata: ["Presentare la proposta al cliente", "Raccogliere POD e documento", "Firmare il modulo di adesione"],
        impronta_energetica: { consumo_annuo_kwh_o_smc: 3200, unita: "kWh", profilo_utilizzo: "Consumo prevalente in fascia serale e weekend (F2/F3)", categoria_consumo: "medio", note: ["Profilo domestico standard"] },
        dettaglio_fasce: { F1_kwh: 1100, F2_kwh: 950, F3_kwh: 1150, F1_percent: 34.4, F2_percent: 29.7, F3_percent: 35.9, fascia_prevalente: "F3", raccomandazione_tariffa: "biorario", motivazione: "Oltre il 65% dei consumi fuori F1" },
        analisi_contratto_attuale: { fornitore: "Enel Energia", nome_offerta: "Energia Sicura", tipo_prezzo: "variabile", spread_eur_kwh_o_smc: 0.045, durata_contratto_mesi: 24, data_scadenza: "03/2027", criticita: ["Spread elevato rispetto al mercato", "Quota fissa 12,50 €/mese"], punti_forza: ["Fatturazione mensile"] },
        calcolo_risparmio: { costo_annuo_attuale_eur: 1480, costo_annuo_nuovo_eur: 1168, risparmio_annuo_eur: 312, risparmio_percentuale: 21.1, risparmio_mensile_eur: 26, dettaglio_calcolo: ["Spread: −86 €/anno", "Quota fissa: −150 €/anno", "Oneri commerciali: −76 €/anno"] },
        matrice_confronto: [
          { parametro: "Prezzo energia €/kWh", attuale: "0,185", proposta: "0,152", delta: "−0,033", vantaggio: "cliente" },
          { parametro: "Spread €/kWh", attuale: "0,045", proposta: "0,018", delta: "−0,027", vantaggio: "cliente" },
          { parametro: "Quota fissa mensile", attuale: "12,50 €", proposta: "0,00 €", delta: "−12,50 €", vantaggio: "cliente" },
          { parametro: "Durata contratto", attuale: "24 mesi", proposta: "Nessun vincolo", delta: "—", vantaggio: "cliente" },
          { parametro: "Penale disdetta", attuale: "50 €", proposta: "0 €", delta: "−50 €", vantaggio: "cliente" },
        ],
        executive_summary: { verdetto: "Passaggio fortemente consigliato", risparmio_annuo_eur: 312, punti_chiave: ["Risparmio 21,1% sul costo annuo", "Zero quota fissa", "Massima flessibilità"], prossimi_passi: ["Presentare proposta", "Firma modulo", "Attivazione in 30 giorni"] },
      },
    },
  ],
};

/** Larghezza del documento in px CSS: slide A4 orizzontale (297mm) o pagina A4 verticale (210mm). */
export function previewDocWidth(layout?: string): number {
  return layout === "presentazione" || !layout ? 1123 : 794;
}

/** Inietta nel documento la regola di ridimensionamento per la miniatura. */
export function scaleHtmlForPreview(html: string, docWidth: number, containerWidth: number): string {
  const s = Math.max(0.1, Math.min(1, containerWidth / docWidth));
  const css = `<meta name="viewport" content="width=device-width, initial-scale=1"/><style>
    html{width:${docWidth}px;overflow-x:hidden;background:transparent}
    body{width:${docWidth}px;zoom:${s.toFixed(4)};-webkit-text-size-adjust:none}
    .slide{width:${docWidth}px !important}
  </style>`;
  return html.includes("</head>") ? html.replace("</head>", css + "</head>") : css + html;
}

type Props = { html: string; layout?: string; height?: number; testID?: string };

export function ComparisonPreview({ html, layout, height = 300, testID = "comparison-preview" }: Props) {
  const [width, setWidth] = useState(0);
  const docWidth = previewDocWidth(layout);
  const scaled = useMemo(() => (width ? scaleHtmlForPreview(html, docWidth, width) : ""), [html, docWidth, width]);
  return (
    <View style={[styles.frame, { height }]} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} testID={testID}>
      {!scaled ? (
        <ActivityIndicator color={theme.color.muted} style={{ marginTop: 40 }} />
      ) : Platform.OS === "web" ? (
        // eslint-disable-next-line react-native/no-inline-styles
        <iframe title="Anteprima comparativa" srcDoc={scaled} style={{ width: "100%", height: "100%", border: "none", background: "transparent" }} />
      ) : (
        <WebView source={{ html: scaled }} originWhitelist={["*"]} style={{ flex: 1, backgroundColor: "transparent" }} scrollEnabled nestedScrollEnabled showsHorizontalScrollIndicator={false} />
      )}
      <View style={styles.badge} pointerEvents="none">
        <Text style={styles.badgeTxt}>ANTEPRIMA · dati di esempio</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, overflow: "hidden", backgroundColor: theme.color.surfaceTertiary, position: "relative" },
  badge: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(17,24,32,0.72)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
});

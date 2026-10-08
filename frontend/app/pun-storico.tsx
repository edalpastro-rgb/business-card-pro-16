// app/pun-storico.tsx — V50.z469 — Feature 5/15: «Storico PUN». Aperto dal widget PUN della Home.
// Tabella ultimi 18 mesi (Mese · Monorario · F1 · F2 · F3 in €/kWh) dai dati GME in cache backend (`GET /pun/history`),
// mese corrente parziale evidenziato in giallo, max/min in rosso/verde. PDF: nativo → expo-print + share sheet (offline con i
// dati già caricati); web → PDF reportlab dal backend (`GET /pun/history/pdf`, download affidabile).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api, BACKEND_URL, getAuthHeader } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { fetchOrgSignature } from "@/src/BrandHeaderImage";
import { track } from "@/src/utils/beta"; // V50.z474

type Row = { month_key: string; label: string; available: boolean; F1: number | null; F2: number | null; F3: number | null; monorario: number | null; delta_pct: number | null; is_max: string[]; is_min: string[]; kind: "closed" | "partial" | "forecast" | "provisional"; basis?: string; days?: number };
type History = { months: number; unit: string; rows: Row[]; missing: string[]; cache_updated_at: string | null; source: string };

const fmt = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(4).replace(".", ",") : "n/d");
const kindTag = (r: Row) => (r.kind === "partial" ? `parziale${r.days ? ` 1–${r.days}` : ""}` : r.kind === "forecast" ? "previsione" : r.kind === "provisional" ? "provvisorio" : "");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildHtml(h: History, orgSig: string): string {
  const upd = h.cache_updated_at ? new Date(h.cache_updated_at).toLocaleDateString("it-IT") : "—";
  const rows = h.rows.map((r) => {
    const tint = r.kind !== "closed" ? "#FEF9C3" : r.is_max.includes("monorario") ? "#FEE2E2" : r.is_min.includes("monorario") ? "#DCFCE7" : "";
    const d = r.delta_pct == null ? "—" : `${r.delta_pct > 0 ? "+" : ""}${String(r.delta_pct).replace(".", ",")}%`;
    const tag = kindTag(r);
    if (!r.available) return `<tr><td>${esc(r.label)}</td><td colspan="5" class="m">n/d — PDF GME non in cache</td></tr>`;
    return `<tr style="background:${tint}"><td><b>${esc(r.label)}</b>${tag ? ` <span class="m">(${tag})</span>` : ""}</td><td class="c">${fmt(r.monorario)}</td><td class="c">${fmt(r.F1)}</td><td class="c">${fmt(r.F2)}</td><td class="c">${fmt(r.F3)}</td><td class="c">${d}</td></tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:14mm} body{font-family:-apple-system,Helvetica,Arial;color:#1B2B4B;font-size:12px}
  h1{margin:0 0 4px;font-size:20px} .sub{color:#64748B;font-size:11px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse} th{background:#1B2B4B;color:#fff;text-align:left;padding:7px 8px;font-size:11px} th.c,td.c{text-align:right} td{padding:7px 8px;border-bottom:1px solid #E2E8F0}
  .m{color:#64748B;font-size:10px} .foot{margin-top:14px;font-size:10px;color:#64748B;line-height:1.5} .sig{text-align:center;font-size:11px;color:#475569;margin-top:18px}
  </style></head><body>
  <h1>⚡ Storico PUN — ultimi ${h.months} mesi (€/kWh)</h1>
  <div class="sub">${esc(h.source)} · Dati aggiornati al ${upd} · Generato con AdvisorOS il ${new Date().toLocaleDateString("it-IT")}</div>
  <table><thead><tr><th>Mese</th><th class="c">Monorario</th><th class="c">F1</th><th class="c">F2</th><th class="c">F3</th><th class="c">Δ mese</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="foot">Legenda: rosso = mese più caro (monorario) · verde = mese più economico · giallo = mese corrente (media parziale GME, non definitiva).<br/>Fasce ARERA: F1 lun–ven 8–19 · F2 lun–ven 7–8 e 19–23, sabato 7–23 · F3 notte, domeniche e festivi. Prezzi all'ingrosso, IVA e oneri esclusi.</div>
  ${orgSig ? `<div class="sig">${esc(orgSig)}</div>` : ""}
  </body></html>`;
}

export default function PunStoricoScreen() {
  const router = useRouter();
  const [data, setData] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    try { setData(await api<History>("/pun/history?months=18")); }
    catch (e: any) { notify("Storico PUN", e?.message || "Dati non disponibili"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); track("pun_history"); }, [load]);

  const rowsDesc = useMemo(() => (data ? [...data.rows].reverse() : []), [data]); // più recente in alto (mobile-friendly)

  const exportPdf = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      if (Platform.OS === "web") {
        const res = await fetch(`${BACKEND_URL}/api/pun/history/pdf?months=18`, { headers: await getAuthHeader() });
        if (!res.ok) throw new Error(`Errore server (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `Storico_PUN_18_mesi.pdf`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        notify("PDF pronto", "Storico PUN scaricato");
        return;
      }
      const html = buildHtml(data, await fetchOrgSignature());
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Storico PUN 18 mesi" });
      else notify("PDF creato", uri);
    } catch (e: any) { notify("Errore PDF", e?.message || "Impossibile generare il PDF"); }
    finally { setBusy(false); }
  };

  const upd = data?.cache_updated_at ? new Date(data.cache_updated_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : null;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as any))} style={s.back} hitSlop={8} testID="pun-storico-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Storico PUN</Text>
          <Text style={s.hSub}>{upd ? `Ultimi 18 mesi · €/kWh · agg. ${upd}` : "Ultimi 18 mesi · €/kWh"}</Text>
        </View>
        <Pressable onPress={exportPdf} disabled={!data || busy} style={[s.pdfBtn, (!data || busy) && { opacity: 0.5 }]} testID="pun-storico-pdf">
          {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={Platform.OS === "web" ? "download-outline" : "share-outline"} size={18} color="#FFF" />}
          <Text style={s.pdfTxt}>PDF</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} /> : !data ? (
        <View style={s.body} testID="pun-storico-empty">
          <View style={[s.table, { padding: 20, alignItems: "center", gap: 10 }]}>
            <Ionicons name="cloud-offline-outline" size={30} color={HT.muted} />
            <Text style={[s.month, { textAlign: "center" }]}>Storico PUN non disponibile</Text>
            <Text style={[s.foot, { textAlign: "center", marginTop: 0 }]}>Il server non ha risposto. Controlla la connessione e riprova.</Text>
            <Pressable onPress={() => { setLoading(true); load(); }} style={[s.pdfBtn, { marginTop: 6 }]} testID="pun-storico-retry"><Ionicons name="refresh" size={16} color="#FFF" /><Text style={s.pdfTxt}>Riprova</Text></Pressable>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.body} testID="pun-storico-screen" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={HT.brand} />}>
          <View style={s.legend}>
            <LegendDot color="#FEF9C3" label="Mese corrente (parziale)" /><LegendDot color="#FEE2E2" label="Più caro" /><LegendDot color="#DCFCE7" label="Più economico" />
          </View>
          <View style={s.table}>
            <View style={[s.tr, s.th]}>
              <Text style={[s.cMonth, s.thTxt]}>Mese</Text>
              <Text style={[s.cVal, s.thTxt]}>Mono</Text>
              <Text style={[s.cVal, s.thTxt, { color: HT.axon }]}>F1</Text>
              <Text style={[s.cVal, s.thTxt, { color: "#FB923C" }]}>F2</Text>
              <Text style={[s.cVal, s.thTxt, { color: HT.success }]}>F3</Text>
            </View>
            {rowsDesc.map((r) => {
              const tint = r.kind !== "closed" ? "#FEF9C322" : r.is_max.includes("monorario") ? "#FEE2E233" : r.is_min.includes("monorario") ? "#DCFCE733" : "transparent";
              const tag = kindTag(r);
              return (
                <View key={r.month_key} style={[s.tr, { backgroundColor: tint }]} testID={`pun-row-${r.month_key}`}>
                  <View style={s.cMonth}>
                    <Text style={s.month} numberOfLines={1}>{r.label}</Text>
                    {tag ? <Text style={s.tag}>{tag}</Text> : r.delta_pct != null ? <Text style={[s.tag, { color: r.delta_pct > 0 ? HT.danger : HT.success }]}>{r.delta_pct > 0 ? "+" : ""}{String(r.delta_pct).replace(".", ",")}%</Text> : null}
                  </View>
                  {r.available ? (
                    <>
                      <Text style={[s.cVal, s.val, { fontWeight: "900" }]}>{fmt(r.monorario)}</Text>
                      <Text style={[s.cVal, s.val]}>{fmt(r.F1)}</Text>
                      <Text style={[s.cVal, s.val]}>{fmt(r.F2)}</Text>
                      <Text style={[s.cVal, s.val]}>{fmt(r.F3)}</Text>
                    </>
                  ) : <Text style={[s.nd]}>n/d — PDF GME non in cache</Text>}
                </View>
              );
            })}
          </View>
          <Text style={s.foot}>{data.source}. Fasce ARERA: F1 lun–ven 8–19 · F2 lun–ven 7–8 e 19–23, sabato 7–23 · F3 notte, domeniche e festivi. Prezzi all&apos;ingrosso, IVA e oneri esclusi.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (<View style={s.legItem}><View style={[s.legDot, { backgroundColor: color }]} /><Text style={s.legTxt}>{label}</Text></View>);
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "900", color: HT.text },
  hSub: { fontSize: 11, color: HT.muted, fontWeight: "600" },
  pdfBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.brand, paddingHorizontal: 14, height: 44, borderRadius: 12 },
  pdfTxt: { color: "#FFF", fontWeight: "900", fontSize: 13 },
  body: { padding: 12, paddingBottom: 40 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  legItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legDot: { width: 12, height: 12, borderRadius: 4, borderWidth: 1, borderColor: HT.border },
  legTxt: { fontSize: 11, color: HT.muted, fontWeight: "600" },
  table: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HT.border, minHeight: 44 },
  th: { backgroundColor: HT.glassStrong },
  thTxt: { fontSize: 11, fontWeight: "900", color: HT.muted, letterSpacing: 0.5 },
  cMonth: { flex: 1.5 },
  cVal: { flex: 1, textAlign: "right" },
  month: { fontSize: 13, fontWeight: "800", color: HT.text },
  tag: { fontSize: 10, fontWeight: "700", color: HT.muted, marginTop: 1 },
  val: { fontSize: 12, fontWeight: "700", color: HT.text, fontVariant: ["tabular-nums"] },
  nd: { flex: 4, textAlign: "right", fontSize: 11, color: HT.muted, fontStyle: "italic" },
  foot: { fontSize: 11, color: HT.muted, lineHeight: 16, marginTop: 12 },
});

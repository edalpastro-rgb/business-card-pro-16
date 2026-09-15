// kmReportPdf.ts — V50.z253 — Resoconto Km mensile in PDF per note spese (expo-print → share; web: stampa).
import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { notify } from "@/src/utils/notify";
import { fetchOrgSignature } from "@/src/BrandHeaderImage";

export type KmEntry = { entry_id: string; date: string; route_id: string; seq: number; contact_id?: string | null; contact_name: string; address?: string; origin_label?: string; km: number; created_at?: string };
export type KmDay = { date: string; km: number; visits: number };

const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const fmtKm = (n: number) => (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};
const dayLabel = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });

export function buildKmReportHtml(month: string, items: KmEntry[], byDay: KmDay[], orgSig: string, userName?: string, ratePerKm?: number): string {
  const totalKm = items.reduce((a, e) => a + (Number(e.km) || 0), 0);
  const days = [...byDay].sort((a, b) => a.date.localeCompare(b.date));
  const rows = days.map((d) => {
    const es = items.filter((e) => e.date === d.date).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    const first = `<tr class="day"><td rowspan="${es.length}" class="d">${esc(dayLabel(d.date))}</td>`;
    return es.map((e, i) => `${i === 0 ? first : "<tr>"}<td>${esc(e.contact_name)}${e.seq === 0 ? ' <span class="m">(rientro)</span>' : ""}</td><td class="m">${esc(e.address || e.origin_label || "")}</td><td class="c">${fmtKm(e.km)}</td>${i === 0 ? `<td rowspan="${es.length}" class="c b">${fmtKm(d.km)}</td>` : ""}</tr>`).join("");
  }).join("");
  const rimb = ratePerKm ? `<div class="box"><span>Rimborso (${ratePerKm.toLocaleString("it-IT")} €/km)</span><b>€ ${(totalKm * ratePerKm).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:14mm} body{font-family:-apple-system,Helvetica,Arial;color:#1B2B4B;font-size:12px}
  .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0EA5E9;padding-bottom:8px;margin-bottom:12px}
  h1{margin:0;font-size:20px;text-transform:capitalize} .sub{color:#64748B;font-size:12px;margin-top:2px} .brand{font-size:11px;color:#64748B;text-align:right}
  .sum{display:flex;gap:10px;margin:10px 0 14px} .box{flex:1;background:#F1F5F9;border-radius:10px;padding:10px} .box b{display:block;font-size:17px;color:#1B2B4B} .box span{font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:.4px}
  table{width:100%;border-collapse:collapse} th{background:#1B2B4B;color:#fff;text-align:left;padding:7px 8px;font-size:11px} td{padding:7px 8px;border-bottom:1px solid #E2E8F0;vertical-align:top}
  td.d{font-weight:800;white-space:nowrap;background:#F8FAFC;border-right:1px solid #E2E8F0} td.c{text-align:right;white-space:nowrap} td.b{font-weight:800;background:#F8FAFC} .m{color:#64748B;font-size:10px}
  tfoot td{font-weight:900;background:#1B2B4B;color:#fff;border:0} .foot{margin-top:16px;font-size:10px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:8px} .sig{text-align:center;font-size:11px;color:#475569;margin-top:18px}
  .firma{display:flex;justify-content:space-between;margin-top:34px;font-size:11px;color:#475569} .firma div{width:45%;border-top:1px solid #94A3B8;padding-top:6px;text-align:center}
  </style></head><body>
  <div class="hd"><div><h1>🚗 Resoconto Km · ${esc(monthLabel(month))}</h1><div class="sub">Nota spese chilometrica${userName ? ` · ${esc(userName)}` : ""}</div></div><div class="brand">AdvisorOS · AxonOS</div></div>
  <div class="sum"><div class="box"><span>Km totali</span><b>${fmtKm(totalKm)} km</b></div><div class="box"><span>Visite</span><b>${items.length}</b></div><div class="box"><span>Giorni in viaggio</span><b>${days.length}</b></div>${rimb}</div>
  <table><thead><tr><th>Giorno</th><th>Cliente / tappa</th><th>Indirizzo</th><th style="text-align:right">Km tratta</th><th style="text-align:right">Km giorno</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="5" class="m">Nessuna visita registrata nel mese.</td></tr>`}</tbody>
  <tfoot><tr><td colspan="3">TOTALE MESE</td><td class="c">${fmtKm(totalKm)}</td><td class="c">${fmtKm(totalKm)} km</td></tr></tfoot></table>
  <div class="firma"><div>Firma del collaboratore</div><div>Visto dell'azienda</div></div>
  <div class="foot">Km calcolati dal percorso del Giro Ottimale (distanza stradale stimata: linea d'aria × 1,3), registrati alla spunta «Visita completata». Non derivano dal GPS reale. Generato con AdvisorOS il ${new Date().toLocaleString("it-IT")}.</div>
  ${orgSig ? `<div class="sig">${esc(orgSig)}</div>` : ""}
  </body></html>`;
}

export async function exportKmReportPdf(month: string, items: KmEntry[], byDay: KmDay[], userName?: string, ratePerKm?: number): Promise<void> {
  const orgSig = await fetchOrgSignature();
  const html = buildKmReportHtml(month, items, byDay, orgSig, userName, ratePerKm);
  try {
    if (Platform.OS === "web") { await Print.printAsync({ html }); return; }
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `Resoconto Km ${monthLabel(month)}` });
    else notify("PDF creato", uri);
  } catch (e: any) { notify("Errore", e?.message || "Impossibile generare il PDF"); }
}

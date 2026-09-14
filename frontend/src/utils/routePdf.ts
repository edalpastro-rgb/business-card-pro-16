// routePdf.ts — V50.z241 — FEAT-GEO-001 Fase 2: esporta l'itinerario del Giro Ottimale in PDF (expo-print → share sheet;
// web: finestra di stampa). Include orari stimati per tappa (partenza scelta dall'utente), km/min, telefono, firma aziendale.
import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { notify } from "@/src/utils/notify";
import { fetchOrgSignature } from "@/src/BrandHeaderImage";

export type RouteLegPdf = { seq: number; name: string; company?: string; address: string; phone?: string; leg_km: number; leg_min: number; cum_km: number; cum_min: number };
export type RoutePdfData = { origin: { label: string }; legs: RouteLegPdf[]; return: { leg_km: number; leg_min: number } | null; total_km: number; drive_min: number; stop_min: number; total_min: number };

const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min` : `${m} min`);
const hhmm = (d: Date) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

/** Orari stimati: partenza `startAt`; ogni tappa = arrivo dopo la guida, sosta `stopMin`. */
export function estimateTimes(res: RoutePdfData, startAt: Date, stopMin = 15): { arrive: Date; leave: Date }[] {
  let t = startAt.getTime();
  return res.legs.map((l) => { t += l.leg_min * 60000; const arrive = new Date(t); t += stopMin * 60000; return { arrive, leave: new Date(t) }; });
}

export function buildRouteHtml(res: RoutePdfData, startAt: Date, orgSig: string, userName?: string): string {
  const times = estimateTimes(res, startAt);
  const day = startAt.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const rows = res.legs.map((l, i) => `<tr><td class="n">${l.seq}</td><td><b>${esc(l.name)}</b>${l.company ? `<br/><span class="m">${esc(l.company)}</span>` : ""}</td><td>${esc(l.address)}</td><td>${l.phone ? esc(l.phone) : "—"}</td><td class="c">${hhmm(times[i].arrive)}<br/><span class="m">parti ${hhmm(times[i].leave)}</span></td><td class="c">+${l.leg_km} km<br/><span class="m">+${l.leg_min} min</span></td></tr>`).join("");
  const ret = res.return ? `<tr class="ret"><td class="n">🏁</td><td colspan="3"><b>Ritorno a ${esc(res.origin.label)}</b></td><td class="c">${hhmm(new Date((times[times.length - 1]?.leave || startAt).getTime() + res.return.leg_min * 60000))}</td><td class="c">+${res.return.leg_km} km<br/><span class="m">+${res.return.leg_min} min</span></td></tr>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:14mm} body{font-family:-apple-system,Helvetica,Arial;color:#1B2B4B;font-size:12px}
  .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #FF6B35;padding-bottom:8px;margin-bottom:12px}
  h1{margin:0;font-size:20px} .sub{color:#64748B;font-size:12px;margin-top:2px} .brand{font-size:11px;color:#64748B;text-align:right}
  .sum{display:flex;gap:10px;margin:10px 0 14px} .box{flex:1;background:#F1F5F9;border-radius:10px;padding:10px} .box b{display:block;font-size:17px;color:#1B2B4B} .box span{font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:.4px}
  table{width:100%;border-collapse:collapse} th{background:#1B2B4B;color:#fff;text-align:left;padding:7px 8px;font-size:11px} td{padding:8px;border-bottom:1px solid #E2E8F0;vertical-align:top}
  td.n{width:28px;text-align:center;font-weight:900;color:#fff;background:#FF6B35;border-radius:999px} td.c{text-align:center;white-space:nowrap} .m{color:#64748B;font-size:10px} tr.ret td{background:#F0FDF4}
  .foot{margin-top:16px;font-size:10px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:8px} .sig{text-align:center;font-size:11px;color:#475569;margin-top:18px}
  </style></head><body>
  <div class="hd"><div><h1>🚗 Giro Ottimale · ${esc(day)}</h1><div class="sub">Partenza ${hhmm(startAt)} da ${esc(res.origin.label)}${userName ? ` · ${esc(userName)}` : ""}</div></div><div class="brand">AdvisorOS · AxonOS</div></div>
  <div class="sum"><div class="box"><span>Clienti</span><b>${res.legs.length}</b></div><div class="box"><span>Distanza</span><b>${res.total_km} km</b></div><div class="box"><span>Guida</span><b>${fmtMin(res.drive_min)}</b></div><div class="box"><span>Totale con soste</span><b>${fmtMin(res.total_min)}</b></div></div>
  <table><thead><tr><th>#</th><th>Cliente</th><th>Indirizzo</th><th>Telefono</th><th style="text-align:center">Arrivo</th><th style="text-align:center">Tratta</th></tr></thead><tbody>${rows}${ret}</tbody></table>
  <div class="foot">Stima su strada senza traffico (distanza in linea d'aria × 1,3 · 45 km/h · sosta ${15} min per cliente). Generato con AdvisorOS il ${new Date().toLocaleString("it-IT")}.</div>
  ${orgSig ? `<div class="sig">${esc(orgSig)}</div>` : ""}
  </body></html>`;
}

export async function exportRoutePdf(res: RoutePdfData, startAt: Date, userName?: string): Promise<void> {
  const orgSig = await fetchOrgSignature();
  const html = buildRouteHtml(res, startAt, orgSig, userName);
  try {
    if (Platform.OS === "web") { await Print.printAsync({ html }); return; }
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Itinerario Giro Ottimale" });
    else notify("PDF creato", uri);
  } catch (e: any) { notify("Errore", e?.message || "Impossibile generare il PDF"); }
}

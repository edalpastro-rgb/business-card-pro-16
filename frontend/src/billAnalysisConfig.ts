// billAnalysisConfig.ts — tipi + helper del pannello «Configura Analisi Fatture» (GET/PUT /bills/analysis-config).
// Il backend (routes/bill_analysis_config.py) è la fonte di verità per catalogo e default.
import { api } from "@/src/api";

export type BAType = "luce" | "gas" | "telco";

export type BACatalogItem = {
  id: string;
  label: string;
  default_on?: boolean;
  desc?: string;
  primary?: string;
  bg?: string;
  accent?: string;
};

export type BAComparisonConfig = {
  layout: string;
  style: string;
  sections: Record<string, boolean>;
  compare_fields: Record<BAType, Record<string, boolean>>;
  custom_compare_fields: Record<BAType, string[]>;
  basis: string;
  instructions: string;
};

export type BillAnalysisConfig = {
  fields: Record<BAType, Record<string, boolean>>;
  custom_fields: Record<BAType, string[]>;
  extra_instructions: string;
  comparison: BAComparisonConfig;
};

export type BillAnalysisCatalog = {
  fields: Record<BAType, BACatalogItem[]>;
  compare_fields: Record<BAType, BACatalogItem[]>;
  sections: BACatalogItem[];
  layouts: BACatalogItem[];
  styles: BACatalogItem[];
  bases: BACatalogItem[];
};

export type BAPreset = { preset_id: string; name: string; config: BillAnalysisConfig; created_at?: string; updated_at?: string };

export type BillAnalysisBundle = { config: BillAnalysisConfig; catalog: BillAnalysisCatalog; presets: BAPreset[]; active_preset_id?: string | null };

export async function loadBillAnalysisConfig(): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>("/bills/analysis-config");
}

export async function saveBillAnalysisConfig(config: BillAnalysisConfig, preset_id?: string | null): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>("/bills/analysis-config", { method: "PUT", body: { config, preset_id: preset_id || null } });
}

export async function resetBillAnalysisConfig(): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>("/bills/analysis-config/reset", { method: "POST" });
}

export async function savePreset(name: string, config: BillAnalysisConfig): Promise<{ preset: BAPreset; items: BAPreset[] }> {
  return api("/bills/analysis-presets", { method: "POST", body: { name, config } });
}

export async function deletePreset(preset_id: string): Promise<{ items: BAPreset[] }> {
  return api(`/bills/analysis-presets/${preset_id}`, { method: "DELETE" });
}

export async function applyPreset(preset_id: string): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>(`/bills/analysis-presets/${preset_id}/apply`, { method: "POST" });
}

/** Etichette spuntate + campi personalizzati per un tipo fattura, data una configurazione e il catalogo. */
export function labelsFor(config: BillAnalysisConfig, catalog: BillAnalysisCatalog, bt: BAType): { labels: string[]; custom: string[] } {
  const flags = config.fields?.[bt] || {};
  const labels = (catalog.fields?.[bt] || [])
    .filter((f) => flags[f.id] ?? f.default_on ?? true)
    .map((f) => f.label);
  return { labels, custom: config.custom_fields?.[bt] || [] };
}

/** Etichette pre-spuntate per una nuova analisi, secondo la configurazione attiva.
 *  Ritorna null se la configurazione non è ancora caricata (il chiamante usa i default locali). */
export function configuredDefaults(bundle: BillAnalysisBundle | null, bt: BAType): { labels: string[]; custom: string[] } | null {
  if (!bundle) return null;
  return labelsFor(bundle.config, bundle.catalog, bt);
}

/** Conteggio rapido per il badge del pulsante «Configura Analisi Fatture». */
export function configSummary(bundle: BillAnalysisBundle | null): string {
  if (!bundle) return "";
  const c = bundle.config;
  const customCount = (["luce", "gas", "telco"] as BAType[]).reduce((n, bt) => n + (c.custom_fields?.[bt]?.length || 0), 0);
  const layout = bundle.catalog.layouts.find((l) => l.id === c.comparison?.layout)?.label || "";
  const active = bundle.presets?.find((p) => p.preset_id === bundle.active_preset_id)?.name;
  const bits: string[] = [];
  if (active) bits.push(`Preset «${active}»`);
  if (layout) bits.push(layout);
  if (customCount) bits.push(`${customCount} campi extra`);
  if (c.extra_instructions?.trim()) bits.push("richieste manuali");
  return bits.join(" · ");
}

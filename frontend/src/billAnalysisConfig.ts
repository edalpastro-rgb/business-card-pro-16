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

export type BillAnalysisBundle = { config: BillAnalysisConfig; catalog: BillAnalysisCatalog };

export async function loadBillAnalysisConfig(): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>("/bills/analysis-config");
}

export async function saveBillAnalysisConfig(config: BillAnalysisConfig): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>("/bills/analysis-config", { method: "PUT", body: { config } });
}

export async function resetBillAnalysisConfig(): Promise<BillAnalysisBundle> {
  return api<BillAnalysisBundle>("/bills/analysis-config/reset", { method: "POST" });
}

/** Etichette pre-spuntate per una nuova analisi, secondo la configurazione salvata.
 *  Ritorna null se la configurazione non è ancora caricata (il chiamante usa i default locali). */
export function configuredDefaults(bundle: BillAnalysisBundle | null, bt: BAType): { labels: string[]; custom: string[] } | null {
  if (!bundle) return null;
  const flags = bundle.config.fields?.[bt] || {};
  const labels = (bundle.catalog.fields?.[bt] || [])
    .filter((f) => flags[f.id] ?? f.default_on ?? true)
    .map((f) => f.label);
  const custom = bundle.config.custom_fields?.[bt] || [];
  return { labels, custom };
}

/** Conteggio rapido per il badge del pulsante «Configura Analisi Fatture». */
export function configSummary(bundle: BillAnalysisBundle | null): string {
  if (!bundle) return "";
  const c = bundle.config;
  const customCount = (["luce", "gas", "telco"] as BAType[]).reduce((n, bt) => n + (c.custom_fields?.[bt]?.length || 0), 0);
  const layout = bundle.catalog.layouts.find((l) => l.id === c.comparison?.layout)?.label || "";
  const bits: string[] = [];
  if (layout) bits.push(layout);
  if (customCount) bits.push(`${customCount} campi extra`);
  if (c.extra_instructions?.trim()) bits.push("richieste manuali");
  return bits.join(" · ");
}

/**
 * Master module — strict TypeScript types.
 * Master shares BillType/BillStatus/EnergyBill from invoice-analysis (architectural symmetry).
 */
import type { BillType, BillStatus, EnergyBill } from "@/modules/invoice-analysis";

export type { BillType, BillStatus, EnergyBill };

export type MasterCategory = "notes" | "bills" | "audio" | "files" | "analisi";

export type MasterFile = {
  file_id: string;
  category: MasterCategory;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  data_base64?: string;
};

export type Contract = {
  contract_id: string;
  contact_id?: string;
  status?: string;
  created_at: string;
  amount?: number;
  notes?: string;
};

export type WebLink = { link_id: string; name: string; url: string; icon?: string };

/**
 * Invoice Analysis module — strict TypeScript types.
 */

export type BillType = "luce" | "gas" | "telco";
export type BillStatus = "pending" | "analyzing" | "done" | "error" | "cancelled";

export type EnergyBill = {
  bill_id: string;
  contact_id: string;
  bill_type: BillType;
  status: BillStatus;
  pdf_name?: string;
  pdf_mime?: string;
  created_at: string;
  fornitore?: string;
  parsed_data?: Record<string, unknown>;
  analysis_params?: string[];
  error_message?: string;
};

export type BillCreateInput = {
  bill_type: BillType;
  pdf_base64: string;
  pdf_name: string;
  pdf_mime: string;
  analysis_params?: string[];
};

export type CompanyOffer = {
  offer_id: string;
  bill_type: BillType;
  name?: string;
  created_at: string;
  parsed_data?: Record<string, unknown>;
};

export type BillGrouped = { luce: EnergyBill[]; gas: EnergyBill[]; telco: EnergyBill[] };

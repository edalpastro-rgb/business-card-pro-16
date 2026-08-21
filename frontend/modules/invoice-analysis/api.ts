/**
 * Invoice Analysis module — backend calls with Result<T>.
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type { EnergyBill, BillCreateInput, BillGrouped, CompanyOffer } from "./types";

export function listContactBills(contactId: string): Promise<Result<{ items: EnergyBill[]; grouped: BillGrouped }>> {
  return apiCall<{ items: EnergyBill[]; grouped: BillGrouped }>(`/contacts/${contactId}/bills`);
}

export function createBill(contactId: string, body: BillCreateInput): Promise<Result<EnergyBill>> {
  return apiCall<EnergyBill>(`/contacts/${contactId}/bills`, { method: "POST", body });
}

export function reanalyzeBill(contactId: string, billId: string): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/contacts/${contactId}/bills/${billId}/reanalyze`, { method: "POST" });
}

export function cancelBillAnalysis(contactId: string, billId: string): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/contacts/${contactId}/bills/${billId}/cancel`, { method: "POST" });
}

export function deleteBill(contactId: string, billId: string): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/contacts/${contactId}/bills/${billId}`, { method: "DELETE" });
}

export function getBillReport(contactId: string): Promise<Result<Record<string, unknown>>> {
  return apiCall<Record<string, unknown>>(`/contacts/${contactId}/bills/report`);
}

export function getBillComparison(contactId: string): Promise<Result<Record<string, unknown>>> {
  return apiCall<Record<string, unknown>>(`/contacts/${contactId}/bills/comparison`);
}

export function listCompanyOffers(): Promise<Result<{ items: CompanyOffer[] }>> {
  return apiCall<{ items: CompanyOffer[] }>("/company-offers");
}

/**
 * Master module — backend calls with Result<T>.
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type { MasterFile, Contract, WebLink } from "./types";

export function listMasterFiles(query?: Record<string, string | number | boolean>): Promise<Result<{ items: MasterFile[] }>> {
  return apiCall<{ items: MasterFile[] }>("/master-files", { query });
}

export function createMasterFile(body: Omit<MasterFile, "file_id" | "created_at">): Promise<Result<MasterFile>> {
  return apiCall<MasterFile>("/master-files", { method: "POST", body });
}

export function deleteMasterFile(fileId: string): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/master-files/${fileId}`, { method: "DELETE" });
}

export function listContracts(): Promise<Result<{ items: Contract[] }>> {
  return apiCall<{ items: Contract[] }>("/contracts");
}

export function getNewContractAlerts(): Promise<Result<{ count: number }>> {
  return apiCall<{ count: number }>("/contracts/new-alerts");
}

export function markContractsSeen(): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>("/contracts/mark-seen", { method: "POST" });
}

export function listWebLinks(): Promise<Result<{ items: WebLink[] }>> {
  return apiCall<{ items: WebLink[] }>("/web-links");
}

/**
 * V50.z343 — Axon Lab: tipi + helper condivisi (Area Master addestramento / Area Consulente business).
 */
import { Platform } from "react-native";
import * as Print from "expo-print"; // V50.z357 — Step 9: stampa WiFi/AirPrint/Bluetooth via servizio di stampa di sistema
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { api } from "@/src/api";

export type LabDocSpec = { id: string; label: string; mode: "upload" | "manual_or_upload" | "manual" | "stamp"; hint: string; manual_keys?: string[]; derived?: [string, string] };
export type LabDocEntry = { status: "none" | "uploaded" | "confirmed"; files: { name: string; mime: string; size?: number }[]; extracted: Record<string, string>; values: Record<string, string>; derived_from?: string; reused_from?: string; has_image?: boolean; source?: string };
export type LabDossier = { docs: Record<string, LabDocEntry>; extra: { id: string; label: string; value: string }[]; completion: { confirmed: number; uploaded: number; total: number; percent: number } };
export type LabSource = { id: string; label: string; group: string; sample?: string; doc?: string; key?: string };
export type LabField = { id: string; key: string; label: string; kind: string; page: number; bbox: number[]; skip?: boolean };
export type LabModule = { template_id: string; name: string; field_count: number; mapping_count: number; trained: boolean; mapping_source?: string; fields?: LabField[]; mapping?: Record<string, string>; sources?: LabSource[]; page_count?: number; lab_has_example?: boolean; examples?: { id: string; name?: string | null; fields: number; uploaded_at?: string }[]; examples_count?: number };
export type LabForm = { form_id: string; template_id: string; template_name: string; name: string; values: Record<string, string>; sources: Record<string, string>; rules?: Record<string, string>; missing: { field_id: string; key: string; label: string; reason?: string }[] };
export type LabPractice = LabDossier & { practice_id: string; contact_id: string; contact_name: string; company?: string; template_ids: string[]; form_ids: string[]; sign_date: string; sign_place: string; status: "docs" | "review" | "done"; forms?: LabForm[]; modules?: LabModule[]; updated_at?: string; archived_at?: string };

export const STATUS_LABEL: Record<string, string> = { none: "Non caricato", uploaded: "Caricato", confirmed: "Confermato" };

export function specialLabel(rule: string, sources: LabSource[]): string {
  const s = sources.find((x) => x.id === rule);
  if (s) return s.label;
  if (rule === "manual") return "Chiedi al consulente";
  if (rule === "empty") return "Lascia vuoto";
  if (rule === "sign_date") return "Data (fine compilazione)";
  if (rule === "sign_place") return "Luogo (fine compilazione)";
  if (rule === "stamp.image") return "Timbro aziendale";
  return rule;
}

export async function sharePdfBase64(name: string, b64: string): Promise<void> {
  if (Platform.OS === "web") {
    const a = (globalThis as any).document?.createElement("a");
    if (!a) return;
    a.href = `data:application/pdf;base64,${b64}`; a.download = name; a.click();
    return;
  }
  const path = `${FileSystem.cacheDirectory}${name.replace(/[^\w.\-]+/g, "_")}`;
  await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}

export async function fetchFormPdf(formId: string): Promise<{ name: string; data_base64: string }> {
  return api<{ name: string; mime: string; data_base64: string }>(`/filled-forms/${formId}/pdf`);
}

/** V50.z357 — Step 9: stampa del PDF tramite il servizio di stampa del sistema (stampanti WiFi, AirPrint, Bluetooth). */
export async function printPdfBase64(name: string, b64: string): Promise<void> {
  if (Platform.OS === "web" || Platform.OS === "ios") { await Print.printAsync({ uri: `data:application/pdf;base64,${b64}` }); return; }
  const path = `${FileSystem.cacheDirectory}${name.replace(/[^\w.\-]+/g, "_")}`;
  await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
  await Print.printAsync({ uri: path });
}

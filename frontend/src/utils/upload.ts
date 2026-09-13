// upload.ts — V50.z202 — Upload MULTIPART (senza base64): file locale (uri) o Blob → FormData → apiUpload.
// Native: RN FormData accetta { uri, name, type } e legge il file a stream. Web: Blob/File.
import { Platform } from "react-native";
import { apiUpload } from "@/src/api";

export type UploadSource = { uri: string; name: string; mime: string } | { blob: Blob; name: string; mime: string };

async function toFormPart(src: UploadSource): Promise<any> {
  if ("blob" in src) return new File([src.blob], src.name, { type: src.mime });
  if (Platform.OS === "web" || src.uri.startsWith("data:") || src.uri.startsWith("blob:")) {
    const blob = await (await fetch(src.uri)).blob();
    return new File([blob], src.name, { type: src.mime || blob.type });
  }
  return { uri: src.uri, name: src.name, type: src.mime } as any;
}

/** Master Files: `POST /master-files/upload` (max 50 MB) → il contenuto va su Object Storage, Mongo tiene solo il riferimento. */
export async function uploadMasterFile(src: UploadSource, category: "bills" | "audio" | "files" | "analisi", title?: string) {
  const form = new FormData();
  form.append("file", await toFormPart(src));
  form.append("category", category);
  form.append("name", src.name);
  if (title) form.append("title", title);
  return apiUpload<{ file_id: string; name: string; size: number; content_url: string }>("/master-files/upload", form);
}

/** Trascrizione Whisper: `POST /ai/transcribe/upload` (max 25 MB). */
export async function transcribeUpload(src: UploadSource): Promise<string> {
  const form = new FormData();
  form.append("file", await toFormPart(src));
  form.append("mime", src.mime);
  const r = await apiUpload<{ transcript: string }>("/ai/transcribe/upload", form);
  return (r?.transcript || "").trim();
}

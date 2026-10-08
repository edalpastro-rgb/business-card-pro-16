// src/personalVault.ts — V50.z469 — Feature 13/14: «Spazio Personale › Anagrafica» del Super Master — SOLO ON-DEVICE.
// Dati (famiglia, case, contatti d'emergenza, documenti) cifrati dal sistema operativo tramite expo-secure-store
// (Android Keystore / iOS Keychain), suddivisi in blocchi ≤ 1800 byte (limite consigliato di SecureStore). NESSUNA sincronizzazione
// con il server: le chiavi `pv_*` NON sono nella whitelist di prefsSync e nessun endpoint riceve questi dati. L'unica eccezione
// è volontaria: con «Condividi con Axon» attivo, un riepilogo testuale viene allegato alla singola richiesta chat (client_context,
// non persistito dal backend) solo quando la domanda riguarda famiglia/casa/emergenze/documenti.
// Web: SecureStore non esiste → fallback AsyncStorage (prefisso `pv_` escluso dalla sincronizzazione): avvisare l'utente.
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

export type VaultPerson = { id: string; name: string; relation: string; birth_date?: string; phone?: string; notes?: string };
export type VaultHome = { id: string; label: string; address: string; notes?: string };
export type VaultEmergency = { id: string; name: string; relation: string; phone: string };
export type VaultDocument = { id: string; type: string; number: string; expires?: string; notes?: string };
export type Vault = { version: 1; family: VaultPerson[]; homes: VaultHome[]; emergency: VaultEmergency[]; documents: VaultDocument[]; share_with_axon: boolean; updated_at: string | null };

const META_KEY = "pv_meta_v1";
const CHUNK_KEY = (i: number) => `pv_chunk_v1_${i}`;
const CHUNK_SIZE = 1800;

export const EMPTY_VAULT: Vault = { version: 1, family: [], homes: [], emergency: [], documents: [], share_with_axon: false, updated_at: null };
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const vaultIsOsEncrypted = Platform.OS !== "web";

export async function loadVault(): Promise<Vault> {
  try {
    const chunks = Number((await storage.secureGet<string>(META_KEY, "0")) || 0);
    if (!chunks) return { ...EMPTY_VAULT };
    const parts: string[] = [];
    for (let i = 0; i < chunks; i++) parts.push((await storage.secureGet<string>(CHUNK_KEY(i), "")) || "");
    const parsed = JSON.parse(parts.join("")) as Vault;
    return { ...EMPTY_VAULT, ...parsed };
  } catch { return { ...EMPTY_VAULT }; }
}

export async function saveVault(v: Vault): Promise<void> {
  const next: Vault = { ...v, version: 1, updated_at: new Date().toISOString() };
  const json = JSON.stringify(next);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) chunks.push(json.slice(i, i + CHUNK_SIZE));
  const prev = Number((await storage.secureGet<string>(META_KEY, "0")) || 0);
  for (let i = 0; i < chunks.length; i++) await storage.secureSet(CHUNK_KEY(i), chunks[i]);
  await storage.secureSet(META_KEY, String(chunks.length));
  for (let i = chunks.length; i < prev; i++) await storage.secureRemove(CHUNK_KEY(i));
}

export async function wipeVault(): Promise<void> {
  const prev = Number((await storage.secureGet<string>(META_KEY, "0")) || 0);
  for (let i = 0; i < prev; i++) await storage.secureRemove(CHUNK_KEY(i));
  await storage.secureRemove(META_KEY);
}

export function vaultCount(v: Vault): number {
  return v.family.length + v.homes.length + v.emergency.length + v.documents.length;
}

/** Riepilogo compatto per Axon (solo se «Condividi con Axon» è attivo e la domanda è pertinente). */
export function vaultAxonSummary(v: Vault): string {
  const lines: string[] = [];
  if (v.family.length) lines.push("Famiglia: " + v.family.map((p) => [p.name, p.relation && `(${p.relation})`, p.birth_date && `nato/a ${p.birth_date}`, p.phone && `tel ${p.phone}`, p.notes].filter(Boolean).join(" ")).join("; "));
  if (v.homes.length) lines.push("Case: " + v.homes.map((h) => [h.label, h.address, h.notes].filter(Boolean).join(" — ")).join("; "));
  if (v.emergency.length) lines.push("Contatti d'emergenza: " + v.emergency.map((e) => [e.name, e.relation && `(${e.relation})`, `tel ${e.phone}`].filter(Boolean).join(" ")).join("; "));
  if (v.documents.length) lines.push("Documenti: " + v.documents.map((d) => [d.type, d.number && `n. ${d.number}`, d.expires && `scade ${d.expires}`, d.notes].filter(Boolean).join(" ")).join("; "));
  return lines.join("\n").slice(0, 3000);
}

const RELEVANT_RE = /\b(famiglia|moglie|marito|figli[oa]?|mamma|pap[aà]|madre|padre|fratell[oi]|sorell[ae]|nonn[oai]|compleann|casa|case|abitazion|seconda casa|indirizzo di casa|emergenz|contatto d'emergenza|document[oi]|passaporto|patente|carta d'identit|codice fiscale|tessera sanitaria|scadenz)\b/i;

/** Testo da allegare alla richiesta chat (null se non pertinente o condivisione disattivata). */
export async function vaultContextForMessage(message: string): Promise<string | null> {
  if (!RELEVANT_RE.test(message || "")) return null;
  const v = await loadVault();
  if (!v.share_with_axon || !vaultCount(v)) return null;
  return vaultAxonSummary(v);
}

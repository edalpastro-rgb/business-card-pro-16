// src/utils/deviceContacts.ts — V50.z469 — Feature 7/15: ricerca nella rubrica del telefono quando Axon non trova un nome in AdvisorOS.
// Privacy: la rubrica resta sul dispositivo (si cerca solo il nome richiesto e si mostra il numero in chat). Permesso chiesto
// contestualmente (l'utente ha appena chiesto un numero); negato/bloccato/web → fallback silenzioso, mai un crash.
import { Platform } from "react-native";

export type DeviceContactLookup =
  | { status: "found"; name: string; phone: string }
  | { status: "not_found" }
  | { status: "denied" }
  | { status: "unavailable" };

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export async function lookupDeviceContact(query: string): Promise<DeviceContactLookup> {
  if (Platform.OS === "web") return { status: "unavailable" };
  let Contacts: typeof import("expo-contacts");
  try { Contacts = await import("expo-contacts"); } catch { return { status: "unavailable" }; }
  try {
    let perm = await Contacts.getPermissionsAsync();
    if (!perm.granted) {
      if (perm.canAskAgain === false) return { status: "denied" };
      perm = await Contacts.requestPermissionsAsync();
      if (!perm.granted) return { status: "denied" };
    }
    const q = norm(query);
    const toks = q.split(" ").filter((t) => t.length >= 2);
    if (!toks.length) return { status: "not_found" };
    // Ricerca per nome (il filtro nativo è un «contains» sul nome completo): prima la query intera, poi il token più lungo
    const tryNames = [query.trim(), toks.slice().sort((a, b) => b.length - a.length)[0]];
    let data: import("expo-contacts").Contact[] = [];
    for (const n of tryNames) {
      const r = await Contacts.getContactsAsync({ name: n, fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name], pageSize: 50 });
      data = (r.data || []).filter((c) => (c.phoneNumbers || []).length > 0);
      if (data.length) break;
    }
    if (!data.length) return { status: "not_found" };
    // Miglior corrispondenza: tutti i token presenti nel nome → poi il maggior numero di token
    const score = (c: import("expo-contacts").Contact) => { const n = norm(`${c.name || ""} ${c.firstName || ""} ${c.lastName || ""} ${c.company || ""}`); return toks.filter((t) => n.includes(t)).length; };
    const best = data.slice().sort((a, b) => score(b) - score(a))[0];
    if (!best || score(best) === 0) return { status: "not_found" };
    const pn = (best.phoneNumbers || []).find((p) => /mobile|cell|iphone/i.test(p.label || "")) || best.phoneNumbers![0];
    const phone = (pn.number || pn.digits || "").replace(/[^\d+ ]/g, "").trim();
    if (!phone) return { status: "not_found" };
    return { status: "found", name: best.name || [best.firstName, best.lastName].filter(Boolean).join(" ") || query, phone };
  } catch {
    return { status: "unavailable" };
  }
}

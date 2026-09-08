// V50.z107 — Helper globale per aprire link in WebView interna.
// Mantiene bottom nav visibile navigando alla route (tabs)/webviewer.

import { Router } from "expo-router";

/**
 * Apre un URL nella WebView interna dell'app (tab bar rimane visibile).
 * Se il sito blocca la WebView, l'utente vedrà un fallback "Apri nel browser esterno".
 *
 * @param router - istanza da useRouter()
 * @param url - URL da aprire (http/https)
 * @param opts - title (mostrato nell'header) e contactId (opzionale, per salvataggio KB)
 */
export function openInAppLink(
  router: Router,
  url: string,
  opts?: { title?: string; contactId?: string }
) {
  if (!url) return;
  const params = new URLSearchParams();
  params.set("url", url);
  if (opts?.title) params.set("title", opts.title);
  if (opts?.contactId) params.set("contactId", opts.contactId);
  try {
    router.push(("/(tabs)/webviewer?" + params.toString()) as any);
  } catch {
    // fallback
    router.push(("/webviewer?" + params.toString()) as any);
  }
}

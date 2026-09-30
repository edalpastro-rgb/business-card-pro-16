// RoutePersistence.tsx — V50.z242 — BUG-STATE-001: salva l'ultima rotta ad ogni navigazione (e subito quando l'app va
// in background) e, al cold start nativo (processo ucciso dall'OS), riporta l'utente ESATTAMENTE dove era:
// Home → push(rotta salvata) così il tasto «indietro» continua a funzionare. Web escluso (l'URL del browser basta).
import React, { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { usePathname, useGlobalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { buildHref, isRestorableRoute, loadLastRoute, saveLastRoute, clearLastRoute, navRestoreGuard } from "@/src/utils/appStatePersist";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** V50.z410 — Rotta da riaprire dopo un reload programmato (es. cambio tema da Profilo → si resta su Profilo). */
export const POST_RELOAD_ROUTE_KEY = "advisoros_post_reload_route_v1";
export const setPostReloadRoute = (route: string) => AsyncStorage.setItem(POST_RELOAD_ROUTE_KEY, route).catch(() => {});

export function RoutePersistence() {
  const pathname = usePathname() || "";
  const params = useGlobalSearchParams() as Record<string, any>;
  const router = useRouter();
  const { user } = useAuth();
  const lastHref = useRef<string>("");

  // V50.z410 — Dopo un reload programmato (cambio tema) torna alla pagina di partenza invece che alla Home (web + nativo)
  const postReloadDone = useRef(false);
  useEffect(() => {
    if (postReloadDone.current || !user?.user_id) return;
    postReloadDone.current = true;
    AsyncStorage.getItem(POST_RELOAD_ROUTE_KEY).then((r) => {
      if (!r) return;
      void AsyncStorage.removeItem(POST_RELOAD_ROUTE_KEY);
      navRestoreGuard.skip = true; navRestoreGuard.done = true;
      setTimeout(() => { try { router.replace(r as any); } catch { /* ignore */ } }, 250);
    }).catch(() => {});
  }, [user?.user_id, router]);

  // 1) Salva la rotta corrente ad ogni cambio (solo rotte ripristinabili, utente autenticato)
  useEffect(() => {
    if (Platform.OS === "web" || !user?.user_id) return;
    if (!isRestorableRoute(pathname)) {
      lastHref.current = "";
      // Tornati alla Home (dopo il ripristino iniziale) → la rotta salvata non è più valida
      if ((pathname === "/home" || pathname === "/(tabs)/home") && navRestoreGuard.loaded) void saveLastRoute("");
      return;
    }
    const href = buildHref(pathname, params);
    if (href === lastHref.current) return;
    lastHref.current = href;
    void saveLastRoute(href);
  }, [pathname, params, user?.user_id]);

  // 2) In background: doppio salvataggio immediato (l'OS può uccidere il processo subito dopo)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (st) => {
      if ((st === "background" || st === "inactive") && lastHref.current) void saveLastRoute(lastHref.current);
    });
    return () => sub.remove();
  }, []);

  // 3) Cold start: appena autenticati e atterrati sulla Home di default → ripristina la rotta salvata (una volta per processo)
  useEffect(() => {
    if (Platform.OS === "web" || navRestoreGuard.done || !user?.user_id) return;
    if (pathname !== "/home" && pathname !== "/(tabs)/home") return;
    navRestoreGuard.done = true;
    if (navRestoreGuard.skip) { navRestoreGuard.loaded = true; return; } // un deeplink (notifica) sta già navigando
    let cancelled = false;
    loadLastRoute().then((href) => {
      navRestoreGuard.loaded = true;
      if (cancelled || !href || navRestoreGuard.skip) return;
      const path = href.split("?")[0];
      if (!isRestorableRoute(path)) return;
      setTimeout(() => { if (!navRestoreGuard.skip) { try { router.push(href as any); } catch { /* ignore */ } } }, 250);
    });
    return () => { cancelled = true; };
  }, [pathname, user?.user_id, router]);

  // 4) Logout → nessun ripristino alla prossima sessione
  const hadUser = useRef(false);
  useEffect(() => {
    if (user?.user_id) hadUser.current = true;
    else if (hadUser.current) { hadUser.current = false; void clearLastRoute(); }
  }, [user?.user_id]);

  return null;
}

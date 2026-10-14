// useSuperAdmin.ts — V50.z542 — flag Supermaster condiviso (GET /admin/me, cache in memoria per sessione).
import { useEffect, useState } from "react";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

let _cache: { uid: string; value: boolean } | null = null;

export function useSuperAdmin(): boolean {
  const { user } = useAuth();
  const uid = (user as any)?.user_id || "";
  const cached = _cache;
  const [isSA, setIsSA] = useState<boolean>(cached !== null && cached.uid === uid ? cached.value : false);
  useEffect(() => {
    if (!uid) { setIsSA(false); return; }
    const c = _cache;
    if (c !== null && c.uid === uid) { setIsSA(c.value); return; }
    let alive = true;
    api<{ super_admin: boolean }>("/admin/me").then((r) => { _cache = { uid, value: !!r?.super_admin }; if (alive) setIsSA(!!r?.super_admin); }).catch(() => { if (alive) setIsSA(false); });
    return () => { alive = false; };
  }, [uid]);
  return isSA;
}

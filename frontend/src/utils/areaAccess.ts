/**
 * V50.z114 — Permessi e visibilità delle aree (CRM · Aree).
 *
 * Ogni area (built-in energy/network via settings.area_meta, custom via
 * settings.custom_areas) può avere `allowed_roles` (owner/admin/member) e
 * `archived`. Il titolare (owner) vede sempre tutto; per gli altri ruoli
 * un'area è visibile solo se non archiviata e se il ruolo è tra quelli
 * consentiti (lista vuota/assente = tutti).
 */
export type AreaMetaLike = { allowed_roles?: string[]; archived?: boolean; subcategories?: string[] };
export type SettingsLike = {
  energy_title?: string; energy_color?: string;
  network_title?: string; network_color?: string;
  custom_areas?: ({ id: string; name: string; color: string } & AreaMetaLike)[];
  area_meta?: Record<string, AreaMetaLike>;
} | null | undefined;

export function normalizeRole(role?: string | null): "owner" | "admin" | "member" {
  if (role === "owner" || role === "admin") return role;
  return "member";
}

export function areaMetaFor(settings: SettingsLike, areaId: string): AreaMetaLike {
  if (!settings) return {};
  if (areaId === "energy" || areaId === "network") return settings.area_meta?.[areaId] || {};
  return (settings.custom_areas || []).find((a) => a.id === areaId) || {};
}

export function isAreaVisible(settings: SettingsLike, areaId: string, role?: string | null): boolean {
  const r = normalizeRole(role);
  if (r === "owner") return true;
  const meta = areaMetaFor(settings, areaId);
  if (meta.archived) return false;
  const roles = meta.allowed_roles || [];
  return roles.length === 0 || roles.includes(r);
}

/** Sottocategorie configurate per un'area (vuoto se nessuna). */
export function areaSubcategories(settings: SettingsLike, areaId: string): string[] {
  return areaMetaFor(settings, areaId).subcategories || [];
}

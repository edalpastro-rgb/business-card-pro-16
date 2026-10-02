// V50.z436 — useRole(): UNICO punto di verità dei permessi lato app (specchio di backend/routes/axon_rbac.py `can(user, azione)`).
// Sostituisce i controlli inline `isMaster = user.role === "owner" && !parent_user_id` sparsi nei file.
import { useMemo } from "react";
import { useAuth, type User } from "@/src/auth";

export type Role = "owner" | "admin" | "member" | "consultant";
export type Action =
  | "contacts.own" | "calendar.own" | "calendar.add_personal" | "axon.chat" | "scanner.use" | "practices.own" | "documents.own" | "bills.own"
  | "settings.personal" | "settings.axon_basic"
  | "settings.tts_advanced" | "contacts.export" | "bug_reports" | "help.tickets" | "team.view" | "libretto.read"
  | "master_panel" | "team.manage" | "invites" | "settings.tenant" | "smtp" | "branding" | "axon_center" | "scanner.config" | "team_insights"
  | "crm_areas" | "custom_fields" | "gdpr" | "stress_test" | "voiceprint" | "form_templates" | "contacts.all" | "calendar.all";

const OPERATIVE: Action[] = ["contacts.own", "calendar.own", "calendar.add_personal", "axon.chat", "scanner.use", "practices.own", "documents.own", "bills.own", "settings.personal", "settings.axon_basic"];
const STAFF: Action[] = [...OPERATIVE, "settings.tts_advanced", "contacts.export", "bug_reports", "help.tickets", "team.view", "libretto.read"];
const ADMIN: Action[] = ["master_panel", "team.manage", "invites", "settings.tenant", "smtp", "branding", "axon_center", "scanner.config", "team_insights", "crm_areas", "custom_fields", "gdpr", "stress_test", "voiceprint", "form_templates", "contacts.all", "calendar.all"];
const ADMIN_ROLE_EXTRA: Action[] = ["team.manage", "invites", "contacts.all", "calendar.all", "custom_fields", "crm_areas"];

const MATRIX: Record<Role, Set<Action>> = {
  owner: new Set([...STAFF, ...ADMIN]),
  admin: new Set([...STAFF, ...ADMIN_ROLE_EXTRA]),
  member: new Set(STAFF),
  consultant: new Set(OPERATIVE),
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Master", admin: "Manager", member: "Collaboratore", consultant: "Consulente" };

export function roleOf(user: User | null | undefined): Role {
  const r = (user?.role || "member") as Role;
  return (["owner", "admin", "member", "consultant"] as Role[]).includes(r) ? r : "member";
}

export function canUser(user: User | null | undefined, action: Action): boolean {
  if (!user) return false;
  return MATRIX[roleOf(user)].has(action);
}

export function useRole() {
  const { user } = useAuth();
  return useMemo(() => {
    const role = roleOf(user);
    const isMaster = !!user && role === "owner" && !user.parent_user_id; // Master di primo livello
    const isSubMaster = !!user && role === "owner" && !!user.parent_user_id;
    return {
      user, role, label: ROLE_LABEL[role],
      isMaster, isSubMaster, isOwner: isMaster || isSubMaster,
      isAdmin: role === "admin", isMember: role === "member", isConsultant: role === "consultant",
      can: (action: Action) => canUser(user, action),
    };
  }, [user]);
}

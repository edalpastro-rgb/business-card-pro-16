// callsApi.ts — V50.z506 — Modulo Call: tipi e chiamate API condivise tra la schermata /call e il blocco «CALL DI OGGI» in Home.
import { api } from "@/src/api";

export type CallItem = {
  appointment_id: string; title: string; area: "energy" | "network"; start_at: string; end_at?: string; done: boolean;
  contact_id?: string | null; phone_mobile?: string; location?: string; notes?: string; overdue?: boolean; moved_to_callback_id?: string | null;
};
export type CallsToday = { items: CallItem[]; day: string; total: number; todo: number; done: number };

export const fetchCallsToday = () => api<CallsToday>("/calls/today");
export const toggleCallDone = (c: CallItem) => api(`/appointments/${c.appointment_id}`, { method: "PUT", body: { done: !c.done } });
export const rescheduleCall = (c: CallItem, when: Date) => api(`/calls/${c.appointment_id}/reschedule`, { method: "POST", body: { new_scheduled_at: when.toISOString() } });

export const fmtCallTime = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
export const fmtCallDay = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });

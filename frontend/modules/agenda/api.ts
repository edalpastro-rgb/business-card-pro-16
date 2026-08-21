/**
 * Agenda module — backend calls (Result<T> wrapped).
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type {
  Appointment,
  AppointmentWriteInput,
  TeamMember,
} from "./types";

export function listAppointments(query?: Record<string, string | number | boolean>): Promise<Result<{ items: Appointment[] }>> {
  return apiCall<{ items: Appointment[] }>("/appointments", { query });
}

export function getAppointment(appointmentId: string): Promise<Result<Appointment>> {
  return apiCall<Appointment>(`/appointments/${appointmentId}`);
}

export function createAppointment(body: AppointmentWriteInput): Promise<Result<{ appointment_id: string }>> {
  return apiCall<{ appointment_id: string }>("/appointments", { method: "POST", body });
}

export function updateAppointment(appointmentId: string, body: AppointmentWriteInput): Promise<Result<Appointment>> {
  return apiCall<Appointment>(`/appointments/${appointmentId}`, { method: "PUT", body });
}

export function deleteAppointment(appointmentId: string): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/appointments/${appointmentId}`, { method: "DELETE" });
}

/** Team calendar helpers */
export function listTeamMembers(): Promise<Result<{ items: TeamMember[] }>> {
  return apiCall<{ items: TeamMember[] }>("/team/members");
}

export function listTeamAppointments(query?: Record<string, string | number | boolean>): Promise<Result<{ items: Appointment[] }>> {
  return apiCall<{ items: Appointment[] }>("/calendar/team-members", { query });
}

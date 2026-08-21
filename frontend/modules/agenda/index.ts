/**
 * Agenda module — PUBLIC API.
 * Other modules must import ONLY from here.
 *
 * NOTE (Fase 2): UI screens for /appointment/new and /appointment/[id] and the
 * /(tabs)/calendario view remain in /app for now (~2900 lines combined). They
 * import from this module's public API for types + API + hook. A future full
 * migration will move them under modules/agenda/screens/.
 */
export type {
  Appointment,
  AppointmentWriteInput,
  AppointmentArea,
  AppointmentRecurrence,
  BroadcastScope,
  AppointmentAttachment,
  AppointmentOutcome,
  TeamMember,
} from "./types";

export {
  listAppointments,
  getAppointment,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  listTeamMembers,
  listTeamAppointments,
} from "./api";

export { useAppointment } from "./hooks/useAppointment";

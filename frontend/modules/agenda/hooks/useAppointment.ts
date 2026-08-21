/**
 * useAppointment — load + update + delete one appointment with AsyncResource<T>.
 * Publishes `appointment:updated` on cross-module reactivity.
 */
import { useCallback, useEffect, useState } from "react";
import type { AsyncResource } from "@/src/shared";
import { asyncLoading, asyncSuccess, asyncError, publish } from "@/src/shared";
import type { Appointment, AppointmentWriteInput } from "../types";
import { getAppointment, updateAppointment, deleteAppointment } from "../api";

type UseAppointmentResult = {
  resource: AsyncResource<Appointment>;
  reload: () => Promise<void>;
  save: (patch: AppointmentWriteInput) => Promise<Appointment | null>;
  remove: () => Promise<boolean>;
  errorMsg: string | null;
  busy: boolean;
};

export function useAppointment(appointmentId: string | undefined): UseAppointmentResult {
  const [resource, setResource] = useState<AsyncResource<Appointment>>({ status: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!appointmentId) return;
    setResource(asyncLoading<Appointment>());
    const r = await getAppointment(appointmentId);
    if (r.ok) setResource(asyncSuccess<Appointment>(r.data));
    else setResource(asyncError<Appointment>(r.error));
  }, [appointmentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (patch: AppointmentWriteInput): Promise<Appointment | null> => {
      if (!appointmentId) return null;
      setBusy(true);
      setErrorMsg(null);
      const r = await updateAppointment(appointmentId, patch);
      setBusy(false);
      if (r.ok) {
        setResource(asyncSuccess<Appointment>(r.data));
        publish("appointment:updated", { appointmentId });
        return r.data;
      }
      setErrorMsg(r.error);
      return null;
    },
    [appointmentId]
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (!appointmentId) return false;
    setBusy(true);
    setErrorMsg(null);
    const r = await deleteAppointment(appointmentId);
    setBusy(false);
    if (r.ok) return true;
    setErrorMsg(r.error);
    return false;
  }, [appointmentId]);

  return { resource, reload, save, remove, errorMsg, busy };
}

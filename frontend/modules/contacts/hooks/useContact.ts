/**
 * useContact — load + update + delete a single contact with AsyncResource<T>.
 * Publishes `contact:updated` / `contact:deleted` events for cross-module reactivity.
 */
import { useCallback, useEffect, useState } from "react";
import type { AsyncResource } from "@/src/shared";
import { asyncLoading, asyncSuccess, asyncError, publish } from "@/src/shared";
import type { Contact, ContactWriteInput } from "../types";
import { getContact, updateContact, deleteContact } from "../api";

type UseContactResult = {
  resource: AsyncResource<Contact>;
  reload: () => Promise<void>;
  save: (patch: ContactWriteInput) => Promise<Contact | null>;
  remove: () => Promise<boolean>;
  errorMsg: string | null;
  busy: boolean;
};

export function useContact(contactId: string | undefined): UseContactResult {
  const [resource, setResource] = useState<AsyncResource<Contact>>({ status: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!contactId) return;
    setResource(asyncLoading<Contact>());
    const r = await getContact(contactId);
    if (r.ok) setResource(asyncSuccess<Contact>(r.data));
    else setResource(asyncError<Contact>(r.error));
  }, [contactId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (patch: ContactWriteInput): Promise<Contact | null> => {
      if (!contactId) return null;
      setBusy(true);
      setErrorMsg(null);
      const r = await updateContact(contactId, patch);
      setBusy(false);
      if (r.ok) {
        setResource(asyncSuccess<Contact>(r.data));
        publish("contact:updated", { contactId });
        return r.data;
      }
      setErrorMsg(r.error);
      return null;
    },
    [contactId]
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (!contactId) return false;
    setBusy(true);
    setErrorMsg(null);
    const r = await deleteContact(contactId);
    setBusy(false);
    if (r.ok) {
      publish("contact:deleted", { contactId });
      return true;
    }
    setErrorMsg(r.error);
    return false;
  }, [contactId]);

  return { resource, reload, save, remove, errorMsg, busy };
}

/**
 * useContactsList — load contact list with AsyncResource<T>.
 * Re-fetches automatically on contact:updated / contact:deleted events.
 */
import { useCallback, useEffect, useState } from "react";
import type { AsyncResource } from "@/src/shared";
import { asyncLoading, asyncSuccess, asyncError, subscribe } from "@/src/shared";
import type { ContactLite } from "../types";
import { listContacts } from "../api";

type UseContactsListResult = {
  resource: AsyncResource<ContactLite[]>;
  reload: () => Promise<void>;
};

export function useContactsList(query?: Record<string, string | number | boolean>): UseContactsListResult {
  const [resource, setResource] = useState<AsyncResource<ContactLite[]>>({ status: "idle" });

  // Stringify to make the memo stable across renders with same query
  const queryKey = query ? JSON.stringify(query) : "";

  const reload = useCallback(async (): Promise<void> => {
    setResource(asyncLoading<ContactLite[]>());
    const r = await listContacts(query);
    if (r.ok) setResource(asyncSuccess<ContactLite[]>(r.data.items || []));
    else setResource(asyncError<ContactLite[]>(r.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Auto-refresh when a contact changes elsewhere
  useEffect(() => {
    const u1 = subscribe("contact:updated", () => { reload(); });
    const u2 = subscribe("contact:deleted", () => { reload(); });
    return () => { u1(); u2(); };
  }, [reload]);

  return { resource, reload };
}

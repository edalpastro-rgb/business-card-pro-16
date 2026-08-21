/**
 * Contacts module — backend calls.
 * Every call returns Result<T> so consumers must handle loading/success/error explicitly.
 */
import { apiCall } from "@/src/shared";
import type { Result } from "@/src/shared";
import type {
  Contact,
  ContactLite,
  ContactWriteInput,
  ContactGroup,
} from "./types";

export function listContacts(query?: Record<string, string | number | boolean>): Promise<Result<{ items: ContactLite[] }>> {
  return apiCall<{ items: ContactLite[] }>("/contacts", { query });
}

export function getContact(contactId: string): Promise<Result<Contact>> {
  return apiCall<Contact>(`/contacts/${contactId}`);
}

export function createContact(body: ContactWriteInput): Promise<Result<{ contact_id: string }>> {
  return apiCall<{ contact_id: string }>("/contacts", { method: "POST", body });
}

export function updateContact(contactId: string, body: ContactWriteInput): Promise<Result<Contact>> {
  return apiCall<Contact>(`/contacts/${contactId}`, { method: "PUT", body });
}

export function deleteContact(contactId: string): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/contacts/${contactId}`, { method: "DELETE" });
}

export function assignContact(contactId: string, assignee: string | null): Promise<Result<{ ok: boolean }>> {
  return apiCall<{ ok: boolean }>(`/contacts/${contactId}/assign`, {
    method: "PUT",
    body: { assignee_user_id: assignee },
  });
}

export function listGroups(): Promise<Result<{ items: ContactGroup[] }>> {
  return apiCall<{ items: ContactGroup[] }>("/groups");
}

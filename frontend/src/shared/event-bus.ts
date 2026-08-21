/**
 * Minimal type-safe event bus for INTER-MODULE communication.
 * No module should hold a direct reference to another module's state.
 * Instead, publish events on this bus and let interested modules subscribe.
 *
 * Registered events:
 *   - "contact:updated"       — payload: { contactId: string }
 *   - "contact:deleted"       — payload: { contactId: string }
 *   - "appointment:created"   — payload: { appointmentId: string; contactId?: string }
 *   - "appointment:updated"   — payload: { appointmentId: string }
 *   - "bill:analyzed"         — payload: { billId: string; contactId: string }
 *   - "profile:updated"       — payload: { userId: string }
 *   - "businesscard:updated"  — payload: { cardId?: string }
 */

export type ModuleEvents = {
  "contact:updated": { contactId: string };
  "contact:deleted": { contactId: string };
  "appointment:created": { appointmentId: string; contactId?: string };
  "appointment:updated": { appointmentId: string };
  "bill:analyzed": { billId: string; contactId: string };
  "profile:updated": { userId: string };
  "businesscard:updated": { cardId?: string };
};

type Handler<K extends keyof ModuleEvents> = (payload: ModuleEvents[K]) => void;

const listeners = new Map<keyof ModuleEvents, Set<Handler<keyof ModuleEvents>>>();

export function subscribe<K extends keyof ModuleEvents>(
  event: K,
  handler: Handler<K>
): () => void {
  let bucket = listeners.get(event);
  if (!bucket) {
    bucket = new Set();
    listeners.set(event, bucket);
  }
  // Cast: handler is variance-safe within this closure
  bucket.add(handler as Handler<keyof ModuleEvents>);
  return () => {
    listeners.get(event)?.delete(handler as Handler<keyof ModuleEvents>);
  };
}

export function publish<K extends keyof ModuleEvents>(
  event: K,
  payload: ModuleEvents[K]
): void {
  const bucket = listeners.get(event);
  if (!bucket) return;
  bucket.forEach((h) => {
    try {
      (h as Handler<K>)(payload);
    } catch (e) {
      // Never propagate a subscriber crash back to the publisher.
      console.warn(`[event-bus] subscriber for "${String(event)}" threw:`, e);
    }
  });
}

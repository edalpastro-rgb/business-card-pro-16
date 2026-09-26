// axonUnread.ts — V50.z383 — «Messaggio di Axon non letto»: il FAB viola lampeggia in VERDE finché l'utente non apre la chat.
// Sorgenti: (1) risposta completata mentre la chat era chiusa (evento locale immediato), (2) messaggi scritti dal server
// (proattività, push bridge) rilevati confrontando GET /assistant/unread con l'ultima lettura salvata in AsyncStorage.
import { DeviceEventEmitter } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";

export const AXON_UNREAD_EVENT = "axon:unread-changed";
const READ_KEY = "axon_chat_read_at_v1";
let readAt: string | null = null;
let loaded = false;

async function loadReadAt(): Promise<string | null> {
  if (!loaded) {
    loaded = true;
    try { readAt = await AsyncStorage.getItem(READ_KEY); } catch { /* ignore */ }
  }
  return readAt;
}

function emit(unread: boolean) { DeviceEventEmitter.emit(AXON_UNREAD_EVENT, { unread }); }

/** Segnala subito un messaggio non letto (chat chiusa, risposta appena arrivata). */
export function flagAxonUnread() { emit(true); }

/** La chat è aperta / letta: memorizza il timestamp server dell'ultimo messaggio di Axon e spegne il lampeggio. */
export async function markAxonRead(): Promise<void> {
  emit(false);
  try {
    const r = await api<{ last_assistant_at: string | null }>("/assistant/unread");
    const at = r?.last_assistant_at || new Date().toISOString();
    readAt = at; loaded = true;
    await AsyncStorage.setItem(READ_KEY, at);
  } catch { /* offline: resta l'ultimo valore */ }
}

/** Poll leggero: true se Axon ha scritto dopo l'ultima lettura. Se la chat è aperta, aggiorna la lettura. */
export async function checkAxonUnread(chatOpen: boolean): Promise<boolean> {
  try {
    const r = await api<{ last_assistant_at: string | null }>("/assistant/unread");
    const last = r?.last_assistant_at;
    if (!last) return false;
    const prev = await loadReadAt();
    if (chatOpen) {
      readAt = last; loaded = true;
      AsyncStorage.setItem(READ_KEY, last).catch(() => {});
      emit(false);
      return false;
    }
    if (!prev) { // prima volta: nulla da segnalare, consideriamo letto ciò che c'è
      readAt = last; loaded = true;
      AsyncStorage.setItem(READ_KEY, last).catch(() => {});
      return false;
    }
    const unread = last > prev;
    emit(unread);
    return unread;
  } catch { return false; }
}

// FindPhoneReceiver.tsx — V50.z492 — Lato BERSAGLIO di «Trova il mio telefono».
// 1) Push reale (relay Emergent, canale Android `find_phone`: MAX, bypass DND, suono dedicato find_phone.wav): la notifica sveglia il
//    dispositivo anche a schermo spento; quando l'app riceve il payload (in foreground, o al tocco della notifica) e
//    `target_device_id` è questo dispositivo → squillo/vibrazione continua (ActivationOverlay) + ack «ringing».
// 2) Rete di sicurezza: polling `GET /axon/find-phone/pending` ogni 12 s quando l'app è attiva e al rientro in foreground.
// 3) Mentre squilla: ogni 3 s legge lo stato del comando → «stop» detto da un altro dispositivo lo ferma.
// Il dispositivo sorgente non è mai bersaglio (lo decide il backend), quindi non squilla mai se stesso.
import { useEffect, useRef } from "react";
import { AppState, DeviceEventEmitter, Platform } from "react-native";
import { api } from "@/src/api";
import { getDeviceInfo } from "@/src/device";
import { startFindPhone, stopFindPhone, AXON_FIND_PHONE_STOP_EVENT } from "@/src/activation/events";
import { useAuth } from "@/src/auth";

type Cmd = { cmd_id: string; mode: "ring" | "vibrate"; assistant_name?: string; target_device_id?: string; type?: string };

export function FindPhoneReceiver() {
  const { user } = useAuth();
  const activeCmd = useRef<string | null>(null);
  const myId = useRef<string>("");

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let pollTimer: any = null;
    let statusTimer: any = null;

    const ack = (cmdId: string, status: "ringing" | "stopped") => api(`/axon/find-phone/${cmdId}/ack`, { method: "POST", body: { status, device_id: myId.current } }).catch(() => {});

    const begin = (cmd: Cmd) => {
      if (!alive || activeCmd.current === cmd.cmd_id) return;
      activeCmd.current = cmd.cmd_id;
      startFindPhone(cmd.assistant_name || "Axon", cmd.mode === "vibrate" ? "vibrate" : "ring");
      void ack(cmd.cmd_id, "ringing");
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = setInterval(async () => {
        if (!activeCmd.current) { clearInterval(statusTimer); statusTimer = null; return; }
        try {
          const c = await api<{ status: string }>(`/axon/find-phone/${activeCmd.current}`);
          if (c.status === "stopped" || c.status === "expired") { activeCmd.current = null; stopFindPhone(); clearInterval(statusTimer); statusTimer = null; }
        } catch { /* rete assente: continua finché l'utente tocca lo schermo */ }
      }, 3000);
    };

    const poll = async () => {
      if (!alive || activeCmd.current) return;
      try {
        if (!myId.current) myId.current = (await getDeviceInfo()).device_id;
        const r = await api<{ cmd: Cmd | null }>("/axon/find-phone/pending", { query: { device_id: myId.current } });
        if (r.cmd) begin(r.cmd);
      } catch { /* offline */ }
    };

    const handlePayload = (data: any) => {
      if (!data || data.type !== "find_phone" || !data.cmd_id) return;
      if (data.target_device_id && myId.current && data.target_device_id !== myId.current) return; // non sono io il bersaglio
      begin({ cmd_id: data.cmd_id, mode: data.mode === "vibrate" ? "vibrate" : "ring", assistant_name: data.assistant_name });
    };

    // stop locale (tocco schermo / «stop» in chat) → ack al server
    const stopSub = DeviceEventEmitter.addListener(AXON_FIND_PHONE_STOP_EVENT, () => {
      const id = activeCmd.current;
      activeCmd.current = null;
      if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
      if (id) void ack(id, "stopped");
    });

    let notifSubs: { remove: () => void }[] = [];
    (async () => {
      myId.current = (await getDeviceInfo()).device_id;
      void poll();
      pollTimer = setInterval(() => { if (AppState.currentState === "active") void poll(); }, 12000);
      if (Platform.OS !== "web") {
        try {
          const Notifications = await import("expo-notifications");
          notifSubs.push(Notifications.addNotificationReceivedListener((n) => handlePayload(n.request.content.data)));
          notifSubs.push(Notifications.addNotificationResponseReceivedListener((r) => handlePayload(r.notification.request.content.data)));
          const last = await Notifications.getLastNotificationResponseAsync();
          if (last) handlePayload(last.notification.request.content.data);
        } catch { /* Expo Go / modulo assente */ }
      }
    })();
    const appSub = AppState.addEventListener("change", (s) => { if (s === "active") void poll(); });

    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
      if (statusTimer) clearInterval(statusTimer);
      stopSub.remove(); appSub.remove();
      notifSubs.forEach((s) => s.remove());
    };
  }, [user]);

  return null;
}

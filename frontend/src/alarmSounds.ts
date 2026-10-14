// alarmSounds.ts — V50.z545 — Suonerie integrate per le sveglie Axon (assets/sounds/alarm_*.wav, generate localmente: nessun hotlink).
// • Anteprima e squillo in-app: expo-audio con `source` (require locale) → sempre udibile, anche offline.
// • Notifica di sistema: `notifFile` = nome file dichiarato nel plugin expo-notifications (app.json › sounds) → nelle build native
//   la notifica usa la suoneria scelta anche a schermo bloccato; in Expo Go il sistema usa il suono «default».
import type { Ionicons } from "@expo/vector-icons";

export type PresetSound = { id: string; name: string; icon: keyof typeof Ionicons.glyphMap; source: number | null; notifFile: string | null };

export const PRESET_SOUNDS: PresetSound[] = [
  { id: "preset:default", name: "Predefinito (sistema)", icon: "notifications-outline", source: null, notifFile: null },
  { id: "preset:classic", name: "Sveglia classica", icon: "alarm-outline", source: require("../assets/sounds/alarm_classic.wav"), notifFile: "alarm_classic.wav" },
  { id: "preset:gentle", name: "Melodia delicata", icon: "musical-notes-outline", source: require("../assets/sounds/alarm_gentle.wav"), notifFile: "alarm_gentle.wav" },
  { id: "preset:energic", name: "Energico", icon: "flash-outline", source: require("../assets/sounds/alarm_energic.wav"), notifFile: "alarm_energic.wav" },
  { id: "preset:chirp", name: "Cinguettio", icon: "leaf-outline", source: require("../assets/sounds/alarm_chirp.wav"), notifFile: "alarm_chirp.wav" },
  { id: "preset:beep", name: "Beep digitale", icon: "radio-outline", source: require("../assets/sounds/alarm_beep.wav"), notifFile: "alarm_beep.wav" },
];
export const PRESET_BY_ID: Record<string, PresetSound> = Object.fromEntries(PRESET_SOUNDS.map((p) => [p.id, p]));

/** Nome file per `content.sound` della notifica: suoneria integrata se scelta, altrimenti "default". */
export function notificationSoundFor(soundRef?: string | null): string {
  const p = soundRef ? PRESET_BY_ID[soundRef] : undefined;
  return p?.notifFile || "default";
}

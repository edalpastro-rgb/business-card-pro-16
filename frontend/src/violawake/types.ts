// V50.z315 — ViolaWake SDK: tipi condivisi.
export type ViolaState =
  | "off"            // modulo/utente disattivato
  | "unsupported"    // web / Expo Go: nessun motore nativo
  | "needs_key"      // manca EXPO_PUBLIC_PICOVOICE_ACCESS_KEY
  | "no_permission"  // microfono negato
  | "starting"
  | "listening"      // in attesa della wake-word
  | "capturing"      // sta ascoltando il comando
  | "thinking"       // routing / trigger in corso
  | "speaking"       // risposta parlata
  | "error";

export type ViolaSettings = {
  enabled: boolean;
  sensitivity: number;
  stt_engine: "device" | "whisper";
  keyword_mode: "custom" | "builtin";
  speak_reply: boolean;
  confirm_sound: boolean;
  listen_seconds: number;
};

export type ViolaModule = { enabled: boolean; note?: string | null; updated_at?: string | null };

export type ViolaSettingsResponse = {
  module: ViolaModule;
  is_master: boolean;
  settings: ViolaSettings;
  trigger_rules: string[];
};

export type ViolaRoute =
  | { mode: "cancel"; prompt: string; reply: string }
  | { mode: "trigger"; action: "briefing" | "weekly_report" | "scan"; prompt: string }
  | { mode: "effect"; prompt: string }      // V50.z318 — «fai l'effetto»
  | { mode: "find_phone"; prompt: string }  // V50.z318 — «dove sei» / «trova il mio telefono»
  | { mode: "chat"; prompt: string };

export type ViolaEvent = {
  event_id: string;
  kind: string;
  transcript?: string | null;
  detail?: string | null;
  platform?: string | null;
  engine?: string | null;
  latency_ms?: number | null;
  created_at: string;
};

export type WakeEngineOptions = {
  accessKey: string;
  keywordMode: "custom" | "builtin";
  sensitivity: number;
  onWake: () => void;
  onError: (message: string) => void;
};

export type WakeEngine = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** etichetta della parola effettivamente in ascolto («Viola» o la parola di fallback) */
  keywordLabel: string;
};

export type CaptureOptions = {
  maxSeconds: number;
  onPartial?: (text: string) => void;
};

export type PermissionStatus = { granted: boolean; canAskAgain: boolean };

/** Parola di fallback finché non sono presenti i file .ppn «Viola» (addestrati su console.picovoice.ai). */
export const VIOLA_FALLBACK_KEYWORD_LABEL = "Jarvis";
export const VIOLA_KEYWORD_LABEL = "Viola";

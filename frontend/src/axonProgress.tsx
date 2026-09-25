// axonProgress.tsx — V50.z194 — Stato visibile durante le elaborazioni lunghe di AxonOS (modulo ISOLATO)
//
// Regola: se dopo 3 secondi non è arrivato il primo carattere della risposta, in chat compare una bolla
// intermedia di Axon con un messaggio CONTESTUALE (allegati tabellari, PDF, GME/PUN, meteo, ricerca web…)
// + secondi trascorsi; si aggiorna a 10 s e 20 s e SCOMPARE al primo delta della risposta finale.
// Le fasi inviate dal server (`progress`: ack/preflight/cache/thinking) vengono riusate quando più specifiche.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const AXON = "#8B5CF6";
const AXON_DARK = HT.violet;
export const PROGRESS_SHOW_AFTER_MS = 700; // V50.z306 — regola «rispondi subito»: entro 1 s dico che ci sto ragionando
export const PROGRESS_CONTEXT_AFTER_MS = 3000; // da qui in poi frase contestuale (GME, PDF, CRM…)

export type ProgressCtx = { message: string; attachmentNames: string[] };
export type ServerProgress = { stage?: string; text?: string; model?: string };

/** Frase contestuale in linguaggio semplice. Pura: testabile. */
export function progressHint(ctx: ProgressCtx, server: ServerProgress | null, elapsedSec: number): string {
  const msg = (ctx.message || "").toLowerCase();
  const names = ctx.attachmentNames.map((n) => n.toLowerCase());
  const tabular = names.some((n) => /\.(xlsx|xls|csv)$/.test(n));
  const pdf = names.some((n) => /\.pdf$/.test(n));
  const image = names.some((n) => /\.(png|jpe?g|webp|heic)$/.test(n));
  const stage = server?.stage || "";

  // V50.z306 — primo secondo: ack immediato, poi frasi contestuali
  if (elapsedSec * 1000 < PROGRESS_CONTEXT_AFTER_MS && stage !== "thinking" && stage !== "cache") return "Un attimo, ci ragiono…";

  // Fase di scrittura (modello già al lavoro): messaggio dedicato
  if (stage === "thinking") {
    if (tabular) return "Sto analizzando la tabella e preparo la risposta, ci vogliono circa 15 secondi…";
    return server?.model === "haiku" ? "Sto scrivendo la risposta…" : "Sto analizzando in profondità, ancora qualche secondo…";
  }
  if (stage === "cache" && server?.text) return server.text;

  if (tabular) return elapsedSec < 12 ? "Sto analizzando la tabella, ci vogliono circa 15 secondi…" : "Ancora un momento, sto incrociando i valori della tabella…";
  if (pdf) return elapsedSec < 12 ? "Sto leggendo il PDF e ne estraggo i dati…" : "PDF lungo: sto ancora leggendo, quasi fatto…";
  if (image) return "Sto guardando l'immagine…";
  if (/\b(pun|gme|prezz[io]|psv|ttf|futures?|borsa elettrica|mercato)\b/.test(msg)) return elapsedSec < 12 ? "Sto cercando i dati su GME…" : "Sto ancora recuperando i dati di mercato, ci siamo quasi…";
  if (/\b(meteo|tempo|pioggia|temperatur|previsioni)\b/.test(msg)) return "Sto controllando il meteo…";
  if (/\b(cerca|ricerca|online|web|notizie|news|ultime|aggiornament|delibera|arera)\b/.test(msg)) return elapsedSec < 12 ? "Sto cercando informazioni aggiornate online…" : "Sto leggendo le fonti trovate…";
  if (/\b(bollett|contratt|scadenz|fattur)\b/.test(msg)) return "Sto controllando bollette e scadenze…";
  if (/\b(client|contatt|appuntament|agenda|calendario|richiamat)\b/.test(msg)) return "Sto cercando nei tuoi dati CRM…";
  if (server?.text && stage === "preflight" && elapsedSec >= 6) return server.text;
  if (elapsedSec >= 20) return "Analisi complessa in corso, grazie per la pazienza…";
  if (elapsedSec >= 10) return "Ci sto lavorando, ancora qualche secondo…";
  return "Elaborazione in corso…";
}

export function useAxonProgress() {
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const ctx = useRef<ProgressCtx | null>(null);
  const server = useRef<ServerProgress | null>(null);
  const started = useRef(0);
  const timer = useRef<any>(null);
  const hidden = useRef(false);

  const tick = useCallback(() => {
    if (!ctx.current || hidden.current) return;
    const ms = Date.now() - started.current;
    const sec = Math.floor(ms / 1000);
    setElapsed(sec);
    if (ms >= PROGRESS_SHOW_AFTER_MS) {
      setText(progressHint(ctx.current, server.current, sec));
      setVisible(true);
    }
  }, []);

  const stop = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    ctx.current = null; server.current = null; hidden.current = true;
    setVisible(false); setText(""); setElapsed(0);
  }, []);

  const start = useCallback((c: ProgressCtx) => {
    stop();
    ctx.current = c; hidden.current = false; started.current = Date.now();
    timer.current = setInterval(tick, 350); // V50.z306 — 350 ms: la bolla «Un attimo, ci ragiono…» compare entro 1 s
  }, [stop, tick]);

  /** Fase comunicata dal server (event `progress`). */
  const onServer = useCallback((p: ServerProgress) => {
    server.current = p;
    if (visible) tick();
  }, [tick, visible]);

  /** Primo carattere della risposta finale → la bolla intermedia scompare. */
  const onFirstDelta = useCallback(() => {
    if (hidden.current) return;
    hidden.current = true;
    setVisible(false);
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  return { visible, text, elapsed, start, stop, onServer, onFirstDelta };
}

export function AxonProgressBubble({ text, elapsed, assistantName }: { text: string; elapsed: number; assistantName?: string }) {
  return (
    <View style={styles.row} testID="axon-progress-bubble">
      <View style={styles.avatar}><MaterialCommunityIcons name="robot-happy" size={14} color="#FFF" /></View>
      <View style={styles.bubble}>
        <View style={styles.line}>
          <ActivityIndicator size="small" color={AXON_DARK} />
          <Text style={styles.txt}>{text}</Text>
        </View>
        <Text style={styles.meta}>{assistantName || "Axon"} sta lavorando · {elapsed} s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 4 },
  avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: AXON, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "84%", backgroundColor: HT.violetTint, borderRadius: 16, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: HT.violet + '66', gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  txt: { flex: 1, fontSize: 14, color: HT.text, fontStyle: "italic", lineHeight: 19 },
  meta: { fontSize: 11, color: HT.muted, paddingLeft: 28 },
});

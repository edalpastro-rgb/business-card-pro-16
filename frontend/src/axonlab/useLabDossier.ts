/**
 * V50.z343 — Axon Lab · hook dossier condiviso (addestramento: /lab/training · pratica: /lab/practices/{id}).
 * Gestisce upload/inserimento manuale (estrazione Axon), conferma/scarto campo per campo, stato busy per documento.
 */
import { useCallback, useState } from "react";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { type LabDocEntry, type LabDocSpec } from "@/src/axonlab/labApi";

type Completion = { confirmed: number; uploaded: number; total: number; percent: number };

export function useLabDossier(basePath: string, onChange?: (docs: Record<string, LabDocEntry>, completion: Completion) => void) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<LabDocSpec | null>(null);

  const upload = useCallback(async (spec: LabDocSpec, body: { name?: string; mime?: string; data_base64?: string; manual?: Record<string, string> }) => {
    setBusy((b) => ({ ...b, [spec.id]: true }));
    try {
      const r = await api<{ docs: Record<string, LabDocEntry>; completion: Completion; extracted: Record<string, string> }>(`${basePath}/docs/${spec.id}`, {
        method: "POST",
        body: { name: body.name || "documento", mime: body.mime || "application/pdf", data_base64: body.data_base64, manual: body.manual },
      });
      onChange?.(r.docs, r.completion);
      if (!Object.keys(r.extracted || {}).length) notify("Nessun dato leggibile", "Axon non ha trovato dati nel documento: prova con una foto più nitida.");
    } catch (e: any) {
      notify("Analisi non riuscita", e?.message || "");
    } finally {
      setBusy((b) => ({ ...b, [spec.id]: false }));
    }
  }, [basePath, onChange]);

  const confirm = useCallback(async (spec: LabDocSpec, values: Record<string, string>, status: "confirmed" | "discarded") => {
    setBusy((b) => ({ ...b, [spec.id]: true }));
    try {
      const r = await api<{ docs: Record<string, LabDocEntry>; completion: Completion }>(`${basePath}/docs/${spec.id}`, { method: "PUT", body: { values, status } });
      onChange?.(r.docs, r.completion);
      setOpen(null);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setBusy((b) => ({ ...b, [spec.id]: false }));
    }
  }, [basePath, onChange]);

  return { busy, open, setOpen, upload, confirm };
}

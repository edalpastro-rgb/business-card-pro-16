/**
 * useBusinessCard — state + actions for the Business Card screen.
 * All backend calls return Result<T>; the hook translates them into an
 * AsyncResource<BusinessCard> and error messages consumers can render.
 */
import { useCallback, useEffect, useState } from "react";
import type { AsyncResource } from "@/src/shared";
import { asyncLoading, asyncSuccess, asyncError, publish } from "@/src/shared";
import type { BusinessCard } from "../types";
import { fetchBusinessCard, saveBusinessCard } from "../api";
import { pickCardLogo } from "../lib/pickLogo";
import { CARD_NAVY } from "../constants";

type UseBusinessCardResult = {
  resource: AsyncResource<BusinessCard>;
  card: BusinessCard;
  busy: boolean;
  errorMsg: string | null;
  update: (patch: Partial<BusinessCard>) => void;
  save: (patch?: Partial<BusinessCard>) => Promise<BusinessCard | null>;
  reload: () => Promise<void>;
  pickAndSaveLogo: (field: "logo_base64" | "photo_base64") => Promise<void>;
};

const DEFAULTS: BusinessCard = { accent_color: CARD_NAVY, qr_type: "website" };

export function useBusinessCard(): UseBusinessCardResult {
  const [resource, setResource] = useState<AsyncResource<BusinessCard>>({ status: "idle" });
  const [card, setCard] = useState<BusinessCard>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setResource(asyncLoading<BusinessCard>());
    const r = await fetchBusinessCard();
    if (r.ok) {
      const merged: BusinessCard = { ...DEFAULTS, ...r.data };
      setCard(merged);
      setResource(asyncSuccess<BusinessCard>(merged));
    } else {
      setResource(asyncError<BusinessCard>(r.error));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = useCallback((patch: Partial<BusinessCard>): void => {
    setCard((c) => ({ ...c, ...patch }));
  }, []);

  const save = useCallback(
    async (patch?: Partial<BusinessCard>): Promise<BusinessCard | null> => {
      const next: BusinessCard = { ...card, ...(patch || {}) };
      setCard(next);
      setBusy(true);
      setErrorMsg(null);
      const r = await saveBusinessCard(next);
      setBusy(false);
      if (r.ok) {
        const merged: BusinessCard = { ...next, ...r.data };
        setCard(merged);
        publish("businesscard:updated", { cardId: merged.card_id });
        return merged;
      }
      setErrorMsg(r.error);
      return null;
    },
    [card]
  );

  const pickAndSaveLogo = useCallback(
    async (field: "logo_base64" | "photo_base64"): Promise<void> => {
      setBusy(true);
      setErrorMsg(null);
      const pickRes = await pickCardLogo();
      if (!pickRes.ok) {
        setBusy(false);
        setErrorMsg(pickRes.error);
        return;
      }
      if (!pickRes.data) {
        setBusy(false);
        return;
      }
      // reuse save() but bypass the extra busy toggle
      const next: BusinessCard = { ...card, [field]: pickRes.data };
      setCard(next);
      const r = await saveBusinessCard(next);
      setBusy(false);
      if (r.ok) {
        setCard({ ...next, ...r.data });
        publish("businesscard:updated", { cardId: r.data.card_id });
      } else {
        setErrorMsg(r.error);
      }
    },
    [card]
  );

  return { resource, card, busy, errorMsg, update, save, reload, pickAndSaveLogo };
}

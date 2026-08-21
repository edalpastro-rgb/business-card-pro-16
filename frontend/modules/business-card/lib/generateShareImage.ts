/**
 * Share-image generator — captures the two hidden HTML mirrors (front + back)
 * via html2canvas, combines them side-by-side onto a WHITE background, and
 * triggers a native share sheet (or falls back to a download).
 *
 * Web-only. On native the caller should use react-native-view-shot on a ref.
 */
import type { Result } from "@/src/shared";
import { ok, err } from "@/src/shared";
import {
  FRONT_WEB_OUTER_ID,
  BACK_WEB_OUTER_ID,
  FRONT_WEB_ID,
  BACK_WEB_ID,
} from "../constants";

export type ShareImageOpts = {
  fileName?: string;
};

export async function generateAndShareCardPng(opts: ShareImageOpts = {}): Promise<Result<{ shared: boolean }>> {
  try {
    if (typeof document === "undefined") {
      return err<{ shared: boolean }>("Non disponibile fuori dal browser");
    }
    const doc = document;
    const frontEl =
      doc.getElementById(FRONT_WEB_OUTER_ID) || doc.getElementById(FRONT_WEB_ID);
    const backEl =
      doc.getElementById(BACK_WEB_OUTER_ID) || doc.getElementById(BACK_WEB_ID);
    if (!frontEl || !backEl) return err<{ shared: boolean }>("Preview non trovata");

    type Html2Canvas = (el: HTMLElement, opts: {
      backgroundColor: string;
      scale: number;
      useCORS: boolean;
      logging: boolean;
    }) => Promise<HTMLCanvasElement>;
    const mod: { default?: Html2Canvas } = await import("html2canvas");
    const html2canvas: Html2Canvas =
      (mod.default as Html2Canvas | undefined) || (mod as unknown as Html2Canvas);

    const h2cOpts = { backgroundColor: "#ffffff", scale: 3, useCORS: true, logging: false };
    const [frontCanvas, backCanvas] = await Promise.all([
      html2canvas(frontEl as HTMLElement, h2cOpts),
      html2canvas(backEl as HTMLElement, h2cOpts),
    ]);

    const gap = 16 * 3;
    const w = frontCanvas.width + backCanvas.width + gap;
    const h = Math.max(frontCanvas.height, backCanvas.height);
    const combined = doc.createElement("canvas");
    combined.width = w;
    combined.height = h;
    const ctx = combined.getContext("2d");
    if (!ctx) return err<{ shared: boolean }>("Canvas non supportato");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(frontCanvas, 0, (h - frontCanvas.height) / 2);
    ctx.drawImage(backCanvas, frontCanvas.width + gap, (h - backCanvas.height) / 2);

    const dataUri = combined.toDataURL("image/png");
    const fileName = (opts.fileName || "biglietto") + ".png";

    // Try native Web Share API with file support first
    try {
      const resp = await fetch(dataUri);
      const blob = await resp.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files?: File[]; title?: string }) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: "Biglietto da visita" });
        return ok({ shared: true });
      }
    } catch {
      // fall through to download
    }

    // Fallback — trigger a download
    const respFinal = await fetch(dataUri);
    const blobFinal = await respFinal.blob();
    const url = URL.createObjectURL(blobFinal);
    const link = doc.createElement("a");
    link.href = url;
    link.download = fileName;
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return ok({ shared: false });
  } catch (e) {
    return err<{ shared: boolean }>(e instanceof Error ? e.message : "Errore condivisione");
  }
}

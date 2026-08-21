/**
 * Injects the CSS keyframes used by the live preview on web.
 * Idempotent — safe to call multiple times.
 * No-op on native platforms.
 */
import { Platform } from "react-native";
import { ANIM_STYLE_ID } from "../constants";

export function injectAnimationCss(): void {
  if (Platform.OS !== "web") return;
  const doc: Document | undefined = typeof document !== "undefined" ? document : undefined;
  if (!doc) return;
  if (doc.getElementById(ANIM_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ANIM_STYLE_ID;
  style.textContent = `
    @keyframes bcShimmerMove {
      0% { transform: translateX(-140%) skewX(-20deg); }
      100% { transform: translateX(340%) skewX(-20deg); }
    }
    @keyframes bcGoldPulse {
      0%, 100% { box-shadow:
        0 0 0 2px rgba(212, 178, 106, 0.55),
        0 0 22px 4px rgba(212, 178, 106, 0.45),
        0 14px 34px rgba(15, 23, 42, 0.30),
        0 2px 6px rgba(15, 23, 42, 0.12); }
      50% { box-shadow:
        0 0 0 2px rgba(240, 210, 130, 0.85),
        0 0 32px 8px rgba(240, 210, 130, 0.65),
        0 14px 34px rgba(15, 23, 42, 0.32),
        0 2px 6px rgba(15, 23, 42, 0.14); }
    }
    .bc-face-web, [data-bc-goldpulse="1"] { animation: bcGoldPulse 2.6s ease-in-out infinite; position: relative; overflow: hidden; }
    .bc-shimmer, [data-bc-shimmer="1"] {
      position: absolute; top: 0; bottom: 0;
      width: 40%;
      background: linear-gradient(120deg,
        rgba(255,255,255,0) 0%,
        rgba(255,255,255,0.55) 45%,
        rgba(255,255,255,0.85) 50%,
        rgba(255,255,255,0.55) 55%,
        rgba(255,255,255,0) 100%);
      animation: bcShimmerMove 3.2s ease-in-out infinite;
      pointer-events: none;
      mix-blend-mode: overlay;
    }
  `;
  doc.head.appendChild(style);
}

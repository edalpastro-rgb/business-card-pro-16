/**
 * CardHtmlMirrors — hidden HTML representations of front & back used ONLY
 * by html2canvas to generate the shared PNG. Web-only.
 * These are OFF-SCREEN and pointer-events-none; they do not affect UX.
 */
import React from "react";
import { Platform, View } from "react-native";
import type { BusinessCard } from "../types";
import { computeQrValue } from "../lib/vcard";
import {
  CARD_W,
  CARD_H,
  CARD_NAVY,
  CARD_BLUE_MED,
  CARD_GOLD,
  CARD_TEXT,
  CARD_TEXT_MUTED,
  FRONT_WEB_ID,
  BACK_WEB_ID,
  FRONT_WEB_OUTER_ID,
  BACK_WEB_OUTER_ID,
} from "../constants";

type Props = { card: BusinessCard };

export function CardHtmlMirrors({ card }: Props): React.ReactElement | null {
  if (Platform.OS !== "web") return null;
  const qrValue = computeQrValue(card);
  const staticGlow =
    "0 0 0 3px rgba(212,178,106,0.85), 0 0 26px 6px rgba(240,210,130,0.75), 0 0 44px 10px rgba(212,178,106,0.35), 0 14px 30px rgba(15,23,42,0.32)";
  return (
    <View
      style={{ position: "absolute", left: -9999, top: -9999, width: CARD_W * 2 + 200 }}
      pointerEvents="none"
    >
      {/* ===== FRONT OUTER WRAPPER ===== */}
      {/* @ts-expect-error web-only div */}
      <div id={FRONT_WEB_OUTER_ID} style={{ padding: 34, background: "transparent", display: "inline-block" }}>
        {/* @ts-expect-error web-only */}
        <div
          id={FRONT_WEB_ID}
          style={{
            width: CARD_W,
            height: CARD_H,
            background: `linear-gradient(135deg, ${CARD_NAVY} 0%, #223A7F 55%, #1A2A6C 100%)`,
            borderRadius: 14,
            overflow: "hidden",
            border: `2px solid ${CARD_NAVY}`,
            fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            boxShadow: staticGlow,
          }}
        >
          {/* Diagonal stripes overlay */}
          {/* @ts-expect-error web-only */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "repeating-linear-gradient(-32deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 22px)",
            pointerEvents: "none",
          }} />
          {/* Gold inner border */}
          {/* @ts-expect-error web-only */}
          <div style={{
            position: "absolute", top: 8, left: 8, right: 8, bottom: 8,
            borderRadius: 10,
            border: `1px solid ${CARD_GOLD}`,
            pointerEvents: "none",
          }} />
          {/* Static shimmer gradient */}
          {/* @ts-expect-error web-only */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.35) 48%, rgba(255,255,255,0.55) 52%, rgba(255,255,255,0.35) 56%, rgba(255,255,255,0) 74%)",
            pointerEvents: "none",
            mixBlendMode: "screen",
          }} />
          {card.logo_base64 ? (
            <img
              src={card.logo_base64}
              alt="logo"
              style={{
                maxWidth: "70%", maxHeight: "70%", objectFit: "contain",
                position: "relative", zIndex: 2,
                background: "transparent", backgroundColor: "transparent",
                border: "none", boxShadow: "none", outline: "none",
              }}
            />
          ) : (
            // @ts-expect-error web-only
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.7)", position: "relative", zIndex: 2, background: "transparent" }}>
              {/* @ts-expect-error web-only */}
              <div style={{ fontSize: 44, lineHeight: 1 }}>🏢</div>
              {/* @ts-expect-error web-only */}
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 6 }}>Logo Agenzia</div>
            </div>
          )}
        </div>
      </div>

      {/* ===== BACK OUTER WRAPPER ===== */}
      {/* @ts-expect-error web-only */}
      <div id={BACK_WEB_OUTER_ID} style={{ padding: 34, background: "transparent", display: "inline-block" }}>
        {/* @ts-expect-error web-only */}
        <div
          id={BACK_WEB_ID}
          style={{
            width: CARD_W,
            height: CARD_H,
            background: "linear-gradient(135deg, #FFFFFF 0%, #F5F7FA 55%, #EDEFF3 100%)",
            borderRadius: 14,
            overflow: "hidden",
            border: `2px solid ${CARD_NAVY}`,
            fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "18px 20px",
            color: CARD_TEXT,
            boxShadow: staticGlow,
          }}
        >
          {/* Noise/texture */}
          {/* @ts-expect-error web-only */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "repeating-linear-gradient(45deg, rgba(26,42,108,0.025) 0 1px, transparent 1px 6px)",
            pointerEvents: "none",
          }} />
          {/* Static shimmer */}
          {/* @ts-expect-error web-only */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(230,240,255,0.55) 48%, rgba(255,255,255,0.75) 52%, rgba(230,240,255,0.55) 56%, rgba(255,255,255,0) 74%)",
            pointerEvents: "none",
          }} />
          {/* Header — name + title + separator + contacts */}
          {/* @ts-expect-error web-only */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative", zIndex: 1 }}>
            {/* @ts-expect-error web-only */}
            <div style={{ fontSize: 20, fontWeight: 800, color: CARD_NAVY, letterSpacing: 0.2, textAlign: "center" }}>
              {card.display_name || "Il tuo nome"}
            </div>
            {card.title ? (
              // @ts-expect-error web-only
              <div style={{ fontSize: 12, fontStyle: "italic", color: CARD_BLUE_MED, marginTop: 1, textAlign: "center" }}>{card.title}</div>
            ) : null}
            {/* @ts-expect-error web-only */}
            <div style={{ width: 60, height: 1, background: CARD_BLUE_MED, marginTop: 6, marginBottom: 6, opacity: 0.5 }} />
            {/* @ts-expect-error web-only */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              {card.phone ? (
                // @ts-expect-error web-only
                <div style={{ fontSize: 11, color: CARD_TEXT, letterSpacing: 0.2 }}>
                  <span style={{ color: CARD_BLUE_MED, marginRight: 4 }}>☎</span>{card.phone}
                </div>
              ) : null}
              {card.email ? (
                // @ts-expect-error web-only
                <div style={{ fontSize: 11, color: CARD_TEXT, letterSpacing: 0.2 }}>
                  <span style={{ color: CARD_BLUE_MED, marginRight: 4 }}>✉</span>{card.email}
                </div>
              ) : null}
            </div>
          </div>
          {/* Footer — company + website + QR */}
          {/* @ts-expect-error web-only */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, borderTop: `1px solid ${CARD_BLUE_MED}40`, paddingTop: 8, marginTop: 6, position: "relative", zIndex: 1 }}>
            {/* @ts-expect-error web-only */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              {card.company_name ? (
                // @ts-expect-error web-only
                <div style={{ fontSize: 12, fontWeight: 800, color: CARD_NAVY, letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {card.company_name}
                </div>
              ) : null}
              {card.website ? (
                // @ts-expect-error web-only
                <div style={{ fontSize: 10, color: CARD_TEXT_MUTED, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {card.website}
                </div>
              ) : null}
            </div>
            {/* @ts-expect-error web-only */}
            <div style={{ width: 62, height: 62, background: "#FFF", padding: 3, borderRadius: 4, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrValue || " ")}&size=120x120&color=1A2A6C&bgcolor=FFFFFF&margin=0`}
                alt="qr"
                width={56}
                height={56}
                style={{ display: "block" }}
              />
            </div>
          </div>
        </div>
      </div>
    </View>
  );
}

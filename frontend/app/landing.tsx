// landing.tsx — V50.z530 — Landing pubblica «Axon Core» (sostituisce la landing V50.z313–z422: demo player, confronto IA, modularità).
// Contenuti, prezzi e posti Founder arrivano dal backend (GET /public/landing) e si modificano dal pannello CMS /admin/landing-cms.
// La vecchia versione resta nella cronologia git (commit precedenti a V50.z530).
import React from "react";
import { AxonCoreLanding } from "@/src/landing/AxonCoreLanding";

export default function LandingScreen() {
  return <AxonCoreLanding />;
}

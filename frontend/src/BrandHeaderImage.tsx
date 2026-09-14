// src/BrandHeaderImage.tsx — V50.z232 — Header brand condiviso (Home + Interfaccia Master).
// • Immagine header «pulita» (senza il vecchio logo AxonOS scuro impresso) + nuovo logo AxonOS (sfondo chiaro) in basso a destra, PICCOLO.
// • Personalizzazione Aziendale: se il Master ha caricato un logo aziendale, questo SOSTITUISCE il logo AdvisorOS nell'header
//   per tutti gli utenti del tenant (sfondo scuro pieno + logo centrato); AxonOS resta il componente, sempre più piccolo.
import React, { useEffect, useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { api } from "@/src/api";
import { AXONOS_LOGO_LIGHT, AXONOS_LOGO_LIGHT_ASPECT } from "@/src/BrandLogos";

const HEADER_CLEAN = require("@/assets/images/advisoros-home-header-clean.jpg");

export type OrgBranding = { company_name: string; vat: string; address: string; extra: string; logo_data_uri: string | null; logo_name: string | null; can_edit?: boolean };
let _cache: OrgBranding | null = null;
const _subs = new Set<(b: OrgBranding | null) => void>();
/** Firma «Ragione sociale · P.IVA … · Indirizzo · extra» (stringa vuota se non configurata). */
export function orgSignature(b: OrgBranding | null | undefined): string {
  if (!b) return "";
  return [b.company_name, b.vat ? `P.IVA ${b.vat}` : "", b.address, b.extra].filter(Boolean).join(" · ");
}
/** Firma aziendale caricandola dal server se non in cache (per export PDF). */
export async function fetchOrgSignature(): Promise<string> {
  if (!_cache) { try { setOrgBrandingCache(await api<OrgBranding>("/org/branding")); } catch { /* ignore */ } }
  return orgSignature(_cache);
}
export function setOrgBrandingCache(b: OrgBranding | null) { _cache = b; _subs.forEach((f) => f(b)); }
export function useOrgBranding(): OrgBranding | null {
  const [b, setB] = useState<OrgBranding | null>(_cache);
  useEffect(() => {
    _subs.add(setB);
    if (!_cache) api<OrgBranding>("/org/branding").then((r) => setOrgBrandingCache(r)).catch(() => {});
    return () => { _subs.delete(setB); };
  }, []);
  return b;
}

export function BrandHeaderImage({ radius = 12 }: { radius?: number }) {
  const b = useOrgBranding();
  const axonW = 78;
  return (
    <>
      {b?.logo_data_uri ? (
        <View style={[styles.fill, styles.orgBg, { borderRadius: radius }]} testID="brand-header-org">
          <Image source={{ uri: b.logo_data_uri }} resizeMode="contain" style={styles.orgLogo} accessibilityLabel={b.company_name || "Logo aziendale"} />
        </View>
      ) : (
        <Image source={HEADER_CLEAN} resizeMode="cover" style={[styles.fill, { borderRadius: radius }]} testID="brand-header-advisoros" />
      )}
      {/* Nuovo logo AxonOS (asset a sfondo chiaro): piccolo, in basso a destra, sempre più piccolo del logo principale */}
      <View pointerEvents="none" style={styles.axonBox} testID="brand-header-axon-logo">
        <Image source={AXONOS_LOGO_LIGHT} resizeMode="contain" style={{ width: axonW, height: Math.round(axonW / AXONOS_LOGO_LIGHT_ASPECT) }} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
  orgBg: { backgroundColor: "#0B1E38", alignItems: "center", justifyContent: "center", padding: 18 },
  orgLogo: { width: "70%", height: "62%" },
  axonBox: { position: "absolute", right: 12, bottom: 12, borderRadius: 8, overflow: "hidden", backgroundColor: "#E6EBEE" },
});

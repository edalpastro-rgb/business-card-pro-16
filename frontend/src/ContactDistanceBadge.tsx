// ContactDistanceBadge.tsx — V50.z241 — FEAT-GEO-001 Fase 3: pill «📍 X km da te» nell'header della scheda contatto.
// Origine: GPS se il permesso è già concesso, altrimenti indirizzo ufficio («dall'ufficio»). Tap → chiede il GPS
// (contestuale) e ricalcola; se nessuna origine disponibile il badge non viene mostrato.
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { silentGpsOrigin, requestGpsOrigin, fmtKm, GeoDistancesResp, GeoPoint } from "@/src/utils/geoOrigin";

export function ContactDistanceBadge({ contactId, hasAddress }: { contactId: string; hasAddress: boolean }) {
  const [res, setRes] = useState<{ km: number; min: number; label: string; kind: "gps" | "office" } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const compute = useCallback(async (origin: GeoPoint | null) => {
    setBusy(true);
    try {
      const body: any = { targets: [{ id: "c", contact_id: contactId }] };
      if (origin) { body.origin_lat = origin.lat; body.origin_lon = origin.lon; }
      const r = await api<GeoDistancesResp>("/geo/distances-from", { method: "POST", body });
      const d = r.results?.c;
      setRes(r.origin && d ? { ...d, label: r.origin.label, kind: r.origin.kind } : null);
    } catch { setRes(null); } finally { setBusy(false); }
  }, [contactId]);

  useEffect(() => { if (hasAddress) silentGpsOrigin().then(compute); else setRes(null); }, [hasAddress, compute]);

  if (!hasAddress || res === null) return null;
  return (
    <Pressable
      testID="contact-distance-badge"
      onPress={async () => { if (busy) return; const g = res?.kind === "gps" ? await silentGpsOrigin() : await requestGpsOrigin(); await compute(g); }}
      style={styles.pill}
      accessibilityLabel={res ? `${fmtKm(res.km)} ${res.label}` : "Calcolo distanza"}
    >
      {busy || res === undefined ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={res.kind === "gps" ? "locate" : "business"} size={12} color="#FFF" />}
      <Text style={styles.txt} numberOfLines={1}>
        {res ? `📍 ${fmtKm(res.km)} ${res.label} · ~${res.min} min${res.kind === "office" ? " · tocca per GPS" : ""}` : "Calcolo distanza…"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 999, paddingHorizontal: 10, minHeight: 28, marginTop: 6 },
  txt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
});

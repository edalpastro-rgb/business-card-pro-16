// pdf-viewer.tsx — V50.z400 — Rotta del VISUALIZZATORE PDF INTERNO (pdf.js in WebView). Parametri: url, name, page, auth (1 = Bearer
// dell'utente), dl (URL di download), mime. Usata da tutte le sezioni del Corporate Gym (manuali Drive e materiali area).
import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { PdfViewer } from "@/src/pdf/PdfViewer";
import { getToken } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { downloadToDevice } from "@/src/corporate-gym/manualsApi";

export default function PdfViewerRoute() {
  const router = useRouter();
  const p = useLocalSearchParams<{ url?: string; name?: string; page?: string; auth?: string; dl?: string; mime?: string }>();
  const url = String(p.url || "");
  const name = String(p.name || "Documento");
  const page = Math.max(1, parseInt(String(p.page || "1"), 10) || 1);
  const [token, setToken] = useState<string | null | undefined>(p.auth === "1" ? undefined : null);
  const [dl, setDl] = useState(false);
  useEffect(() => { if (p.auth === "1") getToken().then((t) => setToken(t || null)); }, [p.auth]);

  const download = async () => {
    setDl(true);
    try { notify(await downloadToDevice(String(p.dl || url), name, String(p.mime || "application/pdf"), token ? { Authorization: `Bearer ${token}` } : undefined)); }
    catch (e: any) { notify(e?.message || "Download non riuscito"); } finally { setDl(false); }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      {token !== undefined ? (
        <PdfViewer url={url} name={name} page={page} authToken={token} onClose={() => (router.canGoBack() ? router.back() : router.replace("/corporate-gym" as any))} onDownload={p.dl || url ? download : undefined} downloading={dl} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#0F172A" } });

// CrtSaveShareBlock.tsx — V50.z326 — BLOCCO 4 «Salvataggio e condivisione»: 4 bottoni grandi con conferma e destinazione.
import React from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify, confirmAsync } from "@/src/utils/notify";
import { shareDataUri } from "@/src/share";
import { crtStyles as s } from "@/app/crt/index";

type Props = { practiceId: string; contactName: string; hasPdf: boolean; busy: string | null; run: (key: string, fn: () => Promise<void>, ok?: string) => Promise<void>; onQr: () => void; onMerge: () => void };

export function CrtSaveShareBlock({ practiceId, contactName, hasPdf, busy, run, onQr, onMerge }: Props) {
  const need = () => { if (!hasPdf) { notify("CRT", "Genera prima il documento unico (Blocco 3)"); return false; } return true; };
  const saveClient = async () => {
    if (!need()) return;
    if (!(await confirmAsync("Salvare nella cartella cliente?", `Destinazione: allegati di ${contactName}. Il PDF unico viene rigenerato con le ultime correzioni.`))) return;
    onMerge();
  };
  const saveMaster = async () => {
    if (!need()) return;
    if (!(await confirmAsync("Salvare nel database Master?", "Destinazione: Master Files › Documenti (visibile a tutto il team)."))) return;
    await run("save-master", async () => { await api(`/crt/${practiceId}/save-master`, { method: "POST" }); }, "Salvato nel database Master");
  };
  const share = async () => {
    if (!need()) return;
    const viaLink = await confirmAsync("Come vuoi condividere?", "OK = link/QR sicuro per il cliente · Annulla = invia il file via email/WhatsApp");
    if (viaLink) { onQr(); return; }
    await run("share", async () => { const r = await api<any>(`/crt/${practiceId}/merged`); await shareDataUri(`data:${r.mime};base64,${r.data_base64}`, r.name, r.mime); });
  };
  const print = async () => {
    if (!need()) return;
    const wifi = await confirmAsync("Stampa", "OK = stampante WiFi/AirPrint · Annulla = invia il PDF via email da stampare");
    await run("print", async () => {
      const r = await api<any>(`/crt/${practiceId}/merged`);
      const uri = `data:application/pdf;base64,${r.data_base64}`;
      if (wifi && Platform.OS !== "web") { await Print.printAsync({ uri }); return; }
      await shareDataUri(uri, r.name, "application/pdf");
    });
  };
  const Btn = ({ k, icon, label, sub, color, onPress, testID }: { k: string; icon: any; label: string; sub: string; color: string; onPress: () => void; testID: string }) => (
    <Pressable onPress={onPress} disabled={!!busy} style={{ flexBasis: "48%", flexGrow: 1, minHeight: 92, borderRadius: 16, backgroundColor: color, padding: 12, gap: 4, justifyContent: "center", opacity: busy && busy !== k ? 0.6 : 1 }} testID={testID}>
      {busy === k ? <ActivityIndicator color="#FFF" /> : <Ionicons name={icon} size={26} color="#FFF" />}
      <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 }}>{label}</Text>
      <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11.5 }}>{sub}</Text>
    </Pressable>
  );
  return (
    <View style={s.card} testID="crt-block-save">
      <Text style={s.section}>BLOCCO 4 · Salvataggio e condivisione</Text>
      <Text style={s.hint}>Ogni salvataggio chiede conferma e destinazione.{hasPdf ? "" : " Genera prima il documento unico nel Blocco 3."}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Btn k="merge" icon="folder-open" label="Salva nella cartella cliente" sub="Allegati del contatto" color="#15803D" onPress={() => void saveClient()} testID="crt-save-client" />
        <Btn k="save-master" icon="server" label="Salva nel database Master" sub="Master Files › Documenti" color="#7C3AED" onPress={() => void saveMaster()} testID="crt-save-master" />
        <Btn k="share" icon="share-social" label="Condividi" sub="Email · WhatsApp · link/QR" color={theme.color.brandPrimary} onPress={() => void share()} testID="crt-share" />
        <Btn k="print" icon="print" label="Stampa" sub="WiFi/AirPrint o via email" color="#0F766E" onPress={() => void print()} testID="crt-print" />
      </View>
    </View>
  );
}

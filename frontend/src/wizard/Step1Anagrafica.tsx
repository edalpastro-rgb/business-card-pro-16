// src/wizard/Step1Anagrafica.tsx — V50.z212 — BLOCCO 2 · Step 1 «Anagrafica» del wizard Set Up and Go.
// Obbligatori: nome, cognome, data di nascita, codice fiscale, telefono, mail · Opzionali: indirizzo principale, seconda abitazione, indirizzo parente.
// Regole: CF → decodifica (data di nascita, sesso) + proposta nome/cognome con «Conferma»/«Modifica»; a fine step popup «Quale mail uso per
// risponderti e ricevere file?»; se più indirizzi → «Qual è quello principale?». Fonte di verità: /master/profile (= pagina Anagrafica) → sync automatica.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Modal, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { DateField } from "@/src/ui/DateField"; // V50.z388 — calendario nativo su ogni campo data
import { DocScanButton, type DocScanResult } from "@/src/DocScanButton"; // V50.z487 — «Scansiona documento d'identità» compila tutti i campi

const PURPLE = "#7C3AED";
export type Anag = {
  first_name: string; last_name: string; birth_date: string; tax_id: string; phone: string; emails: string[]; primary_email: string;
  address: string; address_second: string; address_relative: string; primary_address: "main" | "second" | "relative" | "";
  sex?: string; birth_place_code?: string; cf_confirmed?: boolean;
};
const EMPTY: Anag = { first_name: "", last_name: "", birth_date: "", tax_id: "", phone: "", emails: [""], primary_email: "", address: "", address_second: "", address_relative: "", primary_address: "" };
const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

type CfDecode = { valid: boolean; reason?: string; birth_date?: string; sex?: string; birth_place_code?: string; suggest?: { first_name: string; last_name: string; birth_date: string }; consistency?: { first_name: boolean | null; last_name: boolean | null }; note?: string };

/** Il genitore (setup.tsx) chiama `submit()` quando l'utente preme «Continua»: valida, gestisce i popup e salva. Ritorna true se si può avanzare. */
export type StepBinder = (submit: () => Promise<boolean>) => void;

export function Step1Anagrafica({ bind }: { bind: StepBinder }) {
  const [a, setA] = useState<Anag>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cf, setCf] = useState<CfDecode | null>(null);
  const [cfBusy, setCfBusy] = useState(false);
  const [askMail, setAskMail] = useState(false);
  const [askAddr, setAskAddr] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const aRef = useRef(a); aRef.current = a;

  useEffect(() => {
    api<Partial<Anag>>("/master/profile").then((p) => {
      setA({ ...EMPTY, ...p, emails: (p.emails && p.emails.length ? p.emails : [p.primary_email || ""]) as string[], primary_address: (p.primary_address as Anag["primary_address"]) || "" });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const set = (k: keyof Anag, v: string) => setA((s) => ({ ...s, [k]: v }));

  // V50.z487 — documento scansionato → compila SOLO i campi vuoti (quanto già scritto dall'utente ha priorità); CF → decodifica
  const applyScan = (r: DocScanResult) => {
    const d = r.fields || {};
    const addr = d.address || [d.address_street, [d.address_zip, d.address_city].filter(Boolean).join(" "), d.address_province].filter(Boolean).join(", ");
    setA((s) => {
      const emails = [...s.emails];
      if (d.email && !emails.some((m) => m.trim().toLowerCase() === d.email.toLowerCase())) { const i = emails.findIndex((m) => !m.trim()); if (i >= 0) emails[i] = d.email; else if (emails.length < 3) emails.push(d.email); }
      return {
        ...s,
        first_name: s.first_name.trim() || d.first_name || "", last_name: s.last_name.trim() || d.last_name || "",
        birth_date: s.birth_date || d.birth_date || "", phone: s.phone.trim() || d.phone || "", address: s.address.trim() || addr || "",
        sex: s.sex || d.sex || undefined, emails,
      };
    });
    if (d.tax_id && d.tax_id.length === 16 && !aRef.current.tax_id) void onCf(d.tax_id);
    setErrors({});
  };
  const setEmail = (i: number, v: string) => setA((s) => { const e = [...s.emails]; e[i] = v; return { ...s, emails: e }; });

  // Codice fiscale → decodifica al 16° carattere
  const onCf = async (raw: string) => {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    set("tax_id", v); setCf(null); setA((s) => ({ ...s, tax_id: v, cf_confirmed: false }));
    if (v.length === 16) {
      setCfBusy(true);
      try { setCf(await api<CfDecode>("/axon/anagrafica/cf-decode", { method: "POST", body: { tax_id: v, first_name: aRef.current.first_name, last_name: aRef.current.last_name } })); }
      catch { setCf({ valid: false, reason: "Verifica non riuscita" }); } finally { setCfBusy(false); }
    }
  };
  const confirmCf = () => {
    if (!cf?.valid || !cf.suggest) return;
    // quanto già scritto dall'utente ha priorità sulla proposta ricavata dall'account
    setA((s) => ({ ...s, first_name: s.first_name.trim() || cf.suggest!.first_name, last_name: s.last_name.trim() || cf.suggest!.last_name, birth_date: cf.birth_date || s.birth_date, sex: cf.sex, birth_place_code: cf.birth_place_code, cf_confirmed: true }));
  };
  const editCf = () => setA((s) => ({ ...s, birth_date: cf?.birth_date || s.birth_date, sex: cf?.sex, birth_place_code: cf?.birth_place_code, cf_confirmed: false }));

  const validate = (s: Anag) => {
    const e: Record<string, string> = {};
    if (s.first_name.trim().length < 2) e.first_name = "Inserisci il nome";
    if (s.last_name.trim().length < 2) e.last_name = "Inserisci il cognome";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.birth_date) && !/^\d{2}\/\d{2}\/\d{4}$/.test(s.birth_date)) e.birth_date = "Formato GG/MM/AAAA";
    if (s.tax_id.length !== 16 || (cf && !cf.valid)) e.tax_id = cf?.reason || "Codice fiscale di 16 caratteri";
    if (s.phone.replace(/\D/g, "").length < 8) e.phone = "Inserisci un telefono valido";
    const mails = s.emails.map((m) => m.trim().toLowerCase()).filter(Boolean);
    if (!mails.length || mails.some((m) => !EMAIL_RE.test(m))) e.emails = "Inserisci almeno una mail valida";
    return e;
  };

  const ask = (setter: (v: boolean) => void) => new Promise<boolean>((res) => { resolver.current = res; setter(true); });
  const answer = (setter: (v: boolean) => void, ok: boolean) => { setter(false); resolver.current?.(ok); resolver.current = null; };

  const submit = useCallback(async (): Promise<boolean> => {
    let s = aRef.current;
    const e = validate(s); setErrors(e);
    if (Object.keys(e).length) return false;
    const mails = Array.from(new Set(s.emails.map((m) => m.trim().toLowerCase()).filter(Boolean)));
    s = { ...s, emails: mails }; setA(s);
    // Regola mail: popup di scelta (anche con una sola mail la confermiamo esplicitamente)
    if (!s.primary_email || !mails.includes(s.primary_email)) {
      if (mails.length === 1) { s = { ...s, primary_email: mails[0] }; setA(s); }
      else if (!(await ask(setAskMail))) return false;
      s = aRef.current;
    }
    // Regola indirizzo: più di uno → quale è il principale
    const addrs = [s.address, s.address_second, s.address_relative].filter((x) => x.trim());
    if (addrs.length > 1 && !s.primary_address) { if (!(await ask(setAskAddr))) return false; s = aRef.current; }
    if (addrs.length === 1 && !s.primary_address) s = { ...s, primary_address: s.address ? "main" : s.address_second ? "second" : "relative" };
    const bd = /^\d{2}\/\d{2}\/\d{4}$/.test(s.birth_date) ? s.birth_date.split("/").reverse().join("-") : s.birth_date;
    try {
      await api("/master/profile", { method: "PUT", body: { ...s, birth_date: bd, cf_confirmed: s.cf_confirmed ?? !!cf?.valid } });
      return true;
    } catch (err: any) { setErrors({ save: err?.message || "Salvataggio non riuscito" }); return false; }
  }, [cf]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bind(submit); }, [bind, submit]);

  if (loading) return <ActivityIndicator color={HT.violet} style={{ marginTop: 20 }} />;
  const mails = a.emails.map((m) => m.trim().toLowerCase()).filter(Boolean);

  return (
    <View style={{ gap: 12 }} testID="step1-anagrafica">
      <DocScanButton hint="identity" label="Scansiona documento d'identità" sublabel="Carta d'identità o passaporto: compilo nome, cognome, data di nascita, codice fiscale e indirizzo" onExtracted={applyScan} testID="anag-doc-scan" />
      <Text style={styles.section}>Codice fiscale</Text>
      <Field label="Codice fiscale *" value={a.tax_id} onChangeText={onCf} autoCapitalize="characters" placeholder="RSSMRA80A01H501U" error={errors.tax_id} testID="anag-tax-id" right={cfBusy ? <ActivityIndicator size="small" color={HT.violet} /> : cf?.valid ? <Ionicons name="checkmark-circle" size={20} color="#059669" /> : null} />
      {cf && !cf.valid && <Text style={styles.err}>{cf.reason}</Text>}
      {cf?.valid && cf.suggest && (
        <View style={styles.cfBox} testID="anag-cf-box">
          <Text style={styles.cfTitle}>Dal codice fiscale ho ricavato:</Text>
          <Text style={styles.cfRow}>👤 {cf.suggest.first_name || "—"} {cf.suggest.last_name || "—"}</Text>
          <Text style={styles.cfRow}>🎂 {fmtDate(cf.birth_date)} · {cf.sex === "F" ? "F" : "M"}</Text>
          <Text style={styles.cfNote}>{cf.note}</Text>
          {a.cf_confirmed ? <Text style={[styles.cfNote, { color: "#059669", fontWeight: "800" }]}>✓ Confermato</Text> : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={confirmCf} style={styles.cfBtn} testID="anag-cf-confirm"><Text style={styles.cfBtnTxt}>Conferma</Text></Pressable>
              <Pressable onPress={editCf} style={[styles.cfBtn, styles.cfBtnAlt]} testID="anag-cf-edit"><Text style={[styles.cfBtnTxt, { color: HT.violet }]}>Modifica</Text></Pressable>
            </View>
          )}
        </View>
      )}

      <Text style={styles.section}>Dati personali</Text>
      <Field label="Nome *" value={a.first_name} onChangeText={(v) => set("first_name", v)} error={errors.first_name} testID="anag-first-name" />
      <Field label="Cognome *" value={a.last_name} onChangeText={(v) => set("last_name", v)} error={errors.last_name} testID="anag-last-name" />
      <View style={{ gap: 4 }}>
        <Text style={styles.label}>Data di nascita *</Text>
        <DateField value={fmtDate(a.birth_date)} onChange={(v) => set("birth_date", v)} format="it" placeholder="Data di nascita" testID="anag-birth-date" />
        {errors.birth_date ? <Text style={styles.err}>{errors.birth_date}</Text> : null}
      </View>
      <Field label="Telefono *" value={a.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" placeholder="+39 …" error={errors.phone} testID="anag-phone" />

      <Text style={styles.section}>Email</Text>
      {a.emails.map((m, i) => (
        <Field key={i} label={i === 0 ? "Mail *" : `Mail ${i + 1}`} value={m} onChangeText={(v) => setEmail(i, v)} keyboardType="email-address" autoCapitalize="none" placeholder="nome@dominio.it" testID={`anag-email-${i}`}
          right={a.primary_email && a.primary_email === m.trim().toLowerCase() ? <Text style={styles.primaryTag}>risposte & file</Text> : i > 0 ? <Pressable onPress={() => setA((s) => ({ ...s, emails: s.emails.filter((_, j) => j !== i) }))} hitSlop={8}><Ionicons name="close-circle" size={20} color={HT.muted} /></Pressable> : null} />
      ))}
      {errors.emails && <Text style={styles.err}>{errors.emails}</Text>}
      {a.emails.length < 3 && <Pressable onPress={() => setA((s) => ({ ...s, emails: [...s.emails, ""] }))} style={styles.addBtn} testID="anag-add-email"><Ionicons name="add" size={16} color={HT.violet} /><Text style={styles.addTxt}>Aggiungi un'altra mail</Text></Pressable>}

      <Text style={styles.section}>Indirizzi (facoltativi)</Text>
      <Field label="Indirizzo principale" value={a.address} onChangeText={(v) => set("address", v)} placeholder="Via, numero, città" testID="anag-address" />
      <Field label="Seconda abitazione" value={a.address_second} onChangeText={(v) => set("address_second", v)} testID="anag-address-second" />
      <Field label="Indirizzo di un parente" value={a.address_relative} onChangeText={(v) => set("address_relative", v)} testID="anag-address-relative" />
      {errors.save && <Text style={styles.err}>{errors.save}</Text>}
      <Text style={styles.sync}>🔄 Questi dati sono gli stessi della tua Anagrafica: ogni modifica qui, lì o in chat con Axon si aggiorna ovunque. Non ti verranno mai richiesti.</Text>

      {/* Popup mail */}
      <Modal visible={askMail} transparent animationType="fade" onRequestClose={() => answer(setAskMail, false)}>
        <View style={styles.backdrop}><View style={styles.sheet} testID="anag-mail-popup">
          <Text style={styles.sheetTitle}>Quale mail uso per risponderti e ricevere file?</Text>
          {mails.map((m) => (
            <Pressable key={m} onPress={() => { setA((s) => ({ ...s, primary_email: m })); setTimeout(() => answer(setAskMail, true), 50); }} style={styles.opt} testID={`anag-mail-pick-${m}`}>
              <Ionicons name="mail" size={18} color={HT.violet} /><Text style={styles.optTxt}>{m}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => answer(setAskMail, false)} style={styles.cancel}><Text style={styles.cancelTxt}>Annulla</Text></Pressable>
        </View></View>
      </Modal>
      {/* Popup indirizzo principale */}
      <Modal visible={askAddr} transparent animationType="fade" onRequestClose={() => answer(setAskAddr, false)}>
        <View style={styles.backdrop}><View style={styles.sheet} testID="anag-addr-popup">
          <Text style={styles.sheetTitle}>Hai inserito più indirizzi: qual è quello principale?</Text>
          {([["main", a.address, "Indirizzo principale"], ["second", a.address_second, "Seconda abitazione"], ["relative", a.address_relative, "Indirizzo di un parente"]] as Array<[Anag["primary_address"], string, string]>).filter((x) => x[1].trim()).map(([k, v, l]) => (
            <Pressable key={k} onPress={() => { setA((s) => ({ ...s, primary_address: k })); setTimeout(() => answer(setAskAddr, true), 50); }} style={styles.opt} testID={`anag-addr-pick-${k}`}>
              <Ionicons name="home" size={18} color={HT.violet} /><View style={{ flex: 1 }}><Text style={styles.optLbl}>{l}</Text><Text style={styles.optTxt}>{v}</Text></View>
            </Pressable>
          ))}
          <Pressable onPress={() => answer(setAskAddr, false)} style={styles.cancel}><Text style={styles.cancelTxt}>Annulla</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

function fmtDate(v?: string): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function Field({ label, value, onChangeText, error, right, testID, ...rest }: { label: string; value: string; onChangeText: (v: string) => void; error?: string; right?: React.ReactNode; testID?: string } & Omit<Partial<React.ComponentProps<typeof TextInput>>, "onChangeText" | "value">) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, !!error && { borderColor: '#DC2626' }]}>
        <TextInput value={value} onChangeText={onChangeText} style={styles.input} placeholderTextColor={HT.muted} testID={testID} {...rest} />
        {right}
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: "800", color: "#7C3AED", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  label: { fontSize: 12.5, fontWeight: "700", color: HT.text2 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  input: { flex: 1, fontSize: 15, color: HT.text, paddingVertical: Platform.OS === "web" ? 10 : 8 },
  err: { fontSize: 11.5, color: "#DC2626", fontWeight: "700" },
  cfBox: { backgroundColor: HT.violetTint, borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: HT.violet + '66' },
  cfTitle: { fontSize: 12.5, fontWeight: "800", color: HT.violet },
  cfRow: { fontSize: 15, fontWeight: "700", color: HT.text },
  cfNote: { fontSize: 11.5, color: HT.violet, lineHeight: 15 },
  cfBtn: { backgroundColor: PURPLE, borderRadius: 999, paddingHorizontal: 16, minHeight: 40, justifyContent: "center" },
  cfBtnAlt: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.violet },
  cfBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  primaryTag: { fontSize: 10.5, fontWeight: "800", color: "#059669", backgroundColor: HT.successTint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 },
  addTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
  sync: { fontSize: 11.5, color: HT.muted, lineHeight: 16, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: HT.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: HT.text, marginBottom: 4 },
  opt: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card2, borderRadius: 14, padding: 14, minHeight: 52, borderWidth: 1, borderColor: HT.border },
  optLbl: { fontSize: 11.5, color: HT.muted, fontWeight: "700" },
  optTxt: { fontSize: 15, fontWeight: "700", color: HT.text },
  cancel: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  cancelTxt: { color: HT.muted, fontWeight: "700" },
});

// V50.z314 — Modulo «Richiedi una demo» (nome, azienda, telefono, email opzionale) → POST /public/demo-request.
// Il lead arriva al proprietario della piattaforma in Home (bubble Axon), in chat e in «Richieste Info (Lead)».
import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp, ZoomIn } from "react-native-reanimated";
import { api } from "@/src/api";
import { LP } from "@/src/landing/palette";

export function DemoRequestForm() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot (nascosto)
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && company.trim().length >= 1 && phone.replace(/\D/g, "").length >= 6 && consent;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/public/demo-request", {
        method: "POST",
        body: { full_name: name.trim(), company: company.trim(), phone: phone.trim(), email: email.trim() || undefined, consent_privacy: consent, website },
      });
      setDone(true);
    } catch (e: any) {
      setErr(e?.message || "Invio non riuscito. Riprova tra poco o scrivi a info@advisoros.it");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Animated.View entering={ZoomIn.duration(400)} style={[f.card, f.doneCard]} testID="demo-form-done">
        <View style={f.okRing}><Ionicons name="checkmark" size={30} color={LP.onBrand} /></View>
        <Text style={f.doneTitle}>Richiesta inviata!</Text>
        <Text style={f.doneTxt}>Grazie {name.trim().split(" ")[0]}. Ti richiamiamo al più presto per fissare la demo di AdvisorOS per {company.trim()}.</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInUp.duration(600)} style={f.card} testID="demo-form">
      <View style={f.row}>
        <Field label="Nome e cognome" value={name} onChange={setName} placeholder="Mario Rossi" testID="demo-name" autoComplete="name" />
        <Field label="Azienda" value={company} onChange={setCompany} placeholder="Energia Srl" testID="demo-company" autoComplete="organization" />
      </View>
      <View style={f.row}>
        <Field label="Telefono" value={phone} onChange={setPhone} placeholder="+39 333 1234567" testID="demo-phone" keyboardType="phone-pad" autoComplete="tel" />
        <Field label="Email (opzionale)" value={email} onChange={setEmail} placeholder="mario@azienda.it" testID="demo-email" keyboardType="email-address" autoComplete="email" />
      </View>
      {/* honeypot: invisibile agli utenti, compilato solo dai bot */}
      <View style={f.honey} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <TextInput value={website} onChangeText={setWebsite} tabIndex={-1 as any} />
      </View>
      <Pressable onPress={() => setConsent((c) => !c)} style={f.consentRow} testID="demo-consent" accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
        <View style={[f.check, consent && f.checkOn]}>{consent ? <Ionicons name="checkmark" size={14} color={LP.onBrand} /> : null}</View>
        <Text style={f.consentTxt}>Acconsento a essere ricontattato per la demo. I dati sono usati solo per questo scopo e restano in AdvisorOS.</Text>
      </Pressable>
      {err ? <Text style={f.err} testID="demo-error">{err}</Text> : null}
      <Pressable onPress={submit} disabled={!valid || busy} style={({ pressed }) => [f.btn, (!valid || busy) && f.btnOff, pressed && { opacity: 0.85 }]} testID="demo-submit" accessibilityRole="button">
        {busy ? <ActivityIndicator color={LP.onBrand} /> : (
          <>
            <Text style={f.btnTxt}>RICHIEDI LA DEMO</Text>
            <Ionicons name="send" size={16} color={LP.onBrand} />
          </>
        )}
      </Pressable>
      <Text style={f.hint}>Ti richiamiamo noi. Nessun impegno.</Text>
    </Animated.View>
  );
}

function Field({ label, value, onChange, placeholder, testID, keyboardType, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; testID: string;
  keyboardType?: "default" | "phone-pad" | "email-address"; autoComplete?: any;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={f.field}>
      <Text style={f.lbl}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={LP.muted}
        keyboardType={keyboardType || "default"}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
        autoComplete={autoComplete}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[f.input, focus && f.inputFocus, Platform.OS === "web" && ({ outlineStyle: "none" } as any)]}
        testID={testID}
      />
    </View>
  );
}

const f = StyleSheet.create({
  card: { backgroundColor: LP.surface2, borderRadius: 22, borderWidth: 1, borderColor: LP.axonLine, padding: 20, gap: 14, shadowColor: LP.axon, shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  field: { flexGrow: 1, flexBasis: 220, gap: 6 },
  lbl: { color: LP.onSurface2, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: LP.borderStrong, backgroundColor: LP.surface, color: LP.onSurface, paddingHorizontal: 14, fontSize: 15 },
  inputFocus: { borderColor: LP.axon },
  honey: { position: "absolute", width: 1, height: 1, opacity: 0, left: -1000 },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 44 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: LP.borderStrong, backgroundColor: LP.surface, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkOn: { backgroundColor: LP.brand, borderColor: LP.brand },
  consentTxt: { flex: 1, color: LP.onSurface2, fontSize: 12, lineHeight: 17 },
  err: { color: LP.errorText, fontSize: 13, fontWeight: "700" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 54, borderRadius: 999, backgroundColor: LP.brand, shadowColor: LP.brand, shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
  btnOff: { opacity: 0.45, shadowOpacity: 0 },
  btnTxt: { color: LP.onBrand, fontSize: 15, fontWeight: "900", letterSpacing: 1.6 },
  hint: { color: LP.muted, fontSize: 12, textAlign: "center" },
  doneCard: { alignItems: "center", gap: 10, paddingVertical: 32 },
  okRing: { width: 64, height: 64, borderRadius: 32, backgroundColor: LP.brand, alignItems: "center", justifyContent: "center", shadowColor: LP.brand, shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  doneTitle: { color: LP.onSurface, fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  doneTxt: { color: LP.onSurface2, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 420 },
});

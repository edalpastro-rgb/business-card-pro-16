import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium
import { DateField } from "@/src/ui/DateField"; // V50.z388 — calendario nativo su ogni campo data

/**
 * V50.z67 — Sezione "Campi Personalizzati" nella scheda contatto.
 * Legge le definizioni dal tenant (endpoint filtra per visibilità),
 * renderizza gli input in base al tipo e salva su onBlur (checkbox: immediato).
 */
type FieldType = "text" | "number" | "date" | "checkbox";
type Visibility = "master" | "all";
type FieldDef = {
  field_id: string;
  key: string;
  name: string;
  type: FieldType;
  visibility: Visibility;
  order: number;
  required?: boolean;
};

const TYPE_ICONS: Record<FieldType, keyof typeof import("@expo/vector-icons/build/Ionicons").glyphMap> = {
  text: "text-outline",
  number: "calculator-outline",
  date: "calendar-outline",
  checkbox: "checkbox-outline",
};

type Props = {
  contactId: string;
  initialValues?: Record<string, any> | null;
  onSaved?: () => void;
};

export function ContactCustomFieldsSection({ contactId, initialValues, onSaved }: Props) {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, any>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    setValues(initialValues || {});
  }, [initialValues]);

  const loadDefs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api<FieldDef[]>("/contact-custom-fields");
      setDefs(list || []);
    } catch (e) {
      // Se c'è errore, nascondi la sezione — non blocca la scheda
      setDefs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDefs();
  }, [loadDefs]);

  const saveValue = useCallback(
    async (key: string, val: any) => {
      setSavingKey(key);
      try {
        const nextCustom = { ...(values || {}), [key]: val };
        await api(`/contacts/${contactId}`, {
          method: "PUT",
          body: { custom_fields: nextCustom },
        });
        setValues(nextCustom);
        onSaved?.();
      } catch (e: any) {
        notify("Errore", e?.message || "Salvataggio non riuscito");
      } finally {
        setSavingKey(null);
      }
    },
    [contactId, values, onSaved]
  );

  if (loading) {
    return (
      <View style={styles.section}>
        <ActivityIndicator color={HT.brand} />
      </View>
    );
  }

  if (defs.length === 0) {
    return null; // Nessun campo custom definito → non mostrare nulla
  }

  return (
    <View style={styles.section} testID="contact-custom-fields-section">
      <View style={styles.header}>
        <Ionicons name="options-outline" size={16} color={HT.brand} />
        <Text style={styles.title}>Campi personalizzati</Text>
      </View>

      {defs.map((d) => {
        const cur = values[d.key];
        const isSaving = savingKey === d.key;
        return (
          <View key={d.field_id} style={styles.row}>
            <View style={styles.labelRow}>
              <Ionicons name={TYPE_ICONS[d.type]} size={14} color={HT.muted} />
              <Text style={styles.label}>
                {d.name}
                {d.required ? <Text style={styles.reqStar}> *</Text> : null}
              </Text>
              {d.visibility === "master" ? (
                <View style={styles.badge}>
                  <Ionicons name="lock-closed" size={9} color="#7C2D12" />
                  <Text style={styles.badgeTxt}>Master</Text>
                </View>
              ) : null}
              {isSaving ? <ActivityIndicator size="small" color={HT.brand} /> : null}
            </View>

            {d.type === "checkbox" ? (
              <Pressable
                onPress={() => saveValue(d.key, !cur)}
                style={[styles.checkboxRow, cur ? styles.checkboxOn : null]}
                testID={`cf-${d.key}`}
              >
                <Ionicons
                  name={cur ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={cur ? "#16A34A" : HT.muted}
                />
                <Text style={styles.checkboxTxt}>{cur ? "Sì" : "No"}</Text>
              </Pressable>
            ) : d.type === "number" ? (
              <TextInput
                testID={`cf-${d.key}`}
                defaultValue={cur !== undefined && cur !== null ? String(cur) : ""}
                onBlur={(e) => {
                  const raw = (e.nativeEvent as any).text ?? "";
                  const parsed = raw === "" ? null : Number(raw.replace(",", "."));
                  if (raw !== "" && (parsed === null || Number.isNaN(parsed))) {
                    notify("Attenzione", `"${d.name}" deve essere un numero valido`);
                    return;
                  }
                  saveValue(d.key, parsed);
                }}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={HT.muted}
                style={styles.input}
              />
            ) : d.type === "date" ? (
              <DateField
                testID={`cf-${d.key}`}
                value={cur ? String(cur) : ""}
                onChange={(v) => saveValue(d.key, v || null)}
                placeholder="Scegli la data"
              />
            ) : (
              <TextInput
                testID={`cf-${d.key}`}
                defaultValue={cur || ""}
                onBlur={(e) => {
                  const raw = (e.nativeEvent as any).text ?? "";
                  saveValue(d.key, raw || null);
                }}
                placeholder="—"
                placeholderTextColor={HT.muted}
                style={styles.input}
                multiline={false}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: HT.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HT.border,
    padding: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: HT.border,
  },
  title: { fontSize: 14, fontWeight: "800", color: HT.text },
  row: { marginBottom: 12 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  label: { fontSize: 12, fontWeight: "700", color: HT.text, flex: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: HT.dangerTint,
  },
  badgeTxt: { fontSize: 9, fontWeight: "700", color: "#7C2D12" },
  reqStar: { color: HT.warning, fontWeight: "900" },
  input: {
    borderWidth: 1,
    borderColor: HT.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: HT.text,
    backgroundColor: HT.card2,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HT.border,
    backgroundColor: HT.card2,
    alignSelf: "flex-start",
  },
  checkboxOn: { backgroundColor: HT.successTint, borderColor: '#16A34A' },
  checkboxTxt: { fontSize: 13, fontWeight: "700", color: HT.text },
});

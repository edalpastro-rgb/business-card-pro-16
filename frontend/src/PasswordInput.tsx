// V50.z433 — Campo password con icona occhio (mostra/nascondi). Sostituisce `<TextInput secureTextEntry />` ovunque
// nell'app ci sia una PASSWORD (registrazione, login, recupero, impostazioni, team, SMTP, credenziali…).
// Accetta tutte le props di TextInput: `style` va sull'input (come prima), il wrapper aggiunge solo l'icona a destra.
import { useState } from "react";
import { View, TextInput, Pressable, StyleSheet, type TextInputProps, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";

type Props = Omit<TextInputProps, "secureTextEntry"> & { containerStyle?: StyleProp<ViewStyle>; iconColor?: string };

export function PasswordInput({ containerStyle, iconColor, style, testID, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        {...rest}
        testID={testID}
        secureTextEntry={!visible}
        autoCapitalize={rest.autoCapitalize ?? "none"}
        autoCorrect={false}
        style={[style, styles.inputPad]}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={10}
        style={styles.eye}
        accessibilityRole="button"
        accessibilityLabel={visible ? "Nascondi password" : "Mostra password"}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={iconColor || HT.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", justifyContent: "center" },
  inputPad: { paddingRight: 46 },
  eye: { position: "absolute", right: 0, top: 0, bottom: 0, width: 44, alignItems: "center", justifyContent: "center" },
});

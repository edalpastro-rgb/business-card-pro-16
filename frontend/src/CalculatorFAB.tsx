// V26.o — Floating Calculator FAB with modal
import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { useRegisterFab } from "@/src/FabStack";

type Op = "+" | "-" | "×" | "÷" | null;

export function CalculatorFAB() {
  const [open, setOpen] = useState(false);
  // Register presence so the AI Assistant FAB can shift to avoid overlap
  useRegisterFab("calculator", true);
  return (
    <>
      <Pressable
        testID="calc-fab"
        onPress={() => setOpen(true)}
        style={styles.fab}
        accessibilityLabel="Apri calcolatrice"
      >
        <Ionicons name="calculator" size={26} color="#FFF" />
      </Pressable>
      <CalculatorModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CalculatorModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [waiting, setWaiting] = useState(false);

  const inputDigit = (d: string) => {
    if (waiting) {
      setDisplay(d);
      setWaiting(false);
    } else {
      setDisplay(display === "0" ? d : display + d);
    }
  };
  const inputDot = () => {
    if (waiting) { setDisplay("0."); setWaiting(false); return; }
    if (!display.includes(".")) setDisplay(display + ".");
  };
  const clear = () => { setDisplay("0"); setPrev(null); setOp(null); setWaiting(false); };
  const toggleSign = () => {
    setDisplay(display.startsWith("-") ? display.slice(1) : "-" + display);
  };
  const percent = () => {
    setDisplay(String(parseFloat(display) / 100));
  };
  const compute = (a: number, b: number, o: Op): number => {
    switch (o) {
      case "+": return a + b;
      case "-": return a - b;
      case "×": return a * b;
      case "÷": return b === 0 ? NaN : a / b;
      default: return b;
    }
  };
  const setOperator = (nextOp: Op) => {
    const current = parseFloat(display);
    if (prev == null) {
      setPrev(current);
    } else if (op) {
      const result = compute(prev, current, op);
      setDisplay(formatResult(result));
      setPrev(result);
    }
    setOp(nextOp);
    setWaiting(true);
  };
  const equals = () => {
    const current = parseFloat(display);
    if (op && prev != null) {
      const result = compute(prev, current, op);
      setDisplay(formatResult(result));
      setPrev(null);
      setOp(null);
      setWaiting(true);
    }
  };
  const backspace = () => {
    if (waiting) return;
    if (display.length <= 1 || (display.length === 2 && display.startsWith("-"))) {
      setDisplay("0");
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const Btn = ({ label, onPress, variant, span }: { label: string; onPress: () => void; variant?: "op" | "acc" | "eq" | "clr"; span?: 2 }) => (
    <Pressable
      testID={`calc-key-${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        span === 2 && { flex: 2.15 },
        variant === "op" && styles.keyOp,
        variant === "acc" && styles.keyAcc,
        variant === "eq" && styles.keyEq,
        variant === "clr" && styles.keyClr,
        pressed && { opacity: 0.65 },
      ]}
    >
      <Text style={[styles.keyTxt, (variant === "op" || variant === "eq" || variant === "clr") && { color: "#FFF" }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headTitle}>Calcolatrice</Text>
              {op && prev != null ? (
                <Text style={styles.headSub}>{formatResult(prev)} {op}</Text>
              ) : null}
            </View>
            <Pressable testID="calc-close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={theme.color.muted} />
            </Pressable>
          </View>
          <View style={styles.displayBox}>
            <Text style={styles.displayTxt} numberOfLines={1} adjustsFontSizeToFit>{display}</Text>
          </View>
          <View style={styles.pad}>
            <View style={styles.row}>
              <Btn label="AC" onPress={clear} variant="clr" />
              <Btn label="±" onPress={toggleSign} variant="acc" />
              <Btn label="%" onPress={percent} variant="acc" />
              <Btn label="÷" onPress={() => setOperator("÷")} variant="op" />
            </View>
            <View style={styles.row}>
              <Btn label="7" onPress={() => inputDigit("7")} />
              <Btn label="8" onPress={() => inputDigit("8")} />
              <Btn label="9" onPress={() => inputDigit("9")} />
              <Btn label="×" onPress={() => setOperator("×")} variant="op" />
            </View>
            <View style={styles.row}>
              <Btn label="4" onPress={() => inputDigit("4")} />
              <Btn label="5" onPress={() => inputDigit("5")} />
              <Btn label="6" onPress={() => inputDigit("6")} />
              <Btn label="-" onPress={() => setOperator("-")} variant="op" />
            </View>
            <View style={styles.row}>
              <Btn label="1" onPress={() => inputDigit("1")} />
              <Btn label="2" onPress={() => inputDigit("2")} />
              <Btn label="3" onPress={() => inputDigit("3")} />
              <Btn label="+" onPress={() => setOperator("+")} variant="op" />
            </View>
            <View style={styles.row}>
              <Btn label="0" onPress={() => inputDigit("0")} span={2} />
              <Btn label="." onPress={inputDot} />
              <Btn label="=" onPress={equals} variant="eq" />
            </View>
            <View style={styles.rowSmall}>
              <Pressable testID="calc-backspace" onPress={backspace} style={styles.bsBtn}>
                <Ionicons name="backspace-outline" size={18} color={theme.color.muted} />
                <Text style={styles.bsTxt}>Cancella</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatResult(n: number): string {
  if (!isFinite(n)) return "Errore";
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(8)).toString();
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: "0 4px 12px rgba(0,0,0,0.25)" } as any,
      default: { shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6 },
    }),
    zIndex: 100,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: 32,
    maxHeight: "90%",
  },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  headTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  headSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  displayBox: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 20,
    alignItems: "flex-end",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  displayTxt: { fontSize: 40, fontWeight: "700", color: theme.color.onSurface },
  pad: { gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  rowSmall: { alignItems: "center", marginTop: 4 },
  key: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  keyTxt: { fontSize: 22, fontWeight: "600", color: theme.color.onSurface },
  keyOp: { backgroundColor: "#F59E0B" },
  keyEq: { backgroundColor: theme.color.brandPrimary },
  keyClr: { backgroundColor: "#DC2626" },
  keyAcc: { backgroundColor: "#CBD5E1" },
  bsBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  bsTxt: { color: theme.color.muted, fontWeight: "600", fontSize: 12 },
});

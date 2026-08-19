import { Alert, AlertButton, Platform } from "react-native";

/**
 * Cross-platform alert wrapper.
 *
 * V38D BUG FIX: previously the buttons array was silently ignored on web
 * (falling through to window.alert), which caused destructive `onPress`
 * callbacks (like delete bill / delete audio / delete contact group) to
 * never fire. Now:
 *  - On native: delegates to Alert.alert(title, message, buttons)
 *  - On web: uses window.confirm() when buttons contain a destructive/OK
 *    action, mapping confirm=OK / cancel=Annulla, and invokes the
 *    corresponding onPress handler.
 */
export function notify(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== "web") {
    if (buttons && buttons.length > 0) {
      Alert.alert(title, message, buttons);
    } else {
      Alert.alert(title, message);
    }
    return;
  }
  // Web path
  if (typeof window === "undefined") return;
  if (!buttons || buttons.length === 0) {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  // Single-button case → alert + call onPress
  if (buttons.length === 1) {
    window.alert(message ? `${title}\n\n${message}` : title);
    try { buttons[0].onPress?.(); } catch {}
    return;
  }
  // Multi-button case → use window.confirm and pick action based on user choice
  const confirmed = window.confirm(message ? `${title}\n\n${message}` : title);
  if (confirmed) {
    // Find the "accept" button: prefer destructive → default → first non-cancel
    const dest = buttons.find((b) => b.style === "destructive");
    const nonCancel = buttons.find((b) => b.style !== "cancel");
    const target = dest || nonCancel || buttons[buttons.length - 1];
    try { target?.onPress?.(); } catch {}
  } else {
    // User cancelled → invoke the cancel handler if any
    const cancel = buttons.find((b) => b.style === "cancel");
    try { cancel?.onPress?.(); } catch {}
  }
}

/**
 * Cross-platform confirm. Returns promise resolving true/false.
 * On web uses window.confirm, on native uses Alert.alert with two buttons.
 */
export function confirmAsync(title: string, message?: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(message ? `${title}\n\n${message}` : title)
        : true,
    );
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Annulla", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

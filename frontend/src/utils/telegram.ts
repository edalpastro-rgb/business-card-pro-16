import { Linking, Platform } from "react-native";

/**
 * Open a Telegram profile using the tg:// scheme first (works with both
 * Telegram and Telegram X), falling back to the https://t.me/ universal link
 * if the native scheme is unavailable (e.g. on the web preview).
 */
export async function openTelegram(usernameOrRaw: string, text?: string): Promise<boolean> {
  const u = (usernameOrRaw || "").replace(/^@/, "").trim();
  if (!u) return false;

  const suffix = text ? `&text=${encodeURIComponent(text)}` : "";
  const nativeUri = `tg://resolve?domain=${encodeURIComponent(u)}${suffix}`;
  const webUri = `https://t.me/${u}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

  // On mobile, try the native scheme first — both Telegram AND Telegram X handle tg://
  if (Platform.OS !== "web") {
    try {
      const can = await Linking.canOpenURL(nativeUri);
      if (can) {
        await Linking.openURL(nativeUri);
        return true;
      }
    } catch {}
  }
  try {
    await Linking.openURL(webUri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Direct message a Telegram user with pre-filled text.
 * Note: Telegram doesn't officially support prefilled text via `tg://` on all
 * platforms — the https://t.me/ URL is the most reliable path when a message
 * body is required. We still try `tg://msg_url?url=...` as a Telegram X-friendly
 * escape hatch on iOS.
 */
export async function sendTelegramMessage(usernameOrRaw: string, text: string): Promise<boolean> {
  const u = (usernameOrRaw || "").replace(/^@/, "").trim();
  if (!u) return false;

  // The `tg://resolve?domain=...&text=...` form works with both clients on Android/iOS.
  const nativeUri = `tg://resolve?domain=${encodeURIComponent(u)}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
  const webUri = `https://t.me/${u}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

  if (Platform.OS !== "web") {
    try {
      const can = await Linking.canOpenURL(nativeUri);
      if (can) {
        await Linking.openURL(nativeUri);
        return true;
      }
    } catch {}
  }
  try {
    await Linking.openURL(webUri);
    return true;
  } catch {
    return false;
  }
}

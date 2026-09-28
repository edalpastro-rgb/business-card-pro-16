// wakeLink.ts — V50.z398 — Link pubblico della pagina /wake-training (stesso dominio dell'app) + condivisione/copia.
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { notify } from "@/src/utils/notify";

export const WAKE_TRAINING_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL}/wake-training`;

export async function shareWakeTrainingLink() {
  try {
    if (Platform.OS === "web") { await Clipboard.setStringAsync(WAKE_TRAINING_URL); notify("Link copiato"); return; }
    await Share.share({ message: `Aiuta ad addestrare Axon: registra la tua voce in 5 minuti → ${WAKE_TRAINING_URL}`, url: WAKE_TRAINING_URL });
  } catch { /* annullato */ }
}

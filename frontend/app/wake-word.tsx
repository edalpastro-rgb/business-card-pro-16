// wake-word.tsx — V50.z378 — La vecchia pagina placeholder (mock WakeWordService) è stata rimossa: l'ascolto continuo «Axon»
// è gestito da ViolaWakeProvider (motore ONNX: axonWakeAudio + axonWakeModel). Redirect per vecchi link.
import { Redirect } from "expo-router";

export default function WakeWordRedirect() {
  return <Redirect href={"/viola-wake" as any} />;
}

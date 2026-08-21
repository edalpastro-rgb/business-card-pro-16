/**
 * Route file — /business-card
 * All logic lives in the `business-card` module. This file is intentionally
 * a THIN wrapper: it only mounts the screen inside a ModuleErrorBoundary so
 * a crash cannot bring down other modules.
 */
import { BusinessCardScreen } from "@/modules/business-card";
import { ModuleErrorBoundary } from "@/src/shared";

export default function BusinessCardRoute() {
  return (
    <ModuleErrorBoundary moduleName="business-card">
      <BusinessCardScreen />
    </ModuleErrorBoundary>
  );
}

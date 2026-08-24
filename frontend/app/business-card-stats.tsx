/**
 * Route file — /business-card-stats
 * V28 — Analytics for the digital business card public link.
 */
import { BusinessCardStatsScreen } from "@/modules/business-card";
import { ModuleErrorBoundary } from "@/src/shared";

export default function BusinessCardStatsRoute() {
  return (
    <ModuleErrorBoundary moduleName="business-card-stats">
      <BusinessCardStatsScreen />
    </ModuleErrorBoundary>
  );
}

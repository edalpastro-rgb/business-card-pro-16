/**
 * Invoice Analysis module — PUBLIC API.
 *
 * NOTE (Fase 3): the UI component `BillsSection` lives at
 * /app/frontend/src/BillsSection.tsx and is used inside contact/[id]. It is
 * protected by the parent's ModuleErrorBoundary (`contacts` module). A future
 * full move will relocate it under modules/invoice-analysis/components/.
 */
export type {
  BillType,
  BillStatus,
  EnergyBill,
  BillCreateInput,
  BillGrouped,
  CompanyOffer,
} from "./types";

export {
  listContactBills,
  createBill,
  reanalyzeBill,
  cancelBillAnalysis,
  deleteBill,
  getBillReport,
  getBillComparison,
  listCompanyOffers,
} from "./api";

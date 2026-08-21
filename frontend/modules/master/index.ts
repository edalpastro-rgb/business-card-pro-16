/**
 * Master module — PUBLIC API.
 * Shares base types (BillType, EnergyBill) with invoice-analysis for
 * the architectural symmetry required by the refactoring spec.
 */
export type {
  MasterCategory,
  MasterFile,
  Contract,
  WebLink,
  BillType,
  BillStatus,
  EnergyBill,
} from "./types";

export {
  listMasterFiles,
  createMasterFile,
  deleteMasterFile,
  listContracts,
  getNewContractAlerts,
  markContractsSeen,
  listWebLinks,
} from "./api";

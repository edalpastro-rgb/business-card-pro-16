/**
 * Contacts module — PUBLIC API.
 * Other modules MUST import ONLY from here.
 *
 * Exports:
 *  - Types: Contact, ContactLite, ContactNote, ContactFile, ContactGroup, CustomArea, ContactArea, etc.
 *  - Hooks: useContact, useContactsList
 *  - API: listContacts, getContact, createContact, updateContact, deleteContact, assignContact, listGroups
 *
 * NOTE (Fase 2): the UI screens for /contact/new and /contact/[id] currently live in
 * /app/contact/*.tsx due to their size (~3200 lines combined). They import from this
 * module's public API for types + API calls + hooks. A future full migration will
 * move them under modules/contacts/screens/.
 */
export type {
  Contact,
  ContactLite,
  ContactWriteInput,
  ContactGroup,
  ContactNote,
  ContactNoteKind,
  ContactNoteCategory,
  ContactFile,
  Anniversary,
  ContactArea,
  ContactSource,
  ContactReferralType,
  CustomArea,
  ContactSettings,
} from "./types";

export {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  assignContact,
  listGroups,
} from "./api";

export { useContact } from "./hooks/useContact";
export { useContactsList } from "./hooks/useContactsList";

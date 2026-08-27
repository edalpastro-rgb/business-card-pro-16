/**
 * V29.am — Polyfills globali per ambiente Hermes (React Native)
 *
 * Deve essere IMPORTATO PER PRIMO in _layout.tsx, prima di qualsiasi altro
 * import, altrimenti moduli come `jspdf` valutano `new TextDecoder("latin1")`
 * a livello di modulo e crashano su Hermes con:
 *   RangeError: Unknown encoding: latin1 (normalized: latin1)
 *
 * `text-encoding` è la reference implementation WHATWG e supporta tutti gli
 * encoding legacy (latin1, iso-8859-*, windows-125*, ecc.) che Hermes non
 * copre.
 *
 * NB: NON aggiungiamo altri polyfill se non necessario per evitare regressioni.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const te = require("text-encoding");

const g: any = globalThis as any;

// Sostituzione forzata: la TextDecoder di Hermes esiste ma non supporta
// gli encoding legacy come latin1. Meglio usare l'implementazione completa.
if (te?.TextEncoder) g.TextEncoder = te.TextEncoder;
if (te?.TextDecoder) g.TextDecoder = te.TextDecoder;

export {};

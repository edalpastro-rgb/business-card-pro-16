// V50.z315 — ViolaWake SDK: stub WEB della cattura comando (il modulo nativo non è disponibile nel browser).
import type { CaptureOptions, PermissionStatus } from "./types";

export const CAPTURE_SUPPORTED = false;

export async function getMicPermission(): Promise<PermissionStatus> { return { granted: false, canAskAgain: false }; }
export async function requestMicPermission(): Promise<PermissionStatus> { return { granted: false, canAskAgain: false }; }
export async function requestRecognizerPermission(): Promise<PermissionStatus> { return { granted: false, canAskAgain: false }; }
export function recognitionAvailable(): boolean { return false; }
export function supportsOnDevice(): boolean { return false; }
export async function captureCommand(_opts: CaptureOptions): Promise<string> { return ""; }
export function abortCapture() { /* noop */ }

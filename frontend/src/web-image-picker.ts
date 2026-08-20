/**
 * Web Image Picker – uses native HTML <input type="file"> + FileReader.readAsDataURL().
 * This is a robust replacement for expo-image-picker on the web platform,
 * where expo-image-picker occasionally throws "Failed to read the selected media".
 *
 * NOTE: This module must ONLY be imported on web (Platform.OS === 'web').
 * On native, use expo-image-picker directly.
 */

export type WebPickedAsset = {
  uri: string;              // dataURL (data:image/...;base64,...)
  base64: string;           // pure base64 (no prefix)
  mimeType: string;         // e.g. image/jpeg
  fileName: string;         // original filename
  size: number;             // bytes
  file: File;               // the underlying File object
  width?: number;
  height?: number;
};

export type WebPickerOptions = {
  accept?: string;          // e.g. "image/*", "image/*,application/pdf", "video/*"
  multiple?: boolean;       // default false
  capture?: "user" | "environment" | boolean; // for camera on mobile web
};

/**
 * Reads a File object to a data URL using FileReader.
 * Returns { dataUrl, base64, mimeType }.
 */
function readFileAsDataURL(file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const commaIdx = dataUrl.indexOf(",");
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : "";
      // Extract mime from dataUrl prefix if present, fallback to file.type
      const mimeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);
      const mimeType = (mimeMatch && mimeMatch[1]) || file.type || "application/octet-stream";
      resolve({ dataUrl, base64, mimeType });
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.onabort = () => reject(new Error("FileReader aborted"));
    try {
      reader.readAsDataURL(file);
    } catch (e) {
      reject(e as Error);
    }
  });
}

/**
 * Get intrinsic image dimensions (best-effort). Returns undefined values on failure.
 */
function getImageDimensions(dataUrl: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = dataUrl;
    } catch {
      resolve({});
    }
  });
}

/**
 * Opens a hidden native <input type="file"> element and returns picked assets.
 * Returns [] if user cancels.
 */
export async function pickFilesWeb(options: WebPickerOptions = {}): Promise<WebPickedAsset[]> {
  if (typeof document === "undefined") return [];

  const { accept = "image/*", multiple = false, capture } = options;

  return new Promise<WebPickedAsset[]>((resolve, reject) => {
    let settled = false;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = !!multiple;
    if (capture !== undefined) {
      // Setting capture on some browsers hints camera usage on mobile web
      try {
        // @ts-ignore - `capture` attribute isn't fully typed
        input.capture = typeof capture === "boolean" ? "" : capture;
      } catch {}
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";

    const cleanup = () => {
      try { if (input.parentNode) input.parentNode.removeChild(input); } catch {}
      window.removeEventListener("focus", onFocusFallback, true);
    };

    // Some browsers don't fire 'cancel' when user closes the file dialog.
    // We fall back to detecting window focus without any files selected.
    const onFocusFallback = () => {
      // Give the browser a tick to populate input.files
      setTimeout(() => {
        if (settled) return;
        if (!input.files || input.files.length === 0) {
          settled = true;
          cleanup();
          resolve([]);
        }
      }, 400);
    };

    input.addEventListener("cancel", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve([]);
    });

    input.addEventListener("change", async () => {
      if (settled) return;
      settled = true;
      try {
        const files = Array.from(input.files || []);
        if (files.length === 0) {
          cleanup();
          resolve([]);
          return;
        }
        const assets: WebPickedAsset[] = [];
        for (const file of files) {
          try {
            const { dataUrl, base64, mimeType } = await readFileAsDataURL(file);
            let dims: { width?: number; height?: number } = {};
            if (mimeType.startsWith("image/")) {
              dims = await getImageDimensions(dataUrl);
            }
            assets.push({
              uri: dataUrl,
              base64,
              mimeType,
              fileName: file.name || `upload-${Date.now()}`,
              size: file.size,
              file,
              width: dims.width,
              height: dims.height,
            });
          } catch (err) {
            // Skip files that fail; do not reject entire batch
            console.warn("[web-image-picker] Failed to read file", file?.name, err);
          }
        }
        cleanup();
        resolve(assets);
      } catch (err) {
        cleanup();
        reject(err as Error);
      }
    });

    document.body.appendChild(input);
    // Register focus fallback AFTER attaching input to DOM
    window.addEventListener("focus", onFocusFallback, true);

    // Trigger the native file dialog
    try {
      input.click();
    } catch (err) {
      cleanup();
      reject(err as Error);
    }
  });
}

/**
 * Convenience: pick a single image on web, return a data URL (or null on cancel).
 */
export async function pickSingleImageDataUrlWeb(accept = "image/*"): Promise<string | null> {
  const assets = await pickFilesWeb({ accept, multiple: false });
  if (!assets || assets.length === 0) return null;
  return assets[0].uri;
}

/**
 * Convenience: pick a single image on web, return the full asset (or null on cancel).
 */
export async function pickSingleImageAssetWeb(accept = "image/*"): Promise<WebPickedAsset | null> {
  const assets = await pickFilesWeb({ accept, multiple: false });
  if (!assets || assets.length === 0) return null;
  return assets[0];
}

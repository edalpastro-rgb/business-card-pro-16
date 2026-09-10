/**
 * V50.z146 — Config plugin locale: forza nel AndroidManifest.xml la dichiarazione
 * hardcoded di `android.permission.CAMERA` (+ `uses-feature android.hardware.camera`,
 * required=false) indipendentemente dai plugin delle librerie e da `expo.android.permissions`.
 * Idempotente: non duplica le voci se già presenti.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const PERMISSIONS = ["android.permission.CAMERA"];
const FEATURES = [
  { name: "android.hardware.camera", required: "false" },
  { name: "android.hardware.camera.autofocus", required: "false" },
];

module.exports = function withCameraPermission(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    for (const name of PERMISSIONS) {
      const exists = manifest["uses-permission"].some((p) => p.$ && p.$["android:name"] === name);
      if (!exists) manifest["uses-permission"].push({ $: { "android:name": name } });
    }
    manifest["uses-feature"] = manifest["uses-feature"] || [];
    for (const f of FEATURES) {
      const exists = manifest["uses-feature"].some((x) => x.$ && x.$["android:name"] === f.name);
      if (!exists) manifest["uses-feature"].push({ $: { "android:name": f.name, "android:required": f.required } });
    }
    return cfg;
  });
};

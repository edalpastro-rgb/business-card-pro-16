/**
 * V50.z315 — Config plugin ViolaWake (Picovoice Porcupine + riconoscimento vocale on-device).
 *  - Android: permessi RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE
 *    (+ POST_NOTIFICATIONS già dichiarato) e copia di assets/keywords/viola_android.ppn in app/src/main/assets.
 *  - iOS: copia di assets/keywords/viola_ios.ppn nel bundle (gruppo ViolaWakeModels).
 *  I file .ppn si scaricano da console.picovoice.ai dopo aver addestrato la parola «Viola»
 *  (uno per Android, uno per iOS). Se mancano, il plugin NON fallisce: l'app userà la parola di
 *  fallback integrata («Jarvis») finché non verranno aggiunti e non si rifarà la build.
 */
const { withAndroidManifest, withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PERMISSIONS = [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
];
const ANDROID_PPN = "viola_android.ppn";
const IOS_PPN = "viola_ios.ppn";
const IT_MODEL = "porcupine_params_it.pv"; // modello lingua ITALIANO (obbligatorio per parole italiane)

function keywordsDir(projectRoot) {
  return path.join(projectRoot, "assets", "keywords");
}

module.exports = function withViolaWake(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    for (const name of PERMISSIONS) {
      if (!manifest["uses-permission"].some((p) => p.$ && p.$["android:name"] === name)) {
        manifest["uses-permission"].push({ $: { "android:name": name } });
      }
    }
    manifest["uses-feature"] = manifest["uses-feature"] || [];
    if (!manifest["uses-feature"].some((x) => x.$ && x.$["android:name"] === "android.hardware.microphone")) {
      manifest["uses-feature"].push({ $: { "android:name": "android.hardware.microphone", "android:required": "false" } });
    }
    return cfg;
  });

  config = withDangerousMod(config, ["android", async (cfg) => {
    const src = path.join(keywordsDir(cfg.modRequest.projectRoot), ANDROID_PPN);
    if (fs.existsSync(src)) {
      const dest = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets");
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(src, path.join(dest, ANDROID_PPN));
      const model = path.join(keywordsDir(cfg.modRequest.projectRoot), IT_MODEL);
      if (fs.existsSync(model)) fs.copyFileSync(model, path.join(dest, IT_MODEL));
    } else {
      console.warn(`[ViolaWake] ${ANDROID_PPN} non trovato in assets/keywords: userò la parola di fallback.`);
    }
    return cfg;
  }]);

  config = withDangerousMod(config, ["ios", async (cfg) => {
    const src = path.join(keywordsDir(cfg.modRequest.projectRoot), IOS_PPN);
    if (fs.existsSync(src)) {
      const dest = path.join(cfg.modRequest.platformProjectRoot, "ViolaWakeModels");
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(src, path.join(dest, IOS_PPN));
      const model = path.join(keywordsDir(cfg.modRequest.projectRoot), IT_MODEL);
      if (fs.existsSync(model)) fs.copyFileSync(model, path.join(dest, IT_MODEL));
    } else {
      console.warn(`[ViolaWake] ${IOS_PPN} non trovato in assets/keywords: userò la parola di fallback.`);
    }
    return cfg;
  }]);

  config = withXcodeProject(config, (cfg) => {
    const src = path.join(keywordsDir(cfg.modRequest.projectRoot), IOS_PPN);
    if (!fs.existsSync(src)) return cfg;
    const project = cfg.modResults;
    const rel = `ViolaWakeModels/${IOS_PPN}`;
    if (project.hasFile && project.hasFile(rel)) return cfg;
    const group = project.addPbxGroup([], "ViolaWakeModels", "ViolaWakeModels");
    project.addResourceFile(rel, { target: project.getFirstTarget().uuid, group: group.uuid });
    if (fs.existsSync(path.join(keywordsDir(cfg.modRequest.projectRoot), IT_MODEL))) {
      project.addResourceFile(`ViolaWakeModels/${IT_MODEL}`, { target: project.getFirstTarget().uuid, group: group.uuid });
    }
    return cfg;
  });

  return config;
};

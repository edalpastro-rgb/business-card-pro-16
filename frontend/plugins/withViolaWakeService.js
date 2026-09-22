/**
 * V50.z316 — Config plugin: SERVIZIO NATIVO ANDROID IN PRIMO PIANO per ViolaWake.
 * Genera in prebuild il codice Kotlin (Service + modulo React Native) e lo registra:
 *  - ViolaWakeService.kt: Foreground Service con foregroundServiceType="microphone" e notifica
 *    persistente «Viola in ascolto» → Android non sospende il microfono con schermo bloccato.
 *  - ViolaWakeServiceModule.kt / ViolaWakePackage.kt: NativeModules.ViolaWakeService.start(title, body) / stop()
 *  - AndroidManifest: <service android:name=".violawake.ViolaWakeService" .../>
 *  - MainApplication.kt: add(ViolaWakePackage())
 * Idempotente. Solo Android (su iOS il background audio è gestito da UIBackgroundModes=audio).
 */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SERVICE_NAME = ".violawake.ViolaWakeService";

function kotlinService(pkg) {
  return `package ${pkg}.violawake

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/** Servizio in primo piano: tiene vivo il processo e il microfono per la wake-word «Viola». */
class ViolaWakeService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra("title") ?: "Viola in ascolto"
        val body = intent?.getStringExtra("body") ?: "Di' «Viola» per parlare con Axon"
        val notification = buildNotification(title, body)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_STICKY
    }

    private fun buildNotification(title: String, body: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Viola · ascolto vocale", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Mostra quando Viola è in ascolto della parola di attivazione"
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stopIntent = Intent(this, ViolaWakeService::class.java).setAction(ACTION_STOP)
        val stopPi = PendingIntent.getService(this, 1, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val icon = applicationInfo.icon
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(icon)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pi)
            .addAction(0, "Spegni", stopPi)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "violawake_listening"
        const val NOTIFICATION_ID = 42117
        const val ACTION_STOP = "${pkg}.violawake.STOP"
    }
}
`;
}

function kotlinModule(pkg) {
  return `package ${pkg}.violawake

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ViolaWakeServiceModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "ViolaWakeService"

    @ReactMethod
    fun start(title: String, body: String, promise: Promise) {
        try {
            val i = Intent(ctx, ViolaWakeService::class.java)
            i.putExtra("title", title)
            i.putExtra("body", body)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VIOLA_FGS_START", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            ctx.stopService(Intent(ctx, ViolaWakeService::class.java))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VIOLA_FGS_STOP", e.message, e)
        }
    }
}
`;
}

function kotlinPackage(pkg) {
  return `package ${pkg}.violawake

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ViolaWakePackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(ViolaWakeServiceModule(ctx))
    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;
}

module.exports = function withViolaWakeService(config) {
  const pkg = config.android && config.android.package;
  if (!pkg) return config;

  config = withDangerousMod(config, ["android", async (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "java", ...pkg.split("."), "violawake");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ViolaWakeService.kt"), kotlinService(pkg));
    fs.writeFileSync(path.join(dir, "ViolaWakeServiceModule.kt"), kotlinModule(pkg));
    fs.writeFileSync(path.join(dir, "ViolaWakePackage.kt"), kotlinPackage(pkg));
    return cfg;
  }]);

  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application && cfg.modResults.manifest.application[0];
    if (!app) return cfg;
    app.service = app.service || [];
    if (!app.service.some((s) => s.$ && s.$["android:name"] === SERVICE_NAME)) {
      app.service.push({ $: { "android:name": SERVICE_NAME, "android:exported": "false", "android:foregroundServiceType": "microphone" } });
    }
    return cfg;
  });

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${pkg}.violawake.ViolaWakePackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
    }
    if (!src.includes("add(ViolaWakePackage())")) {
      // Kotlin (SDK 50+): PackageList(this).packages.apply { // add(MyReactNativePackage()) }
      src = src.replace(/(PackageList\(this\)\.packages\.apply\s*\{)/, `$1\n              add(ViolaWakePackage())`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};

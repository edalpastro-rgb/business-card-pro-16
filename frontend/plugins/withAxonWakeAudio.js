/**
 * V50.z377 — Config plugin: MODULO NATIVO ANDROID «AxonWakeAudio» — streaming audio dal microfono (AudioRecord) verso JS.
 *  - AxonWakeAudioModule.kt: NativeModules.AxonWakeAudio.start(sampleRate, chunkSamples) / stop() / isRunning()
 *    → thread AudioRecord (VOICE_RECOGNITION, 16 kHz, mono, PCM16) che ogni `chunkSamples` campioni (default 1280 = 80 ms)
 *      emette l'evento «AxonWakeAudioChunk» {pcm: base64 int16 LE, rms: 0..1, dbfs}. L'inferenza (melspectrogram → embedding →
 *      axon.onnx TemporalCNN) gira in JS con onnxruntime-react-native (già installato): nessuna seconda copia di ORT nell'APK.
 *  - AxonWakeAudioPackage.kt registrato in MainApplication. Il servizio in primo piano resta ViolaWakeService (withViolaWakeService.js):
 *    il provider lo avvia insieme allo streaming così il microfono resta attivo anche con schermo bloccato.
 *  Idempotente. Solo Android.
 */
const { withDangerousMod, withMainApplication } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function kotlinModule(pkg) {
  return `package ${pkg}.violawake

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.log10
import kotlin.math.sqrt

/** Streaming PCM16 dal microfono → JS (evento AxonWakeAudioChunk) per la wake-word «Axon». */
class AxonWakeAudioModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "AxonWakeAudio"

    private var thread: Thread? = null
    private val running = AtomicBoolean(false)

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    @ReactMethod
    fun isRunning(promise: Promise) { promise.resolve(running.get()) }

    @ReactMethod
    fun start(sampleRate: Int, chunkSamples: Int, promise: Promise) {
        if (running.get()) { promise.resolve(true); return }
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("AXON_WAKE_NO_PERMISSION", "Permesso microfono non concesso"); return
        }
        val sr = if (sampleRate > 0) sampleRate else 16000
        val chunk = if (chunkSamples > 0) chunkSamples else 1280
        val minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val bufBytes = maxOf(minBuf, chunk * 2 * 4)
        val rec: AudioRecord = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufBytes)
        } catch (e: Exception) { promise.reject("AXON_WAKE_INIT", e.message, e); return }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); promise.reject("AXON_WAKE_INIT", "AudioRecord non inizializzato"); return }
        running.set(true)
        thread = Thread({
            val buf = ShortArray(chunk)
            try {
                rec.startRecording()
                while (running.get()) {
                    var filled = 0
                    while (filled < chunk && running.get()) {
                        val n = rec.read(buf, filled, chunk - filled)
                        if (n <= 0) break
                        filled += n
                    }
                    if (filled < chunk) continue
                    var sum = 0.0
                    for (s in buf) sum += (s.toDouble() * s.toDouble())
                    val rms = sqrt(sum / chunk) / 32768.0
                    val bb = ByteBuffer.allocate(chunk * 2).order(ByteOrder.LITTLE_ENDIAN)
                    for (s in buf) bb.putShort(s)
                    val map = Arguments.createMap()
                    map.putString("pcm", Base64.encodeToString(bb.array(), Base64.NO_WRAP))
                    map.putDouble("rms", rms)
                    map.putDouble("dbfs", if (rms > 0) 20.0 * log10(rms) else -96.0)
                    if (ctx.hasActiveReactInstance()) {
                        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AxonWakeAudioChunk", map)
                    }
                }
            } catch (e: Exception) {
                val err = Arguments.createMap(); err.putString("message", e.message ?: "errore audio")
                if (ctx.hasActiveReactInstance()) ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AxonWakeAudioError", err)
            } finally {
                try { rec.stop() } catch (e: Exception) {}
                rec.release()
                running.set(false)
            }
        }, "AxonWakeAudio")
        thread?.priority = Thread.MAX_PRIORITY
        thread?.start()
        promise.resolve(true)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        running.set(false)
        try { thread?.join(800) } catch (e: Exception) {}
        thread = null
        promise.resolve(true)
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

class AxonWakeAudioPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(AxonWakeAudioModule(ctx))
    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;
}

module.exports = function withAxonWakeAudio(config) {
  const pkg = config.android && config.android.package;
  if (!pkg) return config;

  config = withDangerousMod(config, ["android", async (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "java", ...pkg.split("."), "violawake");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AxonWakeAudioModule.kt"), kotlinModule(pkg));
    fs.writeFileSync(path.join(dir, "AxonWakeAudioPackage.kt"), kotlinPackage(pkg));
    return cfg;
  }]);

  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    const importLine = `import ${pkg}.violawake.AxonWakeAudioPackage`;
    if (!src.includes(importLine)) src = src.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
    if (!src.includes("add(AxonWakeAudioPackage())")) {
      src = src.replace(/(PackageList\(this\)\.packages\.apply\s*\{)/, `$1\n              add(AxonWakeAudioPackage())`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};

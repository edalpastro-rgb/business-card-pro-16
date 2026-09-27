/**
 * V50.z381 — Config plugin: MODULO NATIVO ANDROID «AxonWakeAudio» — ascolto continuo «Axon» 100% nativo e offline.
 *  Perché tutto nativo: onnxruntime-react-native chiama getCatalystInstance() all'import → CRASH all'avvio con la New Architecture
 *  (bridgeless) → build 1.0.91 non si apriva. Qui l'inferenza gira in Kotlin con onnxruntime-android (unica copia di ORT nell'APK).
 *  - AxonWakeAudioModule.kt: NativeModules.AxonWakeAudio.start(threshold, consecutive) / stop() / isRunning() / setThreshold(t)
 *    → thread AudioRecord (VOICE_RECOGNITION 16 kHz mono PCM16, blocchi 1280 = 80 ms) → melspectrogram.onnx (480 campioni
 *      precedenti + 1280 → 8 frame mel, x/10+2) → finestra 76 frame → embedding_model.onnx (96-d) → ultimi 9 embedding →
 *      axon.onnx (TemporalCNN Job #253, Sigmoid) → score. `consecutive` score ≥ threshold + refrattario 1.5 s → evento
 *      «AxonWakeDetected» {score}. Eventi ausiliari: «AxonWakeScore» {score} (ogni frame), «AxonWakeLevel» {dbfs} (ogni 4 blocchi),
 *      «AxonWakeError» {message}.
 *  - Modelli copiati da frontend/assets/wake in android/app/src/main/assets/wake/. Dipendenza aggiunta in app/build.gradle.
 *  - AxonWakeAudioPackage.kt registrato in MainApplication. Servizio in primo piano: ViolaWakeService (withViolaWakeService.js).
 *  Idempotente. Solo Android.
 */
const { withDangerousMod, withMainApplication, withAppBuildGradle } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const ORT_DEP = 'implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")';
const MODEL_FILES = ["melspectrogram.onnx", "embedding_model.onnx", "axon.onnx"];

function kotlinModule(pkg) {
  return `package ${pkg}.violawake

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.log10
import kotlin.math.sqrt

/** Wake-word «Axon»: microfono + pipeline ONNX (melspectrogram → embedding → TemporalCNN) interamente nativa. */
class AxonWakeAudioModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "AxonWakeAudio"

    companion object {
        const val SR = 16000
        const val CHUNK = 1280
        const val CTX = 480
        const val MEL_BINS = 32
        const val MEL_WIN = 76
        const val EMB_DIM = 96
        const val N_EMB = 9
    }

    private var thread: Thread? = null
    private val running = AtomicBoolean(false)
    // V50.z385 — anti-loop nel silenzio: soglia più alta, più frame consecutivi, energy gate RMS (dBFS) e refrattario 3 s
    @Volatile private var threshold = 0.85f
    @Volatile private var consecutive = 4
    private val MIN_DBFS = -45.0          // sotto questo livello il blocco è «silenzio»: nessuna detection possibile
    private val SILENCE_RESET_BLOCKS = 6  // ~0,5 s di silenzio → azzera i colpi consecutivi

    private var env: OrtEnvironment? = null
    private var melSess: OrtSession? = null
    private var embSess: OrtSession? = null
    private var clfSess: OrtSession? = null

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    private fun emit(name: String, map: com.facebook.react.bridge.WritableMap) {
        try {
            if (ctx.hasActiveReactInstance()) ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, map)
        } catch (e: Exception) {}
    }

    private fun emitError(msg: String) { val m = Arguments.createMap(); m.putString("message", msg); emit("AxonWakeError", m) }

    @Synchronized
    private fun ensureModels() {
        if (melSess != null && embSess != null && clfSess != null) return
        val e = env ?: OrtEnvironment.getEnvironment().also { env = it }
        val opts = OrtSession.SessionOptions()
        try { opts.setIntraOpNumThreads(1) } catch (ex: Exception) {}
        fun load(name: String): OrtSession = ctx.assets.open("wake/" + name).use { e.createSession(it.readBytes(), opts) }
        melSess = load("melspectrogram.onnx")
        embSess = load("embedding_model.onnx")
        clfSess = load("axon.onnx")
    }

    private fun run(sess: OrtSession, data: FloatArray, shape: LongArray): FloatArray {
        val e = env!!
        OnnxTensor.createTensor(e, FloatBuffer.wrap(data), shape).use { t ->
            sess.run(mapOf(sess.inputNames.iterator().next() to t)).use { out ->
                val fb = (out.get(0) as OnnxTensor).floatBuffer
                val arr = FloatArray(fb.remaining()); fb.get(arr); return arr
            }
        }
    }

    @ReactMethod fun isRunning(promise: Promise) { promise.resolve(running.get()) }

    @ReactMethod fun setThreshold(t: Double, consecutiveHits: Int) {
        threshold = maxOf(0.75f, t.toFloat()); consecutive = if (consecutiveHits > 0) maxOf(3, consecutiveHits) else 4
    }

    @ReactMethod
    fun start(t: Double, consecutiveHits: Int, promise: Promise) {
        threshold = maxOf(0.75f, t.toFloat()); consecutive = if (consecutiveHits > 0) maxOf(3, consecutiveHits) else 4
        if (running.get()) { promise.resolve(true); return }
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("AXON_WAKE_NO_PERMISSION", "Permesso microfono non concesso"); return
        }
        try { ensureModels() } catch (e: Exception) { promise.reject("AXON_WAKE_MODEL", "Modelli wake-word non caricati: " + (e.message ?: "")); return }
        val minBuf = AudioRecord.getMinBufferSize(SR, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec: AudioRecord = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SR, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, CHUNK * 2 * 4))
        } catch (e: Exception) { promise.reject("AXON_WAKE_INIT", e.message, e); return }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); promise.reject("AXON_WAKE_INIT", "AudioRecord non inizializzato"); return }
        running.set(true)
        thread = Thread({
            val buf = ShortArray(CHUNK)
            val input = FloatArray(CTX + CHUNK)
            val melBuf = FloatArray(MEL_WIN * MEL_BINS); var melFilled = 0
            val embBuf = FloatArray(N_EMB * EMB_DIM); var embFilled = 0
            var hits = 0; var lastWake = 0L; var blocks = 0L; var silentBlocks = 0
            try {
                rec.startRecording()
                while (running.get()) {
                    var filled = 0
                    while (filled < CHUNK && running.get()) {
                        val n = rec.read(buf, filled, CHUNK - filled)
                        if (n <= 0) break
                        filled += n
                    }
                    if (filled < CHUNK) continue
                    blocks++
                    // Energy gate: RMS → dBFS su OGNI blocco (80 ms). Nel silenzio il classificatore non viene interrogato
                    // e i colpi consecutivi si azzerano: la wake word non può MAI scattare senza voce.
                    var sum = 0.0; for (s in buf) sum += s.toDouble() * s.toDouble()
                    val rms = sqrt(sum / CHUNK) / 32768.0
                    val dbfs = if (rms > 0) 20.0 * log10(rms) else -96.0
                    val voiced = dbfs >= MIN_DBFS
                    if (voiced) silentBlocks = 0 else { silentBlocks++; if (silentBlocks >= SILENCE_RESET_BLOCKS) hits = 0 }
                    // livello (ogni 4 blocchi ≈ 3 volte/s)
                    if (blocks % 4 == 0L) {
                        val m = Arguments.createMap(); m.putDouble("dbfs", dbfs); emit("AxonWakeLevel", m)
                    }
                    // 480 campioni di contesto + 1280 nuovi → 8 frame mel
                    System.arraycopy(input, CHUNK, input, 0, CTX)
                    for (i in 0 until CHUNK) input[CTX + i] = buf[i].toFloat()
                    val mel = run(melSess!!, input, longArrayOf(1, (CTX + CHUNK).toLong()))
                    val frames = mel.size / MEL_BINS
                    val keep = MEL_WIN - frames
                    System.arraycopy(melBuf, frames * MEL_BINS, melBuf, 0, keep * MEL_BINS)
                    for (i in 0 until frames * MEL_BINS) melBuf[keep * MEL_BINS + i] = mel[i] / 10f + 2f
                    melFilled = minOf(MEL_WIN, melFilled + frames)
                    if (melFilled < MEL_WIN) continue
                    val e = run(embSess!!, melBuf, longArrayOf(1, MEL_WIN.toLong(), MEL_BINS.toLong(), 1))
                    System.arraycopy(embBuf, EMB_DIM, embBuf, 0, (N_EMB - 1) * EMB_DIM)
                    System.arraycopy(e, 0, embBuf, (N_EMB - 1) * EMB_DIM, EMB_DIM)
                    embFilled = minOf(N_EMB, embFilled + 1)
                    if (embFilled < N_EMB) continue
                    val score = run(clfSess!!, embBuf, longArrayOf(1, N_EMB.toLong(), EMB_DIM.toLong()))[0]
                    val sm = Arguments.createMap(); sm.putDouble("score", score.toDouble()); emit("AxonWakeScore", sm)
                    if (voiced && score >= threshold) hits++ else hits = 0
                    val now = System.currentTimeMillis()
                    if (voiced && hits >= consecutive && now - lastWake > 3000) {
                        hits = 0; lastWake = now; embFilled = 0; melFilled = 0
                        val wm = Arguments.createMap(); wm.putDouble("score", score.toDouble()); emit("AxonWakeDetected", wm)
                    }
                }
            } catch (e: Exception) {
                emitError(e.message ?: "errore audio")
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
        try { thread?.join(1000) } catch (e: Exception) {}
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
    // modelli ONNX negli assets Android
    const assetsDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets", "wake");
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const f of MODEL_FILES) {
      const src = path.join(cfg.modRequest.projectRoot, "assets", "wake", f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(assetsDir, f));
    }
    return cfg;
  }]);

  config = withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("com.microsoft.onnxruntime:onnxruntime-android")) {
      src = src.replace(/dependencies\s*\{/, `dependencies {\n    ${ORT_DEP} // V50.z381 — wake-word Axon (inferenza nativa)`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

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

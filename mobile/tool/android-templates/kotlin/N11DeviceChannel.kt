package vn.eleven.n11

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

/**
 * The Flutter side's only door to the Keystore, the encrypted session store and the other app (lib/src/account/device_bridge.dart).
 * Every call is rejected unless the build environment passed by Flutter is the one compiled into this APK's manifest, so a build
 * with a mismatched environment cannot produce a proof. Results carry public metadata and signatures only.
 */
class N11DeviceChannel(private val context: Context) : MethodChannel.MethodCallHandler {
    private val store = N11DeviceStore(context)
    private val keys = N11DeviceKeys()
    private val peers = N11PeerClient(context)
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        executor.execute {
            try {
                val value = handle(call)
                main.post { result.success(value) }
            } catch (e: N11KeyException) {
                main.post { result.error(e.code, null, null) }
            } catch (e: N11PeerUnavailable) {
                main.post { result.error("PEER_UNAVAILABLE", null, null) }
            } catch (e: Exception) {
                main.post { result.error("FAILED", null, null) }
            }
        }
    }

    private fun keyState(): Map<String, Any?>? {
        if (!keys.exists()) return null
        return mapOf(
            "keyId" to store.keyId(),
            "publicKeySpki" to keys.publicKeySpki(),
            "chain" to keys.chain(),
            "bindingId" to store.bindingId(),
            "generation" to store.generation(),
        )
    }

    private fun handle(call: MethodCall): Any? {
        val environment = N11PeerProtocol.environmentOf(context)
        // Local token storage uses ordinary Android Keystore AES, without attestation or environment trust.
        val localStorage = call.method in setOf("deviceId", "readToken", "storeToken", "clearToken")
        if (!localStorage && (environment == null || call.argument<String>("environment") != environment)) {
            throw IllegalStateException("environment mismatch")
        }
        return when (call.method) {
            "deviceId" -> store.deviceId()
            "currentKey" -> keyState()
            "generateKey" -> {
                val challenge = call.argument<String>("challenge") ?: throw IllegalArgumentException("challenge")
                store.clearKeyState()
                keys.generate(challenge)
                keyState()
            }
            "saveKeyId" -> {
                store.setKeyId(call.argument<String>("keyId") ?: throw IllegalArgumentException("keyId"))
                null
            }
            "deleteKey" -> {
                keys.delete()
                store.clearKeyState()
                null
            }
            "sign" -> {
                val message = Base64.decode(call.argument<String>("message") ?: throw IllegalArgumentException("message"), Base64.DEFAULT)
                keys.sign(message)
            }
            "rememberBinding" -> {
                store.setBinding(
                    call.argument<String>("bindingId") ?: throw IllegalArgumentException("bindingId"),
                    call.argument<Int>("generation") ?: throw IllegalArgumentException("generation"),
                )
                null
            }
            "forgetBinding" -> {
                store.clearBinding()
                null
            }
            "readToken" -> store.readToken()
            "storeToken" -> {
                store.storeToken(call.argument<String>("token") ?: throw IllegalArgumentException("token"))
                null
            }
            "clearToken" -> {
                store.clearToken()
                null
            }
            "peer" -> peers.state()?.let { mapOf("bindingId" to it.bindingId, "keyId" to it.keyId) }
            "requestEndorsement" -> {
                val endorsement = peers.endorse(
                    environment ?: throw IllegalStateException("environment missing"),
                    call.argument<String>("challengeId") ?: throw IllegalArgumentException("challengeId"),
                    call.argument<String>("nonce") ?: throw IllegalArgumentException("nonce"),
                    call.argument<String>("targetApp") ?: throw IllegalArgumentException("targetApp"),
                    call.argument<String>("spkiSha256Hex") ?: throw IllegalArgumentException("spkiSha256Hex"),
                )
                mapOf("bindingId" to endorsement.bindingId, "authorizerKeyId" to endorsement.authorizerKeyId, "signature" to endorsement.signature)
            }
            else -> throw IllegalArgumentException("method")
        }
    }

    companion object {
        const val CHANNEL = "vn.eleven.n11/device"
    }
}

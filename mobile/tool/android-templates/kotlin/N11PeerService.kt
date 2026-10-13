package vn.eleven.n11

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.Parcel

/** Where the transaction codes and the interface token live, shared by the service and its client. */
object N11PeerProtocol {
    const val DESCRIPTOR = "vn.eleven.n11.PeerEndorsement"
    const val SERVICE_CLASS = "vn.eleven.n11.N11PeerService"
    const val TRANSACTION_STATE = IBinder.FIRST_CALL_TRANSACTION
    const val TRANSACTION_ENDORSE = IBinder.FIRST_CALL_TRANSACTION + 1
    const val ENVIRONMENT_META = "vn.eleven.n11.DEVICE_ENVIRONMENT"

    fun environmentOf(context: Context): String? = try {
        context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData?.getString(ENVIRONMENT_META)
    } catch (e: Exception) {
        null
    }

    /** SHA-256 hex of every signing certificate of a package (the CURRENT signers). Null when they cannot be read. */
    fun signersOf(pm: PackageManager, packageName: String): Set<String>? = try {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            @Suppress("WrongConstant")
            val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
            info.signingInfo?.apkContentsSigners
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures
        }
        signatures?.map { N11PeerPolicy.sha256Hex(it.toByteArray()) }?.toSet()
    } catch (e: Exception) {
        null
    }
}

/**
 * The only door between the two apps. Bound by explicit component, protected by a signature-level permission (only an app signed
 * with the same certificate can even bind), and every transaction checks the caller again by UID -> package -> signer BEFORE doing
 * anything else (and before any clearCallingIdentity, which this class never calls).
 *
 *   STATE   -> this app's current binding id and registered key id (public identifiers, no secret)
 *   ENDORSE -> a signature over the fixed JOIN message for the OTHER app's new key (see N11PeerPolicy)
 *
 * It exposes no token, no password, no private key, no generic signing.
 */
class N11PeerService : Service() {
    private val binder = object : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (reply == null) return false
            // 1. WHO is calling: decided first, from the kernel-supplied UID.
            val callingUid = Binder.getCallingUid()
            val ownPackage = packageName
            val callerPackages = packageManager.getPackagesForUid(callingUid)
            val callerSigners = if (callerPackages != null && callerPackages.size == 1) N11PeerProtocol.signersOf(packageManager, callerPackages[0]) else null
            val ownSigners = N11PeerProtocol.signersOf(packageManager, ownPackage) ?: emptySet()
            if (!N11PeerPolicy.callerAllowed(ownPackage, callerPackages, callerSigners, ownSigners)) {
                reply.writeException(SecurityException("caller not allowed"))
                return true
            }
            return try {
                when (code) {
                    N11PeerProtocol.TRANSACTION_STATE -> {
                        data.enforceInterface(N11PeerProtocol.DESCRIPTOR)
                        val store = N11DeviceStore(applicationContext)
                        reply.writeNoException()
                        reply.writeString(store.bindingId())
                        reply.writeString(store.keyId())
                        true
                    }
                    N11PeerProtocol.TRANSACTION_ENDORSE -> {
                        data.enforceInterface(N11PeerProtocol.DESCRIPTOR)
                        val request = N11PeerPolicy.JoinRequest(
                            environment = data.readString() ?: "",
                            challengeId = data.readString() ?: "",
                            nonce = data.readString() ?: "",
                            targetApp = data.readString() ?: "",
                            spkiSha256Hex = data.readString() ?: "",
                        )
                        val store = N11DeviceStore(applicationContext)
                        val bindingId = store.bindingId()
                        val keyId = store.keyId()
                        val ownEnvironment = N11PeerProtocol.environmentOf(applicationContext) ?: ""
                        if (!N11PeerPolicy.joinAllowed(ownPackage, ownEnvironment, request, bindingId, keyId) || bindingId == null || keyId == null) {
                            reply.writeException(SecurityException("endorsement refused"))
                        } else {
                            val signature = N11DeviceKeys().sign(N11PeerPolicy.joinMessage(request, bindingId, keyId))
                            reply.writeNoException()
                            reply.writeString(bindingId)
                            reply.writeString(keyId)
                            reply.writeString(signature)
                        }
                        true
                    }
                    else -> super.onTransact(code, data, reply, flags)
                }
            } catch (e: SecurityException) {
                reply.writeException(e)
                true
            } catch (e: Exception) {
                reply.writeException(IllegalStateException("failed"))
                true
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder
}

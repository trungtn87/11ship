package vn.eleven.n11

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.Parcel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class N11PeerUnavailable : Exception("peer unavailable")

class PeerState(val bindingId: String?, val keyId: String?)

class PeerEndorsement(val bindingId: String, val authorizerKeyId: String, val signature: String)

/**
 * Talks to the OTHER app's N11PeerService by explicit component. A phone without the other app, with it cleared, or signed by a
 * different key simply has no usable peer (N11PeerUnavailable): the caller then logs in on its own binding. Blocking: call it from
 * a background thread.
 */
class N11PeerClient(private val context: Context) {
    private fun peerPackage(): String = N11PeerPolicy.peerPackageOf(context.packageName) ?: throw N11PeerUnavailable()

    private fun <T> withPeer(block: (IBinder) -> T): T {
        val latch = CountDownLatch(1)
        var service: IBinder? = null
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
                service = binder
                latch.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {}

            override fun onNullBinding(name: ComponentName?) {
                latch.countDown()
            }

            override fun onBindingDied(name: ComponentName?) {
                latch.countDown()
            }
        }
        val intent = Intent().setComponent(ComponentName(peerPackage(), N11PeerProtocol.SERVICE_CLASS))
        val bound = try {
            context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        } catch (e: SecurityException) {
            false
        }
        try {
            if (!bound || !latch.await(5, TimeUnit.SECONDS)) throw N11PeerUnavailable()
            val binder = service ?: throw N11PeerUnavailable()
            return block(binder)
        } finally {
            try {
                context.unbindService(connection)
            } catch (e: IllegalArgumentException) {
                // never bound
            }
        }
    }

    private fun <T> transact(binder: IBinder, code: Int, write: (Parcel) -> Unit, read: (Parcel) -> T): T {
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
            data.writeInterfaceToken(N11PeerProtocol.DESCRIPTOR)
            write(data)
            if (!binder.transact(code, data, reply, 0)) throw N11PeerUnavailable()
            try {
                reply.readException()
            } catch (e: Exception) {
                throw N11PeerUnavailable()
            }
            return read(reply)
        } finally {
            data.recycle()
            reply.recycle()
        }
    }

    /** The other app's binding and key ids, or null when it is not there / not allowed to answer. */
    fun state(): PeerState? = try {
        withPeer { binder ->
            transact(binder, N11PeerProtocol.TRANSACTION_STATE, {}, { reply -> PeerState(reply.readString(), reply.readString()) })
        }
    } catch (e: N11PeerUnavailable) {
        null
    }

    fun endorse(environment: String, challengeId: String, nonce: String, targetApp: String, spkiSha256Hex: String): PeerEndorsement =
        withPeer { binder ->
            transact(
                binder,
                N11PeerProtocol.TRANSACTION_ENDORSE,
                { data ->
                    data.writeString(environment)
                    data.writeString(challengeId)
                    data.writeString(nonce)
                    data.writeString(targetApp)
                    data.writeString(spkiSha256Hex)
                },
                { reply ->
                    val bindingId = reply.readString()
                    val keyId = reply.readString()
                    val signature = reply.readString()
                    if (bindingId == null || keyId == null || signature == null) throw N11PeerUnavailable()
                    PeerEndorsement(bindingId, keyId, signature)
                },
            )
        }
}

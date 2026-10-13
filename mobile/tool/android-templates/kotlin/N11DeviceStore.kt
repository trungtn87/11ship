package vn.eleven.n11

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Everything this app keeps about the device binding, in the no-backup area of the app's private storage (android:allowBackup is
 * false and noBackupFilesDir is excluded from every backup anyway).
 *  - device.json  : the legacy device_id metadata, the id the SERVER gave the key and the binding it last saw. NOT secret.
 *  - session.bin  : the access token, AES-256-GCM encrypted with a non-exportable Android Keystore key.
 * The token is never written in the clear, never logged and never handed to the other app. Both files are shared with the
 * Binder service of the same app (same process data directory), so access is synchronized.
 */
class N11DeviceStore(private val context: Context) {
    private val lock = Any()
    private val metaFile get() = File(context.noBackupFilesDir, "device.json")
    private val tokenFile get() = File(context.noBackupFilesDir, "session.bin")

    private fun readMeta(): JSONObject = synchronized(lock) {
        try {
            if (metaFile.exists()) JSONObject(metaFile.readText(Charsets.UTF_8)) else JSONObject()
        } catch (e: Exception) {
            JSONObject()
        }
    }

    private fun writeMeta(meta: JSONObject) = synchronized(lock) {
        val tmp = File(context.noBackupFilesDir, "device.json.tmp")
        tmp.writeText(meta.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(metaFile)) {
            throw IllegalStateException("device metadata not written")
        }
    }

    fun deviceId(): String = synchronized(lock) {
        val meta = readMeta()
        val existing = meta.optString("deviceId", "")
        if (existing.isNotEmpty()) return existing
        val created = "android-" + UUID.randomUUID().toString()
        meta.put("deviceId", created)
        writeMeta(meta)
        created
    }

    fun keyId(): String? = readMeta().optString("keyId", "").ifEmpty { null }

    fun bindingId(): String? = readMeta().optString("bindingId", "").ifEmpty { null }

    fun generation(): Int? = readMeta().let { if (it.has("generation")) it.optInt("generation") else null }

    fun setKeyId(keyId: String) = synchronized(lock) {
        writeMeta(readMeta().put("keyId", keyId))
    }

    fun setBinding(bindingId: String, generation: Int) = synchronized(lock) {
        writeMeta(readMeta().put("bindingId", bindingId).put("generation", generation))
    }

    fun clearBinding() = synchronized(lock) {
        val meta = readMeta()
        meta.remove("bindingId")
        meta.remove("generation")
        writeMeta(meta)
    }

    /** A new key invalidates what the server knew about the old one. */
    fun clearKeyState() = synchronized(lock) {
        val meta = readMeta()
        meta.remove("keyId")
        meta.remove("bindingId")
        meta.remove("generation")
        writeMeta(meta)
    }

    // ---- token ------------------------------------------------------------------------------------------------------

    private fun tokenKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(TOKEN_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(TOKEN_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun storeToken(token: String) = synchronized(lock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, tokenKey())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val tmp = File(context.noBackupFilesDir, "session.bin.tmp")
        tmp.writeBytes(cipher.iv + encrypted)
        if (!tmp.renameTo(tokenFile)) {
            throw IllegalStateException("token not written")
        }
    }

    /** The stored token, or null when there is none or it cannot be decrypted (the file is then removed). */
    fun readToken(): String? = synchronized(lock) {
        if (!tokenFile.exists()) return null
        try {
            val bytes = tokenFile.readBytes()
            if (bytes.size <= IV_SIZE) throw IllegalStateException("short token file")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, tokenKey(), GCMParameterSpec(128, bytes, 0, IV_SIZE))
            String(cipher.doFinal(bytes, IV_SIZE, bytes.size - IV_SIZE), Charsets.UTF_8)
        } catch (e: Exception) {
            tokenFile.delete()
            null
        }
    }

    fun clearToken() = synchronized(lock) {
        // Overwrite then delete: the file never lingers with a usable ciphertext.
        if (tokenFile.exists()) {
            tokenFile.writeBytes(ByteArray(64).also { SecureRandom().nextBytes(it) })
            tokenFile.delete()
        }
    }

    companion object {
        private const val TOKEN_ALIAS = "n11_token_key"
        private const val IV_SIZE = 12
    }
}

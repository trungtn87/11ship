package vn.eleven.gateway

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Local state of the gateway. The device credential is sealed with an AES-256-GCM key that lives in the Android Keystore (the key
 * material never leaves the secure hardware/OS store); only the sealed bytes are in SharedPreferences. Nothing here ever holds an
 * OTP or a full phone number: a job's text exists only in a local variable while it is being sent.
 */
object GatewayStore {
    private const val PREFS = "gateway_state"
    private const val KEY_ALIAS = "vn.eleven.gateway.credential.v1"
    private const val K_CRED_IV = "cred_iv"
    private const val K_CRED = "cred"
    private const val K_BASE_URL = "base_url"
    private const val K_ENABLED = "enabled"
    private const val K_LAST_OK_MS = "last_ok_ms"
    private const val K_LAST_ERROR = "last_error"
    private const val K_AUTH_FAILED = "auth_failed"
    private const val K_SENDING_ENABLED = "server_sending_enabled"
    private const val K_DAY = "day"
    private const val K_SENT = "sent_today"
    private const val K_FAILED = "failed_today"
    private const val K_ATT_JOB = "attempt_job"
    private const val K_ATT_ID = "attempt_id"
    private const val K_PEND_JOB = "pending_job"
    private const val K_PEND_ATT = "pending_attempt"
    private const val K_PEND_RES = "pending_result"
    private const val K_PEND_ERR = "pending_error"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    @Synchronized
    fun saveCredential(ctx: Context, credential: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.doFinal(credential.toByteArray(Charsets.UTF_8))
        prefs(ctx).edit()
            .putString(K_CRED_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(K_CRED, Base64.encodeToString(sealed, Base64.NO_WRAP))
            .putBoolean(K_AUTH_FAILED, false)
            .apply()
    }

    @Synchronized
    fun loadCredential(ctx: Context): String? {
        val p = prefs(ctx)
        val iv = p.getString(K_CRED_IV, null) ?: return null
        val sealed = p.getString(K_CRED, null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE, key(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
            )
            String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            // A lost/invalidated key cannot be repaired: the operator pairs again.
            null
        }
    }

    fun isPaired(ctx: Context): Boolean =
        prefs(ctx).contains(K_CRED) && baseUrl(ctx) != null

    fun baseUrl(ctx: Context): String? = prefs(ctx).getString(K_BASE_URL, null)

    fun setBaseUrl(ctx: Context, url: String) {
        prefs(ctx).edit().putString(K_BASE_URL, url).apply()
    }

    @Synchronized
    fun unpair(ctx: Context) {
        prefs(ctx).edit().clear().apply()
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS)
        } catch (e: Exception) {
            // The sealed bytes are already gone; nothing can open a stale key.
        }
    }

    fun isEnabled(ctx: Context) = prefs(ctx).getBoolean(K_ENABLED, false)

    fun setEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean(K_ENABLED, enabled).apply()
    }

    fun authFailed(ctx: Context) = prefs(ctx).getBoolean(K_AUTH_FAILED, false)

    fun setAuthFailed(ctx: Context, failed: Boolean) {
        prefs(ctx).edit().putBoolean(K_AUTH_FAILED, failed).apply()
    }

    fun recordConnection(ctx: Context, ok: Boolean, errorCode: String?, serverSending: Boolean?) {
        val e = prefs(ctx).edit()
        if (ok) e.putLong(K_LAST_OK_MS, System.currentTimeMillis())
        e.putString(K_LAST_ERROR, if (ok) null else errorCode)
        if (serverSending != null) e.putBoolean(K_SENDING_ENABLED, serverSending)
        e.apply()
    }

    private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    @Synchronized
    fun countResult(ctx: Context, sent: Boolean) {
        val p = prefs(ctx)
        val day = today()
        val same = p.getString(K_DAY, null) == day
        val sentNow = (if (same) p.getInt(K_SENT, 0) else 0) + if (sent) 1 else 0
        val failedNow = (if (same) p.getInt(K_FAILED, 0) else 0) + if (sent) 0 else 1
        p.edit().putString(K_DAY, day).putInt(K_SENT, sentNow).putInt(K_FAILED, failedNow).apply()
    }

    fun snapshot(ctx: Context): Map<String, Any?> {
        val p = prefs(ctx)
        val same = p.getString(K_DAY, null) == today()
        return mapOf(
            "paired" to isPaired(ctx),
            "baseUrl" to baseUrl(ctx),
            "enabled" to isEnabled(ctx),
            "authFailed" to authFailed(ctx),
            "lastOkMs" to (if (p.contains(K_LAST_OK_MS)) p.getLong(K_LAST_OK_MS, 0L) else null),
            "lastError" to p.getString(K_LAST_ERROR, null),
            "serverSendingEnabled" to (if (p.contains(K_SENDING_ENABLED)) p.getBoolean(K_SENDING_ENABLED, false) else null),
            "sentToday" to (if (same) p.getInt(K_SENT, 0) else 0),
            "failedToday" to (if (same) p.getInt(K_FAILED, 0) else 0),
            "pendingReport" to p.contains(K_PEND_JOB),
        )
    }

    // --- crash safety: what was being sent / what could not be reported yet (identifiers only, never the text) ---------------

    fun markAttempt(ctx: Context, jobId: String, attemptId: String) {
        prefs(ctx).edit().putString(K_ATT_JOB, jobId).putString(K_ATT_ID, attemptId).commit()
    }

    fun clearAttempt(ctx: Context) {
        prefs(ctx).edit().remove(K_ATT_JOB).remove(K_ATT_ID).commit()
    }

    fun attempt(ctx: Context): Pair<String, String>? {
        val p = prefs(ctx)
        val job = p.getString(K_ATT_JOB, null) ?: return null
        val attempt = p.getString(K_ATT_ID, null) ?: return null
        return Pair(job, attempt)
    }

    class PendingReport(val jobId: String, val attemptId: String, val result: String, val errorCode: String?)

    fun savePending(ctx: Context, r: PendingReport) {
        prefs(ctx).edit()
            .putString(K_PEND_JOB, r.jobId).putString(K_PEND_ATT, r.attemptId)
            .putString(K_PEND_RES, r.result).putString(K_PEND_ERR, r.errorCode)
            .commit()
    }

    fun pending(ctx: Context): PendingReport? {
        val p = prefs(ctx)
        val job = p.getString(K_PEND_JOB, null) ?: return null
        val attempt = p.getString(K_PEND_ATT, null) ?: return null
        val result = p.getString(K_PEND_RES, null) ?: return null
        return PendingReport(job, attempt, result, p.getString(K_PEND_ERR, null))
    }

    fun clearPending(ctx: Context) {
        prefs(ctx).edit().remove(K_PEND_JOB).remove(K_PEND_ATT).remove(K_PEND_RES).remove(K_PEND_ERR).commit()
    }
}

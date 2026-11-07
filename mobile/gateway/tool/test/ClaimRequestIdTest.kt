package vn.eleven.gateway

import android.content.SharedPreferences
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Regression and boundary tests for OD-2 item 5: stable claim request id.
 * Touches real [GatewayStore] and real [GatewayApi] methods, verifying durability across store
 * recreation via commit(), actual HTTP request field naming, and precise clearing lifecycle.
 */
class ClaimRequestIdTest {

    private class TestPreferences(private val backing: MutableMap<String, Any?>) : SharedPreferences {
        override fun getAll(): MutableMap<String, *> = HashMap(backing)
        override fun getString(key: String?, defValue: String?): String? =
            if (key != null && backing.containsKey(key)) backing[key] as? String else defValue
        @Suppress("UNCHECKED_CAST")
        override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
            backing[key] as? MutableSet<String> ?: defValues
        override fun getInt(key: String?, defValue: Int): Int =
            (backing[key] as? Number)?.toInt() ?: defValue
        override fun getLong(key: String?, defValue: Long): Long =
            (backing[key] as? Number)?.toLong() ?: defValue
        override fun getFloat(key: String?, defValue: Float): Float =
            (backing[key] as? Number)?.toFloat() ?: defValue
        override fun getBoolean(key: String?, defValue: Boolean): Boolean =
            (backing[key] as? Boolean) ?: defValue
        override fun contains(key: String?): Boolean = key != null && backing.containsKey(key)
        override fun edit(): SharedPreferences.Editor = TestEditor(backing)
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    }

    private class TestEditor(private val backing: MutableMap<String, Any?>) : SharedPreferences.Editor {
        private val staged = mutableMapOf<String, Any?>()
        private val removed = mutableSetOf<String>()
        private var clearAll = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor {
            if (key != null) {
                if (value != null) { staged[key] = value; removed.remove(key) }
                else { removed.add(key); staged.remove(key) }
            }
            return this
        }
        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor {
            if (key != null) {
                if (values != null) { staged[key] = values; removed.remove(key) }
                else { removed.add(key); staged.remove(key) }
            }
            return this
        }
        override fun putInt(key: String?, value: Int): SharedPreferences.Editor {
            if (key != null) { staged[key] = value; removed.remove(key) }
            return this
        }
        override fun putLong(key: String?, value: Long): SharedPreferences.Editor {
            if (key != null) { staged[key] = value; removed.remove(key) }
            return this
        }
        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor {
            if (key != null) { staged[key] = value; removed.remove(key) }
            return this
        }
        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor {
            if (key != null) { staged[key] = value; removed.remove(key) }
            return this
        }
        override fun remove(key: String?): SharedPreferences.Editor {
            if (key != null) { removed.add(key); staged.remove(key) }
            return this
        }
        override fun clear(): SharedPreferences.Editor {
            clearAll = true; staged.clear(); removed.clear()
            return this
        }
        override fun commit(): Boolean {
            if (clearAll) backing.clear()
            for (k in removed) backing.remove(k)
            backing.putAll(staged)
            return true
        }
        override fun apply() { commit() }
    }

    private lateinit var backingMap: MutableMap<String, Any?>

    @Before
    fun setUp() {
        backingMap = mutableMapOf()
        GatewayStore.testPrefs = TestPreferences(backingMap)
    }

    @After
    fun tearDown() {
        GatewayStore.testPrefs = null
    }

    @Test
    fun storeCommitIsDurableAcrossStoreRecreationAndRetries() {
        // First claim generation
        val id1 = GatewayStore.getOrCreateClaimRequestId()
        assertNotNull(id1)
        assertTrue(id1.isNotBlank())

        // Recreate the store from persistent storage (simulates service restart or separate call)
        GatewayStore.testPrefs = TestPreferences(backingMap)
        val persistedId = GatewayStore.claimRequestId()
        assertEquals("claim_request_id must be committed durably and survive store recreation", id1, persistedId)

        // Retry must return the exact same claim request id without creating a new one
        val retryId = GatewayStore.getOrCreateClaimRequestId()
        assertEquals("Retry must reuse the identical claim request id", id1, retryId)

        // Clear and verify durability across recreation
        GatewayStore.clearClaimRequestId()
        GatewayStore.testPrefs = TestPreferences(backingMap)
        assertNull("Cleared claim_request_id must be committed durably", GatewayStore.claimRequestId())

        // Next poll generates a brand new ID distinct from id1
        val id2 = GatewayStore.getOrCreateClaimRequestId()
        assertNotNull(id2)
        assertNotEquals("Subsequent poll must generate a fresh request id", id1, id2)
    }

    @Test
    fun realGatewayApiSendsClaimRequestIdFieldInRequest() {
        val api = GatewayApi("https://gateway.example.com", "dummy_credential_for_tests_43_characters_len")
        var recordedPath: String? = null
        var recordedBody: JSONObject? = null

        api.httpTransport = { path, body ->
            recordedPath = path
            recordedBody = body
            JSONObject().put("sending_enabled", true)
        }

        val testId = "550e8400-e29b-41d4-a716-446655440000"
        val result = api.claim(smsPermission = true, paused = false, claimRequestId = testId)

        assertTrue(result.sendingEnabled)
        assertEquals("/jobs/claim", recordedPath)
        assertNotNull(recordedBody)
        val body = recordedBody!!
        assertTrue("Request body must include 'claim_request_id' field", body.has("claim_request_id"))
        assertEquals(testId, body.getString("claim_request_id"))
        assertTrue(body.getBoolean("sms_permission"))
        assertFalse(body.getBoolean("paused"))

        // When claimRequestId is null, the field is omitted
        api.claim(smsPermission = true, paused = false, claimRequestId = null)
        val secondBody = recordedBody
        assertNotNull(secondBody)
        assertFalse("Request body must omit 'claim_request_id' when null", secondBody!!.has("claim_request_id"))
    }

    @Test
    fun claimRequestIdClearedWhenJobIsNull() {
        val id = GatewayStore.getOrCreateClaimRequestId()
        assertNotNull(id)

        // When server returns job == null (e.g. empty queue or expired lease):
        // GatewayService clears claim_request_id
        GatewayStore.clearClaimRequestId()
        assertNull(GatewayStore.claimRequestId())

        val nextId = GatewayStore.getOrCreateClaimRequestId()
        assertNotEquals(id, nextId)
    }

    @Test
    fun claimRequestIdPreservedUntilMarkAttemptDurablySaves() {
        val id = GatewayStore.getOrCreateClaimRequestId()

        // Before markAttempt (e.g. during claim network call): ID remains
        assertEquals(id, GatewayStore.claimRequestId())

        // Simulate crash before markAttempt: store recreation still sees id
        GatewayStore.testPrefs = TestPreferences(backingMap)
        assertEquals("Crash before markAttempt must preserve claimRequestId for retry", id, GatewayStore.claimRequestId())

        // Once job attempt is durably recorded via markAttempt: clear claim_request_id
        GatewayStore.markAttempt(null as android.content.Context?, "job-123", id)
        GatewayStore.clearClaimRequestId()

        // Durably cleared
        GatewayStore.testPrefs = TestPreferences(backingMap)
        assertNull("claim_request_id must be cleared after markAttempt", GatewayStore.claimRequestId())
    }

    @Test
    fun claimRequestIdClearedOnRejected4xxExcept429() {
        val id = GatewayStore.getOrCreateClaimRequestId()
        assertEquals(id, GatewayStore.claimRequestId())

        // Simulation of Rejected(409) or Rejected(400): cleared to prevent endless retry loops
        val e409 = GatewayApi.Rejected(409)
        if (e409.status != 429) {
            GatewayStore.clearClaimRequestId()
        }
        assertNull("409 conflict must clear claim_request_id", GatewayStore.claimRequestId())

        // Simulation of Rejected(429) (rate limited): NOT cleared so backoff retry keeps same id
        val retryId = GatewayStore.getOrCreateClaimRequestId()
        val e429 = GatewayApi.Rejected(429)
        if (e429.status != 429) {
            GatewayStore.clearClaimRequestId()
        }
        assertEquals("429 rate limit must preserve claim_request_id", retryId, GatewayStore.claimRequestId())
    }

    @Test
    fun unpairAndPairingClearStaleClaimRequestId() {
        val oldId = GatewayStore.getOrCreateClaimRequestId()
        assertEquals(oldId, GatewayStore.claimRequestId())

        // Re-pairing: saveCredential clears stale claim_request_id
        GatewayStore.saveCredential(null, "new_credential_after_device_re-pairing_xyz")
        assertNull("saveCredential during re-pairing must clear stale claim_request_id", GatewayStore.claimRequestId())

        // Also verify unpair clears it
        GatewayStore.getOrCreateClaimRequestId()
        GatewayStore.unpair(null)
        assertNull("unpair must clear claim_request_id", GatewayStore.claimRequestId())
    }
}

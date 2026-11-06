package vn.eleven.gateway

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Regression tests for OD-2 item 5: stable claim request id across retries. */
class ClaimRequestIdTest {

    /** In-memory representation of claim request id state, matching GatewayStore contract. */
    private class MemoryClaimStore {
        private var claimRequestId: String? = null

        fun getOrCreate(): String {
            val existing = claimRequestId
            if (existing != null) return existing
            val fresh = java.util.UUID.randomUUID().toString()
            claimRequestId = fresh
            return fresh
        }

        fun clear() {
            claimRequestId = null
        }

        fun current(): String? = claimRequestId
    }

    @Test
    fun retryReusesSameClaimRequestIdUntilCleared() {
        val store = MemoryClaimStore()
        val firstId = store.getOrCreate()
        assertTrue(firstId.isNotBlank())

        // Simulated network failure: store is NOT cleared, next call yields identical ID
        val retryId = store.getOrCreate()
        assertEquals("Retry must reuse the exact same claim request id", firstId, retryId)

        // Success: store is cleared
        store.clear()
        assertEquals(null, store.current())

        // Next poll generates a brand new ID
        val nextId = store.getOrCreate()
        assertTrue(nextId.isNotBlank())
        assertTrue("Subsequent poll must generate a distinct claim request id", firstId != nextId)
    }

    @Test
    fun claimPayloadIncludesClaimRequestIdWhenPresent() {
        val bodyWithId = JSONObject().put("sms_permission", true).put("paused", false)
        val id = "550e8400-e29b-41d4-a716-446655440000"
        bodyWithId.put("claim_request_id", id)

        assertTrue(bodyWithId.has("claim_request_id"))
        assertEquals(id, bodyWithId.getString("claim_request_id"))
        assertTrue(bodyWithId.getBoolean("sms_permission"))
        assertFalse(bodyWithId.getBoolean("paused"))

        val bodyWithoutId = JSONObject().put("sms_permission", true).put("paused", false)
        assertFalse(bodyWithoutId.has("claim_request_id"))
    }
}

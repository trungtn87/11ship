package vn.eleven.gateway

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Regression tests for review finding B1 (issue #102): an unreported result must never be lost or overwritten. */
class ReportFlusherTest {
    /** Survives "restarts": a new flusher over the same store sees the same slot, like SharedPreferences does. */
    private class MemoryStore : PendingStore {
        var slot: PendingReport? = null
        override fun pending() = slot
        override fun save(report: PendingReport) { slot = report }
        override fun clear() { slot = null }
    }

    private fun report(job: String, result: String = "SENT") = PendingReport(job, "attempt-$job", result, null)

    @Test
    fun transientAckFailureKeepsTheResultAndBlocksNewWork() {
        val store = MemoryStore()
        val calls = ArrayList<String>()
        var serverUp = false
        val flusher = ReportFlusher(store, { r ->
            calls.add(r.jobId)
            if (!serverUp) throw IOException("ack down while heartbeat and claim still work")
        }, { true })

        flusher.record(report("job-1"))
        assertFalse("ack failed: the gateway must not claim the next job", flusher.mayClaim())
        assertNotNull(store.slot)
        assertEquals("job-1", store.slot?.jobId)
        assertEquals("every attempt is for the same job", setOf("job-1"), calls.toSet())

        serverUp = true
        assertTrue(flusher.mayClaim())
        assertNull(store.slot)
    }

    @Test
    fun aSecondResultCanNeverOverwriteAnUnreportedOne() {
        val store = MemoryStore()
        val flusher = ReportFlusher(store, { throw IOException("down") }, { true })
        flusher.record(report("job-1", "SENT"))
        try {
            flusher.record(report("job-2", "FAILED"))
            fail("the pending slot of job-1 was overwritten")
        } catch (e: IllegalStateException) {
            // expected
        }
        assertEquals("job-1", store.slot?.jobId)
        assertEquals("SENT", store.slot?.result)
    }

    @Test
    fun theSameResultMayBeRecordedAgain() {
        val store = MemoryStore()
        val flusher = ReportFlusher(store, { throw IOException("down") }, { true })
        flusher.record(report("job-1"))
        flusher.record(report("job-1"))
        assertEquals("job-1", store.slot?.jobId)
    }

    @Test
    fun anUnreportedResultSurvivesARestartAndIsDeliveredAfterReconnect() {
        val store = MemoryStore()
        val first = ReportFlusher(store, { throw IOException("down") }, { true })
        first.record(report("job-1", "SENT"))
        assertFalse(first.flush())

        // The process dies; a new service instance starts over the same durable slot, with the network back.
        val delivered = ArrayList<PendingReport>()
        val second = ReportFlusher(store, { delivered.add(it) }, { true })
        assertTrue(second.mayClaim())
        assertEquals(1, delivered.size)
        assertEquals("job-1", delivered[0].jobId)
        assertEquals("SENT", delivered[0].result)
        assertNull(store.slot)
    }

    @Test
    fun aDefiniteRefusalClearsTheSlotSoTheGatewayIsNotStuckForever() {
        val store = MemoryStore()
        val flusher = ReportFlusher(store, { throw AckHttpError(404) }, { true })
        flusher.record(report("job-1"))
        assertTrue(flusher.mayClaim())
        assertNull(store.slot)
    }

    @Test
    fun stoppingTheServiceStopsTheRetriesButKeepsTheResult() {
        val store = MemoryStore()
        val flusher = ReportFlusher(store, { throw IOException("down") }, { false })
        flusher.record(report("job-1"))
        assertFalse(flusher.flush())
        assertNotNull(store.slot)
    }

    @Test
    fun nothingPendingMeansWorkMayBeClaimed() {
        val flusher = ReportFlusher(MemoryStore(), { fail("nothing to deliver") }, { true })
        assertTrue(flusher.mayClaim())
    }

    @Test
    fun onlyProvenTerminalStatusesEndTheReport() {
        assertTrue(isTerminalAckStatus(404))
        assertTrue(isTerminalAckStatus(409))
        for (status in listOf(400, 401, 403, 408, 410, 422, 429, 500, 502, 503, 504)) {
            assertFalse("HTTP $status is not proven terminal", isTerminalAckStatus(status))
        }
    }

    @Test
    fun throttlingOnAckKeepsTheResultAcrossARestartAndDeliversItAfterRecovery() {
        val store = MemoryStore()
        val slow = ReportFlusher(store, { throw AckHttpError(429) }, { true })
        slow.record(report("job-1", "SENT"))
        assertFalse("429 must not drop the result", slow.mayClaim())
        assertEquals("job-1", store.slot?.jobId)
        assertEquals("ACK_HTTP_429", slow.lastFailureCode)

        // The process restarts while the server is still throttling: nothing is lost and nothing new is claimed.
        val stillThrottled = ReportFlusher(store, { throw AckHttpError(429) }, { true })
        assertFalse(stillThrottled.mayClaim())
        assertEquals("SENT", store.slot?.result)

        // Server recovered.
        val delivered = ArrayList<PendingReport>()
        val recovered = ReportFlusher(store, { delivered.add(it) }, { true })
        assertTrue(recovered.mayClaim())
        assertEquals(listOf("job-1"), delivered.map { it.jobId })
        assertNull(store.slot)
        assertNull(recovered.lastFailureCode)
    }

    @Test
    fun everyNonTerminalStatusKeepsTheResultAndSaysWhy() {
        for (status in listOf(400, 401, 403, 408, 429, 500, 503)) {
            val store = MemoryStore()
            val flusher = ReportFlusher(store, { throw AckHttpError(status) }, { true })
            flusher.record(report("job-$status"))
            assertFalse("HTTP $status", flusher.mayClaim())
            assertEquals("HTTP $status", "job-$status", store.slot?.jobId)
            assertEquals("ACK_HTTP_$status", flusher.lastFailureCode)
        }
    }

    @Test
    fun terminalStatusesClearTheSlot() {
        for (status in listOf(404, 409)) {
            val store = MemoryStore()
            val flusher = ReportFlusher(store, { throw AckHttpError(status) }, { true })
            flusher.record(report("job-1"))
            assertTrue(flusher.mayClaim())
            assertNull(store.slot)
        }
    }
}

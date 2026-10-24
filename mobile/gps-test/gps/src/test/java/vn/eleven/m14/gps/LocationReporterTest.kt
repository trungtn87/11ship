package vn.eleven.m14.gps

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationReporterTest {
    private val token = "tok-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
    private var now = 1_000_000L
    private var currentToken: String? = token

    private class Sent(val url: String, val token: String, val body: String)

    private class FakeTransport : ReportTransport {
        val sent = mutableListOf<Sent>()
        var cancelled = 0
        var answer: () -> ReportResponse = { ReportResponse(200, "{\"data\":{\"ok\":true,\"should_share_location\":true,\"intent_online\":true}}") }
        var duringPut: () -> Unit = {}
        override fun put(url: String, token: String, body: String): ReportResponse {
            sent += Sent(url, token, body)
            duringPut()
            return answer()
        }
        override fun cancel() { cancelled++ }
    }

    private class Events : ReportListener {
        val log = mutableListOf<String>()
        var shouldShare: Boolean? = null
        override fun uploaded(atWallMs: Long, shouldShare: Boolean?, intentOnline: Boolean?) { log += "uploaded"; this.shouldShare = shouldShare }
        override fun failed() { log += "failed" }
        override fun refused() { log += "refused" }
        override fun sessionEnded() { log += "ended" }
        override fun notNeeded() { log += "notNeeded" }
    }

    private val transport = FakeTransport()
    private val events = Events()
    private val reporter = LocationReporter(transport, object : SessionLink { override fun token() = currentToken }, events, { now }, { it.run() })

    private fun fix(elapsed: Long, lat: Double = 22.66, accuracy: Float = 12f, measuredAt: Long = now, mock: Boolean = false) = Fix(lat, 106.25, accuracy, measuredAt, elapsed, mock)
    private fun begin() = reporter.start("https://api.example.test", ReportRules.fingerprint(token))

    @Test fun onlyValidFixesAreSent() {
        begin()
        for (bad in listOf(fix(1, accuracy = 0f), fix(2, accuracy = 1001f), fix(3, lat = 91.0), fix(4, lat = Double.NaN), fix(5, mock = true), fix(6, measuredAt = now - 120_000), fix(7, measuredAt = now + 1))) reporter.submit(bad)
        assertTrue(transport.sent.isEmpty())
        reporter.submit(fix(8))
        assertEquals(1, transport.sent.size)
    }

    @Test fun sendsTheLatestFixWithTheTokenOnlyInTheHeaderAndNeverInTheBodyOrEvents() {
        begin()
        reporter.submit(fix(1))
        val s = transport.sent.single()
        assertEquals("https://api.example.test/v1/driver/location", s.url)
        assertEquals(token, s.token)
        assertEquals("{\"lat\":22.66,\"lng\":106.25,\"accuracy_m\":12.0}", s.body)
        assertFalse(s.body.contains(token))
        assertEquals(listOf("uploaded"), events.log)
        assertEquals(true, events.shouldShare)
    }

    @Test fun theSameOrAnOlderFixIsNeverSentTwice() {
        begin()
        reporter.submit(fix(5))
        reporter.submit(fix(5))
        reporter.submit(fix(4))
        assertEquals(1, transport.sent.size)
        reporter.submit(fix(6))
        assertEquals(2, transport.sent.size)
    }

    @Test fun whileOneRequestIsInFlightOnlyTheNewestWaitingFixFollows() {
        begin()
        var first = true
        transport.duringPut = { if (first) { first = false; reporter.submit(fix(2, lat = 2.0)); reporter.submit(fix(3, lat = 3.0)); reporter.submit(fix(4, lat = 4.0)) } }
        reporter.submit(fix(1, lat = 1.0))
        assertEquals(listOf("1.0", "4.0"), transport.sent.map { Regex("\"lat\":([0-9.]+)").find(it.body)!!.groupValues[1] })
    }

    @Test fun aRevokedSessionEndsTheServiceAndNothingIsSentAfterwards() {
        begin()
        transport.answer = { ReportResponse(401, "{\"error\":{\"code\":\"SESSION_REVOKED\"}}") }
        reporter.submit(fix(1))
        assertEquals(listOf("ended"), events.log)
        assertFalse(reporter.running)
        reporter.submit(fix(2))
        assertEquals(1, transport.sent.size)
    }

    @Test fun noTokenMeansNoSessionAndNothingIsSent() {
        begin()
        currentToken = null
        reporter.submit(fix(1))
        assertTrue(transport.sent.isEmpty())
        assertEquals(listOf("ended"), events.log)
        assertFalse(reporter.running)
    }

    @Test fun anotherAccountsTokenIsNeverSentByThisRun() {
        begin()
        currentToken = "another-account-token-0123456789"
        reporter.submit(fix(1))
        assertTrue(transport.sent.isEmpty())
        assertEquals(listOf("ended"), events.log)
    }

    @Test fun aRefusalIsReportedAndSendingGoesOn() {
        begin()
        transport.answer = { ReportResponse(403, "") }
        reporter.submit(fix(1))
        assertEquals(listOf("refused"), events.log)
        assertTrue(reporter.running)
        transport.answer = { ReportResponse(200, "{\"data\":{\"ok\":true}}") }
        reporter.submit(fix(2))
        assertEquals(2, transport.sent.size)
    }

    @Test fun aFailureIsRetriedOnceForTheSameFixAndThenWaitsForTheNextOne() {
        begin()
        transport.answer = { throw IOException("offline") }
        reporter.submit(fix(1))
        reporter.retryLatest()
        reporter.retryLatest()
        assertEquals(2, transport.sent.size)
        assertEquals(listOf("failed", "failed"), events.log)
        transport.answer = { ReportResponse(200, "{\"data\":{\"ok\":true}}") }
        reporter.submit(fix(2))
        assertEquals(3, transport.sent.size)
        assertEquals(null, events.shouldShare)
    }

    @Test fun aServerErrorIsAFailureNotARefusal() {
        begin()
        transport.answer = { ReportResponse(503, "") }
        reporter.submit(fix(1))
        assertEquals(listOf("failed"), events.log)
    }

    @Test fun retryDoesNotSendAFixThatHasGoneStale() {
        begin()
        transport.answer = { throw IOException("offline") }
        reporter.submit(fix(1))
        now += 125_000
        reporter.retryLatest()
        assertEquals(1, transport.sent.size)
    }

    @Test fun theServiceStopsWhenTheServerSaysNothingNeedsThePositionButNotDuringTheStartGrace() {
        begin()
        transport.answer = { ReportResponse(200, "{\"data\":{\"ok\":true,\"should_share_location\":false,\"intent_online\":false}}") }
        reporter.submit(fix(1))
        assertEquals(listOf("uploaded"), events.log)
        assertTrue(reporter.running)
        now += 100_000
        reporter.submit(fix(2, measuredAt = now))
        assertEquals(listOf("uploaded", "uploaded", "notNeeded"), events.log)
        assertFalse(reporter.running)
        reporter.submit(fix(3, measuredAt = now))
        assertEquals(2, transport.sent.size)
    }

    @Test fun stoppingCancelsTheRequestInFlightAndItsLateAnswerIsIgnored() {
        begin()
        transport.duringPut = { reporter.stop() }
        reporter.submit(fix(1))
        assertEquals(1, transport.cancelled)
        assertTrue(events.log.isEmpty())
        assertFalse(reporter.running)
        reporter.submit(fix(2))
        assertEquals(1, transport.sent.size)
    }

    @Test fun aRestartDoesNotLetTheOldRunSendOrAnswer() {
        begin()
        var first = true
        transport.duringPut = { if (first) { first = false; reporter.stop(); begin(); reporter.submit(fix(9)) } }
        reporter.submit(fix(1))
        // The old answer is dropped; the new run sent its own fix once.
        assertEquals(2, transport.sent.size)
        assertEquals(listOf("uploaded"), events.log)
    }

    @Test fun onlyAnHttpsAddressOfTheServerIsAccepted() {
        assertTrue(ReportRules.validBase("https://api.example.test"))
        assertTrue(ReportRules.validBase("https://api.example.test:8443/"))
        assertFalse(ReportRules.validBase("http://api.example.test"))
        assertFalse(ReportRules.validBase("https://api.example.test/path"))
        assertFalse(ReportRules.validBase("https://user@api.example.test"))
    }

    @Test fun theFingerprintIsNotTheTokenAndDiffersPerToken() {
        val a = ReportRules.fingerprint(token)
        assertEquals(16, a.length)
        assertFalse(token.contains(a))
        assertFalse(a == ReportRules.fingerprint("$token-x"))
        assertNull(ReportRules.flag("{}", "should_share_location"))
    }
}

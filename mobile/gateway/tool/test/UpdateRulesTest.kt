package vn.eleven.gateway

import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The gateway updates only when idle and installs only a file whose size and SHA-256 equal what the server announced. */
class UpdateRulesTest {
    private val bytes = ByteArray(5000) { (it % 251).toByte() }
    private val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun offer(ready: Boolean = true, code: Int = 5, size: Long = 5000, hash: String = sha, path: String = "/v1/sms-gateway/update/11111111-2222-3333-4444-555555555555") =
        UpdateOffer("r", "1.5", code, "RECOMMENDED", size, hash, ready, path)

    @Test
    fun updatesOnlyWhenStoppedWithNothingPending() {
        assertNull(UpdateRules.blocker(offer(), 4, false, 0, "IDLE"))
        assertEquals("STOP_FIRST", UpdateRules.blocker(offer(), 4, true, 0, "IDLE"))
        assertEquals("REPORT_PENDING", UpdateRules.blocker(offer(), 4, false, 1, "IDLE"))
        assertEquals("TASK_RUNNING", UpdateRules.blocker(offer(), 4, false, 0, "SENDING"))
        assertEquals("SERVER_NOT_READY", UpdateRules.blocker(offer(ready = false), 4, false, 0, "IDLE"))
    }

    @Test
    fun noOfferOrNotNewerMeansNoUpdate() {
        assertEquals("NO_UPDATE", UpdateRules.blocker(null, 4, false, 0, "IDLE"))
        assertEquals("NO_UPDATE", UpdateRules.blocker(offer(code = 4), 4, false, 0, "IDLE"))
        assertEquals("NO_UPDATE", UpdateRules.blocker(offer(code = 3), 4, false, 0, "IDLE"))
    }

    @Test
    fun refusesAnAnnouncementThatIsNotUsable() {
        assertEquals("BAD_SIZE", UpdateRules.blocker(offer(size = 0), 4, false, 0, "IDLE"))
        assertEquals("BAD_SIZE", UpdateRules.blocker(offer(size = UpdateRules.MAX_APK_BYTES + 1), 4, false, 0, "IDLE"))
        assertEquals("BAD_HASH", UpdateRules.blocker(offer(hash = "abc"), 4, false, 0, "IDLE"))
        assertEquals("BAD_PATH", UpdateRules.blocker(offer(path = "https://evil.example/x.apk"), 4, false, 0, "IDLE"))
    }

    @Test
    fun savesOnlyAFileWithTheAnnouncedSizeAndHash() {
        val dir = File.createTempFile("upd", "").also { it.delete(); it.mkdirs() }
        val target = File(dir, "gateway.apk")
        UpdateRules.saveVerified(ByteArrayInputStream(bytes), target, 5000, sha)
        assertTrue(target.exists())
        assertEquals(sha, UpdateRules.sha256Hex(target.inputStream()))
    }

    @Test
    fun aWrongHashLeavesNothingBehind() {
        val dir = File.createTempFile("upd", "").also { it.delete(); it.mkdirs() }
        val target = File(dir, "gateway.apk")
        val tampered = bytes.copyOf().also { it[10] = 99 }
        try {
            UpdateRules.saveVerified(ByteArrayInputStream(tampered), target, 5000, sha)
            fail()
        } catch (e: UpdateVerificationFailed) {
            assertEquals("SHA256_MISMATCH", e.code)
        }
        assertFalse(target.exists())
        assertFalse(File(target.path + ".part").exists())
    }

    @Test
    fun aWrongSizeIsRefused() {
        val dir = File.createTempFile("upd", "").also { it.delete(); it.mkdirs() }
        val target = File(dir, "gateway.apk")
        try {
            UpdateRules.saveVerified(ByteArrayInputStream(bytes.copyOf(4000)), target, 5000, sha)
            fail()
        } catch (e: UpdateVerificationFailed) {
            assertEquals("SIZE_MISMATCH", e.code)
        }
        try {
            UpdateRules.saveVerified(ByteArrayInputStream(bytes), target, 4000, sha)
            fail()
        } catch (e: UpdateVerificationFailed) {
            assertEquals("SIZE_MISMATCH", e.code)
        }
        assertFalse(target.exists())
    }
}

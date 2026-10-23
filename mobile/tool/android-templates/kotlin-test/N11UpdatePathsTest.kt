package vn.eleven.n11

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class N11UpdatePathsTest {
    private val dir = File.createTempFile("n11upd", "").also { it.delete(); it.mkdirs() }

    @Test
    fun onlyAPlainUpdateFileInsideTheFolderIsAccepted() {
        assertTrue(N11UpdatePaths.isUpdateFile(dir, File(dir, "update-42.apk")))
        assertFalse(N11UpdatePaths.isUpdateFile(dir, File(dir, "other.apk")))
        assertFalse(N11UpdatePaths.isUpdateFile(dir, File(dir, "update-42.apk.part")))
        assertFalse(N11UpdatePaths.isUpdateFile(dir, File(dir, "../update-42.apk")))
        assertFalse(N11UpdatePaths.isUpdateFile(dir, File(dir.parentFile, "update-42.apk")))
        assertFalse(N11UpdatePaths.isUpdateFile(dir, File(File(dir, "sub"), "update-42.apk")))
    }
}

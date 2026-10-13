package vn.eleven.n11

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Binder join rules (contract11 section 7) without a device: who may ask, what may be endorsed, and the exact bytes signed.
 * The expected message was produced by apps/backend/src/client-device/device-messages.ts for the same inputs.
 */
class N11PeerPolicyTest {
    private val signer = setOf("aa".repeat(32))
    private val other = setOf("bb".repeat(32))
    private val bindingId = "33333333-3333-4333-8333-333333333333"
    private val keyId = "22222222-2222-4222-8222-222222222222"
    private val challengeId = "00000000-0000-4000-8000-000000000001"
    private val nonce = "A".repeat(43)
    private val spkiHash = "6feecc8c16c5551d9feb3eb5f77e2da773bf68bd9ef9c52927ceb2c86e56892b"

    private fun request(
        environment: String = "local-test",
        target: String = "SHIP",
        challenge: String = challengeId,
        n: String = nonce,
        hash: String = spkiHash,
    ) = N11PeerPolicy.JoinRequest(environment, challenge, n, target, hash)

    // ---- who may call -------------------------------------------------------------------------------------------------------

    @Test
    fun onlyTheOtherAppWithTheSameSignerMayCall() {
        assertTrue(N11PeerPolicy.callerAllowed(N11PeerPolicy.FOOD_PACKAGE, arrayOf(N11PeerPolicy.SHIP_PACKAGE), signer, signer))
        assertTrue(N11PeerPolicy.callerAllowed(N11PeerPolicy.SHIP_PACKAGE, arrayOf(N11PeerPolicy.FOOD_PACKAGE), signer, signer))
    }

    @Test
    fun anyOtherCallerIsRefused() {
        val food = N11PeerPolicy.FOOD_PACKAGE
        val ship = N11PeerPolicy.SHIP_PACKAGE
        // itself, a stranger, nothing
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(food), signer, signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf("com.example.evil"), signer, signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, null, signer, signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, emptyArray(), signer, signer))
        // a shared UID (two packages in one UID) is never accepted, even when one of them is the peer
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(ship, "com.example.evil"), signer, signer))
        // the peer package name signed by ANOTHER certificate (a spoof / a debug build)
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(ship), other, signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(ship), signer + other, signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(ship), null, signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(ship), emptySet(), signer))
        assertFalse(N11PeerPolicy.callerAllowed(food, arrayOf(ship), signer, emptySet()))
        // a build whose own package is not one of the two
        assertFalse(N11PeerPolicy.callerAllowed("com.example.other", arrayOf(ship), signer, signer))
    }

    // ---- what may be endorsed -----------------------------------------------------------------------------------------------

    @Test
    fun foodEndorsesAShipKeyForTheSameEnvironmentAndItsOwnBinding() {
        assertTrue(N11PeerPolicy.joinAllowed(N11PeerPolicy.FOOD_PACKAGE, "local-test", request(), bindingId, keyId))
    }

    @Test
    fun shipEndorsesAFoodKey() {
        assertTrue(N11PeerPolicy.joinAllowed(N11PeerPolicy.SHIP_PACKAGE, "local-test", request(target = "FOOD"), bindingId, keyId))
    }

    @Test
    fun aRequestForTheEndorsersOwnAppOrAnotherEnvironmentOrAnyBadFieldIsRefused() {
        val food = N11PeerPolicy.FOOD_PACKAGE
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(target = "FOOD"), bindingId, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(target = "WEB"), bindingId, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(environment = "production"), bindingId, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(challenge = "not-a-uuid"), bindingId, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(n = "short"), bindingId, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(hash = "ABC"), bindingId, keyId))
        // free text in a field (an attempt to make it sign something else): newline or any non-token character
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(n = "A".repeat(42) + "\n"), bindingId, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(challenge = "$challengeId\nSHIP"), bindingId, keyId))
    }

    @Test
    fun withoutItsOwnCurrentBindingAndKeyNothingIsEndorsed() {
        val food = N11PeerPolicy.FOOD_PACKAGE
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(), null, keyId))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(), bindingId, null))
        assertFalse(N11PeerPolicy.joinAllowed(food, "local-test", request(), "forged", keyId))
        assertFalse(N11PeerPolicy.joinAllowed("com.example.other", "local-test", request(), bindingId, keyId))
    }

    // ---- what is signed -----------------------------------------------------------------------------------------------------

    @Test
    fun theJoinMessageIsByteIdenticalToTheServersOne() {
        val expected = "11SHIP-JOIN-KEY-V1\nlocal-test\n00000000-0000-4000-8000-000000000001\n" +
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nSHIP\n$spkiHash\n$bindingId\n$keyId"
        assertArrayEquals(expected.toByteArray(Charsets.UTF_8), N11PeerPolicy.joinMessage(request(), bindingId, keyId))
        assertEquals(spkiHash, N11PeerPolicy.sha256Hex("spki".toByteArray(Charsets.UTF_8)))
    }

    @Test
    fun appLabelsAndPeersAreFixedAndSymmetric() {
        assertEquals("FOOD", N11PeerPolicy.appLabelOf(N11PeerPolicy.FOOD_PACKAGE))
        assertEquals("SHIP", N11PeerPolicy.appLabelOf(N11PeerPolicy.SHIP_PACKAGE))
        assertNull(N11PeerPolicy.appLabelOf("vn.eleven.food"))
        assertEquals(N11PeerPolicy.SHIP_PACKAGE, N11PeerPolicy.peerPackageOf(N11PeerPolicy.FOOD_PACKAGE))
        assertEquals(N11PeerPolicy.FOOD_PACKAGE, N11PeerPolicy.peerPackageOf(N11PeerPolicy.SHIP_PACKAGE))
        assertNull(N11PeerPolicy.peerPackageOf("com.example.other"))
    }
}

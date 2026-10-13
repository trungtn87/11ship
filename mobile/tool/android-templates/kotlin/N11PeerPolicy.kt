package vn.eleven.n11

import java.security.MessageDigest

/**
 * The rules of the join endorsement, with no Android type in them so that they can be read (and tested) on their own.
 *
 * Who may ask: exactly the other 11Ship app. The caller is identified by the UID the kernel attached to the Binder transaction,
 * mapped to its package list, and its signing certificate must be the same one this app is signed with. This is decided BEFORE any
 * other work and before any clearCallingIdentity; a package name or an Intent extra the caller sent is never trusted.
 *
 * What it may get: a signature over ONE fixed message shape (the JOIN message of contract11 section 7) that this class builds
 * itself from validated fields and this app's OWN current binding. It is not a "sign these bytes" service, and it never returns a
 * token, a password or a private key.
 */
object N11PeerPolicy {
    const val FOOD_PACKAGE = "vn.eleven.food.test"
    const val SHIP_PACKAGE = "vn.eleven.ship.test"
    const val JOIN_PREFIX = "11SHIP-JOIN-KEY-V1"

    private val UUID_RE = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val NONCE_RE = Regex("^[A-Za-z0-9_-]{43}$")
    private val SHA256_RE = Regex("^[0-9a-f]{64}$")
    private val ENVIRONMENT_RE = Regex("^[A-Za-z0-9._-]{1,64}$")

    fun appLabelOf(packageName: String): String? = when (packageName) {
        FOOD_PACKAGE -> "FOOD"
        SHIP_PACKAGE -> "SHIP"
        else -> null
    }

    fun peerPackageOf(ownPackage: String): String? = when (ownPackage) {
        FOOD_PACKAGE -> SHIP_PACKAGE
        SHIP_PACKAGE -> FOOD_PACKAGE
        else -> null
    }

    /**
     * True only when the caller UID maps to EXACTLY ONE package (a shared UID is refused), that package is the other app, and its
     * signing certificate digest equals ours.
     */
    fun callerAllowed(ownPackage: String, callerPackages: Array<String>?, callerSigners: Set<String>?, ownSigners: Set<String>): Boolean {
        val peer = peerPackageOf(ownPackage) ?: return false
        if (callerPackages == null || callerPackages.size != 1 || callerPackages[0] != peer) return false
        if (callerSigners == null || callerSigners.isEmpty() || ownSigners.isEmpty()) return false
        return callerSigners == ownSigners
    }

    class JoinRequest(
        val environment: String,
        val challengeId: String,
        val nonce: String,
        val targetApp: String,
        val spkiSha256Hex: String,
    )

    /**
     * The endorsement is for the OTHER app only, in THIS build's environment, for a challenge/nonce/key hash of the right shape,
     * and only while this app itself has a current binding and a registered key.
     */
    fun joinAllowed(
        ownPackage: String,
        ownEnvironment: String,
        request: JoinRequest,
        ownBindingId: String?,
        ownKeyId: String?,
    ): Boolean {
        val ownApp = appLabelOf(ownPackage) ?: return false
        val peerApp = appLabelOf(peerPackageOf(ownPackage) ?: return false) ?: return false
        return ENVIRONMENT_RE.matches(ownEnvironment) &&
            request.environment == ownEnvironment &&
            request.targetApp == peerApp &&
            request.targetApp != ownApp &&
            UUID_RE.matches(request.challengeId) &&
            NONCE_RE.matches(request.nonce) &&
            SHA256_RE.matches(request.spkiSha256Hex) &&
            ownBindingId != null && UUID_RE.matches(ownBindingId) &&
            ownKeyId != null && UUID_RE.matches(ownKeyId)
    }

    /** The JOIN message, byte for byte the one the server rebuilds (device-messages.ts registerKeyMessage with the JOIN prefix). */
    fun joinMessage(request: JoinRequest, bindingId: String, authorizerKeyId: String): ByteArray {
        val lines = listOf(
            JOIN_PREFIX,
            request.environment,
            request.challengeId,
            request.nonce,
            request.targetApp,
            request.spkiSha256Hex,
            bindingId,
            authorizerKeyId,
        )
        return lines.joinToString("\n").toByteArray(Charsets.UTF_8)
    }

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

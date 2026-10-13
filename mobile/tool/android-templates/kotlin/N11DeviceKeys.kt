package vn.eleven.n11

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** The refusals of the key layer: a closed list that the Flutter side maps to DEVICE_PROOF_UNSUPPORTED / "no key". */
class N11KeyException(val code: String) : Exception(code)

/**
 * The device key of ONE app: an ECDSA P-256 key generated INSIDE the Android Keystore (non-exportable, purpose SIGN, digest
 * SHA-256) with the server's random challenge as attestation challenge. Only the public key, the attestation certificate chain and
 * signatures ever leave this class; there is no way to read the private key and no "sign these bytes for another caller" entry.
 * No software fallback: a key that is not inside secure hardware, or whose chain is not an attestation chain, is UNSUPPORTED.
 */
class N11DeviceKeys {
    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun exists(): Boolean = store().containsAlias(KEY_ALIAS)

    fun delete() {
        val s = store()
        if (s.containsAlias(KEY_ALIAS)) s.deleteEntry(KEY_ALIAS)
    }

    /** Base64 (standard) DER SubjectPublicKeyInfo of the current key. */
    fun publicKeySpki(): String {
        val cert = store().getCertificate(KEY_ALIAS) ?: throw N11KeyException("NO_KEY")
        return Base64.encodeToString(cert.publicKey.encoded, Base64.NO_WRAP)
    }

    /** Base64 DER certificates, leaf first. */
    fun chain(): List<String> {
        val certificates = store().getCertificateChain(KEY_ALIAS) ?: throw N11KeyException("NO_KEY")
        return certificates.map { Base64.encodeToString(it.encoded, Base64.NO_WRAP) }
    }

    /** Generates a NEW key for the server nonce (base64url). Any older key of this app is deleted first. */
    fun generate(challengeBase64Url: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) throw N11KeyException("UNSUPPORTED")
        val challenge = Base64.decode(challengeBase64Url, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        if (challenge.size != 32) throw N11KeyException("FAILED")
        delete()
        try {
            create(challenge, strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
        } catch (e: StrongBoxUnavailableException) {
            create(challenge, strongBox = false)
        } catch (e: java.security.ProviderException) {
            // A device whose Keystore cannot attest at all (or has no StrongBox on a path that reports it as a provider error).
            delete()
            try {
                create(challenge, strongBox = false)
            } catch (inner: Exception) {
                delete()
                throw N11KeyException("UNSUPPORTED")
            }
        }
        if (!insideSecureHardware() || (store().getCertificateChain(KEY_ALIAS)?.size ?: 0) < 2) {
            delete()
            throw N11KeyException("UNSUPPORTED")
        }
    }

    private fun create(challenge: ByteArray, strongBox: Boolean) {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        val builder = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }
        generator.initialize(builder.build())
        generator.generateKeyPair()
    }

    @Suppress("DEPRECATION")
    private fun insideSecureHardware(): Boolean {
        val key = store().getKey(KEY_ALIAS, null) as? PrivateKey ?: return false
        val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT || info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
        } else {
            info.isInsideSecureHardware
        }
    }

    /** ECDSA SHA-256 signature (DER) of [message], base64url without padding. */
    fun sign(message: ByteArray): String {
        val key = store().getKey(KEY_ALIAS, null) as? PrivateKey ?: throw N11KeyException("NO_KEY")
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(key)
        signature.update(message)
        return Base64.encodeToString(signature.sign(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    companion object {
        const val KEY_ALIAS = "n11_device_key"
    }
}

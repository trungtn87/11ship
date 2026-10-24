package vn.eleven.m14.flutter

import vn.eleven.m14.gps.SessionLink

/**
 * The only way the location service reaches the Shipper's session: a reader the app registers when its process starts (it reads the app's own
 * encrypted token store). The service asks for the token for each request and keeps nothing; no reader or no token = no session.
 */
object ShipSessionLink : SessionLink {
    @Volatile
    var tokenReader: (() -> String?)? = null

    override fun token(): String? = try {
        tokenReader?.invoke()
    } catch (e: Exception) {
        null
    }
}

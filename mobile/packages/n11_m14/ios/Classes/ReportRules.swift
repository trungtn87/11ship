import CryptoKit
import Security
import Foundation

/// One accepted fix, as the recorder hands it over (the Swift side of Fix in LocationReporter.kt).
struct Fix {
    let lat: Double
    let lon: Double
    let accuracyM: Double
    let measuredAtMs: Int64
    let simulated: Bool
}

/// The same rules as ReportRules in LocationReporter.kt: an invalid fix is never sent.
enum ReportRules {
    static let maxAccuracyM = 1000.0
    static let maxAgeMs: Int64 = 120_000

    static func valid(_ fix: Fix, nowMs: Int64) -> Bool {
        let age = nowMs - fix.measuredAtMs
        return !fix.simulated && fix.lat.isFinite && (-90.0...90.0).contains(fix.lat) && fix.lon.isFinite && (-180.0...180.0).contains(fix.lon)
            && fix.accuracyM.isFinite && fix.accuracyM > 0 && fix.accuracyM <= maxAccuracyM && age >= 0 && age < maxAgeMs
    }

    static func body(_ fix: Fix) -> Data {
        let json: [String: Any] = ["lat": fix.lat, "lng": fix.lon, "accuracy_m": fix.accuracyM]
        return (try? JSONSerialization.data(withJSONObject: json)) ?? Data()
    }

    /// A one-way digest that tells "the same session" from another without keeping the token.
    static func fingerprint(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// Only an https address of the app's own server is accepted.
    static func validBase(_ base: String) -> Bool {
        base.range(of: "^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$", options: .regularExpression) != nil
    }
}

/// Where the session token comes from: the app's Keychain entry (same service/account as n11_native_ios TokenStore). Nil = no session.
enum SessionLink {
    static func token() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "vn.eleven.n11.session", kSecAttrAccount as String: "token",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

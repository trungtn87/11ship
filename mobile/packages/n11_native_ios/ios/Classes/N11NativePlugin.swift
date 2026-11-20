import CoreLocation
import Flutter
import Security
import UIKit

/// The iOS counterpart of the Android channels (mobile/tool/android-templates/kotlin). Same channel names and answers as the Dart side expects
/// (n11_shared: device_bridge.dart, location.dart, shop_contact.dart, order_sections.dart, m13_update.dart, m08_push.dart).
/// iOS sessions are PASSWORD sessions: there is no key attestation and no peer app, so the device channel only serves the local token store.
public class N11NativePlugin: NSObject, FlutterPlugin {
    public static func register(with registrar: FlutterPluginRegistrar) {
        let messenger = registrar.messenger()
        let device = FlutterMethodChannel(name: "vn.eleven.n11/device", binaryMessenger: messenger)
        let location = FlutterMethodChannel(name: "vn.eleven.n11/location", binaryMessenger: messenger)
        let launch = FlutterMethodChannel(name: "vn.eleven.n11/launch", binaryMessenger: messenger)
        let dialer = FlutterMethodChannel(name: "vn.eleven.n11/dialer", binaryMessenger: messenger)
        let update = FlutterMethodChannel(name: "vn.eleven.n11/update", binaryMessenger: messenger)
        let push = FlutterMethodChannel(name: "vn.eleven.n11/push", binaryMessenger: messenger)
        let plugin = N11NativePlugin()
        registrar.addMethodCallDelegate(plugin, channel: device)
        registrar.addMethodCallDelegate(plugin, channel: location)
        registrar.addMethodCallDelegate(plugin, channel: launch)
        registrar.addMethodCallDelegate(plugin, channel: dialer)
        registrar.addMethodCallDelegate(plugin, channel: update)
        registrar.addMethodCallDelegate(plugin, channel: push)
        TokenStore.wipeAfterReinstall()
    }

    private let locator = OneShotLocator()

    // FlutterPlugin gives one handler for every channel; the channel name is not passed, so each method name below is unique per channel
    // except `dial` (launch and dialer behave the same) and `openSettings`/`state` (push only).
    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "deviceId":
            result(TokenStore.deviceId())
        case "readToken":
            result(TokenStore.read())
        case "storeToken":
            guard let args = call.arguments as? [String: Any], let token = args["token"] as? String, !token.isEmpty else {
                result(FlutterError(code: "FAILED", message: nil, details: nil)); return
            }
            result(TokenStore.write(token) ? nil : FlutterError(code: "FAILED", message: nil, details: nil))
        case "clearToken":
            TokenStore.clear()
            result(nil)
        case "currentKey", "generateKey", "saveKeyId", "deleteKey", "sign", "rememberBinding", "forgetBinding", "peer", "requestEndorsement":
            // Device keys and the peer app are Android-only legacy; an iOS session never uses them.
            result(FlutterError(code: "UNSUPPORTED", message: nil, details: nil))
        case "currentFix":
            locator.currentFix(result)
        case "dial":
            let phone = (call.arguments as? [String: Any])?["phone"] as? String ?? ""
            result(Launch.dial(phone))
        case "open":
            let url = (call.arguments as? [String: Any])?["url"] as? String ?? ""
            Launch.open(url, result)
        case "dataDirectory":
            result(DataDirectory.path())
        case "state":
            // Push is not part of the first iOS build: say so honestly (the inbox and live sync still work).
            result(["supported": false, "permission": "unknown"])
        case "requestPermission", "openSettings", "deleteToken":
            result(nil)
        default:
            result(FlutterMethodNotImplemented)
        }
    }
}

/// Session token and a stable per-install device id. The token lives in the Keychain (this device only, after first unlock). The Keychain survives
/// an uninstall on iOS, so the first launch after a (re)install removes any token left behind: an old session never comes back by itself.
enum TokenStore {
    private static let service = "vn.eleven.n11.session"
    private static let account = "token"
    private static let installedKey = "vn.eleven.n11.installed"
    private static let deviceIdKey = "vn.eleven.n11.deviceId"

    static func wipeAfterReinstall() {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: installedKey) {
            clear()
            defaults.set(true, forKey: installedKey)
        }
    }

    static func deviceId() -> String {
        let defaults = UserDefaults.standard
        if let existing = defaults.string(forKey: deviceIdKey), !existing.isEmpty { return existing }
        let created = "ios-" + UUID().uuidString.lowercased()
        defaults.set(created, forKey: deviceIdKey)
        return created
    }

    private static func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func read() -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ token: String) -> Bool {
        clear()
        var q = query()
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func clear() {
        SecItemDelete(query() as CFDictionary)
    }
}

/// Dial and open mirror N11LaunchChannel.kt: a number must be +84 and nine digits, a link must be https on a fixed host list without credentials,
/// a port or a fragment. Anything else is refused before the system is asked. Answers false (never an error) when nothing can handle it.
enum Launch {
    private static let hosts: Set<String> = ["zalo.me", "m.me", "www.facebook.com"]

    static func isPhone(_ value: String) -> Bool {
        value.range(of: "^\\+84[0-9]{9}$", options: .regularExpression) != nil
    }

    static func isSafeLink(_ value: String) -> URL? {
        guard !value.isEmpty, value.count <= 200, let url = URL(string: value), url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil, let host = url.host, hosts.contains(host) else { return nil }
        return url
    }

    static func dial(_ phone: String) -> Bool {
        guard isPhone(phone), let url = URL(string: "tel:" + phone), UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return true
    }

    static func open(_ link: String, _ result: @escaping FlutterResult) {
        guard let url = isSafeLink(link) else { result(false); return }
        UIApplication.shared.open(url, options: [:]) { ok in result(ok) }
    }
}

enum DataDirectory {
    static func path() -> String? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("n11-ops", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.path
    }
}

/// One fresh position, like N11LocationChannel.kt: DENIED / DISABLED / TIMEOUT / UNAVAILABLE as the Dart side expects. A fix older than 30 seconds is
/// ignored (the system may first hand back a cached one), and the request gives up after 20 seconds.
final class OneShotLocator: NSObject, CLLocationManagerDelegate {
    private var manager: CLLocationManager?
    private var pending: FlutterResult?
    private var timer: Timer?

    func currentFix(_ result: @escaping FlutterResult) {
        if pending != nil { result(FlutterError(code: "UNAVAILABLE", message: nil, details: nil)); return }
        guard CLLocationManager.locationServicesEnabled() else { result(FlutterError(code: "DISABLED", message: nil, details: nil)); return }
        pending = result
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyBest
        manager = m
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in self?.finish(error: "TIMEOUT") }
        switch m.authorizationStatus {
        case .notDetermined: m.requestWhenInUseAuthorization()
        case .denied, .restricted: finish(error: "DENIED")
        default: m.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard pending != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        case .denied, .restricted: finish(error: "DENIED")
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard pending != nil, let fix = locations.last else { return }
        if abs(fix.timestamp.timeIntervalSinceNow) > 30 { manager.requestLocation(); return }
        let answer: [String: Any] = [
            "latitude": fix.coordinate.latitude,
            "longitude": fix.coordinate.longitude,
            "accuracyMeters": fix.horizontalAccuracy,
            "takenAtMillis": Int(fix.timestamp.timeIntervalSince1970 * 1000),
        ]
        let done = pending
        cleanup()
        done?(answer)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard pending != nil else { return }
        if let e = error as? CLError, e.code == .denied { finish(error: "DENIED") } else { finish(error: "UNAVAILABLE") }
    }

    private func finish(error code: String) {
        let done = pending
        cleanup()
        done?(FlutterError(code: code, message: nil, details: nil))
    }

    private func cleanup() {
        timer?.invalidate()
        timer = nil
        manager?.delegate = nil
        manager = nil
        pending = nil
    }
}

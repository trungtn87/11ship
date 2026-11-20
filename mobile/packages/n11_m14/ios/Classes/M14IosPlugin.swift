import CoreLocation
import Flutter
import Network
import UIKit

/// The iOS counterpart of M14Plugin.kt + ShipLocationService.kt + RecorderService.kt, for 11Ship only. Same channels ("vn.eleven/m14" and the event
/// stream "vn.eleven/m14/gps"), same snapshot keys and the same Vietnamese status words, so the Dart side is unchanged.
///
/// How it differs from Android (there is no foreground service on iOS): sharing starts only from the open app, then continues in the background
/// through the system's location background mode (the blue status indicator is shown), with "While Using" permission only. If the person force-quits
/// the app, iOS ends sharing; Android keeps it. Only the LATEST position is kept and sent, about once a minute.
public class M14IosPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
    public static func register(with registrar: FlutterPluginRegistrar) {
        let plugin = M14IosPlugin()
        let channel = FlutterMethodChannel(name: "vn.eleven/m14", binaryMessenger: registrar.messenger())
        registrar.addMethodCallDelegate(plugin, channel: channel)
        let events = FlutterEventChannel(name: "vn.eleven/m14/gps", binaryMessenger: registrar.messenger())
        events.setStreamHandler(plugin)
        M14Recorder.shared.onChange = { [weak plugin] in plugin?.push() }
    }

    private var sink: FlutterEventSink?

    private func push() {
        DispatchQueue.main.async { self.sink?(M14Recorder.shared.snapshot()) }
    }

    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        sink = events
        events(M14Recorder.shared.snapshot())
        return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        sink = nil
        return nil
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "status":
            result(M14Recorder.shared.snapshot())
        case "start":
            let args = call.arguments as? [String: Any]
            guard args?["consent"] as? Bool == true else {
                result(FlutterError(code: "CONSENT", message: "Cần đồng ý cập nhật vị trí trước khi bắt đầu", details: nil)); return
            }
            M14Recorder.shared.start(base: args?["apiBaseUrl"] as? String) { error in
                result(error.map { FlutterError(code: $0.0, message: $0.1, details: nil) })
            }
        case "stop":
            M14Recorder.shared.stop("Đã dừng ghi — không tiếp tục thu thập vị trí")
            result(nil)
        case "openSettings":
            // Opens the phone's own settings screen only; the app never turns location on or grants a permission by itself.
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url, options: [:]) { ok in result(ok ? nil : FlutterError(code: "SETTINGS", message: "Không mở được cài đặt", details: nil)) }
            } else {
                result(FlutterError(code: "SETTINGS", message: "Không mở được cài đặt", details: nil))
            }
        case "mapPackage", "savedRoute", "calculate":
            // The 11Ship app does not call these (route calculation and the package check are Android-only leftovers of the GPS test app).
            result(FlutterError(code: "M14", message: "Chưa hỗ trợ trên iOS", details: nil))
        default:
            result(FlutterMethodNotImplemented)
        }
    }
}

/// One recorder per process (iOS keeps the process alive while background location is running).
final class M14Recorder: NSObject, CLLocationManagerDelegate {
    static let shared = M14Recorder()

    var onChange: (() -> Void)?

    private let main = DispatchQueue.main
    private var manager: CLLocationManager?
    private let monitor = NWPathMonitor()
    private var online = true
    private var reporter: LocationReporter!
    private var pendingStart: ((((String, String))?) -> Void)?
    private var pendingBase: String?
    private var recording = false
    private var timer: Timer?
    private var lastSubmitMs: Int64 = 0
    private var startedAtMs: Int64 = 0
    private var retryWork: DispatchWorkItem?

    // What the Dart side reads (the keys of the Android snapshot).
    private var lat: Double?
    private var lon: Double?
    private var accuracy: Double?
    private var fixTimeMs: Int64?
    private var fixMonotonic: TimeInterval?
    private var fixState = "UNAVAILABLE"
    private var status = "Đã dừng — không thu thập vị trí"
    private var uploadedAt: Int64?
    private var uploadState: String?
    private var shouldShare: Bool?
    private var intentOnline: Bool?

    override init() {
        super.init()
        monitor.pathUpdateHandler = { [weak self] path in
            self?.main.async { self?.online = path.status == .satisfied; self?.onChange?() }
        }
        monitor.start(queue: DispatchQueue(label: "m14-net"))
        reporter = LocationReporter { [weak self] outcome in self?.main.async { self?.handle(outcome) } }
    }

    private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    // MARK: state for Dart

    func snapshot() -> [String: Any] {
        let status = manager?.authorizationStatus ?? CLLocationManager().authorizationStatus
        let permitted = status == .authorizedWhenInUse || status == .authorizedAlways
        let enabled = CLLocationManager.locationServicesEnabled()
        let age = fixMonotonic.map { ProcessInfo.processInfo.systemUptime - $0 }
        let wallAge = fixTimeMs.map { Self.nowMs() - $0 }
        let fresh = recording && permitted && enabled && fixState == "FIX" && (age ?? .infinity) >= 0 && (age ?? .infinity) <= 120 && (wallAge ?? Int64.max) >= 0 && (wallAge ?? Int64.max) <= 120_000
        var out: [String: Any] = [
            "recording": recording,
            "gpsEnabled": enabled,
            "networkAvailable": online,
            "permissionGranted": permitted,
            "fixState": fixState,
            "fresh": fresh,
            "status": recording ? self.status : "Đã dừng — không thu thập vị trí",
        ]
        if let lat = lat { out["lat"] = lat }
        if let lon = lon { out["lon"] = lon }
        if let accuracy = accuracy { out["accuracy"] = accuracy }
        if let t = fixTimeMs { out["time"] = t }
        if let t = uploadedAt { out["uploadedAt"] = t }
        if let s = uploadState { out["uploadState"] = s }
        if let s = shouldShare { out["shouldShare"] = s }
        if let s = intentOnline { out["intentOnline"] = s }
        return out
    }

    private func state(_ message: String, _ code: String = "UNAVAILABLE") {
        status = message
        fixState = code
        onChange?()
    }

    // MARK: start / stop

    func start(base: String?, done: @escaping ((String, String))? -> Void) {
        guard UIApplication.shared.applicationState == .active else {
            done(("FOREGROUND", "Mở ứng dụng để bắt đầu cập nhật vị trí")); return
        }
        if pendingStart != nil { done(("BUSY", "Đang chờ cấp quyền vị trí")); return }
        pendingStart = done
        pendingBase = base
        let m = manager ?? CLLocationManager()
        m.delegate = self
        manager = m
        switch m.authorizationStatus {
        case .notDetermined: m.requestWhenInUseAuthorization()
        default: finishStart()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if pendingStart != nil, manager.authorizationStatus != .notDetermined { finishStart(); return }
        if recording, manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            stop("Quyền vị trí đã bị thu hồi — hãy cấp lại quyền để tiếp tục")
        }
    }

    private func finishStart() {
        guard let done = pendingStart else { return }
        pendingStart = nil
        let base = pendingBase
        pendingBase = nil
        guard let m = manager, m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways else {
            done(("PERMISSION", "Quyền vị trí chính xác bị từ chối")); return
        }
        guard CLLocationManager.locationServicesEnabled() else { done(("PERMISSION", "Định vị đang tắt — bật Vị trí trên điện thoại")); return }
        guard let token = SessionLink.token() else { done(("SESSION", "Phiên đăng nhập không còn hiệu lực")); return }
        guard let base = base, ReportRules.validBase(base) else { done(("CONFIG", "Chưa có địa chỉ máy chủ hợp lệ")); return }
        // A fresh start forgets the previous run.
        reporter.stop()
        reporter.start(base: base, fingerprint: ReportRules.fingerprint(token))
        lat = nil; lon = nil; accuracy = nil; fixTimeMs = nil; fixMonotonic = nil
        uploadedAt = nil; shouldShare = nil; intentOnline = nil; uploadState = nil
        startedAtMs = Self.nowMs()
        lastSubmitMs = 0
        recording = true
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.distanceFilter = kCLDistanceFilterNone
        m.pausesLocationUpdatesAutomatically = false
        m.allowsBackgroundLocationUpdates = true
        m.showsBackgroundLocationIndicator = true
        m.startUpdatingLocation()
        // The 11Ship app waits for a first fix for up to two minutes; later a fix older than that is reported as a timeout.
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.watchdog() }
        state("Đang lấy vị trí qua GPS và mạng…", "ACQUIRING")
        done(nil)
    }

    func stop(_ reason: String) {
        let wasRecording = recording
        recording = false
        timer?.invalidate()
        timer = nil
        retryWork?.cancel()
        reporter.stop()
        manager?.stopUpdatingLocation()
        manager?.allowsBackgroundLocationUpdates = false
        lat = nil; lon = nil; accuracy = nil; fixTimeMs = nil; fixMonotonic = nil
        if wasRecording || status != reason { state(reason) } else { onChange?() }
    }

    private func watchdog() {
        guard recording else { return }
        let sinceStart = Double(Self.nowMs() - startedAtMs) / 1000
        let last = fixMonotonic.map { ProcessInfo.processInfo.systemUptime - $0 } ?? sinceStart
        if last > 120 && fixState != "TIMEOUT" { state("Hết thời gian chờ vị trí mới — sẽ thử lại ở chu kỳ tiếp theo", "TIMEOUT") }
    }

    // MARK: location updates

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard recording, let fix = locations.last, fix.horizontalAccuracy >= 0 else { return }
        let measured = Int64(fix.timestamp.timeIntervalSince1970 * 1000)
        lat = fix.coordinate.latitude
        lon = fix.coordinate.longitude
        accuracy = fix.horizontalAccuracy
        fixTimeMs = measured
        fixMonotonic = ProcessInfo.processInfo.systemUptime - max(0, -fix.timestamp.timeIntervalSinceNow)
        state("Đã lấy vị trí mới · sai số khoảng \(Int(fix.horizontalAccuracy)) m", "FIX")
        // About once a minute, like the Android cycle; the reporter drops anything invalid or older than the last sent.
        let now = Self.nowMs()
        if now - lastSubmitMs >= 55_000 {
            lastSubmitMs = now
            var simulated = false
            if #available(iOS 15.0, *) { simulated = fix.sourceInformation?.isSimulatedBySoftware ?? false }
            reporter.submit(Fix(lat: fix.coordinate.latitude, lon: fix.coordinate.longitude, accuracyM: fix.horizontalAccuracy, measuredAtMs: measured, simulated: simulated))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard recording else { return }
        if let e = error as? CLError, e.code == .denied { stop("Quyền vị trí đã bị thu hồi — hãy cấp lại quyền để tiếp tục"); return }
        if !CLLocationManager.locationServicesEnabled() { state("Định vị đang tắt — bật Vị trí trên điện thoại", "DISABLED") }
        else { state("Chưa lấy được vị trí từ GPS và mạng — sẽ thử lại") }
    }

    // MARK: server answers

    private func handle(_ outcome: ReportOutcome) {
        switch outcome {
        case .uploaded(let at, let share, let online):
            uploadedAt = at
            uploadState = "OK"
            shouldShare = share
            intentOnline = online
            onChange?()
        case .failed:
            uploadState = "FAILED"
            onChange?()
            retryWork?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.reporter.retryLatest() }
            retryWork = work
            main.asyncAfter(deadline: .now() + 10, execute: work)
        case .refused:
            uploadState = "REFUSED"
            onChange?()
        case .sessionEnded:
            uploadState = "SESSION_ENDED"
            stop("Phiên đăng nhập đã kết thúc — dừng chia sẻ vị trí")
        case .notNeeded:
            stop("Đã dừng chia sẻ vị trí — không còn đơn cần xử lý")
        }
    }
}

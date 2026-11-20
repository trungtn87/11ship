import Flutter
import FirebaseCore
import FirebaseMessaging
import UIKit
import UserNotifications

/// M08 push for iOS (n11_shared m08_push.dart), the counterpart of N11PushChannel.kt. Firebase Messaging delivers through APNs; the app is configured from
/// four client identifiers that prepare-ios.sh writes into Info.plist (N11_FCM_*; not secrets, they ship in every build). Without them the app answers
/// `supported:false` and says so. Dart binds the token to the signed-in session; nothing here talks to the server, and the message content is never logged.
/// A tap carries only the notification id, which Dart opens from the SERVER. In the foreground nothing is drawn (the live sync updates the screen).
final class N11Push: NSObject, FlutterPlugin, UNUserNotificationCenterDelegate, MessagingDelegate {
    static func register(with registrar: FlutterPluginRegistrar) {
        let instance = shared
        let channel = FlutterMethodChannel(name: "vn.eleven.n11/push", binaryMessenger: registrar.messenger())
        instance.channel = channel
        channel.setMethodCallHandler { call, result in instance.handle(call, result) }
        registrar.addApplicationDelegate(instance)
        if instance.configure() {
            Messaging.messaging().delegate = instance
            UNUserNotificationCenter.current().delegate = instance
        }
    }

    static let shared = N11Push()
    private var channel: FlutterMethodChannel?
    private var launchId: String?

    private func plist(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
    }

    /// True when the build carries the Firebase identifiers and the provider is up.
    private func configure() -> Bool {
        if FirebaseApp.app() != nil { return true }
        let appId = plist("N11_FCM_APP_ID"), sender = plist("N11_FCM_SENDER_ID"), project = plist("N11_FCM_PROJECT_ID"), key = plist("N11_FCM_API_KEY")
        if appId.isEmpty || sender.isEmpty || project.isEmpty || key.isEmpty { return false }
        let options = FirebaseOptions(googleAppID: appId, gcmSenderID: sender)
        options.apiKey = key
        options.projectID = project
        FirebaseApp.configure(options: options)
        return FirebaseApp.app() != nil
    }

    private func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
        guard configure() else {
            switch call.method {
            case "state": result(["supported": false, "permission": "unknown"])
            case "openSettings": N11Push.openSystemSettings(); result(nil)
            default: result(nil)
            }
            return
        }
        switch call.method {
        case "state": state(result)
        case "requestPermission": requestPermission(result)
        case "openSettings": N11Push.openSystemSettings(); result(nil)
        case "deleteToken": Messaging.messaging().deleteToken { _ in result(nil) }
        default: result(FlutterMethodNotImplemented)
        }
    }

    private static func openSystemSettings() {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        }
    }

    /// granted: notifications allowed; denied: the person said no; unknown: never asked.
    private func permission(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "unknown"
        }
    }

    private func state(_ result: @escaping FlutterResult) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let permission = self.permission(settings)
            if permission == "granted" {
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
            let launch = self.launchId
            self.launchId = nil
            Messaging.messaging().token { token, _ in
                var answer: [String: Any] = ["supported": true, "permission": permission]
                if let token = token { answer["token"] = token }
                if let launch = launch { answer["launch_notification_id"] = launch }
                DispatchQueue.main.async { result(answer) }
            }
        }
    }

    private func requestPermission(_ result: @escaping FlutterResult) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let permission = self.permission(settings)
                DispatchQueue.main.async { result(permission) }
            }
        }
    }

    // MARK: APNs and Firebase

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        if FirebaseApp.app() != nil { Messaging.messaging().apnsToken = deviceToken }
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else { return }
        DispatchQueue.main.async { self.channel?.invokeMethod("token", arguments: token) }
    }

    // MARK: Notifications

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        defer { completionHandler() }
        guard let id = response.notification.request.content.userInfo["notification_id"] as? String,
              id.range(of: "^[0-9a-fA-F-]{36}$", options: .regularExpression) != nil else { return }
        DispatchQueue.main.async {
            if let channel = self.channel { channel.invokeMethod("tap", arguments: id) } else { self.launchId = id }
        }
    }
}

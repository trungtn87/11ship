import Flutter
import UIKit

/// Registers only the offline map view (same view type as Android). No channel besides the per-view one, no permission, no position read here.
public class M14MapPlugin: NSObject, FlutterPlugin {
    public static func register(with registrar: FlutterPluginRegistrar) {
        registrar.register(M14MapFactory(messenger: registrar.messenger()), withId: "vn.eleven/m14/map")
    }
}

final class M14MapFactory: NSObject, FlutterPlatformViewFactory {
    private let messenger: FlutterBinaryMessenger
    init(messenger: FlutterBinaryMessenger) { self.messenger = messenger }

    func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol { FlutterStandardMessageCodec.sharedInstance() }

    func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
        M14MapView(frame: frame, viewId: viewId, messenger: messenger, initial: args as? [String: Any])
    }
}

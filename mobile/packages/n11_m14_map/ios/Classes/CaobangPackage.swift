import Foundation

/// The one place that finds the bundled Cao Bang package (folder `caobang`, with manifest.json). CocoaPods puts the podspec's resources into the
/// plugin's framework (Flutter's Podfile uses use_frameworks!), not into Bundle.main, so every reader asks here instead of Bundle.main.
enum CaobangPackage {
    private static let folderName = "caobang"
    private static let manifestName = "manifest.json"

    /// The `caobang` folder of the first loaded bundle that holds manifest.json, or nil when no bundle carries the package.
    static let root: URL? = {
        for bundle in candidateBundles() {
            guard let resources = bundle.resourceURL else { continue }
            let dir = resources.appendingPathComponent(folderName, isDirectory: true)
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent(manifestName).path) { return dir }
        }
        return nil
    }()

    /// The plugin's own bundle first (framework build), then the app bundle (static build), then every other loaded bundle.
    private static func candidateBundles() -> [Bundle] {
        var seen = Set<String>()
        var out: [Bundle] = []
        for bundle in [Bundle(for: OfflineMap.self), Bundle.main] + Bundle.allFrameworks + Bundle.allBundles where seen.insert(bundle.bundlePath).inserted {
            out.append(bundle)
        }
        return out
    }
}

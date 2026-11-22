import CryptoKit
import Foundation

struct MapLabel {
    let latitude: Double
    let longitude: Double
    let text: String
    let minZoom: Double
    let priority: Int
}

enum OfflineMapError: Error { case missing, corrupt(String) }

/// The bundled Cao Bang package (folder `caobang` in the app bundle: manifest.json, style.json, map.geojson, fonts). GeoJSON is a native MapLibre
/// source: no tile server, no network. The package is checked against its manifest once per process and the 8 MB file is parsed once (#299).
final class OfflineMap {
    static let shared = OfflineMap()
    private let lock = NSLock()
    private var verified = false
    private var cachedLabels: [MapLabel]?
    private var cachedStyle: URL?

    private var root: URL? {
        CaobangPackage.root
    }

    private lazy var manifest: [String: Any]? = {
        guard let root = root, let data = try? Data(contentsOf: root.appendingPathComponent("manifest.json")) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }()

    func contains(lat: Double, lon: Double) -> Bool {
        guard let b = manifest?["bounds"] as? [Double], b.count == 4 else { return false }
        return lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3]
    }

    func verify() throws {
        lock.lock(); defer { lock.unlock() }
        if verified { return }
        guard let root = root, let files = manifest?["sha256"] as? [String: String] else { throw OfflineMapError.missing }
        for (name, expected) in files {
            guard let handle = try? FileHandle(forReadingFrom: root.appendingPathComponent(name)) else { throw OfflineMapError.corrupt(name) }
            defer { try? handle.close() }
            var hasher = SHA256()
            while let chunk = try? handle.read(upToCount: 65536), !chunk.isEmpty { hasher.update(data: chunk) }
            let actual = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            if actual != expected { throw OfflineMapError.corrupt(name) }
        }
        verified = true
    }

    /// The style with its asset URLs turned into file URLs of the bundled package, written once to the caches folder.
    func styleURL() throws -> URL {
        lock.lock(); defer { lock.unlock() }
        if let cachedStyle = cachedStyle { return cachedStyle }
        guard let root = root, var text = try? String(contentsOf: root.appendingPathComponent("style.json"), encoding: .utf8) else { throw OfflineMapError.missing }
        var base = root.absoluteString
        if !base.hasSuffix("/") { base += "/" }
        text = text.replacingOccurrences(of: "asset://caobang/", with: base)
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let out = dir.appendingPathComponent("n11-caobang-style.json")
        try text.write(to: out, atomically: true, encoding: .utf8)
        cachedStyle = out
        return out
    }

    func labels() throws -> [MapLabel] {
        lock.lock(); defer { lock.unlock() }
        if let cachedLabels = cachedLabels { return cachedLabels }
        guard let root = root, let data = try? Data(contentsOf: root.appendingPathComponent("map.geojson")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let features = json["features"] as? [[String: Any]] else { throw OfflineMapError.missing }
        var out: [MapLabel] = []
        for f in features {
            guard let p = f["properties"] as? [String: Any], let g = f["geometry"] as? [String: Any], let type = g["type"] as? String else { continue }
            let vi = (p["name:vi"] as? String) ?? ""
            let name = vi.trimmingCharacters(in: .whitespaces).isEmpty ? ((p["name"] as? String) ?? "") : vi
            if name.trimmingCharacters(in: .whitespaces).isEmpty { continue }
            let kind = (p["kind"] as? String) ?? ""
            if kind == "place", type == "Point", let c = g["coordinates"] as? [Double], c.count >= 2 {
                let place = (p["place"] as? String) ?? ""
                let priority = (place == "city" || place == "town") ? 0 : 1
                let zoom: Double = (priority == 0 || place == "state") ? 0 : (place == "village" ? 12 : 14)
                out.append(MapLabel(latitude: c[1], longitude: c[0], text: name, minZoom: zoom, priority: priority))
            } else if kind == "road", type == "LineString", let line = g["coordinates"] as? [[Double]], !line.isEmpty {
                let mid = line[line.count / 2]
                if mid.count >= 2 { out.append(MapLabel(latitude: mid[1], longitude: mid[0], text: name, minZoom: 14, priority: 3)) }
            } else if kind == "poi", type == "Point", let c = g["coordinates"] as? [Double], c.count >= 2 {
                out.append(MapLabel(latitude: c[1], longitude: c[0], text: name, minZoom: 15, priority: 2))
            }
        }
        out.sort { $0.priority < $1.priority }
        cachedLabels = out
        return out
    }
}

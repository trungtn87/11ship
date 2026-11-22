import CoreText
import Flutter
import MapLibre
import UIKit

struct MapPin {
    let latitude: Double
    let longitude: Double
    let label: String
    let color: UIColor
}

private func color(_ value: Any?, fallback: UIColor? = nil) -> UIColor? {
    guard let n = value as? NSNumber else { return fallback }
    let v = UInt32(truncatingIfNeeded: n.intValue)
    return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: CGFloat((v >> 24) & 0xFF) / 255)
}

/// Each shape carries its own look, like the Android PolylineOptions/PolygonOptions (kept beside the map, keyed by the shape).
struct ShapeLook {
    var stroke = UIColor.blue
    var fill = UIColor.clear
    var width: CGFloat = 4
}

/// Native overlay: pins and place names are drawn with the bundled font, independent of any glyph loading (as MapPinsView.kt).
final class MapPinsView: UIView {
    weak var map: MLNMapView?
    var labels: [MapLabel] = [] { didSet { setNeedsDisplay() } }
    var pins: [MapPin] = [] { didSet { setNeedsDisplay() } }
    private var fontName: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
        if let url = CaobangPackage.root?.appendingPathComponent("fonts/NotoSans-Regular.ttf") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            if let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let first = descriptors.first {
                fontName = CTFontDescriptorCopyAttribute(first, kCTFontNameAttribute) as? String
            }
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func draw(_ rect: CGRect) {
        guard let map = map, let ctx = UIGraphicsGetCurrentContext() else { return }
        let zoom = Double(map.zoomLevel)
        let visible = map.visibleCoordinateBounds
        var occupied: [CGRect] = []
        for label in labels {
            if zoom < label.minZoom { continue }
            let c = CLLocationCoordinate2D(latitude: label.latitude, longitude: label.longitude)
            if c.latitude < visible.sw.latitude || c.latitude > visible.ne.latitude || c.longitude < visible.sw.longitude || c.longitude > visible.ne.longitude { continue }
            let p = map.convert(c, toPointTo: self)
            let size: CGFloat = label.priority == 0 ? 15 : 11
            let font = fontName.flatMap { UIFont(name: $0, size: size) } ?? UIFont.systemFont(ofSize: size)
            let attrs: [NSAttributedString.Key: Any] = [.font: font]
            let text = label.text as NSString
            let measured = text.size(withAttributes: attrs)
            let box = CGRect(x: p.x - measured.width / 2 - 4, y: p.y - measured.height - 4 + 4, width: measured.width + 8, height: measured.height + 8)
            if box.minX < 0 || box.maxX > bounds.width || box.minY < 0 || box.maxY > bounds.height || occupied.contains(where: { $0.intersects(box) }) { continue }
            occupied.append(box)
            let origin = CGPoint(x: p.x - measured.width / 2, y: p.y - measured.height)
            text.draw(at: origin, withAttributes: [.font: font, .strokeColor: UIColor.white, .strokeWidth: 6.0, .foregroundColor: UIColor.white])
            text.draw(at: origin, withAttributes: [.font: font, .foregroundColor: UIColor(red: 38 / 255, green: 60 / 255, blue: 70 / 255, alpha: 1)])
        }
        for pin in pins {
            let p = map.convert(CLLocationCoordinate2D(latitude: pin.latitude, longitude: pin.longitude), toPointTo: self)
            if p.x < -50 || p.x > bounds.width + 50 || p.y < -50 || p.y > bounds.height + 50 { continue }
            let r: CGFloat = 17
            let cy = p.y - 22
            ctx.setFillColor(pin.color.cgColor)
            ctx.beginPath()
            ctx.move(to: p)
            ctx.addLine(to: CGPoint(x: p.x - 9, y: cy + 8))
            ctx.addLine(to: CGPoint(x: p.x + 9, y: cy + 8))
            ctx.closePath()
            ctx.fillPath()
            ctx.fillEllipse(in: CGRect(x: p.x - r, y: cy - r, width: 2 * r, height: 2 * r))
            ctx.setStrokeColor(UIColor.white.cgColor)
            ctx.setLineWidth(2)
            ctx.strokeEllipse(in: CGRect(x: p.x - r, y: cy - r, width: 2 * r, height: 2 * r))
            let font = UIFont.boldSystemFont(ofSize: pin.label == "GPS" ? 10 : 15)
            let text = pin.label as NSString
            let measured = text.size(withAttributes: [.font: font])
            text.draw(at: CGPoint(x: p.x - measured.width / 2, y: cy - measured.height / 2), withAttributes: [.font: font, .foregroundColor: UIColor.white])
        }
    }
}

/// The iOS counterpart of M14MapView (M14MapFactory.kt): same per-view channel "vn.eleven/m14/map/<id>" and the same messages
/// (update/state from Dart; ready/error/point to Dart).
final class M14MapView: NSObject, FlutterPlatformView, MLNMapViewDelegate, UIGestureRecognizerDelegate {
    private static let loader = DispatchQueue(label: "m14-map-load", qos: .userInitiated)

    private let container: UIView
    private var looks: [ObjectIdentifier: ShapeLook] = [:]
    private let channel: FlutterMethodChannel
    private let mapView: MLNMapView
    private let pinsView: MapPinsView
    private let coverage = UILabel()
    private let attribution = UILabel()
    private var data: [String: Any]?
    private var focusedPoint: (Double, Double)?
    private var ready = false
    private var loadError: String?
    private var centerRequest = 0
    private var initialCameraApplied = false
    private var userMoved = false
    private var disposed = false
    private var labelsLoaded = false

    init(frame: CGRect, viewId: Int64, messenger: FlutterBinaryMessenger, initial: [String: Any]?) {
        self.container = UIView(frame: frame)
        self.channel = FlutterMethodChannel(name: "vn.eleven/m14/map/\(viewId)", binaryMessenger: messenger)
        self.mapView = MLNMapView(frame: frame)
        self.pinsView = MapPinsView(frame: frame)
        self.data = initial
        super.init()

        self.container.accessibilityLabel = "Đang mở bản đồ offline Cao Bằng"
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.delegate = self
        mapView.logoView.isHidden = true
        mapView.attributionButton.isHidden = true
        mapView.setCenter(CLLocationCoordinate2D(latitude: 22.665, longitude: 106.257), zoomLevel: 12, animated: false)
        pinsView.map = mapView
        pinsView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.container.addSubview(mapView)
        self.container.addSubview(pinsView)

        attribution.text = " © OpenStreetMap contributors · ODbL 1.0 "
        attribution.font = UIFont.systemFont(ofSize: 10)
        attribution.textColor = .darkGray
        attribution.backgroundColor = UIColor(white: 1, alpha: 0.87)
        attribution.translatesAutoresizingMaskIntoConstraints = false
        self.container.addSubview(attribution)
        coverage.text = "  Ngoài vùng bản đồ Cao Bằng  "
        coverage.textColor = .black
        coverage.backgroundColor = UIColor(red: 1, green: 0.878, blue: 0.698, alpha: 1)
        coverage.font = UIFont.systemFont(ofSize: 13)
        coverage.isHidden = true
        coverage.translatesAutoresizingMaskIntoConstraints = false
        self.container.addSubview(coverage)
        NSLayoutConstraint.activate([
            attribution.trailingAnchor.constraint(equalTo: self.container.trailingAnchor),
            attribution.bottomAnchor.constraint(equalTo: self.container.bottomAnchor),
            coverage.centerXAnchor.constraint(equalTo: self.container.centerXAnchor),
            coverage.topAnchor.constraint(equalTo: self.container.topAnchor),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.delegate = self
        mapView.addGestureRecognizer(tap)
        let press = UILongPressGestureRecognizer(target: self, action: #selector(tapped(_:)))
        press.delegate = self
        mapView.addGestureRecognizer(press)

        channel.setMethodCallHandler { [weak self] call, result in
            guard let self = self else { result(nil); return }
            switch call.method {
            case "update":
                self.data = call.arguments as? [String: Any]
                self.draw()
                result(nil)
            case "state":
                result(["ready": self.ready, "error": self.loadError as Any])
            default:
                result(FlutterMethodNotImplemented)
            }
        }

        M14MapView.loader.async { [weak self] in
            do {
                let offline = OfflineMap.shared
                try offline.verify()
                let labels = try offline.labels()
                let style = try offline.styleURL()
                DispatchQueue.main.async {
                    guard let self = self, !self.disposed else { return }
                    self.pinsView.labels = labels
                    self.labelsLoaded = true
                    self.mapView.styleURL = style
                }
            } catch {
                DispatchQueue.main.async { self?.fail("Không mở được gói bản đồ Cao Bằng. Thử lại hoặc cập nhật ứng dụng có bản đồ offline.") }
            }
        }
    }

    func view() -> UIView { container }

    deinit { disposed = true; channel.setMethodCallHandler(nil) }

    private func fail(_ message: String) {
        if disposed { return }
        ready = false
        loadError = message
        container.accessibilityLabel = message
        channel.invokeMethod("error", arguments: message)
    }

    // MARK: map delegate

    func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
        if disposed { return }
        ready = true
        container.accessibilityLabel = "Bản đồ offline Cao Bằng đã hiển thị"
        draw()
        channel.invokeMethod("ready", arguments: nil)
    }

    func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
        fail("Không tải được bản đồ Cao Bằng. Thử lại hoặc cập nhật ứng dụng.")
    }

    func mapView(_ mapView: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool) {
        if !reason.isDisjoint(with: [.gesturePan, .gesturePinch, .gestureZoomIn, .gestureZoomOut, .gestureOneFingerZoom]) { userMoved = true }
    }

    func mapViewRegionIsChanging(_ mapView: MLNMapView) { pinsView.setNeedsDisplay() }

    func mapView(_ mapView: MLNMapView, regionDidChangeWith reason: MLNCameraChangeReason, animated: Bool) {
        pinsView.setNeedsDisplay()
        let c = mapView.centerCoordinate
        coverage.isHidden = OfflineMap.shared.contains(lat: c.latitude, lon: c.longitude)
    }

    func mapView(_ mapView: MLNMapView, strokeColorForShapeAnnotation annotation: MLNShape) -> UIColor {
        looks[ObjectIdentifier(annotation)]?.stroke ?? .blue
    }

    func mapView(_ mapView: MLNMapView, fillColorForPolygonAnnotation annotation: MLNPolygon) -> UIColor {
        looks[ObjectIdentifier(annotation)]?.fill ?? .clear
    }

    func mapView(_ mapView: MLNMapView, lineWidthForPolylineAnnotation annotation: MLNPolyline) -> CGFloat {
        looks[ObjectIdentifier(annotation)]?.width ?? 4
    }

    func mapView(_ mapView: MLNMapView, alphaForShapeAnnotation annotation: MLNShape) -> CGFloat { 1 }

    // MARK: taps (select_points)

    @objc private func tapped(_ gesture: UIGestureRecognizer) {
        if gesture is UILongPressGestureRecognizer && gesture.state != .began { return }
        if gesture is UITapGestureRecognizer && gesture.state != .ended { return }
        guard ready, (data?["select_points"] as? Bool) == true else { return }
        let point = gesture.location(in: mapView)
        let c = mapView.convert(point, toCoordinateFrom: mapView)
        channel.invokeMethod("point", arguments: ["lat": c.latitude, "lon": c.longitude, "inside": OfflineMap.shared.contains(lat: c.latitude, lon: c.longitude)])
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    // MARK: drawing

    private struct RadiusCircle {
        let lat: Double
        let lon: Double
        let radiusM: Double
        let color: UIColor
        let fill: UIColor?
        let outside: UIColor?
    }

    private func radiusCircle() -> RadiusCircle? {
        guard let c = data?["radius_circle"] as? [String: Any] else { return nil }
        let lat = (c["lat"] as? NSNumber)?.doubleValue
        let lon = (c["lon"] as? NSNumber)?.doubleValue
        let radius = (c["radius_m"] as? NSNumber)?.doubleValue
        guard RadiusGeometry.isUsableCentre(lat, lon), let r = radius, r.isFinite, r > 0 else { return nil }
        return RadiusCircle(lat: lat!, lon: lon!, radiusM: r, color: color(c["color"]) ?? .blue, fill: color(c["fill_color"]), outside: color(c["outside_color"]))
    }

    private func coords(_ points: [(Double, Double)]) -> [CLLocationCoordinate2D] {
        points.map { CLLocationCoordinate2D(latitude: $0.0, longitude: $0.1) }
    }

    private func draw() {
        if disposed || !ready { return }
        var newPins: [MapPin] = []
        for item in (data?["pins"] as? [Any]) ?? [] {
            guard let p = item as? [String: Any], let lat = (p["lat"] as? NSNumber)?.doubleValue, let lon = (p["lon"] as? NSNumber)?.doubleValue, lat.isFinite, lon.isFinite else { continue }
            newPins.append(MapPin(latitude: lat, longitude: lon, label: (p["label"] as? String) ?? "", color: color(p["color"]) ?? .blue))
        }
        pinsView.pins = newPins
        var route: [CLLocationCoordinate2D] = []
        for item in (data?["route"] as? [Any]) ?? [] {
            guard let p = item as? [Any], p.count >= 2, let lat = (p[0] as? NSNumber)?.doubleValue, let lon = (p[1] as? NSNumber)?.doubleValue, lat.isFinite, lon.isFinite else { continue }
            route.append(CLLocationCoordinate2D(latitude: lat, longitude: lon))
        }
        let circle = radiusCircle()
        let defaultRadius = 5000.0

        if !initialCameraApplied {
            let important = newPins.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) } + route
            if !important.isEmpty {
                if !userMoved { fitImportant(important, circle?.radiusM ?? defaultRadius) }
                initialCameraApplied = true
            }
        }
        if (data?["focus_pin"] as? Bool) == true, let pin = newPins.first {
            let point = (pin.latitude, pin.longitude)
            if focusedPoint == nil || focusedPoint! != point {
                let first = focusedPoint == nil
                focusedPoint = point
                let centre = CLLocationCoordinate2D(latitude: pin.latitude, longitude: pin.longitude)
                if first && !initialCameraApplied { fitRadius(centre, circle?.radiusM ?? defaultRadius) } else { mapView.setCenter(centre, animated: false) }
            }
        }
        let requested = (data?["center_request"] as? NSNumber)?.intValue ?? 0
        if requested != centerRequest {
            centerRequest = requested
            let centre = circle.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) } ?? newPins.first.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            if let centre = centre { fitRadius(centre, circle?.radiusM ?? defaultRadius); userMoved = false }
        }

        if let existing = mapView.annotations { mapView.removeAnnotations(existing) }
        looks.removeAll()
        var shapes: [MLNShape] = []
        if route.count > 1 {
            let line = MLNPolyline(coordinates: route, count: UInt(route.count))
            looks[ObjectIdentifier(line)] = ShapeLook(stroke: UIColor(red: 25 / 255, green: 110 / 255, blue: 230 / 255, alpha: 1), width: 5)
            shapes.append(line)
        }
        if let c = circle {
            let ring = coords(RadiusGeometry.ring(lat: c.lat, lon: c.lon, radiusM: c.radiusM))
            if let outside = c.outside {
                let hole = MLNPolygon(coordinates: ring, count: UInt(ring.count))
                let world = coords(RadiusGeometry.worldRing)
                let shape = MLNPolygon(coordinates: world, count: UInt(world.count), interiorPolygons: [hole])
                looks[ObjectIdentifier(shape)] = ShapeLook(stroke: .clear, fill: outside)
                shapes.append(shape)
            }
            if let fill = c.fill {
                let shape = MLNPolygon(coordinates: ring, count: UInt(ring.count))
                looks[ObjectIdentifier(shape)] = ShapeLook(stroke: .clear, fill: fill)
                shapes.append(shape)
            }
            let edge = MLNPolyline(coordinates: ring, count: UInt(ring.count))
            looks[ObjectIdentifier(edge)] = ShapeLook(stroke: c.color, width: 3.5)
            shapes.append(edge)
        }
        if !shapes.isEmpty { mapView.addAnnotations(shapes) }
        pinsView.setNeedsDisplay()
    }

    private func fitImportant(_ points: [CLLocationCoordinate2D], _ radiusM: Double) {
        guard let first = points.first else { return }
        if points.count == 1 || points.allSatisfy({ $0.latitude == first.latitude && $0.longitude == first.longitude }) {
            fitRadius(first, radiusM)
            return
        }
        var south = first.latitude, north = first.latitude, west = first.longitude, east = first.longitude
        for p in points {
            south = min(south, p.latitude); north = max(north, p.latitude)
            west = min(west, p.longitude); east = max(east, p.longitude)
        }
        let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: south, longitude: west), ne: CLLocationCoordinate2D(latitude: north, longitude: east))
        mapView.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 64, left: 64, bottom: 64, right: 64), animated: false)
    }

    /// Fit the whole circle plus 24 points on every side, independent of screen density and aspect ratio.
    private func fitRadius(_ center: CLLocationCoordinate2D, _ radiusM: Double) {
        let b = RadiusGeometry.bounds(lat: center.latitude, lon: center.longitude, radiusM: radiusM)
        let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: b.0, longitude: b.1), ne: CLLocationCoordinate2D(latitude: b.2, longitude: b.3))
        mapView.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 24, left: 24, bottom: 24, right: 24), animated: false)
    }
}

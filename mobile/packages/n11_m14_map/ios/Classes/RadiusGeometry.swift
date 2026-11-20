import Foundation

/// Pure geometry for the receiving-area circle: the same sphere and the same maths as RadiusGeometry.kt and the backend rule.
enum RadiusGeometry {
    static let earthRadiusM = 6_371_008.8
    static let ringSteps = 360

    static func destination(lat: Double, lon: Double, distanceM: Double, bearingRad: Double) -> (Double, Double) {
        let angular = distanceM / earthRadiusM
        let lat1 = lat * .pi / 180
        let lon1 = lon * .pi / 180
        let lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearingRad))
        let lon2 = lon1 + atan2(sin(bearingRad) * sin(angular) * cos(lat1), cos(angular) - sin(lat1) * sin(lat2))
        return (lat2 * 180 / .pi, lon2 * 180 / .pi)
    }

    /// A closed ring (first point repeated last) of (lat, lon), starting north and going clockwise.
    static func ring(lat: Double, lon: Double, radiusM: Double) -> [(Double, Double)] {
        (0...ringSteps).map { destination(lat: lat, lon: lon, distanceM: radiusM, bearingRad: 2.0 * .pi * Double($0 % ringSteps) / Double(ringSteps)) }
    }

    static let worldRing: [(Double, Double)] = [(-85, -180), (85, -180), (85, 180), (-85, 180), (-85, -180)]

    /// [south, west, north, east] of the smallest lat/lon box holding the circle.
    static func bounds(lat: Double, lon: Double, radiusM: Double) -> (Double, Double, Double, Double) {
        let angular = radiusM / earthRadiusM
        let latDelta = angular * 180 / .pi
        let c = max(cos(lat * .pi / 180), 1e-6)
        let lonDelta = asin(min(1.0, sin(angular) / c)) * 180 / .pi
        return (lat - latDelta, lon - lonDelta, lat + latDelta, lon + lonDelta)
    }

    static func isUsableCentre(_ lat: Double?, _ lon: Double?) -> Bool {
        guard let lat = lat, let lon = lon else { return false }
        return lat.isFinite && lon.isFinite && (-90.0...90.0).contains(lat) && (-180.0...180.0).contains(lon) && !(lat == 0 && lon == 0)
    }
}

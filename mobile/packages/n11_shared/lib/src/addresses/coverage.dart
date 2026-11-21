// Cao Bằng map coverage `[minLon, minLat, maxLon, maxLat]`: the same bounds as the offline map package (caobang/manifest.json).
// A point outside it cannot be drawn or routed on the offline map, so a shared address pin refuses it (#387, #402).
const List<double> kCaoBangBounds = <double>[106.0, 22.43, 106.52, 22.91];

bool insideCaoBang(double lat, double lng) =>
    lat.isFinite &&
    lng.isFinite &&
    lng >= kCaoBangBounds[0] &&
    lat >= kCaoBangBounds[1] &&
    lng <= kCaoBangBounds[2] &&
    lat <= kCaoBangBounds[3];

const String kOutsideCoverageMessage =
    'Vị trí nằm ngoài vùng bản đồ Cao Bằng. Hãy chọn điểm khác trên bản đồ hoặc nhập địa chỉ chữ.';

import 'package:flutter/material.dart';
import 'package:n11_m14_map/n11_m14_map.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Food side of M14: the offline Cao Bằng map to pin a drop-off point and to see the pickup, the drop-off and the Shipper's LATEST position. It uses the
// map-only package: no GPS recorder, no foreground service, no routing. The "Gọi ship" picker may take ONE foreground fix when the customer presses
// "Vị trí hiện tại" (#387); it only moves the preview pin, and nothing is saved until "Xác nhận vị trí". The build sets M14_OFFLINE_MAP only when the
// Cao Bằng package is inside the APK, so a screen never opens a map that cannot load; without the flag these builders are null and the screens say the
// points in words (nothing is faked).

Map<String, dynamic> _pin(double lat, double lng, String label, int color) => <String, dynamic>{'lat': lat, 'lon': lng, 'label': label, 'color': color};

/// Pickup, drop-off and the latest Shipper position (only what the screen was given, so an ended order draws no live position).
M07MapBuilder? foodMapBuilder() => kM14MapEnabled
    ? (BuildContext context, List<M07MapPin> pins, [List<List<double>> route = const <List<double>>[]]) => M14OfflineMap(pins: <Map<String, dynamic>>[for (final M07MapPin p in pins) _pin(p.lat, p.lng, p.label, p.color)], route: route)
    : null;

/// Embedded picker (checkout address screen): a tap inside the covered area picks the point; a tap outside is ignored. "Gọi ship" uses [foodPinPickScreen].
M07PinPickerBuilder? foodPinPicker() => kM14MapEnabled
    ? (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng, String? label}) => M14OfflineMap(
          focusPin: true,
          pins: <Map<String, dynamic>>[if (lat != null && lng != null) _pin(lat, lng, 'Điểm giao', 0xFFC0392B)],
          onPoint: (double la, double lo, bool inside) {
            if (inside) {
              onPick(la, lo);
            }
          },
        )
    : null;

/// Full-screen picker for "Gọi ship" pickup / drop-off (#321, #387): AppBar with Back, a tap only moves the pin, and only "Xác nhận vị trí" calls [onPick].
/// The caller's [onPick] closes the screen (same contract as before); Back and a tap outside the covered area never change the caller's value.
M07PinPickerBuilder? foodPinPickScreen() => kM14MapEnabled
    ? (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng, String? label}) =>
          FoodPinPickScreen(title: label ?? 'Ghim vị trí', initialLat: lat, initialLng: lng, onPick: onPick)
    : null;

/// Builds the map for [FoodPinPickScreen]; injectable so widget tests can drive taps without the native view.
typedef FoodPinMapBuilder = Widget Function(
  BuildContext context,
  List<Map<String, dynamic>> pins,
  void Function(double lat, double lng, bool inside) onPoint,
  void Function(String error) onError,
);

/// Cao Bằng coverage, `[minLon, minLat, maxLon, maxLat]` — the same bounds as `caobang/manifest.json` in the map package. A GPS fix outside it cannot be
/// shown on this map, so it is refused instead of being pinned where the map cannot draw it.
const List<double> _caoBangBounds = <double>[106.0, 22.43, 106.52, 22.91];

bool _validPoint(double? lat, double? lng) =>
    lat != null && lng != null && lat.isFinite && lng.isFinite && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

bool _insideCaoBang(double lat, double lng) =>
    _validPoint(lat, lng) && lng >= _caoBangBounds[0] && lat >= _caoBangBounds[1] && lng <= _caoBangBounds[2] && lat <= _caoBangBounds[3];

String _locationMessage(LocationFailure failure) => switch (failure) {
      LocationFailure.denied => 'Chưa được cấp quyền vị trí. Hãy cho phép trong cài đặt ứng dụng, hoặc chạm bản đồ để chọn.',
      LocationFailure.disabled => 'Hãy bật định vị trên điện thoại rồi thử lại, hoặc chạm bản đồ để chọn.',
      LocationFailure.timeout => 'Chưa lấy được vị trí. Hãy thử lại ở nơi thoáng hơn, hoặc chạm bản đồ để chọn.',
      LocationFailure.unavailable => 'Điện thoại chưa cung cấp vị trí hợp lệ. Hãy thử lại, hoặc chạm bản đồ để chọn.',
    };

class FoodPinPickScreen extends StatefulWidget {
  const FoodPinPickScreen({super.key, required this.title, required this.onPick, this.initialLat, this.initialLng, this.mapBuilder, this.location});
  final String title;
  final double? initialLat;
  final double? initialLng;
  final void Function(double lat, double lng) onPick;
  final FoodPinMapBuilder? mapBuilder;
  /// One-shot fix for "Vị trí hiện tại"; null = the app's real [MethodChannelLocationProvider]. Tests inject a fake.
  final LocationProvider? location;
  @override
  State<FoodPinPickScreen> createState() => _FoodPinPickScreenState();
}

class _FoodPinPickScreenState extends State<FoodPinPickScreen> {
  double? _lat;
  double? _lng;
  String? _error;
  String? _locateError;
  bool _locating = false;
  bool _done = false;
  // Bumped by every point the person picks on the map; a fix that arrives after such a tap is dropped, so it never replaces the newer choice.
  int _pointRevision = 0;
  // One map instance: rebuilt only when the pin changes, so the native view is updated, never recreated (#299).
  Widget? _map;
  Object? _mapKey;

  @override
  void initState() {
    super.initState();
    if (_validPoint(widget.initialLat, widget.initialLng)) {
      _lat = widget.initialLat;
      _lng = widget.initialLng;
    }
  }

  bool get _hasPoint => _validPoint(_lat, _lng);

  void _onPoint(double lat, double lng, bool inside) {
    if (!mounted || _done) return;
    if (!inside || !_validPoint(lat, lng)) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Vị trí nằm ngoài vùng bản đồ hỗ trợ. Vui lòng chọn điểm khác.')));
      return;
    }
    _pointRevision++;
    setState(() {
      _lat = lat;
      _lng = lng;
      _locateError = null;
    });
  }

  /// One foreground fix on the person's press. It only moves the preview pin (the map follows it); nothing is saved until "Xác nhận vị trí".
  /// A refused or failed fix shows its reason and changes nothing; the map stays usable for a manual tap. No position is estimated from the map centre.
  Future<void> _locateCurrent() async {
    if (_locating || _done) return;
    setState(() {
      _locating = true;
      _locateError = null;
    });
    final int revision = _pointRevision;
    try {
      final LocationFix fix = await (widget.location ?? MethodChannelLocationProvider()).currentFix();
      if (!mounted || _done || revision != _pointRevision) return;
      if (!_insideCaoBang(fix.latitude, fix.longitude)) {
        setState(() => _locateError = 'Vị trí hiện tại nằm ngoài vùng bản đồ Cao Bằng. Hãy chạm bản đồ để chọn.');
        return;
      }
      _pointRevision++;
      setState(() {
        _lat = fix.latitude;
        _lng = fix.longitude;
      });
    } on LocationException catch (error) {
      if (!mounted || _done || revision != _pointRevision) return;
      setState(() => _locateError = _locationMessage(error.failure));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _confirm() {
    if (_done || !_hasPoint) return;
    _done = true;
    widget.onPick(_lat!, _lng!);
  }

  Widget _buildMap(BuildContext context) {
    final Object key = (_lat, _lng);
    if (_map != null && _mapKey == key) return _map!;
    _mapKey = key;
    final List<Map<String, dynamic>> pins = <Map<String, dynamic>>[
      if (_hasPoint) _pin(_lat!, _lng!, widget.title, 0xFFC0392B),
    ];
    void onError(String e) {
      if (mounted) setState(() => _error = e);
    }

    return _map = widget.mapBuilder != null
        ? widget.mapBuilder!(context, pins, _onPoint, onError)
        : M14OfflineMap(focusPin: true, pins: pins, onPoint: _onPoint, onError: onError);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      resizeToAvoidBottomInset: false,
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: <Widget>[
          Container(
            width: double.infinity,
            color: theme.colorScheme.surfaceContainerHighest,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Text(_hasPoint ? 'Chạm bản đồ để đặt ghim · chạm lần nữa để dời ghim' : 'Chạm bản đồ để đặt ghim', key: const Key('pin-instruction')),
          ),
          Expanded(
            child: Stack(
              children: <Widget>[
                Positioned.fill(child: _buildMap(context)),
                if (!_hasPoint)
                  IgnorePointer(
                    child: Center(child: Icon(Icons.place, key: const Key('pin-hint'), size: 48, color: theme.colorScheme.error.withValues(alpha: 0.7))),
                  ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  if (_error != null)
                    Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(_error!, key: const Key('pin-error'), style: TextStyle(color: theme.colorScheme.error))),
                  if (_locateError != null)
                    Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(_locateError!, key: const Key('locate-error'), style: TextStyle(color: theme.colorScheme.error))),
                  OutlinedButton.icon(
                    key: const Key('pin-current-location'),
                    onPressed: _locating || _done ? null : _locateCurrent,
                    icon: const Icon(Icons.my_location),
                    label: Text(_locating ? 'Đang lấy vị trí…' : 'Vị trí hiện tại'),
                  ),
                  const SizedBox(height: 8),
                  Text(_hasPoint ? 'Đã chọn: ${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}' : 'Chưa chọn vị trí', key: const Key('pin-preview')),
                  const SizedBox(height: 8),
                  FilledButton(key: const Key('pin-confirm'), onPressed: _hasPoint ? _confirm : null, child: const Text('Xác nhận vị trí')),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

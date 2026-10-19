import 'package:flutter/material.dart';
import 'package:n11_m14_map/n11_m14_map.dart';

import '../account/session_controller.dart';
import '../flows/location.dart';
import '../tokens.dart';

/// Address text and its explicitly selected point are returned together, only on Save.
class AddressLocation {
  const AddressLocation(this.text, {this.latitude, this.longitude});
  final String text;
  final double? latitude;
  final double? longitude;
}

typedef AddressMapBuilder = Widget Function(
  BuildContext context,
  double? latitude,
  double? longitude,
  void Function(double latitude, double longitude) onPick,
);

/// The profile/checkout shows just this row. GPS and the map live in the editor.
class AddressLocationField extends StatelessWidget {
  const AddressLocationField({
    super.key,
    required this.label,
    required this.text,
    required this.onTap,
    this.error,
  });
  final String label;
  final String text;
  final VoidCallback? onTap;
  final String? error;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text(label, style: N11Text.label),
      const SizedBox(height: 8),
      Material(
        color: N11Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusControl),
          side: BorderSide(
            color: error == null ? N11Colors.line : N11Colors.error,
          ),
        ),
        child: ListTile(
          leading: const Icon(Icons.location_on_outlined),
          title: Text(text.trim().isEmpty ? 'Chọn địa chỉ' : text),
          trailing: onTap == null ? null : const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
      ),
      if (error != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(error!, style: const TextStyle(color: N11Colors.error)),
        ),
    ],
  );
}

class AddressLocationPicker extends StatefulWidget {
  const AddressLocationPicker({
    super.key,
    required this.initial,
    this.location,
    this.session,
    this.maxLength = 300,
    this.requirePoint = true,
    this.mapBuilder,
  });
  final AddressLocation initial;
  final LocationProvider? location;
  final SessionController? session;
  final int maxLength;

  /// Shop drafts may still be saved before a point has been chosen.
  final bool requirePoint;
  final AddressMapBuilder? mapBuilder;

  @override
  State<AddressLocationPicker> createState() => _AddressLocationPickerState();
}

class _AddressLocationPickerState extends State<AddressLocationPicker> {
  late final TextEditingController _text;
  double? _lat;
  double? _lng;
  bool _locating = false;
  String? _error;
  late final int? _sessionEpoch;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: widget.initial.text);
    _lat = widget.initial.latitude;
    _lng = widget.initial.longitude;
    _sessionEpoch = widget.session?.sessionEpoch;
    widget.session?.addListener(_sessionChanged);
  }

  bool get _sessionValid =>
      widget.session == null ||
      (widget.session!.status == SessionStatus.signedIn &&
          widget.session!.sessionEpoch == _sessionEpoch);

  void _sessionChanged() {
    if (_sessionValid) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
      }
    });
  }

  @override
  void dispose() {
    widget.session?.removeListener(_sessionChanged);
    _text.dispose();
    super.dispose();
  }

  void _pick(double lat, double lng) {
    if (!mounted ||
        !_sessionValid ||
        !lat.isFinite ||
        !lng.isFinite ||
        lat.abs() > 90 ||
        lng.abs() > 180) {
      return;
    }
    setState(() {
      _lat = lat;
      _lng = lng;
      _error = null;
    });
  }

  Future<void> _locate() async {
    if (_locating) {
      return;
    }
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      final LocationFix fix =
          await (widget.location ?? MethodChannelLocationProvider())
              .currentFix();
      if (mounted && _sessionValid) {
        _pick(fix.latitude, fix.longitude);
      }
    } on LocationException catch (e) {
      if (mounted) {
        setState(
          () => _error = switch (e.failure) {
            LocationFailure.denied =>
              'Chưa được cấp quyền vị trí. Bạn vẫn có thể chạm bản đồ để chọn.',
            LocationFailure.disabled =>
              'Hãy bật vị trí trên điện thoại hoặc chọn trên bản đồ.',
            LocationFailure.timeout =>
              'Chưa lấy được vị trí. Hãy thử lại hoặc chọn trên bản đồ.',
            LocationFailure.unavailable =>
              'Chưa lấy được vị trí. Bạn vẫn có thể chọn trên bản đồ.',
          },
        );
      }
    } finally {
      if (mounted) {
        setState(() => _locating = false);
      }
    }
  }

  void _save() {
    if (!_sessionValid) {
      Navigator.of(context).pop();
      return;
    }
    if (_text.text.trim().isEmpty ||
        (widget.requirePoint && (_lat == null || _lng == null))) {
      setState(
        () => _error = _text.text.trim().isEmpty
            ? 'Nhập địa chỉ chi tiết.'
            : 'Chọn vị trí trên bản đồ trước khi lưu.',
      );
      return;
    }
    Navigator.of(
      context,
    ).pop(AddressLocation(_text.text.trim(), latitude: _lat, longitude: _lng));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Chọn địa chỉ')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          TextField(
            key: const Key('location-address-text'),
            controller: _text,
            maxLength: widget.maxLength,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Địa chỉ',
              hintText: 'Số nhà, đường, tổ, phường/xã…',
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 320,
            child: Stack(
              children: <Widget>[
                Positioned.fill(
                  child: widget.mapBuilder != null
                      ? widget.mapBuilder!(context, _lat, _lng, _pick)
                      : kM14MapEnabled
                      ? M14OfflineMap(
                          focusPin: true,
                          pins: <Map<String, dynamic>>[
                            if (_lat != null && _lng != null)
                              <String, dynamic>{
                                'lat': _lat,
                                'lon': _lng,
                                'label': 'Địa chỉ đã chọn',
                                'color': 0xFFC0392B,
                              },
                          ],
                          onPoint: (double lat, double lng, bool inside) =>
                              _pick(lat, lng),
                          onError: (String error) {
                            if (mounted) setState(() => _error = error);
                          },
                        )
                      : const ColoredBox(
                          color: N11Colors.white,
                          child: Center(
                            child: Text(
                              'Bản đồ chưa có trong bản cài đặt này.',
                            ),
                          ),
                        ),
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child: FloatingActionButton.small(
                    key: const Key('location-current'),
                    heroTag: null,
                    tooltip: 'Vị trí hiện tại',
                    onPressed: _locating ? null : _locate,
                    child: _locating
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.my_location),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(
            _lat == null
                ? 'Chạm bản đồ để ghim đúng vị trí.'
                : 'Đã chọn vị trí. Chạm bản đồ để chuyển ghim.',
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                key: const Key('location-picker-error'),
                style: const TextStyle(color: N11Colors.error),
              ),
            ),
        ],
      ),
    ),
    bottomNavigationBar: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: FilledButton(
          key: const Key('location-save'),
          onPressed: _locating ? null : _save,
          child: const Text('Lưu địa chỉ'),
        ),
      ),
    ),
  );
}

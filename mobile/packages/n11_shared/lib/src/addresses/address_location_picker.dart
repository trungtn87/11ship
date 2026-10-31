import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_m14_map/n11_m14_map.dart';

import '../account/session_controller.dart';
import '../flows/location.dart';
import '../tokens.dart';
import '../widgets/form_feedback.dart';
import 'place_index.dart';
import 'place_search.dart';

/// Address text and its explicitly selected point are returned together, only on Save.
class AddressLocation {
  const AddressLocation(this.text, {this.latitude, this.longitude});
  final String text;
  final double? latitude;
  final double? longitude;
}

typedef AddressMapBuilder =
    Widget Function(
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
    this.pinSummary,
  });
  final String label;
  final String text;
  final VoidCallback? onTap;
  final String? error;

  /// The confirmed pin as the person reviews it before saving ("Ghim: lat, lng"), or null when the caller shows none.
  final String? pinSummary;

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
      if (pinSummary != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(pinSummary!, key: const Key('address-pin-summary')),
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
    this.searchApi,
  });
  final AddressLocation initial;
  final LocationProvider? location;
  final SessionController? session;
  final int maxLength;

  /// Shop drafts may still be saved before a point has been chosen.
  final bool requirePoint;
  final AddressMapBuilder? mapBuilder;
  final PlaceSearchApi? searchApi;

  @override
  State<AddressLocationPicker> createState() => _AddressLocationPickerState();
}

class _AddressLocationPickerState extends State<AddressLocationPicker> {
  late final TextEditingController _text;
  double? _lat;
  double? _lng;
  bool _locating = false;
  double? _accuracyMeters;
  bool _currentPosition = false;
  int _pointRevision = 0;
  String? _error;
  Timer? _debounce;
  List<PlaceSearchResult> _results = const <PlaceSearchResult>[];
  bool _searching = false;
  bool _searchFailed = false;
  bool _searched = false;
  bool _suggestionsHidden = false;
  String? _pinHint;
  int _searchRevision = 0;
  bool _programmaticText = false;
  bool _pinTextUnconfirmed = false;
  late String _pinText;
  bool _submitted = false;
  final FocusNode _addressFocus = FocusNode();
  String? get _addressError => _submitted
      ? textError(_text.text, 'địa chỉ chi tiết', widget.maxLength)
      : null;
  late final int? _sessionEpoch;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: widget.initial.text);
    _lat = widget.initial.latitude;
    _lng = widget.initial.longitude;
    _pinText = widget.initial.text.trim();
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
    _debounce?.cancel();
    _addressFocus.dispose();
    _text.dispose();
    super.dispose();
  }

  /// The offline index by default (no Internet, no sign-in, nothing sent while typing); tests inject their own.
  PlaceSearchApi get _searchApi => widget.searchApi ?? OfflinePlaceSearchApi.shared;

  bool get _offlineSearch => _searchApi is OfflinePlaceSearchApi;

  void _textChanged(String value) {
    if (_programmaticText) return;
    if (_lat != null && _lng != null && value.trim() != _pinText) _pinTextUnconfirmed = true;
    _debounce?.cancel();
    final String query = value.trim();
    final int revision = ++_searchRevision;
    _suggestionsHidden = false;
    if (query.runes.length < 2) {
      setState(() { _results = const <PlaceSearchResult>[]; _searching = false; _searchFailed = false; _searched = false; });
      return;
    }
    setState(() { _searching = true; _searchFailed = false; _searched = false; });
    _debounce = Timer(Duration(milliseconds: _offlineSearch ? 120 : 500), () async {
      try {
        final List<PlaceSearchResult> results = await _searchApi.search(query);
        if (!mounted || revision != _searchRevision || _text.text.trim() != query) return;
        setState(() { _results = results; _searching = false; _searched = true; });
      } on Object {
        if (!mounted || revision != _searchRevision) return;
        setState(() { _results = const <PlaceSearchResult>[]; _searching = false; _searchFailed = true; _searched = true; });
      }
    });
  }

  void _selectResult(PlaceSearchResult result) {
    _programmaticText = true;
    _text.text = result.address;
    _programmaticText = false;
    _pinText = result.address;
    _pinTextUnconfirmed = false;
    _searchRevision++;
    _results = const <PlaceSearchResult>[];
    _pick(result.latitude, result.longitude);
    setState(() => _pinHint = result.approximate ? 'Ghim đặt ở một điểm trên "${result.name}", chưa phải đúng nhà bạn. Hãy chạm bản đồ để chỉnh ghim và thêm số nhà vào ô địa chỉ.' : null);
  }

  void _clearPin() => setState(() { _pinHint = null; _lat = null; _lng = null; _accuracyMeters = null; _currentPosition = false; _pinTextUnconfirmed = false; _pointRevision++; });

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
      _pointRevision++;
      _currentPosition = false;
      _accuracyMeters = null;
      _lat = lat;
      _lng = lng;
      _pinText = _text.text.trim();
      _pinTextUnconfirmed = false;
      _error = null;
      _pinHint = null;
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
    final int pointRevision = _pointRevision;
    try {
      final LocationFix fix =
          await (widget.location ?? MethodChannelLocationProvider())
              .currentFix();
      if (mounted && _sessionValid && pointRevision == _pointRevision) {
        _pick(fix.latitude, fix.longitude);
        setState(() {
          _currentPosition = true;
          _accuracyMeters = fix.accuracyMeters;
        });
      }
    } on LocationException catch (e) {
      if (mounted && _sessionValid && pointRevision == _pointRevision) {
        setState(
          () => _error = switch (e.failure) {
            LocationFailure.denied =>
              'Chưa được cấp quyền vị trí. Hãy cho phép trong cài đặt ứng dụng hoặc chạm bản đồ để chọn.',
            LocationFailure.disabled =>
              'Hãy bật vị trí trên điện thoại hoặc chọn trên bản đồ.',
            LocationFailure.timeout =>
              'Hết thời gian chờ vị trí từ GPS và mạng. Hãy thử ở nơi thoáng hơn hoặc chạm bản đồ để chọn.',
            LocationFailure.unavailable =>
              'Điện thoại chưa cung cấp vị trí hợp lệ. Bạn vẫn có thể chạm bản đồ để chọn.',
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
    setState(() => _submitted = true);
    if (_addressError != null) {
      _addressFocus.requestFocus();
      return;
    }
    if (widget.requirePoint && (_lat == null || _lng == null)) {
      setState(() => _error = 'Chọn vị trí trên bản đồ trước khi lưu.');
      return;
    }
    if (_pinTextUnconfirmed && _lat != null && _lng != null) {
      setState(() => _error = 'Địa chỉ chữ đã đổi. Hãy xác nhận giữ ghim cũ hoặc bỏ/chọn lại ghim.');
      return;
    }
    Navigator.of(
      context,
    ).pop(AddressLocation(_text.text.trim(), latitude: _lat, longitude: _lng));
  }

  /// Suggestions are optional help: a short scrollable box (shorter while the keyboard is open) that can be hidden, so the map and Save stay in reach.
  Widget _suggestions(BuildContext context) {
    final bool keyboard = MediaQuery.viewInsetsOf(context).bottom > 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            const Expanded(child: Text('Gợi ý (không bắt buộc chọn)', key: Key('place-suggestions-title'), style: N11Text.caption)),
            TextButton(
              key: const Key('place-suggestions-toggle'),
              onPressed: () => setState(() => _suggestionsHidden = !_suggestionsHidden),
              child: Text(_suggestionsHidden ? 'Hiện gợi ý' : 'Ẩn gợi ý'),
            ),
          ],
        ),
        if (!_suggestionsHidden)
          ConstrainedBox(
            key: const Key('place-suggestions-box'),
            constraints: BoxConstraints(maxHeight: keyboard ? 128 : 208),
            child: ListView(
              shrinkWrap: true,
              children: <Widget>[
                for (final PlaceSearchResult result in _results)
                  ListTile(
                    key: Key('place-result-${result.id}'),
                    dense: true,
                    leading: const Icon(Icons.place_outlined),
                    title: Text(result.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(result.kind == null ? result.address : '${result.kind} · ${result.address}', maxLines: 1, overflow: TextOverflow.ellipsis),
                    onTap: () => _selectResult(result),
                  ),
              ],
            ),
          ),
      ],
    );
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
            focusNode: _addressFocus,
            onChanged: (String value) { setState(() {}); _textChanged(value); },
            maxLength: widget.maxLength,
            minLines: 1,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: 'Địa chỉ',
              errorText: _addressError,
              errorMaxLines: 2,
              hintText: 'Số nhà, đường, tổ, phường/xã…',
              filled: true,
              fillColor: N11Colors.white,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 16,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(kRadiusControl),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(kRadiusControl),
                borderSide: const BorderSide(color: N11Colors.line),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(kRadiusControl),
                borderSide: const BorderSide(color: N11Colors.yellow, width: 2),
              ),
            ),
          ),
          if (_searching && !_offlineSearch) const LinearProgressIndicator(key: Key('place-search-loading')),
          if (_searchFailed)
            ListTile(
              key: const Key('place-search-error'),
              title: const Text('Không tìm được lúc này. Bạn vẫn có thể nhập địa chỉ hoặc chọn ghim thủ công.'),
              trailing: TextButton(onPressed: () => _textChanged(_text.text), child: const Text('Thử lại')),
            ),
          if (_searched && !_searching && !_searchFailed && _text.text.trim().runes.length >= 2 && _results.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Không có kết quả phù hợp. Có thể tiếp tục nhập địa chỉ chữ.')),
          if (_results.isNotEmpty) _suggestions(context),
          if (_pinTextUnconfirmed && _lat != null && _lng != null)
            Card(
              key: const Key('pin-text-confirmation'),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                  const Text('Bạn đã đổi địa chỉ chữ. Ghim cũ có còn đúng không?'),
                  Wrap(spacing: 8, children: <Widget>[
                    TextButton(onPressed: () => setState(() { _pinText = _text.text.trim(); _pinTextUnconfirmed = false; }), child: const Text('Giữ ghim – chỉ bổ sung mô tả')),
                    TextButton(onPressed: _clearPin, child: const Text('Bỏ ghim – đổi địa điểm')),
                  ]),
                ]),
              ),
            ),
          const SizedBox(height: 12),
          if (!widget.requirePoint)
            Text(
              _lat == null ? 'Sẽ lưu địa chỉ chữ, chưa ghim vị trí. Ghim bản đồ là tùy chọn.' : 'Sẽ lưu địa chỉ cùng vị trí đã ghim.',
              key: const Key('address-save-mode'),
              style: N11Text.bodyStrong,
            ),
          Text(
            _lat == null
                ? 'Chạm bản đồ để ghim đúng vị trí.'
                : _currentPosition
                ? 'Đã lấy vị trí hiện tại${_accuracyMeters == null ? '' : ' · sai số khoảng ${_accuracyMeters!.ceil()} m'}. Kiểm tra và chỉnh ghim nếu cần.'
                : 'Điểm giao đã chọn. Chạm bản đồ để chuyển ghim.',
          ),
          if (_pinHint != null) Text(_pinHint!, key: const Key('place-approximate-hint'), style: N11Text.caption),
          if (_lat != null && _lng != null)
            Align(alignment: Alignment.centerLeft, child: TextButton(key: const Key('location-clear-pin'), onPressed: _clearPin, child: const Text('Bỏ ghim'))),
          if (_locating)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Đang lấy vị trí qua GPS và mạng…'),
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
          // #194: a pinned point is fixed; moving around never changes it, and nothing here shares the person's position.
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Điểm giao đã chọn là vị trí cố định; di chuyển của bạn không tự đổi điểm này. Nút vị trí hiện tại chỉ đặt ghim theo GPS của máy khi bạn bấm, không chia sẻ vị trí.',
              key: Key('location-picker-fixed-note'),
              style: N11Text.caption,
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

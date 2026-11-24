import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_m14_map/n11_m14_map.dart';

import '../account/session_controller.dart';
import '../flows/location.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/form_feedback.dart';
import 'address_models.dart';
import 'coverage.dart';
import 'place_index.dart';
import 'place_search.dart';

/// Address text and its explicitly selected point are returned together, only on Save.
class AddressLocation {
  const AddressLocation(this.text, {this.latitude, this.longitude, this.note = ''});
  final String text;
  final double? latitude;
  final double? longitude;

  /// "Mô tả bổ sung" (optional): house number, floor, lane, directions. Separate from [text], which the pin or a suggestion sets.
  final String note;
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
    this.actionLabel,
  });
  final String label;
  final String text;
  final VoidCallback? onTap;
  final String? error;

  /// Shared order flows show a visible "Chỉnh sửa" action on the address block; the whole block stays tappable too.
  final String? actionLabel;

  /// The confirmed pin as the person reviews it before saving ("Ghim: lat, lng"), or null when the caller shows none.
  final String? pinSummary;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      N11FieldLabel(label),
      const SizedBox(height: N11Space.labelGap),
      Material(
        color: N11Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusControl),
          side: BorderSide(
            color: error == null ? N11Colors.fieldBorder : N11Colors.error,
            width: error == null ? kFieldBorderWidth : kFieldFocusBorderWidth,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(kRadiusControl),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: kControlHeight),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints bounds) {
                  final Widget addressRow = Row(
                    children: <Widget>[
                      const Icon(
                        Icons.location_on_outlined,
                        size: 20,
                        color: N11Colors.ink2,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          text.trim().isEmpty ? 'Chọn địa chỉ' : text,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.trim().isEmpty
                              ? N11Text.inputHint
                              : N11Text.input,
                        ),
                      ),
                      if (onTap != null && actionLabel == null) ...<Widget>[
                        const SizedBox(width: N11Space.gap2),
                        const Icon(
                          Icons.chevron_right,
                          size: 22,
                          color: N11Colors.ink2,
                        ),
                      ],
                    ],
                  );
                  if (onTap == null || actionLabel == null) {
                    return addressRow;
                  }
                  final TextButton actionButton = TextButton(
                    onPressed: onTap,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(kTapMin, kControlHeight),
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(actionLabel!),
                  );
                  final bool stackAction =
                      bounds.maxWidth < 240 ||
                      (MediaQuery.textScalerOf(context).scale(15) > 20 &&
                          bounds.maxWidth < 260);
                  if (stackAction) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        addressRow,
                        Align(
                          alignment: Alignment.centerRight,
                          child: actionButton,
                        ),
                      ],
                    );
                  }
                  return Row(
                    children: <Widget>[
                      Expanded(child: addressRow),
                      const SizedBox(width: N11Space.gap2),
                      actionButton,
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
      if (pinSummary != null)
        Padding(
          padding: const EdgeInsets.only(top: N11Space.labelGap),
          child: Text(
            pinSummary!,
            key: const Key('address-pin-summary'),
            style: N11Text.caption,
          ),
        ),
      if (error != null)
        Padding(
          padding: const EdgeInsets.only(top: N11Space.labelGap),
          child: Text(
            error!,
            style: N11Text.caption.copyWith(color: N11Colors.errorInk),
          ),
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
    this.enforceCoverage = false,
    this.title = 'Chọn địa chỉ',
  });
  final AddressLocation initial;
  final LocationProvider? location;
  final SessionController? session;
  final int maxLength;

  /// Shop drafts may still be saved before a point has been chosen.
  final bool requirePoint;
  final AddressMapBuilder? mapBuilder;
  final PlaceSearchApi? searchApi;

  /// Shared order flows (Đặt món, Gọi ship): a pin outside the Cao Bằng map is refused. The typed text is never refused.
  final bool enforceCoverage;
  final String title;

  @override
  State<AddressLocationPicker> createState() => _AddressLocationPickerState();
}

class _AddressLocationPickerState extends State<AddressLocationPicker> {
  late final TextEditingController _text;
  late final TextEditingController _note;
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
    _note = TextEditingController(text: widget.initial.note);
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
    _debounce?.cancel();
    _addressFocus.dispose();
    _text.dispose();
    _note.dispose();
    super.dispose();
  }

  /// The offline index by default (no Internet, no sign-in, nothing sent while typing); tests inject their own.
  PlaceSearchApi get _searchApi => widget.searchApi ?? OfflinePlaceSearchApi.shared;

  bool get _offlineSearch => _searchApi is OfflinePlaceSearchApi;

  void _textChanged(String value) {
    if (_programmaticText) return;
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
    _searchRevision++;
    _results = const <PlaceSearchResult>[];
    if (!_pick(result.latitude, result.longitude)) return;
    setState(() => _pinHint = result.approximate ? 'Ghim đặt ở một điểm trên "${result.name}", chưa phải đúng nhà bạn. Hãy chạm bản đồ để chỉnh ghim và thêm số nhà vào ô địa chỉ.' : null);
  }

  // Clearing the pin only changes the coordinates; the typed text stays as the description.
  void _clearPin() => setState(() { _pinHint = null; _lat = null; _lng = null; _accuracyMeters = null; _currentPosition = false; _pointRevision++; });

  /// Moves the pin. Returns false (and changes nothing) for an invalid point, or one outside the covered area when [enforceCoverage] is set.
  bool _pick(double lat, double lng) {
    if (!mounted ||
        !_sessionValid ||
        !lat.isFinite ||
        !lng.isFinite ||
        lat.abs() > 90 ||
        lng.abs() > 180) {
      return false;
    }
    if (widget.enforceCoverage && !insideCaoBang(lat, lng)) {
      setState(() => _error = kOutsideCoverageMessage);
      return false;
    }
    setState(() {
      _pointRevision++;
      _currentPosition = false;
      _accuracyMeters = null;
      _lat = lat;
      _lng = lng;
      _error = null;
      _pinHint = null;
    });
    return true;
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
      if (mounted && _sessionValid && pointRevision == _pointRevision && _pick(fix.latitude, fix.longitude)) {
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
    Navigator.of(
      context,
    ).pop(AddressLocation(_text.text.trim(), latitude: _lat, longitude: _lng, note: _note.text.trim()));
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

  Widget? _mapWidget;
  Object? _mapKey;

  /// Rebuilt only when the pin changes, never because the address text changed (#299): the same instance is returned, so Flutter skips the subtree.
  Widget _map(BuildContext context) {
    final Object key = (_lat, _lng, _pointRevision);
    if (_mapWidget != null && _mapKey == key) return _mapWidget!;
    _mapKey = key;
    return _mapWidget = widget.mapBuilder != null
        ? widget.mapBuilder!(context, _lat, _lng, _pick)
        : kM14MapEnabled
        ? M14OfflineMap(
            focusPin: true,
            pins: <Map<String, dynamic>>[
              if (_lat != null && _lng != null)
                <String, dynamic>{'lat': _lat, 'lon': _lng, 'label': 'Địa chỉ đã chọn', 'color': 0xFFC0392B},
            ],
            onPoint: (double lat, double lng, bool inside) => _pick(lat, lng),
            onError: (String error) {
              if (mounted) setState(() => _error = error);
            },
          )
        : const ColoredBox(
            color: N11Colors.white,
            child: Center(child: Text('Bản đồ chưa có trong bản cài đặt này.')),
          );
  }

  @override
  Widget build(BuildContext context) {
    final OutlineInputBorder normalBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(kRadiusControl),
      borderSide: const BorderSide(
        color: N11Colors.fieldBorder,
        width: kFieldBorderWidth,
      ),
    );
    final OutlineInputBorder focusedBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(kRadiusControl),
      borderSide: const BorderSide(
        color: N11Colors.yellow,
        width: kFieldFocusBorderWidth,
      ),
    );
    final OutlineInputBorder errorBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(kRadiusControl),
      borderSide: const BorderSide(
        color: N11Colors.error,
        width: kFieldFocusBorderWidth,
      ),
    );
    final String statusText = _locating
        ? 'Đang lấy vị trí qua GPS và mạng…'
        : _lat == null
        ? 'Chạm bản đồ để ghim đúng vị trí.'
        : _currentPosition
        ? 'Đã lấy vị trí hiện tại${_accuracyMeters == null ? '' : ' · sai số khoảng ${_accuracyMeters!.ceil()} m'}. Chạm bản đồ để chỉnh.'
        : 'Điểm giao đã chọn. Chạm bản đồ để chuyển ghim.';
    return Scaffold(
      backgroundColor: N11Colors.formBg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: <Widget>[
            N11AppBar(
              title: widget.title,
              transparent: false,
              backgroundColor: N11Colors.formBg,
              borderColor: N11Colors.formDivider,
              onBack: () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              // Not a lazy ListView: the map must stay mounted while the keyboard resizes the viewport (a disposed platform view re-parses the whole map package, #299).
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  N11Space.pad,
                  N11Space.gap4,
                  N11Space.pad,
                  N11Space.gap6,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const N11FieldLabel('Tìm vị trí'),
                    const SizedBox(height: N11Space.labelGap),
                    TextField(
                      key: const Key('location-address-text'),
                      controller: _text,
                      focusNode: _addressFocus,
                      onChanged: (String value) {
                        setState(() {});
                        _textChanged(value);
                      },
                      maxLength: widget.maxLength,
                      maxLines: 1,
                      textAlignVertical: TextAlignVertical.center,
                      style: N11Text.input,
                      cursorColor: N11Colors.black,
                      decoration: InputDecoration(
                        counterText: '',
                        isDense: true,
                        constraints: const BoxConstraints(
                          minHeight: kControlHeight,
                        ),
                        errorText: _addressError,
                        errorMaxLines: 2,
                        hintText: 'Nhập số nhà, đường, tổ, phường/xã…',
                        hintStyle: N11Text.inputHint,
                        filled: true,
                        fillColor: N11Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 14,
                        ),
                        border: normalBorder,
                        enabledBorder: normalBorder,
                        focusedBorder: focusedBorder,
                        errorBorder: errorBorder,
                        focusedErrorBorder: errorBorder,
                        suffixIconConstraints: const BoxConstraints(
                          minWidth: kTapMin,
                          minHeight: kControlHeight,
                        ),
                        suffixIcon: _text.text.isEmpty
                            ? null
                            : IconButton(
                                key: const Key('location-address-clear'),
                                tooltip: 'Xóa địa chỉ',
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints.tightFor(
                                  width: kTapMin,
                                  height: kControlHeight,
                                ),
                                onPressed: () {
                                  _text.clear();
                                  setState(() {});
                                  _textChanged('');
                                },
                                icon: const Icon(
                                  Icons.close_rounded,
                                  size: 20,
                                  color: N11Colors.ink2,
                                ),
                              ),
                      ),
                    ),
                    if (_searching && !_offlineSearch)
                      const LinearProgressIndicator(
                        key: Key('place-search-loading'),
                      ),
                    if (_searchFailed)
                      ListTile(
                        key: const Key('place-search-error'),
                        title: const Text(
                          'Không tìm được lúc này. Bạn vẫn có thể nhập địa chỉ hoặc chọn ghim thủ công.',
                        ),
                        trailing: TextButton(
                          onPressed: () => _textChanged(_text.text),
                          child: const Text('Thử lại'),
                        ),
                      ),
                    if (_lat == null &&
                        _searched &&
                        !_searching &&
                        !_searchFailed &&
                        _text.text.trim().runes.length >= 2 &&
                        _results.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: N11Space.labelGap),
                        child: Text(
                          'Không có kết quả phù hợp. Có thể tiếp tục nhập địa chỉ chữ.',
                          style: N11Text.caption,
                        ),
                      ),
                    if (_results.isNotEmpty) _suggestions(context),
                    const SizedBox(height: N11Space.formFieldGap),
                    if (!widget.requirePoint)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          _lat == null
                              ? 'Sẽ lưu địa chỉ chữ, chưa ghim vị trí. Ghim bản đồ là tùy chọn.'
                              : 'Sẽ lưu địa chỉ cùng vị trí đã ghim.',
                          key: const Key('address-save-mode'),
                          style: N11Text.bodyStrong,
                        ),
                      ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            statusText,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: N11Text.caption,
                          ),
                        ),
                        if (_lat != null && _lng != null) ...<Widget>[
                          const SizedBox(width: N11Space.gap2),
                          OutlinedButton.icon(
                            key: const Key('location-clear-pin'),
                            onPressed: _clearPin,
                            style: OutlinedButton.styleFrom(
                              backgroundColor: N11Colors.white,
                              foregroundColor: N11Colors.error,
                              side: const BorderSide(
                                color: N11Colors.errorBorder,
                              ),
                              minimumSize: const Size(0, 34),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(kRadiusPill),
                              ),
                              tapTargetSize: MaterialTapTargetSize.padded,
                            ),
                            icon: const Icon(
                              Icons.location_off_outlined,
                              size: 15,
                            ),
                            label: const Text(
                              'Bỏ ghim',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (_pinHint != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          _pinHint!,
                          key: const Key('place-approximate-hint'),
                          style: N11Text.caption,
                        ),
                      ),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: N11Space.gap2),
                        child: Text(
                          _error!,
                          key: const Key('location-picker-error'),
                          style: const TextStyle(color: N11Colors.error),
                        ),
                      ),
                    const SizedBox(height: N11Space.gap2),
                    Container(
                      height: 320,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(kRadiusCard),
                        border: Border.all(color: N11Colors.formDivider),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(kRadiusCard - 1),
                        child: Stack(
                          children: <Widget>[
                            Positioned.fill(child: _map(context)),
                            Positioned(
                              top: 12,
                              right: 12,
                              child: Tooltip(
                                message: 'Vị trí hiện tại',
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    color: N11Colors.white,
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: N11Colors.fieldBorder,
                                    ),
                                    boxShadow: const <BoxShadow>[
                                      BoxShadow(
                                        color: Color(0x1A000000),
                                        blurRadius: 8,
                                        offset: Offset(0, 2),
                                      ),
                                    ],
                                  ),
                                  child: Material(
                                    color: Colors.transparent,
                                    shape: const CircleBorder(),
                                    clipBehavior: Clip.antiAlias,
                                    child: InkWell(
                                      key: const Key('location-current'),
                                      onTap: _locating ? null : _locate,
                                      child: SizedBox(
                                        width: kTapMin,
                                        height: kTapMin,
                                        child: Center(
                                          child: _locating
                                              ? const SizedBox(
                                                  width: 20,
                                                  height: 20,
                                                  child:
                                                      CircularProgressIndicator(
                                                        strokeWidth: 2,
                                                      ),
                                                )
                                              : const Icon(
                                                  Icons.my_location_rounded,
                                                  size: 20,
                                                  color: N11Colors.black,
                                                ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: N11Space.formFieldGap),
                    const N11FieldLabel('Mô tả bổ sung', optional: true),
                    const SizedBox(height: N11Space.labelGap),
                    // "Mô tả bổ sung": optional, separate from the address text and the pin (house number, floor, lane, directions).
                    TextField(
                      key: const Key('location-extra-note'),
                      controller: _note,
                      maxLength: kAddressNoteMaxLength,
                      minLines: 1,
                      maxLines: 2,
                      textAlignVertical: TextAlignVertical.center,
                      style: N11Text.input,
                      cursorColor: N11Colors.black,
                      decoration: InputDecoration(
                        counterText: '',
                        isDense: true,
                        constraints: const BoxConstraints(
                          minHeight: kControlHeight,
                        ),
                        hintText: 'Số nhà, tầng, ngõ, ghi chú tìm đường…',
                        hintStyle: N11Text.inputHint,
                        filled: true,
                        fillColor: N11Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 14,
                        ),
                        border: normalBorder,
                        enabledBorder: normalBorder,
                        focusedBorder: focusedBorder,
                      ),
                    ),
                    // #194: a pinned point is fixed; moving around never changes it, and nothing here shares the person's position.
                    const Padding(
                      padding: EdgeInsets.only(top: N11Space.labelGap),
                      child: Text(
                        'Điểm giao đã chọn là vị trí cố định; di chuyển của bạn không tự đổi điểm này. Nút vị trí hiện tại chỉ đặt ghim theo GPS của máy khi bạn bấm, không chia sẻ vị trí.',
                        key: Key('location-picker-fixed-note'),
                        style: N11Text.caption,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        key: const Key('location-bottom-bar'),
        decoration: const BoxDecoration(
          color: N11Colors.white,
          border: Border(
            top: BorderSide(color: N11Colors.formDivider, width: 1),
          ),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: Color(0x141C1917),
              blurRadius: 12,
              offset: Offset(0, -3),
            ),
          ],
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: N11Space.pad,
              vertical: 12,
            ),
            child: N11Button(
              key: const Key('location-save'),
              label: 'Lưu địa chỉ',
              onPressed: _locating ? null : _save,
            ),
          ),
        ),
      ),
    );
  }
}

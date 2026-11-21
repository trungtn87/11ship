import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../flows/location.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'address_controller.dart';
import 'address_location_picker.dart';
import 'address_models.dart';
import 'address_views.dart';
import 'place_index.dart';
import 'place_search.dart';

// The one address flow shared by Đặt món (delivery point) and Gọi ship (pickup and drop-off), modelled on ShopeeFood:
//   A  the confirm block (AddressLocationField with "Chỉnh sửa") opens B, never the map;
//   B  SavedAddressListScreen: "Tìm vị trí", the map icon, the address in use (with "Sửa"), saved addresses (a tap picks it at once),
//      "Thêm địa chỉ mới";
//   C  AddressLocationPicker: the map with a centre pin, typed text (a description only), suggestions from the built-in offline index,
//      "Vị trí hiện tại", one "Lưu địa chỉ". Only B's "Sửa", "Thêm địa chỉ mới", the map icon, or a search result open C.
// Coordinates are what routing and fees use; the text is only the description. Nothing here calls an external geocoder.

/// What the person chose: a saved address of the book (its own id is sent by the caller) or a typed text with an optional pin.
class SharedAddressSelection {
  const SharedAddressSelection.saved(DeliveryAddress address)
      : saved = address,
        location = null;
  const SharedAddressSelection.location(AddressLocation value)
      : saved = null,
        location = value;

  final DeliveryAddress? saved;
  final AddressLocation? location;
}

/// Opens the shared flow. [mapOnly] skips B and opens C directly (the "Địa chỉ khác" action). Null = the person went back.
Future<SharedAddressSelection?> pickSharedAddress(
  BuildContext context, {
  required AddressLocation initial,
  String? selectedId,
  AddressBookController? book,
  SessionController? session,
  LocationProvider? location,
  AddressMapBuilder? mapBuilder,
  PlaceSearchApi? searchApi,
  bool mapOnly = false,
}) {
  final SharedAddressDeps deps = SharedAddressDeps(
      book: book,
      session: session,
      location: location,
      mapBuilder: mapBuilder,
      searchApi: searchApi);
  if (mapOnly) {
    return _openMap(context, deps, initial);
  }
  return Navigator.of(context)
      .push<SharedAddressSelection>(MaterialPageRoute<SharedAddressSelection>(
    builder: (_) => SavedAddressListScreen(
        deps: deps, initial: initial, selectedId: selectedId),
  ));
}

class SharedAddressDeps {
  const SharedAddressDeps(
      {this.book,
      this.session,
      this.location,
      this.mapBuilder,
      this.searchApi});
  final AddressBookController? book;
  final SessionController? session;
  final LocationProvider? location;
  final AddressMapBuilder? mapBuilder;
  final PlaceSearchApi? searchApi;
}

/// C, with the shared rules (no pin required, a pin must stay inside the covered area).
Future<SharedAddressSelection?> _openMap(BuildContext context,
    SharedAddressDeps deps, AddressLocation initial) async {
  final AddressLocation? picked = await Navigator.of(context)
      .push<AddressLocation>(MaterialPageRoute<AddressLocation>(
    builder: (_) => AddressLocationPicker(
      initial: initial,
      session: deps.session,
      location: deps.location,
      mapBuilder: deps.mapBuilder,
      searchApi: deps.searchApi,
      requirePoint: false,
      enforceCoverage: true,
    ),
  ));
  return picked == null ? null : SharedAddressSelection.location(picked);
}

String savedAddressTitle(DeliveryAddress a) {
  if (a.displayName != null && a.displayName!.trim().isNotEmpty) {
    return a.displayName!;
  }
  return switch (a.label) {
    AddressLabel.home => 'Nhà',
    AddressLabel.office => 'Công ty',
    AddressLabel.other => 'Khác',
  };
}

/// B. Pops with a [SharedAddressSelection]; a saved tap pops at once, without the map.
class SavedAddressListScreen extends StatefulWidget {
  const SavedAddressListScreen(
      {super.key, required this.deps, required this.initial, this.selectedId});

  final SharedAddressDeps deps;
  final AddressLocation initial;
  final String? selectedId;

  @override
  State<SavedAddressListScreen> createState() => _SavedAddressListScreenState();
}

class _SavedAddressListScreenState extends State<SavedAddressListScreen> {
  final TextEditingController _search = TextEditingController();
  List<PlaceSearchResult> _results = const <PlaceSearchResult>[];
  int _revision = 0;

  AddressBookController? get book => widget.deps.book;

  @override
  void initState() {
    super.initState();
    final AddressBookController? b = book;
    if (b != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => b.load());
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  PlaceSearchApi get _api =>
      widget.deps.searchApi ?? OfflinePlaceSearchApi.shared;

  Future<void> _onQuery(String value) async {
    final String query = value.trim();
    final int revision = ++_revision;
    if (query.runes.length < 2) {
      setState(() => _results = const <PlaceSearchResult>[]);
      return;
    }
    List<PlaceSearchResult> found;
    try {
      found = await _api.search(query);
    } on Object {
      found = const <PlaceSearchResult>[];
    }
    if (!mounted || revision != _revision) return;
    setState(() => _results = found);
  }

  Future<void> _openMapFrom(AddressLocation start) async {
    final SharedAddressSelection? chosen =
        await _openMap(context, widget.deps, start);
    if (chosen != null && mounted) Navigator.of(context).pop(chosen);
  }

  Future<void> _addSaved(AddressLabel label) async {
    final AddressBookController? b = book;
    if (b == null) return;
    await Navigator.of(context)
        .push(n11Route(AddressFormScreen(controller: b, initialLabel: label)));
  }

  @override
  Widget build(BuildContext context) {
    final bool queried = _search.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Địa chỉ giao hàng'),
        actions: <Widget>[
          IconButton(
              key: const Key('pick-open-map'),
              tooltip: 'Mở bản đồ',
              icon: const Icon(Icons.map_outlined),
              onPressed: () => _openMapFrom(widget.initial)),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            TextField(
              key: const Key('pick-search'),
              controller: _search,
              onChanged: (String v) {
                setState(() {});
                _onQuery(v);
              },
              decoration: const InputDecoration(
                  labelText: 'Tìm vị trí',
                  prefixIcon: Icon(Icons.search),
                  border: OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            if (queried) ...<Widget>[
              if (_results.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                      'Không có kết quả. Chọn "Thêm địa chỉ mới" để nhập địa chỉ trên bản đồ.',
                      key: Key('pick-no-result')),
                ),
              for (final PlaceSearchResult r in _results)
                ListTile(
                  key: Key('pick-result-${r.id}'),
                  leading: const Icon(Icons.place_outlined),
                  title: Text(r.name,
                      maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(r.address,
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                  onTap: () => _openMapFrom(AddressLocation(r.address,
                      latitude: r.latitude, longitude: r.longitude)),
                ),
            ] else ...<Widget>[
              const Text('Đang dùng', style: N11Text.label),
              const SizedBox(height: 6),
              N11Card(
                child: Row(children: <Widget>[
                  const Icon(Icons.location_on_outlined),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                            widget.initial.text.trim().isEmpty
                                ? 'Chưa chọn địa chỉ'
                                : widget.initial.text,
                            key: const Key('pick-current'),
                            style: N11Text.lead),
                        if (widget.initial.note.trim().isNotEmpty)
                          Text(widget.initial.note,
                              key: const Key('pick-current-note'),
                              style: N11Text.caption),
                      ],
                    ),
                  ),
                  TextButton(
                      key: const Key('pick-edit-current'),
                      onPressed: () => _openMapFrom(widget.initial),
                      child: const Text('Sửa')),
                ]),
              ),
              const SizedBox(height: 16),
              if (book != null) _savedSection(context, book!),
            ],
            const SizedBox(height: 16),
            N11Button(
                key: const Key('pick-add-new'),
                label: 'Thêm địa chỉ mới',
                kind: ButtonKind.secondary,
                onPressed: () => _openMapFrom(const AddressLocation(''))),
          ],
        ),
      ),
    );
  }

  Widget _savedSection(BuildContext context, AddressBookController b) {
    return AnimatedBuilder(
      animation: b,
      builder: (BuildContext context, Widget? _) {
        final List<Widget> rows = <Widget>[
          const Text('Địa chỉ đã lưu', style: N11Text.label),
          const SizedBox(height: 6)
        ];
        if (b.loadState == AddressLoad.idle ||
            (b.loadState == AddressLoad.loading && b.addresses.isEmpty)) {
          rows.add(const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('Đang tải sổ địa chỉ…')));
        } else if (b.loadState == AddressLoad.failed && b.addresses.isEmpty) {
          rows.add(Row(children: <Widget>[
            const Expanded(
                child: Text('Chưa tải được sổ địa chỉ từ máy chủ.',
                    key: Key('pick-saved-failed'))),
            TextButton(
                key: const Key('pick-saved-retry'),
                onPressed: b.load,
                child: const Text('Thử lại')),
          ]));
        } else {
          for (final DeliveryAddress a in b.addresses) {
            rows.add(ListTile(
              key: Key('pick-saved-${a.id}'),
              contentPadding: EdgeInsets.zero,
              leading: Icon(a.id == widget.selectedId
                  ? Icons.radio_button_checked
                  : Icons.bookmark_border),
              title: Text(savedAddressTitle(a),
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(
                  <String>[
                    a.addressText,
                    if ((a.deliveryNote ?? '').trim().isNotEmpty)
                      a.deliveryNote!.trim()
                  ].join(' · '),
                  key: Key('pick-saved-text-${a.id}'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
              onTap: () =>
                  Navigator.of(context).pop(SharedAddressSelection.saved(a)),
            ));
          }
        }
        // Nhà and Công ty are offered when the book has none of them yet.
        final bool hasHome = b.addresses
            .any((DeliveryAddress a) => a.label == AddressLabel.home);
        final bool hasOffice = b.addresses
            .any((DeliveryAddress a) => a.label == AddressLabel.office);
        if (!hasHome) {
          rows.add(_addButton('pick-add-home', 'Thêm địa chỉ Nhà',
              () => _addSaved(AddressLabel.home), b));
        }
        if (!hasOffice) {
          rows.add(_addButton('pick-add-office', 'Thêm địa chỉ Công ty',
              () => _addSaved(AddressLabel.office), b));
        }
        return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
      },
    );
  }

  Widget _addButton(String key, String label, VoidCallback onPressed,
          AddressBookController b) =>
      Padding(
        padding: const EdgeInsets.only(top: 6),
        child: TextButton.icon(
          key: Key(key),
          icon: const Icon(Icons.add),
          label: Text(label),
          onPressed: b.locked ? null : onPressed,
        ),
      );
}

import 'dart:async';
import '../flows/location.dart';
import '../m10/m10_cart.dart';
import '../m10/m10_customer_views.dart' show DishStepper;
import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../brand.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'discovery_controller.dart';
import 'discovery_models.dart';
import 'm02_format.dart';
import '../m11/m11_source.dart';
import 'm02_widgets.dart';
import 'menu_models.dart';
import 'preview_views.dart';

// M02-KP01 Trang chủ khám phá, KP03 bộ lọc, KP02 tìm quán/món. Layout of docs/current/M02-discovery-UI-LOCKED-20261016.md: area, search entry,
// group chips, the shop list and the filter button. Ratings and pickup coordinates come from the server; distance is a foreground estimate. Tapping a shop opens its menu (K01); tapping a dish opens its shop and lands on the dish.

void _openShop(BuildContext context, PublicShopApi publicApi, ShopCardData shop, {String? focusItemId, M11Source? ratings}) {
  Navigator.of(context).push(n11Route(ShopPublicScreen(api: publicApi, shopId: shop.shopId, focusItemId: focusItemId, ratings: ratings)));
}

({String label, ChipKind kind}) _stateChip(String reason) {
  switch (reason) {
    case 'ONLINE':
      return (label: 'Đang mở cửa', kind: ChipKind.ok);
    case 'OUTSIDE_BUSINESS_HOURS':
      return (label: 'Đã đóng cửa', kind: ChipKind.neutral);
    default:
      return (label: 'Chưa cài giờ hoạt động', kind: ChipKind.warn);
  }
}

class ShopCard extends StatelessWidget {
  const ShopCard({super.key, required this.shop, required this.onTap, this.customerLocation, this.locating = false});

  final LocationFix? customerLocation;
  final bool locating;
  final ShopCardData shop;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = _stateChip(shop.reason);
    final double? km = shop.distanceKm(customerLocation);
    final String rating = shop.ratingCount == 0 || shop.ratingAverage == null ? 'Chưa có đánh giá' : '★ ${shop.ratingAverage!.toStringAsFixed(1)}/5 (${shop.ratingCount} đánh giá)';
    final String distance = locating ? 'Đang định vị…' : km == null ? 'Chưa xác định' : '≈ ${km.toStringAsFixed(1)} km · đường chim bay';
    return Semantics(
      button: true,
      label: '${shop.name}, $rating, $distance, ${chip.label}',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(kRadiusCard),
        child: Container(
          constraints: const BoxConstraints(minHeight: 76),
          padding: const EdgeInsets.all(N11Space.gap3),
          decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusCard)),
          child: Row(
            children: <Widget>[
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(color: N11Colors.yellowSoft, borderRadius: BorderRadius.circular(12)),
                clipBehavior: Clip.antiAlias,
                child: shop.logoUrl == null ? const Icon(Icons.storefront_outlined, size: 24, color: N11Colors.black)
                  : Image.network(shop.logoUrl!, key: Key('shop-logo-${shop.shopId}'), fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(Icons.storefront_outlined, size: 24, color: N11Colors.black)),
              ),
              const SizedBox(width: N11Space.gap3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(shop.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, height: 1.3, fontWeight: FontWeight.w700, color: N11Colors.black)),
                    if (shop.address.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(shop.address, maxLines: 1, overflow: TextOverflow.ellipsis, style: N11Text.caption)),
                    Text(rating, key: Key('shop-rating-${shop.shopId}'), style: N11Text.caption),
                    Text(distance, key: Key('shop-distance-${shop.shopId}'), style: N11Text.caption),
                    Padding(padding: const EdgeInsets.only(top: 6), child: N11Chip(chip.label, kind: chip.kind)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, size: 22, color: N11Colors.ink2),
            ],
          ),
        ),
      ),
    );
  }
}

class _FakeField extends StatelessWidget {
  const _FakeField({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Tìm quán hoặc món',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        key: const Key('home-search'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(kRadiusControl),
        child: Container(
          height: 48,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusControl)),
          child: const Row(children: <Widget>[Icon(Icons.search, size: 20, color: N11Colors.ink2), SizedBox(width: 10), Text('Tìm quán hoặc món', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: N11Colors.placeholder))]),
        ),
      ),
    );
  }
}

/// KP01: the Home tab of 11Food. It owns its scrolling (pull to refresh, "Xem thêm").
class DiscoveryHome extends StatefulWidget {
  const DiscoveryHome({super.key, required this.controller, required this.publicApi, this.bell, this.ratings, this.position});

  final DiscoveryPosition? position;
  final DiscoveryController controller;
  final PublicShopApi publicApi;

  /// M11: the public ratings of a shop, opened from its page. Null = no rating entry.
  final M11Source? ratings;

  /// M08: the notification bell (with its unread count). Null = the placeholder that says notifications are not built in this build.
  final Widget? bell;

  @override
  State<DiscoveryHome> createState() => _DiscoveryHomeState();
}

class _DiscoveryHomeState extends State<DiscoveryHome> with WidgetsBindingObserver {
  DiscoveryController get c => widget.controller;
  late final DiscoveryPosition _position = widget.position ?? c.position;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      if (c.choicesState != DiscoveryLoad.ready) await c.start();
      if (mounted) await c.locate(source: _position);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && c.choicesState == DiscoveryLoad.ready) {
      unawaited(c.locate(source: _position));
    }
  }

  Future<void> _openFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: N11Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(kRadiusCard))),
      builder: (BuildContext context) => FilterSheet(controller: c),
    );
  }

  void _openSearch() {
    final String? area = c.areaId;
    if (area == null) {
      m02Toast(context, 'Chưa xác định được khu vực từ GPS. Hãy thử định vị lại.');
      return;
    }
    Navigator.of(context).push(n11Route(SearchScreen(api: c.api, publicApi: widget.publicApi, ratings: widget.ratings, areaId: area, position: _position, discovery: c, retryPosition: () => c.locate(source: _position, force: true))));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[c, _position]),
      builder: (BuildContext context, Widget? child) {
        final List<Widget> body = <Widget>[_header()];
        switch (c.choicesState) {
          case DiscoveryLoad.idle:
          case DiscoveryLoad.loading:
            body.addAll(const <Widget>[M02Skeleton(rows: 1, height: 48), M02Skeleton(rows: 4, height: 84)]);
          case DiscoveryLoad.notConnected:
            body.add(const M02NotConnected(what: 'Danh sách quán'));
          case DiscoveryLoad.failed:
            body.add(_failed(() => c.start()));
          case DiscoveryLoad.ready:
            body.addAll(_ready());
        }
        return RefreshIndicator(
          onRefresh: () => c.choicesState == DiscoveryLoad.ready ? c.refresh() : c.start(),
          child: ListView(
            key: const Key('home-list'),
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap8),
            children: <Widget>[for (final Widget w in body) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: w)],
          ),
        );
      },
    );
  }

  /// The brand and the notification bell.
  Widget _header() => Row(children: <Widget>[
        BrandLogo(brand: foodBrand),
        const Spacer(),
        Material(
          color: N11Colors.white,
          shape: const CircleBorder(side: BorderSide(color: N11Colors.line)),
          child: widget.bell ??
              IconButton(
                key: const Key('home-bell'),
                tooltip: 'Thông báo',
                constraints: const BoxConstraints(minWidth: kTapMin, minHeight: kTapMin),
                onPressed: () => m02Toast(context, 'Thông báo sẽ có ở bản sau.'),
                icon: const Icon(Icons.notifications_outlined, color: N11Colors.black),
              ),
        ),
      ]);

  Widget _failed(VoidCallback retry) => Column(children: <Widget>[
        const N11StateBlock(kind: StateKind.warn, title: 'Không tải được dữ liệu', text: 'Chưa nhận được dữ liệu từ máy chủ nên chưa hiển thị được danh sách quán. Chưa có gì bị thay đổi.'),
        const SizedBox(height: N11Space.gap4),
        N11Button(key: const Key('home-retry'), label: 'Thử lại', onPressed: retry),
      ]);

  List<Widget> _ready() {
    final List<Widget> out = <Widget>[];
    if (c.areas.isEmpty) {
      if (c.outsideCoverage) return <Widget>[const Text('Khu vực này chưa được phục vụ', key: Key('home-outside-coverage'), style: N11Text.lead)];
      return <Widget>[const EmptyState(icon: Icons.place_outlined, title: 'Chưa có khu vực phục vụ', text: 'Hiện chưa có khu vực nào đang phục vụ. Vui lòng quay lại sau.')];
    }
    // GPS controls this label; it is not an interactive area selector.
    final String areaLabel = c.area == null
        ? (c.resolvingArea || _position.loading ? 'Đang xác định khu vực…' : c.outsideCoverage ? 'Ngoài khu vực phục vụ' : 'Chưa xác định khu vực')
        : c.manualArea ? '${c.area!.name} · tham khảo'
        : _position.failure != null ? '${c.area!.name} · vị trí gần nhất' : c.area!.name;
    out.add(ConstrainedBox(
      key: const Key('home-area'),
      constraints: const BoxConstraints(minHeight: kTapMin),
      child: Row(children: <Widget>[
        const Icon(Icons.my_location, size: 20, color: N11Colors.yellowStrong),
        const SizedBox(width: 6),
        Flexible(child: Text(areaLabel, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: N11Colors.black))),
      ]),
    ));
    out.add(_FakeField(onTap: _openSearch));
    out.add(_PositionButton(position: _position, resolving: c.resolvingArea, failed: c.areaResolutionFailed,
      outsideCoverage: c.outsideCoverage, retry: () => c.locate(source: _position, force: true)));
    if (c.outsideCoverage) {
      out.add(const Text('Khu vực này chưa được phục vụ', key: Key('home-outside-coverage'), style: N11Text.lead));
    }
    if (c.areaId == null) {
      if (!c.outsideCoverage) {
        out.add(Text(c.resolvingArea || _position.loading
            ? 'Đang tìm khu vực phục vụ theo vị trí hiện tại…'
            : 'Chưa xác định được khu vực theo GPS. Hãy thử định vị lại để xem các quán gần bạn.',
          key: const Key('home-location-needed'), style: N11Text.lead));
      }
      return out;
    }
    if (c.categories.isNotEmpty) {
      out.add(SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: <Widget>[
          _chip('home-cat-all', 'Tất cả', c.categoryId == null, () => c.categoryId == null ? null : c.toggleCategory(c.categoryId!)),
          for (final CategoryChoice cat in c.categories) _chip('home-cat-${cat.id}', cat.name, c.categoryId == cat.id, () => c.toggleCategory(cat.id)),
        ]),
      ));
    }
    if (c.stale) {
      out.add(N11Banner(key: const Key('home-stale'), kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.', trailing: N11Button(key: const Key('home-reload'), label: 'Thử lại', compact: true, onPressed: c.refresh)));
    }
    out.add(Row(children: <Widget>[
      const Expanded(child: Text('Quán quanh bạn', style: N11Text.h2)),
      Semantics(
        button: true,
        label: c.filtersActive ? 'Bộ lọc đang bật' : 'Bộ lọc',
        excludeSemantics: true,
        onTap: _openFilters,
        child: InkWell(
          key: const Key('home-filter'),
          onTap: _openFilters,
          borderRadius: BorderRadius.circular(kRadiusControl),
          child: Container(
            constraints: const BoxConstraints(minWidth: kTapMin, minHeight: kTapMin),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: c.filtersActive ? N11Colors.yellow : N11Colors.white, border: Border.all(color: c.filtersActive ? N11Colors.yellow : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusControl)),
            child: const Icon(Icons.tune, size: 22, color: N11Colors.black),
          ),
        ),
      ),
    ]));
    switch (c.listState) {
      case DiscoveryLoad.idle:
      case DiscoveryLoad.loading:
        out.add(const M02Skeleton(rows: 4, height: 84));
      case DiscoveryLoad.notConnected:
        out.add(const M02NotConnected(what: 'Danh sách quán'));
      case DiscoveryLoad.failed:
        out.add(_failed(c.refresh));
      case DiscoveryLoad.ready:
        if (c.shops.isEmpty) {
          out.add(EmptyState(key: const Key('home-empty'), icon: Icons.restaurant, title: 'Chưa có quán phù hợp', text: c.filtersActive ? 'Không có quán nào khớp bộ lọc hiện tại.' : 'Khu vực này chưa có quán nào có món để hiển thị.'));
          if (c.filtersActive) {
            out.add(N11Button(key: const Key('home-clear'), label: 'Xóa bộ lọc', kind: ButtonKind.secondary, onPressed: c.reset));
          }
        } else {
          for (final ShopCardData s in c.shops) {
            out.add(ShopCard(key: Key('shop-${s.shopId}'), shop: s, customerLocation: _position.fix, locating: _position.loading, onTap: () => _openShop(context, widget.publicApi, s, ratings: widget.ratings)));
          }
          if (c.hasMore) {
            out.add(N11Button(key: const Key('home-more'), label: c.loadingMore ? 'Đang tải…' : 'Xem thêm', kind: ButtonKind.secondary, loading: c.loadingMore, onPressed: c.loadingMore ? null : c.loadMore));
          }
        }
    }
    return out;
  }

  Widget _chip(String key, String label, bool on, VoidCallback? onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: N11Space.gap2),
      child: Semantics(
        button: true,
        selected: on,
        label: label,
        excludeSemantics: true,
        onTap: onTap,
        child: InkWell(
          key: Key(key),
          borderRadius: BorderRadius.circular(kRadiusPill),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: kTapMin),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(color: on ? N11Colors.yellow : N11Colors.white, border: Border.all(color: on ? N11Colors.yellow : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusPill)),
            child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.black)),
          ),
        ),
      ),
    );
  }
}

/// KP03: area, group and "only open shops", as a draft: closing the sheet applies nothing; "Đặt lại" clears the group and the switch and
/// keeps the area; "Áp dụng" updates the list.
class FilterSheet extends StatefulWidget {
  const FilterSheet({super.key, required this.controller});

  final DiscoveryController controller;

  @override
  State<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<FilterSheet> {
  late String? _category = widget.controller.categoryId;
  late bool _open = widget.controller.openOnly;

  @override
  Widget build(BuildContext context) {
    final DiscoveryController c = widget.controller;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(N11Space.gap4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(children: <Widget>[
                const Expanded(child: Text('Bộ lọc', style: N11Text.h2)),
                IconButton(key: const Key('filter-close'), tooltip: 'Đóng', constraints: const BoxConstraints(minWidth: kTapMin, minHeight: kTapMin), icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
              ]),
              const SizedBox(height: N11Space.gap2),
              if (c.area != null)
                Text('Khu vực: ${c.area!.name} (theo GPS)', style: N11Text.caption),
              const SizedBox(height: N11Space.gap3),
              const Text('Nhóm món', style: N11Text.label),
              const SizedBox(height: N11Space.gap2),
              Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[for (final CategoryChoice cat in c.categories) _pick('filter-cat-${cat.id}', cat.name, _category == cat.id, () => setState(() => _category = _category == cat.id ? null : cat.id))]),
              const SizedBox(height: N11Space.gap3),
              SwitchListTile(
                key: const Key('filter-open'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Chỉ quán đang mở cửa', style: N11Text.bodyStrong),
                value: _open,
                activeThumbColor: N11Colors.yellowStrong,
                onChanged: (bool v) => setState(() => _open = v),
              ),
              const SizedBox(height: N11Space.gap3),
              Row(children: <Widget>[
                Expanded(child: N11Button(key: const Key('filter-reset'), label: 'Đặt lại', kind: ButtonKind.secondary, onPressed: () => setState(() { _category = null; _open = false; }))),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  flex: 2,
                  child: N11Button(
                    key: const Key('filter-apply'),
                    label: 'Áp dụng',
                    onPressed: () {
                      final NavigatorState navigator = Navigator.of(context);
                      c.apply(area: c.areaId, category: _category, open: _open);
                      navigator.pop();
                    },
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pick(String key, String label, bool on, VoidCallback onTap) {
    return Semantics(
      button: true,
      selected: on,
      label: label,
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        key: Key(key),
        borderRadius: BorderRadius.circular(kRadiusPill),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: kTapMin),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: on ? N11Colors.yellow : N11Colors.white, border: Border.all(color: on ? N11Colors.yellow : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusPill)),
          // widthFactor 1: the chip is as wide as its text (a Wrap inside a stretched column must not stretch it into a full-width bar).
          child: Center(widthFactor: 1, child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.black))),
        ),
      ),
    );
  }
}

/// KP02: search over shop names and dish names in the chosen area, in two tabs. Hủy leaves; the typed term stays while the person moves
/// between the tabs; results of an older term never show under a newer one.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, required this.api, required this.publicApi, this.ratings, required this.areaId, this.categoryId, this.openOnly = false, this.position, this.debounce = const Duration(milliseconds: 350), this.discovery, this.retryPosition});

  final DiscoveryPosition? position;
  final DiscoveryApi api;
  final PublicShopApi publicApi;
  final M11Source? ratings;
  final String areaId;
  final DiscoveryController? discovery;
  final VoidCallback? retryPosition;
  final String? categoryId;
  final bool openOnly;
  final Duration debounce;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final DishSearchController _search = DishSearchController(api: widget.api, areaId: widget.areaId, categoryId: widget.categoryId, openOnly: widget.openOnly, debounce: widget.debounce);
  late final DiscoveryPosition _position = widget.position ?? DiscoveryPosition();
  final TextEditingController _text = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.discovery?.addListener(_areaChanged);
  }

  void _areaChanged() => _search.setArea(widget.discovery?.areaId);

  @override
  void dispose() {
    if (widget.position == null) _position.dispose();
    widget.discovery?.removeListener(_areaChanged);
    _search.dispose();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: N11Colors.bg,
      body: SafeArea(
        child: ListenableBuilder(
          listenable: Listenable.merge(<Listenable>[_search, _position, if (widget.discovery != null) widget.discovery!]),
          builder: (BuildContext context, Widget? child) => Column(
            children: <Widget>[
              Container(
                padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap2, 4, N11Space.gap2),
                decoration: const BoxDecoration(color: N11Colors.white, border: Border(bottom: BorderSide(color: N11Colors.line))),
                child: Row(children: <Widget>[
                  Expanded(
                    child: TextField(
                      key: const Key('search-field'),
                      controller: _text,
                      autofocus: true,
                      maxLength: 100,
                      textInputAction: TextInputAction.search,
                      onChanged: _search.setTerm,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: N11Colors.black),
                      decoration: InputDecoration(
                        hintText: 'Tìm quán hoặc món',
                        hintStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: N11Colors.placeholder),
                        counterText: '',
                        filled: true,
                        fillColor: N11Colors.bg,
                        prefixIcon: const Icon(Icons.search, color: N11Colors.ink2),
                        suffixIcon: _text.text.isEmpty ? null : IconButton(key: const Key('search-clear'), tooltip: 'Xóa nội dung tìm kiếm', icon: const Icon(Icons.close, size: 20), onPressed: () { _text.clear(); _search.setTerm(''); setState(() {}); }),
                        contentPadding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 12),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: BorderSide.none),
                      ),
                    ),
                  ),
                  TextButton(key: const Key('search-cancel'), style: TextButton.styleFrom(minimumSize: const Size(kTapMin, kTapMin)), onPressed: () => Navigator.of(context).maybePop(), child: const Text('Hủy', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.black))),
                ]),
              ),
              _PositionButton(position: _position, retry: widget.retryPosition, resolving: widget.discovery?.resolvingArea ?? false, failed: widget.discovery?.areaResolutionFailed ?? false),
              Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap3, N11Space.pad, N11Space.gap8), children: _results())),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _results() {
    final DishSearchController s = _search;
    Widget gap(Widget w) => Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: w);
    if (widget.discovery != null && widget.discovery!.areaId == null) {
      return <Widget>[const Text('Chọn khu vực để tìm quán hoặc món.')];
    }
    if (!s.hasTerm) {
      return <Widget>[const EmptyState(icon: Icons.search, title: 'Tìm quán hoặc món', text: 'Gõ tên quán hoặc tên món. Không cần gõ dấu.')];
    }
    switch (s.state) {
      case DiscoveryLoad.idle:
      case DiscoveryLoad.loading:
        return <Widget>[const M02Skeleton(rows: 4, height: 76)];
      case DiscoveryLoad.notConnected:
        return <Widget>[const M02NotConnected(what: 'Tìm kiếm')];
      case DiscoveryLoad.failed:
        return <Widget>[
          const N11StateBlock(kind: StateKind.warn, title: 'Không tải được dữ liệu', text: 'Chưa nhận được kết quả từ máy chủ. Từ khóa của bạn vẫn được giữ.'),
          const SizedBox(height: N11Space.gap4),
          N11Button(key: const Key('search-retry'), label: 'Thử lại', onPressed: s.run),
        ];
      case DiscoveryLoad.ready:
        break;
    }
    final int count = s.groupedShops.length;
    if (count == 0) {
      return <Widget>[
        const N11StateBlock(kind: StateKind.warn, icon: Icons.search_off, title: 'Không có kết quả', text: 'Thử tên quán hoặc tên món khác.'),
        const SizedBox(height: N11Space.gap4),
        N11Button(key: const Key('search-clear-term'), label: 'Xóa từ khóa', kind: ButtonKind.secondary, onPressed: () { _text.clear(); _search.setTerm(''); setState(() {}); }),
      ];
    }
    return <Widget>[
      if (s.stale) gap(const N11Banner(key: Key('search-stale'), kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị kết quả đã tải.')),
      for (final ShopCardData shop in s.groupedShops) ...<Widget>[
        gap(ShopCard(key: Key('result-shop-${shop.shopId}'), shop: shop, customerLocation: _position.fix, locating: _position.loading,
          onTap: () => _openShop(context, widget.publicApi, shop, ratings: widget.ratings))),
        for (final DishHit dish in s.dishes.where((DishHit d) => d.shop.shopId == shop.shopId))
          gap(_DishResult(key: Key('result-dish-${dish.itemId}'), dish: dish,
            onTap: () => _openShop(context, widget.publicApi, shop, focusItemId: dish.itemId, ratings: widget.ratings))),
        gap(TextButton(key: Key('search-all-${shop.shopId}'), onPressed: () => _openShop(context, widget.publicApi, shop, ratings: widget.ratings), child: const Text('Xem tất cả'))),
      ],
      if (s.hasMore) gap(N11Button(key: const Key('search-more'), label: s.loadingMore ? 'Đang tải…' : 'Xem thêm', kind: ButtonKind.secondary, loading: s.loadingMore, onPressed: s.loadingMore ? null : s.loadMore)),
    ];
  }
}

class _DishResult extends StatelessWidget {
  const _DishResult({super.key, required this.dish, required this.onTap});

  final DishHit dish;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = _stateChip(dish.shop.reason);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusCard)),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(N11Space.gap3),
            child: Row(children: <Widget>[
              DishThumb(url: dish.imageUrl),
              const SizedBox(width: N11Space.gap3),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                  Text(dish.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w700, color: N11Colors.black)),
                  Text(formatVnd(dish.priceVnd), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.yellowStrong)),
                  if (dish.soldCount != null) Text('Đã bán ${dish.soldCount}', style: N11Text.caption),
                  Text(dish.shop.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: N11Text.caption),
                  Padding(padding: const EdgeInsets.only(top: 4), child: N11Chip(chip.label, kind: chip.kind)),
                ]),
              ),
              if (dish.shop.open && OrderRuntime.current != null)
                DishStepper(cart: OrderRuntime.current!.cart, shopId: dish.shop.shopId, shopName: dish.shop.name,
                  itemId: dish.itemId, name: dish.name, priceVnd: dish.priceVnd, canOrder: OrderRuntime.current!.canOrder)
              else const Icon(Icons.chevron_right, size: 22, color: N11Colors.ink2),
            ]),
          ),
        ),
      ),
    );
  }
}

class _PositionButton extends StatelessWidget {
  const _PositionButton({required this.position, this.retry, this.resolving = false, this.failed = false});
  final DiscoveryPosition position;
  final VoidCallback? retry;
  final bool resolving;
  final bool failed;
  @override
  Widget build(BuildContext context) {
    if (position.fix != null && !resolving && !failed) return const SizedBox.shrink();
    final bool busy = position.loading || resolving;
    final String label = busy ? 'Đang định vị…' : failed ? 'Chưa xác định được khu vực. Thử lại'
      : position.failure == LocationFailure.denied ? 'Chưa được cấp quyền vị trí. Thử lại'
      : position.failure == LocationFailure.disabled ? 'Vị trí đang tắt. Thử lại'
      : position.attemptedAt != null ? 'Chưa lấy được vị trí. Thử lại' : 'Dùng vị trí hiện tại để xem khoảng cách';
    return TextButton.icon(
      key: const Key('discovery-locate'), onPressed: busy ? null : retry ?? position.locate,
      icon: const Icon(Icons.my_location, size: 18), label: Text(label),
    );
  }
}

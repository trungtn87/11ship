import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../brand.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'discovery_controller.dart';
import 'discovery_models.dart';
import 'm02_format.dart';
import 'm02_widgets.dart';
import 'menu_models.dart';
import 'preview_views.dart';

// M02-KP01 Trang chủ khám phá, KP03 bộ lọc, KP02 tìm quán/món. Layout of docs/current/M02-discovery-UI-LOCKED-20261016.md: area, search entry,
// group chips, the shop list and the filter button. Only what the server returned is shown (no sample shop, no rating, no distance, no
// delivery fee). Tapping a shop opens its menu (K01); tapping a dish opens its shop and lands on the dish.

void _openShop(BuildContext context, PublicShopApi publicApi, ShopCardData shop, {String? focusItemId}) {
  Navigator.of(context).push(n11Route(ShopPublicScreen(api: publicApi, shopId: shop.shopId, focusItemId: focusItemId)));
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
  const ShopCard({super.key, required this.shop, required this.onTap});

  final ShopCardData shop;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = _stateChip(shop.reason);
    return Semantics(
      button: true,
      label: '${shop.name}, ${chip.label}',
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
                child: const Icon(Icons.storefront_outlined, size: 24, color: N11Colors.black),
              ),
              const SizedBox(width: N11Space.gap3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(shop.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, height: 1.3, fontWeight: FontWeight.w700, color: N11Colors.black)),
                    if (shop.address.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(shop.address, maxLines: 1, overflow: TextOverflow.ellipsis, style: N11Text.caption)),
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
  const DiscoveryHome({super.key, required this.controller, required this.publicApi, this.bell});

  final DiscoveryController controller;
  final PublicShopApi publicApi;

  /// M08: the notification bell (with its unread count). Null = the placeholder that says notifications are not built in this build.
  final Widget? bell;

  @override
  State<DiscoveryHome> createState() => _DiscoveryHomeState();
}

class _DiscoveryHomeState extends State<DiscoveryHome> {
  DiscoveryController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => c.start());
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
      m02Toast(context, 'Hãy chọn khu vực trước khi tìm.');
      return;
    }
    Navigator.of(context).push(n11Route(SearchScreen(api: c.api, publicApi: widget.publicApi, areaId: area, categoryId: c.categoryId, openOnly: c.openOnly)));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: c,
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
      return <Widget>[const EmptyState(icon: Icons.place_outlined, title: 'Chưa có khu vực phục vụ', text: 'Hiện chưa có khu vực nào đang phục vụ. Vui lòng quay lại sau.')];
    }
    out.add(InkWell(
      key: const Key('home-area'),
      onTap: _openFilters,
      borderRadius: BorderRadius.circular(kRadiusControl),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: kTapMin),
        child: Row(children: <Widget>[
          const Icon(Icons.place, size: 20, color: N11Colors.yellowStrong),
          const SizedBox(width: 6),
          Flexible(child: Text(c.area?.name ?? 'Chọn khu vực', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: N11Colors.black))),
          const Icon(Icons.expand_more, size: 22, color: N11Colors.ink2),
        ]),
      ),
    ));
    out.add(_FakeField(onTap: _openSearch));
    if (c.areaId == null) {
      out.add(const Text('Chọn khu vực để xem các quán đang phục vụ.', key: Key('home-pick-area'), style: N11Text.lead));
      for (final AreaChoice a in c.areas) {
        out.add(N11ChoiceCard(key: Key('area-${a.id}'), title: a.name, selected: false, onTap: () => c.chooseArea(a.id)));
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
            out.add(ShopCard(key: Key('shop-${s.shopId}'), shop: s, onTap: () => _openShop(context, widget.publicApi, s)));
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
  late String? _area = widget.controller.areaId;
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
              const Text('Khu vực', style: N11Text.label),
              const SizedBox(height: N11Space.gap2),
              Container(
                constraints: const BoxConstraints(minHeight: kTapMin),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusControl)),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    key: const Key('filter-area'),
                    isExpanded: true,
                    value: c.areas.any((AreaChoice a) => a.id == _area) ? _area : null,
                    hint: const Text('Chọn khu vực'),
                    icon: const Icon(Icons.expand_more, color: N11Colors.ink2),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: N11Colors.black),
                    items: <DropdownMenuItem<String>>[
                      for (final AreaChoice a in c.areas) DropdownMenuItem<String>(key: Key('filter-area-${a.id}'), value: a.id, child: Row(children: <Widget>[const Icon(Icons.place, size: 18, color: N11Colors.yellowStrong), const SizedBox(width: 8), Flexible(child: Text(a.name, overflow: TextOverflow.ellipsis))])),
                    ],
                    onChanged: (String? id) => setState(() => _area = id),
                  ),
                ),
              ),
              const SizedBox(height: N11Space.gap4),
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
                      c.apply(area: _area, category: _category, open: _open);
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
  const SearchScreen({super.key, required this.api, required this.publicApi, required this.areaId, this.categoryId, this.openOnly = false, this.debounce = const Duration(milliseconds: 350)});

  final DiscoveryApi api;
  final PublicShopApi publicApi;
  final String areaId;
  final String? categoryId;
  final bool openOnly;
  final Duration debounce;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final DishSearchController _search = DishSearchController(api: widget.api, areaId: widget.areaId, categoryId: widget.categoryId, openOnly: widget.openOnly, debounce: widget.debounce);
  final TextEditingController _text = TextEditingController();

  @override
  void dispose() {
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
          listenable: _search,
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
              Padding(
                padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap2, N11Space.pad, 0),
                child: Row(children: <Widget>[
                  Expanded(child: _tab('search-tab-shops', 'Quán', SearchScope.shops)),
                  Expanded(child: _tab('search-tab-dishes', 'Món', SearchScope.dishes)),
                ]),
              ),
              Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap3, N11Space.pad, N11Space.gap8), children: _results())),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tab(String key, String label, SearchScope scope) {
    final bool on = _search.scope == scope;
    return Semantics(
      button: true,
      selected: on,
      label: label,
      excludeSemantics: true,
      onTap: () => _search.setScope(scope),
      child: InkWell(
        key: Key(key),
        onTap: () => _search.setScope(scope),
        child: Container(
          constraints: const BoxConstraints(minHeight: kTapMin),
          alignment: Alignment.center,
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: on ? N11Colors.yellowStrong : N11Colors.line, width: on ? 3 : 1))),
          child: Text(label, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: on ? N11Colors.yellowStrong : N11Colors.ink2)),
        ),
      ),
    );
  }

  List<Widget> _results() {
    final DishSearchController s = _search;
    Widget gap(Widget w) => Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: w);
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
    final bool shops = s.scope == SearchScope.shops;
    final int count = shops ? s.shops.length : s.dishes.length;
    if (count == 0) {
      return <Widget>[
        const N11StateBlock(kind: StateKind.warn, icon: Icons.search_off, title: 'Không có kết quả', text: 'Thử từ khóa khác hoặc đổi bộ lọc.'),
        const SizedBox(height: N11Space.gap4),
        N11Button(key: const Key('search-clear-term'), label: 'Xóa từ khóa', kind: ButtonKind.secondary, onPressed: () { _text.clear(); _search.setTerm(''); setState(() {}); }),
      ];
    }
    return <Widget>[
      if (!shops) gap(const Text('Chọn món để xem thực đơn quán', key: Key('search-hint'), style: N11Text.lead)),
      if (s.stale) gap(const N11Banner(key: Key('search-stale'), kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị kết quả đã tải.')),
      if (shops)
        for (final ShopCardData shop in s.shops) gap(ShopCard(key: Key('result-shop-${shop.shopId}'), shop: shop, onTap: () => _openShop(context, widget.publicApi, shop)))
      else
        for (final DishHit dish in s.dishes) gap(_DishResult(key: Key('result-dish-${dish.itemId}'), dish: dish, onTap: () => _openShop(context, widget.publicApi, dish.shop, focusItemId: dish.itemId))),
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
                  Text(dish.shop.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: N11Text.caption),
                  Padding(padding: const EdgeInsets.only(top: 4), child: N11Chip(chip.label, kind: chip.kind)),
                ]),
              ),
              const Icon(Icons.chevron_right, size: 22, color: N11Colors.ink2),
            ]),
          ),
        ),
      ),
    );
  }
}

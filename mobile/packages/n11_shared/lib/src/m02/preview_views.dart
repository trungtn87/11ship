import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm02_flows.dart';
import 'm02_format.dart';
import 'm02_widgets.dart';
import 'menu_controller.dart';
import 'menu_models.dart';
import 'public_shop_controller.dart';
import 'schedule.dart';
import 'shop_ops_controller.dart';

// Q07 (Xem trước thực đơn), K01 (khách xem quán và thực đơn) and K02 (giờ hoạt động phía khách). Q07 and K01 share one body, so the
// owner previews exactly what a customer gets. No basket, no order, no payment: M02 only shows.

({String label, ChipKind kind}) _chipOf(String reason) {
  switch (reason) {
    case 'ONLINE':
      return (label: 'Đang mở cửa', kind: ChipKind.ok);
    case 'OUTSIDE_BUSINESS_HOURS':
      return (label: 'Đã đóng cửa', kind: ChipKind.neutral);
    case 'NO_BUSINESS_HOURS':
      return (label: 'Chưa cài giờ hoạt động', kind: ChipKind.warn);
    default:
      return (label: 'Chưa hiển thị', kind: ChipKind.neutral);
  }
}

/// The shop header, the in-shop dish search and the dish groups. [preview] adds the "Xem trước" tag and the hidden-dishes note.
/// [focusItemId] is the dish a search result pointed at: the view scrolls to it and marks it (a dish that is no longer there says so).
class ShopMenuContent extends StatefulWidget {
  const ShopMenuContent({
    super.key,
    required this.view,
    required this.preview,
    required this.onHours,
    this.hiddenCount = 0,
    this.emptyText = 'Quán chưa có món để hiển thị.',
    this.focusItemId,
  });

  final ShopMenuView view;
  final bool preview;
  final VoidCallback onHours;
  final int hiddenCount;
  final String emptyText;
  final String? focusItemId;

  @override
  State<ShopMenuContent> createState() => _ShopMenuContentState();
}

class _ShopMenuContentState extends State<ShopMenuContent> {
  final TextEditingController _search = TextEditingController();
  final Map<String, GlobalKey> _rows = <String, GlobalKey>{};
  String? _highlight;
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _highlight = widget.focusItemId;
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus());
  }

  @override
  void didUpdateWidget(ShopMenuContent old) {
    super.didUpdateWidget(old);
    if (!_focused) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _focus());
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _focus() {
    final String? id = widget.focusItemId;
    if (id == null || _focused || !mounted) {
      return;
    }
    _focused = true;
    final BuildContext? target = _rows[id]?.currentContext;
    if (target == null) {
      setState(() => _highlight = null);
      m02Toast(context, 'Món này không còn trong thực đơn của quán.');
      return;
    }
    Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 250), alignment: 0.15);
  }

  @override
  Widget build(BuildContext context) {
    final ShopMenuView view = widget.view;
    final ({String label, ChipKind kind}) chip = _chipOf(view.availabilityReason);
    final String needle = foldVietnamese(_search.text.trim());
    final List<PublicCategory> groups = <PublicCategory>[
      for (final PublicCategory c in view.categories)
        PublicCategory(name: c.name, items: <PublicItem>[for (final PublicItem i in c.items) if (needle.isEmpty || foldVietnamese(i.name).contains(needle)) i]),
    ].where((PublicCategory c) => c.items.isNotEmpty).toList();
    return vstack(<Widget>[
      N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: Text(view.name, key: const Key('shop-view-name'), style: const TextStyle(fontSize: 22, height: 1.25, fontWeight: FontWeight.w800, color: N11Colors.black))),
                if (widget.preview) const Padding(padding: EdgeInsets.only(left: N11Space.gap2), child: N11Chip('Xem trước', kind: ChipKind.dark)),
              ],
            ),
            if (view.address.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[const Icon(Icons.place_outlined, size: 16, color: N11Colors.ink2), const SizedBox(width: 4), Expanded(child: Text(view.address, style: N11Text.caption))])),
            const SizedBox(height: N11Space.gap3),
            Wrap(
              spacing: N11Space.gap3,
              runSpacing: N11Space.gap2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                N11Chip(chip.label, key: const Key('shop-view-chip'), kind: chip.kind),
                N11Link('Xem giờ hoạt động ›', key: const Key('shop-view-hours'), onPressed: widget.onHours),
              ],
            ),
          ],
        ),
      ),
      if (!view.hasItems)
        N11InfoCard(key: const Key('shop-view-empty'), title: widget.emptyText)
      else ...<Widget>[
        TextField(
          key: const Key('shop-view-search'),
          controller: _search,
          onChanged: (String _) => setState(() {}),
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: N11Colors.black),
          decoration: InputDecoration(
            hintText: 'Tìm món trong quán',
            hintStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: N11Colors.placeholder),
            filled: true,
            fillColor: N11Colors.white,
            prefixIcon: const Icon(Icons.search, color: N11Colors.ink2),
            suffixIcon: _search.text.isEmpty ? null : IconButton(key: const Key('shop-view-search-clear'), tooltip: 'Xóa nội dung tìm kiếm', icon: const Icon(Icons.close, size: 20), onPressed: () => setState(_search.clear)),
            contentPadding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 14),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 2)),
          ),
        ),
        if (groups.isEmpty)
          const N11StateBlock(key: Key('shop-view-nomatch'), kind: StateKind.warn, icon: Icons.search_off, title: 'Không tìm thấy món phù hợp', text: 'Thử từ khóa khác.')
        else
          for (final PublicCategory category in groups) ...<Widget>[
            Row(children: <Widget>[Expanded(child: Text(category.name, style: N11Text.h2)), Text('${category.items.length} món', style: N11Text.caption)]),
            N11List(children: <Widget>[
              for (final PublicItem item in category.items)
                DishRow(
                  key: _rows.putIfAbsent(item.id, GlobalKey.new),
                  name: item.name,
                  price: formatVnd(item.priceVnd),
                  imageUrl: item.imageUrl,
                  highlight: item.id == _highlight,
                ),
            ]),
          ],
      ],
      if (widget.preview && widget.hiddenCount > 0) const Text('Món đang ẩn không hiển thị trong bản xem trước.', key: Key('preview-hidden-note'), style: N11Text.caption),
    ]);
  }
}

/// Q07: from SAVED data only (a draft is never previewed). Hidden and deleted dishes are not in it.
class PreviewScreen extends StatefulWidget {
  const PreviewScreen({super.key, required this.flows});

  final M02Flows flows;

  @override
  State<PreviewScreen> createState() => _PreviewScreenState();
}

class _PreviewScreenState extends State<PreviewScreen> {
  ShopOpsController get ops => widget.flows.ops;
  MenuListController get menu => widget.flows.menu;

  @override
  void initState() {
    super.initState();
    ops.session.addListener(_gone);
    menu.load();
    ops.refresh();
  }

  @override
  void dispose() {
    ops.session.removeListener(_gone);
    super.dispose();
  }

  void _gone() {
    if (ops.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[ops, menu]),
      builder: (BuildContext context, Widget? child) {
        final ShopOverview? o = ops.overview;
        final MenuSnapshot? snapshot = menu.snapshot;
        final List<Widget> body;
        if (menu.loadState == MenuLoad.notConnected) {
          body = const <Widget>[M02NotConnected(what: 'Thực đơn')];
        } else if (menu.loadState == MenuLoad.failed || ops.loadState == OpsLoad.failed) {
          body = <Widget>[M02LoadFailed(onRetry: () { ops.load(); menu.load(); })];
        } else if (o == null || snapshot == null) {
          body = const <Widget>[M02Skeleton(rows: 1, height: 110), M02Skeleton(rows: 4, height: 76)];
        } else {
          final ShopMenuView view = previewOf(name: o.name, address: o.addressText, reason: o.availability.reason, serverNow: o.availability.evaluatedAt, hours: o.hours, menu: snapshot);
          final bool shown = o.isActive && o.availability.reason != 'SERVICE_AREA_INACTIVE';
          body = <Widget>[
            if (!shown) const N11Banner(key: Key('preview-not-public'), kind: BannerKind.warn, title: 'Quán hiện chưa hiển thị cho khách', text: 'Đây là bản xem trước dành cho chủ quán. Khách chưa tìm thấy quán này.'),
            if (ops.stale || menu.loadState != MenuLoad.ready) const N11Banner(kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.'),
            ShopMenuContent(
              view: view,
              preview: true,
              hiddenCount: menu.hiddenCount,
              onHours: () => Navigator.of(context).push(n11Route(PublicHoursScreen(view: view))),
            ),
            if (shown)
              N11Button(
                key: const Key('preview-as-customer'),
                label: 'Xem như khách',
                kind: ButtonKind.secondary,
                onPressed: () => Navigator.of(context).push(n11Route(ShopPublicScreen(api: widget.flows.publicApi, shopId: o.shopId))),
              ),
          ];
        }
        return M02Scaffold(title: 'Xem trước thực đơn', content: body);
      },
    );
  }
}

/// K01: a customer opens a shop by its id (from the entry point that has it). Public fields only.
class ShopPublicScreen extends StatefulWidget {
  const ShopPublicScreen({super.key, required this.api, required this.shopId, this.focusItemId});

  final PublicShopApi api;
  final String shopId;

  /// A dish a search result pointed at: the screen scrolls to it.
  final String? focusItemId;

  @override
  State<ShopPublicScreen> createState() => _ShopPublicScreenState();
}

class _ShopPublicScreenState extends State<ShopPublicScreen> {
  late final PublicShopController _controller;
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _controller = PublicShopController(api: widget.api, shopId: widget.shopId)..load();
  }

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (BuildContext context, Widget? child) {
        final ShopMenuView? view = _controller.view;
        final List<Widget> body;
        switch (_controller.state) {
          case PublicLoad.idle:
          case PublicLoad.loading:
            body = const <Widget>[M02Skeleton(rows: 1, height: 110), M02Skeleton(rows: 4, height: 76)];
          case PublicLoad.notConnected:
            body = const <Widget>[M02NotConnected(what: 'Quán và thực đơn')];
          case PublicLoad.notFound:
            body = <Widget>[
              const N11StateBlock(kind: StateKind.warn, icon: Icons.help_outline, title: 'Không tìm thấy quán.', text: 'Liên kết có thể đã cũ hoặc quán không còn tồn tại.'),
              N11Button(key: const Key('k01-back'), label: 'Quay lại', onPressed: () => Navigator.of(context).maybePop()),
            ];
          case PublicLoad.unavailable:
            body = <Widget>[
              const N11StateBlock(kind: StateKind.warn, icon: Icons.storefront_outlined, title: 'Quán hiện không khả dụng', text: 'Bạn chưa xem được quán này lúc này. Vui lòng thử lại sau.'),
              N11Button(key: const Key('k01-retry'), label: 'Thử lại', onPressed: _controller.load),
              N11Button(key: const Key('k01-back'), label: 'Quay lại', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).maybePop()),
            ];
          case PublicLoad.failed:
            body = <Widget>[M02LoadFailed(onRetry: _controller.load)];
          case PublicLoad.ready:
            body = <Widget>[
              if (_controller.stale)
                N11Banner(
                  key: const Key('k01-stale'),
                  kind: BannerKind.warn,
                  title: 'Chưa cập nhật',
                  text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.',
                  trailing: N11Button(key: const Key('k01-reload'), label: 'Thử lại', compact: true, onPressed: _controller.load),
                ),
              ShopMenuContent(view: view!, preview: false, focusItemId: widget.focusItemId, onHours: () => Navigator.of(context).push(n11Route(PublicHoursScreen(view: view)))),
            ];
        }
        return M02Scaffold(title: view?.name ?? 'Quán', scrollController: _scroll, content: body);
      },
    );
  }
}

/// K02: the week as a customer reads it. Read only; today is marked from the SERVER's instant (Vietnam time), never the phone clock.
class PublicHoursScreen extends StatelessWidget {
  const PublicHoursScreen({super.key, required this.view});

  final ShopMenuView view;

  int? get _todayIndex {
    final DateTime? now = view.serverNow;
    if (now == null) {
      return null;
    }
    // Asia/Ho_Chi_Minh is UTC+7 all year: Monday = 0.
    return now.toUtc().add(const Duration(hours: 7)).weekday - 1;
  }

  @override
  Widget build(BuildContext context) {
    final int? today = _todayIndex;
    final bool overnight = view.hours.any((List<HourRange> d) => d.any((HourRange r) => r.kind == RangeKind.night));
    return M02Scaffold(
      title: 'Giờ hoạt động',
      content: <Widget>[
        if (!view.hasHours)
          const N11StateBlock(kind: StateKind.warn, icon: Icons.schedule, title: 'Quán chưa cài giờ hoạt động.', text: 'Bạn vẫn xem được thực đơn của quán.')
        else ...<Widget>[
          const Text('Giờ Việt Nam · chỉ xem', style: N11Text.caption),
          N11List(children: <Widget>[
            for (int d = 0; d < 7; d++)
              ScheduleRow(
                key: Key('k02-day-$d'),
                day: kDayNames[d],
                lines: dayLines(view.hours[d]),
                chip: d == today ? const N11Chip('Hôm nay', kind: ChipKind.yellow) : null,
              ),
          ]),
          if (overnight) const Text('Ca qua đêm: giờ đóng thuộc ngày hôm sau.', style: N11Text.caption),
        ],
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/discovery_controls.dart';
import '../m11/m11_rating_views.dart';
import '../m11/m11_source.dart';
import '../m11/m11_models.dart';
import '../m11/m11_widgets.dart';
import 'category_icons.dart';
import 'm02_flows.dart';
import 'm02_format.dart';
import 'm02_widgets.dart';
import 'menu_controller.dart';
import '../m10/m10_cart.dart';
import '../m10/m10_customer_views.dart';
import 'menu_models.dart';
import 'public_shop_controller.dart';
import 'schedule.dart';
import 'shop_contact.dart';
import 'shop_ops_controller.dart';

// Q07 (Xem trước thực đơn), K01 (khách xem quán và thực đơn) and K02 (giờ hoạt động phía khách). Q07 and K01 share one body, so the
// owner previews exactly what a customer gets. No basket, no order, no payment: M02 only shows.

({String label, ChipKind kind}) _chipOf(String reason) {
  switch (reason) {
    case 'STALE':
      return (label: 'Chưa cập nhật', kind: ChipKind.warn);
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
    this.stale = false,
    this.emptyText = 'Quán chưa có món để hiển thị.',
    this.focusItemId,
    this.orderShopId,
    this.ratings,
    this.ratingSource,
    this.ratingShopId,
    this.contactLauncher = const MethodChannelContactLauncher(),
  });

  /// Opens the dialer / Zalo / Messenger for the quick-contact buttons (issue #190). Tests pass a fake.
  final ContactLauncher contactLauncher;

  /// The shop being viewed by a CUSTOMER: when set (and orders exist in this app) each dish gets the + / − and a note sheet. Null in the owner's preview.
  final String? orderShopId;
  final Widget? ratings;
  final M11Source? ratingSource;
  final String? ratingShopId;
  final ShopMenuView view;
  final bool preview;
  bool get isPreviewMode => preview;
  final VoidCallback onHours;
  final int hiddenCount;
  final bool stale;
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
  Future<ShopReviewPage>? _ratingPage;

  @override
  void initState() {
    super.initState();
    _highlight = widget.focusItemId;
    _loadRatings();
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus());
  }

  void _loadRatings() {
    final M11Source? src = widget.ratingSource;
    final String? id = widget.ratingShopId;
    _ratingPage = (src != null && id != null && !widget.preview) ? src.publicShopReviews(id) : null;
  }

  @override
  void didUpdateWidget(ShopMenuContent old) {
    super.didUpdateWidget(old);
    if (old.ratingSource != widget.ratingSource || old.ratingShopId != widget.ratingShopId || old.preview != widget.preview) {
      _loadRatings();
    }
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

  OrderRuntime? get _orders => widget.preview || widget.orderShopId == null ? null : OrderRuntime.current;

  Widget? _stepper(BuildContext context, PublicItem item) {
    final OrderRuntime? runtime = _orders;
    if (runtime == null || widget.stale || widget.view.availabilityReason != 'ONLINE') {
      return null;
    }
    return DishStepper(cart: runtime.cart, shopId: widget.orderShopId!, shopName: widget.view.name, itemId: item.id, name: item.name, priceVnd: item.priceVnd, canOrder: runtime.canOrder);
  }

  Future<void> _openDish(BuildContext context, PublicItem item) async {
    final OrderRuntime? runtime = _orders;
    final String displayName = capitalizeFirst(item.name);
    if (runtime == null || !runtime.canOrder() || widget.stale || widget.view.availabilityReason != 'ONLINE') {
      await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => SafeArea(child: SingleChildScrollView(
        padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          Text(displayName, style: N11Text.h2), Text(formatVnd(item.priceVnd)),
          ExpandableDishDescription(text: item.description),
        ]))));
      return;
    }
    await showDishSheet(context, cart: runtime.cart, shopId: widget.orderShopId!, shopName: widget.view.name, itemId: item.id, name: displayName, priceVnd: item.priceVnd, description: item.description, canAdd: () => !widget.stale && widget.view.availabilityReason == 'ONLINE' && runtime.canOrder());
  }

  Widget _buildHeader(BuildContext context, ShopMenuView view, ({String label, ChipKind kind}) chip, {bool isNewShop = false, Widget? ratingWidget}) {
    return N11Card(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(width: 76, height: 76, child: ShopLogoImage(key: const Key('shop-view-logo'), url: view.logoUrl, bytes: view.logoBytes)),
          const SizedBox(width: N11Space.gap3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        capitalizeFirst(view.name),
                        key: const Key('shop-view-name'),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 18, height: 1.25, fontWeight: FontWeight.w700, color: N11Colors.black),
                      ),
                    ),
                    if (!widget.preview && !view.contact.isEmpty) ...<Widget>[
                      const SizedBox(width: N11Space.gap2),
                      ShopContactBar(contact: view.contact, launcher: widget.contactLauncher),
                    ],
                  ],
                ),
                if (widget.preview) const Padding(padding: EdgeInsets.only(top: 4), child: N11Chip('Xem trước', kind: ChipKind.dark)),
                if (view.address.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(capitalizeFirst(view.address), maxLines: 2, overflow: TextOverflow.ellipsis, style: N11Text.caption),
                  ),
                const SizedBox(height: N11Space.gap2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      N11Chip(chip.label, key: const Key('shop-view-chip'), kind: chip.kind),
                      if (isNewShop) ...<Widget>[
                        const SizedBox(width: 6),
                        const N11Chip('★ Quán mới', key: Key('shop-new-badge'), kind: ChipKind.yellow),
                      ],
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 5),
                        child: Text('•', style: N11Text.caption),
                      ),
                      InkWell(
                        key: const Key('shop-view-hours'),
                        onTap: widget.onHours,
                        borderRadius: BorderRadius.circular(6),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                          child: Text('Xem giờ hoạt động >', style: N11Text.link.copyWith(fontSize: 12.5)),
                        ),
                      ),
                    ],
                  ),
                ),
                if (ratingWidget != null) ratingWidget,
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ShopMenuView view = widget.view;
    final ({String label, ChipKind kind}) chip = _chipOf(widget.stale ? 'STALE' : view.availabilityReason);
    final String needle = foldVietnamese(_search.text.trim());
    final List<PublicCategory> groups = <PublicCategory>[
      for (final PublicCategory c in view.categories)
        PublicCategory(name: c.name, items: <PublicItem>[for (final PublicItem i in c.items) if (needle.isEmpty || foldVietnamese(i.name).contains(needle)) i]),
    ].where((PublicCategory c) => c.items.isNotEmpty).toList();
    final Widget header = _ratingPage != null
        ? FutureBuilder<ShopReviewPage>(
            future: _ratingPage,
            builder: (BuildContext context, AsyncSnapshot<ShopReviewPage> snapshot) {
              final RatingSummary? summary = snapshot.data?.summary;
              final bool failed = snapshot.hasError;
              final bool isNewShop = !failed && summary != null && summary.isEmpty;
              final Widget? ratingWidget = isNewShop
                  ? null
                  : _ShopRatingSummaryRow(
                      summary: summary,
                      failed: failed,
                      onRetry: () => setState(_loadRatings),
                      onTap: () => Navigator.of(context).push(
                        n11Route(ShopReviewsScreen(source: widget.ratingSource!, shopId: widget.ratingShopId!, title: capitalizeFirst(view.name))),
                      ),
                    );
              return _buildHeader(context, view, chip, isNewShop: isNewShop, ratingWidget: ratingWidget);
            },
          )
        : _buildHeader(context, view, chip, ratingWidget: widget.ratings);
    return vstack(<Widget>[
      header,
      if (!view.hasItems)
        N11InfoCard(key: const Key('shop-view-empty'), title: widget.emptyText)
      else ...<Widget>[
        N11SearchField(
          fieldKey: const Key('shop-view-search'),
          clearKey: const Key('shop-view-search-clear'),
          controller: _search,
          maxLength: null,
          hint: 'Tìm món trong quán',
          onChanged: (_) => setState(() {}),
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
                  name: capitalizeFirst(item.name),
                  price: formatVnd(item.priceVnd),
                  sub: (item.soldCount == null || item.soldCount == 0) ? null : 'Đã bán ${item.soldCount}',
                  imageUrl: item.imageUrl,
                  placeholderIcon: dishPlaceholderIconForCategory(category.name),
                  highlight: item.id == _highlight,
                  chip: _stepper(context, item),
                  onTap: () => _openDish(context, item),
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
          final ShopMenuView view = previewOf(name: o.name, address: o.addressText, reason: o.availability.reason, serverNow: o.availability.evaluatedAt, hours: o.hours, menu: snapshot, logoBytes: o.logo?.bytes);
          // Issue #190: customers see the shop only when it is set up (open now, or closed by its schedule); every other reason hides it.
          final bool shown = o.isActive && (o.availability.reason == 'ONLINE' || o.availability.reason == 'OUTSIDE_BUSINESS_HOURS');
          body = <Widget>[
            if (!shown) const N11Banner(key: Key('preview-not-public'), kind: BannerKind.warn, title: 'Quán hiện chưa hiển thị cho khách', text: 'Đây là bản xem trước dành cho chủ quán. Khách chưa tìm thấy quán này.'),
            if (ops.stale || menu.loadState != MenuLoad.ready) const N11Banner(kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.'),
            ShopMenuContent(
              view: view,
              preview: true,
              hiddenCount: menu.hiddenCount,
              onHours: () async {
                  await Navigator.of(context).push(n11Route(PublicHoursScreen(view: view)));
                  if (mounted) await ops.refresh();
                },
            ),
            if (shown)
              N11Button(
                key: const Key('preview-as-customer'),
                label: 'Xem như khách',
                kind: ButtonKind.secondary,
                onPressed: () => Navigator.of(context, rootNavigator: true).push(n11Route(ShopPublicScreen(api: widget.flows.publicApi, shopId: o.shopId))),
              ),
          ];
        }
        return M02Scaffold(title: 'Xem trước thực đơn', topStrip: const _PreviewModeStrip(), content: body);
      },
    );
  }
}

/// K01: a customer opens a shop by its id (from the entry point that has it). Public fields only.
class ShopPublicScreen extends StatefulWidget {
  const ShopPublicScreen({super.key, required this.api, required this.shopId, this.focusItemId, this.ratings, this.contactLauncher = const MethodChannelContactLauncher()});

  final ContactLauncher contactLauncher;

  final PublicShopApi api;
  final String shopId;

  /// A dish a search result pointed at: the screen scrolls to it.
  final String? focusItemId;

  /// M11: where the shop's public ratings come from. Null = no rating entry (preview, tests).
  final M11Source? ratings;

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
    _controller.freshness.observe();
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
              ShopMenuContent(
                view: view!,
                stale: _controller.stale,
                preview: false,
                orderShopId: widget.shopId,
                focusItemId: widget.focusItemId,
                contactLauncher: widget.contactLauncher,
                ratingSource: widget.ratings,
                ratingShopId: widget.shopId,
                onHours: () async {
                  await Navigator.of(context).push(n11Route(PublicHoursScreen(view: view)));
                  if (mounted) await _controller.freshness.reload();
                },
              ),
            ];
        }
        final OrderRuntime? orders = OrderRuntime.current;
        return M02Scaffold(
          title: view == null ? 'Quán' : capitalizeFirst(view.name),
          scrollController: _scroll,
          content: body,
          floatingFooter: view != null && orders != null ? CartBar(runtime: orders, shopId: widget.shopId) : null,
        );
      },
    );
  }
}

class _PreviewModeStrip extends StatelessWidget {
  const _PreviewModeStrip();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('preview-mode-strip'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: N11Space.pad, vertical: 6),
      decoration: const BoxDecoration(
        color: N11Colors.yellowSoft,
        border: Border(bottom: BorderSide(color: N11Colors.line)),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.visibility_outlined, size: 16, color: N11Colors.black),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Đang xem trước giao diện hiển thị với khách',
              style: N11Text.caption.copyWith(color: N11Colors.black, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// A real summary inside the shop information card; failure must never look like zero reviews.
class _ShopRatingSummaryRow extends StatelessWidget {
  const _ShopRatingSummaryRow({required this.summary, required this.failed, required this.onRetry, required this.onTap});

  final RatingSummary? summary;
  final bool failed;
  final VoidCallback onRetry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String label = failed
        ? 'Chưa tải được đánh giá · Thử lại'
        : summary == null
            ? 'Đang tải đánh giá…'
            : '${m11Average(summary!.average)}/5 · ${summary!.count} lượt đánh giá';
    return InkWell(
      key: const Key('k01-ratings'),
      onTap: failed ? onRetry : onTap,
      borderRadius: BorderRadius.circular(kRadiusControl),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: <Widget>[
          const Icon(Icons.star_rounded, color: N11Colors.yellowStrong, size: 18),
          const SizedBox(width: 4),
          Expanded(child: Text(label, key: const Key('shop-rating-summary'), style: N11Text.bodyStrong.copyWith(fontSize: 13))),
          Icon(failed ? Icons.refresh : Icons.chevron_right, color: N11Colors.ink2, size: 18),
        ]),
      ),
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


/// Issue #190, B: the shop's own phone and the three quick actions, inside the shop information card. A button exists only for a value the app
/// validated (see shop_contact.dart); one that cannot be opened (no app, no handler) never crashes: the number or link is copied and the person is
/// told. Dialing only opens the phone app with the number filled in; it never places the call.
class ShopContactBar extends StatelessWidget {
  const ShopContactBar({super.key, required this.contact, required this.launcher});

  final ShopContact contact;
  final ContactLauncher launcher;

  Future<void> _run(BuildContext context, Future<bool> Function() open, String copy, String what) async {
    bool opened = false;
    try {
      opened = await open();
    } on Object {
      opened = false;
    }
    if (opened || !context.mounted) return;
    await Clipboard.setData(ClipboardData(text: copy));
    if (context.mounted) m02Toast(context, 'Không mở được $what. Đã sao chép để bạn dán vào ứng dụng khác.');
  }

  Widget _iconAction(BuildContext context, {required Key key, required IconData icon, required String tooltip, required VoidCallback onPressed}) {
    return SizedBox(
      width: 34,
      height: 34,
      child: IconButton(
        key: key,
        tooltip: tooltip,
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints.tightFor(width: 34, height: 34),
        style: IconButton.styleFrom(
          backgroundColor: N11Colors.bg,
          foregroundColor: N11Colors.black,
          side: const BorderSide(color: N11Colors.line),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        icon: Icon(icon, size: 18),
        onPressed: onPressed,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final String? phone = contact.phone;
    final String? zalo = contact.zaloUrl;
    final String? messenger = contact.messengerUrl;
    if (phone == null && zalo == null && messenger == null) {
      return const SizedBox.shrink();
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (phone != null)
          _iconAction(
            context,
            key: const Key('shop-contact-call'),
            icon: Icons.call_outlined,
            tooltip: 'Gọi điện',
            onPressed: () => _run(context, () => launcher.dial(phone), phone, 'ứng dụng gọi điện'),
          ),
        if (zalo != null) ...<Widget>[
          if (phone != null) const SizedBox(width: 6),
          _iconAction(
            context,
            key: const Key('shop-contact-zalo'),
            icon: Icons.chat_outlined,
            tooltip: 'Zalo',
            onPressed: () => _run(context, () => launcher.openUrl(zalo), zalo, 'Zalo'),
          ),
        ],
        if (messenger != null) ...<Widget>[
          if (phone != null || zalo != null) const SizedBox(width: 6),
          _iconAction(
            context,
            key: const Key('shop-contact-messenger'),
            icon: Icons.forum_outlined,
            tooltip: 'Messenger',
            onPressed: () => _run(context, () => launcher.openUrl(messenger), messenger, 'Messenger'),
          ),
        ],
      ],
    );
  }
}

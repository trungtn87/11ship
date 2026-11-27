import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../addresses/address_controller.dart';
import '../addresses/address_models.dart';
import '../addresses/address_views.dart';
import '../flows/location.dart';
import '../m10/m10_cart.dart';
import '../m10/m10_customer_views.dart' show DishStepper;
import '../m11/m11_source.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/discovery_controls.dart';
import 'category_icons.dart';
import 'discovery_controller.dart';
import 'discovery_models.dart';
import 'm02_format.dart';
import 'm02_widgets.dart';
import 'menu_models.dart';
import 'preview_views.dart';
import 'route_distance.dart';

// M02-KP01/KP02/KP03: Owner layout 22/10/2026 (M02-home-shop-detail-UI-OWNER-20261022.md).
// Area, group chips, heading beside search/filters, then the shop list. Ratings and pickup coordinates come from the server; the distance is the ROAD distance from the foreground position (issue #190). Tapping a shop opens its menu (K01); tapping a dish opens its shop and lands on the dish.

Future<void> _openShop(
  BuildContext context,
  PublicShopApi publicApi,
  ShopCardData shop, {
  String? focusItemId,
  M11Source? ratings,
  Future<void> Function()? onReturn,
}) async {
  await Navigator.of(context, rootNavigator: true).push(
    n11Route(
      ShopPublicScreen(
        api: publicApi,
        shopId: shop.shopId,
        focusItemId: focusItemId,
        ratings: ratings,
      ),
    ),
  );
  if (context.mounted) await onReturn?.call();
}

({String label, ChipKind kind}) _stateChip(String reason) {
  switch (reason) {
    case 'ONLINE':
      return (label: 'Đang mở cửa', kind: ChipKind.ok);
    case 'OUTSIDE_BUSINESS_HOURS':
      return (label: 'Đã đóng cửa', kind: ChipKind.neutral);
    default:
      // Issue #190: a shop that is not set up is never listed (the server and the controller drop it); this is only the fallback of a chip.
      return (label: 'Chưa hiển thị', kind: ChipKind.neutral);
  }
}

/// Label of the shop-card distance (Home, Search, shop page). P6-4 / #294: the road runs shop -> the customer's CURRENT position; it is not the
/// delivery-fee distance, so the text never calls it that.
const String kShopRouteLabel = 'Quãng đường từ quán đến vị trí hiện tại';

/// The one line a card (Home and Search alike) shows for the distance. Issue #190: a number appears ONLY as a road distance; a missing position or
/// an unknown road says so. A straight-line estimate is never shown as a substitute.
String distanceLine(
  ShopCardData shop,
  RouteDistance distance,
  LocationFix? fix, {
  bool locating = false,
}) {
  if (locating) return 'Đang định vị…';
  switch (distance.kind) {
    case RouteDistanceKind.route:
      return '$kShopRouteLabel: ≈ ${RouteDistance.text(distance.meters!)}';
    case RouteDistanceKind.loading:
      return '$kShopRouteLabel: đang tính…';
    case RouteDistanceKind.noPosition:
      return '$kShopRouteLabel: chưa xác định';
    case RouteDistanceKind.unavailable:
      return '$kShopRouteLabel: chưa xác định';
  }
}

class ShopCard extends StatelessWidget {
  const ShopCard({
    super.key,
    required this.shop,
    required this.onTap,
    this.customerLocation,
    this.locating = false,
    this.distance = RouteDistance.noPosition,
    this.stale = false,
  });

  /// Kept for the shared card API; route distance never falls back to this location locally.
  final LocationFix? customerLocation;
  final RouteDistance distance;
  final bool locating;
  final ShopCardData shop;
  final bool stale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = stale
        ? (label: 'Chưa cập nhật', kind: ChipKind.warn)
        : _stateChip(shop.reason);
    final String rating = shop.ratingCount == 0 || shop.ratingAverage == null
        ? 'Chưa có đánh giá'
        : '${shop.ratingAverage!.toStringAsFixed(1)} (${shop.ratingCount} đánh giá)';
    final String distanceText = distanceLine(
      shop,
      distance,
      customerLocation,
      locating: locating,
    );
    return Semantics(
      button: true,
      label: '${shop.name}, $rating, $distanceText, ${chip.label}',
      excludeSemantics: true,
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: N11Colors.white,
          borderRadius: BorderRadius.circular(N11V5.cardRadius),
          boxShadow: N11V5.cardShadow,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(N11V5.cardRadius),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Container(
              constraints: const BoxConstraints(minHeight: 112),
              padding: const EdgeInsets.all(N11Space.gap3),
              decoration: BoxDecoration(
                border: Border.all(color: N11Colors.line),
                borderRadius: BorderRadius.circular(N11V5.cardRadius),
              ),
              child: LayoutBuilder(
                builder: (context, constraints) => Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    SizedBox(
                      width: constraints.maxWidth >= 400
                          ? 96
                          : N11V5.shopImageSize,
                      height: constraints.maxWidth >= 400
                          ? 96
                          : N11V5.shopImageSize,
                      child: ShopLogoImage(
                        key: Key('shop-logo-${shop.shopId}'),
                        url: shop.logoUrl,
                      ),
                    ),
                    const SizedBox(width: N11Space.gap3),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            shop.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 17,
                              height: 1.3,
                              fontWeight: FontWeight.w800,
                              color: N11Colors.black,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Row(
                            children: <Widget>[
                              const Icon(
                                Icons.star_rounded,
                                size: 17,
                                color: N11Colors.yellow,
                              ),
                              const SizedBox(width: 3),
                              Expanded(
                                child: Text(
                                  rating,
                                  key: Key('shop-rating-${shop.shopId}'),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: N11Text.caption,
                                ),
                              ),
                            ],
                          ),
                          if (shop.address.isNotEmpty)
                            Row(
                              children: <Widget>[
                                const Icon(
                                  Icons.place_outlined,
                                  size: 16,
                                  color: N11Colors.ink2,
                                ),
                                const SizedBox(width: 3),
                                Expanded(
                                  child: Text(
                                    shop.address,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: N11Text.caption,
                                  ),
                                ),
                              ],
                            ),
                          Row(
                            children: <Widget>[
                              const Icon(
                                Icons.route_outlined,
                                size: 16,
                                color: N11Colors.ink2,
                              ),
                              const SizedBox(width: 3),
                              Expanded(
                                child: Text(
                                  distanceText,
                                  key: Key('shop-distance-${shop.shopId}'),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: N11Text.caption,
                                ),
                              ),
                            ],
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: 5),
                            child: N11Chip(chip.label, kind: chip.kind),
                          ),
                        ],
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Icon(
                        Icons.chevron_right_rounded,
                        size: 20,
                        color: N11Colors.ink2,
                      ),
                    ),
                  ],
                ),
              ),
            ),
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
      child: Container(
        decoration: BoxDecoration(
          color: N11Colors.white,
          borderRadius: BorderRadius.circular(14),
          boxShadow: N11V5.warmSoftShadow,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            key: const Key('home-search'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(14),
            child: Container(
              constraints: const BoxConstraints(minHeight: 46),
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 10,
              ),
              decoration: BoxDecoration(
                border: Border.all(
                  color: N11Colors.line.withValues(alpha: 0.7),
                ),
                borderRadius: BorderRadius.circular(14),
              ),
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) => Row(
                  children: <Widget>[
                    const Icon(Icons.search, size: 20, color: N11Colors.ink2),
                    const SizedBox(width: N11Space.gap2),
                    Expanded(
                      child: Text(
                        constraints.maxWidth < 145
                            ? 'Tìm kiếm'
                            : 'Tìm quán hoặc món',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: N11Text.body.copyWith(
                          fontSize: 14.5,
                          color: N11Colors.ink2,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// KP01: the Home tab of 11Food. It owns its scrolling (pull to refresh, "Xem thêm").
class DiscoveryHome extends StatefulWidget {
  const DiscoveryHome({
    super.key,
    required this.controller,
    required this.publicApi,
    this.addresses,
    this.bell,
    this.ratings,
    this.position,
    this.onNotifyWhenShops,
  });

  final DiscoveryPosition? position;
  final DiscoveryController controller;
  final PublicShopApi publicApi;

  /// M05: optional signed-in delivery address book for the "Giao đến:" header.
  final AddressBookController? addresses;

  /// Navigation only (no API): the "Nhận tin khi có quán" button of the empty area. Null = no button.
  final VoidCallback? onNotifyWhenShops;

  /// M11: the public ratings of a shop, opened from its page. Null = no rating entry.
  final M11Source? ratings;

  /// M08: the notification bell (with its unread count). Null = the placeholder that says notifications are not built in this build.
  final Widget? bell;

  @override
  State<DiscoveryHome> createState() => _DiscoveryHomeState();
}

class _DiscoveryHomeState extends State<DiscoveryHome>
    with WidgetsBindingObserver {
  DiscoveryController get c => widget.controller;
  late final DiscoveryPosition _position = widget.position ?? c.position;
  bool _nearbyTab = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    c.freshness.observe();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      if (c.choicesState != DiscoveryLoad.ready) await c.start();
      if (mounted) await c.locate(source: _position);
      final AddressBookController? addresses = widget.addresses;
      if (mounted &&
          addresses != null &&
          addresses.session?.status == SessionStatus.signedIn &&
          addresses.loadState == AddressLoad.idle) {
        unawaited(addresses.load());
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        c.choicesState == DiscoveryLoad.ready) {
      unawaited(c.locate(source: _position));
    }
  }

  Future<void> _openFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: N11Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(kRadiusCard)),
      ),
      builder: (BuildContext context) => FilterSheet(controller: c),
    );
  }

  Future<void> _openSearch() async {
    final String? area = c.areaId;
    if (area == null) {
      m02Toast(
        context,
        'Chưa xác định được khu vực từ GPS. Hãy thử định vị lại.',
      );
      return;
    }
    await Navigator.of(context).push(
      n11Route(
        SearchScreen(
          api: c.api,
          publicApi: widget.publicApi,
          ratings: widget.ratings,
          areaId: area,
          position: _position,
          discovery: c,
          retryPosition: () => c.locate(source: _position, force: true),
        ),
      ),
    );
    if (mounted) await c.freshness.reload();
  }

  bool get _gpsResolved =>
      _position.fix != null &&
      !c.resolvingArea &&
      !c.areaResolutionFailed &&
      !c.outsideCoverage &&
      c.area != null;

  Widget _padded(Widget child, {double bottom = N11Space.gap3}) => Padding(
    padding: EdgeInsets.fromLTRB(N11Space.pad, 0, N11Space.pad, bottom),
    child: child,
  );

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[
        c,
        _position,
        c.distances,
        if (widget.addresses != null) widget.addresses!,
      ]),
      builder: (BuildContext context, Widget? child) {
        // Road distances: asked after the frame, only for cards not known yet (a pure lookup otherwise), so a rebuild never becomes a request.
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) unawaited(c.distances.want(c.shops, _position.fix));
          // Issue #411: the featured rule needs the rating of more than the first page (see kRankingPoolCap).
          if (mounted && kHomeFeaturedShopsEnabled) unawaited(c.fillRankingPool());
        });
        final List<Widget> body = <Widget>[
          _padded(_headerWithLocate(), bottom: 10),
        ];
        switch (c.choicesState) {
          case DiscoveryLoad.idle:
          case DiscoveryLoad.loading:
            body.add(_padded(const M02Skeleton(rows: 1, height: 48)));
            body.add(_padded(const M02Skeleton(rows: 4, height: 84)));
          case DiscoveryLoad.notConnected:
            body.add(_padded(const M02NotConnected(what: 'Danh sách quán')));
          case DiscoveryLoad.failed:
            body.add(_padded(_failed(() => c.start())));
          case DiscoveryLoad.ready:
            body.addAll(_ready());
        }
        final bool inheritedGradient = N11PageBackground.maybeOf(context) != null;
        final Widget content = SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: () =>
                c.choicesState == DiscoveryLoad.ready ? c.refresh() : c.start(),
            child: ListView(
              key: const Key('home-list'),
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(
                0,
                4,
                0,
                N11Space.gap8 + 16,
              ),
              children: body,
            ),
          ),
        );
        final Widget shellBody = inheritedGradient
            ? content
            : Container(
                key: const Key('home-gradient'),
                decoration: const BoxDecoration(gradient: N11V5.homeGradient),
                child: content,
              );
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: const SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: Brightness.dark,
            statusBarBrightness: Brightness.light,
            systemStatusBarContrastEnforced: false,
          ),
          child: shellBody,
        );
      },
    );
  }

  Widget _headerWithLocate() {
    final bool locatingNow = _position.loading || c.resolvingArea;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _header(),
        if (!_gpsResolved && !locatingNow)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: _PositionButton(
                position: _position,
                resolving: c.resolvingArea,
                failed: c.areaResolutionFailed,
                outsideCoverage: c.outsideCoverage,
                retry: () => c.locate(source: _position, force: true),
                inlineWithArea: true,
              ),
            ),
          ),
      ],
    );
  }

  /// Compact top header: single-line `Giao đến: <address>` selector (and optional bell on the right).
  Widget _header() {
    final DeliveryAddress? saved = widget.addresses?.defaultAddress;
    final String? savedText = saved == null
        ? null
        : (saved.addressText.trim().isNotEmpty
              ? saved.addressText.trim()
              : (saved.displayName?.trim() ?? ''));
    final bool locatingNow = c.resolvingArea || _position.loading;
    final String areaLabel = c.area == null
        ? (locatingNow
              ? 'Đang tìm vị trí…'
              : c.outsideCoverage
              ? 'Ngoài khu vực phục vụ'
              : 'Chưa xác định khu vực')
        : c.manualArea
        ? '${c.area!.name} · tham khảo'
        : _position.failure != null
        ? '${c.area!.name} · vị trí gần nhất'
        : c.area!.name;
    final String displayAddress = (savedText != null && savedText.isNotEmpty)
        ? savedText
        : areaLabel;
    final AddressBookController? addresses = widget.addresses;
    final bool canOpenAddressBook =
        addresses != null &&
        (addresses.session == null ||
            addresses.session!.status == SessionStatus.signedIn);
    void onAddressTap() {
      if (canOpenAddressBook) {
        Navigator.of(
          context,
        ).push(n11Route(AddressBookScreen(controller: addresses)));
      } else if (c.area == null ||
          _position.failure != null ||
          c.areaResolutionFailed ||
          c.outsideCoverage) {
        unawaited(c.locate(source: _position, force: true));
      } else if (addresses != null) {
        m02Toast(context, 'Đăng nhập để quản lý địa chỉ giao hàng.');
      }
    }

    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 40),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Align(
              alignment: Alignment.centerLeft,
              child: Semantics(
                button: true,
                label: 'Giao đến: $displayAddress',
                excludeSemantics: true,
                onTap: onAddressTap,
                child: InkWell(
                  key: const Key('home-area'),
                  borderRadius: BorderRadius.circular(kRadiusPill),
                  onTap: onAddressTap,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 2,
                      vertical: 6,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        const Icon(
                          Icons.location_on_rounded,
                          size: 16,
                          color: N11Colors.accentOrange,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            'Giao đến: $displayAddress',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              height: 1.25,
                              fontWeight: FontWeight.w700,
                              color: N11Colors.black,
                            ),
                          ),
                        ),
                        const SizedBox(width: 2),
                        const Icon(
                          Icons.keyboard_arrow_down_rounded,
                          size: 17,
                          color: N11Colors.black,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (widget.bell != null) ...<Widget>[
            const SizedBox(width: 4),
            widget.bell!,
          ],
        ],
      ),
    );
  }

  Widget _failed(VoidCallback retry) => Column(
    children: <Widget>[
      const N11StateBlock(
        kind: StateKind.warn,
        title: 'Không tải được dữ liệu',
        text: 'Chưa nhận được dữ liệu từ máy chủ nên chưa hiển thị được danh sách quán. Kiểm tra kết nối mạng rồi thử lại nhé.',
      ),
      const SizedBox(height: N11Space.gap4),
      N11Button(
        key: const Key('home-retry'),
        label: 'Thử lại',
        onPressed: retry,
      ),
    ],
  );

  List<Widget> _ready() {
    final List<Widget> out = <Widget>[];
    // Pill search field + standalone brand-yellow square filter button (no heavy yellow outer wrapper).
    out.add(
      _padded(
        Row(
          children: <Widget>[
            Expanded(child: _FakeField(onTap: _openSearch)),
            const SizedBox(width: 10),
            Semantics(
              button: true,
              label: c.filtersActive ? 'Bộ lọc đang bật' : 'Bộ lọc',
              excludeSemantics: true,
              onTap: _openFilters,
              child: Material(
                color: N11Colors.yellow,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  key: const Key('home-filter'),
                  borderRadius: BorderRadius.circular(14),
                  onTap: _openFilters,
                  child: Tooltip(
                    message: c.filtersActive ? 'Bộ lọc đang bật' : 'Bộ lọc',
                    child: SizedBox(
                      width: 46,
                      height: 46,
                      child: Icon(
                        Icons.tune,
                        size: 22,
                        color: c.filtersActive
                            ? N11Colors.accentOrange
                            : N11Colors.black,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        bottom: 10,
      ),
    );
    // Horizontal category strip sitting directly on the warm cream background (no box-in-box wrapper).
    if (c.categories.isNotEmpty) {
      out.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: SingleChildScrollView(
            key: const Key('home-v5-category-row'),
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(
              horizontal: N11Space.pad,
              vertical: 2,
            ),
            child: Row(
              children: <Widget>[
                _chip(
                  'home-cat-all',
                  'Tất cả',
                  c.categoryId == null,
                  () => c.categoryId == null
                      ? null
                      : c.toggleCategory(c.categoryId!),
                  icon: kCategoryAllIcon,
                  last: c.categories.isEmpty,
                ),
                for (int i = 0; i < c.categories.length; i++)
                  _chip(
                    'home-cat-${c.categories[i].id}',
                    c.categories[i].name,
                    c.categoryId == c.categories[i].id,
                    () => c.toggleCategory(c.categories[i].id),
                    categoryId: c.categories[i].id,
                    categoryName: c.categories[i].name,
                    icon: categoryIconFor(
                      c.categories[i].id,
                      name: c.categories[i].name,
                    ),
                    last: i == c.categories.length - 1,
                  ),
              ],
            ),
          ),
        ),
      );
    }
    if (c.stale) {
      out.add(
        _padded(
          N11Banner(
            key: const Key('home-stale'),
            kind: BannerKind.warn,
            title: 'Chưa cập nhật',
            text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.',
            trailing: N11Button(
              key: const Key('home-reload'),
              label: 'Thử lại',
              compact: true,
              onPressed: c.refresh,
            ),
          ),
        ),
      );
    }
    Widget fallbackHeading() => _padded(
      Text(
        'Quán gần bạn',
        key: const Key('home-v5-section-title'),
        style: N11Text.title.copyWith(
          fontSize: 19,
          height: 26 / 19,
          fontWeight: FontWeight.w800,
          color: N11Colors.black,
        ),
      ),
      bottom: 8,
    );
    if (c.outsideCoverage) {
      out.add(fallbackHeading());
      out.add(
        _padded(
          const N11InfoCard(
            key: Key('home-outside-coverage'),
            title: 'Khu vực này chưa được phục vụ',
            text: 'Hiện chưa thể giao hàng tới vị trí này.',
          ),
        ),
      );
    }
    if (c.areas.isEmpty) {
      if (!c.outsideCoverage) {
        out.add(fallbackHeading());
        out.add(
          _padded(
            const EmptyState(
              icon: Icons.place_outlined,
              title: 'Chưa có khu vực phục vụ',
              text:
                  'Hiện chưa có khu vực nào đang phục vụ. Vui lòng quay lại sau.',
            ),
          ),
        );
      }
      return out;
    }
    if (c.areaId == null) {
      if (!c.outsideCoverage) {
        out.add(fallbackHeading());
        out.add(
          _padded(
            Text(
              c.resolvingArea || _position.loading
                  ? 'Đang tìm khu vực phục vụ theo vị trí hiện tại…'
                  : 'Chưa xác định được khu vực theo GPS. Hãy thử định vị lại để xem các quán gần bạn.',
              key: const Key('home-location-needed'),
              style: N11Text.lead,
            ),
          ),
        );
      }
      // Optional recovery ONLY on real GPS/resolve failure. Never require a manual area
      // during ordinary startup, and never misrepresent a manually browsed area as GPS.
      if (_position.failure != null || c.areaResolutionFailed) {
        out.add(
          _padded(
            const Text(
              'Hoặc xem quán theo khu vực tham khảo:',
              style: N11Text.body,
            ),
            bottom: 8,
          ),
        );
        for (final AreaChoice a in c.areas) {
          out.add(
            _padded(
              N11ChoiceCard(
                key: Key('fallback-area-${a.id}'),
                title: a.name,
                selected: false,
                onTap: () => c.chooseArea(a.id),
              ),
              bottom: 8,
            ),
          );
        }
      }
      return out;
    }
    switch (c.listState) {
      case DiscoveryLoad.idle:
      case DiscoveryLoad.loading:
        out.add(fallbackHeading());
        out.add(_padded(const M02Skeleton(rows: 4, height: 84)));
      case DiscoveryLoad.notConnected:
        out.add(fallbackHeading());
        out.add(_padded(const M02NotConnected(what: 'Danh sách quán')));
      case DiscoveryLoad.failed:
        out.add(fallbackHeading());
        out.add(_padded(_failed(c.refresh)));
      case DiscoveryLoad.ready:
        if (c.shops.isEmpty) {
          if (!c.filtersActive) {
            out.add(
              _padded(
                Column(
                  key: const Key('home-no-shops'),
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const N11InfoCard(
                      title: 'Chưa có quán đang phục vụ',
                      text: 'Khu vực này chưa có quán nào sẵn sàng nhận đơn. Bạn có thể nhận tin khi có quán mới.',
                    ),
                    if (widget.onNotifyWhenShops != null) ...<Widget>[
                      const SizedBox(height: N11Space.gap2),
                      N11Button(
                        key: const Key('home-notify-cta'),
                        label: 'Nhận tin khi có quán',
                        kind: ButtonKind.secondary,
                        onPressed: widget.onNotifyWhenShops,
                      ),
                    ],
                  ],
                ),
              ),
            );
          } else {
            out.add(
              _padded(
                const EmptyState(
                  key: Key('home-empty'),
                  icon: Icons.restaurant,
                  title: 'Chưa có quán phù hợp',
                  text: 'Không có quán nào khớp bộ lọc hiện tại.',
                ),
              ),
            );
          }
          if (c.filtersActive) {
            out.add(
              _padded(
                N11Button(
                  key: const Key('home-clear'),
                  label: 'Xóa bộ lọc',
                  kind: ButtonKind.secondary,
                  onPressed: c.reset,
                ),
              ),
            );
          }
        } else {
          final List<ShopCardData> orderedShops = _nearbyTab && _position.fix != null
              ? nearbyByRoadDistance(
                  c.shops,
                  (ShopCardData s) => c.distances.of(s, _position.fix),
                )
              : featuredOrder(c.shops);
          out.add(_sortTabs());
          if (_nearbyTab && _position.fix == null && !_position.loading) {
            out.add(
              const Padding(
                padding: EdgeInsets.fromLTRB(N11Space.pad, 0, N11Space.pad, 8),
                child: Text(
                  'Bật vị trí để xem quán gần bạn theo khoảng cách đường đi.',
                  key: Key('home-nearby-note'),
                  style: N11Text.caption,
                ),
              ),
            );
          }
          for (final ShopCardData shop in orderedShops) {
            out.add(
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  N11Space.pad,
                  0,
                  N11Space.pad,
                  12,
                ),
                child: HomeShopFullCard(
                  key: Key('shop-${shop.shopId}'),
                  shop: shop,
                  dishes: c.dishesForShop(shop.shopId),
                  distance: c.distances.of(shop, _position.fix),
                  locating: _position.loading,
                  stale: c.stale,
                  onTap: () => _openShop(
                    context,
                    widget.publicApi,
                    shop,
                    ratings: widget.ratings,
                    onReturn: c.freshness.reload,
                  ),
                  onTapDish: (DishHit dish) => _openShop(
                    context,
                    widget.publicApi,
                    shop,
                    focusItemId: dish.itemId,
                    ratings: widget.ratings,
                    onReturn: c.freshness.reload,
                  ),
                ),
              ),
            );
          }
          if (c.hasMore) {
            out.add(
              _padded(
                Center(
                  child: N11Button(
                    key: const Key('home-load-more'),
                    label: c.loadingMore ? 'Đang tải thêm…' : 'Xem thêm quán',
                    kind: ButtonKind.secondary,
                    compact: true,
                    onPressed: c.loadingMore ? null : c.loadMore,
                  ),
                ),
                bottom: 8,
              ),
            );
          }
        }
    }
    return out;
  }

  Widget _sortTabs() {
    Widget tab({
      required Key key,
      required IconData icon,
      required String label,
      required bool active,
      required VoidCallback onTap,
    }) {
      final Color fg = active
          ? N11Colors.accentOrange
          : const Color(0xFF6B6255);
      return Expanded(
        child: Semantics(
          button: true,
          selected: active,
          label: label,
          excludeSemantics: true,
          onTap: onTap,
          child: InkWell(
            key: key,
            borderRadius: BorderRadius.circular(kRadiusPill),
            onTap: onTap,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(icon, size: 17, color: fg),
                    const SizedBox(width: 6),
                    Flexible(
                      child: AnimatedDefaultTextStyle(
                        duration: const Duration(milliseconds: 200),
                        style: DefaultTextStyle.of(context).style.copyWith(
                          fontSize: 14,
                          height: 1.2,
                          fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                          color: fg,
                        ),
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(N11Space.pad, 2, N11Space.pad, 12),
      child: Container(
        key: const Key('home-sort-tabs'),
        height: 44,
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: const Color(0xFFF1E7D2),
          borderRadius: BorderRadius.circular(kRadiusPill),
        ),
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final double pillWidth = constraints.maxWidth / 2;
            return Stack(
              children: <Widget>[
                AnimatedAlign(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOutCubic,
                  alignment: _nearbyTab
                      ? Alignment.centerRight
                      : Alignment.centerLeft,
                  child: Container(
                    width: pillWidth,
                    height: double.infinity,
                    decoration: BoxDecoration(
                      color: N11Colors.white,
                      borderRadius: BorderRadius.circular(kRadiusPill),
                      boxShadow: N11V5.warmSoftShadow,
                    ),
                  ),
                ),
                Row(
                  children: <Widget>[
                    tab(
                      key: const Key('home-tab-featured'),
                      icon: Icons.local_fire_department_rounded,
                      label: 'Nổi bật',
                      active: !_nearbyTab,
                      onTap: () => setState(() => _nearbyTab = false),
                    ),
                    tab(
                      key: const Key('home-tab-nearby'),
                      icon: Icons.location_on_rounded,
                      label: 'Gần bạn',
                      active: _nearbyTab,
                      onTap: () => setState(() => _nearbyTab = true),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _chip(
    String key,
    String label,
    bool on,
    VoidCallback? onTap, {
    String? categoryId,
    String? categoryName,
    required IconData icon,
    bool last = false,
  }) => Padding(
    padding: EdgeInsets.only(right: last ? 0 : 10),
    child: Semantics(
      selected: on,
      button: true,
      label: label,
      excludeSemantics: true,
      child: Container(
        decoration: BoxDecoration(
          color: on ? N11Colors.homeCategorySelected : N11Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: on
              ? Border.all(color: N11Colors.accentOrange, width: 1.2)
              : null,
          boxShadow: on ? null : N11V5.warmSoftShadow,
        ),
        child: Material(
          key: Key(key),
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              width: 82,
              constraints: const BoxConstraints(minHeight: 76),
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 8),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: on
                          ? N11Colors.accentOrange.withValues(alpha: 0.14)
                          : categoryIconBgFor(categoryId),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      icon,
                      size: 19,
                      color: categoryIconColorFor(
                        categoryId,
                        name: categoryName,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    label,
                    maxLines: 2,
                    softWrap: true,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: N11Text.caption.copyWith(
                      fontSize: 11.5,
                      height: 1.2,
                      fontWeight: on ? FontWeight.w800 : FontWeight.w700,
                      color: on ? N11Colors.accentOrange : N11Colors.homeInk,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Short distance for the Home tile only: a road distance as "1,3 km" (never a number without a route), otherwise one short word.
/// The full road wording stays in the tile's semantics label, and [distanceLine] is unchanged for Search and the shop detail.
String homeDistanceText(RouteDistance distance, {bool locating = false}) {
  if (locating) return 'Đang tìm…';
  switch (distance.kind) {
    case RouteDistanceKind.route:
      return RouteDistance.text(distance.meters!);
    case RouteDistanceKind.loading:
      return 'Đang tính…';
    case RouteDistanceKind.noPosition:
    case RouteDistanceKind.unavailable:
      return 'Chưa rõ';
  }
}

/// Full-width balanced shop card for Home: 70% visual weight on the shop info row, 30% on a compact horizontal dish-chip strip.
class HomeShopFullCard extends StatelessWidget {
  const HomeShopFullCard({
    super.key,
    required this.shop,
    required this.onTap,
    this.dishes = const <DishHit>[],
    this.onTapDish,
    this.distance = RouteDistance.noPosition,
    this.locating = false,
    this.stale = false,
  });

  final ShopCardData shop;
  final VoidCallback onTap;
  final List<DishHit> dishes;
  final void Function(DishHit dish)? onTapDish;
  final RouteDistance distance;
  final bool locating;
  final bool stale;

  @override
  Widget build(BuildContext context) {
    final bool rated = shop.ratingCount > 0 && shop.ratingAverage != null;
    final String score = rated ? shop.ratingAverage!.toStringAsFixed(1) : '';
    final String? realDistance = !locating &&
            distance.kind == RouteDistanceKind.route &&
            distance.meters != null
        ? RouteDistance.text(distance.meters!)
        : null;
    final String statusLabel = stale
        ? 'Chưa cập nhật'
        : (shop.open ? 'Đang mở' : 'Đã đóng cửa');
    final Color statusDotColor = stale
        ? N11Colors.warning
        : (shop.open ? N11Colors.success : N11Colors.ink3);
    final String metaLine = (shop.open || stale)
        ? (realDistance != null ? '$statusLabel • $realDistance' : statusLabel)
        : (realDistance ?? '');
    final String semanticsMeta = (shop.open || stale)
        ? metaLine
        : (realDistance != null ? 'Đã đóng cửa • $realDistance' : 'Đã đóng cửa');
    final bool closedNoLogo =
        !shop.open && (shop.logoUrl == null || shop.logoUrl!.isEmpty);
    final List<DishHit> shownDishes = dishes.take(3).toList();

    return Semantics(
      button: true,
      label:
          '${shop.name}, ${rated ? '$score sao' : 'chưa có đánh giá'}, $semanticsMeta',
      excludeSemantics: true,
      onTap: onTap,
      child: Opacity(
        opacity: shop.open ? 1.0 : 0.74,
        child: Container(
          decoration: BoxDecoration(
            color: N11Colors.white,
            borderRadius: BorderRadius.circular(kRadiusCard),
            boxShadow: N11V5.warmCardShadow,
          ),
          child: Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(kRadiusCard),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(kRadiusCard),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        SizedBox(
                          key: Key('shop-image-frame-${shop.shopId}'),
                          width: 78,
                          height: 78,
                          child: Stack(
                            fit: StackFit.expand,
                            children: <Widget>[
                              ShopLogoImage(
                                key: Key('shop-logo-${shop.shopId}'),
                                url: shop.logoUrl,
                                aspectRatio: null,
                                borderRadius: 12,
                                backgroundColor: closedNoLogo
                                    ? const Color(0xFFEAE4D9)
                                    : const Color(0xFFFFF4CC),
                                iconColor: N11Colors.homeLocateInk
                                    .withValues(alpha: 0.45),
                                iconSize: 30,
                                hideFallbackIcon: !shop.open,
                              ),
                              if (!shop.open && !stale)
                                Positioned.fill(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(12),
                                    child: ColoredBox(
                                      color:
                                          Colors.black.withValues(alpha: 0.44),
                                      child: Center(
                                        child: Padding(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 4,
                                          ),
                                          child: Text(
                                            'Đã đóng cửa',
                                            key: Key(
                                              'shop-status-${shop.shopId}',
                                            ),
                                            textAlign: TextAlign.center,
                                            style: const TextStyle(
                                              fontSize: 10.5,
                                              height: 1.15,
                                              fontWeight: FontWeight.w700,
                                              color: N11Colors.white,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              if (rated)
                                Positioned(
                                  bottom: 4,
                                  left: 4,
                                  right: 4,
                                  child: Center(
                                    child: Container(
                                      key: Key('shop-rating-${shop.shopId}'),
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 7,
                                        vertical: 2,
                                      ),
                                      decoration: BoxDecoration(
                                        color: N11Colors.white,
                                        borderRadius: BorderRadius.circular(
                                          kRadiusPill,
                                        ),
                                        boxShadow: const <BoxShadow>[
                                          BoxShadow(
                                            color: Color(0x1F000000),
                                            blurRadius: 4,
                                            offset: Offset(0, 1),
                                          ),
                                        ],
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: <Widget>[
                                          const Icon(
                                            Icons.star_rounded,
                                            size: 12,
                                            color: N11Colors.accentOrange,
                                          ),
                                          const SizedBox(width: 2),
                                          Text(
                                            score,
                                            style: const TextStyle(
                                              fontSize: 11,
                                              height: 1.15,
                                              fontWeight: FontWeight.w800,
                                              color: N11Colors.black,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 78),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: <Widget>[
                                Text(
                                  shop.name,
                                  key: Key('shop-name-${shop.shopId}'),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 15.5,
                                    height: 1.28,
                                    fontWeight: FontWeight.w800,
                                    color: N11Colors.black,
                                  ),
                                ),
                                if (metaLine.isNotEmpty) ...<Widget>[
                                  const SizedBox(height: 8),
                                  Row(
                                    children: <Widget>[
                                      if (shop.open || stale) ...<Widget>[
                                        Container(
                                          width: 6,
                                          height: 6,
                                          decoration: BoxDecoration(
                                            color: statusDotColor,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                        const SizedBox(width: 5),
                                      ] else ...<Widget>[
                                        const Icon(
                                          Icons.location_on_outlined,
                                          size: 13,
                                          color: N11Colors.ink3,
                                        ),
                                        const SizedBox(width: 3),
                                      ],
                                      Expanded(
                                        child: Text(
                                          metaLine,
                                          key: Key(
                                            'shop-distance-${shop.shopId}',
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontSize: 12.5,
                                            height: 1.25,
                                            fontWeight: FontWeight.w600,
                                            color: stale
                                                ? N11Colors.warning
                                                : N11Colors.ink2,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (shownDishes.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 10),
                      SingleChildScrollView(
                        key: Key('shop-dishes-${shop.shopId}'),
                        scrollDirection: Axis.horizontal,
                        child: IntrinsicHeight(
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              for (int i = 0; i < shownDishes.length; i++) ...<Widget>[
                                if (i > 0) const SizedBox(width: 8),
                                _DishPreviewChip(
                                  dish: shownDishes[i],
                                  onTap: () => onTapDish?.call(shownDishes[i]),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _compactDishPrice(int priceVnd) {
  if (priceVnd >= 1000 && priceVnd % 1000 == 0) {
    return '${priceVnd ~/ 1000}k';
  }
  return formatVnd(priceVnd);
}

class _DishPreviewChip extends StatelessWidget {
  const _DishPreviewChip({required this.dish, required this.onTap});

  final DishHit dish;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    Widget fallback() => const ColoredBox(
      color: Color(0xFFFFF3CC),
      child: Center(
        child: Icon(
          Icons.restaurant_rounded,
          size: 16,
          color: N11Colors.accentOrange,
        ),
      ),
    );
    return Material(
      color: const Color(0xFFFFFAF0),
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        key: Key('shop-dish-${dish.itemId}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 162,
          padding: const EdgeInsets.all(5),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFF3E4C6)),
          ),
          child: Row(
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: 36,
                  height: 36,
                  child: dish.imageUrl != null && dish.imageUrl!.isNotEmpty
                      ? Image.network(
                          dish.imageUrl!,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => fallback(),
                        )
                      : fallback(),
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      dish.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.2,
                        fontWeight: FontWeight.w600,
                        color: N11Colors.black,
                      ),
                    ),
                    if (dish.priceVnd > 0)
                      Text(
                        _compactDishPrice(dish.priceVnd),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11.5,
                          height: 1.2,
                          fontWeight: FontWeight.w700,
                          color: N11Colors.accentOrange,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum HomeShopCardStyle { featured, nearby }

/// Compact Home shop card: 16:10 image with overlay badges (no mid-card status
/// pill), closed dark overlay, and a strict 2-line body (name + real metadata).
/// Search keeps [ShopCard].
class HomeShopTile extends StatelessWidget {
  const HomeShopTile({
    super.key,
    required this.shop,
    required this.onTap,
    this.customerLocation,
    this.locating = false,
    this.distance = RouteDistance.noPosition,
    this.stale = false,
    this.keyScope = '',
    this.style = HomeShopCardStyle.nearby,
  });

  /// Issue #411: prefix of the inner keys (rating, distance) so the featured row and the nearby row never share a key.
  final String keyScope;
  final HomeShopCardStyle style;
  final LocationFix? customerLocation;
  final RouteDistance distance;
  final bool locating;
  final ShopCardData shop;
  final bool stale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = stale
        ? (label: 'Chưa cập nhật', kind: ChipKind.warn)
        : _stateChip(shop.reason);
    // Only a real rating is shown: no count of zero and no invented score.
    final bool rated = shop.ratingCount > 0 && shop.ratingAverage != null;
    final String score = rated ? shop.ratingAverage!.toStringAsFixed(1) : '';
    final String shortDistance = homeDistanceText(distance, locating: locating);
    final String fullDistance = 'Quãng đường đường bộ từ quán đến vị trí hiện tại: $shortDistance';
    final bool featured = style == HomeShopCardStyle.featured;
    return Semantics(
      button: true,
      label:
          '${shop.name}, ${rated ? '$score sao' : 'chưa có đánh giá'}, $fullDistance, ${chip.label}',
      excludeSemantics: true,
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: N11Colors.white,
          borderRadius: BorderRadius.circular(N11V5.cardRadius),
          boxShadow: N11V5.cardShadow,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(N11V5.cardRadius),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(N11V5.cardRadius),
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(
                  color: N11Colors.line.withValues(alpha: 0.85),
                ),
                borderRadius: BorderRadius.circular(N11V5.cardRadius),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AspectRatio(
                    key: Key('${keyScope}shop-image-frame-${shop.shopId}'),
                    aspectRatio: 16 / 10,
                    child: Stack(
                      fit: StackFit.expand,
                      children: <Widget>[
                        ShopLogoImage(
                          key: Key('${keyScope}shop-logo-${shop.shopId}'),
                          url: shop.logoUrl,
                          aspectRatio: null,
                          clipRadius: BorderRadius.vertical(
                            top: Radius.circular(N11V5.cardRadius - 1),
                          ),
                          backgroundColor: const Color(0xFFFFF4CC),
                          iconColor: N11Colors.homeLocateInk.withValues(
                            alpha: 0.45,
                          ),
                          iconSize: 32,
                        ),
                        if (!shop.open && !stale)
                          Positioned.fill(
                            child: ColoredBox(
                              color: Colors.black.withValues(alpha: 0.44),
                              child: Center(
                                child: Container(
                                  key: Key(
                                    '${keyScope}shop-status-${shop.shopId}',
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.72),
                                    borderRadius: BorderRadius.circular(
                                      kRadiusPill,
                                    ),
                                  ),
                                  child: const Text(
                                    'Đã đóng cửa',
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      height: 1.2,
                                      fontWeight: FontWeight.w700,
                                      color: N11Colors.white,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          )
                        else if (stale)
                          Positioned(
                            top: N11Space.gap2,
                            left: N11Space.gap2,
                            child: Container(
                              key: Key('${keyScope}shop-status-${shop.shopId}'),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: N11Colors.warningSoft,
                                borderRadius: BorderRadius.circular(kRadiusPill),
                              ),
                              child: const Text(
                                'Chưa cập nhật',
                                style: TextStyle(
                                  fontSize: 11,
                                  height: 1.2,
                                  fontWeight: FontWeight.w700,
                                  color: N11Colors.warning,
                                ),
                              ),
                            ),
                          )
                        else
                          Positioned(
                            top: N11Space.gap2,
                            left: N11Space.gap2,
                            child: Container(
                              key: Key('${keyScope}shop-status-${shop.shopId}'),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: featured
                                    ? const Color(0xFFFFEFE0)
                                    : N11Colors.successSoft,
                                borderRadius: BorderRadius.circular(kRadiusPill),
                              ),
                              child: featured
                                  ? const Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: <Widget>[
                                        Icon(
                                          Icons.local_fire_department_rounded,
                                          size: 13,
                                          color: N11Colors.accentOrange,
                                        ),
                                        SizedBox(width: 3),
                                        Text(
                                          'Yêu thích',
                                          style: TextStyle(
                                            fontSize: 11,
                                            height: 1.2,
                                            fontWeight: FontWeight.w700,
                                            color: Color(0xFF9A3412),
                                          ),
                                        ),
                                      ],
                                    )
                                  : const Text(
                                      'Mở cửa',
                                      style: TextStyle(
                                        fontSize: 11,
                                        height: 1.2,
                                        fontWeight: FontWeight.w700,
                                        color: N11Colors.successInk,
                                      ),
                                    ),
                            ),
                          ),
                        if (rated && featured)
                          Positioned(
                            top: N11Space.gap2,
                            right: N11Space.gap2,
                            child: Container(
                              key: Key('${keyScope}shop-rating-${shop.shopId}'),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: N11Colors.white,
                                borderRadius: BorderRadius.circular(kRadiusPill),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: <Widget>[
                                  const Icon(
                                    Icons.star_rounded,
                                    size: 13,
                                    color: N11Colors.yellow,
                                  ),
                                  const SizedBox(width: 2),
                                  Text(
                                    score,
                                    style: N11Text.caption.copyWith(
                                      fontSize: 11,
                                      height: 1.2,
                                      fontWeight: FontWeight.w800,
                                      color: N11Colors.black,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          shop.name,
                          key: Key('${keyScope}shop-name-${shop.shopId}'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14.5,
                            height: 1.3,
                            fontWeight: FontWeight.w800,
                            color: N11Colors.black,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: <Widget>[
                            if (rated) ...<Widget>[
                              const Icon(
                                Icons.star_rounded,
                                size: 14,
                                color: N11Colors.yellow,
                              ),
                              const SizedBox(width: 2),
                              Text(
                                score,
                                key: featured
                                    ? null
                                    : Key('${keyScope}shop-rating-${shop.shopId}'),
                                style: N11Text.caption.copyWith(
                                  fontSize: 12,
                                  height: 1.25,
                                  fontWeight: FontWeight.w700,
                                  color: N11Colors.black,
                                ),
                              ),
                              Text(
                                ' • ',
                                style: N11Text.caption.copyWith(
                                  fontSize: 12,
                                  height: 1.25,
                                  color: N11Colors.ink2,
                                ),
                              ),
                            ] else ...<Widget>[
                              const Icon(
                                Icons.route_outlined,
                                size: 13,
                                color: N11Colors.ink2,
                              ),
                              const SizedBox(width: 3),
                            ],
                            Expanded(
                              child: Text(
                                shortDistance,
                                key: Key(
                                  '${keyScope}shop-distance-${shop.shopId}',
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: N11Text.caption.copyWith(
                                  fontSize: 12,
                                  height: 1.25,
                                  fontWeight: FontWeight.w600,
                                  color: N11Colors.ink2,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Issue #411: a Home carousel shows at most this many shop cards.
const int kHomeCarouselCardLimit = 5;

/// Issue #411 (Owner 21/11): "Quán nổi bật" is shown above "Quán gần bạn".
const bool kHomeFeaturedShopsEnabled = true;

/// Issue #411 (Owner 21/11): a featured shop has an average of at least 4.0 stars AND at least 5 visible customer reviews.
const double kFeaturedMinAverage = 4.0;
const int kFeaturedMinReviews = 5;

/// True when the shop meets the featured rule (real review data only).
bool isFeaturedRated(ShopCardData s) => s.ratingAverage != null && s.ratingCount >= kFeaturedMinReviews && s.ratingAverage! >= kFeaturedMinAverage;

/// Issue #411 (Owner 21/11): the featured order of the loaded shops, the same for "Quán nổi bật" and for "Quán gần bạn" without GPS.
/// Open shops come before closed shops; within each group:
/// 1) shops that meet the rule: higher average first, then more reviews, then name;
/// 2) the rest, newest creation date first (a shop with no date last, in server order). Each shop appears once.
/// Never invents a rating or a date: an unrated shop shows as unrated.
List<ShopCardData> featuredOrder(List<ShopCardData> shops) {
  final Set<String> seen = <String>{};
  final List<(int, ShopCardData)> unique = <(int, ShopCardData)>[
    for (final (int i, ShopCardData s) in shops.indexed)
      if (seen.add(s.shopId)) (i, s),
  ];
  List<ShopCardData> rankGroup(Iterable<(int, ShopCardData)> group) {
    final List<(int, ShopCardData)> rated = group.where((r) => isFeaturedRated(r.$2)).toList()
      ..sort((a, b) {
        final int byAverage = b.$2.ratingAverage!.compareTo(a.$2.ratingAverage!);
        if (byAverage != 0) return byAverage;
        final int byCount = b.$2.ratingCount.compareTo(a.$2.ratingCount);
        if (byCount != 0) return byCount;
        final int byName = a.$2.name.compareTo(b.$2.name);
        return byName != 0 ? byName : a.$1.compareTo(b.$1);
      });
    final List<(int, ShopCardData)> rest = group.where((r) => !isFeaturedRated(r.$2)).toList()
      ..sort((a, b) {
        final DateTime? da = a.$2.createdAt;
        final DateTime? db = b.$2.createdAt;
        if (da != null && db != null && da != db) return db.compareTo(da);
        if ((da == null) != (db == null)) return da == null ? 1 : -1;
        return a.$1.compareTo(b.$1);
      });
    return <ShopCardData>[for (final r in rated) r.$2, for (final r in rest) r.$2];
  }

  return <ShopCardData>[
    ...rankGroup(unique.where((r) => r.$2.open)),
    ...rankGroup(unique.where((r) => !r.$2.open)),
  ];
}

/// Issue #411 "Quán gần bạn": open shops first, then known ROAD distance nearest first; unknown distances keep server order.
/// No straight-line distance is used.
List<ShopCardData> nearbyByRoadDistance(
  List<ShopCardData> shops,
  RouteDistance Function(ShopCardData shop) distanceOf,
) {
  final List<RouteDistance> distances = <RouteDistance>[for (final ShopCardData s in shops) distanceOf(s)];
  int? metersAt(int i) => distances[i].kind == RouteDistanceKind.route ? distances[i].meters : null;
  final List<int> order = List<int>.generate(shops.length, (int i) => i);
  order.sort((int a, int b) {
    if (shops[a].open != shops[b].open) return shops[a].open ? -1 : 1;
    final int? ma = metersAt(a);
    final int? mb = metersAt(b);
    if (ma != null && mb != null && ma != mb) return ma.compareTo(mb);
    if ((ma == null) != (mb == null)) return ma == null ? 1 : -1;
    return a.compareTo(b);
  });
  return <ShopCardData>[for (final int i in order) shops[i]];
}

/// Issue #411: one Home section of "Quán nổi bật" / "Quán gần bạn" — section header (`title` + `Xem tất cả >`) and ONE horizontal row
/// of at most [kHomeCarouselCardLimit] shop cards peeking past the right edge.
class HomeShopSection extends StatelessWidget {
  const HomeShopSection({
    super.key,
    required this.sectionId,
    required this.title,
    required this.shops,
    required this.onOpenShop,
    required this.onSeeAll,
    this.titleKey,
    this.style = HomeShopCardStyle.nearby,
    this.cardWidthFraction = 0.53,
    this.cardMinWidth = 166.0,
    this.cardMaxWidth = 220.0,
    this.distanceOf,
    this.customerLocation,
    this.locating = false,
    this.stale = false,
    this.note,
  });

  /// Keys only: `<sectionId>-section`, `<sectionId>-carousel`, `<sectionId>-see-all`, `<sectionId>-note`.
  final String sectionId;
  final String title;
  final Key? titleKey;
  final HomeShopCardStyle style;
  final double cardWidthFraction;
  final double cardMinWidth;
  final double cardMaxWidth;
  final List<ShopCardData> shops;
  final void Function(ShopCardData shop) onOpenShop;
  final VoidCallback onSeeAll;
  final RouteDistance Function(ShopCardData shop)? distanceOf;
  final LocationFix? customerLocation;
  final bool locating;
  final bool stale;

  /// A short honest line above the row (for example "turn on location"), or null.
  final String? note;

  @override
  Widget build(BuildContext context) {
    final List<ShopCardData> shown = shops.take(kHomeCarouselCardLimit).toList();
    // The featured row repeats shops of the nearby row: its keys carry their own prefix so a finder never matches two.
    final String keyScope = sectionId == 'home-featured' ? 'featured-' : '';
    return Column(
      key: Key('$sectionId-section'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(N11Space.pad, 0, N11Space.pad, 8),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  title,
                  key: titleKey,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: N11Text.title.copyWith(
                    fontSize: 19,
                    height: 26 / 19,
                    fontWeight: FontWeight.w800,
                    color: N11Colors.black,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Semantics(
                button: true,
                label: 'Xem tất cả $title',
                excludeSemantics: true,
                onTap: onSeeAll,
                child: InkWell(
                  key: Key('$sectionId-see-all'),
                  borderRadius: BorderRadius.circular(kRadiusPill),
                  onTap: onSeeAll,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          'Xem tất cả',
                          style: TextStyle(
                            fontSize: 13.5,
                            height: 1.2,
                            fontWeight: FontWeight.w700,
                            color: N11Colors.accentOrange,
                          ),
                        ),
                        SizedBox(width: 2),
                        Icon(
                          Icons.chevron_right_rounded,
                          size: 18,
                          color: N11Colors.accentOrange,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (note != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(N11Space.pad, 0, N11Space.pad, N11Space.gap2),
            child: Text(note!, key: Key('$sectionId-note'), style: N11Text.caption),
          ),
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints box) {
            final double cardWidth = (box.maxWidth * cardWidthFraction)
                .clamp(cardMinWidth, cardMaxWidth)
                .toDouble();
            return SingleChildScrollView(
              key: Key('$sectionId-carousel'),
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(N11Space.pad, 2, N11Space.pad, 6),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (int i = 0; i < shown.length; i++) ...<Widget>[
                      SizedBox(
                        width: cardWidth,
                        child: HomeShopTile(
                          key: Key('${keyScope}shop-${shown[i].shopId}'),
                          keyScope: keyScope,
                          style: style,
                          shop: shown[i],
                          stale: stale,
                          customerLocation: customerLocation,
                          locating: locating,
                          distance: distanceOf?.call(shown[i]) ?? RouteDistance.noPosition,
                          onTap: () => onOpenShop(shown[i]),
                        ),
                      ),
                      if (i < shown.length - 1) const SizedBox(width: N11Space.gap3),
                    ],
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

/// Issue #411 "Xem tất cả" of "Quán gần bạn": every loaded shop of the same list as Home, two per row, scrolling DOWN (no 5-card limit).
/// The next page loads near the end of the list or with "Xem thêm". "Quay lại" returns to Home, which keeps its scroll position.
class NearbyShopsAllScreen extends StatefulWidget {
  const NearbyShopsAllScreen({
    super.key,
    required this.controller,
    required this.position,
    required this.onOpenShop,
    this.featured = false,
  });

  final DiscoveryController controller;
  final DiscoveryPosition position;
  final void Function(ShopCardData shop) onOpenShop;

  /// Issue #411 (Owner 21/11): "Quán nổi bật" — the featured order, no distance. False = "Quán gần bạn" (featured order only without GPS).
  final bool featured;

  @override
  State<NearbyShopsAllScreen> createState() => _NearbyShopsAllScreenState();
}

class _NearbyShopsAllScreenState extends State<NearbyShopsAllScreen> {
  final ScrollController _scroll = ScrollController();
  DiscoveryController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_maybeLoadMore);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _maybeLoadMore() {
    if (!_scroll.hasClients) return;
    final ScrollPosition p = _scroll.position;
    if (p.pixels >= p.maxScrollExtent - 240) unawaited(c.loadMore());
  }

  @override
  Widget build(BuildContext context) {
    final bool hasGradient = N11PageBackground.maybeOf(context) != null;
    return N11PageBackdrop(
      fallbackColor: N11Colors.white,
      child: Scaffold(
        key: Key(widget.featured ? 'featured-all-screen' : 'nearby-all-screen'),
        backgroundColor: hasGradient ? Colors.transparent : N11Colors.white,
        appBar: AppBar(
          title: Text(widget.featured ? 'Quán nổi bật' : 'Quán gần bạn'),
          backgroundColor: hasGradient ? Colors.transparent : N11Colors.white,
          foregroundColor: N11Colors.black,
          elevation: 0,
        ),
        body: SafeArea(
          child: ListenableBuilder(
            listenable: Listenable.merge(<Listenable>[c, widget.position, c.distances]),
            builder: (BuildContext context, Widget? child) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) unawaited(c.distances.want(c.shops, widget.position.fix));
              });
              // Issue #411: featured order (no distance) for "Quán nổi bật" and without GPS; road distance order with GPS.
              final bool byFeatured = widget.featured || widget.position.fix == null;
              final List<ShopCardData> shops = byFeatured
                  ? featuredOrder(c.shops)
                  : nearbyByRoadDistance(
                      c.shops,
                      (ShopCardData s) => c.distances.of(s, widget.position.fix),
                    );
              if (shops.isEmpty && c.listState == DiscoveryLoad.ready) {
                return const EmptyState(
                  key: Key('nearby-all-empty'),
                  icon: Icons.place_outlined,
                  title: 'Chưa có quán nào',
                  text: 'Khu vực này chưa có quán nào sẵn sàng nhận đơn.',
                );
              }
              final int rows = (shops.length + 1) ~/ 2;
              return ListView.builder(
                key: const Key('nearby-all-list'),
                controller: _scroll,
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap2, N11Space.pad, N11Space.gap8),
                itemCount: rows + 1,
                itemBuilder: (BuildContext context, int index) {
                  if (index == rows) return _footer();
                  final int i = index * 2;
                  HomeShopTile tile(ShopCardData s) => HomeShopTile(
                        key: Key('shop-${s.shopId}'),
                        style: widget.featured
                            ? HomeShopCardStyle.featured
                            : HomeShopCardStyle.nearby,
                        shop: s,
                        stale: c.stale,
                        customerLocation: widget.position.fix,
                        distance: c.distances.of(s, widget.position.fix),
                        locating: widget.position.loading,
                        onTap: () => widget.onOpenShop(s),
                      );
                  return Padding(
                    padding: const EdgeInsets.only(bottom: N11Space.gap3),
                    child: IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Expanded(child: tile(shops[i])),
                          const SizedBox(width: N11Space.gap3),
                          Expanded(child: i + 1 < shops.length ? tile(shops[i + 1]) : const SizedBox.shrink()),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _footer() {
    if (c.loadingMore) {
      return const Padding(
        key: Key('nearby-all-loading'),
        padding: EdgeInsets.symmetric(vertical: N11Space.gap3),
        child: Center(child: Text('Đang tải…', style: N11Text.caption)),
      );
    }
    if (c.hasMore) {
      return N11Button(
        key: const Key('nearby-all-more'),
        label: 'Xem thêm',
        kind: ButtonKind.secondary,
        onPressed: c.loadMore,
      );
    }
    return const SizedBox.shrink();
  }
}

/// KP03: group and open-only filters; the area follows foreground GPS and is not editable.
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
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(N11Space.gap4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(
                children: <Widget>[
                  const Expanded(child: Text('Bộ lọc', style: N11Text.h2)),
                  IconButton(
                    key: const Key('filter-close'),
                    tooltip: 'Đóng',
                    constraints: const BoxConstraints(
                      minWidth: kTapMin,
                      minHeight: kTapMin,
                    ),
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: N11Space.gap2),
              if (c.area != null)
                Text(
                  'Khu vực: ${c.area!.name}${c.manualArea ? ' (tham khảo)' : ' (theo GPS)'}',
                  style: N11Text.caption,
                ),
              const SizedBox(height: N11Space.gap3),
              const Text('Nhóm món', style: N11Text.label),
              const SizedBox(height: N11Space.gap2),
              Wrap(
                spacing: N11Space.gap2,
                runSpacing: N11Space.gap2,
                children: <Widget>[
                  for (final CategoryChoice cat in c.categories)
                    _pick(
                      'filter-cat-${cat.id}',
                      cat.name,
                      _category == cat.id,
                      () => setState(
                        () => _category = _category == cat.id ? null : cat.id,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: N11Space.gap3),
              SwitchListTile(
                key: const Key('filter-open'),
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'Chỉ quán đang mở cửa',
                  style: N11Text.bodyStrong,
                ),
                value: _open,
                activeThumbColor: N11Colors.yellowStrong,
                onChanged: (bool v) => setState(() => _open = v),
              ),
              const SizedBox(height: N11Space.gap3),
              Row(
                children: <Widget>[
                  Expanded(
                    child: N11Button(
                      key: const Key('filter-reset'),
                      label: 'Đặt lại',
                      kind: ButtonKind.secondary,
                      onPressed: () => setState(() {
                        _category = null;
                        _open = false;
                      }),
                    ),
                  ),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(
                    flex: 2,
                    child: N11Button(
                      key: const Key('filter-apply'),
                      label: 'Áp dụng',
                      onPressed: () {
                        final NavigatorState navigator = Navigator.of(context);
                        c.apply(
                          area: c.areaId,
                          category: _category,
                          open: _open,
                        );
                        navigator.pop();
                      },
                    ),
                  ),
                ],
              ),
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
          decoration: BoxDecoration(
            color: on ? N11Colors.yellow : N11Colors.white,
            border: Border.all(color: on ? N11Colors.yellow : N11Colors.line),
            borderRadius: BorderRadius.circular(kRadiusPill),
          ),
          // widthFactor 1: the chip is as wide as its text (a Wrap inside a stretched column must not stretch it into a full-width bar).
          child: Center(
            widthFactor: 1,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: N11Colors.black,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// KP02: search over shop names and dish names in the chosen area, in two tabs. Hủy leaves; the typed term stays while the person moves
/// between the tabs; results of an older term never show under a newer one.
class SearchScreen extends StatefulWidget {
  const SearchScreen({
    super.key,
    required this.api,
    required this.publicApi,
    this.ratings,
    required this.areaId,
    this.categoryId,
    this.openOnly = false,
    this.position,
    this.debounce = const Duration(milliseconds: 350),
    this.discovery,
    this.retryPosition,
  });

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
  late final DishSearchController _search = DishSearchController(
    api: widget.api,
    areaId: widget.areaId,
    categoryId: widget.categoryId,
    openOnly: widget.openOnly,
    debounce: widget.debounce,
  );
  late final DiscoveryPosition _position =
      widget.position ?? DiscoveryPosition();
  final TextEditingController _text = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.discovery?.addListener(_areaChanged);
    _search.freshness.observe();
  }

  void _areaChanged() => _search.setArea(widget.discovery?.areaId);

  /// Home's controller when Search was opened from it (one cache: the same shop shows the same road distance in both), otherwise its own.
  late final RouteDistanceController _distances =
      widget.discovery?.distances ?? RouteDistanceController(api: widget.api);

  @override
  void dispose() {
    if (widget.discovery == null) _distances.dispose();
    if (widget.position == null) _position.dispose();
    widget.discovery?.removeListener(_areaChanged);
    _search.dispose();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool hasGradient = N11PageBackground.maybeOf(context) != null;
    return N11PageBackdrop(
      child: Scaffold(
        backgroundColor: hasGradient ? Colors.transparent : N11Colors.bg,
        body: SafeArea(
          child: ListenableBuilder(
            listenable: Listenable.merge(<Listenable>[
              _search,
              _position,
              _distances,
              if (widget.discovery != null) widget.discovery!,
            ]),
            builder: (BuildContext context, Widget? child) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) {
                  unawaited(_distances.want(_search.groupedShops, _position.fix));
                }
              });
              return Column(
                children: <Widget>[
                  Container(
                    padding: const EdgeInsets.fromLTRB(
                      N11Space.pad,
                      N11Space.gap2,
                      4,
                      N11Space.gap2,
                    ),
                    decoration: BoxDecoration(
                      color: hasGradient ? Colors.transparent : N11Colors.white,
                      border: Border(
                        bottom: BorderSide(
                          color: hasGradient
                              ? const Color(0x14191919)
                              : N11Colors.line,
                        ),
                      ),
                    ),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: N11SearchField(
                            fieldKey: const Key('search-field'),
                            clearKey: const Key('search-clear'),
                            controller: _text,
                            autofocus: true,
                            onChanged: _search.setTerm,
                          ),
                        ),
                        TextButton(
                          key: const Key('search-cancel'),
                          style: TextButton.styleFrom(
                            minimumSize: const Size(kTapMin, kTapMin),
                          ),
                          onPressed: () => Navigator.of(context).maybePop(),
                          child: const Text(
                            'Hủy',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: N11Colors.black,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  _PositionButton(
                    position: _position,
                    retry: widget.retryPosition,
                    resolving: widget.discovery?.resolvingArea ?? false,
                    failed: widget.discovery?.areaResolutionFailed ?? false,
                    outsideCoverage: widget.discovery?.outsideCoverage ?? false,
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(
                        N11Space.pad,
                        N11Space.gap3,
                        N11Space.pad,
                        N11Space.gap8,
                      ),
                      children: _results(),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  List<Widget> _results() {
    final DishSearchController s = _search;
    Widget gap(Widget w) => Padding(
      padding: const EdgeInsets.only(bottom: N11Space.gap3),
      child: w,
    );
    if (widget.discovery != null && widget.discovery!.areaId == null) {
      return <Widget>[
        const Text(
          'Chưa xác định khu vực theo GPS. Hãy quay lại trang chủ và thử định vị lại.',
        ),
      ];
    }
    if (!s.hasTerm) {
      return <Widget>[
        const EmptyState(
          icon: Icons.search,
          title: 'Tìm quán hoặc món',
          text: 'Gõ tên quán hoặc tên món. Không cần gõ dấu.',
        ),
      ];
    }
    switch (s.state) {
      case DiscoveryLoad.idle:
      case DiscoveryLoad.loading:
        return <Widget>[const M02Skeleton(rows: 4, height: 76)];
      case DiscoveryLoad.notConnected:
        return <Widget>[const M02NotConnected(what: 'Tìm kiếm')];
      case DiscoveryLoad.failed:
        return <Widget>[
          const N11StateBlock(
            kind: StateKind.warn,
            title: 'Không tải được dữ liệu',
            text: 'Chưa nhận được kết quả từ máy chủ. Từ khóa của bạn vẫn được giữ.',
          ),
          const SizedBox(height: N11Space.gap4),
          N11Button(
            key: const Key('search-retry'),
            label: 'Thử lại',
            onPressed: s.run,
          ),
        ];
      case DiscoveryLoad.ready:
        break;
    }
    final int count = s.groupedShops.length;
    if (count == 0) {
      return <Widget>[
        const N11StateBlock(
          kind: StateKind.warn,
          icon: Icons.search_off,
          title: 'Không có kết quả',
          text: 'Thử tên quán hoặc tên món khác.',
        ),
        const SizedBox(height: N11Space.gap4),
        N11Button(
          key: const Key('search-clear-term'),
          label: 'Xóa từ khóa',
          kind: ButtonKind.secondary,
          onPressed: () {
            _text.clear();
            _search.setTerm('');
            setState(() {});
          },
        ),
      ];
    }
    return <Widget>[
      if (s.stale)
        gap(
          const N11Banner(
            key: Key('search-stale'),
            kind: BannerKind.warn,
            title: 'Chưa cập nhật',
            text: 'Đang hiển thị kết quả đã tải.',
          ),
        ),
      for (final ShopCardData shop in s.groupedShops) ...<Widget>[
        gap(
          ShopCard(
            key: Key('result-shop-${shop.shopId}'),
            shop: shop,
            stale: s.stale,
            customerLocation: _position.fix,
            distance: _distances.of(shop, _position.fix),
            locating: _position.loading,
            onTap: () => _openShop(
              context,
              widget.publicApi,
              shop,
              ratings: widget.ratings,
              onReturn: s.freshness.reload,
            ),
          ),
        ),
        for (final DishHit dish in s.dishes.where(
          (DishHit d) => d.shop.shopId == shop.shopId,
        ))
          gap(
            _DishResult(
              key: Key('result-dish-${dish.itemId}'),
              dish: dish,
              stale: s.stale,
              onTap: () => _openShop(
                context,
                widget.publicApi,
                shop,
                focusItemId: dish.itemId,
                ratings: widget.ratings,
                onReturn: s.freshness.reload,
              ),
            ),
          ),
        gap(
          TextButton(
            key: Key('search-all-${shop.shopId}'),
            onPressed: () => _openShop(
              context,
              widget.publicApi,
              shop,
              ratings: widget.ratings,
              onReturn: s.freshness.reload,
            ),
            child: const Text('Xem tất cả'),
          ),
        ),
      ],
      if (s.hasMore)
        gap(
          N11Button(
            key: const Key('search-more'),
            label: s.loadingMore ? 'Đang tải…' : 'Xem thêm',
            kind: ButtonKind.secondary,
            loading: s.loadingMore,
            onPressed: s.loadingMore ? null : s.loadMore,
          ),
        ),
    ];
  }
}

class _DishResult extends StatelessWidget {
  const _DishResult({
    super.key,
    required this.dish,
    required this.onTap,
    this.stale = false,
  });

  final DishHit dish;
  final bool stale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = stale
        ? (label: 'Chưa cập nhật', kind: ChipKind.warn)
        : _stateChip(dish.shop.reason);
    final Widget? quantity =
        !stale && dish.shop.open && OrderRuntime.current != null
        ? DishStepper(
            cart: OrderRuntime.current!.cart,
            shopId: dish.shop.shopId,
            shopName: dish.shop.name,
            itemId: dish.itemId,
            name: dish.name,
            priceVnd: dish.priceVnd,
            canOrder: OrderRuntime.current!.canOrder,
          )
        : null;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: N11Colors.white,
        border: Border.all(color: N11Colors.line),
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(N11Space.gap3),
            child: LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final bool stacked =
                    constraints.maxWidth < 360 ||
                    MediaQuery.textScalerOf(context).scale(16) > 21;
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    DishThumb(url: dish.imageUrl, size: 72),
                    const SizedBox(width: N11Space.gap3),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            dish.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: N11Text.bodyStrong,
                          ),
                          const SizedBox(height: N11Space.gap1),
                          Text(
                            formatVnd(dish.priceVnd),
                            style: N11Text.bodyStrong,
                          ),
                          if (dish.soldCount != null)
                            Text(
                              'Đã bán ${dish.soldCount}',
                              style: N11Text.caption,
                            ),
                          Text(
                            dish.shop.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: N11Text.caption,
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: N11Space.gap1),
                            child: N11Chip(chip.label, kind: chip.kind),
                          ),
                          if (quantity != null && stacked)
                            Padding(
                              padding: const EdgeInsets.only(
                                top: N11Space.gap2,
                              ),
                              child: quantity,
                            ),
                        ],
                      ),
                    ),
                    if (quantity != null && !stacked) quantity,
                    if (quantity == null)
                      const Icon(
                        Icons.chevron_right,
                        size: 22,
                        color: N11Colors.ink2,
                      ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _PositionButton extends StatelessWidget {
  const _PositionButton({
    required this.position,
    this.retry,
    this.resolving = false,
    this.failed = false,
    this.outsideCoverage = false,
    this.inlineWithArea = false,
  });
  final DiscoveryPosition position;
  final VoidCallback? retry;
  final bool resolving;
  final bool failed;
  final bool outsideCoverage;
  final bool inlineWithArea;
  @override
  Widget build(BuildContext context) {
    if (position.fix != null && !resolving && !failed && !outsideCoverage) {
      return const SizedBox.shrink();
    }
    final bool busy = position.loading || resolving;
    final String label = inlineWithArea
        ? (busy
              ? 'Đang tìm vị trí…'
              : position.failure == LocationFailure.denied
              ? 'Cấp quyền vị trí'
              : position.failure == LocationFailure.disabled
              ? 'Bật vị trí'
              : outsideCoverage
              ? 'Ngoài khu vực phục vụ · Thử lại'
              : 'Chưa xác định vị trí · Thử lại')
        : (busy
              ? 'Đang tìm vị trí…'
              : position.failure == LocationFailure.denied
              ? 'Cấp quyền vị trí'
              : position.failure == LocationFailure.disabled
              ? 'Bật vị trí'
              : 'Thử lại');
    // Figma F01 inline action: white pill, border #E7B628, radius 15, at least 78x30, Bold 12 #A65300.
    return Padding(
      padding: inlineWithArea ? EdgeInsets.zero : const EdgeInsets.only(left: N11Space.gap2),
      child: Material(
        color: N11Colors.white,
        shape: const RoundedRectangleBorder(
          side: BorderSide(color: N11Colors.homeLocateBorder),
          borderRadius: BorderRadius.all(Radius.circular(15)),
        ),
        child: InkWell(
          key: const Key('discovery-locate'),
          borderRadius: const BorderRadius.all(Radius.circular(15)),
          onTap: busy ? null : retry ?? position.locate,
          // Exactly 30 high (a Center here would take the whole 48 px header height); at least 78 wide.
          child: Container(
            height: 30,
            constraints: const BoxConstraints(minWidth: 78),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Center(
              widthFactor: 1,
              child: inlineWithArea
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        const Icon(
                          Icons.my_location,
                          size: 15,
                          color: N11Colors.homeLocateInk,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: N11Colors.homeLocateInk,
                            ),
                          ),
                        ),
                      ],
                    )
                  : Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: N11Colors.homeLocateInk,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

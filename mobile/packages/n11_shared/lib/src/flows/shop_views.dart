import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../features.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'location.dart';
import 'shop_controller.dart';

// F20-F23 on Android, laid out like docs/ui/m01-food-web.md: start (read the server first), profile form with the pickup position,
// and "Cửa hàng của tôi". The form values live in [ShopController], so going to another screen and back loses nothing.

String shopStatusLabel(String status) {
  switch (status) {
    case 'INCOMPLETE':
      return 'Chưa hoàn tất';
    case 'ACTIVE':
      return 'Đã hoàn tất';
    case 'DISABLED':
      return 'Bị khóa';
    default:
      return 'Không rõ';
  }
}

Widget _shopFailure(ShopController controller) {
  final AuthFailure? failure = controller.failure;
  if (failure == null) {
    return const SizedBox.shrink();
  }
  return N11Banner(
    key: const Key('shop-error'),
    kind: BannerKind.error,
    title: 'Chưa hoàn tất',
    text: failureMessage(failure),
    trailing: controller.hasPendingWrite && canRetryFailure(failure)
        ? N11Button(key: const Key('shop-retry'), label: 'Thử lại', compact: true, onPressed: controller.busy ? null : controller.retryPending)
        : null,
  );
}

/// Opened from Tài khoản -> Quản lý cửa hàng. Reads the server before showing any choice; creates nothing.
class ShopStartScreen extends StatefulWidget {
  const ShopStartScreen({super.key, required this.controller});

  final ShopController controller;

  @override
  State<ShopStartScreen> createState() => _ShopStartScreenState();
}

class _ShopStartScreenState extends State<ShopStartScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.load();
    widget.controller.session.addListener(_leaveWhenSignedOut);
  }

  @override
  void dispose() {
    widget.controller.session.removeListener(_leaveWhenSignedOut);
    super.dispose();
  }

  void _leaveWhenSignedOut() {
    if (widget.controller.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ShopController controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final ShopProfile? profile = controller.profile;
        final bool loading = controller.loadState == ShopLoad.loading || controller.loadState == ShopLoad.idle;
        return N11FormScaffold(
          title: 'Bán hàng trên 11Food',
          session: null,
          children: <Widget>[
            _shopFailure(controller),
            if (loading) const N11Banner(key: Key('shop-loading'), kind: BannerKind.info, title: 'Đang đọc hồ sơ cửa hàng từ máy chủ…'),
            if (controller.loadState == ShopLoad.failed)
              N11Button(key: const Key('shop-reload'), label: 'Tải lại', kind: ButtonKind.secondary, onPressed: controller.load),
            if (controller.loadState == ShopLoad.ready && profile == null) ...<Widget>[
              const EmptyState(icon: Icons.storefront_outlined, title: 'Bạn chưa có hồ sơ cửa hàng', text: 'Đăng ký cửa hàng để bán trên 11Food. Tài khoản khách hàng của bạn được giữ nguyên.'),
              N11Button(key: const Key('shop-register'), label: 'Đăng ký cửa hàng', onPressed: () => Navigator.of(context).push(n11Route(ShopFormScreen(controller: controller)))),
            ],
            if (controller.loadState == ShopLoad.ready && profile != null && profile.status == 'INCOMPLETE') ...<Widget>[
              N11Banner(kind: BannerKind.warn, title: 'Hồ sơ "${profile.name}" chưa hoàn tất', text: 'Bạn có thể tiếp tục từ dữ liệu đã lưu trên máy chủ.'),
              N11Button(key: const Key('shop-continue'), label: 'Tiếp tục hồ sơ', onPressed: () => Navigator.of(context).push(n11Route(ShopFormScreen(controller: controller)))),
            ],
            if (controller.loadState == ShopLoad.ready && profile != null && profile.status != 'INCOMPLETE')
              N11Button(key: const Key('shop-open'), label: 'Mở Cửa hàng của tôi', onPressed: () => Navigator.of(context).push(n11Route(ShopHomeScreen(controller: controller)))),
          ],
        );
      },
    );
  }
}

/// F21 + F22: the profile form and the pickup position.
class ShopFormScreen extends StatefulWidget {
  const ShopFormScreen({super.key, required this.controller});

  final ShopController controller;

  @override
  State<ShopFormScreen> createState() => _ShopFormScreenState();
}

class _ShopFormScreenState extends State<ShopFormScreen> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _address;
  late final TextEditingController _zalo;
  late final TextEditingController _facebook;

  @override
  void initState() {
    super.initState();
    final ShopController c = widget.controller;
    _name = TextEditingController(text: c.name);
    _phone = TextEditingController(text: c.contactPhone);
    _address = TextEditingController(text: c.addressText);
    _zalo = TextEditingController(text: c.zalo);
    _facebook = TextEditingController(text: c.facebook);
    c.session.addListener(_leaveWhenSignedOut);
  }

  @override
  void dispose() {
    widget.controller.session.removeListener(_leaveWhenSignedOut);
    // What was typed stays in the controller (not lost when the screen is left); nothing is sent by leaving.
    _push();
    _name.dispose();
    _phone.dispose();
    _address.dispose();
    _zalo.dispose();
    _facebook.dispose();
    super.dispose();
  }

  void _leaveWhenSignedOut() {
    if (widget.controller.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  void _push() {
    final ShopController c = widget.controller;
    c.name = _name.text;
    c.contactPhone = _phone.text;
    c.addressText = _address.text;
    c.zalo = _zalo.text;
    c.facebook = _facebook.text;
  }

  bool get _fieldsFilled => _name.text.trim().isNotEmpty && _phone.text.trim().isNotEmpty && _address.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final ShopController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final ShopProfile? profile = c.profile;
        final bool locked = profile != null && profile.status != 'INCOMPLETE';
        final bool busy = c.busy;
        final LocationFix? fix = c.fix;
        final bool hasPoint = fix != null || (profile?.hasLocation ?? false);
        return N11FormScaffold(
          title: 'Hồ sơ cửa hàng',
          session: null,
          children: <Widget>[
            _shopFailure(c),
            if (locked) const N11Banner(kind: BannerKind.info, title: 'Hồ sơ đã hoàn tất', text: 'Chỉ xem. Sửa hồ sơ sau khi hoàn tất chưa nối trên Android.'),
            N11Field(fieldKey: const Key('shop-name'), label: 'Tên cửa hàng', controller: _name, maxLength: 120, enabled: !busy && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(fieldKey: const Key('shop-phone'), label: 'Số điện thoại cửa hàng', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(fieldKey: const Key('shop-address'), label: 'Địa chỉ lấy hàng', controller: _address, maxLength: 500, enabled: !busy && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(fieldKey: const Key('shop-zalo'), label: 'Zalo (không bắt buộc)', controller: _zalo, maxLength: 160, enabled: !busy && !locked, onChanged: _push),
            N11Field(fieldKey: const Key('shop-facebook'), label: 'Facebook (không bắt buộc)', controller: _facebook, maxLength: 300, enabled: !busy && !locked, onChanged: _push),
            _areaPicker(c, locked || busy),
            _positionCard(c, locked, hasPoint),
            if (!locked) ...<Widget>[
              N11Button(
                key: const Key('shop-save'),
                label: busy ? 'Đang lưu…' : 'Lưu nháp',
                kind: ButtonKind.secondary,
                onPressed: busy || !_fieldsFilled ? null : () async {
                  _push();
                  final bool ok = await c.saveDraft();
                  if (ok && context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã lưu nháp trên máy chủ.')));
                  }
                },
              ),
              N11Button(
                key: const Key('shop-complete'),
                label: 'Hoàn tất hồ sơ',
                onPressed: busy || profile == null || !profile.readyToComplete || _unsavedChanges(c)
                    ? null
                    : () async {
                        final bool ok = await c.complete();
                        if (ok && context.mounted) {
                          Navigator.of(context).pushReplacement(n11Route(ShopHomeScreen(controller: c)));
                        }
                      },
              ),
              ReasonNote(_completeReason(c, profile, hasPoint)),
            ],
          ],
        );
      },
    );
  }

  bool _unsavedChanges(ShopController c) {
    final ShopProfile? p = c.profile;
    if (p == null) {
      return true;
    }
    return c.fix != null ||
        c.name.trim() != p.name ||
        c.contactPhone.trim() != p.contactPhone ||
        c.addressText.trim() != p.addressText ||
        c.zalo.trim() != (p.zalo ?? '') ||
        c.facebook.trim() != (p.facebook ?? '') ||
        c.serviceAreaId != p.serviceAreaId;
  }

  String _completeReason(ShopController c, ShopProfile? profile, bool hasPoint) {
    if (profile == null) {
      return 'Lưu nháp trước; hoàn tất chỉ mở khi máy chủ đã giữ đủ thông tin.';
    }
    if (!profile.hasLocation) {
      return 'Chưa có vị trí lấy hàng đã lưu: hãy lấy vị trí tại quán rồi lưu nháp.';
    }
    if (profile.serviceAreaId == null) {
      return c.areas.isEmpty ? 'Chưa có khu vực để chọn từ máy chủ: chưa thể hoàn tất.' : 'Chọn khu vực rồi lưu nháp.';
    }
    if (_unsavedChanges(c)) {
      return 'Có thay đổi chưa lưu: hãy lưu nháp trước khi hoàn tất.';
    }
    return 'Đủ điều kiện hoàn tất.';
  }

  Widget _areaPicker(ShopController c, bool disabled) {
    if (c.areasFailed) {
      return N11Banner(
        key: const Key('areas-failed'),
        kind: BannerKind.warn,
        title: 'Chưa tải được danh sách khu vực',
        text: 'Bạn vẫn lưu nháp được; chưa thể hoàn tất khi chưa chọn khu vực.',
        trailing: N11Button(key: const Key('areas-reload'), label: 'Tải lại', compact: true, kind: ButtonKind.secondary, onPressed: c.reloadAreas),
      );
    }
    if (c.areas.isEmpty) {
      return const N11Banner(key: Key('areas-empty'), kind: BannerKind.warn, title: 'Chưa có khu vực nào đang mở', text: 'Máy chủ chưa có khu vực để chọn. Bạn lưu nháp được; chưa thể hoàn tất.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Khu vực', style: N11Text.label),
        const SizedBox(height: N11Space.gap2),
        DropdownButtonFormField<String>(
          key: const Key('shop-area'),
          initialValue: c.serviceAreaId,
          isExpanded: true,
          decoration: const InputDecoration(filled: true, fillColor: N11Colors.field, border: OutlineInputBorder()),
          hint: const Text('Chọn khu vực'),
          items: <DropdownMenuItem<String>>[for (final ServiceArea area in c.areas) DropdownMenuItem<String>(value: area.id, child: Text(area.name))],
          onChanged: disabled
              ? null
              : (String? value) {
                  c.serviceAreaId = value;
                  setState(() {});
                },
        ),
      ],
    );
  }

  Widget _positionCard(ShopController c, bool locked, bool hasPoint) {
    final LocationFix? fix = c.fix;
    final ShopProfile? profile = c.profile;
    String detail;
    if (fix != null) {
      detail = 'Vị trí mới: ${fix.latitude.toStringAsFixed(6)}, ${fix.longitude.toStringAsFixed(6)}'
          '${fix.accuracyMeters == null ? '' : ' (sai số khoảng ${fix.accuracyMeters!.round()} m)'}. Bấm "Lưu nháp" để lưu vị trí này.';
    } else if (profile != null && profile.hasLocation) {
      detail = 'Đã lưu vị trí: ${profile.pickupLat!.toStringAsFixed(6)}, ${profile.pickupLng!.toStringAsFixed(6)}.';
    } else {
      detail = 'Chưa có vị trí lấy hàng.';
    }
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Vị trí lấy hàng', style: N11Text.bodyStrong),
          const SizedBox(height: N11Space.gap2),
          Text(detail, key: const Key('shop-position'), style: N11Text.caption),
          if (c.locationFailure != null) ...<Widget>[
            const SizedBox(height: N11Space.gap2),
            N11Banner(key: const Key('location-error'), kind: BannerKind.warn, title: 'Chưa lấy được vị trí', text: locationFailureMessage(c.locationFailure!)),
          ],
          if (!locked) ...<Widget>[
            const SizedBox(height: N11Space.gap3),
            N11Button(
              key: const Key('shop-locate'),
              label: c.locating ? 'Đang lấy vị trí…' : 'Lấy vị trí hiện tại',
              kind: ButtonKind.secondary,
              icon: Icons.my_location,
              onPressed: c.locating || c.busy ? null : c.capturePosition,
            ),
            const ReasonNote('Chỉ lấy vị trí một lần khi bạn bấm, đứng tại quán. Không theo dõi, không bản đồ.'),
          ],
        ],
      ),
    );
  }
}

/// F23: the shop as the server holds it, and the person's own switch between customer and shop mode.
class ShopHomeScreen extends StatefulWidget {
  const ShopHomeScreen({super.key, required this.controller});

  final ShopController controller;

  @override
  State<ShopHomeScreen> createState() => _ShopHomeScreenState();
}

class _ShopHomeScreenState extends State<ShopHomeScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.load();
    widget.controller.session.addListener(_leaveWhenSignedOut);
  }

  @override
  void dispose() {
    widget.controller.session.removeListener(_leaveWhenSignedOut);
    super.dispose();
  }

  void _leaveWhenSignedOut() {
    if (widget.controller.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ShopController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final ShopProfile? profile = c.profile;
        final Identity? identity = c.session.identity;
        final bool canShop = identity?.availableRoles.contains('SHOP_OWNER') ?? false;
        final String? active = identity?.activeRole;
        return N11FormScaffold(
          title: 'Cửa hàng của tôi',
          session: null,
          children: <Widget>[
            _shopFailure(c),
            if (profile == null) const N11Banner(kind: BannerKind.info, title: 'Đang đọc hồ sơ…'),
            if (profile != null) ...<Widget>[
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(profile.name, key: const Key('shop-home-name'), style: N11Text.bodyStrong),
                    const SizedBox(height: N11Space.gap1),
                    Text(profile.addressText, style: N11Text.caption),
                    const SizedBox(height: N11Space.gap2),
                    Wrap(spacing: N11Space.gap2, children: <Widget>[
                      N11Chip(shopStatusLabel(profile.status), kind: profile.status == 'ACTIVE' ? ChipKind.ok : ChipKind.warn),
                      const N11Chip('Chưa nhận đơn', kind: ChipKind.soon),
                    ]),
                  ],
                ),
              ),
              if (profile.status == 'DISABLED') const N11Banner(kind: BannerKind.warn, title: 'Cửa hàng đang bị khóa', text: 'Chỉ xem. Liên hệ hỗ trợ để biết thêm.'),
              if (canShop && active != 'SHOP_OWNER')
                N11Button(key: const Key('switch-shop'), label: 'Vào quản lý cửa hàng', onPressed: c.busy ? null : () => c.switchContext('SHOP_OWNER')),
              if (active == 'SHOP_OWNER')
                N11Button(key: const Key('switch-customer'), label: 'Về giao diện khách hàng', kind: ButtonKind.secondary, onPressed: c.busy ? null : () => c.switchContext('CUSTOMER')),
              if (active == 'SHOP_OWNER') const N11Chip('Đang ở chế độ cửa hàng', kind: ChipKind.info),
              if (!canShop) const ReasonNote('Chế độ cửa hàng chỉ mở khi máy chủ xác nhận cửa hàng đang hoạt động.'),
              N11List(children: <Widget>[
                N11ListItem(icon: Icons.restaurant_menu, title: 'Menu', sub: kNotOnAndroidReason, soon: true),
                N11ListItem(icon: Icons.receipt_long_outlined, title: 'Đơn hàng', sub: kNotOnAndroidReason, soon: true),
                N11ListItem(icon: Icons.bar_chart_outlined, title: 'Doanh thu', sub: kNotOnAndroidReason, soon: true),
              ]),
            ],
          ],
        );
      },
    );
  }
}

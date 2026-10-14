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
        final bool ready = controller.loadState == ShopLoad.ready;
        return N11FormScaffold(
          title: 'Quản lý cửa hàng',
          session: null,
          children: <Widget>[
            _shopFailure(controller),
            if (loading) const N11Banner(key: Key('shop-loading'), kind: BannerKind.info, title: 'Đang đọc hồ sơ cửa hàng từ máy chủ…'),
            if (controller.loadState == ShopLoad.failed)
              N11Button(key: const Key('shop-reload'), label: 'Tải lại', kind: ButtonKind.secondary, onPressed: controller.load),
            if (ready && profile == null) ...<Widget>[
              const N11Banner(kind: BannerKind.info, title: 'Một phần của 11Food', text: 'Quản lý cửa hàng nằm ngay trong app 11Food. Bạn không cần cài app khác.'),
              const N11StateBlock(
                kind: StateKind.warn,
                icon: Icons.storefront_outlined,
                title: 'Bạn chưa có hồ sơ cửa hàng',
                text: 'Tạo hồ sơ để kích hoạt vai trò Chủ quán. Bạn vẫn là khách hàng như bình thường.',
              ),
              N11Button(key: const Key('shop-register'), label: 'Tạo hồ sơ cửa hàng', onPressed: () => Navigator.of(context).push(n11Route(ShopFormScreen(controller: controller)))),
            ],
            if (ready && profile != null) ...<Widget>[
              _summary(profile),
              if (profile.status == 'INCOMPLETE') ...<Widget>[
                if (profile.readyToComplete)
                  const N11Banner(kind: BannerKind.success, title: 'Đủ điều kiện để hoàn tất', text: 'Mở hồ sơ rồi bấm Hoàn tất hồ sơ. Sau đó tài khoản có thêm vai trò Chủ quán.')
                else
                  const N11Banner(kind: BannerKind.warn, title: 'Chưa thể hoàn tất', text: 'Hồ sơ cần đủ thông tin, vị trí GPS tại quán và khu vực. Bạn tiếp tục từ dữ liệu đã lưu trên máy chủ.'),
                N11Button(key: const Key('shop-continue'), label: 'Tiếp tục hồ sơ', onPressed: () => Navigator.of(context).push(n11Route(ShopFormScreen(controller: controller)))),
              ] else
                N11Button(key: const Key('shop-open'), label: 'Mở Cửa hàng của tôi', onPressed: () => Navigator.of(context).push(n11Route(ShopHomeScreen(controller: controller)))),
            ],
          ],
        );
      },
    );
  }

  /// What the server holds, as the design's status card and checklist.
  Widget _summary(ShopProfile profile) {
    final bool incomplete = profile.status == 'INCOMPLETE';
    return vstack(<Widget>[
      N11InfoCard(
        title: profile.name,
        chip: N11Chip(incomplete ? (profile.readyToComplete ? 'Đủ điều kiện' : 'Bản nháp') : shopStatusLabel(profile.status), kind: incomplete ? (profile.readyToComplete ? ChipKind.ok : ChipKind.warn) : (profile.status == 'ACTIVE' ? ChipKind.ok : ChipKind.bad)),
      ),
      if (incomplete)
        N11CheckList(items: <N11CheckItem>[
          N11CheckItem('Tên cửa hàng', profile.name.trim().isNotEmpty ? CheckState.done : CheckState.missing),
          N11CheckItem('Số điện thoại liên hệ', profile.contactPhone.trim().isNotEmpty ? CheckState.done : CheckState.missing),
          N11CheckItem('Địa chỉ', profile.addressText.trim().isNotEmpty ? CheckState.done : CheckState.missing),
          N11CheckItem('Vị trí GPS tại quán', profile.hasLocation ? CheckState.done : CheckState.missing),
          N11CheckItem('Khu vực', profile.serviceAreaId != null ? CheckState.done : CheckState.missing),
        ]),
    ]);
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
    _seenRevision = c.formRevision;
    c.addListener(_syncFromController);
    c.session.addListener(_leaveWhenSignedOut);
  }

  int _seenRevision = 0;

  /// The controller replaced its fields (an accepted server snapshot after a save, a conflict or a reload; or a clear): show them,
  /// otherwise the next edit or save would push the text of an older snapshot over the newer version.
  void _syncFromController() {
    final ShopController c = widget.controller;
    if (c.formRevision == _seenRevision) {
      return;
    }
    _seenRevision = c.formRevision;
    _name.text = c.name;
    _phone.text = c.contactPhone;
    _address.text = c.addressText;
    _zalo.text = c.zalo;
    _facebook.text = c.facebook;
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncFromController);
    widget.controller.session.removeListener(_leaveWhenSignedOut);
    // What was typed stays in the controller (not lost when the screen is left); nothing is sent by leaving. After the session ended
    // (the controller was cleared) nothing is pushed back: the old text must not outlive the session it was typed in.
    if (widget.controller.session.status == SessionStatus.signedIn) {
      _push();
    }
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
            const N11Steps(count: 2, current: 1, label: 'Thông tin liên hệ'),
            N11Field(fieldKey: const Key('shop-name'), label: 'Tên cửa hàng', controller: _name, maxLength: 120, enabled: !busy && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(fieldKey: const Key('shop-phone'), label: 'Số điện thoại liên hệ', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy && !locked, onChanged: () { _push(); setState(() {}); }),
            const SizedBox(height: N11Space.gap1),
            const N11Steps(count: 2, current: 2, label: 'Vị trí'),
            N11Field(fieldKey: const Key('shop-address'), label: 'Địa chỉ lấy hàng', controller: _address, maxLength: 500, enabled: !busy && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(fieldKey: const Key('shop-zalo'), label: 'Zalo', placeholder: 'Số Zalo của quán', optionalLabel: true, controller: _zalo, maxLength: 160, enabled: !busy && !locked, onChanged: _push),
            N11Field(fieldKey: const Key('shop-facebook'), label: 'Facebook', placeholder: 'Liên kết trang Facebook', optionalLabel: true, controller: _facebook, maxLength: 300, enabled: !busy && !locked, onChanged: _push),
            _areaPicker(c, locked || busy),
            _positionCard(c, locked, hasPoint),
            if (!locked) ...<Widget>[
              N11Button(
                key: const Key('shop-save'),
                label: busy ? 'Đang lưu…' : 'Lưu nháp',
                kind: ButtonKind.secondary,
                loading: busy,
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
          decoration: InputDecoration(
            filled: true,
            fillColor: N11Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 2)),
          ),
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: N11Colors.black),
          borderRadius: BorderRadius.circular(kRadiusControl),
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
    final List<(String, String)> rows = <(String, String)>[];
    if (fix != null) {
      detail = 'Vị trí mới: ${fix.latitude.toStringAsFixed(6)}, ${fix.longitude.toStringAsFixed(6)}'
          '${fix.accuracyMeters == null ? '' : ' (sai số khoảng ${fix.accuracyMeters!.round()} m)'}. Bấm "Lưu nháp" để lưu vị trí này.';
      rows.add(('Toạ độ', '${fix.latitude.toStringAsFixed(4)}, ${fix.longitude.toStringAsFixed(4)}'));
      if (fix.accuracyMeters != null) {
        rows.add(('Độ chính xác', '≈ ${fix.accuracyMeters!.round()} m'));
      }
    } else if (profile != null && profile.hasLocation) {
      detail = 'Đã lưu vị trí: ${profile.pickupLat!.toStringAsFixed(6)}, ${profile.pickupLng!.toStringAsFixed(6)}.';
      rows.add(('Toạ độ', '${profile.pickupLat!.toStringAsFixed(4)}, ${profile.pickupLng!.toStringAsFixed(4)}'));
    } else {
      detail = 'Chưa có vị trí lấy hàng. Hãy đứng tại quán rồi lấy vị trí.';
    }
    return vstack(<Widget>[
      N11InfoCard(
        title: 'Vị trí GPS tại quán',
        chip: N11Chip(hasPoint ? 'Đã có' : 'Chưa có', kind: hasPoint ? ChipKind.ok : ChipKind.warn),
        text: detail,
        textKey: const Key('shop-position'),
        rows: rows,
      ),
      if (c.locationFailure != null)
        N11Banner(key: const Key('location-error'), kind: BannerKind.warn, title: 'Chưa lấy được vị trí', text: locationFailureMessage(c.locationFailure!)),
      if (!locked) ...<Widget>[
        N11Button(
          key: const Key('shop-locate'),
          label: c.locating ? 'Đang lấy vị trí…' : (hasPoint ? 'Lấy lại vị trí' : 'Lấy vị trí hiện tại'),
          kind: ButtonKind.secondary,
          icon: Icons.my_location,
          loading: c.locating,
          onPressed: c.locating || c.busy ? null : c.capturePosition,
        ),
        const ReasonNote('Chỉ lấy vị trí một lần khi bạn bấm, đứng tại quán. Không theo dõi, không bản đồ.'),
      ],
    ]);
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
              N11InfoCard(
                titleKey: const Key('shop-home-name'),
                title: profile.name,
                chip: N11Chip(shopStatusLabel(profile.status), kind: profile.status == 'ACTIVE' ? ChipKind.ok : ChipKind.warn),
                rows: <(String, String)>[
                  ('Điện thoại', profile.contactPhone),
                  ('Địa chỉ', profile.addressText),
                  ('GPS', profile.hasLocation ? 'Đã có' : 'Chưa có'),
                  ('Vai trò', canShop ? 'Khách hàng · Chủ quán' : 'Khách hàng'),
                  ('Nhận đơn', 'Chưa nhận đơn'),
                ],
              ),
              if (profile.status == 'DISABLED') const N11Banner(kind: BannerKind.warn, title: 'Cửa hàng đang bị khóa', text: 'Chỉ xem. Liên hệ hỗ trợ để biết thêm.'),
              if (canShop && active != 'SHOP_OWNER')
                N11Button(key: const Key('switch-shop'), label: 'Vào quản lý cửa hàng', loading: c.busy, onPressed: c.busy ? null : () => c.switchContext('SHOP_OWNER')),
              if (active == 'SHOP_OWNER')
                N11Button(key: const Key('switch-customer'), label: 'Về giao diện khách hàng', kind: ButtonKind.secondary, onPressed: c.busy ? null : () => c.switchContext('CUSTOMER')),
              if (active == 'SHOP_OWNER') const Center(child: N11Chip('Đang ở chế độ cửa hàng', kind: ChipKind.dark)),
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

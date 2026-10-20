import 'shop_logo_widgets.dart';
import 'package:flutter/material.dart';

import '../addresses/address_location_picker.dart';
import '../account/account_views.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../features.dart';
import '../m02/m02_flows.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/form_feedback.dart';
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
    text: <String>[switch (failure.kind) {
      AuthFailureKind.badRequest => 'Máy chủ từ chối thông tin hồ sơ quán. Kiểm tra tên quán, số điện thoại và địa chỉ rồi thử lại.',
      AuthFailureKind.invalidServiceArea => 'Hệ thống chưa xác định được khu vực phục vụ cho quán. Bấm Hoàn tất hồ sơ để thử xác định lại.',
      AuthFailureKind.badResponse when controller.hasPendingWrite => 'Đã nhận phản hồi lưu nhưng chưa xác nhận được hồ sơ trên máy chủ. Thông tin vẫn được giữ; bấm Hoàn tất hồ sơ để kiểm tra lại.',
      AuthFailureKind.badResponse => 'Máy chủ trả kết quả hồ sơ quán không hợp lệ. Chưa thể xác nhận hoàn tất. Hãy thử lại.',
      AuthFailureKind.unknownOutcome when (failure.status ?? 0) >= 500 => 'Máy chủ gặp lỗi khi xử lý hồ sơ quán. Chưa xác định được kết quả lưu; bấm Hoàn tất hồ sơ để kiểm tra lại.',
      _ => failureMessage(failure),
    }, if (failure.diagnostic != null) failure.diagnostic!].join('\n'),
    trailing: controller.hasPendingWrite && canRetryFailure(failure)
        ? N11Button(key: const Key('shop-retry'), label: 'Thử lại', compact: true, onPressed: controller.busy ? null : controller.finishProfile)
        : null,
  );
}

/// Opened from Tài khoản -> Quản lý cửa hàng. Reads the server before showing any choice; creates nothing.
class ShopStartScreen extends StatefulWidget {
  const ShopStartScreen({super.key, required this.controller, this.m02});

  final ShopController controller;

  /// The M02 shop-management screens, reached from Cửa hàng của tôi once the shop mode is on.
  final M02Flows? m02;

  @override
  State<ShopStartScreen> createState() => _ShopStartScreenState();
}

class _ShopStartScreenState extends State<ShopStartScreen> {
  @override
  void initState() {
    super.initState();
    // After this frame: load() notifies at once, which must not mark a listening screen dirty while it is being built.
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.controller.load());
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
              N11Button(key: const Key('shop-register'), label: 'Tạo hồ sơ cửa hàng', onPressed: () => Navigator.of(context).push(n11Route(ShopFormScreen(controller: controller, m02: widget.m02)))),
            ],
            if (ready && profile != null) ...<Widget>[
              _summary(profile),
              if (profile.status == 'INCOMPLETE') ...<Widget>[
                if (profile.readyToComplete)
                  const N11Banner(kind: BannerKind.success, title: 'Đủ điều kiện để hoàn tất', text: 'Mở hồ sơ rồi bấm Hoàn tất hồ sơ. Sau đó tài khoản có thêm vai trò Chủ quán.')
                else
                  const N11Banner(kind: BannerKind.warn, title: 'Chưa thể hoàn tất', text: 'Hồ sơ cần đủ thông tin và địa chỉ lấy hàng có ghim vị trí. Bạn tiếp tục từ dữ liệu đã lưu trên máy chủ.'),
                N11Button(key: const Key('shop-continue'), label: 'Tiếp tục hồ sơ', onPressed: () => Navigator.of(context).push(n11Route(ShopFormScreen(controller: controller, m02: widget.m02)))),
              ] else
                N11Button(key: const Key('shop-open'), label: 'Mở Cửa hàng của tôi', onPressed: () => Navigator.of(context).push(n11Route(ShopHomeScreen(controller: controller, m02: widget.m02)))),
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
        chip: N11Chip(incomplete ? (profile.readyToComplete ? 'Đủ điều kiện' : 'Chưa hoàn tất') : shopStatusLabel(profile.status), kind: incomplete ? (profile.readyToComplete ? ChipKind.ok : ChipKind.warn) : (profile.status == 'ACTIVE' ? ChipKind.ok : ChipKind.bad)),
      ),
      if (incomplete)
        N11CheckList(items: <N11CheckItem>[
          N11CheckItem('Tên cửa hàng', profile.name.trim().isNotEmpty ? CheckState.done : CheckState.missing),
          N11CheckItem('Số điện thoại liên hệ', profile.contactPhone.trim().isNotEmpty ? CheckState.done : CheckState.missing),
          N11CheckItem('Địa chỉ', profile.addressText.trim().isNotEmpty ? CheckState.done : CheckState.missing),
          N11CheckItem('Ghim địa chỉ lấy hàng', profile.hasLocation ? CheckState.done : CheckState.missing),
        ]),
    ]);
  }
}

/// F21 + F22: the profile form and the pickup position.
class ShopFormScreen extends StatefulWidget {
  const ShopFormScreen({super.key, required this.controller, this.m02});

  final ShopController controller;
  final M02Flows? m02;

  @override
  State<ShopFormScreen> createState() => _ShopFormScreenState();
}

class _ShopFormScreenState extends State<ShopFormScreen> {
  final FormFeedback _feedback = FormFeedback();
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _address;
  late final TextEditingController _zalo;
  late final TextEditingController _facebook;

  @override
  void initState() {
    super.initState();
    final ShopController c = widget.controller;
    c.dismissFailure(notify: false);
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
    widget.controller.dismissFailure(notify: false);
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
    c.dismissFailure(notify: false);
  }


  String? _error(String id) => _feedback.message(widget.controller.fieldErrors[id]);

  @override
  Widget build(BuildContext context) {
    final ShopController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final ShopProfile? profile = c.profile;
        final bool locked = profile != null && profile.status != 'INCOMPLETE';
        final bool busy = c.busy;
        final bool editingLocked = busy || c.hasPendingWrite;
        final bool hasPoint = c.fix != null || (profile?.hasLocation ?? false);
        return N11FormScaffold(
          title: 'Hồ sơ cửa hàng',
          session: null,
          children: <Widget>[
            _shopFailure(c),
            if (locked) const N11Banner(kind: BannerKind.info, title: 'Hồ sơ đã hoàn tất', text: 'Chỉ xem. Sửa hồ sơ sau khi hoàn tất chưa nối trên Android.'),
            ShopLogoField(value: c.logo, picker: c.picker, session: c.session, enabled: !editingLocked && !locked, onChanged: c.setLogo),
            const N11Steps(count: 2, current: 1, label: 'Thông tin liên hệ'),
            N11Field(key: _feedback.key('name'), hint: _error('name'), tone: _error('name') == null ? FieldTone.normal : FieldTone.error, fieldKey: const Key('shop-name'), label: 'Tên cửa hàng', controller: _name, maxLength: 120, enabled: !editingLocked && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(key: _feedback.key('phone'), hint: _error('phone'), tone: _error('phone') == null ? FieldTone.normal : FieldTone.error, fieldKey: const Key('shop-phone'), label: 'Số điện thoại liên hệ', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !editingLocked && !locked, onChanged: () { _push(); setState(() {}); }),
            const SizedBox(height: N11Space.gap1),
            const N11Steps(count: 2, current: 2, label: 'Vị trí'),
            KeyedSubtree(key: _feedback.key('address'), child: AddressLocationField(key: const Key('shop-address'), error: _error('address'), label: 'Địa chỉ lấy hàng', text: _address.text,
              onTap: busy || locked || c.hasPendingWrite ? null : () async {
                _push();
                final int epoch = c.session.sessionEpoch;
                final AddressLocation? selected = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(
                  builder: (_) => AddressLocationPicker(initial: AddressLocation(_address.text,
                    latitude: c.fix?.latitude ?? profile?.pickupLat, longitude: c.fix?.longitude ?? profile?.pickupLng),
                    location: c.location, session: c.session, maxLength: 500)));
                if (selected == null || !context.mounted || c.session.status != SessionStatus.signedIn || c.session.sessionEpoch != epoch) return;
                _address.text = selected.text;
                c.selectAddress(selected.text, latitude: selected.latitude, longitude: selected.longitude);
                setState(() {});
              })),
            N11Field(key: _feedback.key('zalo'), hint: _error('zalo'), tone: _error('zalo') == null ? FieldTone.normal : FieldTone.error, fieldKey: const Key('shop-zalo'), label: 'Zalo', placeholder: 'Số Zalo của quán', optionalLabel: true, controller: _zalo, maxLength: 160, enabled: !editingLocked && !locked, onChanged: () { _push(); setState(() {}); }),
            N11Field(key: _feedback.key('facebook'), hint: _error('facebook'), tone: _error('facebook') == null ? FieldTone.normal : FieldTone.error, fieldKey: const Key('shop-facebook'), label: 'Facebook', placeholder: 'Liên kết trang Facebook', optionalLabel: true, controller: _facebook, maxLength: 300, enabled: !editingLocked && !locked, onChanged: () { _push(); setState(() {}); }),
            if (c.areasFailed || (c.serviceAreaId == null && c.areas.length != 1))
              const ReasonNote('Hệ thống chưa xác định được khu vực phục vụ. Vui lòng thử lại.'),
            if (!locked) ...<Widget>[
              N11Button(
                key: const Key('shop-complete'),
                label: busy ? 'Đang hoàn tất…' : 'Hoàn tất hồ sơ',
                loading: busy,
                onPressed: busy ? null : () async {
                  _push();
                  if (!c.hasPendingWrite) {
                    final bool valid = _feedback.validate(c.fieldErrors);
                    setState(() {});
                    if (!valid) return;
                  }
                  final bool ok = await c.finishProfile();
                  if (ok && context.mounted) {
                    ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Đã hoàn tất hồ sơ cửa hàng.')));
                    Navigator.of(context).pushReplacement(n11Route(ShopHomeScreen(controller: c, m02: widget.m02)));
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

  String _completeReason(ShopController c, ShopProfile? profile, bool hasPoint) {
    if (!hasPoint) { return 'Mở địa chỉ và chọn ghim vị trí lấy hàng để hoàn tất hồ sơ.'; }
    if (c.hasPendingWrite) { return 'Chưa xác định được kết quả. Bấm Hoàn tất hồ sơ để kiểm tra và tiếp tục.'; }
    return 'Điền đủ thông tin rồi bấm Hoàn tất hồ sơ.';
  }


}

/// F23: the shop as the server holds it, and the person's own switch between customer and shop mode.
class ShopHomeScreen extends StatefulWidget {
  const ShopHomeScreen({super.key, required this.controller, this.m02});

  final ShopController controller;
  final M02Flows? m02;

  @override
  State<ShopHomeScreen> createState() => _ShopHomeScreenState();
}

class _ShopHomeScreenState extends State<ShopHomeScreen> {
  @override
  void initState() {
    super.initState();
    // After this frame: load() notifies at once, which must not mark a listening screen dirty while it is being built.
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.controller.load());
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
                  ('Vai trò', canShop ? 'Khách hàng · Chủ quán' : 'Khách hàng'),
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
                N11ListItem(icon: Icons.storefront_outlined, title: 'Quản lý quán', sub: 'Có ở tab Quán khi bạn vào chế độ quản lý quán.', soon: false),
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

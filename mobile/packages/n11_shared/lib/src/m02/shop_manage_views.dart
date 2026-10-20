import '../flows/shop_logo_widgets.dart';
import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../addresses/address_location_picker.dart';
import '../flows/shop_views.dart' show ShopFormScreen;
import '../tokens.dart';
import '../widgets/components.dart';
import 'hours_views.dart';
import 'm02_flows.dart';
import 'm02_widgets.dart';
import 'menu_views.dart';
import 'preview_views.dart';
import 'schedule.dart';
import 'shop_ops_controller.dart';

// Q01 (Quản lý cửa hàng) and Q02 (Hồ sơ quán). Reads GET /v1/shop/me; writes PUT /v1/shop/me/profile. See shop_ops_controller.dart for
// the pending / conflict / read-back rules these screens only display.

String _hhmm(DateTime when) {
  final DateTime local = when.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

/// Leaves the whole M02 area when the session ends (the controllers were cleared by then).
mixin _LeaveWhenSignedOut<T extends StatefulWidget> on State<T> {
  SessionController get _session;

  void _watchSession() => _session.addListener(_gone);

  void _unwatchSession() => _session.removeListener(_gone);

  void _gone() {
    if (_session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }
}

class ShopManageScreen extends StatefulWidget {
  const ShopManageScreen({super.key, required this.flows, this.embedded = false});

  final M02Flows flows;

  /// True inside the "Quán" tab: only the content, the shell supplies the title bar and the bottom navigation.
  final bool embedded;

  @override
  State<ShopManageScreen> createState() => _ShopManageScreenState();
}

class _ShopManageScreenState extends State<ShopManageScreen> with WidgetsBindingObserver, _LeaveWhenSignedOut<ShopManageScreen> {
  ShopOpsController get ops => widget.flows.ops;

  @override
  SessionController get _session => ops.session;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _watchSession();
    ops.load();
    ops.startPolling();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _unwatchSession();
    ops.stopPolling();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ops.refresh();
    }
  }

  /// Opens a child screen; coming back reads the status again (a save there changed it).
  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(n11Route(screen));
    if (mounted) {
      ops.refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ops,
      builder: (BuildContext context, Widget? child) {
        final ShopOverview? o = ops.overview;
        final List<Widget> body;
        if (ops.loadState == OpsLoad.failed) {
          final String? code = ops.loadFailure?.code;
          body = <Widget>[
            M02LoadFailed(
              onRetry: ops.load,
              text: code == 'SHOP_ROLE_REQUIRED' || code == 'SHOP_NOT_FOUND' ? m02FailureText(ops.loadFailure!) : null,
            ),
          ];
        } else if (o == null) {
          body = const <Widget>[M02Skeleton(rows: 1, height: 28), M02Skeleton(rows: 1, height: 120), M02Skeleton(rows: 4, height: 60)];
        } else {
          body = _content(o);
        }
        if (widget.embedded) {
          return vstack(body);
        }
        return M02Scaffold(title: 'Quản lý cửa hàng', content: body);
      },
    );
  }

  List<Widget> _content(ShopOverview o) {
    final ({String label, String text, ChipKind kind}) copy = availabilityCopy(o.availability.reason);
    final DateTime? at = ops.lastUpdated;
    final bool incomplete = o.isIncomplete;
    final String hoursSub = !o.hasHours
        ? 'Chưa cài'
        : isUniform(o.hours)
            ? 'Cả tuần · ${dayText(o.hours[0])}'
            : 'Tùy chỉnh theo ngày';
    final (String label, ChipKind kind) profileChip = o.isDisabled
        ? ('Bị vô hiệu hóa', ChipKind.bad)
        : incomplete
            ? ('Hồ sơ chưa hoàn tất', ChipKind.warn)
            : o.availability.reason == 'SERVICE_AREA_INACTIVE'
                ? ('Cần chọn khu vực', ChipKind.warn)
                : ('Hồ sơ đầy đủ', ChipKind.ok);
    String? cta;
    VoidCallback? ctaAction;
    switch (o.availability.reason) {
      case 'NO_BUSINESS_HOURS':
      case 'OUTSIDE_BUSINESS_HOURS':
        cta = o.availability.reason == 'NO_BUSINESS_HOURS' ? 'Cài giờ hoạt động' : 'Xem giờ hoạt động';
        ctaAction = () => _open(HoursScreen(flows: widget.flows));
      case 'SHOP_INCOMPLETE':
        cta = 'Hoàn tất hồ sơ';
        final onboarding = widget.flows.onboarding;
        ctaAction = onboarding == null ? null : () => _open(ShopFormScreen(controller: onboarding));
      case 'SHOP_DISABLED':
        cta = 'Xem hồ sơ';
        ctaAction = () => _open(ShopProfileScreen(flows: widget.flows));
      case 'SERVICE_AREA_INACTIVE':
        cta = 'Sửa hồ sơ';
        ctaAction = () => _open(ShopProfileScreen(flows: widget.flows, startEditing: true));
    }
    final (Color bg, Color border, IconData icon) tone = switch (copy.kind) {
      ChipKind.ok => (N11Colors.successSoft, N11Colors.successBorder, Icons.storefront),
      ChipKind.bad => (N11Colors.errorSoft, N11Colors.errorBorder, Icons.block),
      ChipKind.warn => (N11Colors.yellowSoft, N11Colors.yellow, Icons.schedule),
      _ => (N11Colors.white, N11Colors.line, Icons.nightlight_outlined),
    };
    return <Widget>[
      Text(o.name, key: const Key('manage-name'), style: const TextStyle(fontSize: 26, height: 1.2, fontWeight: FontWeight.w800, color: N11Colors.black)),
      Align(alignment: Alignment.centerLeft, child: N11Chip(profileChip.$1, kind: profileChip.$2)),
      if (ops.stale)
        N11Banner(
          key: const Key('manage-stale'),
          kind: BannerKind.warn,
          title: 'Chưa cập nhật trạng thái',
          text: 'Kiểm tra kết nối. Trạng thái bên dưới có thể đã cũ.',
          meta: at == null ? null : 'Lần cập nhật gần nhất: ${_hhmm(at)}',
          trailing: N11Button(key: const Key('manage-reload'), label: 'Thử lại', compact: true, onPressed: ops.refresh),
        ),
      Container(
        key: const Key('status-card'),
        padding: const EdgeInsets.all(N11Space.gap4),
        decoration: BoxDecoration(color: tone.$1, border: Border.all(color: tone.$2, width: 2), borderRadius: BorderRadius.circular(kRadiusCard)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[
              Icon(tone.$3, size: 22, color: N11Colors.black),
              const SizedBox(width: N11Space.gap2),
              Expanded(child: Text(copy.label, key: const Key('status-label'), style: N11Text.h2)),
            ]),
            const SizedBox(height: 4),
            Text(copy.text, style: N11Text.lead),
            if (!ops.stale && at != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Cập nhật lúc ${_hhmm(at)}', style: N11Text.caption)),
            if (cta != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap3), child: N11Button(key: const Key('status-cta'), label: cta, kind: ButtonKind.secondary, compact: true, onPressed: ctaAction)),
          ],
        ),
      ),
      N11List(title: 'Quản lý', children: <Widget>[
        N11ListItem(key: const Key('manage-profile'), icon: Icons.storefront_outlined, title: 'Hồ sơ quán', sub: 'Tên, liên hệ, địa chỉ, vị trí', onTap: incomplete ? (widget.flows.onboarding == null ? null : () => _open(ShopFormScreen(controller: widget.flows.onboarding!))) : () => _open(ShopProfileScreen(flows: widget.flows))),
        N11ListItem(key: const Key('manage-hours'), icon: Icons.schedule, title: 'Giờ hoạt động', sub: hoursSub, onTap: incomplete ? null : () => _open(HoursScreen(flows: widget.flows)), trailing: incomplete ? const N11Chip('Cần hồ sơ') : null),
        N11ListItem(key: const Key('manage-menu'), icon: Icons.restaurant_menu, title: 'Thực đơn', sub: 'Món, ảnh, nhóm, hiện/ẩn', onTap: incomplete ? null : () => _open(MenuListScreen(flows: widget.flows)), trailing: incomplete ? const N11Chip('Cần hồ sơ') : null),
        N11ListItem(key: const Key('manage-preview'), icon: Icons.visibility_outlined, title: 'Xem trước thực đơn', sub: 'Như khách sẽ thấy', onTap: incomplete ? null : () => _open(PreviewScreen(flows: widget.flows)), trailing: incomplete ? const N11Chip('Cần hồ sơ') : null),
      ]),
    ];
  }
}

/// Q02: the profile, read first; "Sửa hồ sơ" opens the same screen as a form.
class ShopProfileScreen extends StatefulWidget {
  const ShopProfileScreen({super.key, required this.flows, this.startEditing = false});

  final M02Flows flows;
  final bool startEditing;

  @override
  State<ShopProfileScreen> createState() => _ShopProfileScreenState();
}

class _ShopProfileScreenState extends State<ShopProfileScreen> with _LeaveWhenSignedOut<ShopProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _zalo;
  late final TextEditingController _facebook;
  late final TextEditingController _address;
  bool _editing = false;
  int _seenRevision = -1;
  int _seenNotice = 0;
  bool _exitAfterSave = false;
  bool _conflictOpen = false;
  final ScrollController _scroll = ScrollController();

  ShopOpsController get ops => widget.flows.ops;

  @override
  SessionController get _session => ops.session;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
    _phone = TextEditingController();
    _zalo = TextEditingController();
    _facebook = TextEditingController();
    _address = TextEditingController();
    _editing = widget.startEditing;
    _seenNotice = ops.noticeSeq;
    _syncText();
    ops.addListener(_onOps);
    _watchSession();
    if (ops.loadState == OpsLoad.idle) {
      ops.load();
    }
  }

  @override
  void dispose() {
    ops.removeListener(_onOps);
    _unwatchSession();
    for (final TextEditingController c in <TextEditingController>[_name, _phone, _zalo, _facebook, _address]) {
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  void _syncText() {
    if (_seenRevision == ops.formRevision) {
      return;
    }
    _seenRevision = ops.formRevision;
    _name.text = ops.profile.name;
    _phone.text = ops.profile.phone;
    _zalo.text = ops.profile.zalo;
    _facebook.text = ops.profile.facebook;
    _address.text = ops.profile.address;
  }

  void _onOps() {
    _syncText();
    if (ops.noticeSeq != _seenNotice) {
      _seenNotice = ops.noticeSeq;
      if (ops.notice != null && mounted && !ops.conflict && ops.pending == null) {
        m02Toast(context, ops.notice!);
        _exitAfterSave = true;
      }
    }
    // The edit view closes once the saved data has been read back (the draft then equals what the server holds).
    if (_exitAfterSave && _editing && !ops.profileDirty && !ops.busy && ops.writeFailure == null && mounted) {
      _exitAfterSave = false;
      setState(() => _editing = false);
    }
    if (ops.conflict && !_conflictOpen && mounted) {
      _conflictOpen = true;
      _askConflict();
    }
    if (ops.profileErrors.isNotEmpty && mounted) {
      // Bring the first error into view (the fields are in the order of the form).
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final BuildContext? target = _errorKey(ops.profileErrors.keys.first).currentContext;
        if (target != null) {
          Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 150), alignment: 0.2);
        }
      });
    }
  }

  final Map<String, GlobalKey> _errorKeys = <String, GlobalKey>{};
  GlobalKey _errorKey(String field) => _errorKeys.putIfAbsent(field, GlobalKey.new);

  Future<void> _askConflict() async {
    final String? first = await showDecision(
      context,
      title: 'Dữ liệu đã được cập nhật ở nơi khác.',
      text: 'Nội dung bạn đang sửa vẫn được giữ. Tải bản mới sẽ thay thế bản nháp.',
      actions: const <DialogAction>[DialogAction('Giữ bản nháp', 'keep'), DialogAction('Tải bản mới', 'load', kind: ButtonKind.primary)],
    );
    if (!mounted) {
      return;
    }
    if (first == 'load') {
      final String? second = await showDecision(
        context,
        title: 'Thay bản nháp bằng bản mới?',
        text: 'Các chỉnh sửa chưa lưu của bạn sẽ mất.',
        actions: const <DialogAction>[DialogAction('Quay lại', 'back'), DialogAction('Tải bản mới', 'confirm', kind: ButtonKind.dark)],
      );
      if (second == 'confirm') {
        await ops.loadNewReplacingDrafts();
      } else {
        ops.keepDraftAfterConflict();
      }
    } else {
      ops.keepDraftAfterConflict();
    }
    _conflictOpen = false;
  }

  void _push() {
    ops.profile
      ..name = _name.text
      ..phone = _phone.text
      ..zalo = _zalo.text
      ..facebook = _facebook.text
      ..address = _address.text;
    ops.profileEdited();
  }

  Future<bool> _leave() async => (!_editing || !ops.profileDirty || ops.pending != null) ? true : confirmDiscard(context);

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ops,
      builder: (BuildContext context, Widget? child) {
        final ShopOverview? o = ops.overview;
        if (o == null) {
          return M02Scaffold(title: 'Hồ sơ quán', content: <Widget>[ops.loadState == OpsLoad.failed ? M02LoadFailed(onRetry: ops.load) : const M02Skeleton()]);
        }
        final bool readOnly = ops.readOnly;
        final List<Widget> banners = _banners(readOnly);
        if (!_editing || readOnly) {
          return M02Scaffold(
            title: 'Hồ sơ quán',
            content: <Widget>[
              ...banners,
              if (o.logo != null) ShopLogoField(value: o.logo, picker: widget.flows.menu.picker, session: ops.session, enabled: false, onChanged: (_) {}),
              N11InfoCard(
                titleKey: const Key('profile-name'),
                title: o.name,
                chip: readOnly ? const N11Chip('Chỉ đọc') : null,
                rows: <(String, String)>[
                  ('SĐT liên lạc', o.contactPhone),
                  ('Zalo', o.zalo ?? '—'),
                  ('Facebook', o.facebook ?? '—'),
                  ('Địa chỉ', o.addressText),
                ],
              ),
            ],
            footer: readOnly ? const <Widget>[] : <Widget>[N11Button(key: const Key('profile-edit'), label: 'Sửa hồ sơ', onPressed: () => setState(() => _editing = true))],
          );
        }
        return M02Scaffold(
          title: 'Sửa hồ sơ quán',
          scrollController: _scroll,
          onWillLeave: _leave,
          content: <Widget>[
            ...banners,
            ShopLogoField(value: ops.profile.logo, picker: widget.flows.menu.picker, session: ops.session, enabled: !ops.locked, onChanged: ops.setLogo),
            _field('name', 'Tên quán', _name, 'profile-field-name', maxLength: 120),
            _field('phone', 'SĐT liên lạc của quán', _phone, 'profile-field-phone', keyboard: TextInputType.phone, maxLength: 20, help: 'Có thể khác SĐT đăng nhập.'),
            N11Field(fieldKey: const Key('profile-field-zalo'), label: 'Zalo', placeholder: 'Số Zalo của quán', optionalLabel: true, controller: _zalo, maxLength: 160, enabled: !ops.locked, onChanged: _push),
            N11Field(fieldKey: const Key('profile-field-facebook'), label: 'Facebook', placeholder: 'Liên kết trang Facebook', optionalLabel: true, controller: _facebook, maxLength: 300, enabled: !ops.locked, onChanged: _push),
            KeyedSubtree(key: _errorKey('address'), child: AddressLocationField(
              key: const Key('profile-field-address'), label: 'Địa chỉ lấy hàng', text: _address.text,
              error: ops.profileErrors['address'] ?? ops.profileErrors['position'] ?? ops.profileErrors['area'],
              onTap: ops.locked ? null : () async {
                final int epoch = ops.session.sessionEpoch;
                final AddressLocation? selected = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(
                  builder: (_) => AddressLocationPicker(initial: AddressLocation(_address.text,
                    latitude: ops.fix?.latitude ?? o.pickupLat, longitude: ops.fix?.longitude ?? o.pickupLng),
                    location: ops.location, session: ops.session, maxLength: 500)));
                if (selected == null || !context.mounted || ops.session.status != SessionStatus.signedIn || ops.session.sessionEpoch != epoch) return;
                _address.text = selected.text;
                ops.selectAddress(selected.text, latitude: selected.latitude, longitude: selected.longitude);
                setState(() {});
              })),
          ],
          footer: <Widget>[
            N11Button(
              key: const Key('profile-revert'),
              label: 'Bỏ thay đổi',
              kind: ButtonKind.secondary,
              onPressed: ops.locked || !ops.profileDirty ? null : ops.revertProfile,
            ),
            N11Button(
              key: const Key('profile-save'), validate: true,
              label: ops.busy ? 'Đang lưu…' : 'Lưu hồ sơ',
              loading: ops.busy,
              onPressed: ops.locked ? null : () {
                _push();
                ops.saveProfile();
              },
            ),
          ],
        );
      },
    );
  }

  List<Widget> _banners(bool readOnly) {
    final AuthFailure? failure = ops.writeFailure;
    return <Widget>[
      if (readOnly) const N11Banner(key: Key('profile-readonly'), kind: BannerKind.info, title: 'Chỉ đọc', text: 'Quán đã bị vô hiệu hóa. Bạn không thể chỉnh sửa hồ sơ.'),
      if (ops.overview?.availability.reason == 'SERVICE_AREA_INACTIVE')
        const N11Banner(kind: BannerKind.warn, title: 'Khu vực phục vụ ngừng hoạt động', text: 'Hệ thống sẽ xác định khu vực phục vụ khi lưu hồ sơ.'),
      if (ops.stale) const N11Banner(key: Key('profile-stale'), kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.'),
      if (ops.pending != null && ops.pending!.kind == OpsWriteKind.profile) UnknownOutcomeBanner(onRetry: ops.retryPending, busy: ops.busy),
      if (failure != null && ops.pending == null && !ops.conflict)
        N11Banner(key: const Key('profile-error'), kind: BannerKind.error, title: 'Chưa lưu được', text: m02FailureText(failure)),
      if (ops.savedNotReloaded)
        N11Banner(
          key: const Key('profile-saved-not-reloaded'),
          kind: BannerKind.warn,
          title: 'Đã lưu, chưa tải lại được dữ liệu',
          trailing: N11Button(key: const Key('profile-reload'), label: 'Tải lại', compact: true, onPressed: ops.reloadAfterSave),
        ),
    ];
  }

  Widget _field(String errorKey, String label, TextEditingController controller, String key, {TextInputType? keyboard, int? maxLength, String? help}) {
    final String? error = ops.profileErrors[errorKey];
    return KeyedSubtree(
      key: _errorKey(errorKey),
      child: N11Field(
        fieldKey: Key(key),
        label: label,
        controller: controller,
        keyboard: keyboard,
        maxLength: maxLength,
        enabled: !ops.locked,
        tone: error != null ? FieldTone.error : FieldTone.normal,
        hint: error ?? help,
        onChanged: _push,
      ),
    );
  }


}

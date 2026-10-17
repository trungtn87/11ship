import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'driver_controller.dart';

// M03 on Android. S12: the Shipper profile (create it once, edit it, send it for review, see why it was refused) and its bank account;
// S13: the status of the profile; S14: receiving orders and stopping activity. The server decides which state applies and every
// condition: nothing here grants a delivery right, and nothing here shows the internal classification or any system parameter.

String _failureText(AuthFailure failure) => driverRefusalMessage(failure) ?? failureMessage(failure);

Widget _failureBanner(DriverController c, {String keyName = 'driver-error'}) {
  final AuthFailure? failure = c.failure;
  if (failure == null) {
    return const SizedBox.shrink();
  }
  return N11Banner(
    key: Key(keyName),
    kind: BannerKind.error,
    title: 'Chưa hoàn tất',
    text: _failureText(failure),
    trailing: c.hasPendingWrite && canRetryFailure(failure) ? N11Button(key: const Key('driver-retry'), label: 'Thử lại', compact: true, onPressed: c.busy ? null : c.retryPending) : null,
  );
}

ChipKind _standingKind(DriverProfile profile) {
  if (profile.status == 'ACTIVE') {
    return ChipKind.ok;
  }
  if (profile.submitted || profile.status == 'CLOSING') {
    return ChipKind.warn;
  }
  if (profile.draft || profile.status == 'CLOSED') {
    return ChipKind.neutral;
  }
  return ChipKind.bad;
}

class DriverProfileScreen extends StatefulWidget {
  const DriverProfileScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<DriverProfileScreen> createState() => _DriverProfileScreenState();
}

class _DriverProfileScreenState extends State<DriverProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _plate;
  String? _editingFor;
  String? _saved;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.controller.fullName);
    _plate = TextEditingController(text: widget.controller.plateNumber);
    widget.controller.clearFailure();
    widget.controller.load();
    widget.controller.session.addListener(_leaveWhenSignedOut);
  }

  @override
  void dispose() {
    widget.controller.session.removeListener(_leaveWhenSignedOut);
    widget.controller.fullName = _name.text;
    widget.controller.plateNumber = _plate.text;
    _name.dispose();
    _plate.dispose();
    super.dispose();
  }

  void _leaveWhenSignedOut() {
    if (widget.controller.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  /// The edit form starts from what the server holds, once per version (typing is never overwritten by a re-draw).
  void _seed(DriverProfile profile) {
    final String marker = '${profile.driverId}:${profile.version}';
    if (_editingFor != marker) {
      _editingFor = marker;
      _name.text = profile.fullName;
      _plate.text = profile.plateNumber ?? '';
    }
  }

  Future<void> _save(DriverController c) async {
    final bool ok = await c.saveProfile(fullName: _name.text, plateNumber: _plate.text);
    if (ok && mounted) {
      setState(() => _saved = 'Đã lưu thông tin hồ sơ.');
    }
  }

  Future<void> _sendForReview(DriverController c) async {
    final bool ok = await c.submitForReview();
    if (ok && mounted) {
      setState(() => _saved = 'Đã gửi hồ sơ. Hồ sơ đang chờ xét duyệt.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final DriverController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final DriverProfile? profile = c.profile;
        final bool loading = c.loadState == DriverLoad.loading || c.loadState == DriverLoad.idle;
        return N11FormScaffold(
          title: 'Hồ sơ shipper',
          session: null,
          children: <Widget>[
            _failureBanner(c),
            if (loading && profile == null) const N11Banner(key: Key('driver-loading'), kind: BannerKind.info, title: 'Đang đọc hồ sơ shipper từ máy chủ…'),
            if (c.loadState == DriverLoad.failed) N11Button(key: const Key('driver-reload'), label: 'Tải lại', kind: ButtonKind.secondary, onPressed: c.load),
            if (c.loadState == DriverLoad.ready && profile == null) ..._form(c),
            if (profile != null) ..._status(context, c, profile),
          ],
        );
      },
    );
  }

  List<Widget> _form(DriverController c) {
    final bool busy = c.busy;
    return <Widget>[
      const N11Heading('Thông tin shipper', sub: 'Dùng tài khoản 11Ship hiện tại, không cần đăng ký lại. Điền họ tên để tạo hồ sơ; bước sau là tài khoản ngân hàng rồi gửi xét duyệt.'),
      N11Field(fieldKey: const Key('driver-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !busy, onChanged: () { c.fullName = _name.text; setState(() {}); }),
      N11Field(fieldKey: const Key('driver-plate'), label: 'Biển số xe', optionalLabel: true, placeholder: '59X1-123.45', controller: _plate, maxLength: 32, enabled: !busy, onChanged: () { c.plateNumber = _plate.text; setState(() {}); }),
      N11Button(
        key: const Key('driver-submit'),
        label: busy ? 'Đang tạo…' : 'Tạo hồ sơ',
        loading: busy,
        onPressed: busy || _name.text.trim().isEmpty ? null : c.submit,
      ),
    ];
  }

  List<Widget> _status(BuildContext context, DriverController c, DriverProfile profile) {
    _seed(profile);
    final bool busy = c.busy;
    return <Widget>[
      N11AvatarCard(
        name: profile.fullName,
        phone: profile.phone ?? profile.shipperCode,
        nameKey: const Key('driver-status-name'),
        chips: <Widget>[
          const N11Chip('Shipper', kind: ChipKind.dark),
          N11Chip(driverStandingLabel(profile), key: const Key('driver-status-chip'), kind: _standingKind(profile)),
          N11Chip(profile.acceptingDeliveries ? 'Đang nhận đơn' : 'Chưa nhận đơn', kind: profile.acceptingDeliveries ? ChipKind.ok : ChipKind.soon),
        ],
      ),
      if (_saved != null) N11Banner(key: const Key('driver-saved'), kind: BannerKind.success, title: _saved!),
      if (profile.rejected) N11Banner(key: const Key('driver-rejected'), kind: BannerKind.error, title: 'Hồ sơ bị từ chối', text: 'Lý do: ${profile.rejectionReason ?? 'Không rõ'}. Bạn có thể chỉnh sửa và gửi lại.'),
      if (profile.submitted) const N11Banner(key: Key('driver-submitted'), kind: BannerKind.info, title: 'Hồ sơ đang chờ xét duyệt', text: 'Quản trị viên sẽ duyệt hồ sơ. Bạn chưa nhận đơn được cho đến khi hồ sơ được duyệt.'),
      if (profile.draft) const N11Banner(key: Key('driver-draft'), kind: BannerKind.warn, title: 'Hồ sơ chưa gửi xét duyệt', text: 'Khai báo tài khoản ngân hàng rồi bấm "Gửi hồ sơ xét duyệt".'),
      if (profile.status == 'SUSPENDED') N11Banner(key: const Key('driver-suspended'), kind: BannerKind.error, title: 'Tài khoản đang bị tạm khóa', text: profile.suspensionReason == null ? null : 'Lý do: ${profile.suspensionReason}. Đơn đã nhận và số dư ví của bạn không bị ảnh hưởng.'),
      if (profile.status == 'CLOSING') const N11Banner(key: Key('driver-closing'), kind: BannerKind.warn, title: 'Đang xin ngừng hoạt động', text: 'Bạn đã ngừng nhận đơn mới. Đơn đang giao vẫn cần hoàn tất.'),
      if (profile.canEditProfile) ...<Widget>[
        N11Field(fieldKey: const Key('driver-edit-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !busy, onChanged: () => setState(() => _saved = null)),
        N11Field(fieldKey: const Key('driver-edit-plate'), label: 'Biển số xe', optionalLabel: true, placeholder: '59X1-123.45', controller: _plate, maxLength: 32, enabled: !busy, onChanged: () => setState(() => _saved = null)),
        N11Button(
          key: const Key('driver-save-profile'),
          label: 'Lưu thông tin',
          kind: ButtonKind.secondary,
          loading: busy,
          onPressed: busy || _name.text.trim().isEmpty || (_name.text.trim() == profile.fullName && _plate.text.trim() == (profile.plateNumber ?? '')) ? null : () => _save(c),
        ),
      ] else
        N11InfoCard(
          title: 'Thông tin cơ bản',
          rows: <(String, String)>[
            ('Họ tên', profile.fullName),
            if (profile.phone != null) ('Số điện thoại', profile.phone!),
            ('Mã shipper', profile.shipperCode),
            if (profile.plateNumber != null) ('Biển số', profile.plateNumber!),
          ],
        ),
      N11List(
        children: <Widget>[
          N11ListItem(
            key: const Key('driver-bank-entry'),
            icon: Icons.account_balance_outlined,
            title: 'Tài khoản ngân hàng',
            sub: profile.bank == null ? 'Chưa khai báo' : '${profile.bank!.bankName} · ${bankStateLabel(profile.bank!.verificationState)}',
            onTap: profile.status == 'CLOSING' || profile.status == 'CLOSED' ? null : () => Navigator.of(context).push(n11Route(DriverBankScreen(controller: c))),
          ),
          if (profile.status == 'ACTIVE' || profile.status == 'SUSPENDED' || profile.status == 'CLOSING')
            N11ListItem(
              key: const Key('driver-activity-entry'),
              icon: Icons.two_wheeler_outlined,
              title: 'Nhận đơn và ngừng hoạt động',
              sub: profile.acceptingDeliveries ? 'Đang nhận đơn' : 'Đang tắt nhận đơn',
              onTap: () => Navigator.of(context).push(n11Route(DriverActivityScreen(controller: c))),
            ),
        ],
      ),
      if (profile.canSubmit)
        N11Button(
          key: const Key('driver-send-review'),
          label: busy ? 'Đang gửi…' : (profile.rejected ? 'Gửi lại hồ sơ' : 'Gửi hồ sơ xét duyệt'),
          loading: busy,
          onPressed: busy || profile.bank == null ? null : () => _sendForReview(c),
        ),
      if (profile.canSubmit && profile.bank == null) const ReasonNote('Cần khai báo tài khoản ngân hàng trước khi gửi hồ sơ.'),
      N11Button(key: const Key('driver-refresh'), label: 'Tải lại', kind: ButtonKind.secondary, onPressed: busy ? null : c.load),
    ];
  }
}

/// The bank account of the Shipper: bank, number and holder. The holder must be the Shipper's name; a change needs a new check.
class DriverBankScreen extends StatefulWidget {
  const DriverBankScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<DriverBankScreen> createState() => _DriverBankScreenState();
}

class _DriverBankScreenState extends State<DriverBankScreen> {
  late final TextEditingController _number;
  late final TextEditingController _holder;
  String? _bankCode;
  bool _seeded = false;
  String? _saved;

  @override
  void initState() {
    super.initState();
    _number = TextEditingController();
    _holder = TextEditingController();
    widget.controller.clearFailure();
    widget.controller.loadBanks();
  }

  @override
  void dispose() {
    _number.dispose();
    _holder.dispose();
    super.dispose();
  }

  void _seed(DriverProfile profile) {
    if (_seeded) {
      return;
    }
    _seeded = true;
    final DriverBank? bank = profile.bank;
    _bankCode = bank?.bankCode;
    _number.text = bank?.accountNumber ?? '';
    _holder.text = bank?.accountHolder ?? profile.fullName;
  }

  bool get _complete => _bankCode != null && RegExp(r'^[0-9][0-9 -]{4,28}[0-9]$').hasMatch(_number.text.trim()) && _holder.text.trim().isNotEmpty;

  Future<void> _save(DriverController c) async {
    final bool ok = await c.saveBank(bankCode: _bankCode!, accountNumber: _number.text, accountHolder: _holder.text);
    if (ok && mounted) {
      setState(() => _saved = 'Đã lưu tài khoản ngân hàng. Quản trị viên sẽ xác minh.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final DriverController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final DriverProfile? profile = c.profile;
        if (profile == null) {
          return N11FormScaffold(title: 'Tài khoản ngân hàng', session: null, children: <Widget>[_failureBanner(c), const N11Banner(kind: BannerKind.info, title: 'Chưa có hồ sơ shipper')]);
        }
        _seed(profile);
        final DriverBank? bank = profile.bank;
        final bool busy = c.busy;
        final bool known = c.banks.any((BankOption o) => o.code == _bankCode);
        return N11FormScaffold(
          title: 'Tài khoản ngân hàng',
          session: null,
          children: <Widget>[
            _failureBanner(c),
            if (_saved != null) N11Banner(key: const Key('driver-bank-saved'), kind: BannerKind.success, title: _saved!),
            if (bank != null)
              N11InfoCard(
                title: 'Trạng thái xác minh',
                chip: N11Chip(bankStateLabel(bank.verificationState), key: const Key('driver-bank-state'), kind: bank.verified ? ChipKind.ok : (bank.verificationState == 'REJECTED' ? ChipKind.bad : ChipKind.warn)),
                text: bank.verificationState == 'REJECTED' ? 'Lý do: ${bank.rejectionReason ?? 'Không rõ'}. Hãy sửa thông tin và lưu lại.' : (bank.verified ? 'Ngân hàng đã được xác minh.' : 'Đang chờ quản trị viên xác minh.'),
              ),
            const N11Heading('Thông tin nhận tiền', sub: 'Tên chủ tài khoản phải khớp họ tên shipper. Đổi ngân hàng hoặc số tài khoản sẽ phải xác minh lại và tạm tắt nhận đơn.'),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: N11Space.gap3),
              decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(14)),
              child: DropdownButton<String>(
                key: const Key('driver-bank-code'),
                isExpanded: true,
                underline: const SizedBox.shrink(),
                hint: Text(c.banks.isEmpty ? 'Đang tải danh sách ngân hàng…' : 'Chọn ngân hàng', style: N11Text.body),
                value: known ? _bankCode : null,
                items: <DropdownMenuItem<String>>[for (final BankOption o in c.banks) DropdownMenuItem<String>(value: o.code, child: Text(o.name, style: N11Text.body))],
                onChanged: busy ? null : (String? value) => setState(() {
                  _bankCode = value;
                  _saved = null;
                }),
              ),
            ),
            N11Field(fieldKey: const Key('driver-bank-number'), label: 'Số tài khoản', controller: _number, keyboard: TextInputType.number, maxLength: 24, enabled: !busy, onChanged: () => setState(() => _saved = null)),
            N11Field(fieldKey: const Key('driver-bank-holder'), label: 'Tên chủ tài khoản', controller: _holder, maxLength: 120, hint: 'Phải khớp họ tên: ${profile.fullName}', enabled: !busy, onChanged: () => setState(() => _saved = null)),
            N11Button(key: const Key('driver-bank-save'), label: busy ? 'Đang lưu…' : 'Lưu tài khoản ngân hàng', loading: busy, onPressed: busy || !_complete ? null : () => _save(c)),
          ],
        );
      },
    );
  }
}

/// Receiving orders (on/off, with what is missing) and the request to stop working.
class DriverActivityScreen extends StatefulWidget {
  const DriverActivityScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<DriverActivityScreen> createState() => _DriverActivityScreenState();
}

class _DriverActivityScreenState extends State<DriverActivityScreen> {
  final TextEditingController _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.controller.clearFailure();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _confirmClosure(BuildContext context, DriverController c) async {
    final bool? yes = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Ngừng hoạt động?'),
        content: const Text('Bạn sẽ ngừng nhận đơn mới ngay. Các đơn đang giao vẫn phải hoàn tất. Số dư ví của bạn không bị mất. Bạn có thể hủy yêu cầu khi chưa được xử lý.'),
        actions: <Widget>[
          TextButton(key: const Key('driver-closure-cancel'), onPressed: () => Navigator.of(context).pop(false), child: const Text('Không')),
          TextButton(key: const Key('driver-closure-confirm'), onPressed: () => Navigator.of(context).pop(true), child: const Text('Gửi yêu cầu')),
        ],
      ),
    );
    if (yes == true) {
      await c.requestClosure(_note.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DriverController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final DriverProfile? profile = c.profile;
        if (profile == null) {
          return N11FormScaffold(title: 'Nhận đơn', session: null, children: <Widget>[_failureBanner(c), const N11Banner(kind: BannerKind.info, title: 'Chưa có hồ sơ shipper')]);
        }
        final DriverReadiness r = profile.readiness;
        final bool busy = c.busy;
        final bool active = profile.status == 'ACTIVE';
        // Turning off is always possible; turning on only when the server says every condition holds.
        final bool canToggle = !busy && (profile.acceptingDeliveries || (active && r.canAccept));
        return N11FormScaffold(
          title: 'Nhận đơn',
          session: null,
          children: <Widget>[
            _failureBanner(c),
            N11Card(
              child: Row(
                children: <Widget>[
                  const Expanded(child: Text('Nhận đơn', style: N11Text.bodyStrong)),
                  Switch(key: const Key('driver-accepting-switch'), value: profile.acceptingDeliveries, onChanged: canToggle ? (bool value) => c.setAccepting(value) : null),
                ],
              ),
            ),
            const ReasonNote('Tắt nhận đơn không hủy các đơn bạn đã nhận.'),
            N11CheckList(
              items: <N11CheckItem>[
                N11CheckItem('Hồ sơ đã được duyệt', active || profile.status == 'CLOSING' || profile.status == 'SUSPENDED' ? CheckState.done : CheckState.missing),
                N11CheckItem('Ngân hàng đã xác minh', r.bankVerified ? CheckState.done : CheckState.missing),
                N11CheckItem('Ví đủ điều kiện nhận đơn', r.walletReady ? CheckState.done : CheckState.missing),
              ],
            ),
            if (!r.canAccept && !profile.acceptingDeliveries)
              N11Banner(
                key: const Key('driver-blocks'),
                kind: BannerKind.warn,
                title: 'Chưa bật được nhận đơn',
                text: r.blocks.map(driverBlockLabel).join('\n'),
              ),
            const SizedBox(height: N11Space.gap2),
            const N11Heading('Ngừng hoạt động', sub: 'Gửi yêu cầu nếu bạn không muốn làm shipper nữa. Đơn đang giao phải hoàn tất, số dư ví không bị mất.'),
            if (profile.status == 'CLOSING') ...<Widget>[
              N11Banner(key: const Key('driver-closure-pending'), kind: BannerKind.warn, title: 'Đã gửi yêu cầu ngừng hoạt động', text: profile.closure?.note == null ? 'Bạn đã ngừng nhận đơn mới.' : 'Ghi chú: ${profile.closure!.note}'),
              N11Button(key: const Key('driver-closure-undo'), label: 'Hủy yêu cầu ngừng hoạt động', kind: ButtonKind.secondary, loading: busy, onPressed: busy || !(profile.closure?.canCancel ?? false) ? null : c.cancelClosure),
            ] else if (active) ...<Widget>[
              N11Field(fieldKey: const Key('driver-closure-note'), label: 'Ghi chú', optionalLabel: true, controller: _note, maxLength: 500, enabled: !busy),
              N11Button(key: const Key('driver-closure-request'), label: 'Gửi yêu cầu ngừng hoạt động', kind: ButtonKind.secondary, loading: busy, onPressed: busy ? null : () => _confirmClosure(context, c)),
            ] else
              const ReasonNote('Chỉ gửi được yêu cầu ngừng hoạt động khi hồ sơ đang hoạt động.'),
          ],
        );
      },
    );
  }
}

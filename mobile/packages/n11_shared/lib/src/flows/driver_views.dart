import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../features.dart';
import '../widgets/components.dart';
import 'driver_controller.dart';

// S12 (submit) and S13 (status) on Android: the server decides which one is shown. Nothing here grants a delivery right.

class DriverProfileScreen extends StatefulWidget {
  const DriverProfileScreen({super.key, required this.controller});

  final DriverController controller;

  @override
  State<DriverProfileScreen> createState() => _DriverProfileScreenState();
}

class _DriverProfileScreenState extends State<DriverProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _plate;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.controller.fullName);
    _plate = TextEditingController(text: widget.controller.plateNumber);
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

  @override
  Widget build(BuildContext context) {
    final DriverController c = widget.controller;
    return ListenableBuilder(
      listenable: c,
      builder: (BuildContext context, Widget? child) {
        final DriverProfile? profile = c.profile;
        final AuthFailure? failure = c.failure;
        final bool loading = c.loadState == DriverLoad.loading || c.loadState == DriverLoad.idle;
        return N11FormScaffold(
          title: 'Hồ sơ xế',
          session: null,
          children: <Widget>[
            if (failure != null)
              N11Banner(
                key: const Key('driver-error'),
                kind: BannerKind.error,
                title: 'Chưa hoàn tất',
                text: failureMessage(failure),
                trailing: c.hasPendingWrite && canRetryFailure(failure)
                    ? N11Button(key: const Key('driver-retry'), label: 'Thử lại', compact: true, onPressed: c.busy ? null : c.retryPending)
                    : null,
              ),
            if (loading && profile == null) const N11Banner(key: Key('driver-loading'), kind: BannerKind.info, title: 'Đang đọc hồ sơ xế từ máy chủ…'),
            if (c.loadState == DriverLoad.failed) N11Button(key: const Key('driver-reload'), label: 'Tải lại', kind: ButtonKind.secondary, onPressed: c.load),
            if (c.loadState == DriverLoad.ready && profile == null) ..._form(c),
            if (profile != null) ..._status(c, profile),
          ],
        );
      },
    );
  }

  List<Widget> _form(DriverController c) {
    final bool busy = c.busy;
    return <Widget>[
      const N11Heading('Thông tin tài xế', sub: 'Điền thông tin để gửi hồ sơ. Gửi hồ sơ chưa cho phép nhận đơn: hồ sơ sẽ chờ duyệt.'),
      N11Field(fieldKey: const Key('driver-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !busy, onChanged: () { c.fullName = _name.text; setState(() {}); }),
      N11Field(fieldKey: const Key('driver-plate'), label: 'Biển số xe', optionalLabel: true, placeholder: '59X1-123.45', controller: _plate, maxLength: 32, enabled: !busy, onChanged: () { c.plateNumber = _plate.text; setState(() {}); }),
      N11Button(
        key: const Key('driver-submit'),
        label: busy ? 'Đang gửi…' : 'Gửi hồ sơ',
        loading: busy,
        onPressed: busy || _name.text.trim().isEmpty ? null : c.submit,
      ),
    ];
  }

  List<Widget> _status(DriverController c, DriverProfile profile) {
    return <Widget>[
      N11AvatarCard(
        name: profile.fullName,
        phone: driverTypeLabel(profile.driverType),
        nameKey: const Key('driver-status-name'),
        chips: <Widget>[
          const N11Chip('Tài xế', kind: ChipKind.dark),
          N11Chip(driverStatusLabel(profile.status), key: const Key('driver-status-chip'), kind: profile.status == 'ACTIVE' ? ChipKind.ok : (profile.status == 'PENDING' ? ChipKind.warn : ChipKind.bad)),
          const N11Chip('Chưa nhận đơn', kind: ChipKind.soon),
        ],
      ),
      if (profile.plateNumber != null)
        N11InfoCard(title: 'Thông tin cơ bản', rows: <(String, String)>[('Phương tiện', driverTypeLabel(profile.driverType)), ('Biển số', profile.plateNumber!)]),
      ReasonNote('Nhận đơn: $kNotOnAndroidReason'),
      N11Button(key: const Key('driver-refresh'), label: 'Tải lại', kind: ButtonKind.secondary, onPressed: c.busy ? null : c.load),
    ];
  }
}

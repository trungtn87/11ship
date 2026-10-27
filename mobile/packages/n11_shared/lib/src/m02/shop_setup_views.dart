import 'package:flutter/material.dart';

import '../tokens.dart';
import '../widgets/components.dart';
import 'shop_setup_controller.dart';

// Issue #190: the checklist card "Hoàn tất thiết lập cửa hàng" (x/4) and the two sentences around it. Everything on it is the server's answer; a
// tap on a step that is not done opens the screen where it is done (the caller decides which). Vietnamese only, plain, no approval wording.

const String kSetupReadyTitle = 'Cửa hàng của bạn đã sẵn sàng!';
const String kSetupReadyText = 'Khách hàng có thể tìm thấy quán và đặt món khi quán mở cửa.';

const Map<String, String> _stepTitle = <String, String>{
  'ACCOUNT': 'Tạo tài khoản',
  'SHOP_INFO': 'Thiết lập thông tin quán',
  'LOCATION': 'Xác nhận vị trí quán',
  'FIRST_ITEM': 'Thêm món đầu tiên',
};

const Map<String, String> _stepHelp = <String, String>{
  'ACCOUNT': 'Đăng ký số điện thoại và xác thực OTP.',
  'SHOP_INFO': 'Tên quán, địa chỉ, số điện thoại liên hệ và giờ hoạt động.',
  'LOCATION': 'Lấy vị trí GPS khi đang ở quán. Địa chỉ nhập tay không thay cho GPS.',
  'FIRST_ITEM': 'Có ít nhất 1 món đang bán, giá lớn hơn 0. Ảnh không bắt buộc.',
};

const Map<String, String> _missingText = <String, String>{
  'NAME': 'tên quán',
  'ADDRESS': 'địa chỉ',
  'CONTACT_PHONE': 'số điện thoại liên hệ',
  'SERVICE_AREA': 'khu vực phục vụ',
  'BUSINESS_HOURS': 'giờ hoạt động',
  'PICKUP_POINT': 'vị trí GPS tại quán',
  'SELLABLE_ITEM': 'món đang bán có giá hợp lệ',
};

String setupMissingText(List<String> codes) => <String>[for (final String c in codes) _missingText[c] ?? c].join(', ');

({String label, ChipKind kind}) setupStateChip(ShopSetup setup) {
  switch (setup.state) {
    case 'ACTIVATED':
      return (label: 'Đã kích hoạt', kind: ChipKind.ok);
    case 'LOCKED':
      return (label: 'Tạm khóa', kind: ChipKind.bad);
    case 'NEEDS_REVIEW':
      return (label: 'Cần bổ sung', kind: ChipKind.warn);
    default:
      return (label: 'Chưa hoàn tất', kind: ChipKind.warn);
  }
}

/// The one-time "ready" message, shown when the server has just activated the shop.
class ShopSetupReadyBanner extends StatelessWidget {
  const ShopSetupReadyBanner({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return N11Banner(
      key: const Key('setup-ready'),
      kind: BannerKind.success,
      title: kSetupReadyTitle,
      text: kSetupReadyText,
      trailing: N11Button(key: const Key('setup-ready-close'), label: 'Đã hiểu', compact: true, kind: ButtonKind.secondary, onPressed: onClose),
    );
  }
}

class ShopSetupChecklist extends StatelessWidget {
  const ShopSetupChecklist({super.key, required this.setup, required this.onStep, this.stale = false, this.onRetry});

  final ShopSetup setup;

  /// A step that is not done was tapped: its key and the codes the server says are missing in it.
  final void Function(String key, List<String> missing) onStep;
  final bool stale;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = setupStateChip(setup);
    final String? note = setup.requestNote;
    final bool locked = setup.isLocked;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(children: <Widget>[
            const Expanded(child: Text('Hoàn tất thiết lập cửa hàng', key: Key('setup-title'), style: N11Text.bodyStrong)),
            Text('${setup.completedSteps}/${setup.totalSteps}', key: const Key('setup-progress'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: N11Colors.black)),
          ]),
          const SizedBox(height: N11Space.gap2),
          Row(children: <Widget>[
            for (int i = 0; i < setup.totalSteps; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: 4),
              Expanded(child: Container(height: 6, decoration: BoxDecoration(color: i < setup.completedSteps ? N11Colors.yellow : N11Colors.line, borderRadius: BorderRadius.circular(3)))),
            ],
          ]),
          if (stale)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap2),
              child: Row(children: <Widget>[
                const Expanded(child: Text('Chưa cập nhật. Đang hiển thị dữ liệu đã tải.', key: Key('setup-stale'), style: N11Text.caption)),
                if (onRetry != null) TextButton(key: const Key('setup-retry'), onPressed: onRetry, child: const Text('Thử lại')),
              ]),
            ),
          if (locked)
            const Padding(
              padding: EdgeInsets.only(top: N11Space.gap3),
              child: Text('Cửa hàng đang bị tạm khóa nên chưa nhận đơn mới. Các bước bên dưới là dữ liệu hiện có; liên hệ hỗ trợ để biết thêm.', key: Key('setup-locked'), style: N11Text.caption),
            ),
          if (note != null)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap3),
              child: N11Banner(key: const Key('setup-request'), kind: BannerKind.warn, title: 'Quản trị viên đề nghị bổ sung', text: note),
            ),
          for (final SetupStepView step in setup.steps) _row(step),
          const Divider(height: 1, color: N11Colors.line),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(children: <Widget>[
              const Icon(Icons.storefront_outlined, size: 22, color: N11Colors.black),
              const SizedBox(width: N11Space.gap3),
              const Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                  Text('Kích hoạt cửa hàng', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: N11Colors.black)),
                  Text('Tự động khi đủ 4 bước, không cần chờ duyệt.', style: N11Text.caption),
                ]),
              ),
              N11Chip(chip.label, key: const Key('setup-state'), kind: chip.kind),
            ]),
          ),
        ],
      ),
    );
  }

  Widget _row(SetupStepView step) {
    final bool done = step.done;
    final String title = _stepTitle[step.key] ?? step.key;
    final String sub = done ? (_stepHelp[step.key] ?? '') : 'Còn thiếu: ${setupMissingText(step.missing)}.';
    final Widget content = Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, color: done ? N11Colors.yellow : N11Colors.white, border: Border.all(color: done ? N11Colors.yellow : N11Colors.error, width: 2)),
          child: done ? const Icon(Icons.check, size: 16, color: N11Colors.black) : const Text('!', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: N11Colors.error)),
        ),
        const SizedBox(width: N11Space.gap3),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: N11Colors.black)),
            Text(sub, key: Key('setup-step-sub-${step.key}'), style: done ? N11Text.caption : const TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w600, color: N11Colors.errorInk)),
          ]),
        ),
        if (!done) const Padding(padding: EdgeInsets.only(left: 8, top: 2), child: Icon(Icons.chevron_right, size: 20, color: N11Colors.ink2)),
      ]),
    );
    if (done) {
      return Semantics(label: '$title, đã xong', excludeSemantics: true, child: KeyedSubtree(key: Key('setup-step-${step.key}'), child: content));
    }
    return Semantics(
      button: true,
      label: '$title, chưa xong. Chạm để hoàn tất.',
      excludeSemantics: true,
      child: InkWell(key: Key('setup-step-${step.key}'), onTap: () => onStep(step.key, step.missing), child: ConstrainedBox(constraints: const BoxConstraints(minHeight: kTapMin), child: content)),
    );
  }
}

import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../account/models.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'schedule.dart';

// Widgets shared by the M02 screens (Q01-Q07, K01-K02): the screen frame with a footer that stays above the keyboard, the one dialog
// and the one toast, loading / failed / unavailable blocks, the dish row and the schedule row. Words are fixed here; nothing the server
// wrote is shown.

/// Screen frame: app bar with back, scrolling body, and an optional footer of one or two buttons that sits above the keyboard.
/// [onWillLeave] is asked before leaving (back button or system back): false keeps the screen (an unsaved draft asks first).
class M02Scaffold extends StatelessWidget {
  const M02Scaffold({super.key, required this.title, required this.content, this.footer = const <Widget>[], this.onWillLeave, this.action, this.scrollController});

  final String title;
  final List<Widget> content;
  final List<Widget> footer;
  final Future<bool> Function()? onWillLeave;
  final Widget? action;
  final ScrollController? scrollController;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: onWillLeave == null,
      onPopInvokedWithResult: (bool didPop, Object? result) async {
        if (didPop || onWillLeave == null) {
          return;
        }
        final NavigatorState navigator = Navigator.of(context);
        if (await onWillLeave!()) {
          navigator.pop();
        }
      },
      child: Form(child: Scaffold(
        backgroundColor: N11Colors.bg,
        body: SafeArea(
          child: Column(
            children: <Widget>[
              Stack(
                children: <Widget>[
                  N11AppBar(
                    title: title,
                    onBack: () async {
                      final NavigatorState navigator = Navigator.of(context);
                      if (onWillLeave == null || await onWillLeave!()) {
                        navigator.pop();
                      }
                    },
                  ),
                  if (action != null) Positioned(right: 4, top: 0, bottom: 0, child: Center(child: action)),
                ],
              ),
              Expanded(
                child: SingleChildScrollView(
                  controller: scrollController,
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap6),
                  child: vstack(content),
                ),
              ),
              if (footer.isNotEmpty)
                Container(
                  padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap3, N11Space.pad, N11Space.gap3),
                  decoration: const BoxDecoration(color: N11Colors.white, border: Border(top: BorderSide(color: N11Colors.line))),
                  child: Row(
                    children: <Widget>[
                      for (int i = 0; i < footer.length; i++) ...<Widget>[
                        if (i > 0) const SizedBox(width: N11Space.gap3),
                        Expanded(flex: footer.length == 2 && i == 1 ? 2 : 1, child: footer[i]),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      )),
    );
  }
}

class DialogAction {
  const DialogAction(this.label, this.value, {this.kind = ButtonKind.secondary, this.key});

  final String label;
  final String value;
  final ButtonKind kind;
  final Key? key;
}

/// The one dialog of M02 (confirm, discard, conflict, ...). Returns the chosen [DialogAction.value]; null if dismissed outside.
Future<String?> showDecision(BuildContext context, {required String title, required String text, required List<DialogAction> actions, bool dismissible = false}) {
  return showDialog<String>(
    context: context,
    barrierDismissible: dismissible,
    builder: (BuildContext context) => Dialog(
      backgroundColor: N11Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusCard)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(header: true, child: Text(title, style: N11Text.h2)),
            const SizedBox(height: N11Space.gap2),
            Text(text, style: N11Text.lead),
            const SizedBox(height: N11Space.gap4),
            for (int i = 0; i < actions.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(height: N11Space.gap2),
              N11Button(key: actions[i].key ?? Key('dlg-${actions[i].value}'), label: actions[i].label, kind: actions[i].kind, onPressed: () => Navigator.of(context).pop(actions[i].value)),
            ],
          ],
        ),
      ),
    ),
  );
}

/// "Bỏ thay đổi chưa lưu?" -> true when the person chose to leave.
Future<bool> confirmDiscard(BuildContext context) async {
  final String? choice = await showDecision(
    context,
    title: 'Bỏ thay đổi chưa lưu?',
    text: 'Những chỉnh sửa trên màn này sẽ mất.',
    actions: const <DialogAction>[DialogAction('Tiếp tục sửa', 'stay'), DialogAction('Bỏ thay đổi', 'leave', kind: ButtonKind.dark)],
  );
  return choice == 'leave';
}

void m02Toast(BuildContext context, String text) {
  final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
  messenger?.hideCurrentSnackBar();
  // Floats above the footer buttons (about 72 px high), so a toast never covers Lưu / Xong.
  messenger?.showSnackBar(SnackBar(content: Text(text), margin: const EdgeInsets.fromLTRB(N11Space.pad, 0, N11Space.pad, 88), duration: const Duration(seconds: 3)));
}

/// A skeleton block while the first load runs: the screen is never an empty form that could be saved over the server's data.
class M02Skeleton extends StatelessWidget {
  const M02Skeleton({super.key, this.rows = 4, this.height = 60});

  final int rows;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Đang tải',
      child: Column(
        children: <Widget>[
          for (int i = 0; i < rows; i++)
            Container(
              height: height,
              margin: const EdgeInsets.only(bottom: N11Space.gap3),
              decoration: BoxDecoration(color: N11Colors.line.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(kRadiusControl)),
            ),
        ],
      ),
    );
  }
}

/// "Không tải được dữ liệu" with Thử lại: never "not found". Nothing was changed.
class M02LoadFailed extends StatelessWidget {
  const M02LoadFailed({super.key, required this.onRetry, this.text});

  final VoidCallback onRetry;
  final String? text;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        N11StateBlock(
          kind: StateKind.warn,
          title: 'Không tải được dữ liệu',
          text: text ?? 'Chưa nhận được dữ liệu từ máy chủ nên chưa thể hiển thị hay chỉnh sửa. Chưa có gì bị thay đổi.',
        ),
        const SizedBox(height: N11Space.gap4),
        N11Button(key: const Key('m02-retry'), label: 'Thử lại', onPressed: onRetry),
        const SizedBox(height: N11Space.gap2),
        N11Button(key: const Key('m02-back'), label: 'Quay lại', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).maybePop()),
      ],
    );
  }
}

/// This part of the server is not connected in this build (menu / pictures / public shop): said plainly, no retry, no fake data.
class M02NotConnected extends StatelessWidget {
  const M02NotConnected({super.key, required this.what});

  final String what;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        N11StateBlock(
          kind: StateKind.warn,
          icon: Icons.link_off,
          title: 'Chưa nối máy chủ',
          text: '$what chưa được nối với máy chủ trong bản này nên chưa thể xem hoặc chỉnh sửa. Không có dữ liệu nào bị thay đổi.',
        ),
        const SizedBox(height: N11Space.gap4),
        N11Button(key: const Key('m02-back'), label: 'Quay lại', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).maybePop()),
      ],
    );
  }
}

/// The words of a refusal on the shop/menu screens (fixed Vietnamese; the server's text is never shown).
String m02FailureText(AuthFailure failure) {
  switch (failure.code) {
    case 'SHOP_DISABLED':
      return 'Quán đã bị vô hiệu hóa nên không thể lưu thay đổi.';
    case 'SHOP_PROFILE_INCOMPLETE':
      return 'Hồ sơ quán chưa hoàn tất. Hãy hoàn tất hồ sơ trước.';
    case 'SHOP_ROLE_REQUIRED':
      return 'Hãy chuyển sang chế độ quản lý cửa hàng để tiếp tục.';
    case 'SHOP_NOT_FOUND':
      return 'Chưa có hồ sơ cửa hàng cho tài khoản này.';
    case 'INVALID_BUSINESS_HOURS':
      return 'Lịch chưa hợp lệ. Kiểm tra giờ mở, giờ đóng và các khoảng trùng nhau.';
    case 'MENU_ITEM_NOT_FOUND':
      return 'Món không còn trong thực đơn.';
    case 'MENU_CATEGORY_NOT_AVAILABLE':
      return 'Nhóm món này không còn chọn được. Hãy chọn nhóm khác.';
    case 'INVALID_MENU_IMAGE':
      return 'Ảnh không hợp lệ. Hãy chọn ảnh khác hoặc bỏ ảnh.';
  }
  switch (failure.kind) {
    case AuthFailureKind.unknownOutcome:
      return 'Chưa xác định được kết quả lưu. Thử lại để kiểm tra.';
    case AuthFailureKind.serverUnavailable:
      return failure.outcomeUnknown ? 'Chưa xác định được kết quả lưu. Thử lại để kiểm tra.' : 'Máy chủ chưa sẵn sàng. Vui lòng thử lại sau.';
    case AuthFailureKind.versionConflict:
      return 'Dữ liệu đã được cập nhật ở nơi khác.';
    case AuthFailureKind.tls:
      return 'Chứng chỉ bảo mật của máy chủ không hợp lệ. Ứng dụng không bỏ qua bước kiểm tra này.';
    case AuthFailureKind.sessionEnded:
      return 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
    case AuthFailureKind.deviceProofRefused:
      return 'Máy chủ chưa xác nhận được thiết bị. Hãy kiểm tra giờ của điện thoại rồi thử lại.';
    case AuthFailureKind.invalidServiceArea:
      return 'Khu vực đã chọn không còn hợp lệ. Hãy chọn khu vực khác.';
    case AuthFailureKind.badRequest:
      return 'Thông tin chưa hợp lệ. Kiểm tra lại các trường rồi thử lại.';
    case AuthFailureKind.rateLimited:
      return 'Thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
    default:
      return 'Chưa hoàn tất. Vui lòng thử lại.';
  }
}

/// The banner of a write that has no usable answer yet: it locks everything until the same request is sent again.
class UnknownOutcomeBanner extends StatelessWidget {
  const UnknownOutcomeBanner({super.key, required this.onRetry, required this.busy, this.detail});

  final VoidCallback onRetry;
  final bool busy;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return N11Banner(
      key: const Key('pending-banner'),
      kind: BannerKind.warn,
      title: 'Chưa xác định được kết quả lưu',
      text: <String>[if (detail != null) detail!, 'Chưa xác định được kết quả lưu. Thử lại sẽ gửi đúng nội dung của lần lưu trước, không gửi nội dung mới sửa. Chỉnh sửa tạm khóa cho đến khi biết kết quả.'].join('\n'),
      trailing: N11Button(key: const Key('pending-retry'), label: busy ? 'Đang thử lại…' : 'Thử lại', compact: true, loading: busy, onPressed: busy ? null : onRetry),
    );
  }
}

/// Dish picture (or a placeholder of the same size, so rows do not jump).
class DishThumb extends StatelessWidget {
  const DishThumb({super.key, required this.url, this.size = 56, this.bytes});

  final String? url;
  final double size;
  final Uint8List? bytes;

  @override
  Widget build(BuildContext context) {
    final Widget placeholder = Icon(Icons.restaurant, size: size * 0.42, color: N11Colors.placeholder);
    Widget child = placeholder;
    if (bytes != null) {
      child = Image.memory(bytes!, fit: BoxFit.cover, width: size, height: size, errorBuilder: (BuildContext c, Object e, StackTrace? s) => placeholder);
    } else if (url != null) {
      child = Image.network(url!, fit: BoxFit.cover, width: size, height: size, errorBuilder: (BuildContext c, Object e, StackTrace? s) => placeholder);
    }
    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: N11Colors.yellowFaint, borderRadius: BorderRadius.circular(12), border: Border.all(color: N11Colors.line)),
      child: child,
    );
  }
}

/// One row of a dish list (owner list, preview and customer view share it; [dim] is a hidden dish).
class DishRow extends StatelessWidget {
  const DishRow({super.key, required this.name, required this.price, required this.imageUrl, this.sub, this.chip, this.dim = false, this.highlight = false, this.onTap});

  final String name;
  final String price;
  final String? imageUrl;
  final String? sub;
  final Widget? chip;
  final bool dim;

  /// The dish a search result pointed at: marked so the person sees where they landed.
  final bool highlight;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: onTap != null,
      label: '$name, $price',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        child: ColoredBox(
          color: highlight ? N11Colors.yellowSoft : Colors.transparent,
          child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 76),
          child: Opacity(
            opacity: dim ? 0.62 : 1,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: <Widget>[
                  DishThumb(url: imageUrl),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w700, color: N11Colors.black)),
                        const SizedBox(height: 2),
                        Text(price, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.yellowStrong)),
                        if (sub != null) Text(sub!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w500, color: N11Colors.ink2)),
                      ],
                    ),
                  ),
                  if (chip != null) ...<Widget>[const SizedBox(width: N11Space.gap2), chip!],
                  if (onTap != null) ...<Widget>[const SizedBox(width: 4), const Icon(Icons.chevron_right, size: 22, color: N11Colors.ink2)],
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

/// One day of the week: its name and its lines (or "Đóng cửa"). [onTap] null = read-only (K02, read-only shop).
class ScheduleRow extends StatelessWidget {
  const ScheduleRow({super.key, required this.day, required this.lines, this.sub, this.onTap, this.chip, this.mutedWhenEmpty = true, this.emptyText = 'Đóng cửa'});

  final String day;
  final List<String> lines;
  final String? sub;
  final VoidCallback? onTap;
  final Widget? chip;
  final bool mutedWhenEmpty;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final Widget content = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: kTapMin + 12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox(
              width: 104,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(day, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.black)),
                  if (sub != null) Text(sub!, style: const TextStyle(fontSize: 12, color: N11Colors.ink2)),
                ],
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (lines.isEmpty)
                    Text(emptyText, style: TextStyle(fontSize: 14, height: 1.45, fontWeight: FontWeight.w500, color: mutedWhenEmpty ? N11Colors.ink3 : N11Colors.black))
                  else
                    for (final String line in lines) Text(line, style: const TextStyle(fontSize: 14, height: 1.45, fontWeight: FontWeight.w600, color: N11Colors.black)),
                ],
              ),
            ),
            if (chip != null) ...<Widget>[const SizedBox(width: N11Space.gap2), chip!],
            if (onTap != null) ...<Widget>[const SizedBox(width: 4), const Icon(Icons.chevron_right, size: 22, color: N11Colors.ink2)],
          ],
        ),
      ),
    );
    return onTap == null
        ? content
        : Semantics(button: true, label: day, excludeSemantics: true, onTap: onTap, child: InkWell(onTap: onTap, child: content));
  }
}

/// Day lines of a draft day.
List<String> linesOf(List<HourRange> ranges) => dayLines(ranges);

/// Chip + sentence of the shop's server-computed availability, as the owner reads it.
({String label, String text, ChipKind kind}) availabilityCopy(String reason) {
  switch (reason) {
    case 'ONLINE':
      return (label: 'Đang mở cửa', text: 'Quán tự hoạt động theo lịch đã lưu.', kind: ChipKind.ok);
    case 'OUTSIDE_BUSINESS_HOURS':
      return (label: 'Đã đóng cửa', text: 'Ngoài giờ hoạt động đã cài đặt.', kind: ChipKind.neutral);
    case 'NO_BUSINESS_HOURS':
      return (label: 'Chưa cài giờ hoạt động', text: 'Cài lịch để quán tự mở và đóng cửa.', kind: ChipKind.warn);
    case 'SHOP_INCOMPLETE':
      return (label: 'Hồ sơ chưa hoàn tất', text: 'Hoàn tất hồ sơ để quán bắt đầu hoạt động.', kind: ChipKind.warn);
    case 'SHOP_DISABLED':
      return (label: 'Quán đã bị vô hiệu hóa', text: 'Bạn chỉ xem được hồ sơ. Mọi thao tác chỉnh sửa đang bị khóa.', kind: ChipKind.bad);
    case 'SERVICE_AREA_INACTIVE':
      return (label: 'Khu vực phục vụ ngừng hoạt động', text: 'Chọn khu vực phục vụ phù hợp trong hồ sơ quán.', kind: ChipKind.bad);
    default:
      return (label: 'Chưa rõ trạng thái', text: 'Chưa xác định được trạng thái hoạt động. Thử tải lại.', kind: ChipKind.neutral);
  }
}

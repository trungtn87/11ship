import 'package:flutter/material.dart';

import '../tokens.dart';
import 'm13_update.dart';

// M13: the update banner and the blocking update screen. Plain words, one action each; a REQUIRED update says why, and it never covers an order in progress.

String _size(int bytes) => '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';

/// Wraps the app: a blocking screen on top of it for a REQUIRED update (only while the person is not mid-order), otherwise the app with an optional banner
/// above it. The app underneath is never rebuilt from scratch, so the person's place in it is kept.
class AppUpdateGate extends StatelessWidget {
  const AppUpdateGate({super.key, required this.controller, required this.child});

  final AppUpdateController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? _) {
        final bool banner = (controller.showBanner || controller.deferred) && !controller.blocking;
        return AppUpdateScope(
          controller: controller,
          child: Stack(
          children: <Widget>[
            Positioned.fill(
              child: Column(
                children: <Widget>[
                  if (banner) Material(color: N11Colors.white, child: SafeArea(bottom: false, child: AppUpdateBanner(controller: controller))) else const SizedBox.shrink(),
                  Expanded(child: child),
                ],
              ),
            ),
            if (controller.blocking) Positioned.fill(child: AppUpdateScreen(controller: controller)),
          ],
          ),
        );
      },
    );
  }
}

/// Lets a screen deep in the app (the account tab's "Kiểm tra cập nhật") reach the one update controller without threading it through every builder.
class AppUpdateScope extends InheritedWidget {
  const AppUpdateScope({super.key, required this.controller, required super.child});

  final AppUpdateController controller;

  static AppUpdateController? maybeOf(BuildContext context) => context.getInheritedWidgetOfExactType<AppUpdateScope>()?.controller;

  @override
  bool updateShouldNotify(AppUpdateScope oldWidget) => controller != oldWidget.controller;
}

/// What the "Kiểm tra cập nhật" row says under its title, from what the controller knows. Never claims "mới nhất" while the server says a newer build is required.
String updateCheckSummary(AppUpdateController c) {
  if (c.phase == AppUpdatePhase.checking) {
    return 'Đang kiểm tra…';
  }
  if (c.requiredUnavailable) {
    return 'Cần cập nhật nhưng bản mới chưa sẵn sàng để tải. Thử lại sau hoặc liên hệ hỗ trợ.';
  }
  final AppUpdateOffer? offer = c.offer;
  if (offer != null) {
    return offer.required ? 'Cần cập nhật lên ${offer.versionName}' : 'Có bản mới ${offer.versionName}';
  }
  if (c.failureCode != null && c.phase != AppUpdatePhase.upToDate) {
    return updateFailureText(c.failureCode!);
  }
  if (c.phase == AppUpdatePhase.upToDate) {
    return 'Bạn đang dùng bản dùng được với hệ thống hiện tại, chưa có bản mới để tải.';
  }
  return 'Chạm để kiểm tra bản mới.';
}

class AppUpdateBanner extends StatelessWidget {
  const AppUpdateBanner({super.key, required this.controller});

  final AppUpdateController controller;

  @override
  Widget build(BuildContext context) {
    final AppUpdateOffer? offer = controller.offer;
    if (offer == null) {
      if (!controller.requiredUnavailable) {
        return const SizedBox.shrink();
      }
      // Required, but nothing can be downloaded yet: the work in hand goes on; nothing new starts. No download button for a file that does not exist.
      return Container(
        key: const Key('m13-update-banner'),
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        color: N11Colors.yellow.withValues(alpha: 0.18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Cần cập nhật ứng dụng', style: N11Text.bodyStrong),
            Text(controller.deferred ? 'Hoàn thành đơn đang làm bình thường. Bạn chưa nhận được việc mới cho đến khi cập nhật; bản mới chưa sẵn sàng để tải.' : (controller.unavailableReason ?? 'Bản mới chưa sẵn sàng để tải.'), style: N11Text.caption),
            const SizedBox(height: 6),
            TextButton(key: const Key('m13-update-recheck'), onPressed: controller.phase == AppUpdatePhase.checking ? null : () => controller.check(force: true), child: const Text('Kiểm tra lại')),
          ],
        ),
      );
    }
    final bool busy = controller.phase == AppUpdatePhase.downloading;
    final String title = controller.deferred
        ? 'Cần cập nhật ${offer.versionName} sau khi xong đơn (chưa nhận việc mới)'
        : offer.required
            ? 'Cần cập nhật lên ${offer.versionName}'
            : 'Có bản mới ${offer.versionName}';
    return Container(
      key: const Key('m13-update-banner'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: N11Colors.yellow.withValues(alpha: 0.18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: N11Text.bodyStrong),
          if (offer.reason != null) Text(offer.reason!, style: N11Text.caption),
          if (controller.failureCode != null && controller.phase == AppUpdatePhase.failed) Text(updateFailureText(controller.failureCode!), style: N11Text.caption),
          const SizedBox(height: 6),
          if (busy) LinearProgressIndicator(value: controller.progress > 0 ? controller.progress : null),
          Wrap(
            spacing: 8,
            children: <Widget>[
              FilledButton(
                key: const Key('m13-update-download'),
                onPressed: busy || controller.deferred ? null : controller.download,
                child: Text(busy ? 'Đang tải...' : 'Cập nhật (${_size(offer.sizeBytes)})'),
              ),
              if (!offer.required) TextButton(key: const Key('m13-update-later'), onPressed: busy ? null : controller.dismiss, child: const Text('Để sau')),
            ],
          ),
        ],
      ),
    );
  }
}

class AppUpdateScreen extends StatelessWidget {
  const AppUpdateScreen({super.key, required this.controller});

  final AppUpdateController controller;

  @override
  Widget build(BuildContext context) {
    final AppUpdateOffer? offer = controller.offer;
    final bool busy = controller.phase == AppUpdatePhase.downloading;
    if (offer == null) {
      return Scaffold(
        key: const Key('m13-update-screen'),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                const Text('Ứng dụng cần cập nhật để tiếp tục sử dụng', style: N11Text.title),
                const SizedBox(height: 12),
                const Text('Bản đang cài chưa dùng được với hệ thống hiện tại. Bản cập nhật chưa sẵn sàng để tải về, không phải lỗi của bạn.', style: N11Text.body),
                if (controller.unavailableReason != null) ...<Widget>[const SizedBox(height: 8), Text(controller.unavailableReason!, style: N11Text.caption)],
                const SizedBox(height: 8),
                const Text('Thử lại sau ít phút. Nếu vẫn chưa được, hãy liên hệ bộ phận hỗ trợ 11Ship.', style: N11Text.caption),
                if (controller.failureCode != null) ...<Widget>[const SizedBox(height: 8), Text(updateFailureText(controller.failureCode!), style: N11Text.caption)],
                const SizedBox(height: 16),
                FilledButton(key: const Key('m13-update-recheck'), onPressed: controller.phase == AppUpdatePhase.checking ? null : () => controller.check(force: true), child: Text(controller.phase == AppUpdatePhase.checking ? 'Đang kiểm tra...' : 'Kiểm tra lại')),
              ],
            ),
          ),
        ),
      );
    }
    return Scaffold(
      key: const Key('m13-update-screen'),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Text('Ứng dụng cần cập nhật để tiếp tục sử dụng', style: N11Text.title),
              const SizedBox(height: 12),
              Text('Bản đang cài chưa dùng được với hệ thống hiện tại. Cập nhật lên ${offer.versionName} (${_size(offer.sizeBytes)}) để tiếp tục.', style: N11Text.body),
              if (offer.reason != null) ...<Widget>[const SizedBox(height: 8), Text(offer.reason!, style: N11Text.caption)],
              if (offer.notes != null) ...<Widget>[const SizedBox(height: 8), Text(offer.notes!, style: N11Text.caption)],
              if (controller.phase == AppUpdatePhase.failed && controller.failureCode != null) ...<Widget>[
                const SizedBox(height: 8),
                Text(updateFailureText(controller.failureCode!), style: N11Text.caption),
              ],
              const SizedBox(height: 16),
              if (busy) LinearProgressIndicator(value: controller.progress > 0 ? controller.progress : null),
              const SizedBox(height: 12),
              FilledButton(key: const Key('m13-update-download'), onPressed: busy ? null : controller.download, child: Text(busy ? 'Đang tải...' : 'Cập nhật ngay')),
            ],
          ),
        ),
      ),
    );
  }
}

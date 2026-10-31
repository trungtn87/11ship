import 'package:flutter/material.dart';

import '../tokens.dart';
import 'm13_update.dart';

// M13 (issue #280): one light popup when a newer build exists. It covers nothing for good (a tap outside or "Để sau" closes it), never depends on a sign-in
// or on orders. It has no download or install button: there is nothing to open until the apps are on Google Play.

/// Wraps the app: the app is never rebuilt, the popup is drawn above it while there is a newer build the person has not postponed.
class AppUpdateGate extends StatelessWidget {
  const AppUpdateGate({super.key, required this.controller, required this.child});

  final AppUpdateController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? _) {
        return AppUpdateScope(
          controller: controller,
          child: Stack(
            children: <Widget>[
              Positioned.fill(child: child),
              if (controller.showNotice) Positioned.fill(child: AppUpdatePopup(controller: controller)),
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

/// What the "Kiểm tra cập nhật" row says under its title. "Mới nhất" only after the server really answered that there is nothing newer.
String updateCheckSummary(AppUpdateController c) {
  if (c.phase == AppUpdatePhase.checking) {
    return 'Đang kiểm tra…';
  }
  final AppUpdateNotice? notice = c.notice;
  if (notice != null) {
    return 'Có bản mới ${notice.versionName}';
  }
  if (c.lastCheckFailed) {
    return 'Chưa kiểm tra được. Kiểm tra mạng rồi thử lại.';
  }
  if (c.phase == AppUpdatePhase.upToDate) {
    return 'Bạn đang dùng bản mới nhất.';
  }
  return 'Chạm để kiểm tra bản mới.';
}

class AppUpdatePopup extends StatelessWidget {
  const AppUpdatePopup({super.key, required this.controller});

  final AppUpdateController controller;

  @override
  Widget build(BuildContext context) {
    final AppUpdateNotice? notice = controller.notice;
    if (notice == null) {
      return const SizedBox.shrink();
    }
    return Stack(
      key: const Key('m13-update-popup'),
      children: <Widget>[
        Positioned.fill(
          child: GestureDetector(
            key: const Key('m13-update-barrier'),
            behavior: HitTestBehavior.opaque,
            onTap: controller.dismiss,
            child: const ColoredBox(color: Color(0x73000000)),
          ),
        ),
        SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Material(
                color: N11Colors.white,
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text('Có bản cập nhật mới', style: N11Text.title),
                      const SizedBox(height: 8),
                      Text('Phiên bản ${notice.versionName}', style: N11Text.body),
                      const SizedBox(height: 16),
                      Wrap(
                        alignment: WrapAlignment.end,
                        spacing: 8,
                        runSpacing: 8,
                        children: <Widget>[
                          TextButton(key: const Key('m13-update-later'), onPressed: controller.dismiss, child: const Text('Để sau')),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

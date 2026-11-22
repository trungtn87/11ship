import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config.dart';
import '../tokens.dart';
import 'session_controller.dart';

// The public privacy and terms pages of the server (apps/backend/src/legal: PRIVACY_PAGE_PATH and TERMS_PAGE_PATH). The iOS launch channel accepts
// exactly these two paths (N11NativePlugin.swift, Launch.legalPaths); change them together.
const String kPrivacyPagePath = '/chinh-sach-quyen-rieng-tu';
const String kTermsPagePath = '/dieu-khoan-su-dung';

/// The server origin this build talks to, or null when the build has no valid HTTPS address (the links are then hidden, never guessed).
Uri? legalOriginOf(SessionController session) {
  final String? base = session.apiBaseUrl;
  return base == null ? null : parseApiBaseUrl(base);
}

/// Address of one public legal page on [origin]; null without an origin.
Uri? legalPageUri(Uri? origin, String path) => origin?.replace(path: path);

/// Opens a public legal page in the system browser through the iOS launch channel (`browse`). Answers false, never throws, when nothing
/// does it: Android has no such method yet, so there the caller copies the link instead.
class LegalPageLauncher {
  const LegalPageLauncher({MethodChannel? channel}) : _channel = channel;

  final MethodChannel? _channel;

  MethodChannel get _c => _channel ?? const MethodChannel('vn.eleven.n11/launch');

  Future<bool> open(Uri url) async {
    try {
      return await _c.invokeMethod<bool>('browse', <String, Object?>{'url': url.toString()}) ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// Two tappable links to the privacy and terms pages. Used by the registration policy popup and the Account policy page.
class LegalPageLinks extends StatelessWidget {
  const LegalPageLinks({super.key, required this.origin, this.launcher = const LegalPageLauncher()});

  final Uri? origin;
  final LegalPageLauncher launcher;

  @override
  Widget build(BuildContext context) {
    final Uri? privacy = legalPageUri(origin, kPrivacyPagePath);
    final Uri? terms = legalPageUri(origin, kTermsPagePath);
    if (privacy == null || terms == null) {
      return const SizedBox.shrink();
    }
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: <Widget>[
        TextButton(
          key: const Key('legal-link-privacy'),
          onPressed: () => _open(context, privacy),
          child: const Text('Chính sách quyền riêng tư', style: N11Text.link),
        ),
        TextButton(
          key: const Key('legal-link-terms'),
          onPressed: () => _open(context, terms),
          child: const Text('Điều khoản sử dụng', style: N11Text.link),
        ),
      ],
    );
  }

  Future<void> _open(BuildContext context, Uri url) async {
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
    if (await launcher.open(url)) {
      return;
    }
    await Clipboard.setData(ClipboardData(text: url.toString()));
    messenger?.showSnackBar(const SnackBar(content: Text('Không mở được trình duyệt. Đã chép liên kết.')));
  }
}

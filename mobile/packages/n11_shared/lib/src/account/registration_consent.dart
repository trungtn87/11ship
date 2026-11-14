import 'package:flutter/material.dart';

import '../tokens.dart';
import 'legal_policy_draft.dart';

/// One consent checkbox for both 11Food and 11Ship. The underlined words
/// open a read-only dialog; tapping them must not toggle consent.
class RegistrationConsentCheckbox extends StatelessWidget {
  const RegistrationConsentCheckbox({
    super.key,
    required this.value,
    required this.onChanged,
    required this.onViewPolicy,
  });

  final bool value;
  final ValueChanged<bool?>? onChanged;
  final VoidCallback onViewPolicy;

  @override
  Widget build(BuildContext context) {
    return CheckboxListTile(
      key: const Key('register-consent'),
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      activeColor: N11Colors.yellow,
      checkColor: N11Colors.black,
      side: const BorderSide(color: N11Colors.lineStrong, width: 2),
      value: value,
      onChanged: onChanged,
      title: const Text(
        'Tôi đã đọc và đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư',
        style: N11Text.body,
      ),
      secondary: InkWell(
        key: const Key('register-policy-link'),
        onTap: onViewPolicy,
        borderRadius: BorderRadius.circular(8),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 7, vertical: 12),
          child: Text('Xem', style: N11Text.link),
        ),
      ),
    );
  }
}

/// The complete draft is included offline for review. The current accepted
/// versions are shown separately; viewing a draft never changes consent.
Future<void> showRegistrationPoliciesPopup(
  BuildContext context, {
  required String termsText,
  required String privacyText,
  required String termsVersion,
  required String privacyVersion,
}) {
  return showDialog<void>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      title: const Text('Chính sách và điều khoản'),
      contentPadding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      content: SizedBox(
        width: double.maxFinite,
        height: MediaQuery.sizeOf(dialogContext).height * 0.64,
        child: DefaultTabController(
          length: 2,
          child: Column(
            children: <Widget>[
              const TabBar(
                tabs: <Widget>[
                  Tab(text: 'Điều khoản'),
                  Tab(text: 'Quyền riêng tư'),
                ],
              ),
              Expanded(
                child: TabBarView(
                  children: <Widget>[
                    _PolicyTab(
                      version: termsVersion,
                      activeText: termsText,
                      draftVersion: kTermsDraftVersion,
                      draft: kTermsDraft,
                    ),
                    _PolicyTab(
                      version: privacyVersion,
                      activeText: privacyText,
                      draftVersion: kPrivacyDraftVersion,
                      draft: kPrivacyDraft,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          key: const Key('close-policy-popup'),
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: const Text('Đóng'),
        ),
      ],
    ),
  );
}

class _PolicyTab extends StatelessWidget {
  const _PolicyTab({
    required this.version,
    required this.activeText,
    required this.draftVersion,
    required this.draft,
  });

  final String version;
  final String activeText;
  final String draftVersion;
  final List<LegalDraftSection> draft;

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: PageStorageKey<String>(version),
      padding: const EdgeInsets.symmetric(vertical: 14),
      children: <Widget>[
        Text('Nội dung đang áp dụng · $version', style: N11Text.bodyStrong),
        const SizedBox(height: 8),
        SelectableText(activeText, style: N11Text.body),
        const Divider(height: 32),
        const Text(
          'Bản chi tiết tham khảo — DỰ THẢO, CHƯA CÓ HIỆU LỰC',
          style: N11Text.bodyStrong,
        ),
        const SizedBox(height: 5),
        Text('Phiên bản: $draftVersion', style: N11Text.caption),
        const SizedBox(height: 14),
        for (final LegalDraftSection section in draft) ...<Widget>[
          Text(section.title, style: N11Text.bodyStrong),
          const SizedBox(height: 6),
          for (final String paragraph in section.paragraphs) ...<Widget>[
            SelectableText(paragraph, style: N11Text.body),
            const SizedBox(height: 10),
          ],
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

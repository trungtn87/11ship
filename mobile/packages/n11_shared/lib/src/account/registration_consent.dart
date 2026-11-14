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

/// Open the two Owner-approved policies. Viewing does not toggle the checkbox
/// or change any of the user's partially completed registration inputs.
Future<void> showRegistrationPoliciesPopup(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      title: const Text('Chính sách và điều khoản'),
      contentPadding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      content: SizedBox(
        width: double.maxFinite,
        height: MediaQuery.sizeOf(dialogContext).height * 0.64,
        child: const DefaultTabController(
          length: 2,
          child: Column(
            children: <Widget>[
              TabBar(
                tabs: <Widget>[
                  Tab(text: 'Điều khoản'),
                  Tab(text: 'Quyền riêng tư'),
                ],
              ),
              Expanded(
                child: TabBarView(
                  children: <Widget>[
                    _PolicyTab(sections: kTermsPolicySections),
                    _PolicyTab(sections: kPrivacyPolicySections),
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

/// Content shared by the registration popup and the Account policy page.
class LegalPolicyContent extends StatelessWidget {
  const LegalPolicyContent({super.key, required this.sections});

  final List<LegalPolicySection> sections;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        for (final LegalPolicySection section in sections) ...<Widget>[
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

class _PolicyTab extends StatelessWidget {
  const _PolicyTab({required this.sections});

  final List<LegalPolicySection> sections;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 14),
      children: <Widget>[
        LegalPolicyContent(sections: sections),
      ],
    );
  }
}

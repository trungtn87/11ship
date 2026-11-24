import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../tokens.dart';
import 'legal_links.dart';
import 'legal_policy_draft.dart';

/// One consent checkbox for both 11Food and 11Ship. The highlighted policy spans
/// open a read-only dialog; tapping them must not toggle consent.
class RegistrationConsentCheckbox extends StatefulWidget {
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
  State<RegistrationConsentCheckbox> createState() =>
      _RegistrationConsentCheckboxState();
}

class _RegistrationConsentCheckboxState
    extends State<RegistrationConsentCheckbox> {
  late final TapGestureRecognizer _termsTap = TapGestureRecognizer()
    ..onTap = () => widget.onViewPolicy();
  late final TapGestureRecognizer _privacyTap = TapGestureRecognizer()
    ..onTap = () => widget.onViewPolicy();

  @override
  void dispose() {
    _termsTap.dispose();
    _privacyTap.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final TextStyle linkStyle = N11Text.link.copyWith(height: 1.45);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Checkbox(
          key: const Key('register-consent'),
          activeColor: N11Colors.yellow,
          checkColor: N11Colors.black,
          side: const BorderSide(color: N11Colors.fieldBorder, width: 1.5),
          materialTapTargetSize: MaterialTapTargetSize.padded,
          visualDensity: VisualDensity.standard,
          value: widget.value,
          onChanged: widget.onChanged,
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Text.rich(
              TextSpan(
                style: N11Text.caption.copyWith(height: 1.45),
                children: <InlineSpan>[
                  const TextSpan(text: 'Tôi đã đọc và đồng ý với '),
                  TextSpan(
                    text: 'Điều khoản sử dụng',
                    style: linkStyle,
                    recognizer: _termsTap,
                  ),
                  const TextSpan(text: ' và '),
                  TextSpan(
                    text: 'Chính sách quyền riêng tư',
                    style: linkStyle,
                    recognizer: _privacyTap,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Open the two Owner-approved policies. Viewing does not toggle the checkbox
/// or change any of the user's partially completed registration inputs.
/// [origin] is the server the build talks to; it gives the links to the public pages (none when null).
Future<void> showRegistrationPoliciesPopup(BuildContext context, {Uri? origin}) {
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
              Align(alignment: Alignment.centerLeft, child: LegalPageLinks(origin: origin)),
              const TabBar(
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

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/account/registration_consent.dart';

void main() {
  testWidgets('policy link opens popup; close preserves unchecked consent', (WidgetTester tester) async {
    bool agreed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (BuildContext context, StateSetter update) {
              return RegistrationConsentCheckbox(
                value: agreed,
                onChanged: (bool? value) => update(() => agreed = value ?? false),
                onViewPolicy: () => showRegistrationPoliciesPopup(
                  context,
                  termsText: 'Điều khoản đang áp dụng.',
                  privacyText: 'Quyền riêng tư đang áp dụng.',
                  termsVersion: 'terms-active',
                  privacyVersion: 'privacy-active',
                ),
              );
            },
          ),
        ),
      ),
    );

    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('register-consent'))).value, isFalse);
    await tester.tap(find.byKey(const Key('register-policy-link')));
    await tester.pumpAndSettle();
    expect(find.text('Chính sách và điều khoản'), findsOneWidget);
    expect(find.text('Điều khoản đang áp dụng.'), findsOneWidget);
    expect(find.textContaining('DỰ THẢO, CHƯA CÓ HIỆU LỰC'), findsOneWidget);

    await tester.tap(find.text('Quyền riêng tư'));
    await tester.pumpAndSettle();
    expect(find.text('Quyền riêng tư đang áp dụng.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('close-policy-popup')));
    await tester.pumpAndSettle();
    expect(agreed, isFalse);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('register-consent'))).value, isFalse);

    await tester.tap(find.byType(Checkbox));
    await tester.pumpAndSettle();
    expect(agreed, isTrue);
  });

  testWidgets('disabled consent remains readable but cannot be accepted', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => RegistrationConsentCheckbox(
              value: false,
              onChanged: null,
              onViewPolicy: () => showRegistrationPoliciesPopup(
                context,
                termsText: 'Đang áp dụng',
                privacyText: 'Đang áp dụng',
                termsVersion: 'terms-active',
                privacyVersion: 'privacy-active',
              ),
            ),
          ),
        ),
      ),
    );
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('register-consent'))).onChanged, isNull);
    await tester.tap(find.byKey(const Key('register-policy-link')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('close-policy-popup')), findsOneWidget);
  });
}

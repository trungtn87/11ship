import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/account/registration_consent.dart';

void main() {
  testWidgets('policy link opens official texts without changing consent', (WidgetTester tester) async {
    bool agreed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (BuildContext context, StateSetter update) {
              return RegistrationConsentCheckbox(
                value: agreed,
                onChanged: (bool? value) => update(() => agreed = value ?? false),
                onViewPolicy: () => showRegistrationPoliciesPopup(context),
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
    expect(find.text('1. Phạm vi áp dụng và đơn vị vận hành'), findsOneWidget);
    expect(find.textContaining('DỰ THẢO'), findsNothing);
    expect(find.textContaining('CHƯA CÓ HIỆU LỰC'), findsNothing);

    await tester.tap(find.text('Quyền riêng tư'));
    await tester.pumpAndSettle();
    expect(find.text('1. Đơn vị xử lý và phạm vi'), findsOneWidget);

    await tester.tap(find.byKey(const Key('close-policy-popup')));
    await tester.pumpAndSettle();
    expect(agreed, isFalse);
    expect(tester.widget<CheckboxListTile>(find.byKey(const Key('register-consent'))).value, isFalse);

    await tester.tap(find.byKey(const Key('register-consent')));
    await tester.pumpAndSettle();
    expect(agreed, isTrue);
  });

  testWidgets('disabled consent can still view the policy but cannot be accepted', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => RegistrationConsentCheckbox(
              value: false,
              onChanged: null,
              onViewPolicy: () => showRegistrationPoliciesPopup(context),
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

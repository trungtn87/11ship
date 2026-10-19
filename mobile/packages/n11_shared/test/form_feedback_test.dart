import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

void main() {
  testWidgets(
    'blank submit reveals fields and focuses the first; correcting them sends once',
    (WidgetTester tester) async {
      final TextEditingController name = TextEditingController();
      final TextEditingController note = TextEditingController();
      var sends = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: N11FormScaffold(
            title: 'Form',
            session: null,
            children: <Widget>[
              N11Field(
                fieldKey: const Key('name'),
                label: 'Họ tên',
                controller: name,
                maxLength: 120,
                requiredInput: true,
              ),
              N11Field(
                fieldKey: const Key('note'),
                label: 'Ghi chú',
                controller: note,
                optionalLabel: true,
                maxLength: 5,
              ),
              N11Button(
                key: const Key('send'),
                label: 'Lưu',
                validate: true,
                onPressed: () => sends++,
              ),
            ],
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('send')));
      await tester.pumpAndSettle();
      expect(sends, 0);
      expect(find.text('Nhập họ tên.'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('name')))
            .focusNode!
            .hasFocus,
        isTrue,
      );
      await tester.enterText(find.byKey(const Key('name')), 'Nguyễn An');
      await tester.pumpAndSettle();
      expect(find.text('Nhập họ tên.'), findsNothing);
      await tester.ensureVisible(find.byKey(const Key('send')));
      await tester.tap(find.byKey(const Key('send')));
      await tester.pumpAndSettle();
      expect(sends, 1, reason: 'an empty optional field is valid');
      await tester.pumpWidget(const SizedBox.shrink());
      name.dispose();
      note.dispose();
    },
  );

  testWidgets(
    'leaving and retrying a retained intent bypass input validation; disabled fields do not block submit',
    (WidgetTester tester) async {
      final TextEditingController value = TextEditingController();
      var exits = 0;
      var retries = 0;
      var saves = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: N11FormScaffold(
            title: 'Form',
            session: null,
            children: <Widget>[
              N11Field(
                fieldKey: const Key('value'),
                label: 'Thông tin cũ',
                controller: value,
                requiredInput: true,
                enabled: false,
              ),
              N11Button(
                key: const Key('back'),
                label: 'Quay lại',
                onPressed: () => exits++,
              ),
              N11Button(
                key: const Key('retry'),
                label: 'Thử lại',
                onPressed: () => retries++,
              ),
              N11Button(
                key: const Key('save'),
                label: 'Lưu',
                validate: true,
                onPressed: () => saves++,
              ),
            ],
          ),
        ),
      );
      for (final String key in <String>['back', 'retry', 'save']) {
        await tester.ensureVisible(find.byKey(Key(key)));
        await tester.tap(find.byKey(Key(key)));
        await tester.pumpAndSettle();
      }
      expect(<int>[exits, retries, saves], <int>[1, 1, 1]);
      expect(find.text('Nhập thông tin cũ.'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      value.dispose();
    },
  );
}

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/account/models.dart';
import 'package:n11_shared/src/account/account_views.dart';
import 'package:n11_shared/src/m07/m07_source.dart';
import 'package:n11_shared/src/m10/m10_source.dart';

void main() {
  const String id = '11111111-2222-4333-8444-555555555555';
  test('account errors keep a safe correlation, while delivery and order errors never show a lookup code', () {
    expect(failureMessage(const AuthFailure(AuthFailureKind.serverUnavailable, requestId: id)), contains('Mã tra cứu: $id'));
    const M07Failure failure = M07Failure(M07FailureKind.server, requestId: id);
    // Owner decision 2026-10-23: the delivery and order flows say it in plain words; the id stays in the server log only.
    expect(m07FailureText(failure), isNot(contains('Mã tra cứu')));
    expect(m07FailureText(failure), isNot(contains(id)));
    expect(m10FailureText(failure), isNot(contains('Mã tra cứu')));
    expect(m10FailureText(failure), isNot(contains(id)));
    expect(failure.message, isNot(contains(id)));
    expect(withRequestTrace('Lỗi', '<script>secret</script>'), 'Lỗi');
    expect(withRequestTrace('Lỗi', null), 'Lỗi');
  });
}

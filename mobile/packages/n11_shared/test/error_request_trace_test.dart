import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/account/models.dart';
import 'package:n11_shared/src/account/account_views.dart';
import 'package:n11_shared/src/m07/m07_source.dart';
import 'package:n11_shared/src/m10/m10_source.dart';

void main() {
  const String id = '11111111-2222-4333-8444-555555555555';
  test('user-facing errors never show the lookup code or request id; the id stays on the failure', () {
    const AuthFailure auth = AuthFailure(AuthFailureKind.serverUnavailable, requestId: id);
    expect(failureMessage(auth), isNot(contains('Mã tra cứu')));
    expect(failureMessage(auth), isNot(contains(id)));
    expect(auth.requestId, id);
    const M07Failure failure = M07Failure(M07FailureKind.server, requestId: id);
    expect(m07FailureText(failure), isNot(contains(id)));
    expect(m10FailureText(failure), isNot(contains('Mã tra cứu')));
    expect(m10FailureText(failure), isNot(contains(id)));
    expect(withRequestTrace('Lỗi', '<script>secret</script>'), 'Lỗi');
    expect(withRequestTrace('Lỗi', null), 'Lỗi');
  });
}

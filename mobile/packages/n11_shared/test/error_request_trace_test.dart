import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/account/models.dart';
import 'package:n11_shared/src/account/account_views.dart';
import 'package:n11_shared/src/m07/m07_source.dart';
import 'package:n11_shared/src/m10/m10_source.dart';

void main() {
  const String id = '11111111-2222-4333-8444-555555555555';
  test('both app account and order errors show safe correlation without duplicate text', () {
    expect(failureMessage(const AuthFailure(AuthFailureKind.serverUnavailable, requestId: id)), contains('Mã tra cứu: $id'));
    const M07Failure failure = M07Failure(M07FailureKind.server, requestId: id);
    expect(m07FailureText(failure), contains('Mã tra cứu: $id'));
    expect(m10FailureText(failure).split('Mã tra cứu:'), hasLength(2));
    expect(withRequestTrace('Lỗi', '<script>secret</script>'), 'Lỗi');
    expect(withRequestTrace('Lỗi', null), 'Lỗi');
  });
}

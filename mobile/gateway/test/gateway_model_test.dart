import 'package:flutter_test/flutter_test.dart';
import 'package:gateway/gateway_model.dart';

void main() {
  test('an empty or missing state means: not paired, nothing running', () {
    final state = GatewayState.fromMap(null);
    expect(state.paired, isFalse);
    expect(state.vpsStatus(), contains('Chưa ghép cặp'));
    expect(state.pairingStatus(), 'Chưa ghép cặp');
    expect(state.lastConnection(DateTime.now()), 'Chưa có');
  });

  test('the VPS line follows pairing, switch, service and connection in order', () {
    GatewayState of(Map<String, dynamic> extra) => GatewayState.fromMap({'paired': true, ...extra});
    expect(of({'authFailed': true, 'enabled': true}).vpsStatus(), contains('từ chối'));
    expect(of({'enabled': false}).vpsStatus(), contains('tạm dừng'));
    expect(of({'enabled': true, 'serviceRunning': false}).vpsStatus(), contains('chưa chạy'));
    expect(of({'enabled': true, 'serviceRunning': true, 'lastError': 'DNS'}).vpsStatus(), contains('không tìm thấy máy chủ'));
    expect(of({'enabled': true, 'serviceRunning': true}).vpsStatus(), contains('Đang kết nối'));
    expect(
      of({'enabled': true, 'serviceRunning': true, 'lastOkMs': 1, 'serverSendingEnabled': false}).vpsStatus(),
      contains('tắt gửi SMS'),
    );
    expect(of({'enabled': true, 'serviceRunning': true, 'lastOkMs': 1, 'serverSendingEnabled': true}).vpsStatus(), 'Đã kết nối VPS.');
  });

  test('pairing status shows the host only, never the credential', () {
    final state = GatewayState.fromMap({'paired': true, 'baseUrl': 'https://api.example.vn:8443/base'});
    expect(state.pairingStatus(), 'Đã ghép cặp (api.example.vn)');
    expect(hostOf('not a url'), '?');
  });

  test('last connection is relative and counters default to zero', () {
    final now = DateTime.fromMillisecondsSinceEpoch(10 * 3600 * 1000);
    GatewayState at(int agoSeconds) =>
        GatewayState.fromMap({'paired': true, 'lastOkMs': now.millisecondsSinceEpoch - agoSeconds * 1000});
    expect(at(2).lastConnection(now), 'Vừa xong');
    expect(at(30).lastConnection(now), '30 giây trước');
    expect(at(300).lastConnection(now), '5 phút trước');
    expect(at(7300).lastConnection(now), '2 giờ trước');
    expect(GatewayState.fromMap({'sentToday': 3, 'failedToday': 1}).sentToday, 3);
    expect(GatewayState.fromMap({}).failedToday, 0);
  });

  test('error codes are explained and unknown ones are shown as codes only', () {
    expect(describeError('TLS'), contains('HTTPS'));
    expect(describeError('SERVER_503'), 'VPS lỗi (503)');
    expect(describeError('WHATEVER'), 'lỗi (WHATEVER)');
  });

  test('a result waiting to be reported is shown as such, with the VPS status code', () {
    final state = GatewayState.fromMap({'paired': true, 'enabled': true, 'serviceRunning': true, 'lastOkMs': 1, 'lastError': 'ACK_HTTP_429'});
    expect(state.vpsStatus(), contains('chờ báo kết quả'));
    expect(state.vpsStatus(), contains('429'));
    expect(state.vpsStatus(), isNot(contains('Mất kết nối')));
    expect(describeError('ACK_PENDING'), 'chưa báo được');
  });
}

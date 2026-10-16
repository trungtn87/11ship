import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_m14/n11_m14.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const MethodChannel channel = MethodChannel('vn.eleven/m14');
  final List<String> calls = <String>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (MethodCall call) async {
      calls.add(call.method);
      if (call.method == 'status') return <String, dynamic>{'recording': false, 'fresh': false};
      if (call.method == 'calculate') throw PlatformException(code: 'M14', message: 'Cần mạng để tính tuyến mới');
      return null;
    });
  });
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));
  test('status/cache do not start collection or request a route', () async {
    const M14Client client = M14Client();
    expect((await client.status())['recording'], false);
    expect(await client.savedRoute(), null);
    expect(calls, <String>['status', 'savedRoute']);
  });
  test('without explicit consent start never reaches Android', () async {
    await expectLater(const M14Client().start(consent: false), throwsArgumentError);
    expect(calls, isEmpty);
  });
  test('failed route remains an error; no straight-line distance', () async {
    await expectLater(const M14Client().calculate(origin: 'https://routing.example.com',
      startLat: 22.66, startLon: 106.26, endLat: 22.67, endLon: 106.27),
      throwsA(isA<PlatformException>().having((PlatformException e) => e.message, 'message', 'Cần mạng để tính tuyến mới')));
    expect(calls, <String>['calculate']);
  });
}

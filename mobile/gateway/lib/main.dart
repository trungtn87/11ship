import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'gateway_model.dart';

const testSmsMessage = '11Ship SMS Gateway: Tin nhan thu nghiem. Khong phai ma OTP.';

String? normalizeVietnamPhone(String raw) {
  final value = raw.replaceAll(RegExp(r'[\s-]'), '');
  if (RegExp(r'^0[0-9]{9}$').hasMatch(value)) {
    return '+84${value.substring(1)}';
  }
  return RegExp(r'^\+84[0-9]{9}$').hasMatch(value) ? value : null;
}

/// Hardware feature flags are informational only: some devices omit the
/// FEATURE_TELEPHONY_MESSAGING declaration while supporting SMS in practice.
/// Real send attempts still require runtime SEND_SMS permission and confirmation.
bool mayAttemptSms({required bool permissionGranted, required bool busy}) =>
    permissionGranted && !busy;

void main() => runApp(const GatewayApp());

class GatewayApp extends StatelessWidget {
  const GatewayApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: '11Ship SMS Gateway',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF107C74)),
        ),
        home: const GatewayHome(),
      );
}

class GatewayHome extends StatefulWidget {
  const GatewayHome({super.key});

  @override
  State<GatewayHome> createState() => _GatewayHomeState();
}

class _GatewayHomeState extends State<GatewayHome> {
  static const _native = MethodChannel('vn.eleven.gateway/sms');
  final _phone = TextEditingController();
  // Pre-filled from the central endpoint (config/endpoints.json, passed as --dart-define by the workflow); the person can still edit it.
  final _url = TextEditingController(text: const String.fromEnvironment('API_BASE_URL'));
  final _credential = TextEditingController();
  Timer? _poll;
  GatewayState _gateway = const GatewayState();
  bool _pairing = false;
  String _pairMessage = '';
  bool _supported = false;
  bool _granted = false;
  bool _sending = false;
  String _status = 'Đang kiểm tra thiết bị...';
  String _outcome = 'Chưa gửi SMS thử.';
  UpdateInfo? _update;
  bool _updating = false;
  String _updateMessage = '';

  @override
  void initState() {
    super.initState();
    _check();
    _refreshGateway();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _refreshGateway());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _phone.dispose();
    _url.dispose();
    _credential.dispose();
    super.dispose();
  }

  Future<void> _refreshGateway() async {
    try {
      final data = await _native.invokeMapMethod<dynamic, dynamic>('gatewayState');
      if (mounted) setState(() => _gateway = GatewayState.fromMap(data));
    } catch (_) {
      // Keep the last known state; the next tick tries again.
    }
  }

  Future<void> _pair() async {
    setState(() {
      _pairing = true;
      _pairMessage = 'Đang kiểm tra mã ghép cặp với VPS...';
    });
    try {
      await _native.invokeMethod<bool>('gatewayPair', {
        'baseUrl': _url.text,
        'credential': _credential.text,
      });
      _credential.clear();
      if (mounted) setState(() => _pairMessage = 'Ghép cặp thành công. Bấm "Bật gateway" để bắt đầu.');
    } on PlatformException catch (e) {
      if (mounted) setState(() => _pairMessage = e.message ?? e.code);
    } finally {
      if (mounted) setState(() => _pairing = false);
      await _refreshGateway();
    }
  }

  Future<void> _unpair() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hủy ghép cặp'),
        content: const Text('Xóa mã ghép cặp trên máy này và dừng gateway? Muốn dùng lại phải ghép cặp bằng mã mới.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Không')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Hủy ghép cặp')),
        ],
      ),
    );
    if (confirmed != true) return;
    await _native.invokeMethod<bool>('gatewayUnpair');
    if (mounted) setState(() => _pairMessage = '');
    await _refreshGateway();
  }

  Future<void> _checkUpdate() async {
    setState(() {
      _updating = true;
      _updateMessage = 'Đang hỏi VPS về bản cập nhật...';
    });
    try {
      final data = await _native.invokeMapMethod<dynamic, dynamic>('gatewayUpdateCheck');
      final info = UpdateInfo.fromMap(data);
      if (mounted) setState(() {
        _update = info;
        _updateMessage = info.describe();
      });
    } on PlatformException catch (e) {
      if (mounted) setState(() => _updateMessage = e.message ?? e.code);
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  /// Downloads the offered file, checks its SHA-256 and only then opens the Android installer, where the person confirms.
  Future<void> _installUpdate() async {
    setState(() {
      _updating = true;
      _updateMessage = 'Đang tải và kiểm tra tệp cập nhật...';
    });
    try {
      await _native.invokeMethod<bool>('gatewayUpdateInstall');
      if (mounted) setState(() => _updateMessage = 'Đã mở trình cài đặt Android. Hãy xác nhận cài đặt.');
    } on PlatformException catch (e) {
      if (mounted) setState(() => _updateMessage = e.message ?? e.code);
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _setEnabled(bool enabled) async {
    try {
      await _native.invokeMethod<bool>('gatewaySetEnabled', {'enabled': enabled});
    } on PlatformException catch (e) {
      if (mounted) setState(() => _pairMessage = e.message ?? e.code);
    }
    await _refreshGateway();
  }

  Future<void> _check() async {
    try {
      final data = await _native.invokeMapMethod<String, dynamic>('deviceStatus');
      if (!mounted) return;
      setState(() {
        _supported = data?['supported'] == true;
        _granted = data?['granted'] == true;
        _status = !_supported
            ? (_granted
                ? 'Android không khai báo tính năng SMS. Bạn vẫn có thể thử gửi; '
                    'kiểm tra SIM và máy nhận để xác nhận.'
                : 'Android không khai báo tính năng SMS. Bạn vẫn có thể cấp '
                    'quyền để thử; chỉ kết quả gửi thật mới xác nhận được.')
            : _granted
                ? 'Android báo hỗ trợ SMS và đã cấp quyền gửi.'
                : 'Android báo hỗ trợ SMS, nhưng chưa cấp quyền gửi.';
      });
    } catch (e) {
      if (mounted) setState(() => _status = 'Chưa đọc được trạng thái: $e');
    }
  }

  Future<void> _allow() async {
    try {
      await _native.invokeMethod<bool>('requestPermission');
      await _check();
    } on PlatformException catch (e) {
      if (mounted) setState(() => _outcome = 'Lỗi xin quyền: ${e.message}');
    }
  }

  Future<void> _send() async {
    final recipient = normalizeVietnamPhone(_phone.text);
    if (recipient == null) {
      setState(() => _outcome = 'Hãy nhập số di động Việt Nam hợp lệ (10 chữ số).');
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Xác nhận gửi 1 SMS'),
        content: Text(
          'Gửi SMS thật từ SIM của máy đến $recipient?\n\n'
          '$testSmsMessage\n\nCó thể phát sinh cước nhà mạng.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Không gửi'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Gửi SMS'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _sending = true);
    try {
      final answer = await _native.invokeMethod<String>(
        'sendTestSms',
        {'phone': recipient},
      );
      if (mounted) {
        setState(() => _outcome = answer ?? 'Đã chuyển lệnh tới Android.');
      }
    } on PlatformException catch (e) {
      if (mounted) setState(() => _outcome = 'Gửi lỗi: ${e.message ?? e.code}');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _gatewayCard() {
    final g = _gateway;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(g.vpsStatus(), style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Ghép cặp: ${g.pairingStatus()}'),
            Text('Lần kết nối cuối: ${g.lastConnection(DateTime.now())}'),
            Text('SIM/quyền: ${g.simStatus()}'),
            if (!g.notificationsGranted)
              const Text('Chưa cho phép thông báo: Android có thể ẩn thanh trạng thái của dịch vụ nền.'),
            Text('Hôm nay: ${g.sentToday} đã gửi, ${g.failedToday} lỗi/không rõ'),
            if (g.pendingReport) const Text('Có kết quả gửi đang chờ báo về VPS.'),
            if (g.updateHint != null && g.serviceRunning)
              Text('VPS có bản mới ${g.updateHint}. Tắt gateway rồi bấm "Kiểm tra bản cập nhật".'),
            const SizedBox(height: 12),
            if (g.paired && !g.serviceRunning)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _updating ? null : _checkUpdate,
                      icon: const Icon(Icons.system_update),
                      label: const Text('Kiểm tra bản cập nhật'),
                    ),
                    if (_update?.ready == true)
                      FilledButton.icon(
                        onPressed: _updating ? null : _installUpdate,
                        icon: const Icon(Icons.download),
                        label: const Text('Tải và cài'),
                      ),
                    if (_updateMessage.isNotEmpty) Text(_updateMessage),
                  ],
                ),
              ),
            if (!g.smsGranted || !g.notificationsGranted)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: FilledButton.icon(
                  onPressed: _allow,
                  icon: const Icon(Icons.security),
                  label: const Text('Cấp quyền SMS và thông báo'),
                ),
              ),
            if (!g.paired) ...[
              TextField(
                controller: _url,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Địa chỉ VPS (https://...)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _credential,
                autocorrect: false,
                enableSuggestions: false,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Mã ghép cặp (từ công cụ của Owner)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _pairing ? null : _pair,
                icon: const Icon(Icons.link),
                label: Text(_pairing ? 'Đang ghép cặp...' : 'Ghép cặp'),
              ),
            ] else ...[
              Row(
                children: [
                  Expanded(
                    child: g.enabled
                        ? OutlinedButton.icon(
                            onPressed: () => _setEnabled(false),
                            icon: const Icon(Icons.pause),
                            label: const Text('Tạm dừng gateway'),
                          )
                        : FilledButton.icon(
                            onPressed: g.authFailed ? null : () => _setEnabled(true),
                            icon: const Icon(Icons.play_arrow),
                            label: const Text('Bật gateway'),
                          ),
                  ),
                ],
              ),
              TextButton.icon(
                onPressed: _unpair,
                icon: const Icon(Icons.link_off),
                label: const Text('Hủy ghép cặp'),
              ),
            ],
            if (!g.batteryUnrestricted)
              TextButton.icon(
                onPressed: () => _native.invokeMethod<bool>('openBatterySettings'),
                icon: const Icon(Icons.battery_charging_full),
                label: const Text('Cho phép chạy nền (tắt tối ưu pin)'),
              ),
            if (_pairMessage.isNotEmpty) Text(_pairMessage),
            const SizedBox(height: 6),
            const Text(
              'Nên cắm sạc, giữ Wi-Fi/4G bật, và không vuốt đóng app khỏi Cài đặt. '
              'Không có tin OTP hay số đầy đủ nào được lưu hoặc hiện trên màn hình này.',
              style: TextStyle(fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('11Ship SMS Gateway')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Text('11Ship SMS Gateway',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text('Phiên bản ${_gateway.appVersion}. Máy này kết nối ra VPS và gửi SMS OTP bằng SIM của máy.'),
              const SizedBox(height: 14),
              _gatewayCard(),
              const SizedBox(height: 24),
              const Text('Gửi thử thủ công',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              const Text('Chỉ gửi một tin thử cố định (không phải OTP), sau khi bạn bấm xác nhận.'),
              const SizedBox(height: 14),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_status),
                      if (!_granted)
                        FilledButton.icon(
                          onPressed: _allow,
                          icon: const Icon(Icons.security),
                          label: const Text('Cấp quyền SMS'),
                        ),
                      TextButton.icon(
                        onPressed: _check,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Kiểm tra lại'),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Số điện thoại nhận',
                  hintText: '09xxxxxxxx',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              const Text('Nội dung SMS thử:',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 5),
              const SelectableText(testSmsMessage),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: mayAttemptSms(permissionGranted: _granted, busy: _sending)
                    ? _send
                    : null,
                icon: const Icon(Icons.sms_outlined),
                label: Text(_sending ? 'Đang gửi...' : 'Gửi một SMS thử'),
              ),
              const SizedBox(height: 15),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_outcome),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Chỉ gửi sau khi bạn bấm xác nhận. "Đã chuyển lệnh" chưa '
                'đồng nghĩa SMS đã tới người nhận. Hãy kiểm tra máy nhận. '
                'Nếu dùng hai SIM, đặt SIM gửi SMS mặc định trong Cài đặt.',
              ),
            ],
          ),
        ),
      );
}

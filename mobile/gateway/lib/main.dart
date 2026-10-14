import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
  bool _supported = false;
  bool _granted = false;
  bool _sending = false;
  String _status = 'Đang kiểm tra thiết bị...';
  String _outcome = 'Chưa gửi SMS thử.';

  @override
  void initState() {
    super.initState();
    _check();
  }

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
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

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('11Ship SMS Gateway')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Text('Thử gửi SMS qua SIM Android',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              const Text('Bản test: chưa kết nối VPS, chưa gửi OTP tự động.'),
              const SizedBox(height: 20),
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

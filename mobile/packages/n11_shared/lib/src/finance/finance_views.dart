import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../account/api_client.dart';
import '../account/session_controller.dart';

/// Finance requests use the current app session. Nothing here credits a wallet or activates a shop.
class FinanceRequestsScreen extends StatefulWidget {
  const FinanceRequestsScreen({super.key, required this.session, this.shopPayments = false, this.requestId});
  final SessionController session;
  final bool shopPayments;
  final String? requestId;
  @override
  State<FinanceRequestsScreen> createState() => _FinanceRequestsScreenState();
}
class _FinanceRequestsScreenState extends State<FinanceRequestsScreen> with WidgetsBindingObserver {
  final TextEditingController _message = TextEditingController();
  final TextEditingController _amount = TextEditingController();
  final TextEditingController _note = TextEditingController();
  final Map<String, String> _keys = <String, String>{};
  List<Map<String, Object?>> _items = <Map<String, Object?>>[];
  List<Map<String, Object?>> _messages = <Map<String, Object?>>[];
  Map<String, Object?>? _request;
  String? _id;
  String? _before;
  String? _error;
  bool _loading = false;
  bool _sending = false;
  bool _resumed = true;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _id = widget.requestId;
    WidgetsBinding.instance.addObserver(this);
    unawaited(_reload());
    _timer = Timer.periodic(const Duration(seconds: 15), (Timer _) {
      if (_resumed && ModalRoute.of(context)?.isCurrent == true) unawaited(_reload(quiet: true));
    });
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (_resumed) unawaited(_reload(quiet: true));
  }
  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _message.dispose(); _amount.dispose(); _note.dispose();
    super.dispose();
  }
  Future<Map<String, Object?>> _call(String method, String path, {Map<String, Object?>? body}) async {
    final String logical = '$path\n${jsonEncode(body)}';
    final String? key = body == null ? null : _keys.putIfAbsent(logical, newIdempotencyKey);
    final ApiResponse response = await widget.session.protectedCall(method, '/v1/finance/me$path', body: body == null ? null : jsonEncode(body), idempotencyKey: key);
    if (response.status >= 200 && response.status < 300 && response.data is Map<String, Object?>) {
      _keys.remove(logical);
      return response.data! as Map<String, Object?>;
    }
    if (response.status >= 400 && response.status < 500 && response.errorCode != 'IDEMPOTENCY_BUSY') _keys.remove(logical);
    throw const FormatException('Finance request failed');
  }
  static List<Map<String, Object?>> _rows(Object? raw) {
    if (raw is! List<Object?> || raw.any((Object? row) => row is! Map<String, Object?>)) throw const FormatException('Invalid finance list');
    return raw.cast<Map<String, Object?>>();
  }
  Future<void> _reload({bool quiet = false, bool older = false}) async {
    if (_loading || !mounted) return;
    final String? id = _id;
    final int epoch = widget.session.sessionEpoch;
    setState(() { _loading = true; if (!quiet) _error = null; });
    try {
      final String query = older && _before != null ? '?before=${Uri.encodeQueryComponent(_before!)}' : '';
      final Map<String, Object?> data = await _call('GET', id == null ? '/requests$query' : '/requests/$id$query');
      if (!mounted || epoch != widget.session.sessionEpoch || id != _id) return;
      if (id == null) {
        final List<Map<String, Object?>> rows = _rows(data['items']);
        if (rows.any((Map<String, Object?> r) => r['request_id'] is! String || r['amount_requested_vnd'] is! int || r['state'] is! String)) throw const FormatException('Invalid finance request');
        setState(() { _items = older ? <Map<String, Object?>>[..._items, ...rows] : rows; _before = data['next_before'] as String?; });
      } else {
        final Map<String, Object?> request = data['request']! as Map<String, Object?>;
        final Map<String, Object?> messages = data['messages']! as Map<String, Object?>;
        final List<Map<String, Object?>> rows = _rows(messages['items']);
        if (rows.any((Map<String, Object?> r) => r['sequence'] is! String || r['body'] is! String || r['role'] is! String)) throw const FormatException('Invalid finance message');
        setState(() { _request = request; _messages = older ? <Map<String, Object?>>[...rows, ..._messages] : rows; _before = messages['next_before'] as String?; });
        if (rows.isNotEmpty) await _call('POST', '/requests/$id/read', body: <String, Object?>{'sequence': rows.last['sequence']});
      }
    } on Object {
      if (mounted && id == _id) setState(() => _error = 'Chưa tải được trao đổi. Kiểm tra kết nối rồi thử lại.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }
  Future<void> _send({bool create = false}) async {
    if (_sending) return;
    final int? amount = int.tryParse(_amount.text.trim());
    if (create && (amount == null || amount < 1 || _note.text.trim().isEmpty)) {
      setState(() => _error = 'Nhập số tiền và nội dung thanh toán.'); return;
    }
    if (!create && _message.text.trim().isEmpty) return;
    setState(() { _sending = true; _error = null; });
    try {
      final Map<String, Object?> result = await _call('POST', create ? '/shop-payments' : '/requests/$_id/messages', body: create ? <String, Object?>{'amount_vnd': amount, 'note': _note.text.trim()} : <String, Object?>{'body': _message.text.trim()});
      if (!mounted) return;
      setState(() { if (create) { _id = result['request_id']! as String; _request = null; _messages = <Map<String, Object?>>[]; } _message.clear(); });
      await _reload();
    } on Object {
      if (mounted) setState(() => _error = 'Chưa xác định được kết quả. Giữ nguyên nội dung và thử lại; hệ thống chống gửi trùng.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }
  String _state(Object? state) => switch (state) { 'PENDING' => 'Chờ kiểm tra', 'CONFIRMED' => 'Đã xác nhận', 'REJECTED' => 'Từ chối', 'CANCELLED' => 'Đã hủy', _ => 'Đang tải' };
  @override
  Widget build(BuildContext context) {
    final bool room = _id != null;
    return Scaffold(
      appBar: AppBar(title: Text(room ? 'Trao đổi thanh toán' : 'Yêu cầu và trao đổi tài chính'), actions: <Widget>[IconButton(onPressed: _loading ? null : () => _reload(), icon: const Icon(Icons.refresh), tooltip: 'Làm mới')]),
      body: ListView(padding: const EdgeInsets.all(16), children: <Widget>[
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        if (_loading) const LinearProgressIndicator(),
        if (!room) ...<Widget>[
          if (widget.shopPayments) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
            const Text('Báo đã thanh toán'),
            const Text('Chỉ thông báo đã chuyển tiền. Quản trị kiểm tra và xác nhận thủ công; tài khoản quán không tự mở.'),
            TextField(controller: _amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Số tiền (đ)')),
            TextField(controller: _note, maxLength: 1000, decoration: const InputDecoration(labelText: 'Nội dung / mã giao dịch')),
            FilledButton(onPressed: _sending ? null : () => _send(create: true), child: const Text('Tôi đã thanh toán')),
          ]))),
          if (_items.isEmpty && !_loading) const Text('Chưa có yêu cầu thanh toán.'),
          for (final Map<String, Object?> r in _items) Card(child: ListTile(title: Text('${r['label']} · ${r['amount_requested_vnd']} đ'), subtitle: Text('${_state(r['state'])} · ${r['unread']} chưa đọc'), trailing: const Icon(Icons.chat_outlined), onTap: () { setState(() { _id = r['request_id']! as String; _before = null; _request = null; _messages = <Map<String, Object?>>[]; }); unawaited(_reload()); })),
        ] else ...<Widget>[
          TextButton(onPressed: () { setState(() { _id = null; _before = null; _request = null; }); unawaited(_reload()); }, child: const Text('← Danh sách yêu cầu')),
          Text(_state(_request?['state']), style: Theme.of(context).textTheme.titleMedium),
          const Text('Tin nhắn chỉ dùng để trao đổi, không tự xác nhận tiền đã nhận.'),
          for (final Map<String, Object?> m in _messages) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[Text(switch (m['role']) { 'SYSTEM_EVENT' => 'Thông báo', 'SHOP' => 'Quán', 'SHIPPER' => 'Shipper', _ => 'Quản trị' }, style: Theme.of(context).textTheme.labelSmall), Text(m['body']! as String)]))),
          if (_request?['state'] == 'PENDING') ...<Widget>[
            TextField(controller: _message, maxLength: 1000, minLines: 1, maxLines: 4, decoration: const InputDecoration(labelText: 'Tin nhắn')),
            FilledButton(onPressed: _sending ? null : () => _send(), child: const Text('Gửi tin nhắn')),
          ] else if (_request != null) const Text('Yêu cầu đã kết thúc. Lịch sử trao đổi vẫn được giữ lại.'),
        ],
        if (_before != null) TextButton(onPressed: _loading ? null : () => _reload(older: true), child: Text(room ? 'Tin nhắn cũ hơn' : 'Xem tiếp')),
      ]),
    );
  }
}

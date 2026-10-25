import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../m07/m07_source.dart';
import '../m07/m07_widgets.dart';
import '../m10/order_chat_models.dart';
import '../m10/order_chat_view.dart';
import '../m10/order_sections.dart';
import '../tokens.dart';
import '../wallet/wallet_models.dart' show formatWalletTime, formatWalletVnd, parseVndInput;
import '../widgets/components.dart';
import 'shop_payment_models.dart';
import 'shop_payment_source.dart';

// "Thanh toán quán" in 11Food (issue #198), with "Trao đổi thanh toán" (#199). The shop asks for a payment, transfers OUTSIDE the app, presses "Tôi đã chuyển
// khoản" and waits. The phone decides nothing: the state, whether the report or the cancel is still possible and whether the chat is open are the server's, read
// again on every refresh. A report is a notice, never "Đã nhận tiền"; recording the money and opening an account or a right are the administration's own acts and
// are only ever SHOWN here once the server says they happened. The app has no price list and no payment period: the shop types the amount it was told.

String _purposeHint(ShopPaymentPurpose purpose) => switch (purpose) {
      ShopPaymentPurpose.accountOpening => 'Khoản để quản trị viên xem xét mở tài khoản quán. Việc mở quán vẫn theo điều kiện thiết lập của quán.',
      ShopPaymentPurpose.menuExpansion => 'Khoản để quản trị viên xem xét mở rộng số món hiển thị (mặc định tối đa 20 món).',
      ShopPaymentPurpose.other => 'Khoản khác theo thông báo của quản trị viên.',
    };

// ---- the list ------------------------------------------------------------------------------------------------------------

class ShopPaymentListScreen extends StatefulWidget {
  const ShopPaymentListScreen({super.key, required this.source});

  final ShopPaymentSource source;

  @override
  State<ShopPaymentListScreen> createState() => _ShopPaymentListScreenState();
}

class _ShopPaymentListScreenState extends State<ShopPaymentListScreen> {
  List<ShopPayment> _items = const <ShopPayment>[];
  String? _cursor;
  bool _loading = true;
  bool _more = false;
  M07Failure? _failure;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final ShopPaymentPage page = await widget.source.list();
      if (!mounted) {
        return;
      }
      setState(() {
        _items = page.items;
        _cursor = page.nextCursor;
        _loading = false;
      });
    } on M07Failure catch (error) {
      if (mounted) {
        setState(() {
          _failure = error;
          _loading = false;
        });
      }
    } on Object {
      if (mounted) {
        setState(() {
          _failure = const M07Failure(M07FailureKind.server);
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadMore() async {
    final String? cursor = _cursor;
    if (cursor == null || _more) {
      return;
    }
    setState(() => _more = true);
    try {
      final ShopPaymentPage page = await widget.source.list(cursor: cursor);
      if (!mounted) {
        return;
      }
      setState(() {
        _items = <ShopPayment>[..._items, ...page.items];
        _cursor = page.nextCursor;
        _more = false;
      });
    } on Object {
      if (mounted) {
        setState(() => _more = false);
      }
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (BuildContext _) => screen));
    if (mounted) {
      unawaited(_load());
    }
  }

  @override
  Widget build(BuildContext context) {
    return N11FormScaffold(
      title: 'Thanh toán quán',
      session: null,
      children: <Widget>[
        const ReasonNote('Tạo yêu cầu, chuyển khoản vào tài khoản của hệ thống rồi bấm "Tôi đã chuyển khoản". Quản trị viên đối soát sao kê và xử lý. Báo chuyển khoản chưa phải là đã nhận tiền.', key: Key('payment-intro'), icon: Icons.info_outline),
        N11Button(key: const Key('payment-create'), label: 'Tạo yêu cầu thanh toán', icon: Icons.add, onPressed: () => unawaited(_open(ShopPaymentCreateScreen(source: widget.source)))),
        if (_loading)
          const Padding(padding: EdgeInsets.all(N11Space.gap4), child: Center(child: CircularProgressIndicator()))
        else if (_failure != null)
          M07FailureBanner(key: const Key('payment-list-failed'), failure: _failure!, onRetry: _load)
        else if (_items.isEmpty)
          const EmptyState(icon: Icons.account_balance_outlined, title: 'Chưa có yêu cầu thanh toán', text: 'Các yêu cầu bạn tạo sẽ hiện ở đây cùng trạng thái đối soát.')
        else ...<Widget>[
          for (final ShopPayment p in _items)
            N11ListItem(
              key: ValueKey<String>('payment-${p.requestId}'),
              icon: p.state == ShopPaymentState.confirmed ? Icons.check_circle_outline : (p.state == ShopPaymentState.pending ? Icons.hourglass_top : Icons.receipt_long_outlined),
              title: '${p.purpose.label} · ${formatWalletVnd(p.amount)}',
              sub: '${p.stateLabel} · ${formatWalletTime(p.createdAt.toLocal())}',
              onTap: () => unawaited(_open(ShopPaymentDetailScreen(source: widget.source, requestId: p.requestId))),
            ),
          if (_cursor != null) N11Button(key: const Key('payment-more'), label: 'Xem thêm', kind: ButtonKind.secondary, loading: _more, onPressed: _loadMore),
        ],
      ],
    );
  }
}

// ---- create --------------------------------------------------------------------------------------------------------------

class ShopPaymentCreateScreen extends StatefulWidget {
  const ShopPaymentCreateScreen({super.key, required this.source});

  final ShopPaymentSource source;

  @override
  State<ShopPaymentCreateScreen> createState() => _ShopPaymentCreateScreenState();
}

class _ShopPaymentCreateScreenState extends State<ShopPaymentCreateScreen> {
  final TextEditingController _amount = TextEditingController();
  ShopPaymentPurpose _purpose = ShopPaymentPurpose.accountOpening;
  bool _busy = false;
  String? _error;
  // The key of ONE intent, kept until the server gave a definite answer: a lost answer retried writes nothing twice.
  String? _key;
  String? _keyFor;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final int? amount = parseVndInput(_amount.text);
    if (amount == null || amount < 1 || amount > 999999999) {
      setState(() => _error = 'Nhập số tiền hợp lệ theo thông báo của quản trị viên (từ 1đ đến 999.999.999đ).');
      return;
    }
    final String intent = '${_purpose.wire}:$amount';
    if (_key == null || _keyFor != intent) {
      _key = m07NewKey();
      _keyFor = intent;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final ShopPayment created = await widget.source.create(purpose: _purpose, amount: amount, key: _key!);
      _key = null;
      if (!mounted) {
        return;
      }
      await Navigator.of(context).pushReplacement<void, void>(MaterialPageRoute<void>(builder: (BuildContext _) => ShopPaymentDetailScreen(source: widget.source, requestId: created.requestId)));
    } on M07Failure catch (error) {
      if (error.kind != M07FailureKind.offline) {
        _key = null;
      }
      if (mounted) {
        setState(() {
          _busy = false;
          _error = error.message;
        });
      }
    } on Object {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = 'Chưa tạo được yêu cầu. Vui lòng thử lại.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return N11FormScaffold(
      title: 'Tạo yêu cầu thanh toán',
      session: null,
      children: <Widget>[
        const Text('Mục đích', style: N11Text.label),
        RadioGroup<ShopPaymentPurpose>(
          groupValue: _purpose,
          onChanged: (ShopPaymentPurpose? v) {
            if (v != null && !_busy) {
              setState(() => _purpose = v);
            }
          },
          child: Column(
            children: <Widget>[
              for (final ShopPaymentPurpose p in ShopPaymentPurpose.values) RadioListTile<ShopPaymentPurpose>(key: Key('purpose-${p.wire}'), value: p, title: Text(p.label), contentPadding: EdgeInsets.zero),
            ],
          ),
        ),
        ReasonNote(_purposeHint(_purpose), key: const Key('purpose-hint'), icon: Icons.info_outline),
        N11Field(fieldKey: const Key('payment-amount'), label: 'Số tiền (đồng)', controller: _amount, keyboard: TextInputType.number, maxLength: 12, enabled: !_busy, hint: 'Nhập đúng số tiền quản trị viên thông báo. Ứng dụng không tự đặt giá.'),
        if (_error != null) N11Banner(key: const Key('payment-create-error'), kind: BannerKind.error, title: 'Chưa tạo được', text: _error),
        N11Button(key: const Key('payment-submit'), label: 'Tạo yêu cầu', loading: _busy, onPressed: _submit),
        const ReasonNote('Tạo yêu cầu chưa tính là đã trả tiền và chưa mở tài khoản hay quyền nào.'),
      ],
    );
  }
}

// ---- one request ---------------------------------------------------------------------------------------------------------

class ShopPaymentDetailScreen extends StatefulWidget {
  const ShopPaymentDetailScreen({super.key, required this.source, required this.requestId});

  final ShopPaymentSource source;
  final String requestId;

  @override
  State<ShopPaymentDetailScreen> createState() => _ShopPaymentDetailScreenState();
}

class _ShopPaymentDetailScreenState extends State<ShopPaymentDetailScreen> {
  ShopPayment? _payment;
  List<PaymentAccount> _accounts = const <PaymentAccount>[];
  M07Failure? _failure;
  M07Failure? _actionFailure;
  bool _loading = true;
  bool _busy = false;
  OrderChatController? _chat;
  // One key per intent, kept until a definite answer.
  String? _reportKey;
  String? _cancelKey;

  @override
  void initState() {
    super.initState();
    final OrderChatApi? api = widget.source.chat;
    if (api != null) {
      _chat = OrderChatController(api: api, room: ChatRoomRef(ChatDoor.shopPayment, widget.requestId));
    }
    unawaited(_load());
  }

  @override
  void dispose() {
    _chat?.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _loading = true;
        _failure = null;
      });
    }
    try {
      final ShopPayment payment = await widget.source.detail(widget.requestId);
      List<PaymentAccount> accounts = _accounts;
      if (payment.state == ShopPaymentState.pending) {
        accounts = await widget.source.accounts();
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _payment = payment;
        _accounts = accounts;
        _loading = false;
        _failure = null;
      });
      _chat?.noteVersion(payment.version);
    } on M07Failure catch (error) {
      if (mounted) {
        setState(() {
          _failure = error;
          _loading = false;
        });
      }
    } on Object {
      if (mounted) {
        setState(() {
          _failure = const M07Failure(M07FailureKind.server);
          _loading = false;
        });
      }
    }
  }

  Future<bool> _confirm(String title, String text, String yes) async {
    final bool? answer = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: Text(title),
        content: Text(text),
        actions: <Widget>[
          TextButton(key: const Key('dialog-no'), onPressed: () => Navigator.of(context).pop(false), child: const Text('Quay lại')),
          TextButton(key: const Key('dialog-yes'), onPressed: () => Navigator.of(context).pop(true), child: Text(yes)),
        ],
      ),
    );
    return answer == true;
  }

  Future<void> _run(Future<ShopPayment> Function() work, void Function() spent) async {
    setState(() {
      _busy = true;
      _actionFailure = null;
    });
    try {
      final ShopPayment next = await work();
      spent();
      if (mounted) {
        setState(() {
          _payment = next;
          _busy = false;
        });
        unawaited(_load(quiet: true));
      }
    } on M07Failure catch (error) {
      // A definite refusal spends the key; a lost answer keeps it so the retry is the same command.
      if (error.kind != M07FailureKind.offline) {
        spent();
      }
      if (mounted) {
        setState(() {
          _actionFailure = error;
          _busy = false;
        });
        if (error.kind == M07FailureKind.conflict) {
          unawaited(_load(quiet: true));
        }
      }
    } on Object {
      if (mounted) {
        setState(() {
          _actionFailure = const M07Failure(M07FailureKind.server);
          _busy = false;
        });
      }
    }
  }

  Future<void> _report(ShopPayment p) async {
    final bool yes = await _confirm('Bạn đã chuyển khoản?', 'Chỉ bấm khi bạn đã chuyển khoản ${formatWalletVnd(p.amount)} vào tài khoản ở trên. Quản trị viên sẽ kiểm tra sao kê; đây chưa phải là xác nhận đã nhận tiền.', 'Tôi đã chuyển khoản');
    if (!yes || !mounted) {
      return;
    }
    _reportKey ??= m07NewKey();
    await _run(() => widget.source.report(p.requestId, key: _reportKey!), () => _reportKey = null);
  }

  Future<void> _cancel(ShopPayment p) async {
    final bool yes = await _confirm('Hủy yêu cầu?', 'Yêu cầu sẽ đóng. Bạn có thể tạo yêu cầu mới sau.', 'Hủy yêu cầu');
    if (!yes || !mounted) {
      return;
    }
    _cancelKey ??= m07NewKey();
    await _run(() => widget.source.cancel(p.requestId, version: p.version, key: _cancelKey!), () => _cancelKey = null);
  }

  (IconData, String) _look(ShopPayment p) => switch (p.state) {
        ShopPaymentState.pending when p.reportedAt == null => (Icons.payments_outlined, 'Hãy chuyển khoản vào tài khoản bên dưới rồi bấm "Tôi đã chuyển khoản".'),
        ShopPaymentState.pending => (Icons.hourglass_top, 'Đã báo chuyển khoản. Quản trị viên sẽ kiểm tra sao kê. Báo chuyển khoản chưa phải là đã nhận tiền.'),
        ShopPaymentState.confirmed => (Icons.check_circle_outline, 'Quản trị viên đã xác nhận tiền thực nhận${p.receivedAmount == null ? '' : ' ${formatWalletVnd(p.receivedAmount!)}'}. Việc mở tài khoản hoặc quyền do quản trị viên thực hiện riêng.'),
        ShopPaymentState.rejected => (Icons.cancel_outlined, 'Quản trị viên chưa ghi nhận được tiền cho yêu cầu này. Bạn có thể nhắn trong mục Trao đổi thanh toán.'),
        ShopPaymentState.cancelled => (Icons.block, 'Yêu cầu đã được hủy.'),
      };

  Widget _kv(String label, String value, {Key? key}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(flex: 4, child: Text(label, style: N11Text.caption)),
            const SizedBox(width: N11Space.gap2),
            Expanded(flex: 6, child: Text(value, key: key, textAlign: TextAlign.right, style: N11Text.bodyStrong)),
          ],
        ),
      );

  Widget _accountCard(ShopPayment p) {
    if (p.state != ShopPaymentState.pending) {
      return const SizedBox.shrink();
    }
    if (_accounts.isEmpty) {
      return const ReasonNote('Hệ thống chưa có tài khoản nhận tiền. Vui lòng thử lại sau.', key: Key('payment-no-account'), icon: Icons.info_outline);
    }
    final PaymentAccount a = _accounts.first;
    return N11Card(
      key: const Key('payment-account'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Chuyển khoản tới', style: N11Text.h2),
          _kv('Ngân hàng', a.bankId),
          Row(children: <Widget>[
            Expanded(child: _kv('Số tài khoản', a.accountNumber, key: const Key('payment-account-number'))),
            IconButton(key: const Key('payment-copy-account'), tooltip: 'Sao chép số tài khoản', icon: const Icon(Icons.copy, size: 20), onPressed: () => unawaited(Clipboard.setData(ClipboardData(text: a.accountNumber)))),
          ]),
          _kv('Chủ tài khoản', a.accountHolder),
          _kv('Số tiền', formatWalletVnd(p.amount)),
          const SizedBox(height: 4),
          const Text('Chuyển khoản trong ứng dụng ngân hàng của bạn, rồi quay lại đây bấm "Tôi đã chuyển khoản".', style: N11Text.caption),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ShopPayment? p = _payment;
    return N11FormScaffold(
      title: 'Chi tiết thanh toán',
      session: null,
      children: <Widget>[
        if (p == null && _loading)
          const Padding(padding: EdgeInsets.all(N11Space.gap4), child: Center(child: CircularProgressIndicator()))
        else if (p == null)
          M07FailureBanner(key: const Key('payment-detail-failed'), failure: _failure ?? const M07Failure(M07FailureKind.server), onRetry: _load)
        else ...<Widget>[
          N11Banner(
            key: const Key('payment-status'),
            kind: switch (p.state) {
              ShopPaymentState.confirmed => BannerKind.success,
              ShopPaymentState.rejected => BannerKind.error,
              _ => BannerKind.info,
            },
            icon: _look(p).$1,
            title: p.stateLabel,
            text: _look(p).$2,
          ),
          N11Card(
            child: Column(
              children: <Widget>[
                _kv('Mục đích', p.purpose.label),
                _kv('Số tiền đề nghị', formatWalletVnd(p.amount), key: const Key('payment-amount-shown')),
                _kv('Tạo lúc', formatWalletTime(p.createdAt.toLocal())),
                if (p.reportedAt != null) _kv('Báo chuyển khoản lúc', formatWalletTime(p.reportedAt!.toLocal()), key: const Key('payment-reported-at')),
                if (p.receivedAmount != null) _kv('Tiền thực nhận', formatWalletVnd(p.receivedAmount!), key: const Key('payment-received')),
                if (p.entitlementGranted) _kv('Quyền mở rộng số món', 'Đã được mở', key: const Key('payment-entitlement')),
              ],
            ),
          ),
          _accountCard(p),
          if (_actionFailure != null) M07FailureBanner(key: const Key('payment-action-failed'), failure: _actionFailure!),
          if (p.canReport) N11Button(key: const Key('payment-report'), label: 'Tôi đã chuyển khoản', icon: Icons.check, loading: _busy, onPressed: () => unawaited(_report(p))),
          if (p.canCancel) N11Button(key: const Key('payment-cancel'), label: 'Hủy yêu cầu', kind: ButtonKind.secondary, loading: _busy, onPressed: () => unawaited(_cancel(p))),
          if (_chat != null)
            ListenableBuilder(
              listenable: _chat!,
              builder: (BuildContext context, Widget? _) => OrderSection(id: 'chat', title: 'Trao đổi thanh toán', summary: _chat!.summary, initiallyExpanded: true, builder: (BuildContext _) => OrderChatPanel(controller: _chat!, texts: ChatTexts.payment)),
            ),
        ],
      ],
    );
  }
}

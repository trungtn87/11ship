import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../tokens.dart';
import '../m07/m07_widgets.dart' show KeyValueRows;
import '../widgets/components.dart';
import 'wallet_models.dart';
import 'wallet_http.dart';
import '../finance/finance_views.dart';
import 'wallet_sample.dart';
import 'wallet_source.dart';

// M04 UI phase: the seven Shipper-app wallet screens approved on 15/10/2026 (docs/ui/m04/README.md section 3).
//   M04-S01 WalletHomeScreen · M04-S02 TopupAmountScreen · M04-S03 TopupConfirmScreen · M04-S04 TopupDetailScreen
//   M04-S05 WithdrawScreen · M04-S06 WithdrawDetailScreen · M04-S07 TxnHistoryScreen
// Every screen reads a [WalletSource]. With the not-wired source (real builds) nothing but the reason is shown and every write control is
// disabled. With the sample source (preview) each screen carries "Dữ liệu minh họa · không phải số dư thật". No screen adds money: a topup
// is only a REQUEST that an Admin confirms later.

const String kNoDataText = 'Chưa có dữ liệu để hiển thị.';

/// "Dữ liệu minh họa" banner shown on every screen fed by sample data.
class WalletSampleBanner extends StatelessWidget {
  const WalletSampleBanner({super.key});

  @override
  Widget build(BuildContext context) => const N11Banner(
        key: Key('wallet-sample-banner'),
        kind: BannerKind.warn,
        title: kSampleLabel,
        text: 'Chỉ để xem giao diện. Thao tác chỉ ghi trong bộ nhớ, không gửi tới máy chủ.',
        icon: Icons.visibility_outlined,
      );
}

/// The widget of a read that is not ready (loading / not wired / failed / empty), or null when it is ready.
Widget? walletStateView<T>(WalletLoad<T> state, {VoidCallback? retry, String keyPrefix = 'wallet', IconData emptyIcon = Icons.receipt_long_outlined, String emptyTitle = 'Chưa có dữ liệu', String emptyText = kNoDataText}) {
  if (state is WalletLoading<T>) {
    return Padding(key: Key('$keyPrefix-loading'), padding: const EdgeInsets.all(N11Space.gap8), child: const Center(child: CircularProgressIndicator()));
  }
  if (state is WalletNotWired<T>) {
    return N11Banner(key: Key('$keyPrefix-not-wired'), kind: BannerKind.warn, title: 'Chưa kết nối máy chủ', text: state.reason, icon: Icons.lock_outline);
  }
  if (state is WalletFailed<T>) {
    return N11Banner(
      key: Key('$keyPrefix-failed'),
      kind: BannerKind.error,
      title: 'Chưa tải được dữ liệu',
      text: state.message,
      trailing: retry == null ? null : N11Button(key: Key('$keyPrefix-retry'), label: 'Thử lại', compact: true, kind: ButtonKind.secondary, onPressed: retry),
    );
  }
  if (state is WalletEmpty<T>) {
    return EmptyState(icon: emptyIcon, title: emptyTitle, text: emptyText);
  }
  return null;
}

/// Loads one read and draws loading / not wired / failed / empty itself; [builder] draws only a ready value. "Thử lại" reloads.
class WalletLoader<T> extends StatefulWidget {
  const WalletLoader({super.key, required this.load, required this.builder, this.emptyIcon = Icons.receipt_long_outlined, this.emptyTitle = 'Chưa có dữ liệu', this.emptyText = kNoDataText});

  final Future<WalletLoad<T>> Function() load;
  final Widget Function(T value) builder;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptyText;

  @override
  State<WalletLoader<T>> createState() => _WalletLoaderState<T>();
}

class _WalletLoaderState<T> extends State<WalletLoader<T>> {
  WalletLoad<T> _state = WalletLoading<T>();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    WalletLoad<T> result;
    try {
      result = await widget.load();
    } catch (_) {
      result = WalletFailed<T>('Không đọc được dữ liệu. Vui lòng thử lại.');
    }
    if (!mounted) {
      return;
    }
    setState(() => _state = result);
  }

  void _retry() {
    setState(() => _state = WalletLoading<T>());
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    final WalletLoad<T> state = _state;
    if (state is WalletReady<T>) {
      return widget.builder(state.value);
    }
    return walletStateView<T>(state, retry: _retry, emptyIcon: widget.emptyIcon, emptyTitle: widget.emptyTitle, emptyText: widget.emptyText) ?? const SizedBox.shrink();
  }
}

Widget _page(WalletSource source, String title, List<Widget> children) {
  return N11FormScaffold(title: title, session: null, children: <Widget>[if (source.isSample) const WalletSampleBanner(), ...children]);
}

class _KV extends StatelessWidget {
  const _KV(this.label, this.value, {this.valueKey});

  final String label;
  final String value;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) =>
      KeyValueRows(<(String, String)>[(label, value)], valueKeys: <String, Key>{if (valueKey != null) label: valueKey!}, responsive: true);
}

Future<bool> _confirm(BuildContext context, {required String title, required String text}) async {
  final bool? yes = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialog) => AlertDialog(
      title: Text(title),
      content: Text(text),
      actions: <Widget>[
        TextButton(key: const Key('confirm-no'), onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Không')),
        TextButton(key: const Key('confirm-yes'), onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Hủy yêu cầu')),
      ],
    ),
  );
  return yes == true;
}

// ---- transactions: tile, sheet ---------------------------------------------------------------------------------------

IconData _txnIcon(TxnType type) => switch (type) {
      TxnType.topup => Icons.arrow_downward,
      TxnType.withdraw => Icons.arrow_upward,
      TxnType.commission => Icons.receipt_long_outlined,
      TxnType.hold => Icons.lock_outline,
      TxnType.release => Icons.lock_open_outlined,
    };

String _txnTypeLabel(TxnType type) => switch (type) {
      TxnType.topup => 'Nạp tiền',
      TxnType.withdraw => 'Rút tiền',
      TxnType.commission => 'Hoa hồng',
      TxnType.hold => 'Tạm giữ',
      TxnType.release => 'Giải phóng tạm giữ',
    };

Color _amountInk(WalletTxn txn) {
  if (txn.status == TxnStatus.cancelled) {
    return N11Colors.ink3;
  }
  if (!txn.isLedgerMovement) {
    return N11Colors.black;
  }
  return txn.amount > 0 ? N11Colors.successInk : (txn.status == TxnStatus.pending ? N11Colors.chipWarnInk : N11Colors.errorInk);
}

ChipKind _txnChip(TxnStatus status) => switch (status) {
      TxnStatus.success => ChipKind.ok,
      TxnStatus.pending => ChipKind.warn,
      TxnStatus.processing => ChipKind.info,
      TxnStatus.cancelled => ChipKind.neutral,
    };

/// One row of the transaction list. Holds and their release show a neutral amount (no sign, no green): they are information, not ledger movements.
class WalletTxnTile extends StatelessWidget {
  const WalletTxnTile({super.key, required this.txn, required this.onTap});

  final WalletTxn txn;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bool neutral = !txn.isLedgerMovement;
    final bool credit = txn.isLedgerMovement && txn.amount > 0;
    return InkWell(
      key: Key('txn-${txn.id}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(N11Space.gap3),
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final bool stacked = constraints.maxWidth < 360 || MediaQuery.textScalerOf(context).scale(16) > 21;
            final Widget amount = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  txn.amountText,
                  key: Key('txn-amount-${txn.id}'),
                  style: N11Text.bodyStrong.copyWith(color: _amountInk(txn)),
                ),
                const SizedBox(height: N11Space.gap1),
                N11Chip(txnStatusLabel(txn.status), kind: _txnChip(txn.status)),
              ],
            );
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: credit ? N11Colors.successSoft : (neutral ? N11Colors.chipSoon : N11Colors.errorSoft),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(_txnIcon(txn.type), size: 20, color: credit ? N11Colors.successInk : (neutral ? N11Colors.ink2 : N11Colors.errorInk)),
                ),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(txn.title, style: N11Text.bodyStrong),
                      Text(txn.orderRef == null ? formatWalletTime(txn.at) : '${formatWalletTime(txn.at)} · ${txn.orderRef}', style: N11Text.caption),
                      if (stacked) ...<Widget>[const SizedBox(height: N11Space.gap2), amount],
                    ],
                  ),
                ),
                if (!stacked) ...<Widget>[const SizedBox(width: N11Space.gap3), amount],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _TxnSheet extends StatelessWidget {
  const _TxnSheet({required this.txn});

  final WalletTxn txn;

  @override
  Widget build(BuildContext context) {
    final bool hasRequest = txn.requestCode != null && (txn.type == TxnType.topup || txn.type == TxnType.withdraw);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap4),
        child: Column(
          key: const Key('txn-sheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(txn.title, style: N11Text.h2),
            const SizedBox(height: N11Space.gap2),
            _KV('Loại', _txnTypeLabel(txn.type)),
            _KV(txn.isLedgerMovement ? 'Số tiền' : 'Số tiền giữ', txn.amountText),
            _KV('Thời gian', formatWalletTime(txn.at)),
            _KV('Trạng thái', txnStatusLabel(txn.status)),
            if (txn.orderRef != null) _KV('Đơn hàng', txn.orderRef!),
            if (txn.requestCode != null) _KV('Mã yêu cầu', walletShortCode(txn.requestCode!)),
            if (!txn.isLedgerMovement)
              const Padding(
                padding: EdgeInsets.only(top: N11Space.gap2),
                child: ReasonNote('Tạm giữ là thông tin giữ chỗ, không phải khoản trừ trong sổ giao dịch.'),
              ),
            const SizedBox(height: N11Space.gap3),
            if (hasRequest) N11Button(key: const Key('txn-open-request'), label: 'Xem yêu cầu', onPressed: () => Navigator.of(context).pop(txn.requestCode)),
            if (hasRequest) const SizedBox(height: N11Space.gap2),
            N11Button(key: const Key('txn-close'), label: 'Đóng', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).pop()),
          ],
        ),
      ),
    );
  }
}

Future<void> _openTxn(BuildContext context, WalletSource source, WalletTxn txn) async {
  final String? code = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: N11Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(kRadiusCard))),
    builder: (BuildContext sheet) => SingleChildScrollView(child: _TxnSheet(txn: txn)),
  );
  if (code == null || !context.mounted) {
    return;
  }
  final Widget screen = txn.type == TxnType.topup ? TopupDetailScreen(source: source, code: code) : WithdrawDetailScreen(source: source, code: code);
  await Navigator.of(context).push(n11Route(screen));
}

Widget _txnList(BuildContext context, WalletSource source, List<WalletTxn> rows, Future<void> Function() afterOpen) {
  return N11List(
    children: <Widget>[
      for (final WalletTxn t in rows)
        WalletTxnTile(
          txn: t,
          onTap: () async {
            await _openTxn(context, source, t);
            await afterOpen();
          },
        ),
    ],
  );
}

// ---- M04-S01: Ví của tôi ---------------------------------------------------------------------------------------------

class WalletHomeScreen extends StatefulWidget {
  const WalletHomeScreen({super.key, required this.source, this.minTopup, this.minWithdraw});

  final WalletSource source;

  /// Display minimums when a caller fixes them; null = what the source says (a real source reads the minimums the server asks for today).
  final int? minTopup;
  final int? minWithdraw;

  @override
  State<WalletHomeScreen> createState() => _WalletHomeScreenState();
}

class _WalletHomeScreenState extends State<WalletHomeScreen> {
  int _rev = 0;

  Future<void> _refresh() async {
    if (mounted) {
      setState(() => _rev++);
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(n11Route(screen));
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    return _page(source, 'Ví của tôi', <Widget>[
      WalletLoader<Wallet>(key: ValueKey<String>('wallet-$_rev'), load: source.wallet, builder: (Wallet wallet) => _BalanceCard(wallet: wallet)),
      Row(
        children: <Widget>[
          Expanded(child: N11Button(key: const Key('wallet-topup-button'), label: 'Nạp tiền', icon: Icons.south_west, onPressed: source.canWrite ? () => _open(TopupAmountScreen(source: source, minTopup: widget.minTopup)) : null)),
          if (source.isSample) const SizedBox(width: N11Space.gap3),
          if (source.isSample) Expanded(child: N11Button(key: const Key('wallet-withdraw-button'), label: 'Rút tiền', icon: Icons.north_east, kind: ButtonKind.secondary, onPressed: source.canWrite ? () => _open(WithdrawScreen(source: source, minWithdraw: widget.minWithdraw)) : null)),
        ],
      ),
      if (!source.isSample && source.canWrite) const ReasonNote('Để rút toàn bộ số dư, mở Tài khoản → Dừng hoạt động / Rút tiền.'),
      if (!source.canWrite) ReasonNote('${source.notWiredReason} Nạp và rút tiền chưa dùng được.'),
      LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          if (constraints.maxWidth < 320 || MediaQuery.textScalerOf(context).scale(16) > 21) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Giao dịch gần đây', style: N11Text.h2),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const Key('wallet-see-all'),
                    onPressed: () => _open(TxnHistoryScreen(source: source, minTopup: widget.minTopup, minWithdraw: widget.minWithdraw)),
                    child: const Text('Xem tất cả'),
                  ),
                ),
              ],
            );
          }
          return Row(
            children: <Widget>[
              const Expanded(child: Text('Giao dịch gần đây', style: N11Text.h2)),
              TextButton(
                key: const Key('wallet-see-all'),
                onPressed: () => _open(TxnHistoryScreen(source: source, minTopup: widget.minTopup, minWithdraw: widget.minWithdraw)),
                child: const Text('Xem tất cả'),
              ),
            ],
          );
        },
      ),
      WalletLoader<List<WalletTxn>>(
        key: ValueKey<String>('recent-$_rev'),
        load: source.recentTxns,
        emptyTitle: 'Chưa có giao dịch',
        emptyText: 'Các giao dịch của ví sẽ hiển thị ở đây.',
        builder: (List<WalletTxn> rows) => _txnList(context, source, rows, _refresh),
      ),
    ]);
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.wallet});

  final Wallet wallet;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('wallet-card'),
      padding: const EdgeInsets.all(N11Space.gap4),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: <Color>[N11Colors.yellow, N11Colors.yellowHover], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Số dư khả dụng', style: N11Text.bodyStrong),
          const SizedBox(height: 6),
          Text(formatWalletVnd(wallet.available), key: const Key('wallet-available'), style: N11Text.title),
          const SizedBox(height: N11Space.gap4),
          LayoutBuilder(builder: (BuildContext context, BoxConstraints constraints) {
            final Widget total = _Mini(label: 'Tổng số dư', value: formatWalletVnd(wallet.total), valueKey: const Key('wallet-total'));
            final Widget held = _Mini(label: 'Tiền tạm giữ', value: formatWalletVnd(wallet.held), valueKey: const Key('wallet-held'));
            if (constraints.maxWidth < 320 || MediaQuery.textScalerOf(context).scale(16) > 21) {
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[total, const SizedBox(height: N11Space.gap3), held]);
            }
            return Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[Expanded(child: total), const SizedBox(width: N11Space.gap4), Expanded(child: held)]);
          }),
          const SizedBox(height: N11Space.gap2),
          const Text('Tiền tạm giữ là tiền giữ chỗ, chưa bị trừ khỏi sổ giao dịch.', key: Key('wallet-hold-note'), style: TextStyle(fontSize: 14, height: 1.4, color: N11Colors.black)),
        ],
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.label, required this.value, required this.valueKey});

  final String label;
  final String value;
  final Key valueKey;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: const TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w600, color: N11Colors.black)),
        Text(value, key: valueKey, style: const TextStyle(fontSize: 16, height: 1.4, fontWeight: FontWeight.w800, color: N11Colors.black)),
      ],
    );
  }
}

// ---- M04-S02: Nạp tiền (nhập số tiền) -------------------------------------------------------------------------------

class TopupAmountScreen extends StatefulWidget {
  const TopupAmountScreen({super.key, required this.source, this.minTopup});

  final WalletSource source;
  final int? minTopup;

  @override
  State<TopupAmountScreen> createState() => _TopupAmountScreenState();
}

class _TopupAmountScreenState extends State<TopupAmountScreen> {
  final TextEditingController _amount = TextEditingController();
  WalletLoad<BankTransferInfo> _info = WalletLoading<BankTransferInfo>();
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    WalletLoad<BankTransferInfo> result;
    try {
      result = await widget.source.transferInfo();
    } catch (_) {
      result = WalletFailed<BankTransferInfo>('Không đọc được thông tin chuyển khoản. Vui lòng thử lại.');
    }
    if (mounted) {
      setState(() => _info = result);
    }
  }

  void _retry() {
    setState(() => _info = WalletLoading<BankTransferInfo>());
    _fetch();
  }

  int get _min => widget.minTopup ?? widget.source.minTopup;

  String? _validate() {
    final int? value = parseVndInput(_amount.text);
    if (value == null) {
      return 'Hãy nhập số tiền muốn nạp.';
    }
    if (value < _min) {
      return 'Số tiền nạp tối thiểu ${formatWalletVnd(_min)}.';
    }
    return null;
  }

  Future<void> _continue() async {
    final WalletLoad<BankTransferInfo> state = _info;
    final String? problem = _validate();
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    if (state is! WalletReady<BankTransferInfo>) {
      return;
    }
    setState(() => _error = null);
    final int amount = parseVndInput(_amount.text)!;
    final TopupRequest? created = await Navigator.of(context).push<TopupRequest>(MaterialPageRoute<TopupRequest>(builder: (BuildContext context) => TopupConfirmScreen(source: widget.source, amount: amount, info: state.value)));
    if (created == null || !mounted) {
      return;
    }
    await Navigator.of(context).pushReplacement(n11Route(TopupDetailScreen(source: widget.source, code: created.code)));
  }

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    final WalletLoad<BankTransferInfo> state = _info;
    return _page(source, 'Nạp tiền', <Widget>[
      N11Field(
        validator: (_) => _validate(),
        fieldKey: const Key('topup-amount'),
        label: 'Nhập số tiền nạp',
        controller: _amount,
        keyboard: TextInputType.number,
        placeholder: '100.000',
        maxLength: 12,
        suffix: const Padding(padding: EdgeInsets.only(right: 14), child: Center(widthFactor: 1, child: Text('đ', style: N11Text.bodyStrong))),
        tone: _error == null ? FieldTone.normal : FieldTone.error,
        hint: _error ?? 'Tối thiểu ${formatWalletVnd(_min)} mỗi lần nạp',
        onChanged: () => setState(() => _error = null),
      ),
      const Text('Thông tin chuyển khoản', style: N11Text.h2),
      if (state is WalletReady<BankTransferInfo>) _TransferCard(info: state.value) else walletStateView<BankTransferInfo>(state, retry: _retry) ?? const SizedBox.shrink(),
      if (state is WalletReady<BankTransferInfo>)
        (source.isSample ? const _QrPlaceholder() : const ReasonNote('Mã QR chưa được hỗ trợ ở phiên bản này. Hãy chuyển khoản theo thông tin ở trên rồi bấm "Tôi đã chuyển tiền".', key: Key('topup-no-qr'))),
      N11Button(key: const Key('topup-continue'), validate: true, label: 'Tôi đã chuyển tiền', onPressed: source.canWrite && state is WalletReady<BankTransferInfo> ? _continue : null),
      if (!source.canWrite) ReasonNote(source.notWiredReason),
    ]);
  }
}

class _TransferCard extends StatelessWidget {
  const _TransferCard({required this.info});

  final BankTransferInfo info;

  @override
  Widget build(BuildContext context) {
    return N11Card(
      child: Column(
        key: const Key('topup-transfer-card'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _KV('Ngân hàng', info.bankName),
          _CopyRow(label: 'Số tài khoản', value: info.accountNumber, copyKey: const Key('copy-account')),
          _KV('Chủ tài khoản', info.holder),
          if (info.content != null) _CopyRow(label: 'Nội dung chuyển khoản', value: info.content!, copyKey: const Key('copy-content')),
        ],
      ),
    );
  }
}

class _CopyRow extends StatelessWidget {
  const _CopyRow({required this.label, required this.value, required this.copyKey});

  final String label;
  final String value;
  final Key copyKey;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(label, style: N11Text.caption),
                Text(value, style: N11Text.bodyStrong),
              ],
            ),
          ),
          TextButton.icon(
            key: copyKey,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: value));
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã sao chép')));
              }
            },
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('Sao chép'),
          ),
        ],
      ),
    );
  }
}

/// No QR image is drawn here: a QR must come from the bank connection, so until then only this labelled placeholder exists.
class _QrPlaceholder extends StatelessWidget {
  const _QrPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('topup-qr-placeholder'),
      padding: const EdgeInsets.all(N11Space.gap4),
      decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.lineStrong), borderRadius: BorderRadius.circular(kRadiusCard)),
      child: const Column(
        children: <Widget>[
          Icon(Icons.qr_code_2, size: 72, color: N11Colors.disabledInk),
          SizedBox(height: N11Space.gap2),
          Text('QR sẽ hiển thị khi kết nối ngân hàng', textAlign: TextAlign.center, style: N11Text.caption),
          SizedBox(height: 2),
          Text('Vui lòng chuyển khoản đúng nội dung đã được xác nhận nhanh chóng.', textAlign: TextAlign.center, style: N11Text.caption),
        ],
      ),
    );
  }
}

// ---- M04-S03: Xác nhận nạp tiền --------------------------------------------------------------------------------------

/// Pops with the created [TopupRequest] (state "Chờ xác nhận"). Nothing is credited: only an Admin confirms a topup.
class TopupConfirmScreen extends StatefulWidget {
  const TopupConfirmScreen({super.key, required this.source, required this.amount, required this.info});

  final WalletSource source;
  final int amount;
  final BankTransferInfo info;

  @override
  State<TopupConfirmScreen> createState() => _TopupConfirmScreenState();
}

class _TopupConfirmScreenState extends State<TopupConfirmScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    final WalletWrites? writes = widget.source.writes;
    if (writes == null) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final TopupRequest created = await writes.createTopup(widget.amount);
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(created);
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = error is WalletFailure ? error.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    final BankTransferInfo info = widget.info;
    return _page(source, 'Xác nhận nạp tiền', <Widget>[
      N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Thông tin giao dịch', style: N11Text.h2),
            const SizedBox(height: N11Space.gap2),
            _KV('Số tiền nạp', formatWalletVnd(widget.amount), valueKey: const Key('confirm-amount')),
            _KV('Ngân hàng', info.bankName),
            _KV('Số tài khoản nhận', info.accountNumber),
            if (info.content != null) _KV('Nội dung', info.content!),
          ],
        ),
      ),
      const Text('Ảnh chuyển khoản (tùy chọn)', style: N11Text.label),
      Container(
        key: const Key('topup-proof-slot'),
        height: 96,
        decoration: BoxDecoration(color: N11Colors.disabledBg, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusControl)),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(Icons.add_photo_alternate_outlined, color: N11Colors.disabledInk),
            SizedBox(height: 4),
            Text('Thêm ảnh', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.disabledInk)),
          ],
        ),
      ),
      const ReasonNote('Đính kèm ảnh chưa dùng được ở giai đoạn giao diện; bạn vẫn gửi được yêu cầu không kèm ảnh.'),
      const N11Banner(
        key: Key('topup-confirm-notice'),
        kind: BannerKind.info,
        title: 'Tiền chưa được cộng ngay',
        text: 'Hệ thống chỉ cộng tiền vào ví sau khi Admin kiểm tra và xác nhận giao dịch ngân hàng.',
      ),
      if (_error != null) N11Banner(key: const Key('topup-submit-error'), kind: BannerKind.error, title: 'Chưa gửi được', text: _error),
      N11Button(key: const Key('topup-submit'), label: 'Gửi yêu cầu', loading: _busy, onPressed: source.canWrite ? _submit : null),
      if (!source.canWrite) ReasonNote(source.notWiredReason),
    ]);
  }
}

// ---- status card (S04 / S06) -----------------------------------------------------------------------------------------

enum _Tone { warn, ok, bad, neutral }

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.icon, required this.tone, required this.title, required this.text});

  final IconData icon;
  final _Tone tone;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final (Color background, Color border, Color ink) = switch (tone) {
      _Tone.warn => (N11Colors.yellowFaint, N11Colors.yellow, N11Colors.chipWarnInk),
      _Tone.ok => (N11Colors.successSoft, N11Colors.successBorder, N11Colors.successInk),
      _Tone.bad => (N11Colors.errorSoft, N11Colors.errorBorder, N11Colors.errorInk),
      _Tone.neutral => (N11Colors.chipSoon, N11Colors.line, N11Colors.ink2),
    };
    return Container(
      key: const Key('status-card'),
      padding: const EdgeInsets.all(N11Space.gap4),
      decoration: BoxDecoration(color: background, border: Border.all(color: border), borderRadius: BorderRadius.circular(kRadiusCard)),
      child: Column(
        children: <Widget>[
          Icon(icon, size: 36, color: ink),
          const SizedBox(height: N11Space.gap2),
          Text(title, key: const Key('status-label'), textAlign: TextAlign.center, style: TextStyle(fontSize: 18, height: 1.3, fontWeight: FontWeight.w800, color: ink)),
          const SizedBox(height: 4),
          Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w500, color: N11Colors.ink2)),
        ],
      ),
    );
  }
}

// ---- M04-S04: Chi tiết yêu cầu nạp ------------------------------------------------------------------------------------

class TopupDetailScreen extends StatefulWidget {
  const TopupDetailScreen({super.key, required this.source, required this.code});

  final WalletSource source;
  final String code;

  @override
  State<TopupDetailScreen> createState() => _TopupDetailScreenState();
}

class _TopupDetailScreenState extends State<TopupDetailScreen> {
  int _rev = 0;
  bool _busy = false;
  String? _error;

  Future<void> _cancel() async {
    final WalletWrites? writes = widget.source.writes;
    if (writes == null) {
      return;
    }
    final bool yes = await _confirm(context, title: 'Hủy yêu cầu nạp?', text: 'Yêu cầu nạp tiền sẽ bị hủy. Bạn có thể tạo yêu cầu mới sau.');
    if (!yes || !mounted) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await writes.cancelTopup(widget.code);
    } catch (error) {
      _error = error is WalletFailure ? error.message : 'Chưa hủy được yêu cầu. Vui lòng thử lại.';
    }
    if (mounted) {
      setState(() {
        _busy = false;
        _rev++;
      });
    }
  }

  (IconData, _Tone, String) _look(TopupRequest r) => switch (r.status) {
        TopupStatus.pending => (Icons.hourglass_top, _Tone.warn, 'Bạn đã gửi yêu cầu nạp ${formatWalletVnd(r.amount)}. Admin sẽ kiểm tra và cộng tiền vào ví sau khi xác minh giao dịch ngân hàng.'),
        TopupStatus.confirmed => (Icons.check_circle_outline, _Tone.ok, 'Admin đã xác nhận. Số tiền thực nhận đã được ghi vào ví.'),
        TopupStatus.rejected => (Icons.cancel_outlined, _Tone.bad, 'Admin đã từ chối yêu cầu này. Ví không thay đổi.'),
        TopupStatus.cancelled => (Icons.block, _Tone.neutral, 'Yêu cầu đã được hủy. Ví không thay đổi.'),
      };

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    return _page(source, 'Chi tiết yêu cầu nạp', <Widget>[
      WalletLoader<TopupRequest>(
        key: ValueKey<String>('topup-${widget.code}-$_rev'),
        load: () => source.topup(widget.code),
        builder: (TopupRequest r) {
          final (IconData icon, _Tone tone, String text) = _look(r);
          return vstack(<Widget>[
            _StatusCard(icon: icon, tone: tone, title: topupStatusLabel(r.status), text: text),
            N11Card(
              child: Column(
                children: <Widget>[
                  _KV('Mã yêu cầu', r.shownCode, valueKey: const Key('topup-code')),
                  _KV('Số tiền', formatWalletVnd(r.amount)),
                  _KV('Thời gian', formatWalletTime(r.createdAt)),
                  _KV('Trạng thái', topupStatusLabel(r.status)),
                ],
              ),
            ),
            if (source is HttpWalletSource) N11Button(label: 'Trao đổi với quản trị', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).push(n11Route(FinanceRequestsScreen(session: source.session, requestId: r.code)))),
            if (_error != null) N11Banner(kind: BannerKind.error, title: 'Chưa hủy được', text: _error),
            if (r.canCancel) N11Button(key: const Key('topup-cancel'), label: 'Hủy yêu cầu', kind: ButtonKind.secondary, loading: _busy, onPressed: source.canWrite ? _cancel : null),
            if (r.canCancel && !source.canWrite) ReasonNote(source.notWiredReason),
          ]);
        },
      ),
    ]);
  }
}

// ---- M04-S05: Rút tiền -----------------------------------------------------------------------------------------------

class WithdrawScreen extends StatefulWidget {
  const WithdrawScreen({super.key, required this.source, this.minWithdraw, this.closing = false});

  final WalletSource source;
  final int? minWithdraw;
  final bool closing;

  @override
  State<WithdrawScreen> createState() => _WithdrawScreenState();
}

class _WithdrawScreenState extends State<WithdrawScreen> {
  final TextEditingController _amount = TextEditingController();
  WalletLoad<Wallet> _wallet = WalletLoading<Wallet>();
  WalletLoad<ReceivingAccount> _account = WalletLoading<ReceivingAccount>();
  bool _busy = false;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    WalletLoad<Wallet> wallet;
    WalletLoad<ReceivingAccount> account;
    try {
      wallet = await widget.source.wallet();
    } catch (_) {
      wallet = WalletFailed<Wallet>('Không đọc được số dư. Vui lòng thử lại.');
    }
    try {
      account = await widget.source.bankAccount();
    } catch (_) {
      account = WalletFailed<ReceivingAccount>('Không đọc được tài khoản nhận tiền. Vui lòng thử lại.');
    }
    if (mounted) {
      setState(() {
        _wallet = wallet;
      if (widget.closing && wallet is WalletReady<Wallet>) _amount.text = wallet.value.available.toString();
        _account = account;
      });
    }
  }

  void _retry() {
    setState(() {
      _wallet = WalletLoading<Wallet>();
      _account = WalletLoading<ReceivingAccount>();
    });
    _fetch();
  }

  int? get _available {
    final WalletLoad<Wallet> w = _wallet;
    return w is WalletReady<Wallet> ? w.value.available : null;
  }

  int get _min => widget.closing ? 1 : (widget.minWithdraw ?? widget.source.minWithdraw);

  /// Live message under the field; null when the amount is empty or acceptable.
  String? get _problem {
    final int? value = parseVndInput(_amount.text);
    final int? available = _available;
    if (_amount.text.trim().isEmpty) {
      return null;
    }
    if (value == null || value < _min) {
      return 'Số tiền rút tối thiểu ${formatWalletVnd(_min)}.';
    }
    if (available != null && value > available) {
      return 'Số dư khả dụng không đủ.';
    }
    return null;
  }

  bool get _canSubmit {
    return widget.source.canWrite && _account is WalletReady<ReceivingAccount> && _available != null && !_busy;
  }

  Future<void> _submit() async {
    final WalletWrites? writes = widget.source.writes;
    final int? value = parseVndInput(_amount.text);
    if (writes == null || value == null || _problem != null) {
      return;
    }
    setState(() {
      _busy = true;
      _submitError = null;
    });
    try {
      final WithdrawalRequest created = await writes.createWithdrawal(widget.closing ? _available! : value);
      if (!mounted) {
        return;
      }
      await Navigator.of(context).pushReplacement(n11Route(WithdrawDetailScreen(source: widget.source, code: created.code)));
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _submitError = error is WalletFailure ? error.message : 'Chưa gửi được yêu cầu rút. Vui lòng thử lại.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    final WalletLoad<Wallet> wallet = _wallet;
    final WalletLoad<ReceivingAccount> account = _account;
    final String? problem = _problem;
    return _page(source, 'Rút tiền', <Widget>[
      if (wallet is WalletReady<Wallet>)
        Container(
          padding: const EdgeInsets.all(N11Space.gap4),
          decoration: BoxDecoration(color: N11Colors.yellowSoft, borderRadius: BorderRadius.circular(kRadiusCard)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Số dư khả dụng', style: N11Text.label),
              Text(formatWalletVnd(wallet.value.available), key: const Key('withdraw-available'), style: N11Text.title),
            ],
          ),
        )
      else
        walletStateView<Wallet>(wallet, retry: _retry) ?? const SizedBox.shrink(),
      N11Field(
        validator: (String value) => value.trim().isEmpty ? 'Nhập số tiền muốn rút.' : _problem,
        fieldKey: const Key('withdraw-amount'),
        label: widget.closing ? 'Rút toàn bộ số dư khả dụng' : 'Số tiền muốn rút',
        enabled: !widget.closing,
        controller: _amount,
        keyboard: TextInputType.number,
        placeholder: '100.000',
        maxLength: 12,
        suffix: const Padding(padding: EdgeInsets.only(right: 14), child: Center(widthFactor: 1, child: Text('đ', style: N11Text.bodyStrong))),
        tone: problem == null ? FieldTone.normal : FieldTone.error,
        hint: problem ?? 'Tối thiểu ${formatWalletVnd(_min)} mỗi lần rút',
        onChanged: () => setState(() {}),
      ),
      const Text('Tài khoản nhận tiền', style: N11Text.h2),
      if (account is WalletReady<ReceivingAccount>)
        N11Card(
          child: Column(
            key: const Key('withdraw-account-card'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _KV('Ngân hàng', account.value.bankName),
              _KV('Số tài khoản', account.value.maskedNumber),
              _KV('Chủ tài khoản', account.value.holder),
              const SizedBox(height: N11Space.gap2),
              const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.verified_outlined, size: 16, color: N11Colors.successInk),
                  SizedBox(width: N11Space.gap2),
                  Expanded(child: Text('Đây là tài khoản đã được xác minh.', key: Key('withdraw-verified-note'), style: N11Text.caption)),
                ],
              ),
            ],
          ),
        )
      else
        walletStateView<ReceivingAccount>(account, retry: _retry, keyPrefix: 'account', emptyIcon: Icons.account_balance_outlined, emptyTitle: 'Chưa có tài khoản nhận tiền', emptyText: 'Thêm tài khoản ngân hàng trong hồ sơ shipper trước khi rút tiền.') ?? const SizedBox.shrink(),
      if (_submitError != null) N11Banner(key: const Key('withdraw-submit-error'), kind: BannerKind.error, title: 'Chưa gửi được', text: _submitError),
      N11Button(key: const Key('withdraw-submit'), validate: true, label: 'Yêu cầu rút tiền', loading: _busy, onPressed: _canSubmit ? _submit : null),
      if (!source.canWrite) ReasonNote(source.notWiredReason),
    ]);
  }
}

// ---- M04-S06: Chi tiết yêu cầu rút ------------------------------------------------------------------------------------

enum _StepState { done, current, todo }

class WithdrawDetailScreen extends StatefulWidget {
  const WithdrawDetailScreen({super.key, required this.source, required this.code});

  final WalletSource source;
  final String code;

  @override
  State<WithdrawDetailScreen> createState() => _WithdrawDetailScreenState();
}

class _WithdrawDetailScreenState extends State<WithdrawDetailScreen> {
  int _rev = 0;
  bool _busy = false;
  String? _error;

  Future<void> _cancel() async {
    final WalletWrites? writes = widget.source.writes;
    if (writes == null) {
      return;
    }
    final bool yes = await _confirm(context, title: 'Hủy yêu cầu rút?', text: 'Yêu cầu rút tiền sẽ bị hủy và số tiền đang giữ được giải phóng.');
    if (!yes || !mounted) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await writes.cancelWithdrawal(widget.code);
    } catch (error) {
      _error = error is WalletFailure ? error.message : 'Chưa hủy được yêu cầu. Vui lòng thử lại.';
    }
    if (mounted) {
      setState(() {
        _busy = false;
        _rev++;
      });
    }
  }

  (IconData, _Tone, String) _look(WithdrawalRequest r) => switch (r.status) {
        WithdrawalStatus.pending => (Icons.hourglass_top, _Tone.warn, 'Yêu cầu đã được gửi. Admin sẽ chuyển tiền và xác nhận kết quả.'),
        WithdrawalStatus.processing => (Icons.sync, _Tone.warn, 'Admin đang xử lý yêu cầu rút tiền của bạn.'),
        WithdrawalStatus.needsReconcile => (Icons.report_problem_outlined, _Tone.bad, 'Chưa xác nhận được kết quả chuyển tiền. Số tiền vẫn được giữ và Admin sẽ đối soát.'),
        WithdrawalStatus.completed => (Icons.check_circle_outline, _Tone.ok, 'Admin đã chuyển tiền tới tài khoản nhận của bạn.'),
        WithdrawalStatus.cancelled => (Icons.block, _Tone.neutral, 'Yêu cầu đã được hủy. Số tiền đang giữ đã được giải phóng.'),
      };

  /// Progress Chờ xử lý -> Đang xử lý -> Hoàn thành. "Cần đối soát" and "Đã hủy" are shown as their own step, never hidden.
  List<(String, _StepState, String)> _steps(WithdrawalStatus s) {
    const String none = 'Chưa có thông tin';
    switch (s) {
      case WithdrawalStatus.pending:
        return <(String, _StepState, String)>[('Chờ xử lý', _StepState.current, 'Đang chờ Admin nhận xử lý'), ('Đang xử lý', _StepState.todo, none), ('Hoàn thành', _StepState.todo, none)];
      case WithdrawalStatus.processing:
        return <(String, _StepState, String)>[('Chờ xử lý', _StepState.done, 'Đã gửi yêu cầu'), ('Đang xử lý', _StepState.current, 'Admin đang chuyển tiền'), ('Hoàn thành', _StepState.todo, none)];
      case WithdrawalStatus.needsReconcile:
        return <(String, _StepState, String)>[('Chờ xử lý', _StepState.done, 'Đã gửi yêu cầu'), ('Đang xử lý', _StepState.done, 'Admin đã xử lý'), ('Cần đối soát', _StepState.current, 'Chưa biết kết quả chuyển tiền, tiền vẫn được giữ')];
      case WithdrawalStatus.completed:
        return <(String, _StepState, String)>[('Chờ xử lý', _StepState.done, 'Đã gửi yêu cầu'), ('Đang xử lý', _StepState.done, 'Admin đã xử lý'), ('Hoàn thành', _StepState.done, 'Đã chuyển tiền')];
      case WithdrawalStatus.cancelled:
        return <(String, _StepState, String)>[('Chờ xử lý', _StepState.done, 'Đã gửi yêu cầu'), ('Đã hủy', _StepState.current, 'Yêu cầu đã được hủy')];
    }
  }

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    return _page(source, 'Chi tiết yêu cầu rút', <Widget>[
      WalletLoader<WithdrawalRequest>(
        key: ValueKey<String>('withdraw-${widget.code}-$_rev'),
        load: () => source.withdrawal(widget.code),
        builder: (WithdrawalRequest r) {
          final (IconData icon, _Tone tone, String text) = _look(r);
          final List<(String, _StepState, String)> steps = _steps(r.status);
          return vstack(<Widget>[
            _StatusCard(icon: icon, tone: tone, title: withdrawalStatusLabel(r.status), text: text),
            N11Card(
              child: Column(
                children: <Widget>[
                  _KV('Mã yêu cầu', r.shownCode, valueKey: const Key('withdraw-code')),
                  _KV('Số tiền rút', formatWalletVnd(r.amount)),
                  _KV('Ngày tạo', formatWalletTime(r.createdAt)),
                  _KV('Tài khoản nhận', '${r.account.bankName}\n${r.account.maskedNumber}\n${r.account.holder}'),
                ],
              ),
            ),
            if (source is HttpWalletSource) N11Button(label: 'Trao đổi với quản trị', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).push(n11Route(FinanceRequestsScreen(session: source.session, requestId: r.code)))),
            if (_error != null) N11Banner(kind: BannerKind.error, title: 'Chưa hủy được', text: _error),
            if (r.canCancel) N11Button(key: const Key('withdraw-cancel'), label: 'Hủy yêu cầu', kind: ButtonKind.secondary, loading: _busy, onPressed: source.canWrite ? _cancel : null),
            if (r.canCancel && !source.canWrite) ReasonNote(source.notWiredReason),
            N11Card(
              child: Column(
                key: const Key('withdraw-progress'),
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (int i = 0; i < steps.length; i++) _StepRow(index: i, label: steps[i].$1, state: steps[i].$2, note: steps[i].$3, last: i == steps.length - 1, bad: r.status == WithdrawalStatus.needsReconcile && i == steps.length - 1),
                ],
              ),
            ),
          ]);
        },
      ),
    ]);
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.index, required this.label, required this.state, required this.note, required this.last, required this.bad});

  final int index;
  final String label;
  final _StepState state;
  final String note;
  final bool last;
  final bool bad;

  @override
  Widget build(BuildContext context) {
    final Color dot = switch (state) {
      _StepState.done => N11Colors.success,
      _StepState.current => bad ? N11Colors.error : N11Colors.yellowStrong,
      _StepState.todo => N11Colors.lineStrong,
    };
    return IntrinsicHeight(
      child: Row(
        key: Key('withdraw-step-$index'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SizedBox(
            width: 24,
            child: Column(
              children: <Widget>[
                const SizedBox(height: 4),
                Container(width: 14, height: 14, decoration: BoxDecoration(color: state == _StepState.todo ? N11Colors.white : dot, border: Border.all(color: dot, width: 2), shape: BoxShape.circle)),
                if (!last) Expanded(child: Container(width: 2, color: N11Colors.line)),
              ],
            ),
          ),
          const SizedBox(width: N11Space.gap2),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : N11Space.gap3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(label, style: TextStyle(fontSize: 14, height: 1.4, fontWeight: FontWeight.w700, color: state == _StepState.todo ? N11Colors.ink3 : (bad ? N11Colors.errorInk : N11Colors.black))),
                  Text(note, style: N11Text.caption),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- M04-S07: Lịch sử giao dịch --------------------------------------------------------------------------------------

class TxnHistoryScreen extends StatefulWidget {
  const TxnHistoryScreen({super.key, required this.source, this.initial = TxnFilter.all, this.minTopup, this.minWithdraw});

  final WalletSource source;
  final TxnFilter initial;
  final int? minTopup;
  final int? minWithdraw;

  @override
  State<TxnHistoryScreen> createState() => _TxnHistoryScreenState();
}

class _TxnHistoryScreenState extends State<TxnHistoryScreen> {
  late TxnFilter _filter = widget.initial;
  int _rev = 0;

  Future<void> _refresh() async {
    if (mounted) {
      setState(() => _rev++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final WalletSource source = widget.source;
    return _page(source, 'Lịch sử giao dịch', <Widget>[
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: <Widget>[
            for (final TxnFilter f in TxnFilter.values) ...<Widget>[
              _FilterChip(filter: f, selected: f == _filter, onTap: () => setState(() => _filter = f)),
              const SizedBox(width: N11Space.gap2),
            ],
          ],
        ),
      ),
      WalletLoader<List<WalletTxn>>(
        key: ValueKey<String>('history-${_filter.name}-$_rev'),
        load: () => source.txns(_filter),
        emptyTitle: 'Chưa có giao dịch',
        emptyText: _filter == TxnFilter.all ? 'Các giao dịch của ví sẽ hiển thị ở đây.' : 'Không có giao dịch thuộc nhóm "${txnFilterLabel(_filter)}".',
        builder: (List<WalletTxn> rows) => _HistoryRows(source: source, filter: _filter, first: rows, afterOpen: _refresh),
      ),
    ]);
  }
}

/// The loaded rows of one filter, and "Tải thêm" while the server has older ones: the whole history is reachable, page by page.
class _HistoryRows extends StatefulWidget {
  const _HistoryRows({required this.source, required this.filter, required this.first, required this.afterOpen});

  final WalletSource source;
  final TxnFilter filter;
  final List<WalletTxn> first;
  final Future<void> Function() afterOpen;

  @override
  State<_HistoryRows> createState() => _HistoryRowsState();
}

class _HistoryRowsState extends State<_HistoryRows> {
  late final List<WalletTxn> _rows = List<WalletTxn>.of(widget.first);
  bool _loading = false;
  String? _error;

  Future<void> _more() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final WalletLoad<List<WalletTxn>> result = await widget.source.moreTxns(widget.filter);
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = false;
      if (result is WalletReady<List<WalletTxn>>) {
        _rows.addAll(result.value);
      } else if (result is WalletFailed<List<WalletTxn>>) {
        _error = result.message;
      } else {
        _error = widget.source.notWiredReason;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _txnList(context, widget.source, _rows, widget.afterOpen),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text(_error!, key: const Key('txn-more-error'), style: const TextStyle(fontSize: 13, color: N11Colors.error))),
        if (widget.source.hasMoreTxns(widget.filter))
          Padding(
            padding: const EdgeInsets.only(top: N11Space.gap2),
            child: OutlinedButton(key: const Key('txn-more'), onPressed: _loading ? null : _more, child: Text(_loading ? 'Đang tải…' : 'Tải thêm')),
          ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.filter, required this.selected, required this.onTap});

  final TxnFilter filter;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: txnFilterLabel(filter),
      excludeSemantics: true,
      child: InkWell(
        key: Key('txn-filter-${filter.name}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(kRadiusPill),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kTapMin),
          child: Container(
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(color: selected ? N11Colors.yellow : N11Colors.white, border: Border.all(color: selected ? N11Colors.yellow : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusPill)),
            child: Text(txnFilterLabel(filter), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.black)),
          ),
        ),
      ),
    );
  }
}

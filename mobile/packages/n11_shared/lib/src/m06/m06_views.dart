import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../tokens.dart';
import '../wallet/wallet_models.dart';
import '../widgets/components.dart';
import 'm06_actions.dart';
import 'm06_models.dart';
import 'm06_sample.dart';
import 'm06_source.dart';

// M06 UI phase: the three phone screens approved on 16/10/2026 (docs/ui/M06-UI-Reference-2026-10-16.html, "Ứng dụng 11Food và 11Ship").
//   11Food  ShippingFeeScreen       "Phí giao hàng"      fee, distance and who pays, in the shop's call-a-Shipper flow
//   11Ship  OrderOfferScreen        "Đơn có thể nhận"    what a Shipper may see BEFORE accepting (no phone, no address, no map)
//   11Ship  BatchEvaluationScreen   "Đánh giá ghép đơn"  eligible / cannot batch, with the short reason
// The screens only DRAW what a source says. Calling a Shipper, accepting an order and delivering are M07's; maps and GPS are M14's: the buttons
// those would need stay disabled with their reason unless the owning module hands in the action. A fee that is not known reads "Chưa xác định
// phí", never 0đ. With no connected source (real builds) each screen shows what is missing and nothing else.

const String kFeeUnknownText = 'Chưa xác định phí';
const String kOutOfRangeText = 'Ngoài bảng giá';
const String kAgreementReason =
    'Việc gửi và trả lời đề xuất phí do M07 thực hiện; chưa sẵn sàng nên chưa gửi được.';
const String kFeeNotePrivacyHint = 'Không ghi số điện thoại hoặc địa chỉ chi tiết: shipper nhìn thấy ghi chú trước khi nhận đơn.';
const String kActionFailed = 'Chưa gửi được. Hãy thử lại.';
const String kContinueReason =
    'Việc tạo yêu cầu giao do M07 thực hiện; chưa sẵn sàng nên chưa tiếp tục được.';
const String kAcceptReason =
    'Việc nhận đơn do M07 thực hiện; chưa sẵn sàng nên chưa nhận được đơn.';

/// "Dữ liệu minh họa" banner of every screen fed by sample data.
class M06SampleBanner extends StatelessWidget {
  const M06SampleBanner({super.key});

  @override
  Widget build(BuildContext context) => const N11Banner(
        key: Key('m06-sample-banner'),
        kind: BannerKind.warn,
        title: kM06SampleLabel,
        text: 'Chỉ để xem giao diện. Không có đơn nào được tạo hay nhận.',
        icon: Icons.visibility_outlined,
      );
}

String _km(int meters) {
  final String value = (meters / 1000).toStringAsFixed(1).replaceAll('.', ',');
  return '${value.endsWith(',0') ? value.substring(0, value.length - 2) : value} km';
}

String _hm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String _minutes(int seconds) {
  final double m = seconds / 60;
  return m == m.roundToDouble()
      ? '${m.round()} phút'
      : '${m.toStringAsFixed(1).replaceAll('.', ',')} phút';
}

/// Loads one read and draws loading / not ready / failed itself; [builder] draws only a ready value. "Thử lại" reloads.
class M06Loader<T> extends StatefulWidget {
  const M06Loader(
      {super.key,
      required this.load,
      required this.builder,
      required this.keyPrefix});

  final Future<M06Load<T>> Function() load;
  final Widget Function(T value) builder;
  final String keyPrefix;

  @override
  State<M06Loader<T>> createState() => _M06LoaderState<T>();
}

class _M06LoaderState<T> extends State<M06Loader<T>> {
  M06Load<T> _state = M06Loading<T>();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    M06Load<T> result;
    try {
      result = await widget.load();
    } catch (_) {
      result = M06Failed<T>('Không đọc được dữ liệu. Vui lòng thử lại.');
    }
    if (!mounted) {
      return;
    }
    setState(() => _state = result);
  }

  void _retry() {
    setState(() => _state = M06Loading<T>());
    _fetch();
  }

  @override
  Widget build(BuildContext context) {
    final M06Load<T> state = _state;
    final String p = widget.keyPrefix;
    return switch (state) {
      M06Ready<T>() => widget.builder(state.value),
      M06Loading<T>() => Padding(
          key: Key('$p-loading'),
          padding: const EdgeInsets.all(N11Space.gap8),
          child: const Center(child: CircularProgressIndicator())),
      M06NotReady<T>() => N11Banner(
          key: Key('$p-not-ready'),
          kind: BannerKind.warn,
          title: 'Chưa sẵn sàng',
          text: state.reason,
          icon: Icons.lock_outline),
      M06Failed<T>() => N11Banner(
          key: Key('$p-failed'),
          kind: BannerKind.error,
          title: 'Chưa tải được dữ liệu',
          text: state.message,
          trailing: N11Button(
              key: Key('$p-retry'),
              label: 'Thử lại',
              compact: true,
              kind: ButtonKind.secondary,
              onPressed: _retry),
        ),
    };
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.valueKey});

  final String label;
  final String value;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(flex: 5, child: Text(label, style: N11Text.caption)),
            const SizedBox(width: N11Space.gap2),
            Expanded(
                flex: 5,
                child: Text(value,
                    key: valueKey,
                    textAlign: TextAlign.right,
                    style: N11Text.bodyStrong)),
          ],
        ),
      );
}

class _Point extends StatelessWidget {
  const _Point({required this.color, required this.title, required this.sub});

  final Color color;
  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Container(
                    width: 12,
                    height: 12,
                    decoration:
                        BoxDecoration(color: color, shape: BoxShape.circle))),
            const SizedBox(width: N11Space.gap3),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                  Text(title, style: N11Text.bodyStrong),
                  Text(sub, style: N11Text.caption)
                ])),
          ],
        ),
      );
}

Widget _page(String title, bool sample, List<Widget> children) =>
    N11FormScaffold(
        title: title,
        session: null,
        children: <Widget>[if (sample) const M06SampleBanner(), ...children]);

// ---- shared pieces of the fee agreement ----------------------------------------------------------------------------------

/// Whole VND typed by a person ("25000", "25.000"); null for anything else or above the technical limit (no silent clamp).
int? parseAgreedFee(String text) {
  final String cleaned = text.trim().replaceAll(RegExp(r'[.\s]'), '');
  if (!RegExp(r'^\d{1,8}$').hasMatch(cleaned)) {
    return null;
  }
  final int value = int.parse(cleaned);
  return value <= kAgreedFeeMax ? value : null;
}

/// A note that looks like it carries a phone number (8 or more digits once separators are removed): refused before it reaches a Shipper.
bool noteLooksLikePhone(String note) => RegExp(r'\+?\d{8,}').hasMatch(note.replaceAll(RegExp(r'[\s.\-()]'), ''));

String _payerText(FeePayer payer) => payer == FeePayer.customer ? 'Khách trả ship' : 'Quán trả ship';

String _amountOrUnknown(int? amount) => amount == null ? kFeeUnknownText : formatWalletVnd(amount);

({String label, ChipKind kind}) _stateChip(FeeAgreementView agreement) => switch (agreement.state) {
      AgreementState.proposed => (label: 'Đang chờ shipper', kind: ChipKind.warn),
      AgreementState.countered => (label: 'Shipper đề xuất mức khác', kind: ChipKind.warn),
      AgreementState.awaitingCustomer => (label: 'Chờ khách xác nhận', kind: ChipKind.warn),
      AgreementState.accepted => (label: 'Đã chốt phí', kind: ChipKind.ok),
      AgreementState.locked => (label: 'Phí đã khóa', kind: ChipKind.ok),
      AgreementState.declined => (label: 'Khách không đồng ý', kind: ChipKind.bad),
      AgreementState.expired => (label: 'Đề xuất hết hạn', kind: ChipKind.bad),
    };

/// The agreement as a card (used by both apps): status, payer, the amounts and the reason. Nothing that is not final is called "the fee".
class FeeAgreementCard extends StatelessWidget {
  const FeeAgreementCard({super.key, required this.agreement, this.forShipper = false});

  final FeeAgreementView agreement;

  /// The Shipper's view hides nothing more than the shop's, but words the status from their side.
  final bool forShipper;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = _stateChip(agreement);
    final bool awaitingCustomer = agreement.state == AgreementState.awaitingCustomer;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(children: <Widget>[const Expanded(child: Text('PHÍ THỎA THUẬN', style: N11Text.label)), Flexible(child: N11Chip(chip.label, key: const Key('m06-agreement-chip'), kind: chip.kind))]),
          const SizedBox(height: N11Space.gap2),
          _Row('Người trả phí', _payerText(agreement.payer), valueKey: const Key('m06-agreement-payer')),
          if (agreement.baseFeeVnd != null) _Row('Phí theo bảng giá', formatWalletVnd(agreement.baseFeeVnd!), valueKey: const Key('m06-agreement-base')),
          if (agreement.reason != null) _Row('Lý do', feeReasonText(agreement.reason!), valueKey: const Key('m06-agreement-reason')),
          if (agreement.reasonNote != null && agreement.reasonNote!.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(agreement.reasonNote!, key: const Key('m06-agreement-note'), style: N11Text.caption)),
          if (agreement.proposedFeeVnd != null) _Row('Mức đề xuất của quán', formatWalletVnd(agreement.proposedFeeVnd!), valueKey: const Key('m06-agreement-proposed')),
          if (agreement.counterFeeVnd != null) _Row(forShipper ? 'Mức bạn đề xuất' : 'Shipper đề xuất', formatWalletVnd(agreement.counterFeeVnd!), valueKey: const Key('m06-agreement-counter')),
          _Row('Phí chốt', agreement.finalFeeVnd == null ? 'Chưa chốt' : formatWalletVnd(agreement.finalFeeVnd!), valueKey: const Key('m06-agreement-final')),
          if (awaitingCustomer)
            const Text('Khách là người trả phí và mức này khác phí theo bảng giá: cần khách đồng ý trước khi chốt.', key: Key('m06-agreement-awaiting-customer'), style: N11Text.caption),
          if (agreement.expiresAt != null && (agreement.state == AgreementState.proposed || agreement.state == AgreementState.countered || awaitingCustomer))
            Padding(padding: const EdgeInsets.only(top: 4), child: Text('Hạn trả lời: ${_hm(agreement.expiresAt!)}', key: const Key('m06-agreement-deadline'), style: N11Text.caption)),
        ],
      ),
    );
  }
}

// ---- 11Food: Phí giao hàng -------------------------------------------------------------------------------------------

class ShippingFeeScreen extends StatefulWidget {
  const ShippingFeeScreen({super.key, required this.source, this.actions});

  final ShippingFeeSource source;

  /// Handed in by M07/M06 once the shop's call-a-Shipper flow is connected. Null (today): every button that would send something stays disabled
  /// with its reason, and the screen never creates a request, a fee or an agreement by itself.
  final ShopFeeActions? actions;

  @override
  State<ShippingFeeScreen> createState() => _ShippingFeeScreenState();
}

class _ShippingFeeScreenState extends State<ShippingFeeScreen> {
  FeePayer _payer = FeePayer.customer;
  FeeMode _mode = FeeMode.standard;
  FeeReason? _reason;
  final TextEditingController _amount = TextEditingController();
  final TextEditingController _note = TextEditingController();
  int _rev = 0;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _send(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      if (mounted) {
        setState(() => _rev++);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = kActionFailed);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _page('Phí giao hàng', widget.source.isSample, <Widget>[
      M06Loader<ShippingFeeView>(
        key: ValueKey<int>(_rev),
        keyPrefix: 'm06-fee',
        load: widget.source.fee,
        builder: (ShippingFeeView fee) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('THÔNG TIN GIAO HÀNG', style: N11Text.label),
            const SizedBox(height: N11Space.gap2),
            N11Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _Point(color: N11Colors.yellow, title: 'Điểm lấy', sub: fee.pickupConfirmed ? 'Tọa độ quán đã xác nhận' : 'Chưa có tọa độ quán'),
                  _Point(color: N11Colors.black, title: 'Điểm giao', sub: fee.dropoffChosen ? 'Khách đã chọn vị trí giao' : 'Chưa có vị trí giao (mới có mô tả địa chỉ)'),
                  const Divider(height: N11Space.gap6, color: N11Colors.line),
                  _Row('Đường giao dự kiến', fee.distanceMeters == null ? 'Chưa có' : _km(fee.distanceMeters!), valueKey: const Key('m06-fee-distance')),
                  _Row('Phí theo bảng giá', fee.feeKnown ? formatWalletVnd(fee.feeVnd!) : (fee.outOfPriceRange ? kOutOfRangeText : kFeeUnknownText), valueKey: const Key('m06-fee-amount')),
                ],
              ),
            ),
            if (fee.outOfPriceRange) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const Text('Quãng đường vượt mốc cuối của bảng giá: phí chưa xác định (không phải 0đ), không tự cộng thêm. Chỉ đi tiếp khi quán và shipper thỏa thuận một mức phí.', key: Key('m06-fee-out-of-range-note'), style: N11Text.caption),
            ] else if (!fee.feeKnown) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const Text('Đơn chưa có vị trí giao hoặc chưa có tuyến: hiển thị “Chưa xác định phí”, không tự coi là 0đ. Việc tạo yêu cầu giao vẫn không bị chặn vì địa chỉ chỉ có mô tả.', key: Key('m06-fee-unknown-note'), style: N11Text.caption),
            ],
            const SizedBox(height: N11Space.gap3),
            const Text('NGƯỜI TRẢ PHÍ', style: N11Text.label),
            const SizedBox(height: N11Space.gap2),
            N11ChoiceCard(key: const Key('m06-payer-customer'), title: 'Khách trả ship', selected: _payer == FeePayer.customer, onTap: () => setState(() => _payer = FeePayer.customer)),
            const SizedBox(height: N11Space.gap2),
            N11ChoiceCard(key: const Key('m06-payer-shop'), title: 'Quán trả ship', selected: _payer == FeePayer.shop, onTap: () => setState(() => _payer = FeePayer.shop)),
            const SizedBox(height: N11Space.gap3),
            ..._agreementSection(fee),
          ],
        ),
      ),
    ]);
  }

  List<Widget> _agreementSection(ShippingFeeView fee) {
    final FeeAgreementView? agreement = fee.agreement;
    if (agreement != null) {
      return <Widget>[
        FeeAgreementCard(agreement: agreement),
        if (agreement.state == AgreementState.countered && agreement.counterFeeVnd != null) ...<Widget>[
          const SizedBox(height: N11Space.gap3),
          Row(
            children: <Widget>[
              Expanded(child: N11Button(key: const Key('m06-counter-accept'), label: 'Đồng ý', loading: _busy, onPressed: widget.actions == null || _busy ? null : () => _send(widget.actions!.acceptCounter))),
              const SizedBox(width: N11Space.gap3),
              Expanded(child: N11Button(key: const Key('m06-counter-reject'), label: 'Từ chối', kind: ButtonKind.secondary, onPressed: widget.actions == null || _busy ? null : () => _send(widget.actions!.rejectCounter))),
            ],
          ),
          const SizedBox(height: N11Space.gap2),
          const Text('Từ chối: giữ mức đề xuất ban đầu và tiếp tục tìm shipper khác; thời gian tìm shipper không bị tính lại.', key: Key('m06-counter-reject-note'), style: N11Text.caption),
          if (widget.actions == null) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote(kAgreementReason)),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text(_error!, key: const Key('m06-agreement-error'), style: N11Text.caption)),
      ];
    }
    final bool standardAvailable = fee.feeKnown;
    final FeeMode mode = standardAvailable ? _mode : FeeMode.agreed;
    final int? amount = parseAgreedFee(_amount.text);
    final String note = _note.text.trim();
    final String? amountError = _amount.text.trim().isEmpty ? null : (amount == null ? 'Nhập số tiền nguyên (đ), tối đa ${formatWalletVnd(kAgreedFeeMax)}.' : null);
    final String? noteError = noteLooksLikePhone(note) ? 'Ghi chú có vẻ chứa số điện thoại. $kFeeNotePrivacyHint' : null;
    final bool agreedReady = _reason != null && amount != null && noteError == null && (_reason != FeeReason.other || note.isNotEmpty);
    final VoidCallback? submit = widget.actions == null || _busy
        ? null
        : mode == FeeMode.standard
            ? () => _send(() => widget.actions!.useStandard(_payer))
            : () { if (agreedReady) _send(() => widget.actions!.propose(payer: _payer, reason: _reason!, note: note.isEmpty ? null : note, amountVnd: amount)); };
    return <Widget>[
      const Text('CÁCH TÍNH PHÍ', style: N11Text.label),
      const SizedBox(height: N11Space.gap2),
      N11ChoiceCard(
        key: const Key('m06-mode-standard'),
        title: 'Theo bảng giá',
        text: standardAvailable ? formatWalletVnd(fee.feeVnd!) : (fee.outOfPriceRange ? '$kOutOfRangeText: chưa dùng được' : '$kFeeUnknownText: chưa dùng được'),
        selected: mode == FeeMode.standard,
        onTap: standardAvailable ? () => setState(() => _mode = FeeMode.standard) : null,
      ),
      const SizedBox(height: N11Space.gap2),
      N11ChoiceCard(
        key: const Key('m06-mode-agreed'),
        title: 'Thỏa thuận',
        text: 'Mức do quán đề xuất; shipper đồng ý hoặc đề xuất mức khác. Có thể cao hoặc thấp hơn phí theo bảng giá.',
        selected: mode == FeeMode.agreed,
        onTap: () => setState(() => _mode = FeeMode.agreed),
      ),
      if (mode == FeeMode.agreed) ...<Widget>[
        const SizedBox(height: N11Space.gap3),
        const Text('LÝ DO THỎA THUẬN', style: N11Text.label),
        const SizedBox(height: N11Space.gap2),
        FormField<FeeReason>(autovalidateMode: AutovalidateMode.onUserInteraction, validator: (_) => _reason == null ? 'Chọn lý do thỏa thuận phí.' : null, builder: (FormFieldState<FeeReason> field) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[Wrap(
          spacing: N11Space.gap2,
          runSpacing: N11Space.gap2,
          children: <Widget>[
            for (final FeeReason reason in FeeReason.values)
              ChoiceChip(key: Key('m06-reason-${reason.name}'), label: Text(feeReasonText(reason)), selected: _reason == reason, onSelected: (bool _) => setState(() => _reason = reason)),
          ],
        ), if (field.errorText != null) Text(field.errorText!, style: const TextStyle(color: N11Colors.error))])),
        const SizedBox(height: N11Space.gap3),
        N11Field(
          validator: (String value) => parseAgreedFee(value) == null ? 'Nhập mức phí là số nguyên từ 0 đến 10.000.000đ.' : null,
          fieldKey: const Key('m06-agreed-amount'),
          label: 'Mức phí đề xuất (đ)',
          controller: _amount,
          keyboard: TextInputType.number,
          maxLength: 11,
          hint: amountError,
          tone: amountError == null ? FieldTone.normal : FieldTone.error,
          onChanged: () => setState(() {}),
        ),
        const SizedBox(height: N11Space.gap2),
        N11Field(
          validator: (String value) => noteError ?? (_reason == FeeReason.other && value.trim().isEmpty ? 'Lý do Khác cần có ghi chú.' : null),
          fieldKey: const Key('m06-agreed-note'),
          label: 'Ghi chú cho shipper',
          controller: _note,
          maxLength: 200,
          optionalLabel: _reason != FeeReason.other,
          hint: noteError ?? kFeeNotePrivacyHint,
          tone: noteError == null ? FieldTone.normal : FieldTone.error,
          onChanged: () => setState(() {}),
        ),
        if (_payer == FeePayer.customer)
          const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: Text('Khách là người trả phí: nếu mức này khác phí theo bảng giá, khách phải đồng ý trước khi chốt.', key: Key('m06-customer-consent-note'), style: N11Text.caption)),
      ],
      const SizedBox(height: N11Space.gap4),
      if (widget.actions == null)
        const GatedButton(label: 'Gửi yêu cầu giao', reason: kAgreementReason)
      else
        N11Button(key: const Key('m06-fee-submit'), validate: true, label: mode == FeeMode.standard ? 'Dùng phí theo bảng giá' : 'Gửi đề xuất phí', loading: _busy, onPressed: submit),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text(_error!, key: const Key('m06-agreement-error'), style: N11Text.caption)),
    ];
  }
}

// ---- 11Ship: Đơn có thể nhận ----------------------------------------------------------------------------------------

class OrderOfferScreen extends StatefulWidget {
  const OrderOfferScreen({super.key, required this.source, this.onAccept, this.actions});

  final OrderOfferSource source;

  /// Handed in by M07 once acceptance exists. Null (today): "Nhận đơn" stays disabled with its reason. The screen never accepts by itself, and
  /// a preview of "eligible" is not an acceptance: M07 checks again when it commits.
  final VoidCallback? onAccept;

  /// Handed in once the fee agreement is connected: agree, skip or counter-offer a proposed fee. Null: those buttons stay disabled with their reason.
  final ShipperFeeActions? actions;

  @override
  State<OrderOfferScreen> createState() => _OrderOfferScreenState();
}

class _OrderOfferScreenState extends State<OrderOfferScreen> {
  final TextEditingController _counter = TextEditingController();
  int _rev = 0;
  bool _busy = false;
  bool _countering = false;
  String? _error;

  @override
  void dispose() {
    _counter.dispose();
    super.dispose();
  }

  Future<void> _send(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      if (mounted) {
        setState(() {
          _rev++;
          _countering = false;
          _counter.clear();
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = kActionFailed);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _page('Đơn có thể nhận', widget.source.isSample, <Widget>[
      M06Loader<OrderOfferView>(
        key: ValueKey<int>(_rev),
        keyPrefix: 'm06-offer',
        load: widget.source.offer,
        builder: (OrderOfferView offer) {
          final FeeAgreementView? agreement = offer.agreement;
          final bool agreed = agreement != null && agreement.mode == FeeMode.agreed;
          final bool canAccept = widget.onAccept != null && offer.eligibility.eligible && (!agreed || agreement.state == AgreementState.accepted);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    _Row('Mã đơn', offer.orderRef),
                    const SizedBox(height: N11Space.gap2),
                    const Text('THÔNG TIN TRƯỚC NHẬN', style: N11Text.label),
                    _Point(color: N11Colors.yellow, title: 'Điểm lấy: ${offer.shopName}', sub: offer.pickupArea),
                    _Point(color: N11Colors.black, title: 'Điểm giao', sub: '${offer.dropoffArea} (chưa mở địa chỉ chi tiết)'),
                    const Divider(height: N11Space.gap6, color: N11Colors.line),
                    _Row('Cách quán', offer.distanceToShopMeters == null ? 'Chưa có' : _km(offer.distanceToShopMeters!), valueKey: const Key('m06-offer-distance')),
                    _Row('Tiền hàng', offer.goodsVnd == null ? 'Chưa có' : formatWalletVnd(offer.goodsVnd!), valueKey: const Key('m06-offer-goods')),
                    _Row('Phí ship', agreed ? _agreedFeeText(agreement) : _amountOrUnknown(offer.shipFeeVnd), valueKey: const Key('m06-offer-fee')),
                  ],
                ),
              ),
              if (agreed) ...<Widget>[const SizedBox(height: N11Space.gap3), FeeAgreementCard(agreement: agreement, forShipper: true)],
              const SizedBox(height: N11Space.gap3),
              _EligibilityBanner(offer.eligibility, keyPrefix: 'm06-offer'),
              const SizedBox(height: N11Space.gap3),
              const N11Banner(kind: BannerKind.info, title: 'Quyền riêng tư', text: 'Không hiển thị số điện thoại khách, địa chỉ chi tiết hoặc bản đồ theo dõi trước khi nhận.', icon: Icons.privacy_tip_outlined),
              const SizedBox(height: N11Space.gap4),
              if (agreed && agreement.state == AgreementState.proposed) ..._shipperAnswers(offer, agreement),
              if (agreed && agreement.state == AgreementState.countered) const N11Banner(key: Key('m06-offer-waiting-shop'), kind: BannerKind.info, title: 'Đang chờ quán phản hồi', text: 'Quán sẽ đồng ý hoặc từ chối mức bạn đề xuất. Nếu từ chối, giữ mức ban đầu của quán.', icon: Icons.hourglass_bottom),
              if (agreed && agreement.state == AgreementState.awaitingCustomer) const N11Banner(key: Key('m06-offer-waiting-customer'), kind: BannerKind.info, title: 'Đang chờ khách xác nhận phí', icon: Icons.hourglass_bottom),
              if (_error != null) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap2), child: Text(_error!, key: const Key('m06-agreement-error'), style: N11Text.caption)),
              if (!agreed || agreement.state == AgreementState.accepted || agreement.state == AgreementState.locked) ...<Widget>[
                if (widget.onAccept == null) const GatedButton(label: 'Nhận đơn', reason: kAcceptReason) else N11Button(key: const Key('m06-offer-accept'), label: 'Nhận đơn', onPressed: canAccept ? widget.onAccept : null),
              ] else if (widget.onAccept == null)
                const ReasonNote(kAcceptReason),
            ],
          );
        },
      ),
    ]);
  }

  String _agreedFeeText(FeeAgreementView agreement) => agreement.finalFeeVnd != null
      ? formatWalletVnd(agreement.finalFeeVnd!)
      : agreement.proposedFeeVnd == null
          ? kFeeUnknownText
          : '${formatWalletVnd(agreement.proposedFeeVnd!)} (đề xuất)';

  List<Widget> _shipperAnswers(OrderOfferView offer, FeeAgreementView agreement) {
    final ShipperFeeActions? actions = widget.actions;
    final int? counter = parseAgreedFee(_counter.text);
    final String? counterError = _counter.text.trim().isEmpty
        ? null
        : counter == null
            ? 'Nhập số tiền nguyên (đ), tối đa ${formatWalletVnd(kAgreedFeeMax)}.'
            : counter == agreement.proposedFeeVnd
                ? 'Mức này giống mức quán đề xuất. Hãy chọn “Đồng ý”.'
                : null;
    return <Widget>[
      N11Button(key: const Key('m06-fee-agree'), label: 'Đồng ý mức phí', loading: _busy, onPressed: actions == null || _busy ? null : () => _send(actions.agree)),
      const SizedBox(height: N11Space.gap2),
      Row(
        children: <Widget>[
          Expanded(child: N11Button(key: const Key('m06-fee-skip'), label: 'Bỏ qua', kind: ButtonKind.secondary, onPressed: actions == null || _busy ? null : () => _send(actions.skip))),
          const SizedBox(width: N11Space.gap3),
          Expanded(child: N11Button(key: const Key('m06-fee-counter-open'), label: 'Đề xuất mức khác', kind: ButtonKind.secondary, onPressed: actions == null || _busy ? null : () => setState(() => _countering = !_countering))),
        ],
      ),
      if (_countering && actions != null) ...<Widget>[
        const SizedBox(height: N11Space.gap3),
        N11Field(validator: (String value) => parseAgreedFee(value) == null ? 'Nhập mức phí là số nguyên từ 0 đến 10.000.000đ.' : counterError, fieldKey: const Key('m06-counter-amount'), label: 'Mức phí bạn đề xuất (đ)', controller: _counter, keyboard: TextInputType.number, maxLength: 11, hint: counterError, tone: counterError == null ? FieldTone.normal : FieldTone.error, onChanged: () => setState(() {})),
        const SizedBox(height: N11Space.gap2),
        N11Button(key: const Key('m06-counter-send'), validate: true, label: 'Gửi đề xuất', loading: _busy, onPressed: _busy ? null : () { if (counter != null && counterError == null) _send(() => actions.counter(counter)); }),
      ],
      if (actions == null) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote(kAgreementReason)),
      const SizedBox(height: N11Space.gap3),
    ];
  }
}

class _EligibilityBanner extends StatelessWidget {
  const _EligibilityBanner(this.eligibility, {required this.keyPrefix});

  final EligibilityView eligibility;
  final String keyPrefix;

  @override
  Widget build(BuildContext context) {
    if (eligibility.eligible) {
      return N11Banner(key: Key('$keyPrefix-eligible'), kind: BannerKind.success, title: 'Đủ điều kiện nhận đơn');
    }
    final List<String> reasons = eligibility.reasonCodes.isEmpty ? <String>['UNKNOWN'] : eligibility.reasonCodes;
    return N11Banner(key: Key('$keyPrefix-not-eligible'), kind: BannerKind.error, title: 'Chưa đủ điều kiện nhận đơn', text: reasons.map(m06ReasonText).join('\n'));
  }
}

// ---- 11Ship: Đánh giá ghép đơn --------------------------------------------------------------------------------------

class BatchEvaluationScreen extends StatelessWidget {
  const BatchEvaluationScreen({super.key, required this.source});

  final BatchEvaluationSource source;

  @override
  Widget build(BuildContext context) {
    return _page('Đánh giá ghép đơn', source.isSample, <Widget>[
      M06Loader<BatchEvaluationView>(
        keyPrefix: 'm06-batch',
        load: source.evaluation,
        builder: (BatchEvaluationView view) {
          final BatchAttempt? blocked = view.attempts
              .cast<BatchAttempt?>()
              .firstWhere((BatchAttempt? a) => a != null && !a.ok,
                  orElse: () => null);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    _Row('Đơn A đang thực hiện', view.orderRef),
                    _Row('ETA gốc của A', _hm(view.originalEta),
                        valueKey: const Key('m06-batch-original-eta')),
                    _Row('Chậm thêm tối đa', _minutes(view.maxDelaySeconds)),
                  ],
                ),
              ),
              for (int i = 0; i < view.attempts.length; i++) ...<Widget>[
                const SizedBox(height: N11Space.gap3),
                _AttemptCard(
                    key: Key('m06-batch-attempt-$i'),
                    attempt: view.attempts[i],
                    maxDelaySeconds: view.maxDelaySeconds),
              ],
              const SizedBox(height: N11Space.gap3),
              const N11Banner(
                  kind: BannerKind.info,
                  title: 'Chỉ là kết quả đánh giá',
                  text:
                      'M07 phải kiểm tra lại trước khi xác nhận nhận đơn. Bạn vẫn tự chọn thứ tự giao.',
                  icon: Icons.info_outline),
              const SizedBox(height: N11Space.gap4),
              // Never an accept action: acceptance is M07's. The label follows the evaluation.
              N11Button(
                  key: const Key('m06-batch-action'),
                  label: blocked == null
                      ? 'Nhận đơn do M07 thực hiện'
                      : 'Không thể nhận ${blocked.label}',
                  kind: ButtonKind.secondary),
              if (blocked == null)
                const Padding(
                    padding: EdgeInsets.only(top: N11Space.gap2),
                    child: ReasonNote(kAcceptReason)),
            ],
          );
        },
      ),
    ]);
  }
}

class _AttemptCard extends StatelessWidget {
  const _AttemptCard(
      {super.key, required this.attempt, required this.maxDelaySeconds});

  final BatchAttempt attempt;
  final int maxDelaySeconds;

  @override
  Widget build(BuildContext context) {
    final bool ok = attempt.ok;
    final String title =
        '${ok ? '✓' : '✕'} Thử ghép ${attempt.label} — ${ok ? 'Đạt' : 'Không đạt'}';
    final String detail = attempt.addedDelaySeconds == null
        ? (attempt.reasonCode == null
            ? 'Chưa đánh giá được.'
            : m06ReasonText(attempt.reasonCode!))
        : ok
            ? 'Chậm thêm ${_minutes(attempt.addedDelaySeconds!)} so với ETA gốc.'
            : 'Chậm cộng dồn ${_minutes(attempt.addedDelaySeconds!)}, vượt giới hạn ${_minutes(maxDelaySeconds)}.';
    return N11Banner(
      kind: ok ? BannerKind.success : BannerKind.error,
      title: title,
      text: <String>[
        if (attempt.etaAfter != null)
          'ETA của A sau ghép: ${_hm(attempt.etaAfter!)}',
        detail
      ].join('\n'),
      icon: ok ? Icons.check_circle_outline : Icons.cancel_outlined,
    );
  }
}

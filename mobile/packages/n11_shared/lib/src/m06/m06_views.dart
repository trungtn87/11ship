import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../tokens.dart';
import '../wallet/wallet_models.dart';
import '../widgets/components.dart';
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

// ---- 11Food: Phí giao hàng -------------------------------------------------------------------------------------------

class ShippingFeeScreen extends StatefulWidget {
  const ShippingFeeScreen({super.key, required this.source, this.onContinue});

  final ShippingFeeSource source;

  /// Handed in by M07 when its call-a-Shipper flow exists. Null (today): the button stays disabled with its reason.
  final void Function(FeePayer payer)? onContinue;

  @override
  State<ShippingFeeScreen> createState() => _ShippingFeeScreenState();
}

class _ShippingFeeScreenState extends State<ShippingFeeScreen> {
  FeePayer _payer = FeePayer.customer;

  @override
  Widget build(BuildContext context) {
    return _page('Phí giao hàng', widget.source.isSample, <Widget>[
      M06Loader<ShippingFeeView>(
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
                  _Point(
                      color: N11Colors.yellow,
                      title: 'Điểm lấy',
                      sub: fee.pickupConfirmed
                          ? 'Tọa độ quán đã xác nhận'
                          : 'Chưa có tọa độ quán'),
                  _Point(
                      color: N11Colors.black,
                      title: 'Điểm giao',
                      sub: fee.dropoffChosen
                          ? 'Khách đã chọn vị trí giao'
                          : 'Chưa có vị trí giao (mới có mô tả địa chỉ)'),
                  const Divider(height: N11Space.gap6, color: N11Colors.line),
                  _Row(
                      'Đường giao dự kiến',
                      fee.distanceMeters == null
                          ? 'Chưa có'
                          : _km(fee.distanceMeters!),
                      valueKey: const Key('m06-fee-distance')),
                  _Row(
                      'Phí theo bảng giá',
                      fee.feeKnown
                          ? formatWalletVnd(fee.feeVnd!)
                          : kFeeUnknownText,
                      valueKey: const Key('m06-fee-amount')),
                ],
              ),
            ),
            const SizedBox(height: N11Space.gap3),
            const Text('NGƯỜI TRẢ PHÍ', style: N11Text.label),
            const SizedBox(height: N11Space.gap2),
            N11ChoiceCard(
                key: const Key('m06-payer-customer'),
                title: 'Khách trả ship',
                selected: _payer == FeePayer.customer,
                onTap: () => setState(() => _payer = FeePayer.customer)),
            const SizedBox(height: N11Space.gap2),
            N11ChoiceCard(
                key: const Key('m06-payer-shop'),
                title: 'Quán trả ship',
                selected: _payer == FeePayer.shop,
                onTap: () => setState(() => _payer = FeePayer.shop)),
            const SizedBox(height: N11Space.gap3),
            const N11Banner(
                kind: BannerKind.info,
                title: 'Phí được tính theo bảng giá Admin đang áp dụng',
                text: 'Không phụ thuộc vị trí điện thoại của quán.',
                icon: Icons.info_outline),
            if (!fee.feeKnown) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const Text(
                  'Đơn chưa có vị trí giao hoặc chưa có tuyến: hiển thị “Chưa xác định phí”, không tự coi là 0đ. Việc tạo yêu cầu giao vẫn không bị chặn vì địa chỉ chỉ có mô tả.',
                  key: Key('m06-fee-unknown-note'),
                  style: N11Text.caption),
            ],
            const SizedBox(height: N11Space.gap4),
            if (widget.onContinue == null)
              const GatedButton(label: 'Tiếp tục', reason: kContinueReason)
            else
              N11Button(
                  key: const Key('m06-fee-continue'),
                  label: 'Tiếp tục',
                  onPressed: () => widget.onContinue!(_payer)),
          ],
        ),
      ),
    ]);
  }
}

// ---- 11Ship: Đơn có thể nhận ----------------------------------------------------------------------------------------

class OrderOfferScreen extends StatelessWidget {
  const OrderOfferScreen({super.key, required this.source, this.onAccept});

  final OrderOfferSource source;

  /// Handed in by M07 once acceptance exists. Null (today): "Nhận đơn" stays disabled with its reason. The screen never accepts by itself, and
  /// a preview of "eligible" is not an acceptance: M07 checks again when it commits.
  final VoidCallback? onAccept;

  @override
  Widget build(BuildContext context) {
    return _page('Đơn có thể nhận', source.isSample, <Widget>[
      M06Loader<OrderOfferView>(
        keyPrefix: 'm06-offer',
        load: source.offer,
        builder: (OrderOfferView offer) {
          final bool canAccept = onAccept != null && offer.eligibility.eligible;
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
                    _Point(
                        color: N11Colors.yellow,
                        title: 'Điểm lấy: ${offer.shopName}',
                        sub: offer.pickupArea),
                    _Point(
                        color: N11Colors.black,
                        title: 'Điểm giao',
                        sub: '${offer.dropoffArea} (chưa mở địa chỉ chi tiết)'),
                    const Divider(height: N11Space.gap6, color: N11Colors.line),
                    _Row(
                        'Cách quán',
                        offer.distanceToShopMeters == null
                            ? 'Chưa có'
                            : _km(offer.distanceToShopMeters!),
                        valueKey: const Key('m06-offer-distance')),
                    _Row(
                        'Tiền hàng',
                        offer.goodsVnd == null
                            ? 'Chưa có'
                            : formatWalletVnd(offer.goodsVnd!),
                        valueKey: const Key('m06-offer-goods')),
                    _Row(
                        'Phí ship',
                        offer.shipFeeVnd == null
                            ? kFeeUnknownText
                            : formatWalletVnd(offer.shipFeeVnd!),
                        valueKey: const Key('m06-offer-fee')),
                  ],
                ),
              ),
              const SizedBox(height: N11Space.gap3),
              _EligibilityBanner(offer.eligibility, keyPrefix: 'm06-offer'),
              const SizedBox(height: N11Space.gap3),
              const N11Banner(
                  kind: BannerKind.info,
                  title: 'Quyền riêng tư',
                  text:
                      'Không hiển thị số điện thoại khách, địa chỉ chi tiết hoặc bản đồ theo dõi trước khi nhận.',
                  icon: Icons.privacy_tip_outlined),
              const SizedBox(height: N11Space.gap4),
              if (onAccept == null)
                const GatedButton(label: 'Nhận đơn', reason: kAcceptReason)
              else
                N11Button(
                    key: const Key('m06-offer-accept'),
                    label: 'Nhận đơn',
                    onPressed: canAccept ? onAccept : null),
            ],
          );
        },
      ),
    ]);
  }
}

class _EligibilityBanner extends StatelessWidget {
  const _EligibilityBanner(this.eligibility, {required this.keyPrefix});

  final EligibilityView eligibility;
  final String keyPrefix;

  @override
  Widget build(BuildContext context) {
    if (eligibility.eligible) {
      return N11Banner(
          key: Key('$keyPrefix-eligible'),
          kind: BannerKind.success,
          title: 'Đủ điều kiện nhận đơn');
    }
    final List<String> reasons = eligibility.reasonCodes.isEmpty
        ? <String>['UNKNOWN']
        : eligibility.reasonCodes;
    return N11Banner(
        key: Key('$keyPrefix-not-eligible'),
        kind: BannerKind.error,
        title: 'Chưa đủ điều kiện nhận đơn',
        text: reasons.map(m06ReasonText).join('\n'));
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

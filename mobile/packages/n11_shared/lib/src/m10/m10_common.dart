import 'package:flutter/material.dart';

import '../m06/m06_models.dart';
import '../m06/m06_views.dart' show kFeeNotePrivacyHint, noteLooksLikePhone, parseAgreedFee;
import '../m07/m07_models.dart';
import '../m07/m07_widgets.dart';
import '../m02/route_distance.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm10_models.dart';
import 'm10_source.dart';

// Pieces both sides of M10 draw: the status chip, money rows (dishes and fee apart; an unknown fee never reads 0đ), the lines of an Order with the
// shop's changes next to the original, the timeline and the map card of the CURRENT delivery.

/// One wording for the reminders of the customer order flow (cart, checkout, order detail).
const String kFeeEstimateNote = 'Phí giao chỉ là tạm tính, có thể chưa phải giá chính thức.';
const String kScheduleNote = 'Giờ hẹn là thời gian mong muốn, món có thể đến sớm hoặc muộn hơn.';
const String kDirectPayNote = 'Bạn thanh toán trực tiếp cho quán hoặc shipper, không qua ứng dụng.';
const String kNoFeeNote = 'Chưa có phí giao nên chưa tính được tổng tiền.';
const String kM10SampleLabel = 'Dữ liệu minh họa';

/// "Chưa xác định phí" instead of a number when the fee is not known — never "0đ".
String m10Money(int amount) => m07Vnd(amount);

String m10Fee(int? amount) => amount == null ? kFeeUnknown : m07Vnd(amount);

const List<String> _weekday = <String>['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

String m10Day(DateTime t) {
  final DateTime l = t.toLocal();
  return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}';
}

String m10When(DateTime t) {
  final DateTime l = t.toLocal();
  return '${m07Hm(l)} · ${_weekday[l.weekday % 7]} ${m10Day(l)}';
}

({String label, ChipKind kind}) m10StatusChip(DisplayStatus s) => switch (s) {
      DisplayStatus.awaitingShop => (label: s.label, kind: ChipKind.warn),
      DisplayStatus.preparing || DisplayStatus.shipperComing => (label: s.label, kind: ChipKind.info),
      DisplayStatus.searchingShipper || DisplayStatus.delivering => (label: s.label, kind: ChipKind.yellow),
      DisplayStatus.completed => (label: s.label, kind: ChipKind.ok),
      DisplayStatus.searchStopped || DisplayStatus.deliveryFailed => (label: s.label, kind: ChipKind.bad),
      DisplayStatus.cancelledByCustomer || DisplayStatus.cancelledByShop || DisplayStatus.cancelledBySystem || DisplayStatus.rejected || DisplayStatus.notCompleted => (label: s.label, kind: ChipKind.neutral),
    };

/// Full-width order footer. Edit is on the left and destructive action on the
/// right. Callers supply only actions actually allowed by the current order.
class OrderActionsBar extends StatelessWidget {
  const OrderActionsBar({super.key, this.edit, this.destructive}) : assert(edit != null || destructive != null);

  final Widget? edit;
  final Widget? destructive;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: double.infinity,
        child: edit != null && destructive != null
            ? Row(children: <Widget>[
                Expanded(child: edit!),
                const SizedBox(width: N11Space.gap3),
                Expanded(child: destructive!),
              ])
            : Align(alignment: edit != null ? Alignment.centerLeft : Alignment.centerRight, child: edit ?? destructive),
      );
}

class OrderStatusChip extends StatelessWidget {
  const OrderStatusChip(this.status, {super.key});

  final DisplayStatus status;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) c = m10StatusChip(status);
    return N11Chip(c.label, kind: c.kind);
  }
}

/// "Dữ liệu minh họa" banner of every screen fed by sample data.
class M10SampleBanner extends StatelessWidget {
  const M10SampleBanner({super.key});

  @override
  Widget build(BuildContext context) => const N11Banner(
        key: Key('m10-sample-banner'),
        kind: BannerKind.warn,
        title: kM10SampleLabel,
        text: 'Chỉ để xem giao diện. Không có đơn nào được tạo hay gửi.',
        icon: Icons.visibility_outlined,
      );
}

/// The dishes of an Order. A line the shop changed shows the new figure and, under it, what was ordered; a removed line is struck through.
class OrderLinesCard extends StatelessWidget {
  const OrderLinesCard({super.key, required this.lines, this.title = 'Món đã đặt'});

  final List<OrderLine> lines;
  final String title;

  @override
  Widget build(BuildContext context) {
    return N11Card(
      key: const Key('m10-lines'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(title, style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          OrderLinesBody(lines: lines),
        ],
      ),
    );
  }
}

/// "3 món · 130.000đ": the line of the closed dishes card. Removed lines are not counted; the figure is what the dishes cost now, never the fee.
String orderLinesSummary(List<OrderLine> lines, int itemsVnd) {
  final int count = lines.where((OrderLine l) => !l.removed).fold<int>(0, (int sum, OrderLine l) => sum + l.quantity);
  return '$count món · ${m10Money(itemsVnd)}';
}

/// The rows of the dishes WITHOUT a frame, for a collapsible section. Text only: no picture of a dish is drawn on an order (Owner decision 2026-10-25); each
/// row is "2× Name" with the line total on the right and the dish's own note under its name.
class OrderLinesBody extends StatelessWidget {
  const OrderLinesBody({super.key, required this.lines});

  final List<OrderLine> lines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (final OrderLine l in lines)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                SizedBox(width: 34, child: Text('${l.quantity}×', style: N11Text.bodyStrong.copyWith(decoration: l.removed ? TextDecoration.lineThrough : null))),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(l.name, style: N11Text.bodyStrong.copyWith(decoration: l.removed ? TextDecoration.lineThrough : null)),
                      if (l.note != null) Text('Ghi chú: ${l.note}', style: N11Text.caption),
                      if (!l.removed && l.quantity > 1) Text('${m10Money(l.unitPriceVnd)} / món', style: N11Text.caption),
                      if (l.changed)
                        Text(
                          l.removed ? 'Đã bỏ món (ban đầu ${l.originalQuantity}× ${m10Money(l.originalPriceVnd ?? 0)})' : 'Ban đầu ${l.originalQuantity}× ${m10Money(l.originalPriceVnd ?? 0)}',
                          key: Key('m10-line-original-${l.lineId}'),
                          style: const TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w600, color: N11Colors.chipWarnInk),
                        ),
                    ],
                  ),
                ),
                Text(l.removed ? '—' : m10Money(l.lineTotalVnd), textAlign: TextAlign.right, style: N11Text.bodyStrong),
              ],
            ),
          ),
      ],
    );
  }
}

/// Dishes and the delivery fee, each on its own line. The "expected total" is shown only when it is complete; otherwise a sentence says the fee is not
/// known yet. The app does not manage payment of the dishes, so there are no "paid" / "still to collect" lines (Owner decision 2026-10-23).
class OrderMoneyCard extends StatelessWidget {
  const OrderMoneyCard({super.key, required this.money, required this.edited});

  final OrderMoney money;
  final bool edited;

  @override
  Widget build(BuildContext context) {
    return N11Card(
      key: const Key('m10-money'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Tiền món và phí giao', style: N11Text.label),
          OrderMoneyBody(money: money, edited: edited),
        ],
      ),
    );
  }
}

/// The closed money card says the one figure that matters: the expected total when it is complete, else that it is not known yet (never a made-up sum).
String orderMoneySummary(OrderMoney money) => money.expectedTotalVnd == null ? 'Tiền món ${m10Money(money.itemsVnd)} · $kFeeUnknownShort' : 'Tổng dự kiến ${m10Money(money.expectedTotalVnd!)}';

const String kFeeUnknownShort = 'phí giao chưa xác định';

/// The rows of the money card without a frame, for a collapsible section.
class OrderMoneyBody extends StatelessWidget {
  const OrderMoneyBody({super.key, required this.money, required this.edited});

  final OrderMoney money;
  final bool edited;

  @override
  Widget build(BuildContext context) {
    final OrderFee fee = money.fee;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        KeyValueRows(<(String, String)>[
          if (edited) ('Tiền món ban đầu', m10Money(money.originalItemsVnd)),
          (edited ? 'Tiền món đã chốt' : 'Tiền món', m10Money(money.itemsVnd)),
          ('Quãng đường giao', fee.distanceM == null ? 'Chưa xác định quãng đường' : '≈ ${RouteDistance.text(fee.distanceM!)} · đường đi'),
          (fee.isEstimate ? 'Phí giao (dự tính)' : 'Phí giao', m10Fee(fee.shownVnd)),
          ('Người trả phí', fee.payerText),
          ('Đã thanh toán tiền món', m10Money(money.paidVnd)),
        ]),
        const Divider(height: N11Space.gap4, color: N11Colors.line),
        Row(children: <Widget>[
          const Expanded(child: Text('Còn phải thanh toán tiền món', style: N11Text.bodyStrong)),
          Text(m10Money(money.remainingVnd), key: const Key('m10-items-remaining'), style: N11Text.title.copyWith(fontSize: 18)),
        ]),
        if (money.expectedTotalVnd != null) ...<Widget>[
          const Divider(height: N11Space.gap4, color: N11Colors.line),
          Row(children: <Widget>[Expanded(child: Text(fee.isEstimate ? 'Tổng dự kiến' : 'Tổng cộng', style: N11Text.bodyStrong)), Text(m10Money(money.expectedTotalVnd!), key: const Key('m10-expected-total'), style: N11Text.title.copyWith(fontSize: 18))]),
        ] else
          Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: ReasonNote('Chưa gồm phí giao. ${_orderQuoteReason(fee.reason)}', icon: Icons.warning_amber_rounded)),
        const SizedBox(height: N11Space.gap2),
        const ReasonNote(kDirectPayNote, icon: Icons.info_outline),
      ],
    );
  }
}

String _orderQuoteReason(String? reason) => switch (reason) {
      'PICKUP_PIN_MISSING' => 'Quán chưa có ghim lấy hàng.',
      'DROPOFF_PIN_MISSING' => 'Điểm giao chưa có ghim trên bản đồ.',
      'ROUTE_TIMEOUT' => 'Tính tuyến đã hết thời gian chờ.',
      'ROUTE_UNAVAILABLE' => 'Tạm thời không tìm được tuyến đường.',
      'OUT_OF_PRICE_RANGE' => 'Tuyến đường ngoài bảng giá.',
      'POLICY_NOT_CONFIGURED' => 'Chưa có bảng giá giao hàng.',
      _ => 'Phí giao chưa xác định.',
    };

/// The map of the CURRENT delivery: the pickup and the drop-off as they were when the call was made, and the Shipper's LATEST position with the time it was
/// recorded — only while a Shipper holds the delivery ([location] is null otherwise and nothing live is drawn). When this build has no map, the points are
/// said in words; a position is never faked and a route is never replaced by a straight line.
class OrderMapCard extends StatelessWidget {
  const OrderMapCard({super.key, required this.pickupLat, required this.pickupLng, required this.dropoffLat, required this.dropoffLng, required this.location, required this.mapBuilder, required this.ended, required this.who, this.framed = true});

  /// False inside a collapsible section, which already is the card: the map is then drawn without a second frame and title.
  final bool framed;

  final double? pickupLat;
  final double? pickupLng;
  final double? dropoffLat;
  final double? dropoffLng;
  final LocationView? location;
  final M07MapBuilder? mapBuilder;
  final bool ended;
  final String who;

  @override
  Widget build(BuildContext context) {
    final List<M07MapPin> pins = <M07MapPin>[
      if (pickupLat != null && pickupLng != null) M07MapPin(lat: pickupLat!, lng: pickupLng!, label: 'Điểm lấy', color: 0xFFD8AD18),
      if (dropoffLat != null && dropoffLng != null) M07MapPin(lat: dropoffLat!, lng: dropoffLng!, label: 'Điểm giao', color: 0xFF2E7D4F),
    ];
    final bool nothing = pins.isEmpty && location == null;
    return Column(
      key: const Key('m10-map'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (location != null)
          LocationCard(location: location, mapBuilder: mapBuilder, pins: pins, who: who)
        else
          _frame(
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (framed) const Text('Bản đồ giao hàng', style: N11Text.label),
                if (framed) const SizedBox(height: N11Space.gap2),
                if (nothing)
                  const ReasonNote('Chưa có ghim điểm giao nên chưa vẽ được bản đồ.')
                else if (mapBuilder != null)
                  SizedBox(height: 200, child: ClipRRect(borderRadius: BorderRadius.circular(kRadiusControl), child: mapBuilder!(context, pins)))
                else
                  for (final M07MapPin p in pins) Text('${p.label}: ${p.lat.toStringAsFixed(5)}, ${p.lng.toStringAsFixed(5)}', style: N11Text.body),
                const SizedBox(height: N11Space.gap2),
                ReasonNote(ended ? 'Đơn đã kết thúc: chỉ còn các điểm đã lưu, không còn theo dõi vị trí.' : 'Chưa có vị trí của shipper. Vị trí chỉ hiện khi shipper đang giữ đơn và đã chia sẻ vị trí.'),
              ],
            ),
          ),
      ],
    );
  }

  Widget _frame(Widget child) => framed ? N11Card(child: child) : child;
}

/// The shop proposes a delivery fee when the table cannot price an order (FEE_REQUIRED): a reason, an optional note and the amount. The Shipper may agree or
/// counter, and whoever pays decides the counter.
Future<AgreedFeeProposal?> showFeeProposalDialog(BuildContext context, {required bool payerIsCustomer}) {
  return showDialog<AgreedFeeProposal>(context: context, builder: (BuildContext dialog) => _FeeProposalDialog(payerIsCustomer: payerIsCustomer));
}

class _FeeProposalDialog extends StatefulWidget {
  const _FeeProposalDialog({required this.payerIsCustomer});

  final bool payerIsCustomer;

  @override
  State<_FeeProposalDialog> createState() => _FeeProposalDialogState();
}

class _FeeProposalDialogState extends State<_FeeProposalDialog> {
  final GlobalKey<FormState> _form = GlobalKey<FormState>();
  final TextEditingController _amount = TextEditingController();
  final TextEditingController _note = TextEditingController();
  FeeReason _reason = FeeReason.outsideTable;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  static String _wire(FeeReason r) => switch (r) {
        FeeReason.urgent => 'URGENT',
        FeeReason.bulky => 'BULKY',
        FeeReason.badWeather => 'BAD_WEATHER',
        FeeReason.outsideTable => 'OUT_OF_PRICE_RANGE',
        FeeReason.other => 'OTHER',
      };

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _form,
      child: AlertDialog(
        key: const Key('fee-proposal-dialog'),
        title: const Text('Đề xuất phí giao', style: N11Text.h2),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Hệ thống chưa tính được phí giao tự động cho đơn này. Hãy đề xuất một mức phí; shipper đồng ý hoặc đề xuất mức khác, và người trả phí quyết định.', style: N11Text.lead),
              const SizedBox(height: N11Space.gap2),
              Wrap(
                spacing: N11Space.gap2,
                children: <Widget>[
                  for (final FeeReason r in FeeReason.values) ChoiceChip(key: Key('fee-reason-${_wire(r)}'), label: Text(feeReasonText(r)), selected: _reason == r, onSelected: (bool _) => setState(() => _reason = r)),
                ],
              ),
              const SizedBox(height: N11Space.gap2),
              N11Field(
                validator: (String value) => parseAgreedFee(value) == null ? 'Nhập phí là số nguyên từ 0 đến 10.000.000đ.' : null,
                fieldKey: const Key('fee-proposal-amount'),
                label: 'Mức phí đề xuất (đ)',
                controller: _amount,
                keyboard: TextInputType.number,
                maxLength: 10,
              ),
              N11Field(
                validator: (String value) => noteLooksLikePhone(value)
                    ? 'Ghi chú cho shipper không được chứa số điện thoại.'
                    : _reason == FeeReason.other && value.trim().isEmpty
                        ? 'Lý do Khác cần có ghi chú.'
                        : null,
                fieldKey: const Key('fee-proposal-note'),
                label: 'Ghi chú cho shipper',
                controller: _note,
                maxLength: 200,
                optionalLabel: true,
                hint: kFeeNotePrivacyHint,
              ),
              if (widget.payerIsCustomer) const ReasonNote('Khách trả phí: mức khác bảng giá cần khách đồng ý trong ứng dụng 11Food.'),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Quay lại')),
          TextButton(
            key: const Key('fee-proposal-send'),
            onPressed: () {
              if (_form.currentState!.validate()) {
                Navigator.of(context).pop(AgreedFeeProposal(reasonCode: _wire(_reason), reasonNote: _note.text, amountVnd: parseAgreedFee(_amount.text)!));
              }
            },
            child: const Text('Gọi shipper'),
          ),
        ],
      ),
    );
  }
}

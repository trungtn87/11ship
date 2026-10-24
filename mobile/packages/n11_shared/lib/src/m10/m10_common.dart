import 'package:flutter/material.dart';

import '../m07/m07_models.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm10_models.dart';

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
      DisplayStatus.ready || DisplayStatus.searchingShipper || DisplayStatus.delivering => (label: s.label, kind: ChipKind.yellow),
      DisplayStatus.completed => (label: s.label, kind: ChipKind.ok),
      DisplayStatus.searchStopped || DisplayStatus.deliveryFailed => (label: s.label, kind: ChipKind.bad),
      DisplayStatus.cancelledByCustomer || DisplayStatus.cancelledByShop || DisplayStatus.cancelledBySystem || DisplayStatus.rejected || DisplayStatus.notCompleted => (label: s.label, kind: ChipKind.neutral),
    };

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
                        if (l.changed)
                          Text(
                            l.removed ? 'Đã bỏ món (ban đầu ${l.originalQuantity}× ${m10Money(l.originalPriceVnd ?? 0)})' : 'Ban đầu ${l.originalQuantity}× ${m10Money(l.originalPriceVnd ?? 0)}',
                            key: Key('m10-line-original-${l.lineId}'),
                            style: const TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w600, color: N11Colors.chipWarnInk),
                          ),
                      ],
                    ),
                  ),
                  Text(l.removed ? '—' : m10Money(l.lineTotalVnd), style: N11Text.bodyStrong),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Dishes, what was paid, what is left to pay for them, and the delivery fee — each on its own line. The "expected total" is shown only when it is
/// complete; otherwise a sentence says the fee is not known yet.
class OrderMoneyCard extends StatelessWidget {
  const OrderMoneyCard({super.key, required this.money, required this.edited, this.showPaid = true});

  final OrderMoney money;
  final bool edited;
  final bool showPaid;

  @override
  Widget build(BuildContext context) {
    final OrderFee fee = money.fee;
    return N11Card(
      key: const Key('m10-money'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Tiền món và phí giao', style: N11Text.label),
          KeyValueRows(<(String, String)>[
            if (edited) ('Tiền món ban đầu', m10Money(money.originalItemsVnd)),
            (edited ? 'Tiền món đã chốt' : 'Tiền món', m10Money(money.itemsVnd)),
            if (showPaid) ('Đã thanh toán', m10Money(money.paidVnd)),
            if (showPaid) ('Còn phải thu (tiền món)', m10Money(money.remainingVnd)),
            (fee.isEstimate ? 'Phí giao (dự tính)' : 'Phí giao', m10Fee(fee.shownVnd)),
            ('Người trả phí', fee.payerText),
          ]),
          if (money.expectedTotalVnd != null) ...<Widget>[
            const Divider(height: N11Space.gap4, color: N11Colors.line),
            Row(children: <Widget>[const Expanded(child: Text('Tổng dự kiến', style: N11Text.bodyStrong)), Text(m10Money(money.expectedTotalVnd!), key: const Key('m10-expected-total'), style: N11Text.title.copyWith(fontSize: 18))]),
          ] else
            const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote(kNoFeeNote, icon: Icons.warning_amber_rounded)),
          const SizedBox(height: N11Space.gap2),
          const ReasonNote(kDirectPayNote, icon: Icons.info_outline),
        ],
      ),
    );
  }
}

/// The map of the CURRENT delivery: the pickup and the drop-off as they were when the call was made, and the Shipper's LATEST position with the time it was
/// recorded — only while a Shipper holds the delivery ([location] is null otherwise and nothing live is drawn). When this build has no map, the points are
/// said in words; a position is never faked and a route is never replaced by a straight line.
class OrderMapCard extends StatelessWidget {
  const OrderMapCard({super.key, required this.pickupLat, required this.pickupLng, required this.dropoffLat, required this.dropoffLng, required this.location, required this.mapBuilder, required this.ended, required this.who});

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
          N11Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Bản đồ giao hàng', style: N11Text.label),
                const SizedBox(height: N11Space.gap2),
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
}

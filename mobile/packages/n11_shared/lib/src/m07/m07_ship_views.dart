import 'dart:async';

import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../m06/m06_models.dart';
import '../m06/m06_views.dart' show parseAgreedFee;
import '../tokens.dart';
import '../widgets/components.dart';
import 'm07_models.dart';
import 'm07_source.dart';
import 'm07_widgets.dart';

// 11Ship, the Shipper's side of M07 (screens S01-S08 of docs/current/M07-implementation-20261018.md):
//   S01 offers            what a Shipper may see BEFORE accepting (no customer phone, no detailed address, no drop-off map)
//   S02 my deliveries     in the order they were accepted; the Shipper chooses the delivery order
//   S03 / S06 detail      before pickup: contacts, map, "Hủy nhận đơn" / "Đã nhận hàng"; after pickup: "Giao thành công" / "Giao thất bại", no cancel
//   S04 confirm drop-off  pin and fee agreed with the customer, when the drop-off position or the fee is missing
//   S05 pickup pop-up     "Quay lại" / "Xác nhận đã nhận hàng"
//   S07 failed            reason, note and where the goods are
//   S08 result / history  limited projection once the delivery ended
// After pickup there is no ordinary cancel: the button is not drawn and the server refuses it.

const String kReleaseExplain = 'Bạn sẽ không còn giữ đơn này. Hệ thống tìm shipper khác theo thời hạn còn lại.';

/// Lets the app say what it does with the Shipper's position while a delivery is open (11Ship plugs in the M14 core).
typedef M07LocationSlot = Widget Function(BuildContext context);

// ---- S01 / S02: hub ----------------------------------------------------------------------------------------------------

enum _ShipView { mine, offers, history }

class ShipperDeliveryHub extends StatefulWidget {
  const ShipperDeliveryHub({super.key, required this.source, this.mapBuilder, this.pinPicker, this.locationSlot, this.feedbackSlot});

  final ShipperDeliverySource source;
  final M07MapBuilder? mapBuilder;
  final M07PinPickerBuilder? pinPicker;
  final M07LocationSlot? locationSlot;
  final M07FeedbackSlot? feedbackSlot;

  @override
  State<ShipperDeliveryHub> createState() => _ShipperDeliveryHubState();
}

class _ShipperDeliveryHubState extends State<ShipperDeliveryHub> with M07Actions<ShipperDeliveryHub> {
  _ShipView _view = _ShipView.mine;
  int _rev = 0;

  Future<void> _open(DeliveryView d) async {
    await Navigator.of(context).push(n11Route(ShipperDeliveryDetailScreen(source: widget.source, deliveryId: d.deliveryId, mapBuilder: widget.mapBuilder, pinPicker: widget.pinPicker, locationSlot: widget.locationSlot, feedbackSlot: widget.feedbackSlot)));
    if (mounted) {
      setState(() => _rev++);
    }
  }

  Future<void> _accept(OfferView o) async {
    DeliveryView? taken;
    final bool ok = await act('accept-${o.deliveryId}', (String key) async => taken = await widget.source.accept(o.deliveryId, key: key), onConflict: () async {
      if (mounted) {
        setState(() => _rev++);
      }
    });
    if (!ok || taken == null || !mounted) {
      return;
    }
    setState(() {
      _view = _ShipView.mine;
      _rev++;
    });
    await _open(taken!);
  }

  Future<void> _feeAction(OfferView o, Future<void> Function(String key) body, String intent) async {
    if (await act('$intent-${o.deliveryId}', body) && mounted) {
      setState(() => _rev++);
    }
  }

  Future<void> _counter(OfferView o) async {
    final TextEditingController amount = TextEditingController();
    final GlobalKey<FormState> form = GlobalKey<FormState>();
    final bool? yes = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => Form(key: form, child: AlertDialog(
        key: const Key('m07-counter-dialog'),
        title: const Text('Đề xuất mức phí khác', style: N11Text.h2),
        content: N11Field(validator: (String value) => parseAgreedFee(value) == null ? 'Nhập phí là số nguyên từ 0 đến 10.000.000đ.' : null, fieldKey: const Key('m07-counter-amount'), label: 'Mức phí bạn đề xuất (đ)', controller: amount, keyboard: TextInputType.number, maxLength: 10),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Quay lại')),
          TextButton(key: const Key('m07-counter-send'), onPressed: () { if (form.currentState!.validate()) Navigator.of(dialogContext).pop(true); }, child: const Text('Gửi đề xuất', style: TextStyle(fontWeight: FontWeight.w700))),
        ],
      )),
    );
    final int? value = parseAgreedFee(amount.text);
    amount.dispose();
    if (yes != true || !mounted) {
      return;
    }
    if (value == null) {
      setState(() => actionFailure = const M07Failure(M07FailureKind.refused, code: 'DELIVERY_INPUT_INVALID'));
      return;
    }
    await _feeAction(o, (String key) => widget.source.feeCounter(o.deliveryId, amountVnd: value, key: key), 'counter');
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.source.isSample) const Padding(padding: EdgeInsets.only(bottom: N11Space.gap3), child: M07SampleBanner()),
        if (widget.locationSlot != null) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: widget.locationSlot!(context)),
        Wrap(
          spacing: N11Space.gap2,
          runSpacing: N11Space.gap2,
          children: <Widget>[
            N11Button(key: const Key('m07-ship-tab-mine'), label: 'Đang thực hiện', compact: true, kind: _view == _ShipView.mine ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _view = _ShipView.mine)),
            N11Button(key: const Key('m07-ship-tab-offers'), label: 'Có thể nhận', compact: true, kind: _view == _ShipView.offers ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _view = _ShipView.offers)),
            N11Button(key: const Key('m07-ship-tab-history'), label: 'Lịch sử', compact: true, kind: _view == _ShipView.history ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _view = _ShipView.history)),
          ],
        ),
        const SizedBox(height: N11Space.gap3),
        actionBanner(),
        if (_view == _ShipView.offers) _offers() else _deliveries(history: _view == _ShipView.history),
      ],
    );
  }

  Widget _offers() {
    return M07Loader<List<OfferView>>(
      key: ValueKey<String>('offers|$_rev'),
      keyPrefix: 'm07-offers',
      refreshEvery: const Duration(seconds: 15),
      load: widget.source.offers,
      isEmpty: (List<OfferView> v) => v.isEmpty,
      emptyIcon: Icons.inventory_2_outlined,
      emptyTitle: 'Chưa có đơn để nhận',
      emptyText: 'Đơn mới trong bán kính 3 km quanh bạn sẽ hiện ở đây khi quán gọi shipper.',
      builder: (BuildContext context, List<OfferView> offers, Future<void> Function() reload) => Column(
        children: <Widget>[
          for (final OfferView o in offers)
            Padding(
              padding: const EdgeInsets.only(bottom: N11Space.gap3),
              child: OfferCard(
                offer: o,
                busy: busy,
                onAccept: () => _accept(o),
                onAgree: () => _feeAction(o, (String key) => widget.source.feeAgree(o.deliveryId, key: key), 'agree'),
                onSkip: () => _feeAction(o, (String key) => widget.source.feeSkip(o.deliveryId, key: key), 'skip'),
                onCounter: () => _counter(o),
              ),
            ),
        ],
      ),
    );
  }

  Widget _deliveries({required bool history}) {
    return M07Loader<List<DeliveryView>>(
      key: ValueKey<String>('mine|$history|$_rev'),
      keyPrefix: 'm07-mine',
      refreshEvery: const Duration(seconds: 15),
      load: () => widget.source.mine(history: history),
      isEmpty: (List<DeliveryView> v) => v.isEmpty,
      emptyIcon: Icons.two_wheeler,
      emptyTitle: history ? 'Chưa có lịch sử giao hàng' : 'Chưa có đơn đang thực hiện',
      emptyText: history ? 'Đơn đã kết thúc sẽ hiện ở đây.' : 'Vào "Có thể nhận" để nhận đơn.',
      builder: (BuildContext context, List<DeliveryView> items, Future<void> Function() reload) => Column(
        children: <Widget>[
          for (final DeliveryView d in items)
            Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: _MineCard(delivery: d, onTap: () => _open(d))),
        ],
      ),
    );
  }
}

/// S01: one offer. Only what the rules allow before accepting.
class OfferCard extends StatelessWidget {
  const OfferCard({super.key, required this.offer, required this.busy, required this.onAccept, required this.onAgree, required this.onSkip, required this.onCounter});

  final OfferView offer;
  final bool busy;
  final VoidCallback onAccept;
  final VoidCallback onAgree;
  final VoidCallback onSkip;
  final VoidCallback onCounter;

  @override
  Widget build(BuildContext context) {
    final AgreementSummary? a = offer.agreement;
    final bool pendingFee = offer.feeStatus == 'PENDING_AGREEMENT' || offer.feeStatus == 'AWAITING_CUSTOMER';
    final bool canAccept = offer.eligible && !pendingFee;
    return N11Card(
      key: Key('m07-offer-${offer.deliveryId}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[Expanded(child: Text(offer.code, style: N11Text.bodyStrong)), N11Chip('Còn ${m07Countdown(offer.remaining)}', kind: ChipKind.warn)]),
          const SizedBox(height: N11Space.gap2),
          KeyValueRows(<(String, String)>[
            ('Quán', offer.shopName),
            if (offer.shopAreaText != null) ('Khu vực lấy hàng', offer.shopAreaText!),
            ('Cách quán', m07Km(offer.distanceToShopM)),
            ('Khu vực giao', offer.dropoffAreaText ?? (offer.destinationKnown ? '—' : 'Chưa có điểm giao')),
            ('Tiền hàng', m07Vnd(offer.goodsValueVnd)),
            ('Còn phải thu', m07Vnd(offer.unpaidVnd)),
            ('Phí giao', offer.feeVnd == null ? kFeeUnknown : m07Vnd(offer.feeVnd)),
            ('Người trả phí', offer.feePayer == 'CUSTOMER' ? 'Khách trả ship' : 'Quán trả ship'),
          ]),
          if (!offer.destinationKnown) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote('Chưa có điểm giao. Bạn sẽ ghim điểm giao và xác nhận phí trước khi lấy hàng. Chỉ shipper chưa có đơn khác nhận được.')),
          if (a != null) ...<Widget>[
            const SizedBox(height: N11Space.gap2),
            Container(
              key: const Key('m07-offer-agreement'),
              padding: const EdgeInsets.all(N11Space.gap3),
              decoration: BoxDecoration(color: N11Colors.yellowSoft, borderRadius: BorderRadius.circular(kRadiusControl)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Quán đề xuất phí ${m07Vnd(a.proposedVnd)}', style: N11Text.bodyStrong),
                  Text(a.reasonNote == null || a.reasonNote!.isEmpty ? 'Lý do: ${feeReasonLabel(a.reasonCode)}' : 'Lý do: ${feeReasonLabel(a.reasonCode)} · ${a.reasonNote}', style: N11Text.caption),
                  if (a.state == 'COUNTERED') Text('Bạn đã đề xuất ${m07Vnd(a.counterVnd)}, đang chờ quán trả lời.', style: N11Text.caption),
                ],
              ),
            ),
            if (a.state == 'PROPOSED')
              Padding(
                padding: const EdgeInsets.only(top: N11Space.gap2),
                child: Wrap(
                  spacing: N11Space.gap2,
                  runSpacing: N11Space.gap2,
                  children: <Widget>[
                    N11Button(key: const Key('m07-fee-agree'), label: 'Đồng ý', compact: true, onPressed: busy ? null : onAgree),
                    N11Button(key: const Key('m07-fee-counter'), label: 'Đề xuất mức khác', compact: true, kind: ButtonKind.secondary, onPressed: busy ? null : onCounter),
                    N11Button(key: const Key('m07-fee-skip'), label: 'Bỏ qua', compact: true, kind: ButtonKind.secondary, onPressed: busy ? null : onSkip),
                  ],
                ),
              ),
          ],
          if (!offer.eligible && offer.reasons.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: ReasonNote(m06ReasonText(offer.reasons.first))),
          if (pendingFee) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote('Phí chưa chốt nên chưa nhận đơn được.')),
          const SizedBox(height: N11Space.gap3),
          N11Button(key: Key('m07-accept-${offer.deliveryId}'), label: 'Nhận đơn', onPressed: busy || !canAccept ? null : onAccept),
        ],
      ),
    );
  }
}

String feeReasonLabel(String code) => switch (code) {
      'URGENT' => 'Gấp',
      'BULKY' => 'Cồng kềnh',
      'BAD_WEATHER' => 'Thời tiết xấu',
      'OUT_OF_PRICE_RANGE' => 'Ngoài bảng giá',
      _ => 'Khác',
    };

class _MineCard extends StatelessWidget {
  const _MineCard({required this.delivery, required this.onTap});

  final DeliveryView delivery;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = _ownChip(delivery) ?? m07StateChip(delivery.state);
    final bool missing = delivery.state.isActive && (delivery.needsDestination || delivery.fee.amountVnd == null) && delivery.state != DeliveryState.delivering;
    return InkWell(
      key: Key('m07-mine-${delivery.deliveryId}'),
      borderRadius: BorderRadius.circular(kRadiusCard),
      onTap: onTap,
      child: N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[Expanded(child: Text(delivery.code, style: N11Text.bodyStrong)), N11Chip(chip.label, kind: chip.kind)]),
            const SizedBox(height: N11Space.gap2),
            Text('${delivery.pickup.shopName} → ${delivery.recipient.name}', style: N11Text.body),
            Text('Phí giao: ${m07Vnd(delivery.fee.amountVnd)} · Còn thu ${m07Vnd(delivery.goods.unpaidVnd)}', style: N11Text.caption),
            if (missing) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: N11Chip('Thiếu điểm giao/phí', kind: ChipKind.warn)),
          ],
        ),
      ),
    );
  }
}

/// What happened to THIS Shipper's part when the delivery ended without them finishing it (null: show the delivery's own state).
({String label, ChipKind kind})? _ownChip(DeliveryView d) {
  switch (d.ownOutcome) {
    case 'released':
      return (label: 'Bạn đã hủy nhận', kind: ChipKind.neutral);
    case 'released_by_admin':
      return (label: 'Admin đã gỡ bạn khỏi đơn', kind: ChipKind.warn);
    case 'cancelled_by_shop':
      return (label: 'Quán đã hủy yêu cầu giao', kind: ChipKind.neutral);
  }
  return null;
}

// ---- S03 / S06 / S08: detail -----------------------------------------------------------------------------------------

class ShipperDeliveryDetailScreen extends StatefulWidget {
  const ShipperDeliveryDetailScreen({super.key, required this.source, required this.deliveryId, this.mapBuilder, this.pinPicker, this.locationSlot, this.feedbackSlot});

  final ShipperDeliverySource source;
  final String deliveryId;
  final M07MapBuilder? mapBuilder;
  final M07PinPickerBuilder? pinPicker;
  final M07LocationSlot? locationSlot;
  final M07FeedbackSlot? feedbackSlot;

  @override
  State<ShipperDeliveryDetailScreen> createState() => _ShipperDeliveryDetailScreenState();
}

class _ShipperDeliveryDetailScreenState extends State<ShipperDeliveryDetailScreen> with M07Actions<ShipperDeliveryDetailScreen> {
  final GlobalKey<M07DetailPageState<DeliveryView>> _page = GlobalKey<M07DetailPageState<DeliveryView>>();

  Future<void> _reload() async => _page.currentState?.fetcher.reload(quiet: true);

  Future<void> _release(DeliveryView d) async {
    final String? reason = await showReasonDialog(context, title: 'Hủy nhận đơn?', explanation: kReleaseExplain, confirmLabel: 'Xác nhận hủy');
    if (reason == null || !mounted) {
      return;
    }
    if (await act('release-${d.deliveryId}', (String key) => widget.source.release(d.deliveryId, reason: reason, expectedVersion: d.version, key: key), onConflict: _reload) && mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _pickup(DeliveryView d) async {
    final bool yes = await showConfirmDialog(
      context,
      title: 'Xác nhận đã nhận hàng?',
      confirmLabel: 'Xác nhận đã nhận hàng',
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          KeyValueRows(<(String, String)>[
            ('Người nhận', d.recipient.name),
            ('Địa chỉ', d.recipient.addressText ?? '—'),
            ('Còn phải thu', m07Vnd(d.goods.unpaidVnd)),
            ('Phí giao', m07Vnd(d.fee.amountVnd)),
          ]),
          const SizedBox(height: N11Space.gap2),
          const Text('Sau khi xác nhận, đơn chuyển sang "Đang giao". Thông tin và phí bị khóa, không hủy nhận được nữa.', style: N11Text.caption),
        ],
      ),
    );
    if (!yes || !mounted) {
      return;
    }
    if (await act('pickup-${d.deliveryId}', (String key) => widget.source.pickup(d.deliveryId, expectedVersion: d.version, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _complete(DeliveryView d) async {
    final bool yes = await showConfirmDialog(context,
        title: 'Giao thành công?', confirmLabel: 'Giao thành công', content: const Text('Xác nhận đã giao hàng cho người nhận. Hoa hồng sẽ được thu một lần khi hoàn tất.', style: N11Text.lead));
    if (!yes || !mounted) {
      return;
    }
    if (await act('complete-${d.deliveryId}', (String key) => widget.source.complete(d.deliveryId, expectedVersion: d.version, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _destination(DeliveryView d) async {
    final bool? changed = await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (BuildContext context) => ConfirmDestinationScreen(source: widget.source, delivery: d, pinPicker: widget.pinPicker)));
    if (changed == true) {
      await _reload();
    }
  }

  Future<void> _fail(DeliveryView d) async {
    final bool? failed = await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (BuildContext context) => FailDeliveryScreen(source: widget.source, delivery: d)));
    if (failed == true) {
      await _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return M07DetailPage<DeliveryView>(
      key: _page,
      title: 'Chi tiết đơn',
      sample: widget.source.isSample,
      keyPrefix: 'm07-ship-detail',
      load: () => widget.source.get(widget.deliveryId),
      builder: (BuildContext context, DeliveryView d, Future<void> Function() reload) => _parts(context, d),
    );
  }

  M07PageParts _parts(BuildContext context, DeliveryView d) {
    final ({String label, ChipKind kind}) chip = m07StateChip(d.state);
    final bool active = d.state.isActive;
    final List<M07MapPin> pins = <M07MapPin>[
      if (d.pickup.lat != null && d.pickup.lng != null) M07MapPin(lat: d.pickup.lat!, lng: d.pickup.lng!, label: 'Quán'),
      if (d.recipient.hasPoint) M07MapPin(lat: d.recipient.lat!, lng: d.recipient.lng!, label: 'Giao', color: 0xFFC0392B),
    ];
    final List<Widget> body = <Widget>[
      Row(children: <Widget>[Expanded(child: Text(d.code, key: const Key('m07-ship-code'), style: N11Text.title)), N11Chip(chip.label, kind: chip.kind)]),
      actionBanner(),
      if (active && widget.locationSlot != null) widget.locationSlot!(context),
      if (widget.feedbackSlot != null && (d.state == DeliveryState.completed || d.state == DeliveryState.failed)) widget.feedbackSlot!(context, d),
      if (active && widget.mapBuilder != null && pins.isNotEmpty)
        SizedBox(key: const Key('m07-ship-map'), height: 220, child: ClipRRect(borderRadius: BorderRadius.circular(kRadiusCard), child: widget.mapBuilder!(context, pins))),
      if (active && d.state != DeliveryState.delivering && (d.needsDestination || d.fee.amountVnd == null))
        N11Banner(
          key: const Key('m07-missing-banner'),
          kind: BannerKind.warn,
          title: 'Thiếu điểm giao hoặc phí',
          text: 'Ghim điểm giao và xác nhận phí thỏa thuận trước khi nhận hàng. Việc này không ghi vào sổ địa chỉ của khách.',
          icon: Icons.pin_drop_outlined,
        ),
      _contactCard('Quán lấy hàng', <(String, String)>[('Quán', d.pickup.shopName), if (d.pickup.phone != null) ('Điện thoại', d.pickup.phone!), if (d.pickup.addressText != null) ('Địa chỉ', d.pickup.addressText!)], key: 'm07-pickup-card', show: active),
      _contactCard(
        'Người nhận',
        <(String, String)>[('Tên', d.recipient.name), if (d.recipient.phone != null) ('Điện thoại', d.recipient.phone!), ('Địa chỉ', d.recipient.addressText ?? '—'), ('Điểm giao', d.recipient.hasPoint ? 'Đã ghim' : 'Chưa ghim')],
        key: 'm07-recipient-card',
        show: active,
      ),
      N11Card(child: KeyValueRows(<(String, String)>[('Hàng', d.goods.description), if (d.note != null && d.note!.isNotEmpty) ('Ghi chú', d.note!)])),
      MoneySummary(goods: d.goods, fee: d.fee),
      if (!active) _result(d),
    ];
    return M07PageParts(body, bottom: active ? _bottom(d) : null);
  }

  Widget _contactCard(String title, List<(String, String)> rows, {required String key, required bool show}) {
    if (!show) {
      return const SizedBox.shrink();
    }
    return N11Card(key: Key(key), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[Text(title, style: N11Text.label), KeyValueRows(rows)]));
  }

  Widget _result(DeliveryView d) {
    final ResultView? r = d.result;
    final IncidentView? i = d.incident;
    return N11Card(
      key: const Key('m07-result'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Kết quả', style: N11Text.label),
          KeyValueRows(<(String, String)>[
            ('Trạng thái', d.state.label),
            if (r != null) ('Lúc', m07Hm(r.at)),
            if (r?.reason != null) ('Lý do', r!.reason!),
            if (r?.goodsCondition != null) ('Hàng', _goodsText(r!.goodsCondition!)),
            if (i != null) ('Trách nhiệm hàng', i.custodyText),
          ]),
          if (i != null && i.isOpen) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote('Hồ sơ xử lý hàng đang mở. Hàng ở tay ai người đó chịu trách nhiệm; quán sẽ xác nhận khi hàng đã về.')),
          if (d.state == DeliveryState.completed) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: ReasonNote('Hoa hồng đã được thu theo quy định ví. Tiền hàng và phí giao do các bên giao nhận trực tiếp.')),
        ],
      ),
    );
  }

  Widget? _bottom(DeliveryView d) {
    final List<Widget> actions = <Widget>[];
    if (d.state == DeliveryState.delivering || d.state == DeliveryState.pickedUp) {
      if (d.allows('complete')) {
        actions.add(N11Button(key: const Key('m07-complete'), label: 'Giao thành công', icon: Icons.check_circle_outline, loading: busy, onPressed: busy ? null : () => _complete(d)));
      }
      if (d.allows('fail')) {
        actions.add(N11Button(key: const Key('m07-fail'), label: 'Giao thất bại', kind: ButtonKind.secondary, onPressed: busy ? null : () => _fail(d)));
      }
    } else {
      if (d.allows('confirm_destination') && (d.needsDestination || d.fee.amountVnd == null)) {
        actions.add(N11Button(key: const Key('m07-confirm-destination'), label: 'Xác nhận điểm giao và phí', icon: Icons.pin_drop_outlined, onPressed: busy ? null : () => _destination(d)));
      }
      if (d.allows('pickup')) {
        actions.add(N11Button(key: const Key('m07-pickup'), label: 'Đã nhận hàng', icon: Icons.inventory_2_outlined, loading: busy, onPressed: busy ? null : () => _pickup(d)));
      }
      if (d.allows('release')) {
        actions.add(DangerButton(key: const Key('m07-release'), label: 'Hủy nhận đơn', onPressed: busy ? null : () => _release(d)));
      }
    }
    if (actions.isEmpty) {
      return null;
    }
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[for (int i = 0; i < actions.length; i++) ...<Widget>[if (i > 0) const SizedBox(height: N11Space.gap2), actions[i]]]);
  }
}

String _goodsText(String code) {
  for (final (String, String) c in kGoodsConditions) {
    if (c.$1 == code) {
      return c.$2;
    }
  }
  return code;
}

// ---- S04: confirm the drop-off ---------------------------------------------------------------------------------------

class ConfirmDestinationScreen extends StatefulWidget {
  const ConfirmDestinationScreen({super.key, required this.source, required this.delivery, this.pinPicker});

  final ShipperDeliverySource source;
  final DeliveryView delivery;
  final M07PinPickerBuilder? pinPicker;

  @override
  State<ConfirmDestinationScreen> createState() => _ConfirmDestinationScreenState();
}

class _ConfirmDestinationScreenState extends State<ConfirmDestinationScreen> with M07Actions<ConfirmDestinationScreen> {
  final TextEditingController _fee = TextEditingController();
  double? _lat;
  double? _lng;
  String? _problem;

  @override
  void initState() {
    super.initState();
    _lat = widget.delivery.recipient.lat;
    _lng = widget.delivery.recipient.lng;
  }

  @override
  void dispose() {
    _fee.dispose();
    super.dispose();
  }

  bool get _needsFee => widget.delivery.fee.amountVnd == null;

  Future<void> _submit() async {
    final int? fee = _needsFee ? parseAgreedFee(_fee.text) : null;
    String? problem;
    if (_lat == null || _lng == null) {
      problem = 'Hãy chạm vào bản đồ để ghim điểm giao.';
    } else if (_needsFee && fee == null) {
      problem = 'Hãy nhập phí đã thỏa thuận (số nguyên, tối đa 10.000.000đ).';
    }
    setState(() => _problem = problem);
    if (problem != null) {
      return;
    }
    final bool ok = await act('destination-${widget.delivery.deliveryId}', (String key) => widget.source.confirmDestination(widget.delivery.deliveryId, lat: _lat!, lng: _lng!, feeVnd: fee, expectedVersion: widget.delivery.version, key: key));
    if (ok && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DeliveryView d = widget.delivery;
    final M07PinPickerBuilder? picker = widget.pinPicker;
    return m07Page(
      'Xác nhận điểm giao',
      widget.source.isSample,
      <Widget>[
        N11Card(child: KeyValueRows(<(String, String)>[('Người nhận', d.recipient.name), ('Địa chỉ mô tả', d.recipient.addressText ?? '—'), ('Người trả phí', d.fee.payerText)])),
        if (picker == null)
          const N11Banner(key: Key('m07-no-map'), kind: BannerKind.warn, title: 'Chưa có bản đồ', text: 'Bản này chưa có bản đồ để ghim điểm giao.', icon: Icons.map_outlined)
        else
          SizedBox(
            height: 260,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(kRadiusCard),
              child: picker(context, lat: _lat, lng: _lng, onPick: (double lat, double lng) => setState(() {
                    _lat = lat;
                    _lng = lng;
                  })),
            ),
          ),
        Text(_lat == null ? 'Chạm vào bản đồ để ghim điểm giao.' : 'Đã ghim ${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}', key: const Key('m07-pin-text'), style: N11Text.caption),
        if (_needsFee) N11Field(validator: (String value) => parseAgreedFee(value) == null ? 'Nhập phí là số nguyên từ 0 đến 10.000.000đ.' : null, fieldKey: const Key('m07-agreed-fee'), label: 'Phí thỏa thuận (đ)', controller: _fee, keyboard: TextInputType.number, maxLength: 10, hint: 'Phí bạn và bên trả phí đã thống nhất. Sau khi nhận hàng sẽ bị khóa.')
        else
          N11Card(child: KeyValueRows(<(String, String)>[('Phí giao đã chốt', m07Vnd(d.fee.amountVnd))])),
        const ReasonNote('Điểm ghim chỉ dùng cho đơn này, không ghi ngược vào sổ địa chỉ của khách.'),
        if (_problem != null) N11Banner(key: const Key('m07-dest-problem'), kind: BannerKind.error, title: 'Chưa xác nhận được', text: _problem),
        actionBanner(),
      ],
      bottom: N11Button(key: const Key('m07-dest-submit'), validate: true, label: 'Xác nhận điểm giao', loading: busy, onPressed: busy ? null : _submit),
    );
  }
}

// ---- S07: delivery failed --------------------------------------------------------------------------------------------

class FailDeliveryScreen extends StatefulWidget {
  const FailDeliveryScreen({super.key, required this.source, required this.delivery});

  final ShipperDeliverySource source;
  final DeliveryView delivery;

  @override
  State<FailDeliveryScreen> createState() => _FailDeliveryScreenState();
}

class _FailDeliveryScreenState extends State<FailDeliveryScreen> with M07Actions<FailDeliveryScreen> {
  String? _reason;
  String? _goods;
  final TextEditingController _note = TextEditingController();
  DeliveryView? _done;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  bool get _ready => _reason != null && _goods != null && (_reason != 'OTHER' || _note.text.trim().isNotEmpty);

  Future<void> _submit() async {
    if (!_ready) return;
    final bool yes = await showConfirmDialog(context, title: 'Xác nhận giao thất bại?', confirmLabel: 'Xác nhận', content: const Text('Hoa hồng được giải phóng và hồ sơ xử lý hàng được mở cho quán. Hàng ở tay bạn thì bạn vẫn chịu trách nhiệm cho tới khi hàng về quán.', style: N11Text.lead));
    if (!yes || !mounted) {
      return;
    }
    DeliveryView? result;
    final bool ok = await act('fail-${widget.delivery.deliveryId}', (String key) async => result = await widget.source.fail(widget.delivery.deliveryId, reasonCode: _reason!, note: _note.text, goodsCondition: _goods!, expectedVersion: widget.delivery.version, key: key));
    if (ok && mounted) {
      setState(() => _done = result);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DeliveryView? done = _done;
    if (done != null) {
      final IncidentView? i = done.incident;
      return m07Page(
        'Giao thất bại',
        widget.source.isSample,
        <Widget>[
          N11Banner(key: const Key('m07-fail-done'), kind: BannerKind.warn, title: 'Đã ghi nhận giao thất bại', text: 'Hoa hồng đã được giải phóng. Đơn món chưa hoàn tất.', icon: Icons.report_gmailerrorred_outlined),
          if (i != null) N11Card(key: const Key('m07-fail-custody'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[const Text('Trách nhiệm hàng còn mở', style: N11Text.label), const SizedBox(height: N11Space.gap2), Text(i.custodyText, style: N11Text.bodyStrong), const SizedBox(height: N11Space.gap2), const ReasonNote('Hàng ở tay ai người đó chịu trách nhiệm. Hệ thống chỉ ghi nhận, không tự bồi thường hay hoàn tiền.')])),
        ],
        bottom: N11Button(key: const Key('m07-fail-close'), label: 'Đóng', onPressed: () => Navigator.of(context).pop(true)),
      );
    }
    return m07Page(
      'Giao thất bại',
      widget.source.isSample,
      <Widget>[
        const Text('Lý do giao thất bại', style: N11Text.label),
        for (final (String code, String label) in kFailReasons) N11ChoiceCard(key: Key('m07-reason-$code'), title: label, selected: _reason == code, onTap: () => setState(() => _reason = code)),
        N11Field(requiredInput: _reason == 'OTHER', fieldKey: const Key('m07-fail-note'), label: 'Ghi chú', controller: _note, maxLength: 200, optionalLabel: _reason != 'OTHER', onChanged: () => setState(() {})),
        const Text('Hàng hiện ở đâu?', style: N11Text.label),
        for (final (String code, String label) in kGoodsConditions) N11ChoiceCard(key: Key('m07-goods-$code'), title: label, selected: _goods == code, onTap: () => setState(() => _goods = code)),
        actionBanner(),
      ],
      bottom: N11Button(key: const Key('m07-fail-submit'), validate: true, label: 'Xác nhận giao thất bại', loading: busy, onPressed: busy || _reason == null || _goods == null ? null : _submit),
    );
  }
}

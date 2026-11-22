import '../address_change/address_change_widgets.dart';
import '../guidance/order_incident_guidance.dart';
import 'dart:async';

import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../m06/m06_models.dart';
import '../m02/route_distance.dart';
import '../m06/m06_views.dart' show parseAgreedFee;
import '../m10/m10_models.dart' show OrderRoute;
import '../tokens.dart';
import '../widgets/components.dart';
import '../m10/order_chat_models.dart';
import '../m10/order_chat_view.dart';
import '../m10/order_sections.dart';
import 'm07_models.dart';
import 'm07_source.dart';
import 'm07_widgets.dart';

// 11Ship, the Shipper's side of M07 (Owner decision 2026-10-23: docs/current/M07-owner-delivery-flow-20261023.md):
//   S01 offers            what a Shipper may see BEFORE accepting (no customer phone, no detailed address, no drop-off map)
//   S02 my deliveries     in the order they were accepted; the Shipper chooses the delivery order
//   S03 / S06 detail      before pickup: contacts, "Hủy nhận đơn" / "Đã nhận hàng" (ONE step when the fee is settled);
//                         after pickup: "Giao thành công" and calling the shop. No cancel, no "Giao thất bại": if the goods cannot be delivered the
//                         Shipper calls the shop and the creator of the request decides.
//   S04 confirm fee       only for a call whose fee was never settled (`can.confirm_fee`): the amount agreed with the payer. No map point is needed.
//   S05 pickup pop-up     "Quay lại" / "Xác nhận đã nhận hàng"
//   S08 result / history  limited projection once the delivery ended
// The screens follow what the server ALLOWS (`can`), never a null amount or a missing map point.

const String kReleaseExplain = 'Bạn sẽ không còn giữ đơn này. Hệ thống tìm shipper khác theo thời hạn còn lại.';

/// Lets the app say what it does with the Shipper's position while a delivery is open (11Ship plugs in the M14 core).
typedef M07LocationSlot = Widget Function(BuildContext context);

/// The pop-up where a Shipper types the fee they want instead (before taking the delivery, or after taking it and before the pickup). Null when they go back.
Future<int?> askFeeProposal(BuildContext context, {int? currentFeeVnd, int? proposedFeeVnd, String? deciderText}) =>
    showDialog<int>(
      context: context,
      builder: (BuildContext dialogContext) => _FeeProposalDialog(
        currentFeeVnd: currentFeeVnd,
        proposedFeeVnd: proposedFeeVnd,
        deciderText: deciderText,
      ),
    );

class _FeeProposalDialog extends StatefulWidget {
  const _FeeProposalDialog({this.currentFeeVnd, this.proposedFeeVnd, this.deciderText});

  final int? currentFeeVnd;
  final int? proposedFeeVnd;
  final String? deciderText;

  @override
  State<_FeeProposalDialog> createState() => _FeeProposalDialogState();
}

class _FeeProposalDialogState extends State<_FeeProposalDialog> {
  // The dialog owns its field: the controller is disposed with the dialog, after its closing animation, never while it is still drawn.
  final TextEditingController _amount = TextEditingController();
  final GlobalKey<FormState> _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String subtitle = widget.proposedFeeVnd != null && widget.currentFeeVnd != null
        ? 'Phí hiện tại: ${m07Vnd(widget.currentFeeVnd)} · Đang đề xuất: ${m07Vnd(widget.proposedFeeVnd)}'
        : widget.proposedFeeVnd != null
            ? 'Phí đang đề xuất: ${m07Vnd(widget.proposedFeeVnd)}'
            : widget.currentFeeVnd != null
                ? 'Phí hiện tại: ${m07Vnd(widget.currentFeeVnd)}'
                : 'Gửi đề xuất phí tới ${widget.deciderText ?? 'người trả phí'}';

    return Form(
      key: _form,
      child: AlertDialog(
        key: const Key('m07-counter-dialog'),
        insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
        contentPadding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Text('Đề xuất mức phí', style: N11Text.h2),
            const SizedBox(height: 4),
            Text(subtitle, style: N11Text.caption),
          ],
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const SizedBox(height: 8),
                N11Field(
                  validator: (String value) => parseAgreedFee(value) == null ? 'Nhập phí là số nguyên từ 0 đến 10.000.000đ.' : null,
                  fieldKey: const Key('m07-counter-amount'),
                  label: 'Mức phí bạn đề xuất (đ)',
                  controller: _amount,
                  keyboard: TextInputType.number,
                  maxLength: 10,
                ),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Quay lại')),
          FilledButton(
            key: const Key('m07-counter-send'),
            onPressed: () {
              if (_form.currentState!.validate()) {
                Navigator.of(context).pop(parseAgreedFee(_amount.text));
              }
            },
            child: const Text('Gửi đề xuất', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

// ---- S01 / S02: hub ----------------------------------------------------------------------------------------------------

enum _ShipView { mine, offers, history }

class ShipperDeliveryHub extends StatefulWidget {
  const ShipperDeliveryHub({super.key, required this.source, this.mapBuilder, this.pinPicker, this.locationSlot, this.feedbackSlot});

  final ShipperDeliverySource source;
  final M07MapBuilder? mapBuilder;
  /// Kept so callers need not change: the Shipper no longer pins a drop-off point (a delivery is made to the described address).
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
    final int? value = await askFeeProposal(context, proposedFeeVnd: o.agreement?.proposedVnd, currentFeeVnd: o.feeVnd, deciderText: o.deciderText);
    if (value == null || !mounted) {
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
        _ShipViewSegments(selected: _view, onSelect: (_ShipView v) => setState(() => _view = v)),
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
        crossAxisAlignment: CrossAxisAlignment.stretch,
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
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final DeliveryView d in items)
            Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: _MineCard(delivery: d, onTap: () => _open(d))),
        ],
      ),
    );
  }
}

/// The three list filters of the Orders tab on ONE row (#394). Each segment takes width in proportion to its label; when the text is too large for one
/// row the row scrolls sideways instead of wrapping or shrinking the text.
class _ShipViewSegments extends StatelessWidget {
  const _ShipViewSegments({required this.selected, required this.onSelect});
  final _ShipView selected;
  final ValueChanged<_ShipView> onSelect;

  static const List<({_ShipView view, String label, Key key})> _items = <({_ShipView view, String label, Key key})>[
    (view: _ShipView.mine, label: 'Đang thực hiện', key: Key('m07-ship-tab-mine')),
    (view: _ShipView.offers, label: 'Có thể nhận', key: Key('m07-ship-tab-offers')),
    (view: _ShipView.history, label: 'Lịch sử', key: Key('m07-ship-tab-history')),
  ];
  static const TextStyle _style = TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.black);
  static const double _pad = 8;
  static const double _gap = 6;

  double _labelWidth(String label, TextScaler scaler) {
    final TextPainter painter = TextPainter(
      text: TextSpan(text: label, style: _style),
      textDirection: TextDirection.ltr,
      textScaler: scaler,
      maxLines: 1,
    )..layout();
    return painter.width + _pad * 2;
  }

  Widget _segment(({_ShipView view, String label, Key key}) item) {
    final bool active = selected == item.view;
    return Semantics(
      button: true,
      selected: active,
      label: item.label,
      excludeSemantics: true,
      onTap: () => onSelect(item.view),
      child: Material(
        color: active ? N11Colors.yellow : N11Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusControl),
          side: BorderSide(color: active ? Colors.transparent : N11Colors.line),
        ),
        child: InkWell(
          key: item.key,
          borderRadius: BorderRadius.circular(kRadiusControl),
          onTap: () => onSelect(item.view),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: kTapMin),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: _pad, vertical: 4),
                child: Text(item.label, style: _style, maxLines: 1, softWrap: false, textAlign: TextAlign.center),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final TextScaler scaler = MediaQuery.textScalerOf(context);
    final List<double> natural = <double>[for (final ({_ShipView view, String label, Key key}) i in _items) _labelWidth(i.label, scaler)];
    final double total = natural.reduce((double a, double b) => a + b) + _gap * (_items.length - 1);
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (total <= constraints.maxWidth) {
          return Row(
            children: <Widget>[
              for (int i = 0; i < _items.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(width: _gap),
                Expanded(flex: (natural[i] * 100).round(), child: _segment(_items[i])),
              ],
            ],
          );
        }
        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: <Widget>[
              for (int i = 0; i < _items.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(width: _gap),
                SizedBox(width: natural[i], child: _segment(_items[i])),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// S01: one offer. Only what the rules allow before accepting.
class OfferCard extends StatelessWidget {
  const OfferCard({
    super.key,
    required this.offer,
    required this.busy,
    required this.onAccept,
    required this.onAgree,
    required this.onSkip,
    required this.onCounter,
  });

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
    final FeeNegotiation? n = offer.negotiation;
    // A proposal of this Shipper that waits for the payer: the delivery is held for it, so it cannot be taken at either fee until it is answered or runs out.
    final bool canAccept = offer.eligible && !pendingFee && n == null;
    return N11Card(
      key: Key('m07-offer-${offer.deliveryId}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: N11Space.gap2,
            runSpacing: N11Space.gap2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(offer.code, style: N11Text.bodyStrong),
              N11Chip('Còn ${m07Countdown(offer.remaining)}', kind: ChipKind.warn),
            ],
          ),
          const SizedBox(height: N11Space.gap2),
          Text(offer.shopName, style: N11Text.h2),
          const SizedBox(height: N11Space.gap3),
          Container(
            padding: const EdgeInsets.all(N11Space.gap3),
            decoration: BoxDecoration(color: N11Colors.yellowSoft, borderRadius: BorderRadius.circular(kRadiusControl)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const Text('Phí giao', style: N11Text.caption),
                const SizedBox(height: N11Space.gap1),
                Text(offer.feeVnd == null ? kFeeUnknown : m07Vnd(offer.feeVnd), style: N11Text.h2),
              ],
            ),
          ),
          const SizedBox(height: N11Space.gap3),
          KeyValueRows(<(String, String)>[
            if (offer.shopAreaText != null) ('Khu vực lấy hàng', offer.shopAreaText!),
            ('Cách quán', m07Km(offer.distanceToShopM)),
            if (offer.codVnd != null && offer.codVnd! > 0)
              ('Thu hộ (COD)', m07Vnd(offer.codVnd!))
            else if (offer.source != 'CUSTOMER')
              ('Tiền hàng', m07Vnd(offer.goodsValueVnd)),
            if (offer.recipientPaysVnd != null)
              ('Người nhận trả', m07Vnd(offer.recipientPaysVnd!)),
            ('Người trả phí', switch (offer.feePayer) {
              'RECIPIENT' => 'Người nhận trả ship',
              'SENDER' => 'Người gửi trả ship',
              'SHOP' => 'Quán trả ship',
              _ => 'Khách trả ship',
            }),
          ], responsive: true),
          if (!offer.destinationKnown)
            const Padding(
              padding: EdgeInsets.only(top: N11Space.gap2),
              child: ReasonNote('Giao theo địa chỉ mô tả, không cần ghim. Chỉ shipper chưa có đơn khác nhận được.'),
            ),
          if (a != null) ...<Widget>[
            const SizedBox(height: N11Space.gap2),
            Container(
              key: const Key('m07-offer-agreement'),
              padding: const EdgeInsets.all(N11Space.gap3),
              decoration: BoxDecoration(color: N11Colors.yellowSoft, borderRadius: BorderRadius.circular(kRadiusControl)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Phí đề xuất ${m07Vnd(a.proposedVnd)}', style: N11Text.bodyStrong),
                  Text(
                    a.reasonNote == null || a.reasonNote!.isEmpty
                        ? 'Lý do: ${feeReasonLabel(a.reasonCode)}'
                        : 'Lý do: ${feeReasonLabel(a.reasonCode)} · ${a.reasonNote}',
                    style: N11Text.caption,
                  ),
                  if (a.state == 'COUNTERED')
                    Text(
                      'Bạn đã đề xuất ${m07Vnd(a.counterVnd)}, đang chờ ${offer.deciderText} (người trả phí) trả lời.',
                      key: const Key('m07-offer-waiting'),
                      style: N11Text.caption,
                    ),
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
                    N11Button(
                      key: const Key('m07-fee-counter'),
                      label: 'Đề xuất mức khác',
                      compact: true,
                      kind: ButtonKind.secondary,
                      onPressed: busy ? null : onCounter,
                    ),
                  ],
                ),
              ),
          ],
          if (n != null)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap2),
              child: ReasonNote(
                'Bạn đã đề xuất ${m07Vnd(n.offeredVnd)} (phí hiện tại ${m07Vnd(n.currentVnd)}), đang chờ ${n.deciderText} (người trả phí) trả lời.',
                key: const Key('m07-offer-waiting'),
              ),
            )
          else if (offer.canCounter && a?.state != 'PROPOSED')
            // A fee that is already settled (the fee table's, or an agreed one): the Shipper may still ask for another before taking it.
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap2),
              child: N11Button(
                key: const Key('m07-fee-counter'),
                label: 'Đề xuất mức phí khác',
                compact: true,
                kind: ButtonKind.secondary,
                onPressed: busy ? null : onCounter,
              ),
            ),
          if (!offer.eligible && offer.reasons.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap2),
              child: ReasonNote(m06ReasonText(offer.reasons.first)),
            ),
          if (offer.eligible && !pendingFee)
            const Padding(
              key: Key('m07-prescreen-note'),
              padding: EdgeInsets.only(top: N11Space.gap2),
              child: ReasonNote('Đủ điều kiện sơ bộ. Việc ghép với đơn bạn đang có được kiểm tra khi bạn bấm "Nhận đơn"; nếu không ghép được, đơn sẽ không được giữ cho bạn.'),
            ),
          if (pendingFee)
            const Padding(
              padding: EdgeInsets.only(top: N11Space.gap2),
              child: ReasonNote('Phí chưa chốt nên chưa nhận đơn được. Hãy đồng ý mức phí hoặc đề xuất mức khác.'),
            ),
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
    final bool missing = delivery.state.isActive && delivery.needsFee;
    return InkWell(
      key: Key('m07-mine-${delivery.deliveryId}'),
      borderRadius: BorderRadius.circular(kRadiusCard),
      onTap: onTap,
      child: N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[Text(delivery.code, style: N11Text.bodyStrong), N11Chip(chip.label, kind: chip.kind)]),
            const SizedBox(height: N11Space.gap2),
            Text('${delivery.pickup.shopName} → ${delivery.recipient.name}', style: N11Text.body),
            Text('Phí giao: ${m07Vnd(delivery.fee.amountVnd)}', style: N11Text.bodyStrong),
            if (missing) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: N11Chip('Cần nhập phí đã thỏa thuận', kind: ChipKind.warn)),
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
    case 'cancelled_by_system':
      return (label: 'Hệ thống hủy quá hạn', kind: ChipKind.neutral);
    case 'cancelled_by_shop':
      return (label: 'Quán đã hủy yêu cầu giao', kind: ChipKind.neutral);
    case 'fee_not_agreed':
      return (label: 'Phí không được đồng ý', kind: ChipKind.neutral);
  }
  return null;
}

// ---- S03 / S06 / S08: detail -----------------------------------------------------------------------------------------

/// "Đường đi đã lưu: ≈ 3,2 km · khoảng 12 phút" for the stored road; the minutes only when the server gave a positive duration.
String _shipRouteText(OrderRoute route) {
  final int? seconds = route.durationS;
  final String minutes = seconds == null || seconds <= 0 ? '' : ' · khoảng ${(seconds / 60).ceil()} phút';
  return 'Đường đi đã lưu: ≈ ${RouteDistance.text(route.distanceM)}$minutes';
}

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

  /// "Trao đổi đơn hàng" of the delivery this Shipper holds (the room of its order, or of the direct call). Held above the collapsible card.
  OrderChatController? _chat;

  OrderChatController? _chatFor(DeliveryView d) {
    final OrderChatApi? api = widget.source.chat;
    if (api == null) {
      return null;
    }
    final OrderChatController chat = _chat ??= OrderChatController(api: api, room: ChatRoomRef(ChatDoor.shipperDelivery, widget.deliveryId));
    chat.noteVersion(d.version);
    return chat;
  }

  @override
  void dispose() {
    _chat?.dispose();
    super.dispose();
  }

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
            ('Phí giao', m07Vnd(d.fee.amountVnd)),
          ]),
          const SizedBox(height: N11Space.gap2),
          const Text('Sau khi xác nhận, đơn chuyển sang "Đang giao". Phí bị khóa, bạn không hủy nhận được nữa. Nếu không giao được, hãy gọi quán để thống nhất.', style: N11Text.caption),
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

  /// Before the pickup (also after taking the delivery) the Shipper may ask for another fee; the payer answers, and the pickup waits for the answer.
  Future<void> _propose(DeliveryView d) async {
    final int? value = await askFeeProposal(context, currentFeeVnd: d.fee.amountVnd, deciderText: d.fee.payer == 'CUSTOMER' || d.fee.payer == 'RECIPIENT' ? 'khách' : 'quán');
    if (value == null || !mounted) {
      return;
    }
    if (await act('propose-${d.deliveryId}', (String key) => widget.source.feeCounter(d.deliveryId, amountVnd: value, key: key), onConflict: _reload)) {
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

  Future<void> _decideAddressChange(DeliveryView d, bool accept, String? reason) async {
    if (await act('address-change-decide-$accept', (String key) => widget.source.decideAddressChange(d.deliveryId, accept: accept, reason: reason, expectedVersion: d.addressChange?.version ?? 1, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _fee(DeliveryView d) async {
    final bool? changed = await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (BuildContext context) => ConfirmFeeScreen(source: widget.source, delivery: d)));
    if (changed == true) {
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
    // The stored road is drawn as it was saved (never recomputed), and only while this Shipper holds the delivery: the server sends its geometry only then.
    // Otherwise the road is empty and nothing is drawn.
    final List<List<double>> road = active ? (d.route?.points ?? const <List<double>>[]) : const <List<double>>[];
    final List<Widget> body = <Widget>[
      Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[Text(d.code, key: const Key('m07-ship-code'), style: N11Text.title), N11Chip(chip.label, kind: chip.kind)]),
      actionBanner(),
      if (d.addressChange != null)
        AddressChangeBanner(
          request: d.addressChange!,
          canDecide: d.allows('decide_address_change'),
          onAccept: busy ? null : () => _decideAddressChange(d, true, null),
          onReject: busy ? null : (String reason) => _decideAddressChange(d, false, reason),
        ),
      if (active && widget.locationSlot != null) widget.locationSlot!(context),
      if (widget.feedbackSlot != null && (d.state == DeliveryState.completed || d.state == DeliveryState.failed)) widget.feedbackSlot!(context, d),
      if (active && d.legacyReferenceOnly)
        const ReasonNote('Đơn cũ không có đường đi đã lưu. Khoảng cách và phí giữ như lúc đặt.', key: Key('m07-ship-route-legacy'), icon: Icons.history),
      if (active && d.needsFee)
        N11Banner(
          key: const Key('m07-missing-banner'),
          kind: BannerKind.warn,
          title: 'Phí giao chưa được chốt',
          text: 'Hãy nhập mức phí bạn đã thống nhất với bên trả phí, rồi nhận hàng. Sau khi nhận hàng phí bị khóa.',
          icon: Icons.payments_outlined,
        ),
      if (active && d.fee.negotiation != null)
        N11Banner(
          key: const Key('m07-fee-waiting-banner'),
          kind: BannerKind.info,
          title: 'Đang chờ trả lời mức phí',
          text:
              'Bạn đã đề xuất ${m07Vnd(d.fee.negotiation!.offeredVnd)} (phí hiện tại ${m07Vnd(d.fee.negotiation!.currentVnd)}). Chưa nhận hàng được cho đến khi ${d.fee.negotiation!.deciderText} đồng ý. Nếu không được đồng ý hoặc quá hạn, bạn không còn giữ đơn này và đơn tiếp tục tìm shipper khác.',
          icon: Icons.hourglass_top_outlined,
        ),
      if (d.state == DeliveryState.delivering || d.state == DeliveryState.pickedUp)
        const N11Banner(
          key: Key('m07-after-pickup-note'),
          kind: BannerKind.info,
          title: 'Đã lấy hàng',
          text: 'Chỉ cần bấm "Giao thành công" khi đã giao xong. Nếu không giao được, hãy gọi quán để thống nhất; chỉ người tạo đơn mới hủy được.',
          icon: Icons.phone_in_talk_outlined,
        ),
      // #191 (18/11): thẻ 1 "Người gửi & nhận" — mỗi bên một lần tên, một lần số, một nút Gọi ngay cạnh bên đó.
      if (active)
        OrderSection(
          id: 'ship-parties',
          title: 'Người gửi & nhận',
          summary: 'Quán lấy hàng · Người nhận',
          initiallyExpanded: true,
          builder: (BuildContext _) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _partyRow(key: 'm07-pickup-card', role: 'Quán lấy hàng', name: d.pickup.shopName, phone: d.pickup.phone, who: 'quán', lines: <String>[if (d.pickup.addressText != null) 'Địa chỉ: ${d.pickup.addressText}']),
              const SizedBox(height: N11Space.gap3),
              const Divider(height: 1, thickness: 1, color: N11Colors.line),
              const SizedBox(height: N11Space.gap3),
              _partyRow(key: 'm07-recipient-card', role: 'Người nhận', name: d.recipient.name, phone: d.recipient.phone, who: 'người nhận', lines: <String>['Địa chỉ: ${d.recipient.addressText ?? '—'}', if (d.dropoffNote != null && d.dropoffNote!.isNotEmpty) 'Hướng dẫn tìm đường: ${d.dropoffNote!}']),
            ],
          ),
        ),
      // #191 (18/11): thẻ 2 "Thông tin đơn" — hàng, ghi chú, tiền/phí, rồi bản đồ (mở rộng được) và quãng đường đã lưu.
      OrderSection(
        id: 'ship-order-info',
        title: 'Thông tin đơn',
        summary: d.goods.description,
        initiallyExpanded: true,
        builder: (BuildContext _) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            KeyValueRows(<(String, String)>[('Hàng', d.goods.description), if (d.note != null && d.note!.isNotEmpty) ('Ghi chú', d.note!)]),
            const SizedBox(height: N11Space.gap3),
            MoneySummary(goods: d.goods, fee: d.fee),
            const SizedBox(height: N11Space.gap3),
            if (active && widget.mapBuilder != null && pins.isNotEmpty)
              OrderSection(id: 'ship-map', title: 'Bản đồ giao hàng', summary: 'Chạm để xem bản đồ', builder: (BuildContext context) => SizedBox(key: const Key('m07-ship-map'), height: 220, child: ClipRRect(borderRadius: BorderRadius.circular(kRadiusCard), child: widget.mapBuilder!(context, pins, road)))),
            // Issue #393: two pins but no stored road: no line, and the screen says so (a legacy record already has its own note below).
            if (active && widget.mapBuilder != null && pins.isNotEmpty && road.isEmpty && !d.legacyReferenceOnly)
              const ReasonNote('Chưa có tuyến đường đi.', key: Key('m07-ship-route-missing'), icon: Icons.route_outlined),
            // The stored road's distance and time, shown only together with the road itself. A delivery without one (DIRECT call, released or waiting for a
            // Shipper, or an old record) says nothing about distance, so no new figure is attached to the fee in force.
            if (road.isNotEmpty && d.route != null) Text(_shipRouteText(d.route!), key: const Key('m07-ship-route'), style: N11Text.body),
          ],
        ),
      ),
      if (active || d.state == DeliveryState.completed)
        if (_chatFor(d) case final OrderChatController chat)
          ListenableBuilder(
            listenable: chat,
            builder: (BuildContext context, Widget? _) => OrderSection(id: 'chat', title: 'Trao đổi đơn hàng', summary: chat.summary, initiallyExpanded: true, builder: (BuildContext _) => OrderChatPanel(controller: chat)),
          ),
      if (!active) _result(d),
      // #191 (18/11): "Xử lý sự cố" là trợ giúp phụ cuối nội dung, đóng mặc định; không có nút "Gọi Khách" (đã có Gọi ở thẻ Người nhận).
      OrderIncidentGuidance(
        role: 'SHIPPER',
        deliveryState: d.state.name,
        hasShipper: true,
        customerPhone: d.recipient.phone,
        shopPhone: d.pickup.phone,
        onCallShop: d.pickup.phone != null ? () => orderPhoneDialer.dial(d.pickup.phone!) : null,
        feePending: d.fee.negotiation != null,
        incident: d.incident,
        isAfterPickup: d.state == DeliveryState.delivering || d.state == DeliveryState.pickedUp,
      ),
    ];
    return M07PageParts(body, bottom: active ? _bottom(d) : null);
  }

  Widget _partyRow({required String key, required String role, required String name, String? phone, required String who, required List<String> lines}) {
    final String? shown = phone == null ? null : (dialNumberText(phone) ?? phone);
    return KeyedSubtree(
      key: Key(key),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(role, style: N11Text.caption),
                Text(name, style: N11Text.bodyStrong),
                if (shown != null) Text(shown, key: Key('party-$who-phone'), style: N11Text.body),
                for (final String line in lines) Text(line, style: N11Text.caption),
              ],
            ),
          ),
          QuickCall(phone: phone, who: who),
        ],
      ),
    );
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
    } else {
      if (d.needsFee) {
        actions.add(N11Button(key: const Key('m07-confirm-fee'), label: 'Nhập phí đã thỏa thuận', icon: Icons.payments_outlined, onPressed: busy ? null : () => _fee(d)));
      }
      if (d.allows('pickup')) {
        actions.add(N11Button(key: const Key('m07-pickup'), label: 'Đã nhận hàng', icon: Icons.inventory_2_outlined, loading: busy, onPressed: busy ? null : () => _pickup(d)));
      }
      if (d.allows('propose_fee')) {
        actions.add(N11Button(key: const Key('m07-propose-fee'), label: 'Đề xuất mức phí khác', icon: Icons.edit_outlined, kind: ButtonKind.secondary, onPressed: busy ? null : () => _propose(d)));
      }
      if (d.allows('release')) {
        actions.add(DangerButton(key: const Key('m07-release'), label: 'Hủy nhận đơn', outlined: false, onPressed: busy ? null : () => _release(d)));
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

// ---- S04: confirm the fee --------------------------------------------------------------------------------------------

/// Only for a call whose fee was never settled (`can.confirm_fee`): the Shipper enters the amount agreed with whoever pays. Nothing else is asked:
/// no map point, no second confirmation of data the server already holds.
class ConfirmFeeScreen extends StatefulWidget {
  const ConfirmFeeScreen({super.key, required this.source, required this.delivery});

  final ShipperDeliverySource source;
  final DeliveryView delivery;

  @override
  State<ConfirmFeeScreen> createState() => _ConfirmFeeScreenState();
}

class _ConfirmFeeScreenState extends State<ConfirmFeeScreen> with M07Actions<ConfirmFeeScreen> {
  final TextEditingController _fee = TextEditingController();
  String? _problem;

  @override
  void dispose() {
    _fee.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final int? fee = parseAgreedFee(_fee.text);
    final String? problem = fee == null ? 'Hãy nhập phí đã thỏa thuận (số nguyên, tối đa 10.000.000đ).' : null;
    setState(() => _problem = problem);
    if (fee == null) {
      return;
    }
    final bool ok = await act('fee-${widget.delivery.deliveryId}', (String key) => widget.source.confirmFee(widget.delivery.deliveryId, feeVnd: fee, expectedVersion: widget.delivery.version, key: key));
    if (ok && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final DeliveryView d = widget.delivery;
    return m07Page(
      'Phí giao',
      widget.source.isSample,
      <Widget>[
        N11Card(child: KeyValueRows(<(String, String)>[('Người nhận', d.recipient.name), ('Địa chỉ', d.recipient.addressText ?? '—'), ('Người trả phí', d.fee.payerText)], responsive: true)),
        N11Field(validator: (String value) => parseAgreedFee(value) == null ? 'Nhập phí là số nguyên từ 0 đến 10.000.000đ.' : null, fieldKey: const Key('m07-agreed-fee'), label: 'Phí thỏa thuận (đ)', controller: _fee, keyboard: TextInputType.number, maxLength: 10, hint: 'Phí bạn và bên trả phí đã thống nhất. Sau khi nhận hàng sẽ bị khóa.'),
        if (_problem != null) N11Banner(key: const Key('m07-fee-problem'), kind: BannerKind.error, title: 'Chưa xác nhận được', text: _problem),
        actionBanner(),
      ],
      bottom: N11Button(key: const Key('m07-fee-submit'), validate: true, label: 'Xác nhận phí', loading: busy, onPressed: busy ? null : _submit),
    );
  }
}

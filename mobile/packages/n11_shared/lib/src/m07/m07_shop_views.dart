import '../guidance/order_incident_guidance.dart';
import 'dart:async';

import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/shop_order_filters.dart';
import '../m10/order_chat_models.dart';
import '../m10/order_chat_view.dart';
import '../m10/order_sections.dart';
import 'm07_models.dart';
import 'm07_source.dart';
import 'm07_widgets.dart';

// 11Food, the shop's side of M07 (screens Q01-Q08 of docs/current/M07-implementation-20261018.md):
//   Q01 ShopDeliveryHub        list: "Đang xử lý" / "Lịch sử", search by code or recipient (historical DIRECT)
//   Q03-Q08 ShopDeliveryDetailScreen   one screen that shows the state the server reports:
//        Q03 searching (server timer, 5/15/30 marks, cancel)   Q04 accepted (Shipper, cancel)   Q05 delivering (status; cancel only for the creator)
//        Q06 search stopped (call again / cancel)   Q07 result and timeline (read only)   Q08 goods handling after a cancelled-after-pickup request
// Owner decision 2026-10-23: a DIRECT call has a described address only (no map point, no tracking of the Shipper's route); its fee comes from a band
// of the fee table the shop chose (an estimate) or from an agreed amount. After pickup ONLY the creator can cancel: here the shop of a DIRECT call;
// the shop of a customer's order never can (the customer does, in 11Food). Cancelling a delivery never cancels the food order.

const String kCancelExplain = 'Yêu cầu giao sẽ kết thúc, shipper (nếu đã nhận) được giải phóng và hệ thống ngừng tìm. Không tự hủy đơn món.';
const String kCancelAfterPickupExplain = 'Shipper đã lấy hàng. Hủy bây giờ thì yêu cầu giao kết thúc, hoa hồng của shipper không bị thu, và hàng vẫn ở shipper cho tới khi bạn xác nhận đã nhận lại hoặc đã xử lý.';

String _short(String text, int max) => text.length <= max ? text : '${text.substring(0, max - 1)}…';

// ---- Q01: list -------------------------------------------------------------------------------------------------------

class ShopDeliveryHub extends StatefulWidget {
  const ShopDeliveryHub({super.key, required this.source, this.mapBuilder, this.pinPicker, this.feedbackSlot});

  final ShopDeliverySource source;
  final M07MapBuilder? mapBuilder;
  final M07PinPickerBuilder? pinPicker;
  final M07FeedbackSlot? feedbackSlot;

  @override
  State<ShopDeliveryHub> createState() => _ShopDeliveryHubState();
}

const List<ShopOrderFilterChoice> _deliveryStatusOptions = <ShopOrderFilterChoice>[
  (value: 'all', label: 'Tất cả'),
  (value: 'searching', label: 'Đang tìm shipper'),
  (value: 'accepted', label: 'Shipper đã nhận'),
  (value: 'delivering', label: 'Đang giao'),
  (value: 'completed', label: 'Hoàn thành'),
  (value: 'failed', label: 'Không thành công / Đã hủy'),
];

class _ShopDeliveryHubState extends State<ShopDeliveryHub> {
  ShopOrderFilters _filters = const ShopOrderFilters();
  final TextEditingController _query = TextEditingController();
  String _applied = '';
  int _offset = 0;
  Timer? _debounce;
  int _rev = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted && value.trim() != _applied) {
        setState(() { _applied = value.trim(); _offset = 0; });
      }
    });
  }

  Future<void> _chooseFilters() async {
    final ShopOrderFilters? next = await showShopOrderFilters(
      context,
      current: _filters,
      statuses: _deliveryStatusOptions,
    );
    if (mounted && next != null) setState(() { _filters = next; _offset = 0; });
  }

  void _reset() {
    _debounce?.cancel();
    _query.clear();
    setState(() {
      _filters = const ShopOrderFilters();
      _applied = '';
      _offset = 0;
    });
  }

  Future<void> _open(DeliveryView delivery) async {
    await Navigator.of(context).push(n11Route(ShopDeliveryDetailScreen(source: widget.source, deliveryId: delivery.deliveryId, mapBuilder: widget.mapBuilder, pinPicker: widget.pinPicker, feedbackSlot: widget.feedbackSlot)));
    if (mounted) setState(() => _rev++);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.source.isSample) const Padding(padding: EdgeInsets.only(bottom: N11Space.gap3), child: M07SampleBanner()),
        Row(children: <Widget>[
          Expanded(
            child: TextField(
              key: const Key('m07-search'),
              controller: _query,
              textInputAction: TextInputAction.search,
              onChanged: _onSearchChanged,
              onSubmitted: (String value) {
                _debounce?.cancel();
                setState(() => _applied = value.trim());
              },
              decoration: InputDecoration(
                hintText: 'Tìm mã đơn hoặc tên người nhận',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: N11Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line)),
              ),
            ),
          ),
          const SizedBox(width: N11Space.gap2),
          IconButton(
            key: const Key('m07-filter'),
            tooltip: 'Lọc trạng thái và ngày',
            onPressed: _chooseFilters,
            icon: Stack(clipBehavior: Clip.none, children: <Widget>[
              const Icon(Icons.filter_list),
              if (_filters.isActive) const Positioned(right: -3, top: -3, child: CircleAvatar(radius: 4, backgroundColor: Colors.orange)),
            ]),
          ),
        ]),
        const SizedBox(height: N11Space.gap3),
        M07Loader<List<DeliveryView>>(
          key: ValueKey<String>('m07|${_filters.status}|$_applied|${_filters.from?.toIso8601String()}|${_filters.toExclusive?.toIso8601String()}|$_rev|$_offset'),
          keyPrefix: 'm07-list',
          refreshEvery: const Duration(seconds: 20),
          load: () => widget.source.listFiltered(filter: _filters.status, query: _applied, from: _filters.from, to: _filters.toExclusive, offset: _offset),
          isEmpty: (List<DeliveryView> items) => items.isEmpty,
          emptyIcon: Icons.two_wheeler,
          emptyTitle: 'Không có đơn phù hợp',
          emptyText: 'Hãy thử tìm kiếm hoặc thay đổi bộ lọc.',
          builder: (BuildContext context, List<DeliveryView> items, Future<void> Function() reload) => Column(
            children: <Widget>[
              for (final DeliveryView delivery in items)
                Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: _DeliveryCard(delivery: delivery, onTap: () => _open(delivery))),
              if (items.length == 50)
                TextButton(
                  key: const Key('m07-page-next'),
                  onPressed: () => setState(() => _offset += 50),
                  child: const Text('Trang sau'),
                ),
            ],
          ),
        ),
        if (_offset > 0) TextButton(
          key: const Key('m07-page-previous'),
          onPressed: () => setState(() => _offset -= 50),
          child: Text('Trang trước · Trang ${_offset ~/ 50 + 1}'),
        ),
        if (_filters.isActive || _applied.isNotEmpty)
          TextButton(key: const Key('m07-clear-filters'), onPressed: _reset, child: const Text('Xóa bộ lọc')),
      ],
    );
  }
}

class _DeliveryCard extends StatelessWidget {
  const _DeliveryCard({required this.delivery, required this.onTap});

  final DeliveryView delivery;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ({String label, ChipKind kind}) chip = m07StateChip(delivery.state);
    return InkWell(
      key: Key('m07-card-${delivery.deliveryId}'),
      borderRadius: BorderRadius.circular(kRadiusCard),
      onTap: onTap,
      child: N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(child: Text(delivery.code, style: N11Text.bodyStrong)),
                N11Chip(chip.label, kind: chip.kind),
              ],
            ),
            const SizedBox(height: N11Space.gap2),
            Text('${delivery.recipient.name} · ${_short(delivery.goods.description, 40)}', style: N11Text.body),
            const SizedBox(height: N11Space.gap1),
            Text('Phí giao: ${m07Vnd(delivery.fee.amountVnd)} · ${delivery.fee.payerText}', style: N11Text.caption),
            if (m07NeedsAttention(delivery)) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: N11Chip('Cần xử lý', kind: ChipKind.bad)),
          ],
        ),
      ),
    );
  }
}

// ---- the delivery part of a page: shipper, fee talks, goods handling -------------------------------------------------

/// What the shop does about ONE delivery, as a part of a page: the search clock, the fee agreement (answer a Shipper's other price, confirm for the customer),
/// the Shipper, the position, the goods handling after a failed delivery, and (when [allowCancel]) ending only the request. The direct delivery page and the
/// food order page both draw it, so a delivery has one set of actions wherever it is read. The server decides what is allowed (`can`); nothing here does.
class ShopDeliveryPanel extends StatefulWidget {
  const ShopDeliveryPanel({super.key, required this.source, required this.delivery, required this.onChanged, this.mapBuilder, this.feedbackSlot, this.allowCancel = false, this.showLocation = true});

  final ShopDeliverySource source;
  final DeliveryView delivery;

  /// Called after an action succeeded (or hit a conflict): the page reloads and gives a fresh [delivery].
  final Future<void> Function() onChanged;
  final M07MapBuilder? mapBuilder;
  final M07FeedbackSlot? feedbackSlot;
  final bool allowCancel;

  /// False when the page draws the map and the position itself (the food order page).
  final bool showLocation;

  @override
  State<ShopDeliveryPanel> createState() => _ShopDeliveryPanelState();
}

class _ShopDeliveryPanelState extends State<ShopDeliveryPanel> with M07Actions<ShopDeliveryPanel> {
  Future<void> _reload() => widget.onChanged();

  Future<void> _cancel(DeliveryView d) async {
    final bool afterPickup = d.allows('cancel_after_pickup');
    final String? reason = await showReasonDialog(context, title: afterPickup ? 'Hủy giao khi shipper đã lấy hàng?' : 'Hủy yêu cầu giao?', explanation: afterPickup ? kCancelAfterPickupExplain : kCancelExplain, confirmLabel: 'Xác nhận hủy');
    if (reason == null || !mounted) {
      return;
    }
    if (await act('cancel-${d.deliveryId}', (String key) => widget.source.cancel(d.deliveryId, reason: reason, expectedVersion: d.version, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _counter(DeliveryView d, bool accept) async {
    if (await act('counter-${d.deliveryId}-$accept', (String key) => widget.source.answerCounter(d.deliveryId, accept: accept, expectedVersion: d.version, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _customerAgreed(DeliveryView d) async {
    if (await act('customer-${d.deliveryId}', (String key) => widget.source.confirmCustomerFee(d.deliveryId, expectedVersion: d.version, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _custody(DeliveryView d, String resolution) async {
    String? note;
    if (resolution == 'HANDLED_NO_RETURN') {
      note = await showReasonDialog(context,
          title: 'Đã xử lý, không giao tiếp?', explanation: 'Đóng hồ sơ xử lý hàng. Ghi lại hàng đã được xử lý thế nào.', confirmLabel: 'Xác nhận', reasonLabel: 'Ghi chú xử lý', danger: false);
      if (note == null || !mounted) {
        return;
      }
    } else {
      final bool yes = await showConfirmDialog(context,
          title: 'Hàng đã về quán?', content: const Text('Xác nhận hàng đã về và sẵn sàng tại quán. Sau đó có thể gọi shipper lại.', style: N11Text.lead), confirmLabel: 'Xác nhận hàng đã về');
      if (!yes || !mounted) {
        return;
      }
    }
    if (await act('custody-${d.deliveryId}-$resolution', (String key) => widget.source.resolveCustody(d.deliveryId, resolution: resolution, note: note, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final DeliveryView d = widget.delivery;
    final bool ended = d.state == DeliveryState.completed || d.state == DeliveryState.failed || d.state == DeliveryState.cancelledByMerchant;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        actionBanner(),
        for (final Widget w in _byState(d)) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: w),
        if (widget.allowCancel && d.allows('cancel')) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: DangerButton(key: const Key('m07-cancel'), label: 'Hủy yêu cầu giao', onPressed: busy ? null : () => _cancel(d))),
        if (widget.feedbackSlot != null && ended) widget.feedbackSlot!(context, d),
      ],
    );
  }

  List<Widget> _byState(DeliveryView d) {
    switch (d.state) {
      case DeliveryState.waitingDriver:
        return <Widget>[SearchTimerCard(search: d.search), ..._feeNegotiationCards(d), ..._feeAgreementCards(d)];
      case DeliveryState.accepted:
      case DeliveryState.locationConfirmed:
        return <Widget>[_shipperCard(d), ..._feeNegotiationCards(d), _statusCard(d), if (widget.showLocation && d.source == 'ORDER') LocationCard(location: d.location, mapBuilder: widget.mapBuilder)];
      case DeliveryState.pickedUp:
      case DeliveryState.delivering:
        return <Widget>[
          _shipperCard(d),
          // A DIRECT call is followed by its status only; the Shipper's route is shown for a customer's order.
          if (widget.showLocation && d.source == 'ORDER') LocationCard(location: d.location, mapBuilder: widget.mapBuilder),
          ReasonNote(d.allows('cancel_after_pickup')
              ? 'Shipper đã lấy hàng. Bạn là người tạo yêu cầu nên có thể hủy nếu không giao nữa; phí không sửa được. Nếu shipper báo không giao được, hãy gọi để thống nhất.'
              : 'Shipper đã lấy hàng. Phí không sửa được. Đơn này do khách đặt nên chỉ khách mới hủy được; nếu cần, hãy gọi shipper để thống nhất.'),
        ];
      case DeliveryState.searchStopped:
        return <Widget>[
          const N11Banner(key: Key('m07-stopped'), kind: BannerKind.warn, title: 'Đã ngừng tìm shipper', text: 'Đã hết thời gian tìm nhưng chưa có shipper. Đơn món sẽ tự hủy nếu quá thời hạn xử lý.', icon: Icons.timer_off_outlined),
        ];
      case DeliveryState.completed:
      case DeliveryState.failed:
      case DeliveryState.cancelledBySystem:
      case DeliveryState.cancelledByMerchant:
        return <Widget>[if (d.assignment != null) _shipperCard(d), if (d.incident != null) _incidentCard(d)];
    }
  }

  /// A Shipper asks for another fee than the one in force (the fee table's, or an agreed one), also after taking the delivery: the payer answers. Who that is comes from the
  /// server (`can.decide_fee` = the shop, for a payer without an app in the log as "thay khách"; `can.wait_customer_fee` = the customer in 11Food).
  List<Widget> _feeNegotiationCards(DeliveryView d) {
    final FeeNegotiation? n = d.fee.negotiation;
    if (n == null) {
      return <Widget>[];
    }
    return <Widget>[
      N11Card(
        key: const Key('m07-fee-negotiation'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Shipper đề xuất đổi phí giao', style: N11Text.label),
            KeyValueRows(<(String, String)>[('Phí hiện tại', m07Vnd(n.currentVnd)), ('Shipper đề xuất', m07Vnd(n.offeredVnd))]),
            if (d.allows('wait_customer_fee')) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const ReasonNote('Khách là người trả phí nên khách quyết định mức này trong 11Food. Bạn chỉ cần chờ.', key: Key('m07-wait-customer-fee')),
            ] else if (d.allows('decide_fee')) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              ReasonNote(d.fee.payer == 'CUSTOMER'
                  ? 'Khách trả ship: hãy liên hệ khách trước. Bấm Đồng ý nghĩa là quán xác nhận thay khách, hệ thống sẽ ghi lại như vậy. Từ chối thì giữ mức hiện tại; shipper đang giữ đơn sẽ không còn giữ đơn và đơn tiếp tục tìm shipper khác.'
                  : 'Từ chối thì giữ mức hiện tại; shipper đang giữ đơn (nếu có) sẽ không còn giữ đơn và đơn tiếp tục tìm shipper khác, thời gian tìm không tính lại.'),
              const SizedBox(height: N11Space.gap2),
              Row(
                children: <Widget>[
                  Expanded(child: N11Button(key: const Key('m07-counter-accept'), label: 'Đồng ý', onPressed: busy ? null : () => _counter(d, true))),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(child: N11Button(key: const Key('m07-counter-reject'), label: 'Từ chối', kind: ButtonKind.secondary, onPressed: busy ? null : () => _counter(d, false))),
                ],
              ),
            ],
          ],
        ),
      ),
    ];
  }

  List<Widget> _feeAgreementCards(DeliveryView d) {
    final AgreementSummary? a = d.fee.agreement;
    if (a == null) {
      return <Widget>[];
    }
    return <Widget>[
      N11Card(
        key: const Key('m07-agreement'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Phí thỏa thuận', style: N11Text.label),
            KeyValueRows(<(String, String)>[
              ('Mức đề xuất', m07Vnd(a.proposedVnd)),
              if (a.counterVnd != null) ('Shipper đề xuất lại', m07Vnd(a.counterVnd)),
              ('Lý do', _reasonText(a.reasonCode)),
              ('Trạng thái', _agreementText(a.state)),
            ]),
            // Who answers is the server's call: for an order the customer pays, the customer decides in 11Food and the shop only waits.
            if (d.allows('wait_customer_fee') && (a.state == 'COUNTERED' || a.state == 'AWAITING_CUSTOMER')) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const ReasonNote('Khách là người trả phí nên khách quyết định mức này trong 11Food. Bạn chỉ cần chờ.', key: Key('m07-wait-customer-fee')),
            ] else if (a.state == 'COUNTERED' && d.allows('decide_fee')) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              ReasonNote(d.fee.payer == 'CUSTOMER'
                  ? 'Khách trả ship: hãy liên hệ khách trước. Bấm Đồng ý nghĩa là quán xác nhận thay khách, hệ thống sẽ ghi lại như vậy. Từ chối thì giữ mức ban đầu và tiếp tục tìm shipper khác.'
                  : 'Từ chối thì giữ mức đề xuất ban đầu và tiếp tục tìm shipper khác, thời gian tìm không tính lại.'),
              const SizedBox(height: N11Space.gap2),
              Row(
                children: <Widget>[
                  Expanded(child: N11Button(key: const Key('m07-counter-accept'), label: 'Đồng ý', onPressed: busy ? null : () => _counter(d, true))),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(child: N11Button(key: const Key('m07-counter-reject'), label: 'Từ chối', kind: ButtonKind.secondary, onPressed: busy ? null : () => _counter(d, false))),
                ],
              ),
            ],
            if (a.state == 'AWAITING_CUSTOMER' && d.allows('decide_fee')) ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const ReasonNote('Khách trả ship nên mức này cần khách đồng ý. Chỉ bấm khi bạn đã liên hệ và khách đồng ý; hệ thống ghi là quán xác nhận thay khách.'),
              const SizedBox(height: N11Space.gap2),
              N11Button(key: const Key('m07-customer-agreed'), label: 'Khách đã đồng ý mức phí', onPressed: busy ? null : () => _customerAgreed(d)),
            ],
          ],
        ),
      ),
    ];
  }

  Widget _shipperCard(DeliveryView d) {
    final AssignmentView? a = d.assignment;
    if (a == null) {
      return const SizedBox.shrink();
    }
    // The Shipper who holds the delivery: name, state and the number with "Gọi" stay visible when the card is closed (the server sends the phone only while the
    // assignment is active, so a released Shipper never shows up here).
    return OrderSection(
      id: 'shipper',
      title: 'Shipper',
      summary: '${a.shipperName} · ${d.state.label}',
      initiallyExpanded: true,
      trailing: QuickCall(phone: a.shipperPhone, who: 'shipper'),
      builder: (BuildContext _) => Container(
        key: const Key('m07-shipper-card'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            ContactRow(name: a.shipperName, detail: a.plateNumber == null ? null : 'Biển số ${a.plateNumber}', phone: a.shipperPhone, who: 'shipper', showCall: false),
            KeyValueRows(<(String, String)>[
              ('Nhận lúc', m07Hm(a.acceptedAt)),
              if (a.pickedUpAt != null) ('Lấy hàng lúc', m07Hm(a.pickedUpAt!)),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _statusCard(DeliveryView d) => N11Card(
        child: Row(
          children: <Widget>[
            const Icon(Icons.hourglass_bottom, color: N11Colors.ink2),
            const SizedBox(width: N11Space.gap3),
            Expanded(child: Text(d.assignment?.destinationConfirmed ?? false ? 'Shipper đang đến lấy hàng' : 'Chờ shipper chốt phí rồi lấy hàng', style: N11Text.bodyStrong)),
          ],
        ),
      );

  Widget _incidentCard(DeliveryView d) {
    final IncidentView i = d.incident!;
    return N11Card(
      key: const Key('m07-incident'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[const Expanded(child: Text('Xử lý hàng', style: N11Text.label)), N11Chip(i.isOpen ? 'Đang mở' : 'Đã đóng', kind: i.isOpen ? ChipKind.bad : ChipKind.ok)]),
          KeyValueRows(<(String, String)>[(d.state == DeliveryState.failed ? 'Lý do giao thất bại' : 'Lý do hủy', i.reason), ('Hàng hiện ở', i.custodyText)]),
          if (i.isOpen) ...<Widget>[
            const SizedBox(height: N11Space.gap2),
            const ReasonNote('Hàng ở tay ai người đó chịu trách nhiệm. Giao thất bại không có nghĩa hàng đã về quán. Chưa gọi lại cùng hàng được khi hàng chưa về quán.'),
            const SizedBox(height: N11Space.gap3),
            N11Button(key: const Key('m07-custody-returned'), label: 'Xác nhận hàng đã về quán', onPressed: busy ? null : () => _custody(d, 'GOODS_RETURNED')),
            const SizedBox(height: N11Space.gap2),
            N11Button(key: const Key('m07-custody-handled'), label: 'Đã xử lý, không giao tiếp', kind: ButtonKind.secondary, onPressed: busy ? null : () => _custody(d, 'HANDLED_NO_RETURN')),
          ],
        ],
      ),
    );
  }
}

// ---- Q03-Q08: detail -------------------------------------------------------------------------------------------------

class ShopDeliveryDetailScreen extends StatefulWidget {
  const ShopDeliveryDetailScreen({super.key, required this.source, required this.deliveryId, this.mapBuilder, this.pinPicker, this.feedbackSlot});

  final ShopDeliverySource source;
  final String deliveryId;
  final M07MapBuilder? mapBuilder;
  final M07PinPickerBuilder? pinPicker;
  final M07FeedbackSlot? feedbackSlot;

  @override
  State<ShopDeliveryDetailScreen> createState() => _ShopDeliveryDetailScreenState();
}

class _ShopDeliveryDetailScreenState extends State<ShopDeliveryDetailScreen> with M07Actions<ShopDeliveryDetailScreen> {
  final GlobalKey<M07DetailPageState<DeliveryView>> _page = GlobalKey<M07DetailPageState<DeliveryView>>();

  /// "Trao đổi đơn hàng" of a direct call: the delivery itself is the file (no order is made). Created on the first read, kept above the collapsible card.
  OrderChatController? _chat;

  OrderChatController? _chatFor(DeliveryView d) {
    final OrderChatApi? api = widget.source.chat;
    if (api == null) {
      return null;
    }
    final OrderChatController chat = _chat ??= OrderChatController(api: api, room: d.orderId != null ? ChatRoomRef(ChatDoor.shopOrder, d.orderId!) : ChatRoomRef(ChatDoor.shopDirect, d.deliveryId));
    chat.noteVersion(d.version);
    return chat;
  }

  @override
  void dispose() {
    _chat?.dispose();
    super.dispose();
  }

  Future<void> _reload() async => _page.currentState?.fetcher.reload(quiet: true);

  Future<void> _cancel(DeliveryView d) async {
    final bool afterPickup = d.allows('cancel_after_pickup');
    final String? reason = await showReasonDialog(context, title: afterPickup ? 'Hủy giao khi shipper đã lấy hàng?' : 'Hủy yêu cầu giao?', explanation: afterPickup ? kCancelAfterPickupExplain : kCancelExplain, confirmLabel: 'Xác nhận hủy');
    if (reason == null || !mounted) {
      return;
    }
    if (await act('cancel-${d.deliveryId}', (String key) => widget.source.cancel(d.deliveryId, reason: reason, expectedVersion: d.version, key: key), onConflict: _reload)) {
      await _reload();
    }
  }

  Future<void> _recall(DeliveryView d) async {
    DeliveryView? fresh;
    if (await act('recall-${d.deliveryId}', (String key) async => fresh = await widget.source.recall(d.deliveryId, key: key), onConflict: _reload) && mounted && fresh != null) {
      await Navigator.of(context).pushReplacement(n11Route(ShopDeliveryDetailScreen(source: widget.source, deliveryId: fresh!.deliveryId, mapBuilder: widget.mapBuilder, pinPicker: widget.pinPicker, feedbackSlot: widget.feedbackSlot)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return M07DetailPage<DeliveryView>(
      key: _page,
      title: 'Yêu cầu giao',
      sample: widget.source.isSample,
      keyPrefix: 'm07-detail',
      load: () => widget.source.get(widget.deliveryId),
      builder: (BuildContext context, DeliveryView d, Future<void> Function() reload) => _parts(context, d),
    );
  }

  M07PageParts _parts(BuildContext context, DeliveryView d) {
    final ({String label, ChipKind kind}) chip = m07StateChip(d.state);
    final List<Widget> body = <Widget>[
      Row(
        children: <Widget>[
          Expanded(child: Text(d.code, key: const Key('m07-detail-code'), style: N11Text.title)),
          N11Chip(chip.label, kind: chip.kind),
        ],
      ),
      actionBanner(),
      OrderIncidentGuidance(
        role: 'SHOP',
        deliveryState: d.state.name,
        hasShipper: d.assignment != null,
        customerPhone: d.recipient.phone,
        shipperPhone: d.assignment?.shipperPhone,
        onCallCustomer: d.recipient.phone != null ? () => orderPhoneDialer.dial(d.recipient.phone!) : null,
        onCallShipper: d.assignment?.shipperPhone != null ? () => orderPhoneDialer.dial(d.assignment!.shipperPhone!) : null,
        incident: d.incident,
        isAfterPickup: d.state == DeliveryState.delivering || d.state == DeliveryState.pickedUp,
      ),
      ShopDeliveryPanel(source: widget.source, delivery: d, onChanged: _reload, mapBuilder: widget.mapBuilder),
      _recipientCard(d),
      MoneySummary(goods: d.goods, fee: d.fee),
      if (widget.feedbackSlot != null && (d.state == DeliveryState.completed || d.state == DeliveryState.failed || d.state == DeliveryState.cancelledByMerchant)) widget.feedbackSlot!(context, d),
      if (d.previousDeliveryId != null) const N11Card(child: Text('Đây là lần gọi lại. Lần gọi trước vẫn nằm trong lịch sử.', style: N11Text.caption)),
      if (_chatFor(d) case final OrderChatController chat)
        ListenableBuilder(
          listenable: chat,
          builder: (BuildContext context, Widget? _) => OrderSection(id: 'chat', title: 'Trao đổi đơn hàng', summary: chat.summary, initiallyExpanded: true, builder: (BuildContext _) => OrderChatPanel(controller: chat)),
        ),
    ];
    return M07PageParts(body, bottom: _bottom(d));
  }

  /// The recipient of the call, with "Gọi" next to the name while the request is running (the shop typed this number itself).
  Widget _recipientCard(DeliveryView d) => OrderSection(
        id: 'recipient',
        title: 'Người nhận',
        summary: '${d.recipient.name} · ${d.recipient.addressText ?? '—'}',
        initiallyExpanded: d.state.isActive,
        trailing: d.state.isActive ? QuickCall(phone: d.recipient.phone, who: 'người nhận') : null,
        builder: (BuildContext _) => Column(
          key: const Key('m07-recipient'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            KeyValueRows(<(String, String)>[
              ('Tên', d.recipient.name),
              if (d.recipient.phone != null) ('Điện thoại', d.recipient.phone!),
              ('Địa chỉ', d.recipient.addressText ?? '—'),
              ('Hàng', d.goods.description),
            ]),
          ],
        ),
      );

  Widget? _bottom(DeliveryView d) {
    final List<Widget> actions = <Widget>[
      if (d.allows('recall')) N11Button(key: const Key('m07-recall'), label: 'Gọi lại shipper', icon: Icons.refresh, loading: busy, onPressed: busy ? null : () => _recall(d)),
      if (d.allows('cancel')) DangerButton(key: const Key('m07-cancel'), label: d.allows('cancel_after_pickup') ? 'Hủy giao (shipper đã lấy hàng)' : 'Hủy yêu cầu giao', onPressed: busy ? null : () => _cancel(d)),
    ];
    if (actions.isEmpty) {
      return null;
    }
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[for (int i = 0; i < actions.length; i++) ...<Widget>[if (i > 0) const SizedBox(height: N11Space.gap2), actions[i]]]);
  }
}

String _reasonText(String code) => switch (code) {
      'URGENT' => 'Gấp',
      'BULKY' => 'Cồng kềnh',
      'BAD_WEATHER' => 'Thời tiết xấu',
      'OUT_OF_PRICE_RANGE' => 'Ngoài bảng giá',
      _ => 'Khác',
    };

String _agreementText(String state) => switch (state) {
      'PROPOSED' => 'Đang chờ shipper',
      'COUNTERED' => 'Shipper đề xuất mức khác',
      'AWAITING_CUSTOMER' => 'Chờ khách xác nhận',
      'ACCEPTED' => 'Đã chốt phí',
      'LOCKED' => 'Phí đã khóa',
      'DECLINED' => 'Đã từ chối',
      _ => 'Đã hết hạn',
    };

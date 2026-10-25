import 'dart:async';

import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../m02/m02_widgets.dart';
import '../m07/m07_models.dart';
import '../m07/m07_shop_views.dart';
import '../m02/menu_models.dart';
import '../m07/m07_source.dart';
import '../m11/m11_entries.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/shop_order_filters.dart';
import 'm10_cart.dart';
import 'm10_common.dart';
import 'm10_customer_views.dart';
import 'm10_models.dart';
import 'm10_source.dart';

// The shop's side of M10 in 11Food: "Đơn hàng" with two parts — "Đơn món" (what customers ordered in the app) and "Giao hàng" (calls for a Shipper, from an
// order or direct, M07) —, the filters, the detail with every step: edit before confirming (after contacting the customer), confirm (a reason when edited),
// refuse, "Gọi shipper" (which itself means the dishes are ready: there is no "Đã chuẩn bị xong" step), cancel the dish order BEFORE pickup (ends the waiting
// delivery too; after pickup only the customer who placed the order can cancel it) and close an order as not completed once its goods were settled.
// The app records no payment of the dishes (Owner decision 2026-10-23).

class ShopOrdersTab extends StatefulWidget {
  const ShopOrdersTab({super.key, required this.runtime, required this.deliveries, this.deliveriesBuilder});

  final OrderRuntime runtime;

  /// M07: the delivery source, used by the "Giao hàng" part and by the goods handling from an order.
  final ShopDeliverySource? deliveries;
  final Widget Function(ShopDeliverySource source)? deliveriesBuilder;

  @override
  State<ShopOrdersTab> createState() => _ShopOrdersTabState();
}

class _ShopOrdersTabState extends State<ShopOrdersTab> {
  bool _deliveries = false;

  @override
  Widget build(BuildContext context) {
    final ShopDeliverySource? d = widget.deliveries;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(child: _Segment(key: const Key('orders-part-orders'), label: 'Đơn món', selected: !_deliveries, onTap: () => setState(() => _deliveries = false))),
            const SizedBox(width: N11Space.gap2),
            Expanded(child: _Segment(key: const Key('orders-part-deliveries'), label: 'Giao hàng', selected: _deliveries, onTap: d == null ? null : () => setState(() => _deliveries = true))),
          ],
        ),
        const SizedBox(height: N11Space.gap3),
        if (_deliveries && d != null) (widget.deliveriesBuilder?.call(d) ?? ShopDeliveryHub(source: d)) else ShopOrderList(runtime: widget.runtime, deliveries: d),
      ],
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        borderRadius: BorderRadius.circular(kRadiusControl),
        onTap: onTap,
        child: Container(
          height: kControlHeight,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: selected ? N11Colors.black : N11Colors.white, borderRadius: BorderRadius.circular(kRadiusControl), border: Border.all(color: selected ? N11Colors.black : N11Colors.line)),
          child: Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: selected ? N11Colors.white : (onTap == null ? N11Colors.disabledInk : N11Colors.black))),
        ),
      ),
    );
  }
}

class ShopOrderList extends StatefulWidget {
  const ShopOrderList({super.key, required this.runtime, this.deliveries});

  final OrderRuntime runtime;
  final ShopDeliverySource? deliveries;

  @override
  State<ShopOrderList> createState() => _ShopOrderListState();
}

const List<ShopOrderFilterChoice> _orderStatusOptions = <ShopOrderFilterChoice>[
  (value: 'all', label: 'Tất cả'),
  (value: 'pending', label: 'Chờ xác nhận'),
  (value: 'preparing', label: 'Đang chuẩn bị'),
  (value: 'scheduled', label: 'Đơn hẹn'),
  (value: 'delivering', label: 'Đang giao'),
  (value: 'attention', label: 'Cần xử lý'),
  (value: 'history', label: 'Lịch sử'),
];

class _ShopOrderListState extends State<ShopOrderList> {
  ShopOrderFilters _filters = const ShopOrderFilters();
  String _query = '';
  final TextEditingController _search = TextEditingController();
  int _round = 0;
  int _offset = 0;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _openFilters() async {
    final ShopOrderFilters? next = await showShopOrderFilters(
      context,
      current: _filters,
      statuses: _orderStatusOptions,
    );
    if (mounted && next != null) {
      setState(() { _filters = next; _offset = 0; });
    }
  }

  void _reset() {
    _search.clear();
    setState(() {
      _filters = const ShopOrderFilters();
      _query = '';
      _offset = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final ShopOrderSource source = widget.runtime.shop;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (source.isSample) const Padding(padding: EdgeInsets.only(bottom: N11Space.gap3), child: M10SampleBanner()),
        Row(
          children: <Widget>[
            Expanded(
              child: TextField(
                key: const Key('shop-orders-search'),
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (String value) => setState(() { _query = value.trim(); _offset = 0; }),
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
              key: const Key('shop-orders-filter'),
              tooltip: 'Lọc trạng thái và ngày',
              onPressed: _openFilters,
              icon: Stack(clipBehavior: Clip.none, children: <Widget>[
                const Icon(Icons.filter_list),
                if (_filters.isActive) const Positioned(right: -3, top: -3, child: CircleAvatar(radius: 4, backgroundColor: Colors.orange)),
              ]),
            ),
          ],
        ),
        const SizedBox(height: N11Space.gap3),
        M07Loader<OrderList>(
          key: ValueKey<String>('shop-orders-${_filters.status}-$_query-${_filters.from?.toIso8601String()}-${_filters.toExclusive?.toIso8601String()}-$_round-$_offset'),
          keyPrefix: 'shop-orders',
          load: () => source.listPage(filter: _filters.status, query: _query, from: _filters.from, to: _filters.toExclusive, offset: _offset),
          refreshEvery: const Duration(seconds: 15),
          builder: (BuildContext context, OrderList list, Future<void> Function() reload) => vstack(<Widget>[
            if (list.orders.isEmpty) ...<Widget>[
              const EmptyState(key: Key('shop-orders-empty'), icon: Icons.receipt_long_outlined, title: 'Không có đơn phù hợp', text: 'Hãy thử tìm kiếm hoặc thay đổi bộ lọc.'),
              if (_filters.isActive || _query.isNotEmpty)
                TextButton(key: const Key('shop-orders-clear-filters'), onPressed: _reset, child: const Text('Xóa bộ lọc')),
            ] else
              for (final OrderSummary o in list.orders)
                OrderSummaryCard(
                  summary: o,
                  forShop: true,
                  onTap: () async {
                    await Navigator.of(context).push(n11Route(ShopOrderDetailScreen(runtime: widget.runtime, orderId: o.orderId, deliveries: widget.deliveries)));
                    if (mounted) setState(() => _round += 1);
                  },
                ),
            if (_offset > 0 || list.orders.length == 50)
              Row(
                children: <Widget>[
                  if (_offset > 0) TextButton(
                    key: const Key('shop-orders-page-previous'),
                    onPressed: () => setState(() => _offset -= 50),
                    child: const Text('Trang trước'),
                  ),
                  const Spacer(),
                  Text('Trang ${_offset ~/ 50 + 1}', style: N11Text.caption),
                  const Spacer(),
                  if (list.orders.length == 50) TextButton(
                    key: const Key('shop-orders-page-next'),
                    onPressed: () => setState(() => _offset += 50),
                    child: const Text('Trang sau'),
                  ),
                ],
              ),
          ]),
        ),
      ],
    );
  }
}

// ---- the detail ------------------------------------------------------------------------------------------------------

class ShopOrderDetailScreen extends StatefulWidget {
  const ShopOrderDetailScreen({super.key, required this.runtime, required this.orderId, this.deliveries, this.mapBuilder});

  final OrderRuntime runtime;
  final String orderId;
  final ShopDeliverySource? deliveries;
  final M07MapBuilder? mapBuilder;

  @override
  State<ShopOrderDetailScreen> createState() => _ShopOrderDetailState();
}

class _ShopOrderDetailState extends State<ShopOrderDetailScreen> with M07Actions<ShopOrderDetailScreen> {
  late final M07Fetcher<OrderView> _fetcher = M07Fetcher<OrderView>(() => widget.runtime.shop.get(widget.orderId), refreshEvery: const Duration(seconds: 10))..addListener(_changed);

  ShopOrderSource get source => widget.runtime.shop;

  void _changed() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _fetcher.dispose();
    super.dispose();
  }

  Future<void> _run(String intent, Future<OrderView> Function(String key) body) async {
    await act(intent, (String key) async {
      await body(key);
      await _fetcher.reload(quiet: true);
    }, onConflict: _fetcher.reload);
  }

  Future<void> _confirm(OrderView o) async {
    String? reason;
    if (o.edited) {
      reason = await showReasonDialog(context, title: 'Lý do thay đổi', explanation: 'Đơn đã được chỉnh. Khách sẽ thấy bản ban đầu, bản chốt và lý do này.', confirmLabel: 'Xác nhận đơn', reasonLabel: 'Lý do thay đổi', danger: false);
      if (reason == null) {
        return;
      }
    }
    await _run('confirm', (String key) => source.confirm(o.orderId, changeReason: reason, expectedVersion: o.version, key: key));
  }

  Future<void> _reject(OrderView o) async {
    final String? reason = await showReasonDialog(context, title: 'Từ chối đơn?', explanation: 'Khách sẽ được báo và thấy lý do này.', confirmLabel: 'Từ chối đơn', reasonLabel: 'Lý do từ chối');
    if (reason != null) {
      await _run('reject', (String key) => source.reject(o.orderId, reason: reason, expectedVersion: o.version, key: key));
    }
  }

  Future<void> _call(OrderView o) async {
    final String? payer = await showDecision(
      context,
      title: 'Gọi shipper',
      text: 'Ai trả phí giao? Phí tính theo bảng giá khi gọi. Gọi shipper nghĩa là món đã chuẩn bị xong, sẵn sàng để shipper đến lấy.',
      dismissible: true,
      actions: const <DialogAction>[DialogAction('Khách trả phí', 'CUSTOMER', kind: ButtonKind.primary, key: Key('call-payer-customer')), DialogAction('Quán trả phí', 'SHOP', key: Key('call-payer-shop'))],
    );
    if (payer != null) {
      await _callWith(o, payer, null);
    }
  }

  /// The call; when the fee table cannot price this order the server says FEE_REQUIRED and the shop proposes a fee (the payer and the Shipper settle it).
  Future<void> _callWith(OrderView o, String payer, AgreedFeeProposal? fee) async {
    var needsFee = false;
    await act(fee == null ? 'call' : 'call-fee-${fee.amountVnd}-${fee.reasonCode}', (String key) async {
      try {
        await source.callShipper(o.orderId, feePayer: payer, agreedFee: fee, expectedVersion: o.version, key: key);
      } on M07Failure catch (failure) {
        if (failure.code == 'FEE_REQUIRED') {
          needsFee = true;
          return;
        }
        rethrow;
      }
      await _fetcher.reload(quiet: true);
    }, onConflict: _fetcher.reload);
    if (needsFee && mounted) {
      final AgreedFeeProposal? proposal = await showFeeProposalDialog(context, payerIsCustomer: payer == 'CUSTOMER');
      if (proposal != null && mounted) {
        await _callWith(o, payer, proposal);
      }
    }
  }

  Future<void> _cancel(OrderView o) async {
    final String? reason = await showReasonDialog(
      context,
      title: 'Hủy đơn món?',
      explanation: o.shopDelivery != null && (o.shopDelivery!.state.isActive) ? 'Đơn món và yêu cầu giao đang chờ lấy sẽ cùng kết thúc; hoa hồng shipper được giải phóng.' : 'Đơn món sẽ kết thúc và khách được báo.',
      confirmLabel: 'Hủy đơn món',
      reasonLabel: 'Lý do hủy',
    );
    if (reason != null) {
      await _run('cancel', (String key) => source.cancel(o.orderId, reason: reason, expectedVersion: o.version, key: key));
    }
  }

  Future<void> _close(OrderView o) async {
    final String? reason = await showReasonDialog(context, title: 'Đóng đơn "Không hoàn tất"?', explanation: 'Hàng đã được xử lý và không giao lại. Hệ thống chỉ ghi nhận, không tự hoàn tiền hay bồi thường.', confirmLabel: 'Đóng đơn', reasonLabel: 'Lý do');
    if (reason != null) {
      await _run('close', (String key) => source.closeNotCompleted(o.orderId, reason: reason, expectedVersion: o.version, key: key));
    }
  }

  Future<void> _edit(OrderView o) async {
    final List<LineEdit>? changes = await showModalBottomSheet<List<LineEdit>>(context: context, isScrollControlled: true, backgroundColor: N11Colors.white, builder: (BuildContext sheet) => _EditSheet(order: o));
    if (changes != null && changes.isNotEmpty) {
      await _run('edit', (String key) => source.edit(o.orderId, changes: changes, expectedVersion: o.version, key: key));
    }
  }

  @override
  Widget build(BuildContext context) {
    final OrderView? o = _fetcher.value;
    return m07Page(
      o == null ? 'Chi tiết đơn' : 'Đơn ${o.code}',
      source.isSample,
      <Widget>[actionBanner(), m07Fetched<OrderView>(context, _fetcher, 'shop-order', _body)],
      bottom: o == null ? null : _bottom(o),
    );
  }

  Widget? _bottom(OrderView o) {
    final List<Widget> buttons = <Widget>[
      if (o.allowed('confirm') && widget.runtime.newWorkBlocked())
        const ReasonNote('Cần cập nhật ứng dụng trước khi nhận đơn mới. Các đơn đã nhận vẫn xử lý bình thường; bạn vẫn có thể từ chối đơn này.', key: Key('order-confirm-blocked'))
      else if (o.allowed('confirm')) N11Button(key: const Key('order-confirm'), label: o.edited ? 'Xác nhận đơn đã chỉnh' : 'Xác nhận đơn', loading: busy, onPressed: () => unawaited(_confirm(o))),
      if (o.allowed('edit')) N11Button(key: const Key('order-edit'), label: 'Chỉnh đơn', kind: ButtonKind.secondary, onPressed: busy ? null : () => unawaited(_edit(o))),
      if (o.allowed('reject')) DangerButton(label: 'Từ chối đơn', onPressed: busy ? null : () => unawaited(_reject(o))),
      if (o.allowed('call_shipper')) N11Button(key: const Key('order-call'), label: o.deliveries.isEmpty ? 'Gọi shipper' : 'Gọi lại shipper', loading: busy, onPressed: () => unawaited(_call(o))),
      if (o.allowed('close_not_completed')) N11Button(key: const Key('order-close'), label: 'Đóng đơn "Không hoàn tất"', kind: ButtonKind.secondary, onPressed: busy ? null : () => unawaited(_close(o))),
      if (o.allowed('cancel')) DangerButton(label: 'Hủy đơn món', onPressed: busy ? null : () => unawaited(_cancel(o))),
    ];
    if (buttons.isEmpty) {
      return null;
    }
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[for (int i = 0; i < buttons.length; i++) Padding(padding: EdgeInsets.only(top: i == 0 ? 0 : N11Space.gap2), child: buttons[i])]);
  }

  Widget _body(OrderView o) {
    final DeliveryView? d = o.shopDelivery;
    return vstack(<Widget>[
      N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('${o.code} · ${o.recipient.name}', style: N11Text.h2),
            const SizedBox(height: 4),
            Align(alignment: Alignment.centerLeft, child: OrderStatusChip(o.display)),
            const SizedBox(height: 4),
            Text('Đặt lúc ${m10When(o.createdAt)}', style: N11Text.caption),
            if (o.isScheduled) Padding(padding: const EdgeInsets.only(top: 6), child: Row(children: <Widget>[const N11Chip('Đơn hẹn', kind: ChipKind.dark), const SizedBox(width: N11Space.gap2), Expanded(child: Text('Khách muốn nhận món lúc ${m10When(o.scheduledFor!)}', key: const Key('order-wanted'), style: N11Text.body))])),
          ],
        ),
      ),
      if (o.scheduleConflict) const N11Banner(key: Key('order-schedule-conflict'), kind: BannerKind.warn, title: 'Giờ hẹn nằm ngoài giờ hoạt động mới', text: 'Quán đã đổi lịch sau khi nhận đơn. Đơn vẫn giữ nguyên, không tự hủy — hãy liên hệ khách để xử lý.'),
      if (o.allowed('edit')) const N11Banner(key: Key('order-edit-note'), kind: BannerKind.info, title: 'Liên hệ khách trước khi đổi', text: 'Đổi nội dung hoặc tăng tiền cần được khách đồng ý trước. Khi xác nhận đơn đã chỉnh, bạn phải ghi lý do.'),
      if (o.display == DisplayStatus.searchStopped) const N11Banner(key: Key('order-search-stopped'), kind: BannerKind.warn, title: 'Chưa tìm được shipper', text: 'Đơn món vẫn còn. Bạn có thể gọi lại shipper hoặc hủy đơn món.'),
      if (o.display == DisplayStatus.deliveryFailed && !o.allowed('call_shipper')) const N11Banner(key: Key('order-goods-out'), kind: BannerKind.error, title: 'Hàng chưa về quán', text: 'Giao thất bại. Khi hàng còn ở shipper hoặc chưa rõ thì chưa gọi lại được. Xác nhận hàng đã về hoặc đã xử lý ở phần giao hàng.'),
      if (o.display == DisplayStatus.delivering)
        const N11Banner(key: Key('order-delivering-note'), kind: BannerKind.info, title: 'Shipper đã lấy hàng', text: 'Đơn này do khách đặt nên chỉ khách mới hủy được. Nếu shipper báo không giao được, hãy gọi khách và shipper để thống nhất.'),
      OrderLinesCard(lines: o.items),
      OrderMoneyCard(money: o.money, edited: o.edited),
      N11Card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[const Text('Người nhận', style: N11Text.label), KeyValueRows(<(String, String)>[('Tên', o.recipient.name), ('Số điện thoại', o.recipient.phone), ('Địa chỉ', o.recipient.addressText)]), if (o.note != null) Text('Ghi chú: ${o.note}', style: N11Text.caption)])),
      if (d != null) _deliverySection(o, d),
      if (d != null || o.recipient.hasPin)
        OrderMapCard(
          pickupLat: d?.pickup.lat,
          pickupLng: d?.pickup.lng,
          dropoffLat: d?.recipient.lat ?? o.recipient.lat,
          dropoffLng: d?.recipient.lng ?? o.recipient.lng,
          location: o.ended ? null : d?.location,
          mapBuilder: widget.mapBuilder ?? widget.runtime.mapBuilder,
          ended: o.ended,
          who: 'shipper',
        ),
      StoryCard(o.story),
    ]);
  }

  /// The current call for a Shipper, read and acted on inside the order: there is no second page for it. Earlier calls are in "Diễn biến".
  Widget _deliverySection(OrderView o, DeliveryView d) {
    final ShopDeliverySource? source = widget.deliveries;
    return Column(
      key: const Key('order-delivery'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        N11Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Giao hàng', style: N11Text.label),
              const SizedBox(height: 4),
              Align(alignment: Alignment.centerLeft, child: N11Chip(d.state.label, kind: m07StateChip(d.state).kind)),
              if (o.deliveries.length > 1) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Lần gọi shipper thứ ${o.deliveries.length}', key: const Key('order-call-count'), style: N11Text.caption)),
              if (source == null && d.assignment != null) KeyValueRows(<(String, String)>[('Shipper', d.assignment!.shipperName), if (d.assignment!.plateNumber != null) ('Biển số', d.assignment!.plateNumber!), if (d.assignment!.shipperPhone != null) ('Điện thoại', d.assignment!.shipperPhone!)]),
            ],
          ),
        ),
        if (source != null)
          Padding(
            padding: const EdgeInsets.only(top: N11Space.gap3),
            child: ShopDeliveryPanel(
              source: source,
              delivery: d,
              onChanged: () => _fetcher.reload(quiet: true),
              mapBuilder: widget.mapBuilder ?? widget.runtime.mapBuilder,
              showLocation: false,
              allowCancel: true,
              feedbackSlot: widget.runtime.feedback == null ? null : shopDeliveryFeedbackSlot(source: widget.runtime.feedback!, picker: widget.runtime.picker ?? const NoImagePicker()),
            ),
          ),
      ],
    );
  }
}

class _EditSheet extends StatefulWidget {
  const _EditSheet({required this.order});

  final OrderView order;

  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late final Map<String, int> _qty = <String, int>{for (final OrderLine l in widget.order.items) l.lineId: l.quantity};
  late final Map<String, TextEditingController> _price = <String, TextEditingController>{for (final OrderLine l in widget.order.items) l.lineId: TextEditingController(text: l.unitPriceVnd.toString())};
  final Set<String> _removed = <String>{};

  @override
  void dispose() {
    for (final TextEditingController c in _price.values) {
      c.dispose();
    }
    super.dispose();
  }

  List<LineEdit> _changes() {
    final List<LineEdit> out = <LineEdit>[];
    for (final OrderLine l in widget.order.items) {
      if (l.removed) {
        continue;
      }
      if (_removed.contains(l.lineId)) {
        out.add(LineEdit(lineId: l.lineId, remove: true));
        continue;
      }
      final int? price = int.tryParse(_price[l.lineId]!.text.replaceAll(RegExp(r'[^0-9]'), ''));
      final int? q = _qty[l.lineId];
      if ((q != null && q != l.quantity) || (price != null && price != l.unitPriceVnd)) {
        out.add(LineEdit(lineId: l.lineId, quantity: q != l.quantity ? q : null, priceVnd: price != null && price != l.unitPriceVnd ? price : null));
      }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final List<LineEdit> changes = _changes();
    return Form(child: Padding(
      padding: EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, MediaQuery.of(context).viewInsets.bottom + N11Space.gap4),
      child: SingleChildScrollView(
        child: Column(
          key: const Key('edit-sheet'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Chỉnh đơn', style: N11Text.h2),
            const SizedBox(height: N11Space.gap2),
            const ReasonNote('Chỉ sửa sau khi đã liên hệ và được khách đồng ý. Sau khi xác nhận, món và tiền món bị khóa.'),
            for (final OrderLine l in widget.order.items.where((OrderLine l) => !l.removed))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: _removed.contains(l.lineId)
                    ? Row(children: <Widget>[Expanded(child: Text('${l.name} — sẽ bỏ khỏi đơn', style: N11Text.body.copyWith(decoration: TextDecoration.lineThrough))), TextButton(key: Key('edit-undo-${l.lineId}'), onPressed: () => setState(() => _removed.remove(l.lineId)), child: const Text('Giữ lại'))])
                    : Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                        Text(l.name, style: N11Text.bodyStrong),
                        Row(children: <Widget>[
                          IconButton(key: Key('edit-minus-${l.lineId}'), onPressed: (_qty[l.lineId] ?? 1) > 1 ? () => setState(() => _qty[l.lineId] = _qty[l.lineId]! - 1) : null, icon: const Icon(Icons.remove_circle_outline)),
                          Text('${_qty[l.lineId]}', key: Key('edit-qty-${l.lineId}'), style: N11Text.bodyStrong),
                          IconButton(key: Key('edit-plus-${l.lineId}'), onPressed: () => setState(() => _qty[l.lineId] = _qty[l.lineId]! + 1), icon: const Icon(Icons.add_circle, color: N11Colors.yellowStrong)),
                          const SizedBox(width: N11Space.gap2),
                          Expanded(child: N11Field(validator: (String value) { final int? price = int.tryParse(value.replaceAll(RegExp(r'[^0-9]'), '')); return price == null || price < 1 || price > 99999999 ? 'Đơn giá cần từ 1 đến 99.999.999đ.' : null; }, fieldKey: Key('edit-price-${l.lineId}'), label: 'Đơn giá (đ)', controller: _price[l.lineId]!, keyboard: TextInputType.number, maxLength: 9, onChanged: () => setState(() {}))),
                          IconButton(key: Key('edit-remove-${l.lineId}'), tooltip: 'Bỏ món', onPressed: () => setState(() => _removed.add(l.lineId)), icon: const Icon(Icons.delete_outline, color: N11Colors.error)),
                        ]),
                      ]),
              ),
            const SizedBox(height: N11Space.gap3),
            N11Button(key: const Key('edit-save'), validate: true, label: 'Lưu chỉnh sửa', onPressed: changes.isEmpty ? null : () => Navigator.of(context).pop(changes)),
            const SizedBox(height: N11Space.gap2),
            N11Button(key: const Key('edit-back'), label: 'Quay lại', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).pop()),
          ],
        ),
      ),
    ));
  }
}

import 'dart:async';

import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../m06/m06_models.dart';
import '../m06/m06_views.dart' show kFeeNotePrivacyHint, noteLooksLikePhone, parseAgreedFee;
import '../tokens.dart';
import '../wallet/wallet_models.dart';
import '../widgets/components.dart';
import 'm07_models.dart';
import 'm07_source.dart';
import 'm07_widgets.dart';

// 11Food, the shop's side of M07 (screens Q01-Q08 of docs/current/M07-implementation-20261018.md):
//   Q01 ShopDeliveryHub        list: "Đang xử lý" / "Lịch sử", search by code or recipient, "Gọi shipper"
//   Q02 ShopCallScreen         the call form with a summary before sending
//   Q03-Q08 ShopDeliveryDetailScreen   one screen that shows the state the server reports:
//        Q03 searching (server timer, 5/15/30 marks, cancel)   Q04 accepted (Shipper, position, cancel)   Q05 delivering (position, no cancel)
//        Q06 search stopped (call again / cancel)   Q07 result and timeline (read only)   Q08 goods handling after a failed delivery
// The shop can cancel only BEFORE the goods are picked up; after that the button is not drawn and the server refuses anyway. Cancelling a
// delivery never cancels the food order.

const String kCancelExplain = 'Yêu cầu giao sẽ kết thúc, shipper (nếu đã nhận) được giải phóng và hệ thống ngừng tìm. Không tự hủy đơn món.';

String _short(String text, int max) => text.length <= max ? text : '${text.substring(0, max - 1)}…';

/// Draft of the call form kept while the app runs, so a lost connection never makes the shop retype. Only a server answer clears it.
class ShopCallDraft {
  static final Map<String, String> _fields = <String, String>{};
  static String get(String field) => _fields[field] ?? '';
  static void put(String field, String value) => _fields[field] = value;
  static void clear() => _fields.clear();
}

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

class _ShopDeliveryHubState extends State<ShopDeliveryHub> {
  bool _history = false;
  final TextEditingController _query = TextEditingController();
  String _applied = '';
  int _rev = 0;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _call() async {
    await Navigator.of(context).push(n11Route(ShopCallScreen(source: widget.source, pinPicker: widget.pinPicker, mapBuilder: widget.mapBuilder)));
    if (mounted) {
      setState(() => _rev++);
    }
  }

  Future<void> _open(DeliveryView d) async {
    await Navigator.of(context).push(n11Route(ShopDeliveryDetailScreen(source: widget.source, deliveryId: d.deliveryId, mapBuilder: widget.mapBuilder, pinPicker: widget.pinPicker, feedbackSlot: widget.feedbackSlot)));
    if (mounted) {
      setState(() => _rev++);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.source.isSample) const Padding(padding: EdgeInsets.only(bottom: N11Space.gap3), child: M07SampleBanner()),
        N11Button(key: const Key('m07-call-shipper'), label: 'Gọi shipper', icon: Icons.two_wheeler, onPressed: _call),
        const SizedBox(height: N11Space.gap3),
        Wrap(
          spacing: N11Space.gap3,
          runSpacing: N11Space.gap2,
          children: <Widget>[
            N11Button(key: const Key('m07-tab-active'), label: 'Đang xử lý', compact: true, kind: _history ? ButtonKind.secondary : ButtonKind.primary, onPressed: () => setState(() => _history = false)),
            N11Button(key: const Key('m07-tab-history'), label: 'Lịch sử', compact: true, kind: _history ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _history = true)),
          ],
        ),
        const SizedBox(height: N11Space.gap3),
        N11Field(
          fieldKey: const Key('m07-search'),
          label: 'Tìm theo mã hoặc người nhận',
          controller: _query,
          textInputAction: TextInputAction.search,
          onChanged: () {
            final String next = _query.text;
            Future<void>.delayed(const Duration(milliseconds: 300), () {
              if (mounted && _query.text == next && next != _applied) {
                setState(() {
                  _applied = next;
                  _rev++;
                });
              }
            });
          },
        ),
        const SizedBox(height: N11Space.gap3),
        M07Loader<List<DeliveryView>>(
          key: ValueKey<String>('$_history|$_applied|$_rev'),
          keyPrefix: 'm07-list',
          refreshEvery: const Duration(seconds: 20),
          load: () => widget.source.list(history: _history, query: _applied),
          isEmpty: (List<DeliveryView> v) => v.isEmpty,
          emptyIcon: Icons.two_wheeler,
          emptyTitle: _history ? 'Chưa có lịch sử giao hàng' : 'Chưa có yêu cầu giao nào',
          emptyText: _history ? 'Các yêu cầu đã kết thúc sẽ hiện ở đây.' : 'Bấm "Gọi shipper" để gọi shipper giao một đơn.',
          builder: (BuildContext context, List<DeliveryView> items, Future<void> Function() reload) => Column(
            children: <Widget>[
              for (final DeliveryView d in items)
                Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: _DeliveryCard(delivery: d, onTap: () => _open(d))),
            ],
          ),
        ),
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

// ---- Q02: call a shipper ---------------------------------------------------------------------------------------------

class ShopCallScreen extends StatefulWidget {
  const ShopCallScreen({super.key, required this.source, this.pinPicker, this.mapBuilder});

  final ShopDeliverySource source;
  final M07PinPickerBuilder? pinPicker;
  final M07MapBuilder? mapBuilder;

  @override
  State<ShopCallScreen> createState() => _ShopCallScreenState();
}

class _ShopCallScreenState extends State<ShopCallScreen> with M07Actions<ShopCallScreen> {
  final Map<String, TextEditingController> _c = <String, TextEditingController>{};
  String _payer = 'CUSTOMER';
  bool _agreed = false;
  String _reason = 'URGENT';
  double? _lat;
  double? _lng;
  String? _problem;

  static const List<String> _fields = <String>['name', 'phone', 'address', 'goods', 'value', 'paid', 'note', 'amount', 'feeNote'];

  TextEditingController _field(String name) => _c.putIfAbsent(name, () => TextEditingController(text: ShopCallDraft.get(name))..addListener(() => ShopCallDraft.put(name, _c[name]!.text)));

  @override
  void initState() {
    super.initState();
    for (final String f in _fields) {
      _field(f);
    }
  }

  @override
  void dispose() {
    for (final TextEditingController c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Validates the form; returns the input or null with [_problem] set.
  NewDeliveryInput? _build() {
    final String name = _field('name').text.trim();
    final String phone = _field('phone').text.replaceAll(RegExp(r'[\s.\-]'), '');
    final String address = _field('address').text.trim();
    final String goods = _field('goods').text.trim();
    final int? value = parseVndInput(_field('value').text) ?? (_field('value').text.trim().isEmpty ? null : -1);
    final int paid = _field('paid').text.trim().isEmpty ? 0 : (parseVndInput(_field('paid').text) ?? -1);
    String? problem;
    if (name.isEmpty || address.isEmpty || goods.isEmpty) {
      problem = 'Hãy nhập tên người nhận, địa chỉ và mô tả hàng.';
    } else if (!RegExp(r'^(0|\+84)\d{9}$').hasMatch(phone)) {
      problem = 'Số điện thoại người nhận chưa đúng (10 số, bắt đầu bằng 0).';
    } else if (value == null || value < 0) {
      problem = 'Hãy nhập giá trị hàng (số nguyên, có thể là 0).';
    } else if (paid < 0 || paid > value) {
      problem = 'Tiền hàng đã thanh toán phải từ 0 đến giá trị hàng.';
    }
    int? amount;
    if (problem == null && _agreed) {
      amount = parseAgreedFee(_field('amount').text);
      final String feeNote = _field('feeNote').text.trim();
      if (amount == null) {
        problem = 'Mức phí thỏa thuận phải là số nguyên từ 0 đến 10.000.000đ.';
      } else if (noteLooksLikePhone(feeNote)) {
        problem = 'Ghi chú cho shipper không được chứa số điện thoại.';
      } else if (_reason == 'OTHER' && feeNote.isEmpty) {
        problem = 'Lý do "Khác" cần có ghi chú.';
      }
    }
    setState(() => _problem = problem);
    if (problem != null) {
      return null;
    }
    return NewDeliveryInput(
      recipientName: name,
      recipientPhone: phone,
      addressText: address,
      lat: _lat,
      lng: _lng,
      goodsDescription: goods,
      goodsValueVnd: value!,
      paidVnd: paid,
      feePayer: _payer,
      note: _field('note').text.trim(),
      agreedReasonCode: _agreed ? _reason : null,
      agreedReasonNote: _agreed ? _field('feeNote').text.trim() : null,
      agreedAmountVnd: amount,
    );
  }

  Future<void> _submit() async {
    final NewDeliveryInput? input = _build();
    if (input == null) {
      return;
    }
    final bool yes = await showConfirmDialog(
      context,
      title: 'Gọi shipper?',
      confirmLabel: 'Gọi shipper',
      content: KeyValueRows(<(String, String)>[
        ('Người nhận', input.recipientName),
        ('Điện thoại', input.recipientPhone),
        ('Giao đến', input.addressText),
        ('Hàng', input.goodsDescription),
        ('Giá trị hàng', m07Vnd(input.goodsValueVnd)),
        ('Còn phải thu', m07Vnd(input.goodsValueVnd - input.paidVnd)),
        ('Phí giao', input.agreed ? '${m07Vnd(input.agreedAmountVnd)} (thỏa thuận)' : (input.lat == null ? kFeeUnknown : 'Theo bảng giá')),
        ('Người trả phí', input.feePayer == 'CUSTOMER' ? 'Khách trả ship' : 'Quán trả ship'),
      ]),
    );
    if (!yes || !mounted) {
      return;
    }
    DeliveryView? made;
    final bool ok = await act('create', (String key) async => made = await widget.source.create(input, key: key));
    if (!ok || made == null || !mounted) {
      return;
    }
    ShopCallDraft.clear();
    final DeliveryView created = made!;
    await Navigator.of(context).pushReplacement(n11Route(ShopDeliveryDetailScreen(source: widget.source, deliveryId: created.deliveryId, mapBuilder: widget.mapBuilder, pinPicker: widget.pinPicker)));
  }

  @override
  Widget build(BuildContext context) {
    return m07Page(
      'Gọi shipper',
      widget.source.isSample,
      <Widget>[
        N11Field(fieldKey: const Key('m07-f-name'), label: 'Tên người nhận', controller: _field('name'), maxLength: 80),
        N11Field(fieldKey: const Key('m07-f-phone'), label: 'Số điện thoại người nhận', controller: _field('phone'), keyboard: TextInputType.phone, maxLength: 15),
        N11Field(fieldKey: const Key('m07-f-address'), label: 'Địa chỉ giao (mô tả)', controller: _field('address'), maxLength: 200),
        _pinSection(),
        N11Field(fieldKey: const Key('m07-f-goods'), label: 'Mô tả hàng', controller: _field('goods'), maxLength: 120),
        N11Field(fieldKey: const Key('m07-f-value'), label: 'Giá trị hàng (đ)', controller: _field('value'), keyboard: TextInputType.number, maxLength: 12),
        N11Field(fieldKey: const Key('m07-f-paid'), label: 'Tiền hàng đã thanh toán (đ)', controller: _field('paid'), keyboard: TextInputType.number, maxLength: 12, optionalLabel: true, hint: 'Để trống nếu khách chưa trả trước.'),
        _payerSection(),
        _feeSection(),
        N11Field(fieldKey: const Key('m07-f-note'), label: 'Ghi chú', controller: _field('note'), maxLength: 200, optionalLabel: true),
        if (_problem != null) N11Banner(key: const Key('m07-form-problem'), kind: BannerKind.error, title: 'Chưa gửi được', text: _problem),
        actionBanner(),
      ],
      bottom: N11Button(key: const Key('m07-submit-call'), label: 'Gọi shipper', icon: Icons.two_wheeler, loading: busy, onPressed: busy ? null : _submit),
    );
  }

  Widget _pinSection() {
    final M07PinPickerBuilder? picker = widget.pinPicker;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Ghim điểm giao (không bắt buộc)', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          if (picker == null)
            const ReasonNote('Bản này chưa có bản đồ để ghim. Không ghim thì phí chưa xác định, shipper sẽ ghim điểm giao và xác nhận phí trước khi lấy hàng.')
          else ...<Widget>[
            SizedBox(height: 200, child: ClipRRect(borderRadius: BorderRadius.circular(kRadiusControl), child: picker(context, onPick: (double lat, double lng) => setState(() {
                  _lat = lat;
                  _lng = lng;
                }), lat: _lat, lng: _lng))),
            const SizedBox(height: N11Space.gap2),
            Text(_lat == null ? 'Chạm vào bản đồ để ghim. Không ghim thì phí chưa xác định.' : 'Đã ghim ${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}', style: N11Text.caption),
          ],
        ],
      ),
    );
  }

  Widget _payerSection() {
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Ai trả phí giao?', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          Wrap(
            spacing: N11Space.gap3,
            runSpacing: N11Space.gap2,
            children: <Widget>[
              N11Button(key: const Key('m07-payer-customer'), label: 'Khách trả', compact: true, kind: _payer == 'CUSTOMER' ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _payer = 'CUSTOMER')),
              N11Button(key: const Key('m07-payer-shop'), label: 'Quán trả', compact: true, kind: _payer == 'SHOP' ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _payer = 'SHOP')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _feeSection() {
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Phí giao', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          Wrap(
            spacing: N11Space.gap3,
            runSpacing: N11Space.gap2,
            children: <Widget>[
              N11Button(key: const Key('m07-fee-standard'), label: 'Theo bảng giá', compact: true, kind: _agreed ? ButtonKind.secondary : ButtonKind.primary, onPressed: () => setState(() => _agreed = false)),
              N11Button(key: const Key('m07-fee-agreed'), label: 'Thỏa thuận', compact: true, kind: _agreed ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _agreed = true)),
            ],
          ),
          const SizedBox(height: N11Space.gap2),
          if (!_agreed)
            Text(_lat == null ? 'Chưa ghim điểm giao nên $kFeeUnknown. Shipper sẽ ghim và xác nhận phí trước khi lấy hàng.' : 'Phí tính theo quãng đường thật khi gửi yêu cầu. Nếu chưa tính được tuyến, phí hiện $kFeeUnknown.', style: N11Text.caption)
          else ...<Widget>[
            Wrap(
              spacing: N11Space.gap2,
              children: <Widget>[
                for (final FeeReason r in FeeReason.values)
                  if (r != FeeReason.outsideTable)
                    ChoiceChip(
                      key: Key('m07-reason-${_wire(r)}'),
                      label: Text(feeReasonText(r)),
                      selected: _reason == _wire(r),
                      onSelected: (bool _) => setState(() => _reason = _wire(r)),
                    ),
              ],
            ),
            const SizedBox(height: N11Space.gap3),
            N11Field(fieldKey: const Key('m07-f-amount'), label: 'Mức phí đề xuất (đ)', controller: _field('amount'), keyboard: TextInputType.number, maxLength: 10),
            N11Field(fieldKey: const Key('m07-f-fee-note'), label: 'Ghi chú cho shipper', controller: _field('feeNote'), maxLength: 200, optionalLabel: true, hint: kFeeNotePrivacyHint),
            if (_payer == 'CUSTOMER') const ReasonNote('Khách trả ship: mức khác bảng giá cần khách đồng ý trước khi chốt.'),
          ],
        ],
      ),
    );
  }

  static String _wire(FeeReason r) => switch (r) {
        FeeReason.urgent => 'URGENT',
        FeeReason.bulky => 'BULKY',
        FeeReason.badWeather => 'BAD_WEATHER',
        FeeReason.outsideTable => 'OUT_OF_PRICE_RANGE',
        FeeReason.other => 'OTHER',
      };
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

  Future<void> _reload() async => _page.currentState?.fetcher.reload(quiet: true);

  Future<void> _cancel(DeliveryView d) async {
    final String? reason = await showReasonDialog(context, title: 'Hủy yêu cầu giao?', explanation: kCancelExplain, confirmLabel: 'Xác nhận hủy');
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
      ..._byState(d),
      _recipientCard(d),
      MoneySummary(goods: d.goods, fee: d.fee),
      if (widget.feedbackSlot != null && (d.state == DeliveryState.completed || d.state == DeliveryState.failed || d.state == DeliveryState.cancelledByMerchant)) widget.feedbackSlot!(context, d),
      if (d.previousDeliveryId != null) const N11Card(child: Text('Đây là lần gọi lại. Lần gọi trước vẫn nằm trong lịch sử.', style: N11Text.caption)),
      if (d.result != null || d.timeline.isNotEmpty) _timeline(d),
    ];
    return M07PageParts(body, bottom: _bottom(d));
  }

  List<Widget> _byState(DeliveryView d) {
    switch (d.state) {
      case DeliveryState.waitingDriver:
        return <Widget>[SearchTimerCard(search: d.search), ..._feeAgreementCards(d)];
      case DeliveryState.accepted:
      case DeliveryState.locationConfirmed:
        return <Widget>[_shipperCard(d), _statusCard(d), LocationCard(location: d.location, mapBuilder: widget.mapBuilder)];
      case DeliveryState.pickedUp:
      case DeliveryState.delivering:
        return <Widget>[_shipperCard(d), LocationCard(location: d.location, mapBuilder: widget.mapBuilder), const ReasonNote('Đã nhận hàng nên không hủy được và không sửa thông tin/phí.')];
      case DeliveryState.searchStopped:
        return <Widget>[
          const N11Banner(key: Key('m07-stopped'), kind: BannerKind.warn, title: 'Đã ngừng tìm shipper', text: 'Đã tìm đủ 30 phút nhưng chưa có shipper. Đơn món (nếu có) không bị hủy.', icon: Icons.timer_off_outlined),
        ];
      case DeliveryState.completed:
      case DeliveryState.failed:
      case DeliveryState.cancelledByMerchant:
        return <Widget>[if (d.assignment != null) _shipperCard(d), if (d.incident != null) _incidentCard(d)];
    }
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
            if (a.state == 'COUNTERED') ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const ReasonNote('Từ chối thì giữ mức đề xuất ban đầu và tiếp tục tìm shipper khác, thời gian tìm không tính lại.'),
              const SizedBox(height: N11Space.gap2),
              Row(
                children: <Widget>[
                  Expanded(child: N11Button(key: const Key('m07-counter-accept'), label: 'Đồng ý', onPressed: busy ? null : () => _counter(d, true))),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(child: N11Button(key: const Key('m07-counter-reject'), label: 'Từ chối', kind: ButtonKind.secondary, onPressed: busy ? null : () => _counter(d, false))),
                ],
              ),
            ],
            if (a.state == 'AWAITING_CUSTOMER') ...<Widget>[
              const SizedBox(height: N11Space.gap2),
              const ReasonNote('Khách trả ship nên mức này cần khách đồng ý. Chỉ bấm khi khách đã đồng ý với bạn.'),
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
    return N11Card(
      key: const Key('m07-shipper-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Shipper', style: N11Text.label),
          KeyValueRows(<(String, String)>[
            ('Tên', a.shipperName),
            if (a.shipperPhone != null) ('Điện thoại', a.shipperPhone!),
            if (a.plateNumber != null) ('Biển số', a.plateNumber!),
            ('Nhận lúc', m07Hm(a.acceptedAt)),
            if (a.pickedUpAt != null) ('Lấy hàng lúc', m07Hm(a.pickedUpAt!)),
          ]),
        ],
      ),
    );
  }

  Widget _statusCard(DeliveryView d) => N11Card(
        child: Row(
          children: <Widget>[
            const Icon(Icons.hourglass_bottom, color: N11Colors.ink2),
            const SizedBox(width: N11Space.gap3),
            Expanded(child: Text(d.assignment?.destinationConfirmed ?? false ? 'Chờ lấy hàng' : 'Chờ shipper xác nhận điểm giao và phí', style: N11Text.bodyStrong)),
          ],
        ),
      );

  Widget _recipientCard(DeliveryView d) => N11Card(
        key: const Key('m07-recipient'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Người nhận', style: N11Text.label),
            KeyValueRows(<(String, String)>[
              ('Tên', d.recipient.name),
              if (d.recipient.phone != null) ('Điện thoại', d.recipient.phone!),
              ('Địa chỉ', d.recipient.addressText ?? '—'),
              ('Điểm giao', d.recipient.hasPoint ? 'Đã ghim' : 'Chưa ghim'),
              ('Hàng', d.goods.description),
            ]),
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
          KeyValueRows(<(String, String)>[('Lý do giao thất bại', i.reason), ('Hàng hiện ở', i.custodyText)]),
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

  Widget _timeline(DeliveryView d) {
    final List<TimelineEntry> entries = d.timeline;
    return N11Card(
      key: const Key('m07-timeline'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Diễn biến', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          if (d.result != null) Text('${d.state.label} lúc ${m07Hm(d.result!.at)}${d.result!.reason == null ? '' : ' · ${d.result!.reason}'}', style: N11Text.bodyStrong),
          for (final TimelineEntry e in entries)
            Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text('${m07Hm(e.at)} · ${e.type}${e.note == null ? '' : ' · ${e.note}'}', style: N11Text.caption)),
        ],
      ),
    );
  }

  Widget? _bottom(DeliveryView d) {
    final List<Widget> actions = <Widget>[
      if (d.allows('recall')) N11Button(key: const Key('m07-recall'), label: 'Gọi lại shipper', icon: Icons.refresh, loading: busy, onPressed: busy ? null : () => _recall(d)),
      if (d.allows('cancel')) DangerButton(key: const Key('m07-cancel'), label: 'Hủy yêu cầu giao', onPressed: busy ? null : () => _cancel(d)),
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

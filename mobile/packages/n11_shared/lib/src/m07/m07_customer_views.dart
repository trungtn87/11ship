import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../m06/m06_views.dart' show parseAgreedFee;
import '../tokens.dart';
import '../widgets/components.dart';
import 'm07_models.dart';
import 'm07_source.dart';
import 'm07_widgets.dart';

// ---- Customer Call Screen ----------------------------------------------------------------------------------------------------

class CustomerCallScreen extends StatefulWidget {
  const CustomerCallScreen({super.key, required this.source, this.pinPicker, this.mapBuilder});

  final CustomerDeliverySource source;
  final M07PinPickerBuilder? pinPicker;
  final M07MapBuilder? mapBuilder;

  @override
  State<CustomerCallScreen> createState() => _CustomerCallScreenState();
}

class _CustomerCallScreenState extends State<CustomerCallScreen> with M07Actions<CustomerCallScreen> {
  final GlobalKey<FormState> _form = GlobalKey<FormState>();

  final TextEditingController _senderName = TextEditingController(text: 'Khách gửi hàng');
  final TextEditingController _senderPhone = TextEditingController();
  final TextEditingController _pickupAddress = TextEditingController();
  double? _pickupLat;
  double? _pickupLng;

  final TextEditingController _recipientName = TextEditingController();
  final TextEditingController _recipientPhone = TextEditingController();
  final TextEditingController _dropoffAddress = TextEditingController();
  double? _dropoffLat;
  double? _dropoffLng;

  final TextEditingController _goodsDescription = TextEditingController();
  final TextEditingController _codAmount = TextEditingController(text: '0');
  bool _enableCod = false;

  String _feePayer = 'RECIPIENT'; // 'RECIPIENT' or 'SENDER'

  bool _customFee = false;
  final TextEditingController _feeAmount = TextEditingController();
  final TextEditingController _feeNote = TextEditingController();

  String? _problem;

  @override
  void dispose() {
    _senderName.dispose();
    _senderPhone.dispose();
    _pickupAddress.dispose();
    _recipientName.dispose();
    _recipientPhone.dispose();
    _dropoffAddress.dispose();
    _goodsDescription.dispose();
    _codAmount.dispose();
    _feeAmount.dispose();
    _feeNote.dispose();
    super.dispose();
  }

  bool get _hasGps => _pickupLat != null && _pickupLng != null && _dropoffLat != null && _dropoffLng != null;

  int get _codVnd => _enableCod ? (parseAgreedFee(_codAmount.text) ?? 0) : 0;
  int? get _proposedFee => _customFee ? parseAgreedFee(_feeAmount.text) : null;

  String get _recipientTotalSummary {
    final int cod = _codVnd;
    if (_feePayer == 'SENDER') {
      return cod > 0 ? '${m07Vnd(cod)} (Người gửi trả tiền ship)' : '0 đ (Người gửi trả tiền ship)';
    }
    // RECIPIENT pays fee
    if (_proposedFee != null) {
      return '${m07Vnd(cod + _proposedFee!)} (${m07Vnd(cod)} COD + ${m07Vnd(_proposedFee!)} ship)';
    }
    return cod > 0 ? '${m07Vnd(cod)} COD + Cước ship thỏa thuận' : 'Cước ship thỏa thuận';
  }

  Future<void> _pickPickupPin() async {
    if (widget.pinPicker == null) return;
    await Navigator.of(context).push(
      n11Route(
        widget.pinPicker!(
          context,
          lat: _pickupLat,
          lng: _pickupLng,
          onPick: (double lat, double lng) {
            setState(() {
              _pickupLat = lat;
              _pickupLng = lng;
            });
            Navigator.of(context).pop();
          },
        ),
      ),
    );
  }

  Future<void> _pickDropoffPin() async {
    if (widget.pinPicker == null) return;
    await Navigator.of(context).push(
      n11Route(
        widget.pinPicker!(
          context,
          lat: _dropoffLat,
          lng: _dropoffLng,
          onPick: (double lat, double lng) {
            setState(() {
              _dropoffLat = lat;
              _dropoffLng = lng;
            });
            Navigator.of(context).pop();
          },
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _problem = null);
    final String senderName = _senderName.text.trim();
    final String senderPhone = _senderPhone.text.replaceAll(RegExp(r'[\s.\-]'), '');
    final String pickupAddr = _pickupAddress.text.trim();

    final String recipientName = _recipientName.text.trim();
    final String recipientPhone = _recipientPhone.text.replaceAll(RegExp(r'[\s.\-]'), '');
    final String dropoffAddr = _dropoffAddress.text.trim();
    final String goods = _goodsDescription.text.trim();

    if (recipientName.isEmpty || dropoffAddr.isEmpty || goods.isEmpty) {
      setState(() => _problem = 'Hãy nhập đầy đủ thông tin người nhận, địa chỉ giao và mô tả hàng.');
      return;
    }
    if (!RegExp(r'^(0|\+84)\d{9}$').hasMatch(recipientPhone)) {
      setState(() => _problem = 'Số điện thoại người nhận không hợp lệ (10 chữ số).');
      return;
    }
    if (senderPhone.isNotEmpty && !RegExp(r'^(0|\+84)\d{9}$').hasMatch(senderPhone)) {
      setState(() => _problem = 'Số điện thoại người gửi không hợp lệ (10 chữ số).');
      return;
    }
    if (_enableCod && parseAgreedFee(_codAmount.text) == null) {
      setState(() => _problem = 'Tiền thu hộ (COD) phải là số nguyên từ 0 đến 10.000.000đ.');
      return;
    }
    if (_customFee && _proposedFee == null) {
      setState(() => _problem = 'Mức phí đề xuất phải là số nguyên từ 0 đến 10.000.000đ.');
      return;
    }

    final bool confirm = await showConfirmDialog(
      context,
      title: 'Xác nhận gọi shipper?',
      confirmLabel: 'Gọi shipper ngay',
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text('Người nhận: $recipientName ($recipientPhone)'),
          Text('Giao đến: $dropoffAddr'),
          Text('Hàng hóa: $goods'),
          if (_enableCod) Text('Thu hộ (COD): ${m07Vnd(_codVnd)}'),
          Text('Bên trả phí: ${_feePayer == "RECIPIENT" ? "Người nhận" : "Người gửi"}'),
          const SizedBox(height: 8),
          Text('Tổng người nhận trả: $_recipientTotalSummary', style: N11Text.bodyStrong),
          if (!_hasGps)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('⚠️ Thiếu định vị GPS: Chuyến giao vẫn tạo bình thường, tài xế liên hệ theo địa chỉ mô tả.', style: TextStyle(color: Colors.orange, fontSize: 13)),
            ),
        ],
      ),
    );
    if (!confirm || !mounted) return;

    final NewCustomerDeliveryInput input = NewCustomerDeliveryInput(
      senderName: senderName.isEmpty ? 'Khách gửi hàng' : senderName,
      senderPhone: senderPhone.isEmpty ? recipientPhone : senderPhone,
      pickupAddressText: pickupAddr.isEmpty ? 'Điểm lấy hàng' : pickupAddr,
      pickupLat: _pickupLat,
      pickupLng: _pickupLng,
      recipientName: recipientName,
      recipientPhone: recipientPhone,
      dropoffAddressText: dropoffAddr,
      dropoffLat: _dropoffLat,
      dropoffLng: _dropoffLng,
      goodsDescription: goods,
      goodsValueVnd: 0,
      codVnd: _codVnd,
      feePayer: _feePayer,
      note: _feeNote.text.trim().isEmpty ? null : _feeNote.text.trim(),
      agreedFee: _customFee && _proposedFee != null
          ? AgreedFeeInput(reasonCode: 'OTHER', reasonNote: _feeNote.text.trim().isEmpty ? null : _feeNote.text.trim(), amountVnd: _proposedFee!)
          : null,
    );

    DeliveryView? created;
    final bool ok = await act('customer-call', (String key) async {
      created = await widget.source.create(input, key: key);
    });

    if (ok && created != null && mounted) {
      Navigator.of(context).pushReplacement(
        n11Route(CustomerDeliveryDetailScreen(source: widget.source, deliveryId: created!.deliveryId, mapBuilder: widget.mapBuilder)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Gọi shipper giao hàng')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(N11Space.pad),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              // GPS Notice
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: _hasGps ? const Color(0xFFF0FDF4) : const Color(0xFFEFF6FF), borderRadius: BorderRadius.circular(8)),
                child: Row(
                  children: <Widget>[
                    Icon(_hasGps ? Icons.check_circle_outline : Icons.info_outline, color: _hasGps ? Colors.green : const Color(0xFF0284C7)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _hasGps ? 'Đã đủ tọa độ lấy và giao: Có thể xem tuyến đường' : 'Không bắt buộc định vị GPS: Thiếu GPS vẫn tạo và giao bình thường',
                        style: TextStyle(fontSize: 13, color: _hasGps ? Colors.green.shade800 : const Color(0xFF0369A1)),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              // SENDER
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('Điểm lấy hàng', style: N11Text.h2),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-sender-name'), label: 'Tên người gửi', controller: _senderName),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-sender-phone'), label: 'Số điện thoại người gửi', controller: _senderPhone, keyboard: TextInputType.phone),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-pickup-addr'), label: 'Địa chỉ lấy hàng', controller: _pickupAddress),
                    const SizedBox(height: N11Space.gap2),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: TextButton.icon(
                            onPressed: _pickPickupPin,
                            icon: const Icon(Icons.location_on_outlined),
                            label: Text(
                              _pickupLat != null ? 'Đã ghim (${_pickupLat!.toStringAsFixed(3)}, ${_pickupLng!.toStringAsFixed(3)})' : 'Ghim vị trí lấy hàng (tùy chọn)',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                        if (_pickupLat != null)
                          IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() { _pickupLat = null; _pickupLng = null; })),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              // RECIPIENT
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('Điểm giao hàng', style: N11Text.h2),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-recip-name'), label: 'Tên người nhận (*)', controller: _recipientName),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-recip-phone'), label: 'Số điện thoại người nhận (*)', controller: _recipientPhone, keyboard: TextInputType.phone),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-dropoff-addr'), label: 'Địa chỉ giao hàng (*)', controller: _dropoffAddress),
                    const SizedBox(height: N11Space.gap2),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: TextButton.icon(
                            onPressed: _pickDropoffPin,
                            icon: const Icon(Icons.location_on_outlined),
                            label: Text(
                              _dropoffLat != null ? 'Đã ghim (${_dropoffLat!.toStringAsFixed(3)}, ${_dropoffLng!.toStringAsFixed(3)})' : 'Ghim vị trí giao hàng (tùy chọn)',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                        if (_dropoffLat != null)
                          IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() { _dropoffLat = null; _dropoffLng = null; })),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              // PACKAGE & COD
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('Hàng hóa & Thu hộ (COD)', style: N11Text.h2),
                    const SizedBox(height: N11Space.gap2),
                    N11Field(fieldKey: const Key('m07-c-goods'), label: 'Mô tả hàng hóa (*)', controller: _goodsDescription, hint: 'Ví dụ: Quần áo, tài liệu, đồ gia dụng...'),
                    const SizedBox(height: N11Space.gap3),
                    Material(
                      type: MaterialType.transparency,
                      child: SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Thu hộ tiền hàng (COD)', style: N11Text.bodyStrong),
                        subtitle: const Text('Shipper thu hộ từ người nhận và đưa lại người gửi', style: N11Text.caption),
                        value: _enableCod,
                        onChanged: (bool v) => setState(() => _enableCod = v),
                      ),
                    ),
                    if (_enableCod) ...<Widget>[
                      const SizedBox(height: N11Space.gap2),
                      N11Field(
                        fieldKey: const Key('m07-c-cod-amount'),
                        label: 'Số tiền thu hộ (đ)',
                        controller: _codAmount,
                        keyboard: TextInputType.number,
                        hint: 'Tối đa 10.000.000đ',
                        onChanged: () => setState(() {}),
                      ),
                      const SizedBox(height: 4),
                      const Text('Lưu ý: Tiền thu hộ không tính vào thu nhập hay ví của shipper.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              // PAYMENT & FEE
              N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('Phí giao & Thanh toán', style: N11Text.h2),
                    const SizedBox(height: N11Space.gap2),
                    const Text('Bên chịu phí giao hàng:', style: N11Text.bodyStrong),
                    Material(
                      type: MaterialType.transparency,
                      child: Column(
                        children: <Widget>[
                          RadioListTile<String>(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Người nhận trả phí giao'),
                            value: 'RECIPIENT',
                            groupValue: _feePayer,
                            onChanged: (String? v) => setState(() => _feePayer = v!),
                          ),
                          RadioListTile<String>(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Người gửi trả phí giao'),
                            value: 'SENDER',
                            groupValue: _feePayer,
                            onChanged: (String? v) => setState(() => _feePayer = v!),
                          ),
                          const Divider(),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Đề xuất mức phí giao', style: N11Text.bodyStrong),
                            subtitle: const Text('Nhập mức phí bạn mong muốn để shipper xem xét', style: N11Text.caption),
                            value: _customFee,
                            onChanged: (bool v) => setState(() => _customFee = v),
                          ),
                        ],
                      ),
                    ),
                    if (_customFee) ...<Widget>[
                      const SizedBox(height: N11Space.gap2),
                      N11Field(
                        fieldKey: const Key('m07-c-fee-amount'),
                        label: 'Mức phí đề xuất (đ)',
                        controller: _feeAmount,
                        keyboard: TextInputType.number,
                        hint: 'Ví dụ: 30000',
                        onChanged: () => setState(() {}),
                      ),
                      const SizedBox(height: N11Space.gap2),
                      N11Field(
                        fieldKey: const Key('m07-c-fee-note'),
                        label: 'Ghi chú cước (tùy chọn)',
                        controller: _feeNote,
                        hint: 'Ví dụ: Hàng cồng kềnh, cần giao gấp...',
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              // SUMMARY CARD
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFFDE68A))),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('TỔNG TIỀN NGƯỜI NHẬN CẦN TRẢ:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF92400E))),
                    const SizedBox(height: 6),
                    Text(_recipientTotalSummary, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18, color: Color(0xFFB45309))),
                  ],
                ),
              ),

              if (_problem != null) ...<Widget>[
                const SizedBox(height: N11Space.gap3),
                N11Banner(kind: BannerKind.error, title: 'Chưa thể tạo đơn', text: _problem!),
              ],
              actionBanner(),

              const SizedBox(height: N11Space.gap4),
              N11Button(
                key: const Key('m07-c-submit'),
                label: 'Xác nhận gọi shipper',
                icon: Icons.two_wheeler,
                loading: busy,
                onPressed: busy ? null : _submit,
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

// ---- Customer Delivery Detail Screen -----------------------------------------------------------------------------------------

class CustomerDeliveryDetailScreen extends StatefulWidget {
  const CustomerDeliveryDetailScreen({super.key, required this.source, required this.deliveryId, this.mapBuilder});

  final CustomerDeliverySource source;
  final String deliveryId;
  final M07MapBuilder? mapBuilder;

  @override
  State<CustomerDeliveryDetailScreen> createState() => _CustomerDeliveryDetailScreenState();
}

class _CustomerDeliveryDetailScreenState extends State<CustomerDeliveryDetailScreen> with M07Actions<CustomerDeliveryDetailScreen> {
  int _rev = 0;
  TrackingLinkResult? _trackingLink;
  TrackingLinkStatus? _trackingStatus;

  @override
  void initState() {
    super.initState();
    _loadTrackingStatus();
  }

  Future<void> _loadTrackingStatus() async {
    try {
      final TrackingLinkStatus status = await widget.source.getTrackingLinkStatus(widget.deliveryId);
      if (mounted) setState(() => _trackingStatus = status);
    } catch (_) {}
  }

  Future<void> _createLink() async {
    try {
      final TrackingLinkResult res = await widget.source.createTrackingLink(widget.deliveryId);
      if (mounted) {
        setState(() {
          _trackingLink = res;
          _trackingStatus = TrackingLinkStatus(hasActiveLink: true, shareLocation: res.shareLocation);
        });
      }
    } catch (_) {}
  }

  Future<void> _toggleLocation(bool val) async {
    try {
      final TrackingLinkStatus status = await widget.source.toggleTrackingLocation(widget.deliveryId, shareLocation: val);
      if (mounted) setState(() => _trackingStatus = status);
    } catch (_) {}
  }

  Future<void> _revokeLink() async {
    try {
      await widget.source.revokeTrackingLink(widget.deliveryId);
      if (mounted) {
        setState(() {
          _trackingLink = null;
          _trackingStatus = const TrackingLinkStatus(hasActiveLink: false, shareLocation: false);
        });
      }
    } catch (_) {}
  }

  Future<void> _cancel(DeliveryView d) async {
    final TextEditingController reason = TextEditingController();
    final bool yes = await showConfirmDialog(
      context,
      title: 'Hủy chuyến giao?',
      confirmLabel: 'Xác nhận hủy',
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Text('Chuyến giao sẽ kết thúc và shipper (nếu có) sẽ được giải phóng.'),
          const SizedBox(height: 12),
          N11Field(fieldKey: const Key('m07-c-cancel-reason'), label: 'Lý do hủy (*)', controller: reason),
        ],
      ),
    );
    if (!yes || !mounted) return;
    if (reason.text.trim().isEmpty) return;

    final bool ok = await act('customer-cancel-${d.deliveryId}', (String key) => widget.source.cancel(d.deliveryId, reason: reason.text.trim(), expectedVersion: d.version, key: key));
    if (ok && mounted) setState(() => _rev++);
  }

  Future<void> _cancelAfterPickup(DeliveryView d) async {
    final TextEditingController reason = TextEditingController();
    final bool yes = await showConfirmDialog(
      context,
      title: 'Hủy sau khi shipper đã lấy hàng?',
      confirmLabel: 'Xác nhận hủy',
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Text('⚠️ Shipper đã nhận hàng. Khi hủy, chuyến giao kết thúc và hàng hóa vẫn ở shipper cho tới khi giải quyết.'),
          const SizedBox(height: 12),
          N11Field(fieldKey: const Key('m07-c-cancel-reason-after'), label: 'Lý do hủy (*)', controller: reason),
        ],
      ),
    );
    if (!yes || !mounted) return;
    if (reason.text.trim().isEmpty) return;

    final bool ok = await act('customer-cancel-after-${d.deliveryId}', (String key) => widget.source.cancelAfterPickup(d.deliveryId, reason: reason.text.trim(), expectedVersion: d.version, key: key));
    if (ok && mounted) setState(() => _rev++);
  }

  Future<void> _acceptCounter(DeliveryView d) async {
    final bool ok = await act('customer-agree-${d.deliveryId}', (String key) => widget.source.counterAccept(d.deliveryId, expectedVersion: d.version, key: key));
    if (ok && mounted) setState(() => _rev++);
  }

  Future<void> _rejectCounter(DeliveryView d) async {
    final bool ok = await act('customer-reject-${d.deliveryId}', (String key) => widget.source.counterReject(d.deliveryId, expectedVersion: d.version, key: key));
    if (ok && mounted) setState(() => _rev++);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Chi tiết chuyến giao')),
      body: M07Loader<DeliveryView>(
        keyPrefix: 'customer-delivery-detail',
        key: ValueKey<int>(_rev),
        load: () => widget.source.get(widget.deliveryId),
        builder: (BuildContext context, DeliveryView d, Future<void> Function() reload) {
          final bool hasBothPins = d.pickup.lat != null && d.pickup.lng != null && d.recipient.lat != null && d.recipient.lng != null;
          final bool isActive = d.state.isActive;
          final AgreementSummary? a = d.fee.agreement;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(N11Space.pad),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                // STATUS HEADER
                N11Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          Expanded(child: Text(d.code, style: N11Text.h2)),
                          const SizedBox(width: 8),
                          N11Chip(m07StateChip(d.state).label, kind: m07StateChip(d.state).kind),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text('Tạo lúc: ${d.search.startedAt.toLocal().toString().substring(0, 16)}', style: N11Text.caption),
                    ],
                  ),
                ),
                const SizedBox(height: N11Space.gap3),

                // MAP SECTION (only when both pins exist)
                if (hasBothPins && widget.mapBuilder != null && isActive) ...<Widget>[
                  SizedBox(
                    height: 220,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: widget.mapBuilder!(
                        context,
                        <M07MapPin>[
                          M07MapPin(lat: d.pickup.lat!, lng: d.pickup.lng!, label: 'Điểm lấy', color: 0xFF0284C7),
                          M07MapPin(lat: d.recipient.lat!, lng: d.recipient.lng!, label: 'Điểm giao', color: 0xFF16A34A),
                          if (d.location != null)
                            M07MapPin(lat: d.location!.lat, lng: d.location!.lng, label: 'Shipper', color: 0xFF2A2A2E),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: N11Space.gap3),
                ] else if (!hasBothPins) ...<Widget>[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(8)),
                    child: const Row(
                      children: <Widget>[
                        Icon(Icons.location_off_outlined, color: Color(0xFF64748B)),
                        SizedBox(width: 8),
                        Expanded(child: Text('Chuyến giao theo địa chỉ mô tả, không có định vị GPS bản đồ.', style: TextStyle(color: Color(0xFF475569), fontSize: 13))),
                      ],
                    ),
                  ),
                  const SizedBox(height: N11Space.gap3),
                ],

                // FEE COUNTER PROPOSAL
                if (a != null && a.state == 'COUNTERED' && d.allows('decide_fee')) ...<Widget>[
                  N11Card(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text('Shipper đề xuất phí mới', style: N11Text.h2),
                        const SizedBox(height: N11Space.gap2),
                        KeyValueRows(<(String, String)>[
                          if (a.counterVnd != null) ('Mức đề xuất', m07Vnd(a.counterVnd!)),
                          if (a.reasonCode.isNotEmpty) ('Lý do', a.reasonCode),
                        ], responsive: true),
                        const SizedBox(height: N11Space.gap3),
                        Row(
                          children: <Widget>[
                            Expanded(child: N11Button(key: const Key('customer-counter-accept'), label: 'Đồng ý', onPressed: busy ? null : () => _acceptCounter(d))),
                            const SizedBox(width: N11Space.gap3),
                            Expanded(child: N11Button(key: const Key('customer-counter-reject'), label: 'Từ chối', kind: ButtonKind.secondary, onPressed: busy ? null : () => _rejectCounter(d))),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: N11Space.gap3),
                ],

                // SHIPPER CARD
                if (d.assignment != null) ...<Widget>[
                  N11Card(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text('Shipper phụ trách', style: N11Text.h2),
                        const SizedBox(height: 8),
                        Text(d.assignment!.shipperName, style: N11Text.bodyStrong),
                        if (d.assignment!.shipperPhone != null) Text('SĐT: ${d.assignment!.shipperPhone}'),
                        if (d.assignment!.plateNumber != null) Text('Biển số: ${d.assignment!.plateNumber}'),
                      ],
                    ),
                  ),
                  const SizedBox(height: N11Space.gap3),
                ],

                // PACKAGE & MONEY
                N11Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text('Thông tin giao dịch', style: N11Text.h2),
                      const SizedBox(height: N11Space.gap2),
                      KeyValueRows(<(String, String)>[
                        ('Hàng hóa', d.goods.description),
                        if (d.goods.codVnd != null && d.goods.codVnd! > 0)
                          ('Thu hộ (COD)', m07Vnd(d.goods.codVnd!)),
                        ('Phí giao hàng', d.fee.amountVnd != null ? m07Vnd(d.fee.amountVnd!) : 'Chưa xác định'),
                        ('Người trả cước', switch (d.fee.payer) {
                          'RECIPIENT' => 'Người nhận trả ship',
                          'SENDER' => 'Người gửi trả ship',
                          'SHOP' => 'Quán trả ship',
                          _ => 'Khách trả ship',
                        }),
                        if (d.goods.recipientPaysVnd != null)
                          ('Người nhận trả', m07Vnd(d.goods.recipientPaysVnd!)),
                      ], responsive: true),
                    ],
                  ),
                ),
                const SizedBox(height: N11Space.gap3),

                // POINTS
                N11Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text('Điểm lấy & giao', style: N11Text.h2),
                      const SizedBox(height: N11Space.gap2),
                      KeyValueRows(<(String, String)>[
                        ('Lấy tại', '${d.pickup.shopName} · ${d.pickup.addressText ?? "Điểm lấy"}'),
                        ('Giao đến', '${d.recipient.name} (${d.recipient.phone ?? ""}) · ${d.recipient.addressText ?? "Điểm giao"}'),
                      ], responsive: true),
                    ],
                  ),
                ),
                const SizedBox(height: N11Space.gap3),

                // PUBLIC TRACKING SHARING (Requirement C)
                N11Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          const Icon(Icons.share_outlined, color: Color(0xFF0284C7)),
                          const SizedBox(width: 8),
                          const Expanded(child: Text('Theo dõi & Chia sẻ công khai', style: N11Text.h2)),
                        ],
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Người nhận có thể xem trạng thái đơn qua đường dẫn mà không cần tài khoản hay ứng dụng.',
                        style: N11Text.caption,
                      ),
                      const SizedBox(height: 12),
                      if (_trackingStatus?.hasActiveLink == true) ...<Widget>[
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(8)),
                          child: Row(
                            children: <Widget>[
                              Expanded(
                                child: Text(
                                  _trackingLink != null ? _trackingLink!.trackingUrl : 'Đang hoạt động (token bí mật)',
                                  style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                                ),
                              ),
                              if (_trackingLink != null)
                                IconButton(
                                  icon: const Icon(Icons.copy, size: 20),
                                  tooltip: 'Sao chép liên kết',
                                  onPressed: () {
                                    Clipboard.setData(ClipboardData(text: _trackingLink!.trackingUrl));
                                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã sao chép liên kết theo dõi')));
                                  },
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Material(
                          type: MaterialType.transparency,
                          child: SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Chia sẻ vị trí shipper trực tiếp', style: N11Text.bodyStrong),
                            subtitle: const Text('Mặc định tắt. Bật khi muốn người nhận thấy vị trí GPS trực tiếp.', style: N11Text.caption),
                            value: _trackingStatus?.shareLocation ?? false,
                            onChanged: _toggleLocation,
                          ),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: _revokeLink,
                          child: const Text('Thu hồi liên kết chia sẻ', style: TextStyle(color: Colors.red)),
                        ),
                      ] else ...<Widget>[
                        FilledButton.tonalIcon(
                          icon: const Icon(Icons.link),
                          label: const Text('Tạo liên kết chia sẻ cho người nhận'),
                          onPressed: _createLink,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: N11Space.gap3),

                // ACTIONS
                if (d.can.contains('cancel') && d.state.beforePickup)
                  N11Button(
                    key: const Key('m07-c-btn-cancel'),
                    label: 'Hủy chuyến giao',
                    kind: ButtonKind.secondary,
                    loading: busy,
                    onPressed: busy ? null : () => _cancel(d),
                  ),

                if (d.can.contains('cancel_after_pickup'))
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: N11Button(
                      key: const Key('m07-c-btn-cancel-after'),
                      label: 'Hủy chuyến (đã lấy hàng)',
                      kind: ButtonKind.secondary,
                      loading: busy,
                      onPressed: busy ? null : () => _cancelAfterPickup(d),
                    ),
                  ),

                actionBanner(),
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ---- Customer Delivery Hub ---------------------------------------------------------------------------------------------------

class CustomerDeliveryHub extends StatefulWidget {
  const CustomerDeliveryHub({super.key, required this.source, this.mapBuilder, this.pinPicker});

  final CustomerDeliverySource source;
  final M07MapBuilder? mapBuilder;
  final M07PinPickerBuilder? pinPicker;

  @override
  State<CustomerDeliveryHub> createState() => _CustomerDeliveryHubState();
}

class _CustomerDeliveryHubState extends State<CustomerDeliveryHub> {
  bool _history = false;

  void _openCallScreen() {
    Navigator.of(context).push(
      n11Route(CustomerCallScreen(
        source: widget.source,
        pinPicker: widget.pinPicker,
        mapBuilder: widget.mapBuilder,
      )),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.source.isSample) const M07SampleBanner(),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: N11Space.gap2,
          runSpacing: N11Space.gap2,
          children: <Widget>[
            Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                ChoiceChip(
                  key: const Key('m07-customer-hub-tab-active'),
                  label: const Text('Đang xử lý'),
                  selected: !_history,
                  onSelected: (bool sel) {
                    if (sel) setState(() => _history = false);
                  },
                ),
                const SizedBox(width: N11Space.gap2),
                ChoiceChip(
                  key: const Key('m07-customer-hub-tab-history'),
                  label: const Text('Lịch sử'),
                  selected: _history,
                  onSelected: (bool sel) {
                    if (sel) setState(() => _history = true);
                  },
                ),
              ],
            ),
            FilledButton.icon(
              key: const Key('m07-customer-call-shipper'),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Gọi shipper'),
              style: FilledButton.styleFrom(
                backgroundColor: N11Colors.yellow,
                foregroundColor: N11Colors.black,
              ),
              onPressed: _openCallScreen,
            ),
          ],
        ),
        const SizedBox(height: N11Space.gap3),
        M07Loader<List<DeliveryView>>(
          key: ValueKey<bool>(_history),
          keyPrefix: _history ? 'customer-deliveries-history' : 'customer-deliveries-active',
          load: () => widget.source.list(history: _history),
          refreshEvery: const Duration(seconds: 15),
          isEmpty: (List<DeliveryView> items) => items.isEmpty,
          emptyIcon: Icons.local_shipping_outlined,
          emptyTitle: _history ? 'Chưa có lịch sử giao hàng' : 'Chưa có chuyến giao đang xử lý',
          emptyText: _history ? 'Các chuyến giao đã hoàn tất hoặc đã hủy sẽ hiển thị ở đây.' : 'Bạn có thể gọi shipper giao đồ mọi lúc mọi nơi.',
          builder: (BuildContext context, List<DeliveryView> items, Future<void> Function() reload) => Column(
            children: <Widget>[
              for (final DeliveryView d in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: N11Space.gap3),
                  child: InkWell(
                    key: Key('customer-delivery-card-${d.deliveryId}'),
                    borderRadius: BorderRadius.circular(kRadiusCard),
                    onTap: () async {
                      await Navigator.of(context).push(
                        n11Route(CustomerDeliveryDetailScreen(
                          source: widget.source,
                          deliveryId: d.deliveryId,
                          mapBuilder: widget.mapBuilder,
                        )),
                      );
                      await reload();
                    },
                    child: N11Card(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: <Widget>[
                              Expanded(child: Text(d.code, style: N11Text.h2)),
                              const SizedBox(width: 8),
                              N11Chip(m07StateChip(d.state).label, kind: m07StateChip(d.state).kind),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(d.goods.description, style: N11Text.bodyStrong),
                          const SizedBox(height: 6),
                          Row(
                            children: <Widget>[
                              const Icon(Icons.location_on_outlined, size: 16, color: N11Colors.ink2),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  'Đến: ${d.recipient.addressText}',
                                  style: N11Text.caption,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 8,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: <Widget>[
                              if (d.goods.codVnd != null && d.goods.codVnd! > 0)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFEF3C7),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'COD: ${m07Vnd(d.goods.codVnd!)}',
                                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFFB45309)),
                                  ),
                                ),
                              if (d.goods.recipientPaysVnd != null)
                                Text(
                                  'Người nhận trả: ${m07Vnd(d.goods.recipientPaysVnd!)}',
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF047857)),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

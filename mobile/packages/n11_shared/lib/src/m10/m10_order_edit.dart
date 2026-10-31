import 'dart:async';

import 'package:flutter/material.dart';

import '../addresses/address_models.dart';
import '../m07/m07_source.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm10_cart.dart';
import 'm10_models.dart';
import 'm10_source.dart';

// Issue #238: "Sửa đơn" — the customer changes an Order that still waits for the shop (dishes and quantities, note, recipient, delivery address). Nothing is
// written until "Lưu thay đổi": the screen first asks the server to price THIS draft ("Xem lại số tiền": the same check as the checkout, today's prices and the
// fee quote), shows the new total, and only then sends the edit with the prices and the quote the customer saw. A closed or abandoned editor changes nothing; a
// failed save keeps what was typed. If the shop confirmed meanwhile the server writes nothing and the customer is told to contact the shop.

const String kEditLockedText = 'Quán đã xác nhận đơn. Bạn vui lòng liên hệ quán để thay đổi.';

String _vnd(int amount) {
  final String digits = amount.abs().toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write('.');
    out.write(digits[i]);
  }
  return '${amount < 0 ? '-' : ''}$out đ';
}

class _EditLine {
  _EditLine({required this.itemId, required this.name, required this.quantity, required this.priceVnd, this.note});

  final String itemId;
  final String name;
  int quantity;
  int priceVnd;
  final String? note;
}

class OrderEditScreen extends StatefulWidget {
  const OrderEditScreen({super.key, required this.runtime, required this.order});

  final OrderRuntime runtime;
  final OrderView order;

  @override
  State<OrderEditScreen> createState() => _OrderEditState();
}

class _OrderEditState extends State<OrderEditScreen> with M07Actions<OrderEditScreen> {
  late final List<_EditLine> _lines = <_EditLine>[
    for (final OrderLine l in widget.order.items)
      if (!l.removed) _EditLine(itemId: l.itemId, name: l.name, quantity: l.quantity, priceVnd: l.unitPriceVnd, note: l.note),
  ];
  late final TextEditingController _note = TextEditingController(text: widget.order.note ?? '');
  late final TextEditingController _name = TextEditingController(text: widget.order.recipient.name);
  late final TextEditingController _phone = TextEditingController(text: widget.order.recipient.phone);
  late DraftAddress _address = DraftAddress.typed(widget.order.recipient.addressText, lat: widget.order.recipient.lat, lng: widget.order.recipient.lng);
  CheckoutPreview? _preview;
  bool _previewing = false;
  String? _message;
  bool _locked = false;
  List<EditDish>? _menu;

  @override
  void dispose() {
    _note.dispose();
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  CheckoutDraft get _draft => CheckoutDraft(
        shopId: widget.order.shop.shopId,
        shopName: widget.order.shop.name,
        lines: <DraftLine>[for (final _EditLine l in _lines) DraftLine(itemId: l.itemId, name: l.name, quantity: l.quantity, priceVnd: l.priceVnd, note: l.note)],
        note: _note.text.trim().isEmpty ? null : _note.text.trim(),
        deliveryNote: widget.order.deliveryNote,
        recipientName: _name.text.trim(),
        recipientPhone: _phone.text.trim(),
        address: _address,
        scheduledFor: null,
      );

  int get _itemsTotal => _lines.fold(0, (int sum, _EditLine l) => sum + l.quantity * l.priceVnd);

  /// Any change makes the earlier price check void: the server prices the new draft again before it can be saved.
  void _touched() => setState(() {
        _preview = null;
        _message = null;
      });

  Future<void> _review() async {
    if (_lines.isEmpty) {
      setState(() => _message = 'Đơn cần ít nhất một món. Muốn bỏ hết món, hãy dùng "Hủy đơn".');
      return;
    }
    setState(() {
      _previewing = true;
      _message = null;
    });
    try {
      final CheckoutPreview preview = await widget.runtime.customer.preview(_draft);
      if (!mounted) return;
      setState(() {
        _preview = preview;
        _previewing = false;
        // Today's prices replace what the editor held: the customer sees them in the lines and confirms them by saving.
        for (final PreviewLine p in preview.lines) {
          final int index = _lines.indexWhere((_EditLine l) => l.itemId == p.itemId && l.note == p.note);
          if (index >= 0 && p.priceVnd != null) _lines[index].priceVnd = p.priceVnd!;
        }
        if (!preview.ok) _message = 'Có món không còn bán hoặc đã đổi giá. Hãy kiểm tra các món bên dưới.';
      });
    } on M07Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        _previewing = false;
        _message = m10FailureText(failure);
      });
    }
  }

  Future<void> _save() async {
    final CheckoutPreview? preview = _preview;
    if (preview == null || !preview.ok) {
      await _review();
      return;
    }
    final bool saved = await act('edit', (String key) async {
      await widget.runtime.customer.editOrder(widget.order.orderId, _draft, preview: preview, expectedVersion: widget.order.version, key: key);
    }, onConflict: () async {
      if (mounted) setState(() => _preview = null);
    });
    if (!mounted) return;
    if (saved) {
      Navigator.of(context).pop();
      return;
    }
    final M07Failure? failure = actionFailure;
    if (failure?.code == 'ORDER_EDIT_LOCKED') {
      setState(() => _locked = true);
    } else if (failure?.code == 'ORDER_QUOTE_CHANGED' || failure?.code == 'ORDER_CART_CHANGED') {
      // The draft stays as typed; the customer prices it again and sees what changed.
      setState(() => _preview = null);
    }
  }

  Future<void> _addDish() async {
    final List<EditDish> menu = _menu ??= await widget.runtime.customer.editMenu(widget.order.orderId);
    if (!mounted) return;
    final EditDish? chosen = await showModalBottomSheet<EditDish>(
      context: context,
      builder: (BuildContext sheet) => SafeArea(
        child: ListView(
          key: const Key('order-edit-menu'),
          shrinkWrap: true,
          children: <Widget>[
            for (final EditDish d in menu) ListTile(key: Key('order-edit-add-${d.itemId}'), title: Text(d.name), trailing: Text(_vnd(d.priceVnd)), onTap: () => Navigator.of(sheet).pop(d)),
            if (menu.isEmpty) const ListTile(title: Text('Quán chưa có món nào đang bán.')),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    final int existing = _lines.indexWhere((_EditLine l) => l.itemId == chosen.itemId && l.note == null);
    if (existing >= 0) {
      _lines[existing].quantity += 1;
    } else {
      _lines.add(_EditLine(itemId: chosen.itemId, name: chosen.name, quantity: 1, priceVnd: chosen.priceVnd));
    }
    _touched();
  }

  Future<void> _pickAddress() async {
    final List<DeliveryAddress> book = widget.runtime.addresses?.addresses ?? const <DeliveryAddress>[];
    final DeliveryAddress? chosen = await showModalBottomSheet<DeliveryAddress>(
      context: context,
      builder: (BuildContext sheet) => SafeArea(
        child: ListView(
          key: const Key('order-edit-addresses'),
          shrinkWrap: true,
          children: <Widget>[
            for (final DeliveryAddress a in book) ListTile(key: Key('order-edit-address-${a.id}'), title: Text(a.displayName ?? a.addressText), subtitle: Text(a.addressText), onTap: () => Navigator.of(sheet).pop(a)),
            if (book.isEmpty) const ListTile(title: Text('Sổ địa chỉ chưa có địa chỉ nào. Thêm địa chỉ trong Tài khoản trước.')),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    // A new place is a new pin: it comes from the address book (text and pin together), never the old pin under new words.
    _address = DraftAddress.book(chosen.id, text: chosen.addressText, lat: chosen.latitude, lng: chosen.longitude);
    _touched();
  }

  @override
  Widget build(BuildContext context) {
    final CheckoutPreview? preview = _preview;
    final Set<String> flagged = preview == null ? const <String>{} : <String>{for (final PreviewLine l in preview.lines) if (l.issue != null) l.itemId};
    final bool pricedOk = preview != null && preview.ok;
    return m07Page(
      'Sửa đơn',
      widget.runtime.customer.isSample,
      <Widget>[
        if (_locked) const N11Banner(key: Key('order-edit-locked'), kind: BannerKind.warn, title: 'Không sửa được nữa', text: kEditLockedText),
        actionBanner(),
        if (_message != null) N11Banner(key: const Key('order-edit-message'), kind: BannerKind.warn, title: 'Chưa lưu được', text: _message!),
        const Text('Món', style: N11Text.label),
        for (int i = 0; i < _lines.length; i += 1)
          Padding(
            key: Key('order-edit-line-${_lines[i].itemId}'),
            padding: const EdgeInsets.symmetric(vertical: N11Space.gap2),
            child: Row(children: <Widget>[
              Expanded(child: Text('${_lines[i].name}${flagged.contains(_lines[i].itemId) ? ' (cần kiểm tra)' : ''}\n${_vnd(_lines[i].priceVnd)}')),
              IconButton(key: Key('order-edit-minus-${_lines[i].itemId}'), icon: const Icon(Icons.remove_circle_outline), onPressed: busy || _lines[i].quantity <= 1 ? null : () => setState(() { _lines[i].quantity -= 1; _touched(); })),
              Text('${_lines[i].quantity}', key: Key('order-edit-qty-${_lines[i].itemId}')),
              IconButton(key: Key('order-edit-plus-${_lines[i].itemId}'), icon: const Icon(Icons.add_circle_outline), onPressed: busy || _lines[i].quantity >= 99 ? null : () => setState(() { _lines[i].quantity += 1; _touched(); })),
              IconButton(key: Key('order-edit-remove-${_lines[i].itemId}'), icon: const Icon(Icons.delete_outline), onPressed: busy ? null : () => setState(() { _lines.removeAt(i); _touched(); })),
            ]),
          ),
        N11Button(key: const Key('order-edit-add'), label: 'Thêm món', compact: true, kind: ButtonKind.secondary, onPressed: busy ? null : () => unawaited(_addDish())),
        const SizedBox(height: N11Space.gap3),
        N11Field(fieldKey: const Key('order-edit-note'), label: 'Ghi chú cho quán', controller: _note, maxLength: 200, optionalLabel: true, enabled: !busy, onChanged: _touched),
        N11Field(fieldKey: const Key('order-edit-name'), label: 'Người nhận', controller: _name, maxLength: 80, enabled: !busy, onChanged: _touched),
        N11Field(fieldKey: const Key('order-edit-phone'), label: 'Số điện thoại người nhận', controller: _phone, maxLength: 20, keyboard: TextInputType.phone, enabled: !busy, onChanged: _touched),
        const Text('Địa chỉ giao', style: N11Text.label),
        Text(_address.text, key: const Key('order-edit-address-text')),
        N11Button(key: const Key('order-edit-pick-address'), label: 'Chọn địa chỉ khác', compact: true, kind: ButtonKind.secondary, onPressed: busy ? null : () => unawaited(_pickAddress())),
        const SizedBox(height: N11Space.gap3),
        if (preview != null) ...<Widget>[
          Text('Tiền món: ${_vnd(preview.itemsVnd)}', key: const Key('order-edit-items-total')),
          Text(
            preview.feeEstimateVnd == null ? 'Phí giao: chưa xác định (tổng chưa gồm phí)' : 'Phí giao dự kiến: ${_vnd(preview.feeEstimateVnd!)}${preview.feeDistanceM == null ? '' : ' · ${(preview.feeDistanceM! / 1000).toStringAsFixed(1)} km'}',
            key: const Key('order-edit-fee'),
          ),
          Text('Trước khi sửa: ${_vnd(widget.order.money.itemsVnd)}. Sau khi sửa: ${_vnd(preview.itemsVnd)}.', key: const Key('order-edit-compare')),
        ] else
          Text('Tiền món tạm tính: ${_vnd(_itemsTotal)}. Bấm "Xem lại số tiền" để quán tính lại giá và phí giao trước khi lưu.', key: const Key('order-edit-draft-total')),
      ],
      bottom: Row(children: <Widget>[
        Expanded(child: N11Button(key: const Key('order-edit-review'), label: 'Xem lại số tiền', kind: ButtonKind.secondary, loading: _previewing, onPressed: busy || _previewing || _locked ? null : () => unawaited(_review()))),
        const SizedBox(width: N11Space.gap3),
        Expanded(child: N11Button(key: const Key('order-edit-save'), label: 'Lưu thay đổi', loading: busy, onPressed: busy || _previewing || _locked || !pricedOk ? null : () => unawaited(_save()))),
      ]),
    );
  }
}

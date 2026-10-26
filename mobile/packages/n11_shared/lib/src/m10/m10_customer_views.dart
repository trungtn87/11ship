import 'dart:async';
import '../m02/availability_refresh.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../addresses/address_controller.dart';
import '../addresses/address_models.dart';
import '../addresses/address_views.dart';
import '../addresses/address_location_picker.dart';
import '../m02/m02_widgets.dart';
import '../m02/shop_contact.dart';
import '../m07/m07_models.dart';
import '../m07/m07_source.dart';
import '../m11/m11_entries.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/form_feedback.dart';
import 'm10_cart.dart';
import 'm10_common.dart';
import 'm10_models.dart';
import 'm10_source.dart';
import 'order_chat_models.dart';
import 'order_chat_view.dart';
import 'order_sections.dart';

// The customer's side of M10 in 11Food: choose dishes (+ / − and a note), the cart, the check and sending, "Đơn hàng" (Đang xử lý / Đơn hẹn / Lịch sử),
// the detail with the Shipper and the map of the CURRENT delivery, cancelling before the shop confirms, and ordering again.
// Wording follows the approved functional document: the shop confirms, the customer cancels only before that; the wanted time is a wish, not a promise.

// ---- choosing dishes -------------------------------------------------------------------------------------------------

/// The + / − of a menu row. Adding a dish of another shop asks first.
class DishStepper extends StatelessWidget {
  const DishStepper({super.key, required this.cart, required this.shopId, required this.shopName, required this.itemId, required this.name, required this.priceVnd, this.canOrder});

  /// Whether the person may order now; a guest is told to sign in instead.
  final bool Function()? canOrder;

  final CartController cart;
  final String shopId;
  final String shopName;
  final String itemId;
  final String name;
  final int priceVnd;

  Future<void> _add(BuildContext context) async {
    if (canOrder != null && !canOrder!()) {
      m02Toast(context, 'Đăng nhập tài khoản khách để đặt món.');
      return;
    }
    var replace = false;
    if (cart.needsReplace(shopId)) {
      final String? choice = await showDecision(
        context,
        title: 'Thay giỏ hàng?',
        text: 'Giỏ đang có món của ${cart.shopName}. Mỗi giỏ chỉ đặt từ một quán. Bạn muốn xóa giỏ cũ và bắt đầu giỏ mới ở $shopName?',
        actions: const <DialogAction>[DialogAction('Giữ giỏ cũ', 'keep', key: Key('cart-replace-keep')), DialogAction('Thay giỏ', 'replace', kind: ButtonKind.primary, key: Key('cart-replace-yes'))],
      );
      if (choice != 'replace') {
        return;
      }
      replace = true;
    }
    await cart.add(shopId: shopId, shopName: shopName, itemId: itemId, name: name, priceVnd: priceVnd, replace: replace);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (BuildContext context, Widget? _) {
        final int q = cart.shopId == shopId ? cart.quantityOf(itemId) : 0;
        if (q == 0) {
          return SizedBox(
            width: kTapMin,
            height: kTapMin,
            child: IconButton(key: Key('dish-add-$itemId'), tooltip: 'Thêm $name vào giỏ', onPressed: () => unawaited(_add(context)), style: IconButton.styleFrom(backgroundColor: N11Colors.yellow), icon: const Icon(Icons.add, color: N11Colors.black)),
          );
        }
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            SizedBox(width: 40, height: 40, child: IconButton(key: Key('dish-minus-$itemId'), tooltip: 'Bớt $name', onPressed: () => unawaited(cart.decrease(itemId)), icon: const Icon(Icons.remove_circle_outline))),
            SizedBox(width: 24, child: Text('$q', key: Key('dish-qty-$itemId'), textAlign: TextAlign.center, style: N11Text.bodyStrong)),
            SizedBox(width: 40, height: 40, child: IconButton(key: Key('dish-plus-$itemId'), tooltip: 'Thêm $name', onPressed: () => unawaited(_add(context)), icon: const Icon(Icons.add_circle, color: N11Colors.yellowStrong))),
          ],
        );
      },
    );
  }
}

/// Tap a dish: choose the quantity and a note for it ("ít cay"). The same dish with the same note joins one line; another note is another line.
Future<void> showDishSheet(BuildContext context, {required CartController cart, required String shopId, required String shopName, required String itemId, required String name, required int priceVnd, String? description, bool Function()? canAdd}) async {
  var replace = false;
  if (cart.needsReplace(shopId)) {
    final String? choice = await showDecision(
      context,
      title: 'Thay giỏ hàng?',
      text: 'Giỏ đang có món của ${cart.shopName}. Mỗi giỏ chỉ đặt từ một quán. Bạn muốn xóa giỏ cũ và bắt đầu giỏ mới ở $shopName?',
      actions: const <DialogAction>[DialogAction('Giữ giỏ cũ', 'keep'), DialogAction('Thay giỏ', 'replace', kind: ButtonKind.primary, key: Key('cart-replace-yes'))],
    );
    if (choice != 'replace' || !context.mounted) {
      return;
    }
    replace = true;
  }
  if (!context.mounted) {
    return;
  }
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: N11Colors.white,
    builder: (BuildContext sheet) => _DishSheet(cart: cart, shopId: shopId, shopName: shopName, itemId: itemId, name: name, priceVnd: priceVnd, replace: replace, description: description, canAdd: canAdd),
  );
}

class _DishSheet extends StatefulWidget {
  const _DishSheet({required this.cart, required this.shopId, required this.shopName, required this.itemId, required this.name, required this.priceVnd, required this.replace, this.description, this.canAdd});

  final CartController cart;
  final String shopId;
  final String shopName;
  final String itemId;
  final String name;
  final int priceVnd;
  final bool replace;
  final String? description;
  final bool Function()? canAdd;

  @override
  State<_DishSheet> createState() => _DishSheetState();
}

class _DishSheetState extends State<_DishSheet> {
  final TextEditingController _note = TextEditingController();
  int _qty = 1;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Form(child: SingleChildScrollView(child: Padding(
      padding: EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, MediaQuery.of(context).viewInsets.bottom + N11Space.gap4),
      child: Column(
        key: const Key('dish-sheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(widget.name, style: N11Text.h2),
          Text(m10Money(widget.priceVnd), style: N11Text.bodyStrong),
          ExpandableDishDescription(text: widget.description),
          const SizedBox(height: N11Space.gap3),
          Row(
            children: <Widget>[
              const Expanded(child: Text('Số lượng', style: N11Text.label)),
              IconButton(key: const Key('sheet-minus'), onPressed: _qty > 1 ? () => setState(() => _qty -= 1) : null, icon: const Icon(Icons.remove_circle_outline)),
              Text('$_qty', key: const Key('sheet-qty'), style: N11Text.bodyStrong),
              IconButton(key: const Key('sheet-plus'), onPressed: _qty < 99 ? () => setState(() => _qty += 1) : null, icon: const Icon(Icons.add_circle, color: N11Colors.yellowStrong)),
            ],
          ),
          N11Field(fieldKey: const Key('sheet-note'), label: 'Ghi chú cho món', controller: _note, maxLength: 200, optionalLabel: true, placeholder: 'Ví dụ: ít cay, không hành'),
          const SizedBox(height: N11Space.gap3),
          N11Button(
            key: const Key('sheet-add'), validate: true,
            label: 'Thêm vào giỏ · ${m10Money(widget.priceVnd * _qty)}',
            onPressed: () async {
              if (widget.canAdd != null && !widget.canAdd!()) {
                m02Toast(context, 'Trạng thái quán đã thay đổi. Vui lòng tải lại quán.');
                return;
              }
              final NavigatorState navigator = Navigator.of(context);
              await widget.cart.add(shopId: widget.shopId, shopName: widget.shopName, itemId: widget.itemId, name: widget.name, priceVnd: widget.priceVnd, note: _note.text, by: _qty, replace: widget.replace);
              navigator.pop();
            },
          ),
        ],
      ),
    )));
  }
}

class ExpandableDishDescription extends StatefulWidget {
  const ExpandableDishDescription({super.key, this.text});
  final String? text;
  @override
  State<ExpandableDishDescription> createState() => _ExpandableDishDescriptionState();
}
class _ExpandableDishDescriptionState extends State<ExpandableDishDescription> {
  bool expanded = false;
  @override
  Widget build(BuildContext context) {
    final String text = widget.text ?? '';
    if (text.trim().isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(builder: (context, constraints) {
      final TextPainter measure = TextPainter(text: TextSpan(text: text, style: N11Text.body), maxLines: 3, textDirection: Directionality.of(context))..layout(maxWidth: constraints.maxWidth);
      final bool long = measure.didExceedMaxLines;
      measure.dispose();
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        const SizedBox(height: 12),
        Text(text, key: const Key('dish-description-text'), style: N11Text.body, maxLines: expanded ? null : 3, overflow: expanded ? null : TextOverflow.ellipsis),
        if (long) TextButton(key: const Key('dish-description-expand'), onPressed: () => setState(() => expanded = !expanded), child: Text(expanded ? 'Thu gọn' : 'Xem thêm')),
      ]);
    });
  }
}

/// The bar at the bottom of a shop page: how many dishes, the dishes' amount, and the way to the cart.
class CartBar extends StatelessWidget {
  const CartBar({super.key, required this.runtime, required this.shopId, this.addresses, this.session});

  final OrderRuntime runtime;
  final String shopId;
  final AddressBookController? addresses;
  final SessionController? session;

  @override
  Widget build(BuildContext context) {
    final CartController cart = runtime.cart;
    return ListenableBuilder(
      listenable: cart,
      builder: (BuildContext context, Widget? _) {
        if (cart.isEmpty || cart.shopId != shopId) {
          return const SizedBox.shrink();
        }
        return N11Button(
          key: const Key('cart-bar'),
          label: 'Xem giỏ · ${cart.count} món · ${m10Money(cart.itemsVnd)}',
          icon: Icons.shopping_basket_outlined,
          onPressed: () => Navigator.of(context).push(n11Route(CartScreen(runtime: runtime, addresses: addresses ?? runtime.addresses, session: session ?? runtime.session))),
        );
      },
    );
  }
}

// ---- the cart --------------------------------------------------------------------------------------------------------

class CartScreen extends StatefulWidget {
  const CartScreen({super.key, required this.runtime, this.addresses, this.session});

  final OrderRuntime runtime;
  final AddressBookController? addresses;
  final SessionController? session;

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  CartController get cart => widget.runtime.cart;

  @override
  void initState() {
    super.initState();
    cart.freshness.observe();
    // Today's prices and availability, from the server.
    unawaited(cart.load());
  }

  Widget _cartLine(DraftLine line) => LayoutBuilder(
    builder: (BuildContext context, BoxConstraints constraints) {
      final Widget details = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(line.name, style: N11Text.bodyStrong.copyWith(decoration: cart.isUnavailable(line) ? TextDecoration.lineThrough : null)),
          if (line.note != null) Text('Ghi chú: ${line.note}', style: N11Text.caption),
          Text(
            cart.isUnavailable(line) ? 'Không còn bán' : m10Money(line.priceVnd),
            style: N11Text.bodyStrong.copyWith(color: cart.isUnavailable(line) ? N11Colors.error : N11Colors.black),
          ),
        ],
      );
      final Widget controls = Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          IconButton(
            key: Key('cart-minus-${line.itemId}'),
            tooltip: 'Bớt',
            onPressed: () => unawaited(cart.setQuantity(line, line.quantity - 1)),
            icon: const Icon(Icons.remove_circle_outline),
          ),
          Text('${line.quantity}', key: Key('cart-qty-${line.itemId}'), style: N11Text.bodyStrong),
          IconButton(
            key: Key('cart-plus-${line.itemId}'),
            tooltip: 'Thêm',
            onPressed: () => unawaited(cart.setQuantity(line, line.quantity + 1)),
            icon: const Icon(Icons.add_circle, color: N11Colors.black),
          ),
          IconButton(
            key: Key('cart-remove-${line.itemId}'),
            tooltip: 'Xóa khỏi giỏ',
            onPressed: () => unawaited(cart.setQuantity(line, 0)),
            icon: const Icon(Icons.delete_outline, color: N11Colors.error),
          ),
        ],
      );
      final bool stacked = constraints.maxWidth < 320 || MediaQuery.textScalerOf(context).scale(16) > 21;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: N11Space.gap2),
        child: stacked
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  details,
                  const SizedBox(height: N11Space.gap2),
                  Align(alignment: Alignment.centerRight, child: controls),
                ],
              )
            : Row(
                children: <Widget>[
                  Expanded(child: details),
                  controls,
                ],
              ),
      );
    },
  );

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: cart,
      builder: (BuildContext context, Widget? _) {
        final bool sample = widget.runtime.customer.isSample;
        if (cart.isEmpty) {
          return m07Page('Giỏ hàng', sample, const <Widget>[
            EmptyState(key: Key('cart-empty'), icon: Icons.shopping_basket_outlined, title: 'Giỏ hàng trống', text: 'Chọn món ở trang quán để thêm vào giỏ.'),
          ]);
        }
        return m07Page(
          'Giỏ hàng',
          sample,
          <Widget>[
            N11Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      const Icon(Icons.storefront_outlined, size: 20, color: N11Colors.ink2),
                      const SizedBox(width: N11Space.gap2),
                      Expanded(
                        child: Text(cart.shopName, key: const Key('cart-shop'), style: N11Text.h2),
                      ),
                    ],
                  ),
                  const SizedBox(height: N11Space.gap2),
                  Text(
                    cart.availabilityStale
                        ? 'Chưa cập nhật trạng thái quán'
                        : cart.online
                        ? 'Đang mở cửa'
                        : 'Đã đóng cửa',
                    key: const Key('cart-shop-availability'),
                    style: N11Text.caption,
                  ),
                ],
              ),
            ),
            if (cart.availabilityStale) TextButton(onPressed: cart.load, child: const Text('Thử lại')),
            if (cart.failure != null)
              N11Banner(
                key: const Key('cart-unsaved'),
                kind: BannerKind.warn,
                title: 'Chưa lưu được giỏ',
                text: 'Giỏ trên máy có thể mới hơn giỏ trên máy chủ. Sẽ lưu lại khi có mạng.',
                icon: Icons.cloud_off_outlined,
              ),
            if (cart.hasUnavailable)
              const N11Banner(
                key: Key('cart-unavailable'),
                kind: BannerKind.error,
                title: 'Có món không còn bán',
                text: 'Hãy xóa các món đó khỏi giỏ rồi tiếp tục.',
              ),
            N11Card(child: Column(children: <Widget>[for (final DraftLine l in cart.lines) _cartLine(l)])),
            N11Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const Text('Tạm tính', style: N11Text.h2),
                  const SizedBox(height: N11Space.gap3),
                  KeyValueRows(
                    <(String, String)>[
                      ('Tiền món', m10Money(cart.itemsVnd)),
                      ('Phí giao (dự tính)', cart.feeEstimateVnd == null ? 'Chưa có bảng giá' : m10Money(cart.feeEstimateVnd!)),
                      if (cart.feeEstimateVnd != null) ('Tổng dự kiến', m10Money(cart.itemsVnd + cart.feeEstimateVnd!)),
                    ],
                    valueKeys: const <String, Key>{
                      'Tiền món': Key('cart-total'),
                      'Phí giao (dự tính)': Key('cart-fee-estimate'),
                      'Tổng dự kiến': Key('cart-expected-total'),
                    },
                    responsive: true,
                  ),
                ],
              ),
            ),
            ReasonNote(cart.feeEstimateVnd == null ? kNoFeeNote : kFeeEstimateNote, icon: Icons.warning_amber_rounded),
          ],
          bottom: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              N11Button(
                key: const Key('cart-continue'),
                label: cart.feeEstimateVnd == null ? 'Tiếp tục' : 'Tiếp tục · ${m10Money(cart.itemsVnd + cart.feeEstimateVnd!)}',
                onPressed: cart.hasUnavailable || cart.availabilityStale
                    ? null
                    : () => Navigator.of(context).push(
                        n11Route(
                          CheckoutScreen(
                            runtime: widget.runtime,
                            addresses: widget.addresses ?? widget.runtime.addresses,
                            session: widget.session ?? widget.runtime.session,
                          ),
                        ),
                      ),
              ),
              const SizedBox(height: N11Space.gap2),
              N11Link(
                'Xóa giỏ hàng',
                key: const Key('cart-clear'),
                onPressed: () async {
                  final bool yes = await showConfirmDialog(
                    context,
                    title: 'Xóa giỏ hàng?',
                    content: const Text('Tất cả món trong giỏ sẽ bị xóa.'),
                    confirmLabel: 'Xóa giỏ',
                  );
                  if (yes) {
                    await cart.clear();
                  }
                },
              ),
            ],
          ),
        );
      },
    );
  }
}

// ---- checkout --------------------------------------------------------------------------------------------------------

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.runtime, this.addresses, this.session, this.pinPicker});

  final OrderRuntime runtime;
  final AddressBookController? addresses;
  final SessionController? session;

  /// How this build lets a person pin a point (M14). Null = no map: the Order is sent without a pin and the fee says "Chưa xác định phí".
  final M07PinPickerBuilder? pinPicker;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

enum _Attempt { none, sending, unknown }

class _CheckoutScreenState extends State<CheckoutScreen> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _note = TextEditingController();
  final TextEditingController _typed = TextEditingController();
  DraftAddress? _address;
  bool _typedMode = false;
  DateTime? _scheduled;
  CheckoutPreview? _preview;
  M07Failure? _failure;
  bool _previewing = false;
  bool _previewFresh = false;
  int _previewEpoch = 0;
  late final AvailabilityRefresh _freshness = AvailabilityRefresh(refresh: _check, invalidate: () {
    if (mounted) setState(() => _previewFresh = false);
  });
  bool _changed = false;
  _Attempt _attempt = _Attempt.none;
  String _clientRef = newIdempotencyKey();
  String _key = newIdempotencyKey();
  double? _pinLat;
  double? _pinLng;

  CartController get cart => widget.runtime.cart;
  CustomerOrderSource get source => widget.runtime.customer;

  @override
  void initState() {
    super.initState();
    _freshness.observe();
    final Identity? who = widget.session?.identity;
    _name.text = who?.profile.fullName ?? '';
    _phone.text = who == null ? '' : '0${who.phoneNormalized.replaceFirst('+84', '')}';
    final DeliveryAddress? book = widget.addresses?.defaultAddress;
    if (book != null) {
      _address = _fromBook(book);
      _name.text = book.recipientName ?? _name.text;
      _phone.text = '0${book.contactPhone.replaceFirst('+84', '')}';
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_check()));
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _note.dispose();
    _typed.dispose();
    _freshness.dispose();
    super.dispose();
  }

  DraftAddress _fromBook(DeliveryAddress a) => DraftAddress.book(a.id, text: a.addressText, lat: a.latitude, lng: a.longitude);

  Future<void> _editAddress({bool fresh = false}) async {
    final SessionController? session = widget.session ?? widget.runtime.session;
    final int? epoch = session?.sessionEpoch;
    final M07PinPickerBuilder? builder = widget.pinPicker ?? widget.runtime.pinPicker;
    final AddressLocation initial = fresh ? const AddressLocation('') : AddressLocation(
      _typedMode ? _typed.text : (_address?.text ?? ''),
      latitude: _typedMode ? _pinLat : _address?.lat,
      longitude: _typedMode ? _pinLng : _address?.lng);
    final AddressLocation? selected = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(
      builder: (_) => AddressLocationPicker(initial: initial, session: session, requirePoint: false, location: widget.runtime.location,
        mapBuilder: builder == null ? null : (BuildContext context, double? lat, double? lng, void Function(double, double) onPick) =>
          builder(context, lat: lat, lng: lng, onPick: onPick))));
    if (selected == null || !mounted || session?.sessionEpoch != epoch || (session != null && session.status != SessionStatus.signedIn)) return;
    _typed.text = selected.text;
    _pinLat = selected.latitude;
    _pinLng = selected.longitude;
    _typedMode = true;
    _touch();
  }

  /// An address edit makes a new order attempt; an unchanged retry retains its key.
  void _touch() {
    _previewEpoch++;
    setState(() {
      _previewFresh = false;
      _clientRef = newIdempotencyKey();
      _key = newIdempotencyKey();
      _attempt = _Attempt.none;
      _failure = null;
      _changed = false;
    });
    unawaited(_check());
  }

  CheckoutDraft? _draft() {
    final DraftAddress? address = _typedMode && _typed.text.trim().isNotEmpty ? DraftAddress.typed(_typed.text.trim(), lat: _pinLat, lng: _pinLng) : (_typedMode ? null : _address);
    if (address == null || cart.shopId == null || cart.isEmpty) {
      return null;
    }
    return CheckoutDraft(
      shopId: cart.shopId!,
      shopName: cart.shopName,
      lines: cart.lines,
      note: _note.text.trim().isEmpty ? (cart.note) : _note.text.trim(),
      recipientName: _name.text.trim(),
      recipientPhone: _phone.text.trim(),
      address: address,
      scheduledFor: _scheduled,
    );
  }

  Future<void> _check() async {
    if (_previewing || _attempt != _Attempt.none) return;
    final CheckoutDraft? draft = _draft();
    if (draft == null || textError(draft.recipientName, 'tên người nhận', 80) != null || phoneError(draft.recipientPhone) != null || textError(draft.note ?? '', 'ghi chú', 200, optional: true) != null) {
      setState(() => _preview = null);
      return;
    }
    final int epoch = _previewEpoch;
    setState(() => _previewing = true);
    try {
      final CheckoutPreview p = await source.preview(draft);
      if (mounted && epoch != _previewEpoch) {
        _previewing = false;
        unawaited(_check());
        return;
      }
      if (mounted) {
        setState(() {
          _preview = p;
          _previewFresh = true;
          _freshness.arm(p.nextRefreshMs);
          _previewing = false;
        });
      }
    } on M07Failure catch (failure) {
      if (mounted) {
        setState(() {
          _failure = failure;
          _previewFresh = false;
          _freshness.failed();
          _previewing = false;
        });
      }
    }
  }

  Future<void> _pickAddress() async {
    final AddressBookController? book = widget.addresses;
    if (book == null) {
      return;
    }
    final DeliveryAddress? picked = await Navigator.of(context).push<DeliveryAddress>(MaterialPageRoute<DeliveryAddress>(builder: (BuildContext c) => m07Page('Chọn địa chỉ giao', false, <Widget>[DeliveryAddressPicker(controller: book, initialId: _address?.addressId, onConfirm: (DeliveryAddress a) => Navigator.of(c).pop(a))])));
    if (picked != null) {
      _address = _fromBook(picked);
      _typedMode = false;
      if (picked.recipientName != null && _name.text.trim().isEmpty) {
        _name.text = picked.recipientName!;
      }
      _touch();
    }
  }

  Future<void> _pickTime() async {
    final DateTime now = DateTime.now();
    final DateTime? day = await showDatePicker(context: context, initialDate: _scheduled ?? now, firstDate: now, lastDate: now.add(const Duration(days: 7)));
    if (day == null || !mounted) {
      return;
    }
    final TimeOfDay? t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_scheduled ?? now.add(const Duration(hours: 1))));
    if (t == null) {
      return;
    }
    _scheduled = DateTime(day.year, day.month, day.day, t.hour, t.minute);
    _touch();
  }

  Future<void> _send() async {
    final CheckoutDraft? draft = _draft();
    if (draft == null || _attempt == _Attempt.sending) {
      return;
    }
    setState(() {
      _attempt = _Attempt.sending;
      _failure = null;
    });
    try {
      final OrderView order = await source.place(draft, clientRef: _clientRef, key: _key);
      _done(order);
    } on M07Failure catch (failure) {
      if (!mounted) {
        return;
      }
      if (failure.kind == M07FailureKind.offline) {
        // The Order may or may not have been created: it is NOT reported as sent or as failed. The same reference finds out.
        setState(() {
          _attempt = _Attempt.unknown;
          _failure = failure;
        });
      } else {
        setState(() {
          _attempt = _Attempt.none;
          _failure = failure;
          _changed = failure.code == 'ORDER_CART_CHANGED';
        });
        if (failure.code == 'ORDER_SHOP_NOT_OPEN') {
          await _freshness.reload();
          await cart.freshness.reload();
        }
        if (failure.code == 'ORDER_CART_CHANGED') {
          // The cart is read again: new prices, dishes that are gone. The person checks and sends again (a new attempt).
          await cart.load();
          _clientRef = newIdempotencyKey();
          _key = newIdempotencyKey();
          await _check();
        }
      }
    }
  }

  Future<void> _lookup() async {
    setState(() => _attempt = _Attempt.sending);
    try {
      final OrderView? found = await source.lookup(_clientRef);
      if (found != null) {
        _done(found);
      } else if (mounted) {
        setState(() {
          _attempt = _Attempt.none;
          _failure = null;
        });
        m02Toast(context, 'Đơn chưa được gửi. Bạn có thể gửi lại.');
      }
    } on M07Failure catch (failure) {
      if (mounted) {
        setState(() {
          _attempt = _Attempt.unknown;
          _failure = failure;
        });
      }
    }
  }

  void _done(OrderView order) {
    cart.sent();
    if (!mounted) {
      return;
    }
    Navigator.of(context).pushReplacement(n11Route(CustomerOrderDetailScreen(runtime: widget.runtime, orderId: order.orderId, justSent: true)));
  }

  @override
  Widget build(BuildContext context) {
    final CheckoutPreview? p = _preview;
    final bool blocked = p != null && (!p.ok || p.blockers.isNotEmpty);
    final bool ready = _previewFresh && !_previewing && p != null && !cart.isEmpty && cart.shopId != null && !blocked && _attempt != _Attempt.sending && _attempt != _Attempt.unknown;
    final int items = p?.itemsVnd ?? cart.itemsVnd;
    final int? estimateFee = p == null ? cart.feeEstimateVnd : p.feeEstimateVnd;
    final int? expectedTotal = p == null ? (estimateFee == null ? null : items + estimateFee) : p.expectedTotalVnd;
    return m07Page(
      'Xác nhận đơn',
      source.isSample,
      <Widget>[
        N11Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(cart.shopName, style: N11Text.h2),
              for (final DraftLine l in cart.lines) Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: <Widget>[Expanded(child: Text('${l.quantity}× ${l.name}${l.note == null ? '' : ' (${l.note})'}', style: N11Text.body)), Text(m10Money(l.totalVnd), style: N11Text.body)])),
            ],
          ),
        ),
        if (_changed)
          N11Banner(key: const Key('checkout-changed'), kind: BannerKind.warn, title: 'Giá hoặc món đã thay đổi', text: 'Giỏ đã được cập nhật theo giá hiện tại. Hãy kiểm tra lại rồi gửi đơn.', icon: Icons.sync_problem_outlined),
        if (p != null && p.blockers.isNotEmpty) N11Banner(key: const Key('checkout-blockers'), kind: BannerKind.error, title: 'Chưa gửi được đơn', text: p.blockers.map(_blockerText).join('\n')),
        const Text('Người nhận', style: N11Text.h2),
        N11Field(requiredInput: true, fieldKey: const Key('checkout-name'), label: 'Tên người nhận', controller: _name, maxLength: 80, onChanged: _touch),
        N11Field(validator: phoneError, fieldKey: const Key('checkout-phone'), label: 'Số điện thoại người nhận', controller: _phone, keyboard: TextInputType.phone, maxLength: 15, onChanged: _touch, hint: 'Người nhận có thể khác người đặt.'),
        N11Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              FormField<bool>(
                autovalidateMode: AutovalidateMode.onUserInteraction,
                validator: (_) => _draft() == null ? 'Chọn địa chỉ giao hàng.' : null,
                builder: (FormFieldState<bool> field) => AddressLocationField(error: field.errorText, key: const Key('checkout-address'), label: 'Địa chỉ giao',
                text: _typedMode ? _typed.text : (_address?.text ?? ''),
                onTap: _attempt == _Attempt.sending || _attempt == _Attempt.unknown ? null : () async { await _editAddress(); if (mounted) field.didChange(_draft() != null); })),
              const SizedBox(height: N11Space.gap2),
              Row(children: <Widget>[
                if (widget.addresses != null) Expanded(child: N11Button(key: const Key('checkout-pick'), label: 'Chọn từ sổ địa chỉ', kind: ButtonKind.secondary, compact: true,
                  onPressed: _attempt == _Attempt.sending || _attempt == _Attempt.unknown ? null : _pickAddress)),
                if (widget.addresses != null) const SizedBox(width: N11Space.gap2),
                Expanded(child: N11Button(key: const Key('checkout-typed-toggle'), label: 'Địa chỉ khác', kind: ButtonKind.secondary, compact: true,
                  onPressed: _attempt == _Attempt.sending || _attempt == _Attempt.unknown ? null : () => _editAddress(fresh: true))),
              ]),
            ],
          ),
        ),
        N11Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Thời gian nhận món', style: N11Text.label),
              _TimeChoice(key: const Key('checkout-asap'), selected: _scheduled == null, label: 'Giao sớm nhất', onTap: () {
                _scheduled = null;
                _touch();
              }),
              _TimeChoice(key: const Key('checkout-scheduled'), selected: _scheduled != null, label: _scheduled == null ? 'Hẹn giờ nhận món' : 'Hẹn lúc ${m10When(_scheduled!)}', onTap: () => unawaited(_pickTime())),
              if (_scheduled != null) const ReasonNote(kScheduleNote, icon: Icons.info_outline),
            ],
          ),
        ),
        N11Field(fieldKey: const Key('checkout-note'), label: 'Ghi chú cho đơn', controller: _note, maxLength: 200, optionalLabel: true, onChanged: _touch),
        N11Card(
          key: const Key('checkout-summary'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Thanh toán trực tiếp', style: N11Text.h2),
              KeyValueRows(<(String, String)>[
                ('Tiền món', m10Money(items)),
                ('Phí giao (dự tính)', estimateFee == null ? 'Chưa có bảng giá' : m10Money(estimateFee)),
              ]),
              if (expectedTotal != null) Row(children: <Widget>[const Expanded(child: Text('Tổng dự kiến', style: N11Text.bodyStrong)), Text(m10Money(expectedTotal), key: const Key('checkout-total'), style: N11Text.bodyStrong)])
              else const ReasonNote(kNoFeeNote, icon: Icons.warning_amber_rounded),
              if (estimateFee != null && (p == null || p.feeDistanceM == null))
                const ReasonNote(kFeeEstimateNote, icon: Icons.warning_amber_rounded),
              if (!_previewFresh && !_previewing) TextButton(onPressed: _check, child: const Text('Cập nhật trạng thái quán')),
              if (_previewing) const Padding(padding: EdgeInsets.only(top: N11Space.gap2), child: LinearProgressIndicator()),
              const SizedBox(height: N11Space.gap2),
              const ReasonNote(kDirectPayNote, icon: Icons.info_outline),
            ],
          ),
        ),
        if (_attempt == _Attempt.unknown)
          N11Banner(
            key: const Key('checkout-unknown'),
            kind: BannerKind.warn,
            title: 'Chưa biết đơn đã gửi chưa',
            text: 'Mất kết nối khi gửi. Đơn có thể đã được tạo. Hãy kiểm tra kết quả trước khi gửi lại để không bị đặt hai lần.',
            icon: Icons.cloud_off_outlined,
            trailing: Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[
              N11Button(key: const Key('checkout-lookup'), label: 'Kiểm tra kết quả', compact: true, onPressed: () => unawaited(_lookup())),
              N11Button(key: const Key('checkout-resend'), label: 'Gửi lại', kind: ButtonKind.secondary, compact: true, onPressed: () {
                setState(() => _attempt = _Attempt.none);
                unawaited(_send());
              }),
            ]),
          )
        else if (_failure != null && !_changed)
          N11Banner(key: const Key('checkout-failed'), kind: BannerKind.error, title: 'Chưa gửi được đơn', text: m10FailureText(_failure!)),
      ],
      bottom: N11Button(key: const Key('checkout-send'), validate: true, label: expectedTotal == null ? 'Gửi đơn' : 'Gửi đơn · ${m10Money(expectedTotal)}', loading: _attempt == _Attempt.sending, onPressed: ready ? () => unawaited(_send()) : null),
    );
  }

  String _blockerText(String code) => switch (code) {
        'SHOP_NOT_OPEN' => 'Quán chưa nhận đơn lúc này. Hãy chọn giờ hẹn hoặc quay lại sau.',
        'SCHEDULE_TOO_SOON' => 'Giờ hẹn quá gần. Hãy chọn muộn hơn ít nhất 30 phút.',
        'SCHEDULE_TOO_FAR' => 'Giờ hẹn quá xa. Chỉ hẹn trong 7 ngày tới.',
        'SCHEDULE_OUTSIDE_HOURS' => 'Giờ hẹn nằm ngoài giờ hoạt động của quán.',
        'ADDRESS_NOT_FOUND' => 'Địa chỉ giao không còn dùng được. Hãy chọn lại.',
        _ => 'Chưa gửi được đơn.',
      };
}

// ---- the list --------------------------------------------------------------------------------------------------------

class CustomerOrdersView extends StatefulWidget {
  const CustomerOrdersView({super.key, required this.runtime});

  final OrderRuntime runtime;

  @override
  State<CustomerOrdersView> createState() => _CustomerOrdersViewState();
}

class _CustomerOrdersViewState extends State<CustomerOrdersView> {
  CustomerScope _scope = CustomerScope.processing;

  @override
  Widget build(BuildContext context) {
    final CustomerOrderSource source = widget.runtime.customer;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (source.isSample) const M10SampleBanner(),
        Wrap(
          spacing: N11Space.gap2,
          runSpacing: N11Space.gap2,
          children: <Widget>[
            for (final (CustomerScope s, String label) in <(CustomerScope, String)>[(CustomerScope.processing, 'Đang xử lý'), (CustomerScope.scheduled, 'Đơn hẹn'), (CustomerScope.history, 'Lịch sử')])
              ChoiceChip(key: Key('orders-tab-${s.name}'), label: Text(label), selected: _scope == s, onSelected: (bool _) => setState(() => _scope = s)),
          ],
        ),
        const SizedBox(height: N11Space.gap3),
        M07Loader<List<OrderSummary>>(
          key: ValueKey<CustomerScope>(_scope),
          keyPrefix: 'orders-${_scope.name}',
          load: () => source.list(_scope),
          refreshEvery: const Duration(seconds: 20),
          isEmpty: (List<OrderSummary> v) => v.isEmpty,
          emptyIcon: Icons.receipt_long_outlined,
          emptyTitle: switch (_scope) {
            CustomerScope.processing => 'Chưa có đơn đang xử lý',
            CustomerScope.scheduled => 'Chưa có đơn hẹn',
            CustomerScope.history => 'Chưa có lịch sử đơn',
          },
          emptyText: 'Đơn bạn đặt sẽ hiện ở đây.',
          builder: (BuildContext context, List<OrderSummary> orders, Future<void> Function() reload) => vstack(<Widget>[
            for (final OrderSummary o in orders)
              OrderSummaryCard(
                summary: o,
                forShop: false,
                onTap: () async {
                  await Navigator.of(context).push(n11Route(CustomerOrderDetailScreen(runtime: widget.runtime, orderId: o.orderId)));
                  await reload();
                },
              ),
          ]),
        ),
      ],
    );
  }
}

/// One row of an order list (both sides): code, status, the wanted time of a scheduled order, the dishes' amount.
class OrderSummaryCard extends StatelessWidget {
  const OrderSummaryCard({super.key, required this.summary, required this.forShop, required this.onTap});

  final OrderSummary summary;
  final bool forShop;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final OrderSummary o = summary;
    return InkWell(
      key: Key('order-card-${o.orderId}'),
      borderRadius: BorderRadius.circular(kRadiusCard),
      onTap: onTap,
      child: N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(forShop ? '${o.code} · ${o.recipientName}' : '${o.code} · ${o.shopName}', style: N11Text.bodyStrong),
            const SizedBox(height: 4),
            Align(alignment: Alignment.centerLeft, child: OrderStatusChip(o.display)),
            const SizedBox(height: 4),
            Text('${o.lineCount} món · ${m10Money(o.itemsVnd)}', style: N11Text.caption),
            if (o.scheduledFor != null) Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: <Widget>[const N11Chip('Đơn hẹn', kind: ChipKind.dark), const SizedBox(width: N11Space.gap2), Expanded(child: Text(m10When(o.scheduledFor!), key: Key('order-scheduled-${o.orderId}'), style: N11Text.caption))])),
            if (forShop && o.edited) const Padding(padding: EdgeInsets.only(top: 4), child: Text('Đã chỉnh', style: N11Text.caption)),
            if (forShop && o.needsAttention) const Padding(padding: EdgeInsets.only(top: 4), child: N11Chip('Cần xử lý', kind: ChipKind.bad)),
            Text(m10When(o.createdAt), style: N11Text.caption),
          ],
        ),
      ),
    );
  }
}

// ---- the detail ------------------------------------------------------------------------------------------------------

class CustomerOrderDetailScreen extends StatefulWidget {
  const CustomerOrderDetailScreen({super.key, required this.runtime, required this.orderId, this.justSent = false, this.mapBuilder, this.contactLauncher = const MethodChannelContactLauncher()});

  /// Opens the shop's Zalo / Messenger link in its app (the phone dialer is [orderPhoneDialer]); a link that cannot be opened is copied.
  final ContactLauncher contactLauncher;

  final OrderRuntime runtime;
  final String orderId;
  final bool justSent;
  final M07MapBuilder? mapBuilder;

  @override
  State<CustomerOrderDetailScreen> createState() => _CustomerOrderDetailState();
}

class _CustomerOrderDetailState extends State<CustomerOrderDetailScreen> with M07Actions<CustomerOrderDetailScreen> {
  late final M07Fetcher<OrderView> _fetcher = M07Fetcher<OrderView>(() => widget.runtime.customer.get(widget.orderId), refreshEvery: const Duration(seconds: 10))..addListener(_changed);

  /// "Trao đổi đơn hàng". Held here, above the collapsible card, so closing the card keeps what was typed, the pages read and the key of a send in flight.
  OrderChatController? _chat;

  @override
  void initState() {
    super.initState();
    final OrderChatApi? api = widget.runtime.customer.chat;
    if (api != null) {
      _chat = OrderChatController(api: api, room: ChatRoomRef(ChatDoor.customerOrder, widget.orderId));
    }
  }

  void _changed() {
    final OrderView? o = _fetcher.value;
    if (o != null) {
      _chat?.noteVersion(o.version);
    }
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _chat?.dispose();
    _fetcher.dispose();
    super.dispose();
  }

  Future<void> _cancel(OrderView o) async {
    final bool yes = await showConfirmDialog(context, title: 'Hủy đơn?', content: const Text('Quán chưa xác nhận nên bạn hủy được. Sau khi quán xác nhận, bạn cần liên hệ quán.'), confirmLabel: 'Hủy đơn');
    if (!yes) {
      return;
    }
    await act('cancel', (String key) async {
      await widget.runtime.customer.cancel(o.orderId, expectedVersion: o.version, key: key);
      await _fetcher.reload();
    }, onConflict: _fetcher.reload);
  }

  /// After the Shipper picked up the goods the customer who placed the order is the only one who can cancel it, with a reason.
  Future<void> _cancelAfterPickup(OrderView o) async {
    final String? reason = await showReasonDialog(
      context,
      title: 'Hủy đơn khi shipper đã lấy hàng?',
      explanation: 'Shipper đã lấy món và đang giao. Nếu hủy bây giờ, đơn kết thúc và shipper sẽ gọi quán để trả lại món. Ứng dụng không tự hoàn tiền hay bồi thường.',
      confirmLabel: 'Hủy đơn',
      reasonLabel: 'Lý do hủy',
    );
    if (reason == null || !mounted) {
      return;
    }
    await act('cancel-after-pickup', (String key) async {
      await widget.runtime.customer.cancelAfterPickup(o.orderId, reason: reason, expectedVersion: o.version, key: key);
      await _fetcher.reload();
    }, onConflict: _fetcher.reload);
  }

  /// The customer pays the delivery fee, so the customer decides the amount a Shipper proposed: agree, or refuse and keep the earlier fee.
  Future<void> _decideFee(OrderView o, OrderDelivery d, bool accept) async {
    await act('fee-${d.deliveryId}-$accept', (String key) async {
      await widget.runtime.customer.decideFee(o.orderId, accept: accept, deliveryVersion: d.version, key: key);
      await _fetcher.reload();
    }, onConflict: _fetcher.reload);
  }

  Future<void> _reorder(OrderView o) async {
    final CartController cart = widget.runtime.cart;
    var replace = false;
    if (cart.needsReplace(o.shop.shopId)) {
      final String? choice = await showDecision(context, title: 'Thay giỏ hàng?', text: 'Giỏ đang có món của ${cart.shopName}. Bạn muốn thay bằng món của đơn này?', actions: const <DialogAction>[DialogAction('Giữ giỏ cũ', 'keep'), DialogAction('Thay giỏ', 'replace', kind: ButtonKind.primary)]);
      if (choice != 'replace') {
        return;
      }
      replace = true;
    }
    await act('reorder', (String key) async {
      final ReorderResult r = await widget.runtime.customer.reorder(o.orderId, replaceCart: replace, key: key);
      cart.adopt(r.cart);
      if (!mounted) {
        return;
      }
      if (r.skipped.isNotEmpty) {
        m02Toast(context, 'Món không còn bán, đã bỏ qua: ${r.skipped.join(', ')}');
      }
      if (r.cart != null) {
        await Navigator.of(context).push(n11Route(CartScreen(runtime: widget.runtime)));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final OrderView? o = _fetcher.value;
    // The customer never sees the order code (Owner decision): the page is "Chi tiết đơn" of this shop.
    return m07Page(
      'Chi tiết đơn',
      widget.runtime.customer.isSample,
      <Widget>[
        if (widget.justSent) const N11Banner(key: Key('order-sent'), kind: BannerKind.success, title: 'Đã gửi đơn', text: 'Đơn đang chờ quán xác nhận. Bạn hủy được cho đến khi quán xác nhận.'),
        actionBanner(),
        m07Fetched<OrderView>(context, _fetcher, 'order', (OrderView v) => _body(v)),
      ],
      bottom: o == null ? null : _bottom(o),
    );
  }

  Widget? _bottom(OrderView o) {
    if (o.can['cancel'] ?? false) {
      return OrderActionsBar(destructive: DangerButton(key: const Key('order-cancel'), label: 'Hủy đơn', outlined: false, onPressed: busy ? null : () => unawaited(_cancel(o))));
    }
    if (o.can['cancel_after_pickup'] ?? false) {
      return OrderActionsBar(destructive: DangerButton(key: const Key('order-cancel-after-pickup'), label: 'Hủy đơn (shipper đã lấy hàng)', outlined: false, onPressed: busy ? null : () => unawaited(_cancelAfterPickup(o))));
    }
    if (o.ended) {
      return N11Button(key: const Key('order-reorder'), label: 'Đặt lại', loading: busy, onPressed: () => unawaited(_reorder(o)));
    }
    return null;
  }

  /// The page, top to bottom: the status and the total (always drawn, never inside a card that can close), the question the customer must answer about the fee
  /// (also always drawn), then independent cards that open and close by themselves. Closed cards say one useful line and build nothing heavy.
  Widget _body(OrderView o) {
    final OrderDelivery? d = o.delivery;
    final bool shipperHeld = d != null && d.hasShipper && !o.ended;
    // The number to call is the shop's own public one when it has one, else the number on the order; nothing once the order ended.
    final String? shopCall = o.ended ? null : (o.shop.contact.phone ?? o.shop.phone);
    return vstack(<Widget>[
      N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(o.shop.name, style: N11Text.h2),
            const SizedBox(height: 4),
            Align(alignment: Alignment.centerLeft, child: OrderStatusChip(o.display)),
            if (o.isScheduled) Padding(padding: const EdgeInsets.only(top: 6), child: Row(children: <Widget>[const N11Chip('Đơn hẹn', kind: ChipKind.dark), const SizedBox(width: N11Space.gap2), Expanded(child: Text('Muốn nhận món lúc ${m10When(o.scheduledFor!)}', key: const Key('order-wanted'), style: N11Text.body))])),
            const Divider(height: N11Space.gap4, color: N11Colors.line),
            Row(
              children: <Widget>[
                Expanded(child: Text(o.money.expectedTotalVnd != null ? 'Tổng dự kiến' : 'Tiền món', style: N11Text.bodyStrong)),
                Text(m10Money(o.money.expectedTotalVnd ?? o.money.itemsVnd), key: const Key('order-total'), textAlign: TextAlign.right, style: N11Text.title.copyWith(fontSize: 20)),
              ],
            ),
            if (o.money.expectedTotalVnd == null) const Text(kNoFeeNote, key: Key('order-total-unknown'), style: N11Text.caption),
          ],
        ),
      ),
      if (d?.feeDecision != null) _feeDecisionCard(o, d!, d.feeDecision!),
      if (o.edited && o.confirmedAt != null) N11Banner(key: const Key('order-edited'), kind: BannerKind.info, title: 'Quán đã chỉnh đơn', text: 'Lý do: ${o.changeReason ?? '—'}. Bên dưới là bản đã chốt, kèm số liệu ban đầu của bạn.'),
      if (shipperHeld)
        OrderSection(
          id: 'shipper',
          title: 'Shipper',
          summary: '${d.shipperName} · ${d.state.label}',
          initiallyExpanded: true,
          trailing: QuickCall(phone: d.shipperPhone, who: 'shipper'),
          builder: (BuildContext _) => _shipperBody(d),
        )
      else if (d != null)
        _deliveryStatus(o, d),
      OrderSection(
        id: 'shop',
        title: 'Quán',
        summary: shopCall == null ? o.shop.name : '${o.shop.name} · ${dialNumberText(shopCall) ?? ''}'.trimRight(),
        trailing: QuickCall(phone: shopCall, who: 'quán'),
        builder: (BuildContext _) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            ContactRow(name: o.shop.name, detail: o.shop.addressText, phone: shopCall, who: 'quán', showCall: false),
            if (!o.ended && (o.shop.contact.zaloUrl != null || o.shop.contact.messengerUrl != null)) _shopChats(o.shop.contact),
          ],
        ),
      ),
      OrderSection(id: 'items', title: 'Món đã đặt', summary: orderLinesSummary(o.items, o.money.itemsVnd), initiallyExpanded: !o.ended, builder: (BuildContext _) => OrderLinesBody(key: const Key('m10-lines'), lines: o.items)),
      OrderSection(id: 'money', title: 'Tiền món và phí giao', summary: orderMoneySummary(o.money), initiallyExpanded: true, builder: (BuildContext _) => OrderMoneyBody(key: const Key('m10-money'), money: o.money, edited: o.edited)),
      OrderSection(
        id: 'recipient',
        title: 'Người nhận',
        summary: '${o.recipient.name} · ${o.recipient.addressText}',
        builder: (BuildContext _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[KeyValueRows(<(String, String)>[('Tên', o.recipient.name), ('Số điện thoại', o.recipient.phone), ('Địa chỉ', o.recipient.addressText)]), if (o.note != null) Text('Ghi chú: ${o.note}', style: N11Text.caption)]),
      ),
      if (o.ended && widget.runtime.feedback != null && widget.runtime.picker != null)
        customerOrderFeedbackCard(context, source: widget.runtime.feedback!, picker: widget.runtime.picker!, orderId: o.orderId, orderCode: o.code),
      if (d != null || o.recipient.hasPin)
        OrderSection(
          id: 'map',
          title: 'Bản đồ giao hàng',
          summary: _mapSummary(o, d),
          // Closed by default: the heavy map is not even built until the person asks for it.
          builder: (BuildContext context) => OrderMapCard(
            framed: false,
            pickupLat: d?.pickupLat,
            pickupLng: d?.pickupLng,
            dropoffLat: d?.dropoffLat ?? o.recipient.lat,
            dropoffLng: d?.dropoffLng ?? o.recipient.lng,
            location: o.ended ? null : d?.location,
            mapBuilder: widget.mapBuilder ?? widget.runtime.mapBuilder,
            ended: o.ended,
            who: 'shipper',
          ),
        ),
      if (_chat != null) _chatSection(_chat!),
    ]);
  }

  /// Zalo and Messenger of the shop, only the links the shop declared and the server and this app both validated; opening one that no app handles copies it.
  Widget _shopChats(ShopContact c) {
    Future<void> open(String url, String what) async {
      var opened = false;
      try {
        opened = await widget.contactLauncher.openUrl(url);
      } on Object {
        opened = false;
      }
      if (opened || !mounted) {
        return;
      }
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) {
        m02Toast(context, 'Không mở được $what. Đã sao chép liên kết để bạn dán vào ứng dụng khác.');
      }
    }

    return Padding(
      padding: const EdgeInsets.only(top: N11Space.gap2),
      child: Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[
        if (c.zaloUrl != null) N11Button(key: const Key('order-shop-zalo'), label: 'Zalo', icon: Icons.chat_outlined, compact: true, kind: ButtonKind.secondary, onPressed: () => unawaited(open(c.zaloUrl!, 'Zalo'))),
        if (c.messengerUrl != null) N11Button(key: const Key('order-shop-messenger'), label: 'Messenger', icon: Icons.forum_outlined, compact: true, kind: ButtonKind.secondary, onPressed: () => unawaited(open(c.messengerUrl!, 'Messenger'))),
      ]),
    );
  }

  static String _mapSummary(OrderView o, OrderDelivery? d) {
    if (o.ended) {
      return 'Xem bản đồ · Đơn đã kết thúc';
    }
    return d?.location != null ? 'Xem bản đồ · Đang theo dõi shipper' : 'Xem bản đồ · Chưa có vị trí shipper';
  }

  Widget _shipperBody(OrderDelivery d) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          ContactRow(name: d.shipperName!, detail: d.plate == null ? null : 'Biển số ${d.plate}', phone: d.shipperPhone, who: 'shipper', showCall: false),
          const SizedBox(height: N11Space.gap2),
          Align(alignment: Alignment.centerLeft, child: N11Chip(d.state.label, kind: m07StateChip(d.state).kind)),
        ],
      );

  Widget _chatSection(OrderChatController chat) => ListenableBuilder(
        listenable: chat,
        builder: (BuildContext context, Widget? _) => OrderSection(id: 'chat', title: 'Trao đổi đơn hàng', summary: chat.summary, initiallyExpanded: true, builder: (BuildContext _) => OrderChatPanel(controller: chat)),
      );

  Widget _feeDecisionCard(OrderView o, OrderDelivery d, OrderFeeDecision f) {
    final bool counter = f.state == 'COUNTERED';
    return Container(
      key: const Key('order-fee-decision'),
      margin: const EdgeInsets.only(bottom: N11Space.gap2),
      padding: const EdgeInsets.all(N11Space.gap3),
      decoration: BoxDecoration(color: N11Colors.yellowSoft, borderRadius: BorderRadius.circular(kRadiusControl)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(counter ? 'Shipper muốn lấy phí giao ${m10Fee(f.offeredVnd)}' : 'Phí giao ${m10Fee(f.offeredVnd)} đang chờ bạn đồng ý', style: N11Text.bodyStrong),
          Text(counter ? 'Mức hiện tại là ${m10Fee(f.currentVnd)}. Bạn là người trả phí nên bạn quyết định. Nếu từ chối, đơn món vẫn giữ nguyên, phí giữ mức cũ và hệ thống tìm shipper khác.' : 'Bạn là người trả phí nên cần bạn đồng ý để shipper nhận đơn.', style: N11Text.caption),
          const SizedBox(height: N11Space.gap2),
          Row(
            children: <Widget>[
              Expanded(child: N11Button(key: const Key('fee-accept'), label: 'Đồng ý', compact: true, onPressed: busy ? null : () => unawaited(_decideFee(o, d, true)))),
              if (f.canDecline) ...<Widget>[
                const SizedBox(width: N11Space.gap2),
                Expanded(child: N11Button(key: const Key('fee-reject'), label: 'Từ chối', compact: true, kind: ButtonKind.secondary, onPressed: busy ? null : () => unawaited(_decideFee(o, d, false)))),
              ],
            ],
          ),
        ],
      ),
    );
  }

  /// The delivery while NO Shipper holds it (searching, search stopped, failed, or the order ended): its state and what it means. No contact of any Shipper is
  /// drawn here, so nothing private is shown before a Shipper takes the order or after the assignment ended.
  Widget _deliveryStatus(OrderView o, OrderDelivery d) {
    return N11Card(
      key: const Key('order-delivery'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Giao hàng', style: N11Text.label),
          const SizedBox(height: 4),
          Align(alignment: Alignment.centerLeft, child: N11Chip(d.state.label, kind: m07StateChip(d.state).kind)),
          const SizedBox(height: N11Space.gap2),
          if (d.state == DeliveryState.waitingDriver)
            const Text('Đang tìm shipper. Khi có shipper nhận, thông tin sẽ hiện ở đây.', style: N11Text.body)
          else if (d.state == DeliveryState.searchStopped)
            const Text('Chưa tìm được shipper — quán đang xử lý.', style: N11Text.body)
          else if (d.state == DeliveryState.failed)
            Text('Giao chưa thành công — quán đang xử lý.${d.resultReason == null ? '' : ' Lý do: ${d.resultReason}'}', key: const Key('order-failed'), style: N11Text.body)
          else
            const SizedBox.shrink(),
          if ((d.state == DeliveryState.failed || d.state == DeliveryState.cancelledByMerchant) && d.goodsCustody != null) Padding(padding: const EdgeInsets.only(top: 6), child: ReasonNote(d.goodsCustody == 'SHIPPER' ? 'Hàng chưa về quán hoặc chưa rõ. Hệ thống chỉ ghi nhận, không tự hoàn tiền hay bồi thường.' : 'Quán đã xác nhận xử lý hàng.')),
        ],
      ),
    );
  }
}

/// A radio-style choice row (no deprecated Radio widget).
class _TimeChoice extends StatelessWidget {
  const _TimeChoice({super.key, required this.selected, required this.label, required this.onTap});

  final bool selected;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: kTapMin),
        child: Row(children: <Widget>[Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: N11Colors.black, semanticLabel: selected ? 'Đã chọn' : 'Chưa chọn'), const SizedBox(width: N11Space.gap2), Expanded(child: Text(label, style: N11Text.body))]),
      ),
    );
  }
}

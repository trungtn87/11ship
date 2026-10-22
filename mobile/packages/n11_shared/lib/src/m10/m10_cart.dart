import 'package:flutter/foundation.dart';

import '../account/session_controller.dart';
import '../flows/location.dart';
import '../addresses/address_controller.dart';
import '../m02/menu_models.dart';
import '../m07/m07_source.dart';
import '../m07/m07_widgets.dart';
import '../m11/m11_source.dart';
import 'm10_models.dart';
import 'm10_source.dart';

// The customer's cart as the phone holds it. The SERVER keeps the cart (so it survives leaving the app, a restart or another phone) and prices it again
// whenever it is read: what the phone shows as a price is what the customer last saw, never a price that was agreed. One cart belongs to ONE shop; adding a
// dish of another shop asks the person first ([CartController.needsReplace]). The same dish with the same note is one line, another note is another line.

String _key(String itemId, String? note) => '$itemId|${(note ?? '').replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase()}';

class CartController extends ChangeNotifier {
  CartController({required this.source});

  final CustomerOrderSource source;

  String? _shopId;
  String _shopName = '';
  int? _feeEstimateVnd;
  String? _note;
  List<DraftLine> _lines = <DraftLine>[];
  bool _loaded = false;
  bool _syncing = false;
  bool _dirty = false;
  M07Failure? _failure;
  bool _disposed = false;

  String? get shopId => _shopId;
  String get shopName => _shopName;
  int? get feeEstimateVnd => _feeEstimateVnd;
  String? get note => _note;
  List<DraftLine> get lines => List<DraftLine>.unmodifiable(_lines);
  bool get loaded => _loaded;
  bool get isEmpty => _lines.isEmpty;
  int get count => _lines.fold(0, (int s, DraftLine l) => s + l.quantity);
  int get itemsVnd => _lines.fold(0, (int s, DraftLine l) => s + l.totalVnd);

  /// The last save / read failed: the cart on screen may be newer than the server's. It is kept and saved again at the next change.
  M07Failure? get failure => _failure;
  bool get unsaved => _dirty;

  /// How many of this dish (all notes) are in the cart.
  int quantityOf(String itemId) => _lines.where((DraftLine l) => l.itemId == itemId).fold(0, (int s, DraftLine l) => s + l.quantity);

  bool needsReplace(String shopId) => _shopId != null && _shopId != shopId && _lines.isNotEmpty;

  /// Reads the saved cart (prices and availability as the server has them NOW).
  Future<void> load() async {
    try {
      final CartView? view = await source.cart();
      _apply(view);
      _loaded = true;
      _failure = null;
      _dirty = false;
    } on M07Failure catch (failure) {
      _failure = failure;
    }
    _notify();
  }

  void _apply(CartView? view) {
    if (view == null) {
      _shopId = null;
      _shopName = '';
      _feeEstimateVnd = null;
      _lines = <DraftLine>[];
      _note = null;
      return;
    }
    _shopId = view.shopId;
    _shopName = view.shopName;
    _feeEstimateVnd = view.feeEstimateVnd;
    _note = view.note;
    _lines = <DraftLine>[for (final CartLine l in view.lines) DraftLine(itemId: l.itemId, name: l.name, quantity: l.quantity, priceVnd: l.priceVnd ?? 0, note: l.note)];
    _unavailable
      ..clear()
      ..addAll(<String>{for (final CartLine l in view.lines) if (!l.available) _key(l.itemId, l.note)});
  }

  final Set<String> _unavailable = <String>{};

  /// A dish the server no longer sells (flagged by the last read): the cart shows it and cannot send it.
  bool isUnavailable(DraftLine line) => _unavailable.contains(_key(line.itemId, line.note));
  bool get hasUnavailable => _lines.any(isUnavailable);

  /// Adds [by] of a dish (same note -> same line). When the cart holds another shop's dishes the caller must have asked and passed [replace].
  Future<void> add({required String shopId, required String shopName, required String itemId, required String name, required int priceVnd, String? note, int by = 1, bool replace = false}) async {
    if (needsReplace(shopId) && !replace) {
      throw StateError('Ask before replacing the cart');
    }
    if (_shopId != shopId) {
      _feeEstimateVnd = null;
      _lines = <DraftLine>[];
      _unavailable.clear();
      _note = null;
    }
    _shopId = shopId;
    _shopName = shopName;
    final String key = _key(itemId, note);
    final int at = _lines.indexWhere((DraftLine l) => _key(l.itemId, l.note) == key);
    if (at >= 0) {
      final DraftLine l = _lines[at];
      _lines[at] = DraftLine(itemId: l.itemId, name: l.name, quantity: (l.quantity + by).clamp(1, 99), priceVnd: priceVnd, note: l.note);
    } else {
      _lines.add(DraftLine(itemId: itemId, name: name, quantity: by.clamp(1, 99), priceVnd: priceVnd, note: note == null || note.trim().isEmpty ? null : note.trim()));
    }
    await _save();
  }

  /// Sets the quantity of one line (0 removes it).
  Future<void> setQuantity(DraftLine line, int quantity) async {
    final int at = _lines.indexWhere((DraftLine l) => _key(l.itemId, l.note) == _key(line.itemId, line.note));
    if (at < 0) {
      return;
    }
    if (quantity <= 0) {
      _lines.removeAt(at);
    } else {
      _lines[at] = DraftLine(itemId: line.itemId, name: line.name, quantity: quantity.clamp(1, 99), priceVnd: line.priceVnd, note: line.note);
    }
    await _save();
  }

  /// The "−" of a menu row: takes one off the last line of that dish.
  Future<void> decrease(String itemId) async {
    final int at = _lines.lastIndexWhere((DraftLine l) => l.itemId == itemId);
    if (at >= 0) {
      await setQuantity(_lines[at], _lines[at].quantity - 1);
    }
  }

  Future<void> setNote(String? note) async {
    _note = note == null || note.trim().isEmpty ? null : note.trim();
    await _save();
  }

  Future<void> clear() async {
    _lines = <DraftLine>[];
    _shopId = null;
    _shopName = '';
    _note = null;
    _unavailable.clear();
    await _save();
  }

  /// Replaces the cart with what the server answered (after "đặt lại" or a refresh).
  void adopt(CartView? view) {
    _apply(view);
    _loaded = true;
    _dirty = false;
    _failure = null;
    _notify();
  }

  /// The Order was sent: the cart of that shop has become the Order (the server emptied it too).
  void sent() {
    _apply(null);
    _dirty = false;
    _notify();
  }

  Future<void> _save() async {
    _dirty = true;
    _notify();
    if (_syncing) {
      return;
    }
    _syncing = true;
    try {
      while (_dirty && !_disposed) {
        _dirty = false;
        final String? shop = _shopId;
        try {
          if (_lines.isEmpty || shop == null) {
            await source.clearCart();
          } else {
            final CartView? saved = await source.saveCart(shopId: shop, lines: _lines, note: _note);
            if (_shopId == shop) _feeEstimateVnd = saved?.feeEstimateVnd;
          }
          _failure = null;
        } on M07Failure catch (failure) {
          // Offline or refused: what is on screen stays; it is saved again with the next change or the next read.
          _failure = failure;
          _dirty = true;
          break;
        }
      }
    } finally {
      _syncing = false;
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// What the order screens of the app share: the cart and the two sources. Built once per app (food); [current] is how a menu row finds the cart without
/// every screen between the home and the menu having to pass it down. Null in a build or a test that has no orders.
class OrderRuntime {
  OrderRuntime({required this.customer, required this.shop, required this.cart, this.mapBuilder, this.pinPicker, this.canOrder = _always, this.addresses, this.session, this.location, this.feedback, this.picker});

  /// The address book (M05) the checkout picks from, and the session the recipient is pre-filled from.
  final AddressBookController? addresses;
  final SessionController? session;

  /// One foreground position fix, taken only when the customer presses "Dùng vị trí hiện tại" at the checkout (no tracking). Null = no GPS in this build.
  final LocationProvider? location;

  /// M11: the customer's ratings and complaints under a finished order. Null = this build has none.
  final M11Source? feedback;
  final ImagePickerPort? picker;

  static bool _always() => true;

  /// Whether the person using the app may order now (signed in as a customer, not in the shop's hat). A guest taps + and is asked to sign in.
  final bool Function() canOrder;

  final CustomerOrderSource customer;
  final ShopOrderSource shop;
  final CartController cart;

  /// How this build draws the M14 map and lets a person pin a point. Null = this build has no map: the screens say the points in words and the checkout
  /// goes without a pin ("Chưa xác định phí"). Nothing is faked.
  final M07MapBuilder? mapBuilder;
  final M07PinPickerBuilder? pinPicker;

  static OrderRuntime? current;
}

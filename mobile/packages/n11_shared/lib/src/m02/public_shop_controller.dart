import 'package:flutter/foundation.dart';

import '../account/models.dart';
import 'menu_models.dart';

// K01 / K02: what a customer sees of one shop. The shop id comes from the entry point that opens the screen; there is no search here.
// Network trouble is not the same as "shop not available": data that was loaded stays on screen, marked as not up to date.

enum PublicLoad { idle, loading, ready, notFound, unavailable, failed, notConnected }

class PublicShopController extends ChangeNotifier {
  PublicShopController({required this.api, required this.shopId});

  final PublicShopApi api;
  final String shopId;

  PublicLoad _state = PublicLoad.idle;
  ShopMenuView? _view;
  bool _stale = false;
  bool _disposed = false;
  bool _loading = false;

  PublicLoad get state => _state;
  ShopMenuView? get view => _view;

  /// The last refresh failed but older data is still shown.
  bool get stale => _stale;

  Future<void> load() async {
    if (_loading) {
      return;
    }
    _loading = true;
    if (_view == null) {
      _state = PublicLoad.loading;
      _notify();
    }
    try {
      _view = await api.load(shopId);
      _state = PublicLoad.ready;
      _stale = false;
    } on FeatureNotConnected {
      _state = _view == null ? PublicLoad.notConnected : _state;
    } on AuthFailure catch (failure) {
      if (failure.code == 'SHOP_NOT_FOUND') {
        _view = null;
        _state = PublicLoad.notFound;
      } else if (failure.code == 'SHOP_UNAVAILABLE') {
        _view = null;
        _state = PublicLoad.unavailable;
      } else if (_view != null) {
        _stale = true;
      } else {
        _state = PublicLoad.failed;
      }
    } finally {
      _loading = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }
}

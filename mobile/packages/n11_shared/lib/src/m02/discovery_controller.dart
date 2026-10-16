import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/models.dart';
import 'discovery_models.dart';

// The state behind the Home discovery (M02-KP01), the filter sheet (KP03) and the search screen (KP02). Rules that matter:
//  - the area is chosen by the person (one area is chosen for them only when the server offers exactly one); nothing is guessed from GPS;
//  - the LATEST request wins: an answer for an older term / filter / area is dropped, so results never flash back from a previous term;
//  - data that was loaded stays on screen, marked "not up to date", when a refresh fails; a first load that fails is an error with a
//    retry, never an empty list;
//  - no sample shop, dish or area: only what the server returned.

enum DiscoveryLoad { idle, loading, ready, failed, notConnected }

class DiscoveryController extends ChangeNotifier {
  DiscoveryController({required this.api});

  final DiscoveryApi api;

  // Choices
  DiscoveryLoad _choices = DiscoveryLoad.idle;
  List<AreaChoice> _areas = const <AreaChoice>[];
  List<CategoryChoice> _categories = const <CategoryChoice>[];

  // Applied filters (what the list shows)
  String? areaId;
  String? categoryId;
  bool openOnly = false;

  // List
  DiscoveryLoad _list = DiscoveryLoad.idle;
  List<ShopCardData> _shops = const <ShopCardData>[];
  bool _hasMore = false;
  bool _loadingMore = false;
  bool _stale = false;
  int _epoch = 0;
  bool _disposed = false;

  DiscoveryLoad get choicesState => _choices;
  List<AreaChoice> get areas => _areas;
  List<CategoryChoice> get categories => _categories;
  DiscoveryLoad get listState => _list;
  List<ShopCardData> get shops => _shops;
  bool get hasMore => _hasMore;
  bool get loadingMore => _loadingMore;
  bool get stale => _stale;
  bool get filtersActive => categoryId != null || openOnly;

  AreaChoice? get area {
    for (final AreaChoice a in _areas) {
      if (a.id == areaId) {
        return a;
      }
    }
    return null;
  }

  CategoryChoice? categoryOf(String id) {
    for (final CategoryChoice c in _categories) {
      if (c.id == id) {
        return c;
      }
    }
    return null;
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

  /// Opens the screen: areas and groups, then the shops of the chosen area.
  Future<void> start() async {
    if (_choices == DiscoveryLoad.loading) {
      return;
    }
    _choices = DiscoveryLoad.loading;
    _notify();
    try {
      final List<List<Object>> got = await Future.wait<List<Object>>(<Future<List<Object>>>[api.areas(), api.categories()]);
      _areas = got[0].cast<AreaChoice>();
      _categories = got[1].cast<CategoryChoice>();
      _choices = DiscoveryLoad.ready;
      if (areaId != null && area == null) {
        areaId = null;
      }
      if (areaId == null && _areas.length == 1) {
        areaId = _areas.single.id;
      }
      if (categoryId != null && categoryOf(categoryId!) == null) {
        categoryId = null;
      }
    } on FeatureNotConnected {
      _choices = DiscoveryLoad.notConnected;
    } on AuthFailure {
      _choices = DiscoveryLoad.failed;
    }
    _notify();
    if (_choices == DiscoveryLoad.ready && areaId != null) {
      await refresh();
    }
  }

  /// Pull to refresh / "Thử lại": the first page again.
  Future<void> refresh() async {
    final String? chosen = areaId;
    if (chosen == null) {
      return;
    }
    final int epoch = ++_epoch;
    _loadingMore = false;
    if (_shops.isEmpty || _list == DiscoveryLoad.failed) {
      _list = DiscoveryLoad.loading;
    }
    _notify();
    try {
      final DiscoveryPage<ShopCardData> page = await api.shops(DiscoveryQuery(areaId: chosen, categoryId: categoryId, openOnly: openOnly));
      if (epoch != _epoch) {
        return;
      }
      _shops = page.items;
      _hasMore = page.hasMore;
      _list = DiscoveryLoad.ready;
      _stale = false;
    } on FeatureNotConnected {
      if (epoch == _epoch) {
        _list = DiscoveryLoad.notConnected;
      }
    } on AuthFailure {
      if (epoch != _epoch) {
        return;
      }
      if (_list == DiscoveryLoad.ready || _shops.isNotEmpty) {
        _stale = true;
        _list = DiscoveryLoad.ready;
      } else {
        _list = DiscoveryLoad.failed;
      }
    }
    _notify();
  }

  Future<void> loadMore() async {
    final String? chosen = areaId;
    if (chosen == null || !_hasMore || _loadingMore || _list != DiscoveryLoad.ready) {
      return;
    }
    final int epoch = _epoch;
    _loadingMore = true;
    _notify();
    try {
      final DiscoveryPage<ShopCardData> page = await api.shops(DiscoveryQuery(areaId: chosen, categoryId: categoryId, openOnly: openOnly, offset: _shops.length));
      if (epoch != _epoch) {
        return;
      }
      final Set<String> seen = _shops.map((ShopCardData s) => s.shopId).toSet();
      _shops = <ShopCardData>[..._shops, for (final ShopCardData s in page.items) if (!seen.contains(s.shopId)) s];
      _hasMore = page.hasMore;
      _stale = false;
    } on FeatureNotConnected {
      // unchanged
    } on AuthFailure {
      if (epoch == _epoch) {
        _stale = true;
      }
    }
    if (epoch == _epoch) {
      _loadingMore = false;
      _notify();
    }
  }

  /// The person picks an area (the list reloads inside it; the filters stay).
  Future<void> chooseArea(String id) async {
    areaId = id;
    _shops = const <ShopCardData>[];
    _hasMore = false;
    _list = DiscoveryLoad.idle;
    _stale = false;
    await refresh();
  }

  /// A category chip on the Home page (the same as the sheet's group): chosen again clears it.
  Future<void> toggleCategory(String id) async {
    categoryId = categoryId == id ? null : id;
    await refresh();
  }

  /// "Áp dụng" of the filter sheet: area, group and open-only at once.
  Future<void> apply({required String? area, required String? category, required bool open}) async {
    final bool areaChanged = area != null && area != areaId;
    if (area != null) {
      areaId = area;
    }
    categoryId = category;
    openOnly = open;
    if (areaChanged) {
      _shops = const <ShopCardData>[];
      _hasMore = false;
      _list = DiscoveryLoad.idle;
    }
    await refresh();
  }

  /// "Đặt lại": clears the group and the open-only switch and keeps the current area.
  Future<void> reset() async {
    categoryId = null;
    openOnly = false;
    await refresh();
  }
}

enum SearchScope { shops, dishes }

/// KP02: the search over shop names and dish names, inside the chosen area (and the applied filters), by the server.
class DishSearchController extends ChangeNotifier {
  DishSearchController({required this.api, required this.areaId, this.categoryId, this.openOnly = false, this.debounce = const Duration(milliseconds: 350)});

  final DiscoveryApi api;
  final String areaId;
  final String? categoryId;
  final bool openOnly;
  final Duration debounce;

  String _term = '';
  SearchScope scope = SearchScope.shops;
  final Map<SearchScope, _Results> _results = <SearchScope, _Results>{};
  Timer? _timer;
  int _epoch = 0;
  bool _disposed = false;

  String get term => _term;
  bool get hasTerm => _term.trim().isNotEmpty;

  _Results _of(SearchScope s) => _results[s] ??= _Results();

  List<ShopCardData> get shops => List<ShopCardData>.from(_of(SearchScope.shops).items.cast<ShopCardData>());
  List<DishHit> get dishes => List<DishHit>.from(_of(SearchScope.dishes).items.cast<DishHit>());
  DiscoveryLoad get state => _of(scope).state;
  bool get stale => _of(scope).stale;
  bool get hasMore => _of(scope).hasMore;
  bool get loadingMore => _of(scope).loadingMore;

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }

  /// The person typed: the old results go AT ONCE (no flash of the previous term), the new request starts after a short pause.
  void setTerm(String value) {
    if (value == _term) {
      return;
    }
    _term = value;
    _epoch++;
    _timer?.cancel();
    _results.clear();
    if (!hasTerm) {
      _notify();
      return;
    }
    _of(scope).state = DiscoveryLoad.loading;
    _notify();
    _timer = Timer(debounce, run);
  }

  void setScope(SearchScope next) {
    if (next == scope) {
      return;
    }
    scope = next;
    _notify();
    if (hasTerm && _of(next).state == DiscoveryLoad.idle) {
      run();
    }
  }

  /// "Thử lại" and the first request of a scope.
  Future<void> run() async {
    if (!hasTerm) {
      return;
    }
    final int epoch = _epoch;
    final SearchScope forScope = scope;
    final String term = _term;
    final _Results r = _of(forScope);
    r.state = DiscoveryLoad.loading;
    _notify();
    final DiscoveryQuery query = DiscoveryQuery(areaId: areaId, categoryId: categoryId, openOnly: openOnly, term: term);
    try {
      if (forScope == SearchScope.shops) {
        final DiscoveryPage<ShopCardData> page = await api.shops(query);
        if (epoch != _epoch) {
          return;
        }
        r.items = List<Object>.from(page.items);
        r.hasMore = page.hasMore;
      } else {
        final DiscoveryPage<DishHit> page = await api.dishes(query);
        if (epoch != _epoch) {
          return;
        }
        r.items = List<Object>.from(page.items);
        r.hasMore = page.hasMore;
      }
      r.state = DiscoveryLoad.ready;
      r.stale = false;
    } on FeatureNotConnected {
      if (epoch == _epoch) {
        r.state = DiscoveryLoad.notConnected;
      }
    } on AuthFailure {
      if (epoch == _epoch) {
        r.state = DiscoveryLoad.failed;
      }
    }
    if (epoch == _epoch) {
      _notify();
    }
  }

  Future<void> loadMore() async {
    final _Results r = _of(scope);
    if (!hasTerm || !r.hasMore || r.loadingMore || r.state != DiscoveryLoad.ready) {
      return;
    }
    final int epoch = _epoch;
    final SearchScope forScope = scope;
    r.loadingMore = true;
    _notify();
    final DiscoveryQuery query = DiscoveryQuery(areaId: areaId, categoryId: categoryId, openOnly: openOnly, term: _term, offset: r.items.length);
    try {
      if (forScope == SearchScope.shops) {
        final DiscoveryPage<ShopCardData> page = await api.shops(query);
        if (epoch != _epoch) {
          return;
        }
        r.items = <Object>[...r.items, ...page.items];
        r.hasMore = page.hasMore;
      } else {
        final DiscoveryPage<DishHit> page = await api.dishes(query);
        if (epoch != _epoch) {
          return;
        }
        r.items = <Object>[...r.items, ...page.items];
        r.hasMore = page.hasMore;
      }
    } on FeatureNotConnected {
      // unchanged
    } on AuthFailure {
      if (epoch == _epoch) {
        r.stale = true;
      }
    }
    if (epoch == _epoch) {
      r.loadingMore = false;
      _notify();
    }
  }
}

class _Results {
  DiscoveryLoad state = DiscoveryLoad.idle;
  List<Object> items = <Object>[];
  bool hasMore = false;
  bool loadingMore = false;
  bool stale = false;
}

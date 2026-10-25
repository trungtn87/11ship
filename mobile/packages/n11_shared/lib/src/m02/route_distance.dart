import 'dart:async';

import 'package:flutter/foundation.dart';

import '../flows/location.dart';
import 'discovery_models.dart';

// Issue #190, section 6: the distance on a shop card is the ROAD distance from the customer's CURRENT position to the shop's PICKUP point, asked of
// the server (which asks the M14 routing service). It is not the straight line and not the leg an order's fee is priced with.
//
//  - What a card shows comes only from here: loading, a route in metres, or "unavailable". Building a card never starts a request.
//  - A result belongs to (shop, shop point, position rounded to ~110 m). A new position, another shop point or [reset] (area/refresh) makes older
//    answers unusable, and an answer that arrives after that is dropped.
//  - At most [maxPerRequest] shops per request and ONE request at a time; answers are cached for [ttl]; a failed request is not retried before
//    [failureBackoff]. So rebuilding, scrolling or a fast-moving position never turns into a request storm.
//  - Haversine is kept ONLY as a labelled reference when the road is unknown ("đường chim bay"); it is never presented as a route.

enum RouteDistanceKind { noPosition, loading, route, unavailable }

@immutable
class RouteDistance {
  const RouteDistance._(this.kind, this.meters);

  static const RouteDistance noPosition = RouteDistance._(RouteDistanceKind.noPosition, null);
  static const RouteDistance loading = RouteDistance._(RouteDistanceKind.loading, null);
  static const RouteDistance unavailable = RouteDistance._(RouteDistanceKind.unavailable, null);
  const RouteDistance.route(int this.meters) : kind = RouteDistanceKind.route;

  final RouteDistanceKind kind;
  final int? meters;

  /// 3,4 km (comma, one decimal; below 100 m the metres).
  static String text(int meters) {
    if (meters < 100) return '$meters m';
    return '${(meters / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';
  }
}

class _Entry {
  _Entry(this.meters, this.at);

  final int? meters;
  final DateTime at;
}

class RouteDistanceController extends ChangeNotifier {
  RouteDistanceController({
    required this.api,
    this.ttl = const Duration(minutes: 10),
    this.failureBackoff = const Duration(minutes: 1),
    this.maxPerRequest = 20,
    this.maxShops = 60,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final DiscoveryApi api;
  final Duration ttl;
  final Duration failureBackoff;
  final int maxPerRequest;
  final int maxShops;
  final DateTime Function() _clock;

  final Map<String, _Entry> _known = <String, _Entry>{};
  final Set<String> _inFlight = <String>{};
  int _epoch = 0;
  bool _disposed = false;
  Future<void>? _running;
  int requests = 0;

  /// The position as it enters a key: rounded to 3 decimals (~110 m), so GPS jitter does not refetch and a real move does.
  static String originKey(LocationFix fix) => '${fix.latitude.toStringAsFixed(3)},${fix.longitude.toStringAsFixed(3)}';

  String _key(ShopCardData shop, LocationFix fix) => '${shop.shopId}|${shop.latitude},${shop.longitude}|${originKey(fix)}';

  /// Pure lookup for a card. Never starts a request.
  RouteDistance of(ShopCardData shop, LocationFix? fix) {
    if (fix == null) return RouteDistance.noPosition;
    if (shop.latitude == null || shop.longitude == null) return RouteDistance.unavailable;
    final String key = _key(shop, fix);
    final _Entry? entry = _known[key];
    if (entry != null && _fresh(entry)) {
      return entry.meters == null ? RouteDistance.unavailable : RouteDistance.route(entry.meters!);
    }
    return RouteDistance.loading;
  }

  bool _fresh(_Entry entry) => _clock().difference(entry.at) < (entry.meters == null ? failureBackoff : ttl);

  /// Another area, a refresh or a new session: nothing computed before may be shown again, and answers still on the way are dropped.
  void reset() {
    _epoch++;
    _known.clear();
    _inFlight.clear();
    _notify();
  }

  /// Asks for the cards that are not known yet (at most [maxShops], [maxPerRequest] per request, one request at a time). Safe to call on every
  /// change of the list or the position: what is known or already asked is not asked again.
  Future<void> want(Iterable<ShopCardData> shops, LocationFix? fix) {
    if (fix == null || _disposed) return Future<void>.value();
    final List<ShopCardData> missing = <ShopCardData>[];
    for (final ShopCardData shop in shops.take(maxShops)) {
      if (shop.latitude == null || shop.longitude == null) continue;
      final String key = _key(shop, fix);
      final _Entry? entry = _known[key];
      if ((entry != null && _fresh(entry)) || _inFlight.contains(key) || missing.any((ShopCardData m) => m.shopId == shop.shopId)) continue;
      missing.add(shop);
    }
    _known.removeWhere((String _, _Entry entry) => !_fresh(entry));
    if (missing.isEmpty) return _running ?? Future<void>.value();
    final int epoch = _epoch;
    for (final ShopCardData shop in missing) {
      _inFlight.add(_key(shop, fix));
    }
    final Future<void> previous = _running ?? Future<void>.value();
    final Future<void> next = previous.then((_) => _fetch(missing, fix, epoch));
    _running = next;
    return next;
  }

  Future<void> _fetch(List<ShopCardData> shops, LocationFix fix, int epoch) async {
    for (int start = 0; start < shops.length; start += maxPerRequest) {
      final List<ShopCardData> batch = shops.sublist(start, (start + maxPerRequest).clamp(0, shops.length));
      if (epoch != _epoch || _disposed) return;
      Map<String, int?> answer = const <String, int?>{};
      requests++;
      try {
        answer = await api.routeDistances(fix.latitude, fix.longitude, <String>[for (final ShopCardData s in batch) s.shopId]);
      } on Object {
        answer = const <String, int?>{};
      }
      if (epoch != _epoch || _disposed) return;
      final DateTime now = _clock();
      for (final ShopCardData shop in batch) {
        final String key = _key(shop, fix);
        _inFlight.remove(key);
        // A shop the answer does not mention, a failure and "no road" are all "unavailable": no number is ever invented.
        _known[key] = _Entry(answer[shop.shopId], now);
      }
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

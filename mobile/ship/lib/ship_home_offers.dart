import 'dart:async';

import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

/// #392 "Đơn có thể nhận" under the Home map. Reads the SAME offer source as the Orders tab (ShipperDeliverySource.offers) and shows only the offers the
/// server marks eligible, at most [kHomeOfferLimit]. A tap opens the Orders tab, where the existing accept / fee rules and server checks apply; nothing
/// is accepted from Home. A fee or distance is shown only when the server gave a number.
const int kHomeOfferLimit = 3;

class HomeOffers extends StatefulWidget {
  const HomeOffers({
    super.key,
    required this.source,
    required this.receiving,
    required this.notReceivingText,
    this.onGoOnline,
    this.onOpenOrders,
    this.refreshEvery = const Duration(seconds: 15),
  });

  final ShipperDeliverySource source;

  /// True only when the Shipper is online, not paused and the phone can give a position: then offers are fetched and shown.
  final bool receiving;

  /// Plain sentence shown instead of offers when [receiving] is false (never a promise that an order exists).
  final String notReceivingText;

  /// The online switch, offered as the one action while offline. Null = no button.
  final VoidCallback? onGoOnline;
  final VoidCallback? onOpenOrders;
  final Duration refreshEvery;

  @override
  State<HomeOffers> createState() => _HomeOffersState();
}

class _HomeOffersState extends State<HomeOffers> {
  List<OfferView>? _offers;
  bool _failed = false;
  Timer? _timer;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(HomeOffers old) {
    super.didUpdateWidget(old);
    if (old.receiving != widget.receiving ||
        !identical(old.source, widget.source)) {
      _sync();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// Starts or stops watching the offers. Stopping clears the list, so an offline Shipper never sees offers as if ready.
  void _sync() {
    _timer?.cancel();
    _timer = null;
    _generation++;
    _offers = null;
    _failed = false;
    if (!widget.receiving) return;
    unawaited(_load());
    _timer = Timer.periodic(widget.refreshEvery, (_) => unawaited(_load()));
  }

  Future<void> _load() async {
    final int generation = _generation;
    try {
      final List<OfferView> all = await widget.source.offers();
      if (!mounted || generation != _generation) return;
      setState(() {
        _offers = all
            .where((OfferView o) => o.eligible)
            .take(kHomeOfferLimit)
            .toList();
        _failed = false;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        key: const Key('home-offers'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                  child: Text('Đơn có thể nhận',
                      key: Key('home-offers-title'), style: N11Text.h2)),
              if (widget.onOpenOrders != null)
                N11Link('Xem tất cả',
                    key: const Key('home-offers-all'),
                    onPressed: widget.onOpenOrders),
            ],
          ),
          const SizedBox(height: N11Space.gap2),
          _body(),
        ],
      );

  Widget _body() {
    if (!widget.receiving) {
      return _note(
        key: const Key('home-offers-off'),
        text: widget.notReceivingText,
        action: widget.onGoOnline == null
            ? null
            : N11Button(
                key: const Key('home-offers-go-online'),
                label: 'Bật online',
                kind: ButtonKind.secondary,
                compact: true,
                onPressed: widget.onGoOnline),
      );
    }
    final List<OfferView>? offers = _offers;
    if (offers == null) {
      if (_failed) {
        return _note(
          key: const Key('home-offers-error'),
          text: 'Chưa tải được đơn có thể nhận. Kiểm tra mạng rồi thử lại.',
          action: TextButton(
              key: const Key('home-offers-retry'),
              onPressed: () => unawaited(_load()),
              child: const Text('Thử lại')),
        );
      }
      return _note(
          key: const Key('home-offers-loading'), text: 'Đang tải đơn…');
    }
    if (offers.isEmpty) {
      return _note(
          key: const Key('home-offers-empty'),
          text:
              'Chưa có đơn có thể nhận lúc này. Danh sách tự cập nhật mỗi 15 giây.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (final OfferView o in offers)
          Padding(
            padding: const EdgeInsets.only(bottom: N11Space.gap2),
            child: _OfferTile(offer: o, onTap: widget.onOpenOrders),
          ),
      ],
    );
  }

  Widget _note({required Key key, required String text, Widget? action}) =>
      Container(
        key: key,
        width: double.infinity,
        padding: const EdgeInsets.all(N11Space.gap3),
        decoration: BoxDecoration(
            color: N11Colors.white,
            borderRadius: BorderRadius.circular(N11V5.inputRadius)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(text, style: N11Text.caption),
            if (action != null)
              Padding(
                  padding: const EdgeInsets.only(top: N11Space.gap2),
                  child: Align(alignment: Alignment.centerLeft, child: action)),
          ],
        ),
      );
}

/// One compact offer: code, shop, and only the figures the server stated (distance, fee).
class _OfferTile extends StatelessWidget {
  const _OfferTile({required this.offer, this.onTap});
  final OfferView offer;
  final VoidCallback? onTap;

  static String _distance(int metres) =>
      metres < 1000 ? '$metres m' : '${(metres / 1000).toStringAsFixed(1)} km';

  @override
  Widget build(BuildContext context) {
    final int? distance = offer.distanceToShopM;
    final int? fee = offer.feeVnd;
    return Material(
      color: N11Colors.white,
      borderRadius: BorderRadius.circular(N11V5.inputRadius),
      child: InkWell(
        key: Key('home-offer-${offer.deliveryId}'),
        borderRadius: BorderRadius.circular(N11V5.inputRadius),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(N11Space.gap3),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(offer.shopName,
                        style: N11Text.bodyStrong,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    if (distance != null)
                      Text('Cách quán ${_distance(distance)}',
                          style: N11Text.caption),
                  ],
                ),
              ),
              if (fee != null)
                Text(formatVnd(fee),
                    key: Key('home-offer-fee-${offer.deliveryId}'),
                    style: N11Text.bodyStrong),
              if (onTap != null)
                const Icon(Icons.chevron_right, color: N11Colors.ink2),
            ],
          ),
        ),
      ),
    );
  }
}

import 'm07_models.dart';
import 'm07_source.dart';

// Illustrative data for the preview build (--dart-define=M07_UI_PREVIEW=true) and for tests. Every screen fed by it carries the
// "Dữ liệu minh họa" banner. It is an in-memory stand-in with the same state rules as the server (cancel only before pickup, fail opens an
// incident, ...) so the screens can be seen and tested end to end; it never reaches production flows and proves nothing about the server.

const bool kM07UiPreview = bool.fromEnvironment('M07_UI_PREVIEW');

final DateTime _now = DateTime.utc(2026, 10, 18, 9, 0);

const PickupView _shop = PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu, Phường A, TP. Mẫu', lat: 22.665, lng: 106.257);

DeliveryView _delivery(String id, String code, DeliveryState state,
        {int minutesAgo = 3, FeeView? fee, bool pinned = true, AssignmentView? assignment, LocationView? location, IncidentView? incident, ResultView? result, Set<String> can = const <String>{}}) =>
    DeliveryView(
      deliveryId: id,
      code: code,
      source: 'DIRECT',
      state: state,
      version: 1,
      pickup: _shop,
      recipient: RecipientView(name: 'Người nhận mẫu', phone: '0900000002', addressText: 'Số 9 Phố Mẫu, Phường B, TP. Mẫu', lat: pinned ? 22.67 : null, lng: pinned ? 106.26 : null),
      goods: const GoodsView(description: 'Hộp bánh mẫu', valueVnd: 150000, paidVnd: 100000),
      fee: fee ?? const FeeView(mode: 'STANDARD', payer: 'CUSTOMER', status: 'FINAL', amountVnd: 15000, distanceM: 3200),
      search: SearchView(startedAt: _now.subtract(Duration(minutes: minutesAgo)), expiresAt: _now.subtract(Duration(minutes: minutesAgo)).add(const Duration(minutes: 30)), serverNow: _now),
      assignment: assignment,
      location: location,
      incident: incident,
      result: result,
      can: can,
    );

AssignmentView _assignment({bool destination = true, DateTime? pickedUpAt}) =>
    AssignmentView(assignmentId: 'asg-1', shipperName: 'Shipper Mẫu', shipperPhone: '0900000003', plateNumber: '11A-000.00', acceptedAt: _now.subtract(const Duration(minutes: 5)), pickedUpAt: pickedUpAt, destinationConfirmed: destination);

LocationView _location(Freshness f) => LocationView(lat: 22.666, lng: 106.258, recordedAt: _now.subtract(Duration(seconds: f == Freshness.live ? 20 : 400)), ageSeconds: f == Freshness.live ? 20 : 400, freshness: f);

/// The shop's "Đang xử lý" list: running deliveries, a stopped search (call again / cancel) and a failed one whose goods are not settled.
bool _inActiveList(DeliveryView d) => d.state.isActive || d.state == DeliveryState.searchStopped || (d.incident?.isOpen ?? false);

int _seq = 100;
String _nextId() => 'sample-${_seq++}';

class SampleShopSource extends ShopDeliverySource {
  SampleShopSource() {
    _items.addAll(<DeliveryView>[
      _delivery('d-wait', 'G-100001', DeliveryState.waitingDriver, minutesAgo: 6, can: const <String>{'cancel'}),
      _delivery('d-acc', 'G-100002', DeliveryState.accepted, assignment: _assignment(), location: _location(Freshness.live), can: const <String>{'cancel'}),
      _delivery('d-run', 'G-100003', DeliveryState.delivering, assignment: _assignment(pickedUpAt: _now.subtract(const Duration(minutes: 2))), location: _location(Freshness.stale)),
      _delivery('d-stop', 'G-100004', DeliveryState.searchStopped, minutesAgo: 30, can: const <String>{'recall', 'cancel'}),
      _delivery('d-fail', 'G-100005', DeliveryState.failed,
          incident: IncidentView(incidentId: 'i-1', status: 'OPEN', custody: 'SHIPPER', reason: 'Không liên lạc được người nhận', openedAt: _now),
          result: ResultView(outcome: 'failed', at: _now, reason: 'Không liên lạc được người nhận', goodsCondition: 'WITH_SHIPPER'),
          can: const <String>{'resolve_custody'}),
      _delivery('d-done', 'G-100006', DeliveryState.completed, result: ResultView(outcome: 'completed', at: _now)),
    ]);
  }

  final List<DeliveryView> _items = <DeliveryView>[];

  @override
  bool get isSample => true;

  DeliveryView _find(String id) => _items.firstWhere((DeliveryView d) => d.deliveryId == id, orElse: () => throw const M07Failure(M07FailureKind.refused, code: 'DELIVERY_NOT_FOUND'));

  DeliveryView _replace(DeliveryView next) {
    _items[_items.indexWhere((DeliveryView d) => d.deliveryId == next.deliveryId)] = next;
    return next;
  }

  @override
  Future<List<DeliveryView>> list({required bool history, String query = ''}) async {
    final String q = query.trim().toLowerCase();
    return <DeliveryView>[
      for (final DeliveryView d in _items)
        if ((history ? !_inActiveList(d) : _inActiveList(d)) && (q.isEmpty || d.code.toLowerCase().contains(q) || d.recipient.name.toLowerCase().contains(q))) d,
    ];
  }

  @override
  Future<DeliveryView> get(String id) async => _find(id);

  @override
  Future<DeliveryView> create(NewDeliveryInput input, {required String key}) async {
    final bool pinned = input.lat != null && input.lng != null;
    final DeliveryView made = DeliveryView(
      deliveryId: _nextId(),
      code: 'G-${100000 + _seq}',
      source: 'DIRECT',
      state: DeliveryState.waitingDriver,
      version: 1,
      pickup: _shop,
      recipient: RecipientView(name: input.recipientName, phone: input.recipientPhone, addressText: input.addressText, lat: input.lat, lng: input.lng),
      goods: GoodsView(description: input.goodsDescription, valueVnd: input.goodsValueVnd, paidVnd: input.paidVnd),
      fee: input.agreed
          ? FeeView(mode: 'AGREED', payer: input.feePayer, status: 'PENDING_AGREEMENT', amountVnd: null, agreement: AgreementSummary(state: 'PROPOSED', proposedVnd: input.agreedAmountVnd!, reasonCode: input.agreedReasonCode ?? 'OTHER', expiresAt: _now.add(const Duration(minutes: 30))))
          : FeeView(mode: pinned ? 'STANDARD' : 'PICKUP_AGREEMENT', payer: input.feePayer, status: pinned ? 'FINAL' : 'UNKNOWN', amountVnd: pinned ? 15000 : null, distanceM: pinned ? 3000 : null),
      search: SearchView(startedAt: _now, expiresAt: _now.add(const Duration(minutes: 30)), serverNow: _now),
      can: const <String>{'cancel'},
    );
    _items.insert(0, made);
    return made;
  }

  @override
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async {
    final DeliveryView d = _find(id);
    if (!d.allows('cancel')) {
      throw const M07Failure(M07FailureKind.conflict, code: 'AFTER_PICKUP_NO_CANCEL');
    }
    return _replace(d.copyWith(
      state: DeliveryState.cancelledByMerchant,
      version: d.version + 1,
      clearAssignment: true,
      clearLocation: true,
      can: const <String>{},
      result: ResultView(outcome: 'cancelled', at: _now, reason: reason),
    ));
  }

  @override
  Future<DeliveryView> recall(String id, {required String key}) async {
    final DeliveryView old = _find(id);
    if (!old.allows('recall')) {
      throw const M07Failure(M07FailureKind.refused, code: 'RECALL_BLOCKED_GOODS_OUT');
    }
    final DeliveryView next = DeliveryView(
      deliveryId: _nextId(),
      code: 'G-${100000 + _seq}',
      source: old.source,
      previousDeliveryId: old.deliveryId,
      state: DeliveryState.waitingDriver,
      version: 1,
      pickup: old.pickup,
      recipient: old.recipient,
      goods: old.goods,
      fee: old.fee,
      search: SearchView(startedAt: _now, expiresAt: _now.add(const Duration(minutes: 30)), serverNow: _now),
      can: const <String>{'cancel'},
    );
    _items.insert(0, next);
    return next;
  }

  @override
  Future<DeliveryView> answerCounter(String id, {required bool accept, required int expectedVersion, required String key}) async => _find(id);

  @override
  Future<DeliveryView> confirmCustomerFee(String id, {required int expectedVersion, required String key}) async => _find(id);

  @override
  Future<DeliveryView> resolveCustody(String id, {required String resolution, String? note, required String key}) async {
    final DeliveryView d = _find(id);
    final IncidentView? i = d.incident;
    if (i == null) {
      throw const M07Failure(M07FailureKind.conflict, code: 'DELIVERY_STATE_CONFLICT');
    }
    final bool back = resolution == 'GOODS_RETURNED';
    return _replace(d.copyWith(
      version: d.version + 1,
      incident: IncidentView(incidentId: i.incidentId, status: 'CLOSED', custody: back ? 'SHOP' : 'HANDLED', reason: i.reason, openedAt: i.openedAt),
      can: back ? const <String>{'recall'} : const <String>{},
    ));
  }
}

class SampleShipperSource extends ShipperDeliverySource {
  SampleShipperSource() {
    _mine.addAll(<DeliveryView>[
      _delivery('m-acc', 'G-200001', DeliveryState.accepted, assignment: _assignment(destination: false), pinned: false, fee: const FeeView(mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', status: 'UNKNOWN'), can: const <String>{'release', 'confirm_destination'}),
      _delivery('m-run', 'G-200002', DeliveryState.delivering, assignment: _assignment(pickedUpAt: _now.subtract(const Duration(minutes: 4))), can: const <String>{'complete', 'fail'}),
    ]);
  }

  final List<DeliveryView> _mine = <DeliveryView>[];
  final List<OfferView> _offers = <OfferView>[
    OfferView(
      deliveryId: 'o-1',
      code: 'G-300001',
      shopName: 'Quán Mẫu',
      shopAreaText: 'Phường A, TP. Mẫu',
      distanceToShopM: 1200,
      dropoffAreaText: 'Phường B, TP. Mẫu',
      destinationKnown: true,
      goodsValueVnd: 150000,
      unpaidVnd: 50000,
      feeVnd: 15000,
      feeStatus: 'FINAL',
      feePayer: 'CUSTOMER',
      expiresAt: _now.add(const Duration(minutes: 24)),
      serverNow: _now,
      eligible: true,
    ),
    OfferView(
      deliveryId: 'o-2',
      code: 'G-300002',
      shopName: 'Quán Xa',
      distanceToShopM: 4200,
      destinationKnown: false,
      goodsValueVnd: 80000,
      unpaidVnd: 0,
      feeStatus: 'UNKNOWN',
      feePayer: 'SHOP',
      expiresAt: _now.add(const Duration(minutes: 12)),
      serverNow: _now,
      eligible: false,
      reasons: <String>['OUT_OF_SEARCH_RADIUS'],
    ),
  ];

  @override
  bool get isSample => true;

  DeliveryView _find(String id) => _mine.firstWhere((DeliveryView d) => d.deliveryId == id, orElse: () => throw const M07Failure(M07FailureKind.refused, code: 'DELIVERY_NOT_FOUND'));

  DeliveryView _replace(DeliveryView next) {
    _mine[_mine.indexWhere((DeliveryView d) => d.deliveryId == next.deliveryId)] = next;
    return next;
  }

  @override
  Future<List<OfferView>> offers() async => List<OfferView>.of(_offers);

  @override
  Future<List<DeliveryView>> mine({required bool history}) async => <DeliveryView>[
        for (final DeliveryView d in _mine)
          if (history ? !d.state.isActive : d.state.isActive) d,
      ];

  @override
  Future<DeliveryView> get(String id) async => _find(id);

  @override
  Future<DeliveryView> accept(String id, {required String key}) async {
    final int at = _offers.indexWhere((OfferView o) => o.deliveryId == id);
    if (at < 0) {
      throw const M07Failure(M07FailureKind.conflict, code: 'DELIVERY_ALREADY_TAKEN');
    }
    final OfferView o = _offers.removeAt(at);
    if (!o.eligible) {
      _offers.insert(at, o);
      throw const M07Failure(M07FailureKind.refused, code: 'DELIVERY_NOT_ELIGIBLE');
    }
    final DeliveryView made = _delivery(o.deliveryId, o.code, DeliveryState.accepted, assignment: _assignment(), can: const <String>{'release', 'pickup'});
    _mine.insert(0, made);
    return made;
  }

  @override
  Future<DeliveryView> release(String id, {required String reason, required int expectedVersion, required String key}) async {
    final DeliveryView d = _find(id);
    if (!d.allows('release')) {
      throw const M07Failure(M07FailureKind.conflict, code: 'AFTER_PICKUP_NO_CANCEL');
    }
    _mine.removeWhere((DeliveryView x) => x.deliveryId == id);
    return d.copyWith(state: DeliveryState.waitingDriver, version: d.version + 1, clearAssignment: true, clearLocation: true, can: const <String>{});
  }

  @override
  Future<OfferView> feeAgree(String id, {required String key}) async => _offers.firstWhere((OfferView o) => o.deliveryId == id);

  @override
  Future<void> feeSkip(String id, {required String key}) async {
    _offers.removeWhere((OfferView o) => o.deliveryId == id);
  }

  @override
  Future<OfferView> feeCounter(String id, {required int amountVnd, required String key}) async => _offers.firstWhere((OfferView o) => o.deliveryId == id);

  @override
  Future<DeliveryView> confirmDestination(String id, {required double lat, required double lng, int? feeVnd, required int expectedVersion, required String key}) async {
    final DeliveryView d = _find(id);
    return _replace(d.copyWith(
      state: DeliveryState.locationConfirmed,
      version: d.version + 1,
      recipient: RecipientView(name: d.recipient.name, phone: d.recipient.phone, addressText: d.recipient.addressText, lat: lat, lng: lng),
      fee: FeeView(mode: d.fee.mode, payer: d.fee.payer, status: 'FINAL', amountVnd: feeVnd ?? d.fee.amountVnd),
      assignment: _assignment(),
      can: const <String>{'release', 'pickup'},
    ));
  }

  @override
  Future<DeliveryView> pickup(String id, {required int expectedVersion, required String key}) async {
    final DeliveryView d = _find(id);
    if (!d.allows('pickup')) {
      throw const M07Failure(M07FailureKind.refused, code: 'DESTINATION_NOT_CONFIRMED');
    }
    return _replace(d.copyWith(state: DeliveryState.delivering, version: d.version + 1, assignment: _assignment(pickedUpAt: _now), can: const <String>{'complete', 'fail'}));
  }

  @override
  Future<DeliveryView> complete(String id, {required int expectedVersion, required String key}) async {
    final DeliveryView d = _find(id);
    return _replace(d.copyWith(state: DeliveryState.completed, version: d.version + 1, clearLocation: true, can: const <String>{}, result: ResultView(outcome: 'completed', at: _now)));
  }

  @override
  Future<DeliveryView> fail(String id, {required String reasonCode, String? note, required String goodsCondition, required int expectedVersion, required String key}) async {
    final DeliveryView d = _find(id);
    final String reason = kFailReasons.firstWhere(((String, String) r) => r.$1 == reasonCode, orElse: () => (reasonCode, reasonCode)).$2;
    return _replace(d.copyWith(
      state: DeliveryState.failed,
      version: d.version + 1,
      clearLocation: true,
      can: const <String>{},
      result: ResultView(outcome: 'failed', at: _now, reason: reason, goodsCondition: goodsCondition),
      incident: IncidentView(incidentId: 'i-new', status: 'OPEN', custody: goodsCondition == 'RETURNED_TO_SHOP' ? 'SHOP' : 'SHIPPER', reason: reason, openedAt: _now),
    ));
  }
}

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'address_models.dart';
import '../flows/location.dart';

// M05-B: state of the address book screens over an [AddressApi].
//
// Rules: the list is always the server's (every successful write is followed by a fresh read); one write at a time (a second tap
// while [busy] or while an outcome is unknown does nothing, so no duplicate is ever sent); a write whose outcome is unknown keeps its
// exact operation and Idempotency-Key and only [retryPending] may decide it; logout, a revoked session or another account clears
// everything, so private data is never shown to the next person.

enum AddressLoad { idle, loading, ready, failed }

enum AddressOpKind { create, update, delete, setDefault }

class AddressPending {
  const AddressPending({required this.kind, required this.key, required this.run});

  final AddressOpKind kind;
  final String key;
  final Future<void> Function(String key) run;
}

class AddressBookController extends ChangeNotifier {
  AddressBookController({required this.api, this.session, LocationProvider? location}) : location = location ?? MethodChannelLocationProvider() {
    session?.addListener(_onSession);
    _sessionEpoch = session?.sessionEpoch ?? 0;
  }

  final AddressApi api;
  final LocationProvider location;
  final SessionController? session;

  AddressLoad _load = AddressLoad.idle;
  List<DeliveryAddress> _addresses = const <DeliveryAddress>[];
  AuthFailure? _loadFailure;
  bool _busy = false;
  AddressPending? _pending;
  AuthFailure? _writeFailure;
  bool _conflict = false;
  bool _gone = false;
  String? _notice;
  int _noticeSeq = 0;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;

  AddressLoad get loadState => _load;

  /// Default first, then as the server ordered them.
  List<DeliveryAddress> get addresses => _addresses;
  AuthFailure? get loadFailure => _loadFailure;
  bool get busy => _busy;
  AddressPending? get pending => _pending;
  AuthFailure? get writeFailure => _writeFailure;

  /// The address changed on another device: the list was reloaded, the person decides again.
  bool get conflict => _conflict;

  /// The address no longer exists (deleted elsewhere): the list was reloaded.
  bool get gone => _gone;
  String? get notice => _notice;
  int get noticeSeq => _noticeSeq;
  bool get locked => _busy || _pending != null;

  DeliveryAddress? get defaultAddress {
    for (final DeliveryAddress a in _addresses) {
      if (a.isDefault) {
        return a;
      }
    }
    return null;
  }

  DeliveryAddress? byId(String id) {
    for (final DeliveryAddress a in _addresses) {
      if (a.id == id) {
        return a;
      }
    }
    return null;
  }

  void _onSession() {
    final SessionController s = session!;
    if (s.sessionEpoch != _sessionEpoch || s.status != SessionStatus.signedIn) {
      _sessionEpoch = s.sessionEpoch;
      clear();
    }
  }

  /// Forgets everything (logout, revoked session, another account). In-flight answers are discarded.
  void clear() {
    _epoch++;
    _load = AddressLoad.idle;
    _addresses = const <DeliveryAddress>[];
    _loadFailure = null;
    _busy = false;
    _pending = null;
    _writeFailure = null;
    _conflict = false;
    _gone = false;
    _notice = null;
    _notify();
  }

  void clearWriteState() {
    _writeFailure = null;
    _conflict = false;
    _gone = false;
    _notify();
  }

  Future<void> load() async {
    if (_load == AddressLoad.loading) {
      return;
    }
    final int epoch = _epoch;
    _load = AddressLoad.loading;
    _loadFailure = null;
    _notify();
    try {
      final List<DeliveryAddress> list = await api.list();
      if (epoch != _epoch) {
        return;
      }
      _addresses = _ordered(list);
      _load = AddressLoad.ready;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      // Keep what was shown before only when it was real; the screen says the data may be out of date.
      _loadFailure = failure;
      _load = AddressLoad.failed;
    }
    _notify();
  }

  List<DeliveryAddress> _ordered(List<DeliveryAddress> list) {
    final List<DeliveryAddress> sorted = <DeliveryAddress>[...list];
    final int d = sorted.indexWhere((DeliveryAddress a) => a.isDefault);
    if (d > 0) {
      sorted.insert(0, sorted.removeAt(d));
    }
    return sorted;
  }

  // ---- writes ----------------------------------------------------------------------------------------------------------

  /// Creates ([editing] null) or updates an address. True when the server stored it and the list was reloaded.
  Future<bool> save(AddressInput input, {DeliveryAddress? editing}) {
    final String key = newIdempotencyKey();
    if (editing == null) {
      return _start(AddressOpKind.create, key, (String k) async {
        await api.create(input, key: k);
      });
    }
    final String id = editing.id;
    final int version = editing.version;
    return _start(AddressOpKind.update, key, (String k) async {
      await api.update(id, input, expectedVersion: version, key: k);
    });
  }

  Future<bool> delete(String id) => _start(AddressOpKind.delete, newIdempotencyKey(), (String k) async {
        await api.delete(id, key: k);
      });

  Future<bool> setDefault(String id) => _start(AddressOpKind.setDefault, newIdempotencyKey(), (String k) async {
        await api.setDefault(id, key: k);
      });

  /// Sends the unknown-outcome operation again with the SAME key: the server replays or finishes it, never doubles it.
  Future<bool> retryPending() async {
    final AddressPending? p = _pending;
    if (p == null || _busy) {
      return false;
    }
    return _execute(p);
  }

  /// The person gives up on an unknown outcome: the list is read again so the screen shows the truth.
  Future<void> discardPending() async {
    _pending = null;
    _writeFailure = null;
    _notify();
    await load();
  }

  Future<bool> _start(AddressOpKind kind, String key, Future<void> Function(String key) run) {
    if (_busy || _pending != null) {
      return Future<bool>.value(false);
    }
    return _execute(AddressPending(kind: kind, key: key, run: run));
  }

  Future<bool> _execute(AddressPending op) async {
    final int epoch = _epoch;
    _busy = true;
    _writeFailure = null;
    _conflict = false;
    _gone = false;
    _notify();
    try {
      await op.run(op.key);
      if (epoch != _epoch) {
        return false;
      }
      _pending = null;
      _busy = false;
      _notice = switch (op.kind) {
        AddressOpKind.create => 'Đã lưu địa chỉ.',
        AddressOpKind.update => 'Đã cập nhật địa chỉ.',
        AddressOpKind.delete => 'Đã xóa địa chỉ.',
        AddressOpKind.setDefault => 'Đã đặt làm địa chỉ mặc định.',
      };
      _noticeSeq++;
      _notify();
      await _reload(epoch);
      return true;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      _busy = false;
      if (failure.outcomeUnknown) {
        _pending = op;
        _writeFailure = failure;
      } else {
        _pending = null;
        _writeFailure = failure;
        if (failure.kind == AuthFailureKind.versionConflict) {
          _conflict = true;
          unawaited(_reload(epoch));
        } else if (failure.code == 'CUSTOMER_ADDRESS_NOT_FOUND') {
          _gone = true;
          unawaited(_reload(epoch));
        }
      }
      _notify();
      return false;
    }
  }

  Future<void> _reload(int epoch) async {
    try {
      final List<DeliveryAddress> list = await api.list();
      if (epoch != _epoch) {
        return;
      }
      _addresses = _ordered(list);
      _load = AddressLoad.ready;
      _loadFailure = null;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return;
      }
      // The write succeeded but the fresh read failed: say so, never pretend the old list is current.
      _loadFailure = failure;
      _load = AddressLoad.failed;
    }
    _notify();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    session?.removeListener(_onSession);
    super.dispose();
  }
}

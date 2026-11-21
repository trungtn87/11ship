import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/session_controller.dart';
import 'm08_models.dart';
import 'm08_source.dart';

// The state of one account's inbox in one app (M08.03 / M08.05). The server is the source of truth: the list is read from it, a read mark is shown only after
// the server confirmed it, the unread count comes from it, and the live sync is a long poll that re-reads from the stored cursor, so nothing is lost when the
// app was in the background. Losing the connection is stated plainly ("Mất kết nối — dữ liệu có thể chưa cập nhật") and never turned into a success.

enum InboxLoad { idle, loading, ready, failed }

typedef Delay = Future<void> Function(Duration duration);

const Duration kLiveWait = Duration(seconds: 20);

class NotificationController extends ChangeNotifier {
  NotificationController({
    required this.session,
    required this.source,
    Delay? delay,
    this.onLiveItems,
  }) : _delay = delay ?? Future<void>.delayed {
    session.addListener(_onSession);
    _userId = session.identity?.userId;
  }

  final SessionController session;
  final NotificationSource source;
  final Delay _delay;

  /// New rows that arrived while the app is open (the host shows a short in-app notice).
  void Function(List<NotificationItem> items)? onLiveItems;

  List<NotificationItem> _items = const <NotificationItem>[];
  InboxLoad _state = InboxLoad.idle;
  bool _unreadOnly = false;
  bool _loadingMore = false;
  int _unread = 0;
  int _latestSeq = 0;
  int? _nextBefore;
  bool _offline = false;
  // The last failure that is NOT a lost connection (a refused or failed answer): shown on its own, with a retry.
  NotificationFailureKind? _failure;
  int _loadSeq = 0;
  bool _live = false;
  // True while the one live loop runs (it may still be inside a long poll after stopLive).
  bool _loopActive = false;
  Duration _backoff = const Duration(seconds: 2);
  int _epoch = 0;
  String? _userId;
  String? _pendingOpen;
  String? _pendingOpenUser;
  bool _disposed = false;

  List<NotificationItem> get items => _items;
  InboxLoad get state => _state;
  bool get unreadOnly => _unreadOnly;
  bool get loadingMore => _loadingMore;
  int get unreadCount => _unread;
  bool get hasMore => _nextBefore != null;

  /// The server could not be reached: what is shown may be out of date.
  bool get offline => _offline;

  /// The kind of the last answer that failed for another reason than a lost connection; null after a successful answer.
  NotificationFailureKind? get failure => _failure;

  /// A tap on a push waits here until the app can route it (signed in, shell on screen).
  String? takePendingOpen() {
    final String? id = _pendingOpen;
    _pendingOpen = null;
    return id;
  }

  void requestOpen(String notificationId, {String? expectedUserId}) {
    _pendingOpen = notificationId;
    _pendingOpenUser = expectedUserId ?? session.identity?.userId ?? _userId;
    _tell();
  }

  bool get hasPendingOpen => _pendingOpen != null;

  void _tell() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  void _onSession() {
    final String? user = session.status == SessionStatus.signedIn
        ? session.identity?.userId
        : null;
    if (user != _userId) {
      // Another account (or none) on this phone: everything of the previous one is dropped at once; nothing is carried over.
      _userId = user;
      final String? pending = _pendingOpen;
      final String? pendingUser = _pendingOpenUser;
      _reset();
      // A push whose open proved the session expired survives the login form,
      // but only for the same account. A different account never inherits it.
      if (pending != null && (user == null || pendingUser == user)) {
        _pendingOpen = pending;
        _pendingOpenUser = pendingUser;
      }
    }
  }

  void _reset() {
    _epoch += 1;
    _items = const <NotificationItem>[];
    _state = InboxLoad.idle;
    _unread = 0;
    _latestSeq = 0;
    _nextBefore = null;
    _offline = false;
    _failure = null;
    _loadSeq += 1;
    _pendingOpen = null;
    _pendingOpenUser = null;
    _live = false;
    _tell();
  }

  bool get _signedIn => session.status == SessionStatus.signedIn;

  /// Reads the first page from the server (also the pull-to-refresh and the reconnect). Rows are keyed by id, so a repeated load never doubles a row.
  Future<void> load() async {
    if (!_signedIn) {
      return;
    }
    final int epoch = _epoch;
    // Only the newest load may write: an older answer that arrives late must not put back rows the person already read.
    final int seq = ++_loadSeq;
    _state = InboxLoad.loading;
    _tell();
    try {
      final NotificationPage page = await source.list(unreadOnly: _unreadOnly);
      if (epoch != _epoch || seq != _loadSeq) {
        return;
      }
      _items = _merge(const <NotificationItem>[], page.items);
      _unread = page.unreadCount;
      _latestSeq = page.latestSeq;
      _nextBefore = page.nextBefore;
      _offline = false;
      _failure = null;
      _state = InboxLoad.ready;
    } on NotificationFailure catch (failure) {
      if (epoch != _epoch || seq != _loadSeq) {
        return;
      }
      _offline = failure.kind == NotificationFailureKind.offline;
      _failure = _offline ? null : failure.kind;
      _state = _items.isEmpty ? InboxLoad.failed : InboxLoad.ready;
    }
    _tell();
  }

  Future<void> loadMore() async {
    final int? before = _nextBefore;
    if (before == null || _loadingMore || !_signedIn) {
      return;
    }
    final int epoch = _epoch;
    _loadingMore = true;
    _tell();
    try {
      final NotificationPage page = await source.list(
        unreadOnly: _unreadOnly,
        before: before,
      );
      if (epoch == _epoch) {
        _items = _merge(_items, page.items);
        _nextBefore = page.nextBefore;
        _offline = false;
      }
    } on NotificationFailure catch (failure) {
      if (epoch == _epoch) {
        _offline = failure.kind == NotificationFailureKind.offline;
      }
    }
    _loadingMore = false;
    _tell();
  }

  Future<void> setUnreadOnly(bool value) async {
    if (_unreadOnly == value) {
      return;
    }
    _unreadOnly = value;
    await load();
  }

  /// The unread count only (the bell), without touching the list.
  Future<void> refreshCount() async {
    if (!_signedIn) {
      return;
    }
    final int epoch = _epoch;
    try {
      final int count = await source.unreadCount();
      if (epoch == _epoch) {
        _unread = count;
        _offline = false;
        _tell();
      }
    } on NotificationFailure catch (failure) {
      if (epoch == _epoch && failure.kind == NotificationFailureKind.offline) {
        _offline = true;
        _tell();
      }
    }
  }

  /// Newest first, one row per id: a newer copy of an id (the collapsed "new orders" card is refreshed in place) replaces the older one.
  List<NotificationItem> _merge(
    List<NotificationItem> current,
    List<NotificationItem> incoming,
  ) {
    final Map<String, NotificationItem> byId = <String, NotificationItem>{
      for (final NotificationItem item in current) item.id: item,
    };
    for (final NotificationItem item in incoming) {
      final NotificationItem? old = byId[item.id];
      if (old == null || item.seq >= old.seq) {
        byId[item.id] = item;
      }
    }
    final List<NotificationItem> merged =
        byId.values
            .where((NotificationItem item) => !_unreadOnly || !item.read)
            .toList()
          ..sort(
            (NotificationItem a, NotificationItem b) => b.seq.compareTo(a.seq),
          );
    return List<NotificationItem>.unmodifiable(merged);
  }

  /// Opens one notification from the inbox: the server marks it read and answers what the CURRENT right and state allow. The mark is shown only after that.
  /// Throws [NotificationFailure] when the server could not be reached; nothing is shown as read then.
  Future<OpenOutcome> open(NotificationItem item) async {
    final OpenOutcome outcome = await source.open(item.id);
    _markLocally(<String>{item.id});
    return outcome;
  }

  /// Same, from a push tap (only the id is known).
  Future<OpenOutcome> openById(String id) async {
    final OpenOutcome outcome = await source.open(id);
    _markLocally(<String>{id});
    unawaited(refreshCount());
    return outcome;
  }

  void _markLocally(Set<String> ids) {
    var changed = 0;
    _items = List<NotificationItem>.unmodifiable(<NotificationItem>[
      for (final NotificationItem item in _items)
        if (ids.contains(item.id) && !item.read)
          () {
            changed += 1;
            return item.copyWith(read: true);
          }()
        else
          item,
    ]);
    if (changed > 0) {
      _unread = (_unread - changed).clamp(0, 1 << 30);
    }
    _tell();
  }

  Future<void> markAllRead() async {
    final int count = await source.markAllRead();
    _items = List<NotificationItem>.unmodifiable(<NotificationItem>[
      for (final NotificationItem item in _items) item.copyWith(read: true),
    ]);
    _unread = count;
    if (_unreadOnly) {
      _items = const <NotificationItem>[];
    }
    _tell();
  }

  // ---- live sync ---------------------------------------------------------------------------------------------------------------

  /// Starts the long poll while the app is open. Safe to call again (it never runs twice).
  void startLive() {
    if (_live || !_signedIn) {
      return;
    }
    _live = true;
    // One loop for the whole life of the controller: a start while the previous long poll is still in flight does not add a second one;
    // that loop reads the current flags on every round and carries on.
    if (!_loopActive) {
      _loopActive = true;
      unawaited(_liveLoop());
    }
  }

  void stopLive() {
    _live = false;
  }

  Future<void> _liveLoop() async {
    try {
      while (_live && !_disposed && _signedIn) {
        await _liveRound();
      }
    } finally {
      _loopActive = false;
    }
  }

  /// One long poll: an answer is merged; a failure is stated, then the loop waits the backoff before it asks again.
  Future<void> _liveRound() async {
    final int epoch = _epoch;
    try {
      final NotificationPage page = await source.changes(
        after: _latestSeq,
        wait: kLiveWait,
      );
      if (!_live || epoch != _epoch) {
        return;
      }
      final bool wasOffline = _offline;
      _offline = false;
      _failure = null;
      _backoff = const Duration(seconds: 2);
      if (page.items.isNotEmpty) {
        final Set<String> known = <String>{
          for (final NotificationItem item in _items)
            if (!item.read) item.id,
        };
        _items = _merge(_items, page.items);
        _latestSeq = page.latestSeq;
        // Only rows that were not already known unread are announced: a refreshed card or a retried event never repeats the notice.
        onLiveItems?.call(<NotificationItem>[
          for (final NotificationItem item in page.items)
            if (!item.read && !known.contains(item.id)) item,
        ]);
      }
      _unread = page.unreadCount;
      if (wasOffline || page.items.isNotEmpty) {
        _tell();
      }
    } on NotificationFailure catch (failure) {
      if (failure.kind == NotificationFailureKind.sessionEnded) {
        _live = false;
        return;
      }
      if (epoch != _epoch) {
        return;
      }
      // The banner follows the LATEST answer: a lost connection states it, any other refusal clears it and is shown as its own error.
      final bool lost = failure.kind == NotificationFailureKind.offline;
      if (lost != _offline || (!lost && _failure != failure.kind)) {
        _offline = lost;
        _failure = lost ? null : failure.kind;
        _tell();
      }
      await _delay(_backoff);
      _backoff = _backoff * 2 > const Duration(seconds: 30)
          ? const Duration(seconds: 30)
          : _backoff * 2;
    }
  }

  /// The app came back to the foreground or the connection returned: read everything again from the server and restart the live sync.
  Future<void> resync() async {
    if (!_signedIn) {
      return;
    }
    await load();
    startLive();
  }

  @override
  void dispose() {
    _disposed = true;
    _live = false;
    session.removeListener(_onSession);
    super.dispose();
  }
}

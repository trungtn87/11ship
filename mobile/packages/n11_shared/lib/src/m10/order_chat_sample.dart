import '../m07/m07_source.dart';
import 'order_chat_models.dart';

// An in-memory chat for the design preview and the tests, always an "illustrative data" source (Dữ liệu minh họa): it keeps what was sent, pages the way the
// server does and can be closed from a test. It never talks to a server. A test may also make it fail (offline, refusal) to see how the screen keeps the text.

class SampleOrderChat extends OrderChatApi {
  SampleOrderChat({List<ChatItem>? items, this.open = true, this.canSend = true, this.role = ChatRole.customer, this.milestonesOf, this.openOf, this.retentionDays, this.expired = false}) : items = items ?? <ChatItem>[];

  /// The typed messages, oldest first (one room: the sample does not tell rooms apart).
  final List<ChatItem> items;
  bool open;
  bool canSend;
  final ChatRole role;

  /// What the sample server tells about retention (null = nothing); [expired] makes every read come back empty.
  int? retentionDays;
  bool expired;

  /// The milestones of a room (the sample order's events in plain words) and whether it is open; null = none / the [open] flag.
  final List<ChatMilestone> Function(String roomId)? milestonesOf;
  final bool Function(String roomId)? openOf;

  List<ChatItem> _feed(String roomId) {
    final List<ChatItem> all = <ChatItem>[...?milestonesOf?.call(roomId), ...items];
    all.sort((ChatItem a, ChatItem b) => a.at.compareTo(b.at) != 0 ? a.at.compareTo(b.at) : (a is ChatMilestone ? 0 : 1) - (b is ChatMilestone ? 0 : 1));
    return all;
  }

  bool _open(String roomId) => openOf?.call(roomId) ?? open;

  /// Messages stored per key: a retry with the same key returns the stored one and writes nothing.
  final Map<String, ChatMessage> _byKey = <String, ChatMessage>{};

  /// The next send fails with this (once), and a read fails while [failReads] is set.
  M07Failure? failNextSend;
  bool failReads = false;
  int sends = 0;
  int reads = 0;
  DateTime Function() now = DateTime.now;

  @override
  bool get isSample => true;

  ChatRoom _room(String roomId) => ChatRoom(id: roomId, open: _open(roomId), canSend: _open(roomId) && canSend, retentionDays: retentionDays, expired: expired);

  @override
  Future<ChatFeed> read(ChatRoomRef room, {String? before, int limit = 30}) async {
    reads += 1;
    if (failReads) {
      throw const M07Failure(M07FailureKind.offline);
    }
    final List<ChatItem> all = expired ? <ChatItem>[] : _feed(room.id);
    final int end = before == null ? all.length : int.parse(before).clamp(0, all.length);
    final int start = end - limit < 0 ? 0 : end - limit;
    return ChatFeed(room: _room(room.id), items: List<ChatItem>.of(all.sublist(start, end)), hasMore: start > 0, nextBefore: start > 0 ? '$start' : null);
  }

  @override
  Future<ChatSent> send(ChatRoomRef room, {required String body, required String key}) async {
    sends += 1;
    final M07Failure? failure = failNextSend;
    if (failure != null) {
      failNextSend = null;
      throw failure;
    }
    final ChatMessage? stored = _byKey[key];
    if (stored != null) {
      return ChatSent(message: stored, room: _room(room.id));
    }
    if (!_open(room.id)) {
      throw const M07Failure(M07FailureKind.refused, code: 'ORDER_CHAT_CLOSED');
    }
    if (!canSend) {
      throw const M07Failure(M07FailureKind.refused, code: 'ORDER_CHAT_NOT_PARTICIPANT');
    }
    final ChatMessage message = ChatMessage(id: 'm${items.length + 1}', at: now(), role: role, senderName: 'Tôi', mine: true, body: body);
    _byKey[key] = message;
    items.add(message);
    return ChatSent(message: message, room: _room(room.id));
  }
}

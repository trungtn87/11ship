// "Trao đổi đơn hàng" (issue #191): the data the chat section draws. Wire contract: apps/backend/src/order-chat. Every field is parsed strictly; a body that is not
// what the contract says is a FormatException (a server failure for the screen), never a half-filled chat. Times are the server's.

/// Which door of the server a chat is read and written through. The identifier is the order (customer, shop) or the delivery (the shop's direct call, the Shipper).
enum ChatDoor { customerOrder, shopOrder, shopDirect, shipperDelivery }

class ChatRoomRef {
  const ChatRoomRef(this.door, this.id);

  final ChatDoor door;
  final String id;

  @override
  bool operator ==(Object other) => other is ChatRoomRef && other.door == door && other.id == id;

  @override
  int get hashCode => Object.hash(door, id);
}

Map<String, Object?> _obj(Object? v) => v is Map<String, Object?> ? v : throw const FormatException('object');
List<Object?> _list(Object? v) => v is List<Object?> ? v : throw const FormatException('list');
String _str(Object? v) => v is String ? v : throw const FormatException('string');
bool _bool(Object? v) => v is bool ? v : throw const FormatException('bool');

class ChatRoom {
  const ChatRoom({required this.id, required this.open, required this.canSend, this.retentionDays, this.expired = false});

  factory ChatRoom.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Object? days = m['retention_days'];
    return ChatRoom(id: _str(m['id']), open: _bool(m['open']), canSend: _bool(m['can_send']), retentionDays: days is int ? days : null, expired: m['expired'] == true);
  }

  /// How many days the history stays readable after the file closes: the server's setting (`chat.retention_days`), never a number of this app. Null = not told.
  final int? retentionDays;

  /// The retention ran out: the server returns no conversation any more.
  final bool expired;

  final String id;

  /// The order (or the direct delivery) has not ended. A closed room is read-only for everybody.
  final bool open;

  /// This person may write now (the room is open AND they still belong to it).
  final bool canSend;
}

enum ChatRole { customer, shop, shipper }

extension ChatRoleText on ChatRole {
  String get label => switch (this) {
        ChatRole.customer => 'Khách',
        ChatRole.shop => 'Quán',
        ChatRole.shipper => 'Shipper',
      };
}

ChatRole _role(Object? v) => switch (_str(v)) {
      'CUSTOMER' => ChatRole.customer,
      'SHOP' => ChatRole.shop,
      'SHIPPER' => ChatRole.shipper,
      _ => throw const FormatException('role'),
    };

/// One line of the feed: a message a person wrote, or a business milestone the system put in the same time line.
sealed class ChatItem {
  const ChatItem({required this.id, required this.at});

  factory ChatItem.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final DateTime at = DateTime.parse(_str(m['at']));
    switch (_str(m['type'])) {
      case 'message':
        final Map<String, Object?> sender = _obj(m['sender']);
        return ChatMessage(id: _str(m['id']), at: at, role: _role(sender['role']), senderName: _str(sender['name']), mine: _bool(sender['mine']), body: _str(m['body']));
      case 'system':
        return ChatMilestone(id: _str(m['id']), at: at, text: _str(m['text']));
    }
    throw const FormatException('chat item');
  }

  final String id;
  final DateTime at;
}

class ChatMessage extends ChatItem {
  const ChatMessage({required super.id, required super.at, required this.role, required this.senderName, required this.mine, required this.body});

  final ChatRole role;
  final String senderName;
  final bool mine;
  final String body;
}

class ChatMilestone extends ChatItem {
  const ChatMilestone({required super.id, required super.at, required this.text});

  final String text;
}

/// One page of the feed, OLDEST first. [nextBefore] is the opaque cursor for the page of older entries (null when there is none).
class ChatFeed {
  const ChatFeed({required this.room, required this.items, required this.hasMore, required this.nextBefore});

  factory ChatFeed.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final Object? next = m['next_before'];
    return ChatFeed(
      room: ChatRoom.fromJson(m['room']),
      items: <ChatItem>[for (final Object? i in _list(m['items'])) ChatItem.fromJson(i)],
      hasMore: _bool(m['has_more']),
      nextBefore: next == null ? null : _str(next),
    );
  }

  final ChatRoom room;
  final List<ChatItem> items;
  final bool hasMore;
  final String? nextBefore;
}

class ChatSent {
  const ChatSent({required this.message, required this.room});

  factory ChatSent.fromJson(Object? raw) {
    final Map<String, Object?> m = _obj(raw);
    final ChatItem message = ChatItem.fromJson(m['message']);
    if (message is! ChatMessage) {
      throw const FormatException('sent message');
    }
    return ChatSent(message: message, room: ChatRoom.fromJson(m['room']));
  }

  final ChatMessage message;
  final ChatRoom room;
}

/// The chat of an order or of a direct delivery (#191). The server decides every right at every call; a source throws [M07Failure] on a refusal or a lost
/// answer, and a send is retried with the SAME key so a lost answer never writes two messages.
abstract class OrderChatApi {
  const OrderChatApi();

  /// True only for illustrative data.
  bool get isSample;

  /// The newest page, or the page of entries older than [before] (the cursor a page gave).
  Future<ChatFeed> read(ChatRoomRef room, {String? before, int limit = 30});
  Future<ChatSent> send(ChatRoomRef room, {required String body, required String key});
}

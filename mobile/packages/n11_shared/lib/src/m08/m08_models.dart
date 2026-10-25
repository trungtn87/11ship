// M08 data of the apps: the inbox rows, the answer of opening one, the account's settings. Parsed strictly from the server's JSON: a body that is not what
// the contract says is a [FormatException], never a half-filled screen. Nothing here invents a value.

enum NotificationCategory { orders, reminders, walletProfile, available }

NotificationCategory _category(String value) => switch (value) {
      'ORDERS' => NotificationCategory.orders,
      'REMINDERS' => NotificationCategory.reminders,
      'WALLET_PROFILE' => NotificationCategory.walletProfile,
      'AVAILABLE' => NotificationCategory.available,
      _ => throw const FormatException('category'),
    };

enum TargetType { order, delivery, walletTxn, profile, deliveryList, complaint, shopPayment, none }

TargetType _target(String value) => switch (value) {
      'ORDER' => TargetType.order,
      'DELIVERY' => TargetType.delivery,
      'WALLET_TXN' => TargetType.walletTxn,
      'PROFILE' => TargetType.profile,
      'DELIVERY_LIST' => TargetType.deliveryList,
      'COMPLAINT' => TargetType.complaint,
      'SHOP_PAYMENT' => TargetType.shopPayment,
      'NONE' => TargetType.none,
      _ => throw const FormatException('target'),
    };

/// Which list a [TargetType.deliveryList] notification opens: the offers a Shipper may take, or the account's own active deliveries.
enum TargetList { offers, active }

class NotificationTarget {
  const NotificationTarget({required this.type, this.id, this.list});

  final TargetType type;
  final String? id;
  final TargetList? list;

  factory NotificationTarget.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('target');
    }
    final Object? type = json['type'];
    final Object? id = json['id'];
    final Object? list = json['list'];
    if (type is! String || (id != null && id is! String)) {
      throw const FormatException('target');
    }
    return NotificationTarget(
      type: _target(type),
      id: id as String?,
      list: list == 'OFFERS' ? TargetList.offers : (list == 'ACTIVE' ? TargetList.active : null),
    );
  }
}

DateTime _time(Object? value) {
  if (value is! String) {
    throw const FormatException('time');
  }
  return DateTime.parse(value).toLocal();
}

class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.seq,
    required this.kind,
    required this.category,
    required this.title,
    required this.body,
    required this.target,
    required this.createdAt,
    required this.read,
    required this.expired,
  });

  final String id;

  /// The server's monotonic cursor of this account's inbox (live sync and paging).
  final int seq;
  final String kind;
  final NotificationCategory category;
  final String title;
  final String body;
  final NotificationTarget target;
  final DateTime createdAt;
  final bool read;

  /// The fact is no longer actionable (an offers card whose search closed, a reminder past its window). The row stays as history.
  final bool expired;

  NotificationItem copyWith({bool? read}) => NotificationItem(
        id: id,
        seq: seq,
        kind: kind,
        category: category,
        title: title,
        body: body,
        target: target,
        createdAt: createdAt,
        read: read ?? this.read,
        expired: expired,
      );

  factory NotificationItem.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('item');
    }
    final Object? id = json['notification_id'];
    final Object? seq = json['seq'];
    final Object? kind = json['kind'];
    final Object? category = json['category'];
    final Object? title = json['title'];
    final Object? body = json['body'];
    final Object? read = json['read'];
    final Object? expired = json['expired'];
    if (id is! String || seq is! int || kind is! String || category is! String || title is! String || body is! String || read is! bool || expired is! bool) {
      throw const FormatException('item');
    }
    return NotificationItem(
      id: id,
      seq: seq,
      kind: kind,
      category: _category(category),
      title: title,
      body: body,
      target: NotificationTarget.fromJson(json['target']),
      createdAt: _time(json['created_at']),
      read: read,
      expired: expired,
    );
  }
}

class NotificationPage {
  const NotificationPage({required this.items, required this.unreadCount, required this.latestSeq, this.nextBefore, required this.serverNow});

  final List<NotificationItem> items;
  final int unreadCount;
  final int latestSeq;
  final int? nextBefore;
  final DateTime serverNow;

  factory NotificationPage.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('page');
    }
    final Object? items = json['items'];
    final Object? unread = json['unread_count'];
    final Object? latest = json['latest_seq'];
    final Object? next = json['next_before'];
    if (items is! List<Object?> || unread is! int || latest is! int || (next != null && next is! int)) {
      throw const FormatException('page');
    }
    return NotificationPage(
      items: <NotificationItem>[for (final Object? item in items) NotificationItem.fromJson(item)],
      unreadCount: unread,
      latestSeq: latest,
      nextBefore: next as int?,
      serverNow: _time(json['server_now']),
    );
  }
}

enum OpenKind {
  /// Open the object.
  ok,

  /// The object has ended: open it as history.
  ended,

  /// The right is gone: nothing about the object is shown.
  noAccess,
}

/// What opening a notification found out NOW (the right and the state are re-checked on every open; the object is then loaded from its own endpoints).
class OpenOutcome {
  const OpenOutcome({required this.kind, this.target, this.deliveryState, required this.expired});

  final OpenKind kind;
  final NotificationTarget? target;
  final String? deliveryState;
  final bool expired;

  factory OpenOutcome.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('open');
    }
    final Object? outcome = json['outcome'];
    final Object? expired = json['expired'];
    final Object? state = json['delivery_state'];
    if (outcome is! String || expired is! bool || (state != null && state is! String)) {
      throw const FormatException('open');
    }
    final OpenKind kind = switch (outcome) {
      'OK' => OpenKind.ok,
      'ENDED' => OpenKind.ended,
      'NO_ACCESS' => OpenKind.noAccess,
      _ => throw const FormatException('outcome'),
    };
    final Object? target = json['target'];
    return OpenOutcome(kind: kind, target: kind == OpenKind.noAccess || target == null ? null : NotificationTarget.fromJson(target), deliveryState: state as String?, expired: expired);
  }
}

class NotificationSettings {
  const NotificationSettings({
    required this.orders,
    required this.reminders,
    required this.walletProfile,
    this.available,
    required this.sound,
    required this.vibrate,
    required this.pushAvailable,
  });

  final bool orders;
  final bool reminders;
  final bool walletProfile;

  /// Shipper app only ("Đơn có thể nhận"); null in the Food app.
  final bool? available;
  final bool sound;
  final bool vibrate;

  /// False when no push can leave the server right now (provider not configured or switched off): the settings screen then says so honestly.
  final bool pushAvailable;

  NotificationSettings copyWith({bool? orders, bool? reminders, bool? walletProfile, bool? available, bool? sound, bool? vibrate}) => NotificationSettings(
        orders: orders ?? this.orders,
        reminders: reminders ?? this.reminders,
        walletProfile: walletProfile ?? this.walletProfile,
        available: available ?? this.available,
        sound: sound ?? this.sound,
        vibrate: vibrate ?? this.vibrate,
        pushAvailable: pushAvailable,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'orders': orders,
        'reminders': reminders,
        'wallet_profile': walletProfile,
        if (available != null) 'available': available,
        'sound': sound,
        'vibrate': vibrate,
      };

  factory NotificationSettings.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('settings');
    }
    bool flag(String key) {
      final Object? value = json[key];
      if (value is! bool) {
        throw const FormatException('settings');
      }
      return value;
    }

    final Object? available = json['available'];
    if (available != null && available is! bool) {
      throw const FormatException('settings');
    }
    return NotificationSettings(
      orders: flag('orders'),
      reminders: flag('reminders'),
      walletProfile: flag('wallet_profile'),
      available: available as bool?,
      sound: flag('sound'),
      vibrate: flag('vibrate'),
      pushAvailable: flag('push_available'),
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';

import '../m07/m07_source.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'order_chat_models.dart';

// "Trao đổi đơn hàng" (issue #191): the chat of one order (or of one direct delivery) with the business milestones in the SAME time line. It replaces the old
// "Diễn biến". The phone decides nothing about rights: whether this person can write is the server's `can_send`, read again on every refresh; a send the
// server refuses is never shown as sent, and the typed text stays for a retry. A lost answer is retried with the SAME key, so it never writes twice.

/// The state of one chat, kept by the screen ABOVE the collapsible card so closing the card never loses the typed text, the pages read or the key of a
/// send in flight. It polls (gently) only while the chat is on screen; the first read happens when the screen opens, so the closed card can say something useful.
class OrderChatController extends ChangeNotifier {
  OrderChatController({required this.api, required this.room, this.refreshEvery = const Duration(seconds: 8), this.pageSize = 30}) {
    unawaited(reload());
  }

  final OrderChatApi api;
  final ChatRoomRef room;
  final Duration refreshEvery;
  final int pageSize;

  List<ChatItem> items = const <ChatItem>[];
  ChatRoom? state;
  bool loading = true;
  M07Failure? failure;
  bool hasMore = false;
  bool loadingOlder = false;
  bool sending = false;
  M07Failure? sendFailure;

  String? _olderCursor;
  String? _pendingBody;
  String? _pendingKey;
  Timer? _timer;
  int _attached = 0;
  bool _disposed = false;

  /// The room is read-only for everybody ("Đơn đã kết thúc"). Unknown (not read yet) counts as open: the composer waits for [canSend].
  bool get ended => state != null && !state!.open;
  bool get canSend => state?.canSend ?? false;

  /// One useful line for the closed card: the newest message, else the newest milestone, else that there is nothing yet.
  String get summary {
    if (loading && items.isEmpty) {
      return 'Đang tải…';
    }
    if (items.isEmpty) {
      return failure != null ? 'Chưa tải được trao đổi' : 'Chưa có tin nhắn';
    }
    final ChatItem last = items.last;
    final String text = switch (last) {
      ChatMessage m => '${m.mine ? 'Bạn' : m.role.label}: ${m.body}',
      ChatMilestone m => m.text,
    };
    return ended ? 'Đã kết thúc · $text' : text;
  }

  int? _seenVersion;

  /// The screen above read its record again: when the order (or delivery) moved on, its milestones did too, so read the feed now instead of waiting for the poll.
  void noteVersion(int version) {
    final int? before = _seenVersion;
    _seenVersion = version;
    if (before != null && before != version) {
      scheduleMicrotask(() => unawaited(reload(quiet: true)));
    }
  }

  /// The chat is on screen: poll while at least one view is attached, and read at once so what the person sees is current.
  void attach() {
    _attached += 1;
    if (_attached == 1) {
      _timer = Timer.periodic(refreshEvery, (Timer _) => unawaited(reload(quiet: true)));
      unawaited(reload(quiet: true));
    }
  }

  void detach() {
    _attached = _attached > 0 ? _attached - 1 : 0;
    if (_attached == 0) {
      _timer?.cancel();
      _timer = null;
    }
  }

  static int _compare(ChatItem a, ChatItem b) {
    final int byTime = a.at.compareTo(b.at);
    if (byTime != 0) {
      return byTime;
    }
    final int ra = a is ChatMilestone ? 0 : 1;
    final int rb = b is ChatMilestone ? 0 : 1;
    return ra != rb ? ra - rb : a.id.compareTo(b.id);
  }

  void _merge(List<ChatItem> incoming) {
    final Map<String, ChatItem> byId = <String, ChatItem>{for (final ChatItem i in items) i.id: i};
    for (final ChatItem i in incoming) {
      byId[i.id] = i;
    }
    items = byId.values.toList()..sort(_compare);
  }

  Future<void> reload({bool quiet = false}) async {
    if (_disposed) {
      return;
    }
    if (!quiet) {
      loading = true;
      notifyListeners();
    }
    try {
      final ChatFeed feed = await api.read(room, limit: pageSize);
      if (_disposed) {
        return;
      }
      final bool first = items.isEmpty && _olderCursor == null;
      _merge(feed.items);
      state = feed.room;
      if (first || _olderCursor == null) {
        hasMore = feed.hasMore;
        _olderCursor = feed.nextBefore;
      }
      failure = null;
    } on M07Failure catch (error) {
      if (_disposed) {
        return;
      }
      failure = error;
    } on Object {
      if (_disposed) {
        return;
      }
      failure = const M07Failure(M07FailureKind.server);
    }
    loading = false;
    notifyListeners();
  }

  Future<void> loadOlder() async {
    final String? cursor = _olderCursor;
    if (loadingOlder || !hasMore || cursor == null || _disposed) {
      return;
    }
    loadingOlder = true;
    notifyListeners();
    try {
      final ChatFeed feed = await api.read(room, before: cursor, limit: pageSize);
      if (_disposed) {
        return;
      }
      _merge(feed.items);
      hasMore = feed.hasMore;
      _olderCursor = feed.nextBefore;
      failure = null;
    } on M07Failure catch (error) {
      if (_disposed) {
        return;
      }
      failure = error;
    } on Object {
      if (_disposed) {
        return;
      }
      failure = const M07Failure(M07FailureKind.server);
    }
    loadingOlder = false;
    notifyListeners();
  }

  /// True when the server stored the message. The same text sent again after a lost answer uses the same key; any other text is a new message.
  Future<bool> send(String raw) async {
    final String body = raw.trim();
    if (sending || body.isEmpty || _disposed) {
      return false;
    }
    final String key = _pendingBody == body && _pendingKey != null ? _pendingKey! : m07NewKey();
    _pendingBody = body;
    _pendingKey = key;
    sending = true;
    sendFailure = null;
    notifyListeners();
    try {
      final ChatSent sent = await api.send(room, body: body, key: key);
      if (_disposed) {
        return true;
      }
      _pendingBody = null;
      _pendingKey = null;
      _merge(<ChatItem>[sent.message]);
      state = sent.room;
      sending = false;
      notifyListeners();
      unawaited(reload(quiet: true));
      return true;
    } on M07Failure catch (error) {
      if (_disposed) {
        return false;
      }
      sendFailure = error;
      if (error.kind != M07FailureKind.offline) {
        // The server answered "no": that key is spent. (A lost answer keeps the key, so the retry cannot write a second message.)
        _pendingBody = null;
        _pendingKey = null;
      }
      sending = false;
      notifyListeners();
      if (error.code == 'ORDER_CHAT_CLOSED' || error.code == 'ORDER_CHAT_NOT_PARTICIPANT') {
        unawaited(reload(quiet: true));
      }
      return false;
    } on Object {
      if (_disposed) {
        return false;
      }
      sendFailure = const M07Failure(M07FailureKind.server);
      sending = false;
      notifyListeners();
      return false;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}

/// "dd/MM HH:mm" when the day is not today, "HH:mm" otherwise.
String chatTime(DateTime t, {DateTime? now}) {
  final DateTime l = t.toLocal();
  final DateTime n = (now ?? DateTime.now()).toLocal();
  final bool today = l.year == n.year && l.month == n.month && l.day == n.day;
  return today ? m07Hm(l) : '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')} ${m07Hm(l)}';
}

/// The body of the "Trao đổi đơn hàng" card: the feed (messages as bubbles, milestones as centred neutral lines), older pages on request and the composer.
class OrderChatPanel extends StatefulWidget {
  const OrderChatPanel({super.key, required this.controller});

  final OrderChatController controller;

  @override
  State<OrderChatPanel> createState() => _OrderChatPanelState();
}

class _OrderChatPanelState extends State<OrderChatPanel> {
  final TextEditingController _text = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.controller.attach();
    widget.controller.addListener(_changed);
  }

  void _changed() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    widget.controller.detach();
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final bool stored = await widget.controller.send(_text.text);
    if (stored && mounted) {
      _text.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final OrderChatController c = widget.controller;
    return Column(
      key: const Key('order-chat'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (c.failure != null && c.items.isEmpty)
          Row(children: <Widget>[const Expanded(child: Text('Chưa tải được trao đổi.', style: N11Text.caption)), TextButton(key: const Key('chat-retry'), onPressed: () => unawaited(c.reload()), child: const Text('Tải lại'))])
        else if (c.loading && c.items.isEmpty)
          const Padding(padding: EdgeInsets.all(N11Space.gap3), child: Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))))
        else ...<Widget>[
          if (c.hasMore) TextButton(key: const Key('chat-older'), onPressed: c.loadingOlder ? null : () => unawaited(c.loadOlder()), child: Text(c.loadingOlder ? 'Đang tải…' : 'Xem tin cũ hơn')),
          if (c.items.whereType<ChatMessage>().isEmpty && !c.ended) const Padding(padding: EdgeInsets.symmetric(vertical: N11Space.gap2), child: Text('Chưa có tin nhắn. Bạn có thể nhắn cho những người cùng tham gia đơn này.', key: Key('chat-empty'), style: N11Text.caption)),
          for (final ChatItem i in c.items) ChatLine(key: ValueKey<String>('chat-${i.id}'), item: i),
        ],
        const SizedBox(height: N11Space.gap2),
        if (c.state?.expired ?? false)
          const ReasonNote('Lịch sử trao đổi đã hết thời hạn lưu trữ.', key: Key('chat-expired'), icon: Icons.lock_outline)
        else if (c.ended) ...<Widget>[
          const ReasonNote('Đơn đã kết thúc. Bạn chỉ có thể xem lại trao đổi.', key: Key('chat-closed'), icon: Icons.lock_outline),
          if (c.state?.retentionDays != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Lịch sử trao đổi được lưu ${c.state!.retentionDays} ngày sau khi đơn kết thúc.', key: const Key('chat-retention'), style: N11Text.caption)),
        ]
        else if (c.state != null && !c.canSend)
          const ReasonNote('Bạn không còn quyền gửi tin trong trao đổi này.', key: Key('chat-readonly'), icon: Icons.lock_outline)
        else if (c.state != null) ...<Widget>[
          if (c.sendFailure != null) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap2), child: M07FailureBanner(key: const Key('chat-send-failed'), failure: c.sendFailure!)),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: TextField(
                  key: const Key('chat-input'),
                  controller: _text,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 500,
                  textInputAction: TextInputAction.newline,
                  decoration: const InputDecoration(hintText: 'Nhắn trong đơn này', counterText: '', isDense: true, border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(width: N11Space.gap2),
              SizedBox(
                width: 48,
                height: 48,
                child: IconButton.filled(
                  key: const Key('chat-send'),
                  tooltip: 'Gửi',
                  style: IconButton.styleFrom(backgroundColor: N11Colors.yellow, foregroundColor: N11Colors.black),
                  onPressed: c.sending ? null : () => unawaited(_send()),
                  icon: c.sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// One line of the feed. A message is a bubble (mine on the right, the others on the left with their name and role); a milestone is a short neutral line in
/// the middle. Text is drawn as plain text: nothing a person types is interpreted.
class ChatLine extends StatelessWidget {
  const ChatLine({super.key, required this.item});

  final ChatItem item;

  @override
  Widget build(BuildContext context) {
    final ChatItem i = item;
    if (i is ChatMilestone) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 4),
            decoration: BoxDecoration(color: N11Colors.chipSoon, borderRadius: BorderRadius.circular(kRadiusControl)),
            child: Text('${chatTime(i.at)} · ${i.text}', textAlign: TextAlign.center, style: N11Text.caption),
          ),
        ),
      );
    }
    final ChatMessage m = i as ChatMessage;
    final Alignment align = m.mine ? Alignment.centerRight : Alignment.centerLeft;
    return Align(
      alignment: align,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: N11Space.gap2),
          decoration: BoxDecoration(color: m.mine ? N11Colors.yellowSoft : N11Colors.bg, borderRadius: BorderRadius.circular(kRadiusControl)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(m.mine ? 'Bạn' : '${m.senderName} · ${m.role.label}', style: N11Text.caption.copyWith(fontWeight: FontWeight.w700)),
              Text(m.body, style: N11Text.body),
              Align(alignment: Alignment.centerRight, child: Text(chatTime(m.at), style: N11Text.caption.copyWith(fontSize: 11))),
            ],
          ),
        ),
      ),
    );
  }
}

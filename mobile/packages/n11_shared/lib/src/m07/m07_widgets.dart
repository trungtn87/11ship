import 'dart:async';

import 'package:flutter/material.dart';

import '../account/api_client.dart';
import '../tokens.dart';
import '../wallet/wallet_models.dart';
import '../widgets/components.dart';
import 'm07_models.dart';
import 'm07_source.dart';

// Shared pieces of the M07 screens: the loader with its loading / empty / error / offline states, the action helper (one operation key per
// intent, a busy lock, conflict -> reload), the search timer, the position card (never drawn as live when it is old), and the
// reason dialog ("Quay lại" never "Hủy" to close a pop-up).

/// Under a finished delivery: the host app puts the rating and complaint entries here (M11). Null = nothing is shown.
typedef M07FeedbackSlot = Widget Function(BuildContext context, DeliveryView delivery);

const String kM07SampleLabel = 'Dữ liệu minh họa';
const String kFeeUnknown = 'Chưa xác định phí';

/// "Dữ liệu minh họa" banner of every screen fed by sample data.
class M07SampleBanner extends StatelessWidget {
  const M07SampleBanner({super.key});

  @override
  Widget build(BuildContext context) => const N11Banner(
        key: Key('m07-sample-banner'),
        kind: BannerKind.warn,
        title: kM07SampleLabel,
        text: 'Chỉ để xem giao diện. Không có đơn nào được tạo hay nhận.',
        icon: Icons.visibility_outlined,
      );
}

String m07Vnd(int? amount) => amount == null ? kFeeUnknown : formatWalletVnd(amount);

String m07Hm(DateTime t) {
  final DateTime local = t.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String _dayOf(DateTime t) => '${t.day.toString().padLeft(2, '0')}/${t.month.toString().padLeft(2, '0')}';

/// "Diễn biến": the milestones that happened, oldest first, one line each — time first ("18:24 · Đang tìm shipper"); the date is added only when the story
/// runs over more than one day. Draws nothing for an empty story. One widget for the order of 11Food (shop and customer), the direct delivery and 11Ship.
class StoryCard extends StatelessWidget {
  const StoryCard(this.entries, {super.key});

  final List<StoryEntry> entries;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const SizedBox.shrink();
    }
    final List<StoryEntry> ordered = <StoryEntry>[...entries]..sort((StoryEntry a, StoryEntry b) => a.at.compareTo(b.at));
    final bool manyDays = ordered.map((StoryEntry e) => _dayOf(e.at.toLocal())).toSet().length > 1;
    return N11Card(
      key: const Key('m07-story'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Diễn biến', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          for (final StoryEntry e in ordered)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SizedBox(width: manyDays ? 88 : 48, child: Text(manyDays ? '${_dayOf(e.at.toLocal())} ${m07Hm(e.at)}' : m07Hm(e.at), style: N11Text.caption)),
                  Expanded(child: Text(e.text, style: N11Text.body)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

String m07Km(int? meters) {
  if (meters == null) {
    return 'Chưa rõ';
  }
  final String v = (meters / 1000).toStringAsFixed(1).replaceAll('.', ',');
  return '${v.endsWith(',0') ? v.substring(0, v.length - 2) : v} km';
}

String m07Countdown(Duration d) {
  final int total = d.inSeconds < 0 ? 0 : d.inSeconds;
  return '${(total ~/ 60).toString().padLeft(2, '0')}:${(total % 60).toString().padLeft(2, '0')}';
}

String m07Ago(int seconds) {
  if (seconds < 60) {
    return 'vừa xong';
  }
  if (seconds < 3600) {
    return '${seconds ~/ 60} phút trước';
  }
  return '${seconds ~/ 3600} giờ trước';
}

/// A new UUID per intent; the same one is reused while the intent is being retried.
String m07NewKey() => newIdempotencyKey();

({String label, ChipKind kind}) m07StateChip(DeliveryState state) => switch (state) {
      DeliveryState.waitingDriver => (label: state.label, kind: ChipKind.warn),
      DeliveryState.accepted || DeliveryState.locationConfirmed => (label: state.label, kind: ChipKind.info),
      DeliveryState.pickedUp || DeliveryState.delivering => (label: state.label, kind: ChipKind.yellow),
      DeliveryState.completed => (label: state.label, kind: ChipKind.ok),
      DeliveryState.failed => (label: state.label, kind: ChipKind.bad),
      DeliveryState.cancelledByMerchant || DeliveryState.cancelledBySystem => (label: state.label, kind: ChipKind.neutral),
      DeliveryState.searchStopped => (label: state.label, kind: ChipKind.warn),
    };

/// A shop delivery that needs a person: the search stopped, a counter-offer waits, or the goods are not settled.
bool m07NeedsAttention(DeliveryView d) =>
    d.state == DeliveryState.searchStopped ||
    (d.fee.agreement?.state == 'COUNTERED' && d.state.isActive) ||
    (d.fee.status == 'AWAITING_CUSTOMER' && d.state.isActive) ||
    (d.incident?.isOpen ?? false);

// ---- loader ----------------------------------------------------------------------------------------------------------

/// One read with its states. While [refreshEvery] is set the value is refreshed quietly: a failed refresh keeps the old value and says it
/// is old ("Mất kết nối"), it never blanks the screen.
class M07Fetcher<T> extends ChangeNotifier {
  M07Fetcher(this._load, {Duration? refreshEvery}) {
    unawaited(reload());
    if (refreshEvery != null) {
      _timer = Timer.periodic(refreshEvery, (Timer _) => unawaited(reload(quiet: true)));
    }
  }

  final Future<T> Function() _load;
  T? value;
  M07Failure? failure;
  DateTime? loadedAt;
  bool loading = true;
  Timer? _timer;
  bool _disposed = false;

  Future<void> reload({bool quiet = false}) async {
    if (!quiet && !_disposed) {
      loading = true;
      notifyListeners();
    }
    try {
      final T next = await _load();
      if (_disposed) {
        return;
      }
      value = next;
      failure = null;
      loadedAt = DateTime.now();
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

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}

/// The states around a value: loading, failed (nothing to show), or the value with a "stale" banner when a refresh failed.
Widget m07Fetched<T>(BuildContext context, M07Fetcher<T> f, String keyPrefix, Widget Function(T value) onValue) {
  final T? value = f.value;
  final M07Failure? failure = f.failure;
  if (value == null) {
    if (failure != null) {
      return M07FailureBanner(key: Key('$keyPrefix-failed'), failure: failure, onRetry: f.reload);
    }
    return Padding(key: Key('$keyPrefix-loading'), padding: const EdgeInsets.all(N11Space.gap8), child: const Center(child: CircularProgressIndicator()));
  }
  final Widget body = onValue(value);
  if (failure == null && !f.loading) {
    return body;
  }
  return Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: <Widget>[
      if (failure != null)
        Padding(
          padding: const EdgeInsets.only(bottom: N11Space.gap3),
          child: N11Banner(
            key: Key('$keyPrefix-stale'),
            kind: BannerKind.warn,
            title: failure.kind == M07FailureKind.offline ? 'Mất kết nối' : 'Chưa cập nhật được',
            text: 'Đang hiển thị dữ liệu lúc ${m07Hm(f.loadedAt ?? DateTime.now())}. ${failure.message}',
            icon: Icons.cloud_off_outlined,
            trailing: N11Button(key: Key('$keyPrefix-stale-retry'), label: 'Thử lại', compact: true, onPressed: () => unawaited(f.reload())),
          ),
        ),
      if (f.loading && failure == null) const Padding(padding: EdgeInsets.only(bottom: N11Space.gap3), child: LinearProgressIndicator()),
      body,
    ],
  );
}

/// Loads one read and draws loading / empty / failed / offline itself; [builder] draws the value.
class M07Loader<T> extends StatefulWidget {
  const M07Loader({super.key, required this.load, required this.builder, required this.keyPrefix, this.refreshEvery, this.isEmpty, this.emptyIcon = Icons.inbox_outlined, this.emptyTitle = 'Chưa có dữ liệu', this.emptyText = ''});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T value, Future<void> Function() reload) builder;
  final String keyPrefix;
  final Duration? refreshEvery;
  final bool Function(T value)? isEmpty;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptyText;

  @override
  State<M07Loader<T>> createState() => _M07LoaderState<T>();
}

class _M07LoaderState<T> extends State<M07Loader<T>> {
  late final M07Fetcher<T> _fetcher = M07Fetcher<T>(widget.load, refreshEvery: widget.refreshEvery)..addListener(_changed);

  void _changed() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _fetcher.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return m07Fetched<T>(
      context,
      _fetcher,
      widget.keyPrefix,
      (T value) => (widget.isEmpty?.call(value) ?? false)
          ? EmptyState(key: Key('${widget.keyPrefix}-empty'), icon: widget.emptyIcon, title: widget.emptyTitle, text: widget.emptyText)
          : widget.builder(context, value, _fetcher.reload),
    );
  }
}

/// What a detail page draws once its value is known: the scrolling body and an optional action bar pinned at the bottom.
class M07PageParts {
  const M07PageParts(this.body, {this.bottom});

  final List<Widget> body;
  final Widget? bottom;
}

/// A full page whose content comes from one refreshing read. While the value is not known the page shows loading / failure; the pinned
/// bottom bar exists only for a loaded value.
class M07DetailPage<T> extends StatefulWidget {
  const M07DetailPage({super.key, required this.title, required this.sample, required this.keyPrefix, required this.load, required this.builder, this.refreshEvery = const Duration(seconds: 10)});

  final String title;
  final bool sample;
  final String keyPrefix;
  final Future<T> Function() load;
  final M07PageParts Function(BuildContext context, T value, Future<void> Function() reload) builder;
  final Duration? refreshEvery;

  @override
  State<M07DetailPage<T>> createState() => M07DetailPageState<T>();
}

class M07DetailPageState<T> extends State<M07DetailPage<T>> {
  late final M07Fetcher<T> fetcher = M07Fetcher<T>(widget.load, refreshEvery: widget.refreshEvery)..addListener(_changed);

  void _changed() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    fetcher.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final T? value = fetcher.value;
    final M07PageParts? parts = value == null ? null : widget.builder(context, value, fetcher.reload);
    return m07Page(
      widget.title,
      widget.sample,
      <Widget>[
        m07Fetched<T>(
          context,
          fetcher,
          widget.keyPrefix,
          (T v) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[for (final Widget w in parts!.body) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap3), child: w)]),
        ),
      ],
      bottom: parts?.bottom,
    );
  }
}

class M07FailureBanner extends StatelessWidget {
  const M07FailureBanner({super.key, required this.failure, this.onRetry});

  final M07Failure failure;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    final bool offline = failure.kind == M07FailureKind.offline;
    return N11Banner(
      kind: failure.kind == M07FailureKind.notReady ? BannerKind.warn : BannerKind.error,
      title: offline ? 'Mất kết nối' : (failure.kind == M07FailureKind.conflict ? 'Dữ liệu đã thay đổi' : 'Chưa hoàn tất'),
      text: failure.message,
      icon: offline ? Icons.cloud_off_outlined : Icons.error_outline,
      trailing: onRetry == null || failure.kind == M07FailureKind.notReady || failure.kind == M07FailureKind.sessionEnded
          ? null
          : N11Button(key: const Key('m07-retry'), label: failure.kind == M07FailureKind.conflict ? 'Tải lại' : 'Thử lại', compact: true, onPressed: () => unawaited(onRetry!())),
    );
  }
}

// ---- actions ---------------------------------------------------------------------------------------------------------

/// Busy lock + one operation key per intent for a screen that sends commands. A retry of the same intent reuses its key (so a lost answer
/// is replayed, never doubled); the key is dropped when the server answered.
mixin M07Actions<T extends StatefulWidget> on State<T> {
  bool busy = false;
  M07Failure? actionFailure;
  final Map<String, String> _keys = <String, String>{};

  String keyFor(String intent) => _keys.putIfAbsent(intent, m07NewKey);

  /// Runs [body]; true when it succeeded. A failure is kept in [actionFailure] (draw it with [actionBanner]) and the key is kept for a retry
  /// when the outcome is unknown. On a conflict [onConflict] reloads the screen.
  Future<bool> act(String intent, Future<void> Function(String key) body, {Future<void> Function()? onConflict}) async {
    if (busy) {
      return false;
    }
    setState(() {
      busy = true;
      actionFailure = null;
    });
    try {
      await body(keyFor(intent));
      _keys.remove(intent);
      if (mounted) {
        setState(() => busy = false);
      }
      return true;
    } on M07Failure catch (failure) {
      if (failure.kind != M07FailureKind.offline) {
        _keys.remove(intent);
      }
      if (mounted) {
        setState(() {
          busy = false;
          actionFailure = failure;
        });
      }
      if (failure.kind == M07FailureKind.conflict && onConflict != null) {
        await onConflict();
      }
      return false;
    } on Object {
      if (mounted) {
        setState(() {
          busy = false;
          actionFailure = const M07Failure(M07FailureKind.server);
        });
      }
      return false;
    }
  }

  Widget actionBanner() => actionFailure == null ? const SizedBox.shrink() : M07FailureBanner(key: const Key('m07-action-failed'), failure: actionFailure!);
}

// ---- dialogs ---------------------------------------------------------------------------------------------------------

/// A pop-up with a reason field. Closing it never reads "Hủy": it is "Quay lại" (back) and the confirming button names the action.
Future<String?> showReasonDialog(
  BuildContext context, {
  required String title,
  required String explanation,
  required String confirmLabel,
  String reasonLabel = 'Lý do',
  bool danger = true,
}) {
  return showDialog<String>(
    context: context,
    builder: (BuildContext dialogContext) => _ReasonDialog(title: title, explanation: explanation, confirmLabel: confirmLabel, reasonLabel: reasonLabel, danger: danger),
  );
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.explanation, required this.confirmLabel, required this.reasonLabel, required this.danger});

  final String title;
  final String explanation;
  final String confirmLabel;
  final String reasonLabel;
  final bool danger;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final TextEditingController _reason = TextEditingController();
  final GlobalKey<FormState> _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool ready = _reason.text.trim().isNotEmpty;
    return Form(key: _form, child: AlertDialog(
      key: const Key('m07-reason-dialog'),
      title: Text(widget.title, style: N11Text.h2),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(widget.explanation, style: N11Text.lead),
            const SizedBox(height: N11Space.gap3),
            N11Field(requiredInput: true, fieldKey: const Key('m07-reason-field'), label: widget.reasonLabel, controller: _reason, maxLength: 200, onChanged: () => setState(() {})),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(key: const Key('m07-reason-back'), onPressed: () => Navigator.of(context).pop(), child: const Text('Quay lại')),
        TextButton(
          key: const Key('m07-reason-confirm'),
          onPressed: () { if (_form.currentState!.validate()) Navigator.of(context).pop(_reason.text.trim()); },
          child: Text(widget.confirmLabel, style: TextStyle(fontWeight: FontWeight.w700, color: ready ? (widget.danger ? N11Colors.error : N11Colors.black) : N11Colors.ink3)),
        ),
      ],
    ));
  }
}

/// A short yes/no pop-up (no reason field).
Future<bool> showConfirmDialog(BuildContext context, {required String title, required Widget content, required String confirmLabel}) async {
  final bool? yes = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      key: const Key('m07-confirm-dialog'),
      title: Text(title, style: N11Text.h2),
      content: SingleChildScrollView(child: content),
      actions: <Widget>[
        TextButton(key: const Key('m07-confirm-back'), onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Quay lại')),
        TextButton(key: const Key('m07-confirm-yes'), onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(confirmLabel, style: const TextStyle(fontWeight: FontWeight.w700))),
      ],
    ),
  );
  return yes ?? false;
}

// ---- cards -----------------------------------------------------------------------------------------------------------

class KeyValueRows extends StatelessWidget {
  const KeyValueRows(this.rows, {super.key});

  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        for (final (String label, String value) in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(flex: 4, child: Text(label, style: N11Text.caption)),
                Expanded(flex: 6, child: Text(value, textAlign: TextAlign.right, style: N11Text.bodyStrong)),
              ],
            ),
          ),
      ],
    );
  }
}

/// Server-clock countdown of the search with the 5 / 15 / 30 minute marks.
class SearchTimerCard extends StatefulWidget {
  const SearchTimerCard({super.key, required this.search});

  final SearchView search;

  @override
  State<SearchTimerCard> createState() => _SearchTimerCardState();
}

class _SearchTimerCardState extends State<SearchTimerCard> {
  Timer? _tick;
  late DateTime _shownAt;

  @override
  void initState() {
    super.initState();
    _shownAt = DateTime.now();
    _tick = Timer.periodic(const Duration(seconds: 1), (Timer _) {
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void didUpdateWidget(SearchTimerCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.search.serverNow != widget.search.serverNow) {
      _shownAt = DateTime.now();
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Server time at the moment of the answer plus the time since it arrived: the phone clock is only a stopwatch.
    final DateTime now = widget.search.serverNow.add(DateTime.now().difference(_shownAt));
    final Duration remaining = widget.search.expiresAt.difference(now);
    final int elapsed = now.difference(widget.search.startedAt).inMinutes;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Thời gian tìm shipper', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          Text(m07Countdown(remaining), key: const Key('m07-countdown'), style: N11Text.title),
          const SizedBox(height: N11Space.gap2),
          Text('Đã tìm $elapsed phút · tự ngừng tìm sau 30 phút', style: N11Text.caption),
          const SizedBox(height: N11Space.gap3),
          Wrap(
            spacing: N11Space.gap2,
            runSpacing: N11Space.gap2,
            children: <Widget>[
              for (final int mark in <int>[5, 15, 30]) N11Chip('$mark phút', kind: elapsed >= mark ? ChipKind.warn : ChipKind.neutral),
            ],
          ),
        ],
      ),
    );
  }
}

class M07MapPin {
  const M07MapPin({required this.lat, required this.lng, required this.label, this.color = 0xFFD8AD18});

  final double lat;
  final double lng;
  final String label;
  final int color;
}

/// How an app draws a map (11Ship supplies the M14 map; an app without one gets the coordinate fallback).
typedef M07MapBuilder = Widget Function(BuildContext context, List<M07MapPin> pins);

/// How an app lets a person pin a point: calls [onPick] with the chosen position. Null builder = no map in this app.
typedef M07PinPickerBuilder = Widget Function(BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng});

({String label, ChipKind kind}) _freshnessChip(Freshness f) => switch (f) {
      Freshness.live => (label: 'Trực tiếp', kind: ChipKind.ok),
      Freshness.stale => (label: 'Vị trí cũ', kind: ChipKind.warn),
      Freshness.lost => (label: 'Mất kết nối vị trí', kind: ChipKind.bad),
    };

/// The latest known position with the time it was recorded. Old or lost positions are labelled, never presented as live.
class LocationCard extends StatelessWidget {
  const LocationCard({super.key, required this.location, this.mapBuilder, this.pins = const <M07MapPin>[], this.who = 'Shipper'});

  final LocationView? location;
  final M07MapBuilder? mapBuilder;
  final List<M07MapPin> pins;
  final String who;

  @override
  Widget build(BuildContext context) {
    final LocationView? loc = location;
    if (loc == null) {
      return const N11Card(
        key: Key('m07-location-none'),
        child: ReasonNote('Chưa có vị trí của shipper. Vị trí chỉ hiện khi shipper đang giữ đơn và đã chia sẻ vị trí.'),
      );
    }
    final ({String label, ChipKind kind}) chip = _freshnessChip(loc.freshness);
    final List<M07MapPin> all = <M07MapPin>[M07MapPin(lat: loc.lat, lng: loc.lng, label: who, color: 0xFF2A2A2E), ...pins];
    return N11Card(
      key: const Key('m07-location-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: Text('Vị trí $who', style: N11Text.label)),
              N11Chip(chip.label, kind: chip.kind),
            ],
          ),
          const SizedBox(height: N11Space.gap2),
          if (mapBuilder != null) SizedBox(height: 200, child: ClipRRect(borderRadius: BorderRadius.circular(kRadiusControl), child: mapBuilder!(context, all)))
          else Text('${loc.lat.toStringAsFixed(5)}, ${loc.lng.toStringAsFixed(5)}', style: N11Text.body),
          const SizedBox(height: N11Space.gap2),
          Text('Cập nhật lúc ${m07Hm(loc.recordedAt)} · ${m07Ago(loc.ageSeconds)}', key: const Key('m07-location-time'), style: N11Text.caption),
          if (loc.freshness != Freshness.live) ReasonNote(loc.freshness == Freshness.lost ? 'Đã lâu không nhận được vị trí. Đây không phải vị trí trực tiếp.' : 'Vị trí đã cũ. Có thể shipper đã di chuyển.'),
        ],
      ),
    );
  }
}

/// The money of a delivery in one place: the value of the goods, the delivery fee and who pays it. The app does not manage payment of the dishes, so
/// it shows no "paid" / "still to collect" lines (Owner decision 2026-10-23).
class MoneySummary extends StatelessWidget {
  const MoneySummary({super.key, required this.goods, required this.fee});

  final GoodsView goods;
  final FeeView fee;

  @override
  Widget build(BuildContext context) {
    return N11Card(
      key: const Key('m07-money'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Tiền hàng và phí giao', style: N11Text.label),
          KeyValueRows(<(String, String)>[
            ('Giá trị hàng', m07Vnd(goods.valueVnd)),
            ('Phí giao', fee.amountVnd == null ? kFeeUnknown : m07Vnd(fee.amountVnd)),
            if (fee.estimated) ('Cách tính phí', 'Ước tính theo mốc, không phải quãng đường đo trên bản đồ'),
            ('Người trả phí', fee.payerText),
          ]),
        ],
      ),
    );
  }
}

Widget m07Page(String title, bool sample, List<Widget> children, {Widget? bottom}) => _M07Scaffold(title: title, sample: sample, bottom: bottom, children: children);

/// Scaffold with the primary action pinned at the bottom (the keyboard never covers it).
class _M07Scaffold extends StatelessWidget {
  const _M07Scaffold({required this.title, required this.sample, required this.children, this.bottom});

  final String title;
  final bool sample;
  final List<Widget> children;
  final Widget? bottom;

  @override
  Widget build(BuildContext context) {
    return Form(child: Scaffold(
      backgroundColor: N11Colors.bg,
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            N11AppBar(title: title, onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap6),
                child: vstack(<Widget>[if (sample) const M07SampleBanner(), ...children]),
              ),
            ),
            if (bottom != null)
              Container(
                padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap3, N11Space.pad, N11Space.gap3),
                decoration: const BoxDecoration(color: N11Colors.white, border: Border(top: BorderSide(color: N11Colors.line))),
                child: bottom,
              ),
          ],
        ),
      ),
    ));
  }
}

/// A red-outlined button for a cancelling action (the design: cancel is outlined red, success is yellow).
class DangerButton extends StatelessWidget {
  const DangerButton({super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: kControlHeight,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          side: BorderSide(color: onPressed == null ? N11Colors.line : N11Colors.error, width: 1.5),
          foregroundColor: N11Colors.error,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusControl)),
        ),
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
      ),
    );
  }
}

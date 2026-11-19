import 'package:flutter/material.dart';

import '../tokens.dart';
import '../widgets/components.dart';
import 'm02_format.dart';
import 'm02_widgets.dart';
import 'shop_revenue_data.dart';

// Doanh thu quán (issue #391): the owner's dish value from completed orders, over a Vietnam period. Layout from the approved mockup (reference only). Every
// number is the server's; "Giá trị món" is not money received, so the screen never calls it "thực nhận".

const String kRevenueWhatIsCounted = 'Giá trị món là tổng tiền món của các đơn đã hoàn tất của quán trong kỳ, theo giá đã chốt của đơn. '
    'Con số này chưa phải tiền đã thu: chưa gồm phí giao, tip, COD và chưa trừ hoàn tiền. '
    'Đơn hủy, bị từ chối hoặc chưa hoàn tất không được tính. Bình quân/đơn = giá trị món ÷ số đơn hoàn tất. Kỳ tính theo giờ Việt Nam.';

class ShopRevenueScreen extends StatefulWidget {
  const ShopRevenueScreen({super.key, required this.source, this.openOrder, this.now});

  final RevenueSource source;

  /// Opens the existing order detail for a row ("chạm xem đơn"). Null = rows are not tappable.
  final Future<void> Function(String orderId)? openOrder;

  /// Test hook for the clock; the app uses the device clock (in UTC).
  final DateTime Function()? now;

  @override
  State<ShopRevenueScreen> createState() => _ShopRevenueScreenState();
}

class _ShopRevenueScreenState extends State<ShopRevenueScreen> {
  RevenuePreset _preset = RevenuePreset.last7;
  RevenuePeriod? _custom;
  RevenueLoad<RevenueSummary> _summary = const RevenueLoading<RevenueSummary>();
  final List<RevenueOrder> _orders = <RevenueOrder>[];
  String? _nextCursor;
  RevenueLoad<RevenueOrdersPage>? _ordersState;
  bool _loadingMore = false;
  int? _selected;
  int _request = 0;

  DateTime get _nowUtc => widget.now?.call() ?? DateTime.now().toUtc();

  RevenuePeriod get _period => _preset == RevenuePreset.custom && _custom != null ? _custom! : RevenuePeriod.forPreset(_preset, _nowUtc);

  @override
  void initState() {
    super.initState();
    _fetch(initial: true);
  }

  Future<void> _fetch({bool initial = false}) async {
    final int mine = ++_request;
    final RevenuePeriod period = _period;
    if (!initial) {
      setState(() {
        _summary = const RevenueLoading<RevenueSummary>();
        _orders.clear();
        _nextCursor = null;
        _ordersState = null;
        _selected = null;
      });
    }
    final RevenueLoad<RevenueSummary> summary = await _safely(() => widget.source.summary(period), const RevenueFailed<RevenueSummary>('Chưa tải được doanh thu. Kiểm tra mạng rồi thử lại.'));
    final RevenueLoad<RevenueOrdersPage> page = await _safely(() => widget.source.orders(period), const RevenueFailed<RevenueOrdersPage>('Chưa tải được đơn. Kiểm tra mạng rồi thử lại.'));
    // A slower answer of an older filter never overwrites the newer one.
    if (!mounted || mine != _request) {
      return;
    }
    setState(() {
      _summary = summary;
      _ordersState = page;
      if (page is RevenueReady<RevenueOrdersPage>) {
        _orders.addAll(page.value.items);
        _nextCursor = page.value.nextCursor;
      }
    });
  }

  Future<void> _loadMore() async {
    final String? cursor = _nextCursor;
    if (cursor == null || _loadingMore) {
      return;
    }
    final int mine = _request;
    setState(() => _loadingMore = true);
    final RevenueLoad<RevenueOrdersPage> page = await _safely(() => widget.source.orders(_period, cursor: cursor), const RevenueFailed<RevenueOrdersPage>('Chưa tải được đơn. Kiểm tra mạng rồi thử lại.'));
    if (!mounted || mine != _request) {
      return;
    }
    setState(() {
      _loadingMore = false;
      if (page is RevenueReady<RevenueOrdersPage>) {
        _orders.addAll(page.value.items);
        _nextCursor = page.value.nextCursor;
      } else {
        _ordersState = page;
      }
    });
  }

  Future<T> _safely<T>(Future<T> Function() work, T failed) async {
    try {
      return await work();
    } on Object {
      return failed;
    }
  }

  void _choose(RevenuePreset preset) {
    if (preset == _preset && preset != RevenuePreset.custom) {
      return;
    }
    setState(() => _preset = preset);
    _fetch();
  }

  Future<void> _pickCustom() async {
    final DateTime today = revenueVnDay(_nowUtc);
    final DateTimeRange? picked = await showDateRangePicker(
      context: context,
      firstDate: today.subtract(const Duration(days: 366)),
      lastDate: today,
      initialDateRange: DateTimeRange(start: _period.from, end: _period.to),
      helpText: 'Chọn khoảng ngày (tối đa $kRevenueMaxDays ngày)',
    );
    if (picked == null || !mounted) {
      return;
    }
    final RevenuePeriod chosen = RevenuePeriod(from: DateTime(picked.start.year, picked.start.month, picked.start.day), to: DateTime(picked.end.year, picked.end.month, picked.end.day));
    if (!chosen.isValid) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text('Khoảng tối đa $kRevenueMaxDays ngày. Hãy chọn lại.')));
      return;
    }
    setState(() {
      _custom = chosen;
      _preset = RevenuePreset.custom;
    });
    _fetch();
  }

  void _explain() {
    showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        key: const Key('revenue-explain-dialog'),
        title: const Text('Cách tính doanh thu'),
        content: const Text(kRevenueWhatIsCounted, style: N11Text.body),
        actions: <Widget>[TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Đã hiểu'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final RevenueLoad<RevenueSummary> load = _summary;
    final RevenueSummary? summary = load is RevenueReady<RevenueSummary> ? load.value : null;
    return M02Scaffold(
      title: 'Doanh thu quán',
      content: <Widget>[
        _filters(),
        _summaryCard(summary, load),
        _chartCard(summary, load),
        _ordersCard(),
      ],
    );
  }

  Widget _filters() {
    N11Button preset(RevenuePreset value, String label, Key key) => N11Button(
          key: key,
          label: label,
          compact: true,
          kind: _preset == value ? ButtonKind.primary : ButtonKind.secondary,
          onPressed: () => _choose(value),
        );
    return Wrap(
      spacing: N11Space.gap2,
      runSpacing: N11Space.gap2,
      children: <Widget>[
        preset(RevenuePreset.today, 'Hôm nay', const Key('revenue-filter-today')),
        preset(RevenuePreset.last7, '7 ngày', const Key('revenue-filter-7')),
        preset(RevenuePreset.last30, '30 ngày', const Key('revenue-filter-30')),
        N11Button(
          key: const Key('revenue-filter-custom'),
          label: _preset == RevenuePreset.custom ? '${revenueShortDay(_period.from)} – ${revenueShortDay(_period.to)}' : 'Chọn khoảng',
          compact: true,
          kind: _preset == RevenuePreset.custom ? ButtonKind.primary : ButtonKind.secondary,
          onPressed: _pickCustom,
        ),
      ],
    );
  }

  Widget _summaryCard(RevenueSummary? summary, RevenueLoad<RevenueSummary> load) {
    final bool loading = load is RevenueLoading<RevenueSummary>;
    String money(int? value) => loading ? 'Đang tải…' : (value == null ? kRevenueUnknownText : formatVnd(value));
    return N11Card(
      key: const Key('revenue-summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[
            const Icon(Icons.bar_chart_outlined, color: N11Colors.ink2),
            const SizedBox(width: N11Space.gap2),
            Expanded(child: Text('Giá trị món từ đơn hoàn tất', style: N11Text.h2)),
            IconButton(key: const Key('revenue-info'), tooltip: 'Cách tính doanh thu', icon: const Icon(Icons.info_outline, color: N11Colors.ink2), onPressed: _explain),
          ]),
          Text('${revenueViewDay(_period.from)} – ${revenueViewDay(_period.to)} · ${_period.days} ngày', key: const Key('revenue-period'), style: N11Text.caption),
          const SizedBox(height: N11Space.gap2),
          Text(money(summary?.itemsVnd), key: const Key('revenue-total'), style: N11Text.title),
          const Text('Chưa phải tiền đã thu. Không gồm phí giao, tip hay COD.', style: N11Text.caption),
          const SizedBox(height: N11Space.gap3),
          Row(children: <Widget>[
            Expanded(child: _stat('Số đơn hoàn tất', summary == null ? money(null) : '${summary.completed}', 'revenue-count')),
            Expanded(child: _stat('Bình quân/đơn', summary == null ? money(null) : (summary.averageVnd == null ? '—' : formatVnd(summary.averageVnd!)), 'revenue-average')),
          ]),
          if (load is RevenueFailed<RevenueSummary>) ...<Widget>[
            const SizedBox(height: N11Space.gap2),
            ReasonNote(load.message),
            const SizedBox(height: N11Space.gap2),
            N11Button(key: const Key('revenue-retry'), label: 'Tải lại', kind: ButtonKind.secondary, compact: true, onPressed: _fetch),
          ],
        ],
      ),
    );
  }

  Widget _stat(String label, String value, String key) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: N11Text.caption),
          const SizedBox(height: N11Space.gap1),
          Text(value, key: Key(key), style: N11Text.h2),
        ],
      );

  Widget _chartCard(RevenueSummary? summary, RevenueLoad<RevenueSummary> load) {
    Widget body;
    if (load is RevenueLoading<RevenueSummary>) {
      body = const Text('Đang tải…', key: Key('revenue-chart-loading'), style: N11Text.body);
    } else if (load is RevenueFailed<RevenueSummary>) {
      body = const Text('Chưa xác định. Không hiển thị cột khi chưa tải được dữ liệu.', key: Key('revenue-chart-unknown'), style: N11Text.body);
    } else if (summary == null || summary.completed == 0) {
      body = const Text('Chưa có đơn hoàn tất trong kỳ này.', key: Key('revenue-chart-empty'), style: N11Text.body);
    } else {
      final int? selected = _selected;
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(selected == null ? 'Chạm một cột để xem số của ngày đó.' : _dayLine(summary.daily[selected]), key: const Key('revenue-bar-detail'), style: N11Text.caption),
          const SizedBox(height: N11Space.gap2),
          _RevenueBars(days: summary.daily, selected: selected, onSelect: (int index) => setState(() => _selected = index)),
        ],
      );
    }
    return N11Card(
      key: const Key('revenue-chart'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Giá trị món theo ngày', style: N11Text.h2),
          const SizedBox(height: N11Space.gap2),
          body,
        ],
      ),
    );
  }

  String _dayLine(RevenueDay day) => '${revenueShortDay(DateTime.parse(day.date))} · ${day.completed} đơn · ${formatVnd(day.itemsVnd)}';

  Widget _ordersCard() {
    final RevenueLoad<RevenueOrdersPage>? state = _ordersState;
    final List<Widget> rows = <Widget>[
      for (final RevenueOrder order in _orders) _orderRow(order),
    ];
    String? note;
    if (state is RevenueLoading<RevenueOrdersPage>) {
      note = 'Đang tải…';
    } else if (state is RevenueFailed<RevenueOrdersPage>) {
      note = state.message;
    } else if (state is RevenueReady<RevenueOrdersPage> && _orders.isEmpty) {
      note = 'Chưa có đơn nào trong kỳ này.';
    }
    return N11Card(
      key: const Key('revenue-orders'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Đơn đóng góp vào kỳ này', style: N11Text.h2),
          if (note != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text(note, key: const Key('revenue-orders-note'), style: N11Text.body)),
          ...rows,
          if (_nextCursor != null)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap2),
              child: N11Button(key: const Key('revenue-more'), label: _loadingMore ? 'Đang tải…' : 'Tải thêm', kind: ButtonKind.secondary, compact: true, onPressed: _loadingMore ? null : _loadMore),
            ),
        ],
      ),
    );
  }

  Widget _orderRow(RevenueOrder order) {
    final DateTime vn = DateTime.parse(order.endedAt).toUtc().add(kRevenueVnOffset);
    final String when = '${vn.day.toString().padLeft(2, '0')}/${vn.month.toString().padLeft(2, '0')} ${vn.hour.toString().padLeft(2, '0')}:${vn.minute.toString().padLeft(2, '0')}';
    final Widget content = Padding(
      padding: const EdgeInsets.symmetric(vertical: N11Space.gap2),
      child: Row(children: <Widget>[
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
            Text(order.code, style: N11Text.bodyStrong, maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(when, style: N11Text.caption),
          ]),
        ),
        Text(formatVnd(order.itemsVnd), style: N11Text.bodyStrong),
        if (widget.openOrder != null) const Icon(Icons.chevron_right, color: N11Colors.ink2),
      ]),
    );
    final Future<void> Function(String)? open = widget.openOrder;
    if (open == null) {
      return content;
    }
    return InkWell(key: Key('revenue-order-${order.orderId}'), onTap: () => open(order.orderId), child: content);
  }
}

const String kRevenueUnknownText = 'Chưa xác định';

/// Daily columns. A day with no value still has its column (height 0) and its line says 0 đ.
class _RevenueBars extends StatelessWidget {
  const _RevenueBars({required this.days, required this.selected, required this.onSelect});

  final List<RevenueDay> days;
  final int? selected;
  final ValueChanged<int> onSelect;

  static const double _maxBar = 120;
  static const double _minWidth = 22;

  @override
  Widget build(BuildContext context) {
    final int maxValue = days.fold<int>(0, (int best, RevenueDay day) => day.itemsVnd > best ? day.itemsVnd : best);
    return LayoutBuilder(builder: (BuildContext context, BoxConstraints constraints) {
      final double width = (constraints.maxWidth / days.length).clamp(_minWidth, double.infinity).toDouble();
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: List<Widget>.generate(days.length, (int index) {
            final RevenueDay day = days[index];
            final bool isSelected = selected == index;
            final double height = maxValue == 0 || day.itemsVnd == 0 ? 0 : (day.itemsVnd / maxValue * _maxBar).clamp(2, _maxBar).toDouble();
            return Semantics(
              button: true,
              label: '${revenueShortDay(DateTime.parse(day.date))}: ${day.completed} đơn, ${formatVnd(day.itemsVnd)}',
              child: GestureDetector(
                key: Key('revenue-bar-$index'),
                behavior: HitTestBehavior.opaque,
                onTap: () => onSelect(index),
                child: SizedBox(
                  width: width,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      SizedBox(
                        height: _maxBar,
                        child: Align(
                          alignment: Alignment.bottomCenter,
                          child: Container(
                            width: width * 0.6,
                            height: height,
                            decoration: BoxDecoration(color: isSelected ? N11Colors.yellowStrong : N11Colors.yellow, borderRadius: const BorderRadius.vertical(top: Radius.circular(4))),
                          ),
                        ),
                      ),
                      const SizedBox(height: N11Space.gap1),
                      Text(DateTime.parse(day.date).day.toString().padLeft(2, '0'), style: N11Text.caption, maxLines: 1, overflow: TextOverflow.clip),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
      );
    });
  }
}

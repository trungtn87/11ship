import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_income_data.dart';

// Thu nhập tab body (issue #395). Layout from the Owner-approved mockup (reference only): 4 period filters, the "Tổng thu nhập" card, a daily column
// chart, the statistics and "Ví của tôi" (the entry to the wallet history). Every number comes from the server; nothing here is a sample.
// Money labels say "ước tính": the fee is received outside the app.

const String kIncomeBarHint = 'Chạm một cột để xem số của ngày đó.';
const String kIncomeWhatIsCounted = 'Tổng thu nhập là phí giao (gồm tip) của các đơn bạn đã hoàn tất trong kỳ, ước tính và nhận ngoài app. '
    'Phí giao khách trả tiền mặt vẫn được tính. Tiền hàng khách trả ngoài ứng dụng (COD) không được tính. '
    'Hoa hồng nền tảng là khoản trừ thật từ ví cho từng đơn hoàn tất. '
    'Thu nhập ước tính sau hoa hồng = Tổng thu nhập − hoa hồng. '
    'Bình quân/đơn = Tổng thu nhập ÷ số đơn hoàn thành. '
    'Đơn hủy, thất bại hoặc đã nhả đơn không được tính. Mỗi đơn chỉ tính một lần. '
    'Nạp, rút, số dư ví và khoản điều chỉnh của quản trị không hiện ở đây. Kỳ tính theo giờ Việt Nam.';
const String kIncomeUnknown = 'Chưa xác định';

String _signedVnd(int amount) => amount == 0 ? formatVnd(0) : amount < 0 ? '−${formatVnd(-amount)}' : '+${formatVnd(amount)}';

class IncomeBody extends StatefulWidget {
  const IncomeBody({super.key, required this.source, this.walletEntry, this.now});

  final IncomeSource source;

  /// The "Ví của tôi" row (the app passes [WalletEntry]); it opens the wallet history.
  final Widget? walletEntry;

  /// Test hook for the clock; the app uses the device clock (in UTC).
  final DateTime Function()? now;

  @override
  State<IncomeBody> createState() => _IncomeBodyState();
}

class _IncomeBodyState extends State<IncomeBody> {
  IncomePreset _preset = IncomePreset.last7;
  IncomePeriod? _custom;
  IncomeLoad _load = const IncomeLoading();
  int? _selected;
  int _request = 0;

  DateTime get _nowUtc => widget.now?.call() ?? DateTime.now().toUtc();

  IncomePeriod get _period => _preset == IncomePreset.custom && _custom != null ? _custom! : IncomePeriod.forPreset(_preset, _nowUtc);

  @override
  void initState() {
    super.initState();
    _fetch(initial: true);
  }

  Future<void> _fetch({bool initial = false}) async {
    final int mine = ++_request;
    final IncomePeriod period = _period;
    if (!initial) {
      setState(() {
        _load = const IncomeLoading();
        _selected = null;
      });
    }
    IncomeLoad result;
    try {
      result = await widget.source.load(period);
    } on Object {
      result = const IncomeFailed('Chưa tải được thu nhập. Kiểm tra mạng rồi thử lại.');
    }
    // A slower answer of an older filter never overwrites the newer one.
    if (!mounted || mine != _request) {
      return;
    }
    setState(() => _load = result);
  }

  void _choose(IncomePreset preset) {
    if (preset == _preset && preset != IncomePreset.custom) {
      return;
    }
    setState(() => _preset = preset);
    _fetch();
  }

  Future<void> _pickCustom() async {
    final DateTime today = vietnamDayOf(_nowUtc);
    final DateTimeRange? picked = await showDateRangePicker(
      context: context,
      firstDate: today.subtract(const Duration(days: 366)),
      lastDate: today,
      initialDateRange: DateTimeRange(start: _period.from, end: _period.to),
      helpText: 'Chọn khoảng ngày (tối đa $kIncomeMaxDays ngày)',
    );
    if (picked == null || !mounted) {
      return;
    }
    final IncomePeriod chosen = IncomePeriod(from: DateTime(picked.start.year, picked.start.month, picked.start.day), to: DateTime(picked.end.year, picked.end.month, picked.end.day));
    if (!chosen.isValid) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Khoảng tối đa $kIncomeMaxDays ngày. Hãy chọn lại.')));
      return;
    }
    setState(() {
      _custom = chosen;
      _preset = IncomePreset.custom;
    });
    _fetch();
  }

  void _showHowItIsCounted() {
    showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        key: const Key('income-explain-dialog'),
        title: const Text('Cách tính thu nhập'),
        content: const Text(kIncomeWhatIsCounted, style: N11Text.body),
        actions: <Widget>[TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Đã hiểu'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final IncomeLoad load = _load;
    final IncomeSummary? summary = load is IncomeReady ? load.summary : null;
    return vstack(<Widget>[
      _filters(),
      _summaryCard(summary, load),
      _chartCard(summary, load),
      if (widget.walletEntry != null) widget.walletEntry!,
    ]);
  }

  Widget _filters() {
    N11Button preset(IncomePreset value, String label, Key key) => N11Button(
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
        preset(IncomePreset.today, 'Hôm nay', const Key('income-filter-today')),
        preset(IncomePreset.last7, '7 ngày', const Key('income-filter-7')),
        preset(IncomePreset.last30, '30 ngày', const Key('income-filter-30')),
        N11Button(key: const Key('income-filter-custom'), label: _preset == IncomePreset.custom ? 'Khoảng: ${viewDay(_period.from)} – ${viewDay(_period.to)}' : 'Chọn khoảng', compact: true, kind: _preset == IncomePreset.custom ? ButtonKind.primary : ButtonKind.secondary, onPressed: _pickCustom),
      ],
    );
  }

  Widget _summaryCard(IncomeSummary? summary, IncomeLoad load) {
    final bool failed = load is IncomeFailed;
    final bool loading = load is IncomeLoading;
    String money(int? value) => failed || loading || value == null ? (loading ? 'Đang tải…' : kIncomeUnknown) : formatVnd(value);
    final String period = '${viewDay(_period.from)} – ${viewDay(_period.to)} · ${_period.days} ngày';
    return N11Card(
      key: const Key('income-summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[
            const Icon(Icons.insights_outlined, color: N11Colors.ink2),
            const SizedBox(width: N11Space.gap2),
            Expanded(child: Text('Tổng thu nhập', style: N11Text.h2)),
            IconButton(key: const Key('income-info'), tooltip: 'Cách tính thu nhập', icon: const Icon(Icons.info_outline, color: N11Colors.ink2), onPressed: _showHowItIsCounted),
          ]),
          Text(period, key: const Key('income-period'), style: N11Text.caption),
          const SizedBox(height: N11Space.gap2),
          Text(money(summary?.feeVnd), key: const Key('income-total'), style: N11Text.title),
          const Text('Ước tính: phí giao (gồm tip) của đơn đã hoàn tất, nhận ngoài app.', style: N11Text.caption),
          const SizedBox(height: N11Space.gap3),
          _line('Hoa hồng nền tảng', failed || loading || summary == null ? money(null) : _signedVnd(summary.commissionVnd), 'income-commission'),
          _line(
            'Thu nhập ước tính sau hoa hồng',
            failed || loading || summary == null ? money(null) : formatVnd(summary.netVnd),
            'income-net',
            tag: summary != null && summary.netProvisional ? 'tạm tính' : null,
          ),
          const Divider(height: N11Space.gap4),
          Row(children: <Widget>[
            Expanded(child: _stat('Số đơn hoàn thành', failed || loading || summary == null ? money(null) : '${summary.completed}', 'income-count')),
            Expanded(child: _stat('Bình quân/đơn', failed || loading || summary == null ? money(null) : (summary.averageVnd == null ? '—' : formatVnd(summary.averageVnd!)), 'income-average')),
          ]),
          if (load is IncomeFailed) ...<Widget>[
            const SizedBox(height: N11Space.gap2),
            ReasonNote(load.message),
            const SizedBox(height: N11Space.gap2),
            N11Button(key: const Key('income-retry'), label: 'Tải lại', kind: ButtonKind.secondary, compact: true, onPressed: _fetch),
          ],
        ],
      ),
    );
  }

  Widget _line(String label, String value, String key, {String? tag}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: N11Space.gap1),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: <Widget>[
          // The label and the figure share the row; at large text scales the label wraps and the figure (with its tag) may wrap too, never overflow.
          Expanded(flex: 3, child: Text(label, style: N11Text.body)),
          const SizedBox(width: N11Space.gap2),
          Flexible(
            flex: 2,
            child: Row(mainAxisSize: MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.end, children: <Widget>[
              if (tag != null) ...<Widget>[
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: N11Space.gap2, vertical: 2),
                    decoration: BoxDecoration(color: N11Colors.warningSoft, borderRadius: BorderRadius.circular(8)),
                    child: Text(tag, style: N11Text.caption.copyWith(color: N11Colors.warning)),
                  ),
                ),
                const SizedBox(width: N11Space.gap2),
              ],
              Flexible(child: Text(value, key: Key(key), style: N11Text.bodyStrong, textAlign: TextAlign.end)),
            ]),
          ),
        ]),
      );

  Widget _stat(String label, String value, String key) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: N11Text.caption),
          const SizedBox(height: N11Space.gap1),
          Text(value, key: Key(key), style: N11Text.h2),
        ],
      );

  Widget _chartCard(IncomeSummary? summary, IncomeLoad load) {
    Widget body;
    if (load is IncomeLoading) {
      body = const Text('Đang tải…', key: Key('income-chart-loading'), style: N11Text.body);
    } else if (load is IncomeFailed) {
      body = const Text('Chưa xác định. Không hiển thị cột khi chưa tải được dữ liệu.', key: Key('income-chart-unknown'), style: N11Text.body);
    } else if (summary == null || summary.completed == 0) {
      body = const Text('Chưa có đơn hoàn tất trong kỳ này.', key: Key('income-chart-empty'), style: N11Text.body);
    } else {
      final int? selected = _selected;
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            selected == null ? kIncomeBarHint : _dayLine(summary.daily[selected]),
            key: const Key('income-bar-detail'),
            style: N11Text.caption,
          ),
          const SizedBox(height: N11Space.gap2),
          _DailyBars(days: summary.daily, selected: selected, onSelect: (int index) => setState(() => _selected = index)),
        ],
      );
    }
    return N11Card(
      key: const Key('income-chart'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Thu nhập theo ngày (ước tính)', style: N11Text.h2),
          const SizedBox(height: N11Space.gap2),
          body,
        ],
      ),
    );
  }

  String _dayLine(IncomeDay day) {
    final DateTime parsed = DateTime.parse(day.date);
    final String commission = day.commissionVnd == 0 ? '' : ' · hoa hồng ${_signedVnd(day.commissionVnd)}';
    final String provisional = day.provisional ? ' (tạm tính)' : '';
    return '${shortDay(parsed)} · ${day.completed} đơn · ${formatVnd(day.feeVnd)}$commission · sau hoa hồng ${formatVnd(day.netVnd)}$provisional';
  }
}

/// Daily columns. A day with no income still has its column (height 0) and its tooltip says 0 đ.
class _DailyBars extends StatelessWidget {
  const _DailyBars({required this.days, required this.selected, required this.onSelect});

  final List<IncomeDay> days;
  final int? selected;
  final ValueChanged<int> onSelect;

  static const double _maxBar = 120;
  static const double _minWidth = 22;

  @override
  Widget build(BuildContext context) {
    final int maxFee = days.fold<int>(0, (int best, IncomeDay day) => day.feeVnd > best ? day.feeVnd : best);
    return LayoutBuilder(builder: (BuildContext context, BoxConstraints constraints) {
      final double width = (constraints.maxWidth / days.length).clamp(_minWidth, double.infinity).toDouble();
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: List<Widget>.generate(days.length, (int index) {
            final IncomeDay day = days[index];
            final bool isSelected = selected == index;
            final double height = maxFee == 0 || day.feeVnd == 0 ? 0 : (day.feeVnd / maxFee * _maxBar).clamp(2, _maxBar).toDouble();
            return Semantics(
              button: true,
              label: '${shortDay(DateTime.parse(day.date))}: ${day.completed} đơn, ${formatVnd(day.feeVnd)}',
              child: GestureDetector(
                key: Key('income-bar-$index'),
                behavior: HitTestBehavior.opaque,
                onTap: () => onSelect(index),
                child: SizedBox(
                  width: width,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: <Widget>[
                      SizedBox(
                        height: _maxBar,
                        child: Align(
                          alignment: Alignment.bottomCenter,
                          child: Container(
                            width: width * 0.6,
                            height: height,
                            decoration: BoxDecoration(
                              color: isSelected ? N11Colors.yellowStrong : N11Colors.yellow,
                              borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: N11Space.gap1),
                      Text(
                        DateTime.parse(day.date).day.toString().padLeft(2, '0'),
                        style: N11Text.caption.copyWith(fontWeight: isSelected ? FontWeight.w700 : FontWeight.w400),
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                      ),
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

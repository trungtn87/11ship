import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm02_flows.dart';
import 'm02_widgets.dart';
import 'm02_format.dart';
import 'schedule.dart';
import 'shop_ops_controller.dart';

// Q03 (Giờ hoạt động) and Q04 (Chỉnh giờ). One "Lưu lịch" writes the whole week; "Xong" in the editor only changes the draft.
// There is no open/close switch: the shop opens and closes by this schedule alone.

class HoursScreen extends StatefulWidget {
  const HoursScreen({super.key, required this.flows});

  final M02Flows flows;

  @override
  State<HoursScreen> createState() => _HoursScreenState();
}

class _HoursScreenState extends State<HoursScreen> {
  int _seenNotice = 0;
  bool _conflictOpen = false;

  ShopOpsController get ops => widget.flows.ops;

  @override
  void initState() {
    super.initState();
    _seenNotice = ops.noticeSeq;
    ops.addListener(_onOps);
    ops.session.addListener(_gone);
    if (ops.loadState == OpsLoad.idle) {
      ops.load();
    }
  }

  @override
  void dispose() {
    ops.removeListener(_onOps);
    ops.session.removeListener(_gone);
    super.dispose();
  }

  void _gone() {
    if (ops.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  void _onOps() {
    if (ops.noticeSeq != _seenNotice) {
      _seenNotice = ops.noticeSeq;
      if (ops.notice != null && mounted && !ops.conflict && ops.pending == null) {
        m02Toast(context, ops.notice!);
      }
    }
    if (ops.conflict && !_conflictOpen && mounted) {
      _conflictOpen = true;
      _askConflict();
    }
  }

  Future<void> _askConflict() async {
    final String? first = await showDecision(
      context,
      title: 'Dữ liệu đã được cập nhật ở nơi khác.',
      text: 'Nội dung bạn đang sửa vẫn được giữ. Tải bản mới sẽ thay thế bản nháp.',
      actions: const <DialogAction>[DialogAction('Giữ bản nháp', 'keep'), DialogAction('Tải bản mới', 'load', kind: ButtonKind.primary)],
    );
    if (!mounted) {
      return;
    }
    if (first == 'load') {
      final String? second = await showDecision(
        context,
        title: 'Thay bản nháp bằng bản mới?',
        text: 'Các chỉnh sửa chưa lưu của bạn sẽ mất.',
        actions: const <DialogAction>[DialogAction('Quay lại', 'back'), DialogAction('Tải bản mới', 'confirm', kind: ButtonKind.dark)],
      );
      if (second == 'confirm') {
        await ops.loadNewReplacingDrafts();
      } else {
        ops.keepDraftAfterConflict();
      }
    } else {
      ops.keepDraftAfterConflict();
    }
    _conflictOpen = false;
  }

  Future<bool> _leave() async => (!ops.hoursDirty || ops.pending != null) ? true : confirmDiscard(context);

  Future<void> _save() async {
    if (!checkSchedule(ops.hoursDraft).ok) {
      m02Toast(context, 'Lịch còn lỗi, chưa thể lưu.');
      return;
    }
    if (ops.hoursAllClosed) {
      final String? choice = await showDecision(
        context,
        title: 'Đóng cửa cả tuần?',
        text: 'Quán sẽ đóng cửa cả tuần theo lịch này.',
        actions: const <DialogAction>[DialogAction('Quay lại', 'back'), DialogAction('Lưu lịch', 'save', kind: ButtonKind.primary, key: Key('closeall-save'))],
      );
      if (choice != 'save') {
        return;
      }
    }
    await ops.saveHours();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ops,
      builder: (BuildContext context, Widget? child) {
        final ShopOverview? o = ops.overview;
        if (o == null) {
          return M02Scaffold(title: 'Giờ hoạt động', content: <Widget>[ops.loadState == OpsLoad.failed ? M02LoadFailed(onRetry: ops.load) : const M02Skeleton()]);
        }
        final WeekSchedule draft = ops.hoursDraft;
        final bool readOnly = ops.readOnly;
        final bool dirty = ops.hoursDirty;
        final bool fresh = !o.hasHours && !dirty;
        final bool canEdit = !readOnly && !ops.locked;
        final AuthFailureView? failure = ops.writeFailure == null ? null : AuthFailureView(m02FailureText(ops.writeFailure!));
        return M02Scaffold(
          title: 'Giờ hoạt động',
          onWillLeave: _leave,
          content: <Widget>[
            if (readOnly) const N11Banner(key: Key('hours-readonly'), kind: BannerKind.info, title: 'Chỉ đọc', text: 'Quán đã bị vô hiệu hóa. Bạn không thể sửa lịch.'),
            if (ops.stale) const N11Banner(kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất.'),
            if (ops.pending != null && ops.pending!.kind == OpsWriteKind.hours) UnknownOutcomeBanner(onRetry: ops.retryPending, busy: ops.busy),
            if (failure != null && ops.pending == null && !ops.conflict) N11Banner(key: const Key('hours-error'), kind: BannerKind.error, title: 'Chưa lưu được', text: failure.text),
            if (ops.savedNotReloaded)
              N11Banner(
                key: const Key('hours-saved-not-reloaded'),
                kind: BannerKind.warn,
                title: 'Đã lưu, chưa tải lại được dữ liệu',
                trailing: N11Button(key: const Key('hours-reload'), label: 'Tải lại', compact: true, onPressed: ops.reloadAfterSave),
              ),
            if (fresh && !readOnly) const N11Banner(key: Key('hours-fresh'), kind: BannerKind.warn, title: 'Chưa cài giờ hoạt động', text: 'Chưa có lịch nên quán được tính là đóng cửa. Chọn «Cả tuần» để nhập nhanh.'),
            const Text('Giờ Việt Nam. Quán tự mở và đóng theo lịch này — không cần bật/tắt thủ công.', style: N11Text.caption),
            N11List(children: <Widget>[
              ScheduleRow(
                key: const Key('hours-all'),
                day: 'Cả tuần',
                sub: 'Nhập nhanh',
                lines: isUniform(draft) ? (draft[0].isEmpty ? const <String>['Đóng cửa cả tuần'] : dayLines(draft[0])) : const <String>['Tùy chỉnh theo ngày'],
                mutedWhenEmpty: false,
                onTap: canEdit ? () => _edit(null) : null,
              ),
              for (int d = 0; d < 7; d++)
                ScheduleRow(
                  key: Key('hours-day-$d'),
                  day: kDayNames[d],
                  lines: dayLines(draft[d]),
                  chip: draft[d].isEmpty ? const N11Chip('Đóng') : null,
                  onTap: canEdit ? () => _edit(d) : null,
                ),
            ]),
            const Text('Ca qua đêm thuộc ngày bắt đầu, ví dụ Chủ nhật 22:00 → Thứ Hai 02:00. Tối đa 28 khoảng giờ mỗi tuần.', style: N11Text.caption),
          ],
          footer: readOnly
              ? const <Widget>[]
              : <Widget>[
                  if (dirty || ops.busy) N11Button(key: const Key('hours-revert'), label: 'Bỏ thay đổi', kind: ButtonKind.secondary, onPressed: ops.locked ? null : ops.revertHours),
                  N11Button(
                    key: const Key('hours-save'), validate: true,
                    label: ops.busy ? 'Đang lưu…' : 'Lưu lịch',
                    loading: ops.busy,
                    onPressed: ops.locked || !dirty ? null : _save,
                  ),
                ],
        );
      },
    );
  }

  Future<void> _edit(int? day) => Navigator.of(context).push(n11Route(HourEditorScreen(flows: widget.flows, day: day)));
}

/// A tiny wrapper so the words are computed once per build.
class AuthFailureView {
  const AuthFailureView(this.text);

  final String text;
}

/// Q04: edit one day, or "Cả tuần" (day == null) which fills all seven days of the draft when applied.
class HourEditorScreen extends StatefulWidget {
  const HourEditorScreen({super.key, required this.flows, required this.day});

  final M02Flows flows;
  final int? day;

  @override
  State<HourEditorScreen> createState() => _HourEditorScreenState();
}

class _HourEditorScreenState extends State<HourEditorScreen> {
  late List<HourRange> _ranges;
  late final List<HourRange> _initial;
  final List<TextEditingController> _open = <TextEditingController>[];
  final List<TextEditingController> _close = <TextEditingController>[];

  ShopOpsController get ops => widget.flows.ops;
  bool get _all => widget.day == null;

  @override
  void initState() {
    super.initState();
    final WeekSchedule draft = ops.hoursDraft;
    _ranges = <HourRange>[for (final HourRange r in (_all ? (isUniform(draft) ? draft[0] : const <HourRange>[]) : draft[widget.day!])) r.copy()];
    _initial = <HourRange>[for (final HourRange r in _ranges) r.copy()];
    for (final HourRange r in _ranges) {
      _addControllers(r);
    }
    ops.session.addListener(_gone);
  }

  void _gone() {
    if (ops.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  void _addControllers(HourRange r) {
    _open.add(TextEditingController(text: r.open));
    _close.add(TextEditingController(text: r.close));
  }

  @override
  void dispose() {
    ops.session.removeListener(_gone);
    for (final TextEditingController c in <TextEditingController>[..._open, ..._close]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _dirty {
    if (_ranges.length != _initial.length) {
      return true;
    }
    for (int i = 0; i < _ranges.length; i++) {
      if (_ranges[i] != _initial[i]) {
        return true;
      }
    }
    return false;
  }

  /// The week as it would be after "Xong" / "Áp dụng": what is checked.
  WeekSchedule get _candidate {
    final WeekSchedule week = copyWeek(ops.hoursDraft);
    if (_all) {
      return <List<HourRange>>[for (int i = 0; i < 7; i++) <HourRange>[for (final HourRange r in _ranges) r.copy()]];
    }
    week[widget.day!] = <HourRange>[for (final HourRange r in _ranges) r.copy()];
    return week;
  }

  Future<bool> _leave() async => !_dirty ? true : confirmDiscard(context);

  Future<void> _done() async {
    final WeekSchedule candidate = _candidate;
    if (!checkSchedule(candidate).ok) {
      return;
    }
    final NavigatorState navigator = Navigator.of(context);
    if (_all) {
      final WeekSchedule current = ops.hoursDraft;
      final bool overrides = current.any((List<HourRange> d) => d.isNotEmpty) && !sameWeek(current, candidate);
      if (overrides) {
        final String? choice = await showDecision(
          context,
          title: 'Thay lịch của cả 7 ngày?',
          text: 'Lịch nháp của từng ngày sẽ bị thay bằng lịch Cả tuần. Lịch đã lưu trên máy chủ vẫn giữ nguyên cho đến khi bạn bấm Lưu lịch.',
          actions: const <DialogAction>[DialogAction('Giữ lịch', 'keep'), DialogAction('Thay lịch', 'replace', kind: ButtonKind.primary, key: Key('apply7-replace'))],
        );
        if (choice != 'replace') {
          return;
        }
      }
      ops.applyAllWeek(_ranges);
      navigator.pop();
      if (mounted) {
        m02Toast(context, 'Đã áp dụng cho cả tuần. Chưa lưu — bấm Lưu lịch để ghi.');
      }
      return;
    }
    ops.setDay(widget.day!, _ranges);
    navigator.pop();
  }

  void _add() {
    setState(() {
      final HourRange r = _ranges.isEmpty ? HourRange(open: '10:00', close: '14:00', kind: RangeKind.day) : HourRange(open: '17:00', close: '23:00', kind: RangeKind.day);
      _ranges.add(r);
      _addControllers(r);
    });
  }

  void _remove(int i) {
    setState(() {
      _ranges.removeAt(i);
      _open.removeAt(i).dispose();
      _close.removeAt(i).dispose();
    });
  }

  String _note(HourRange r) {
    switch (r.kind) {
      case RangeKind.night:
        return _all ? 'Giờ đóng thuộc ngày hôm sau, áp dụng cho từng ngày.' : 'Giờ đóng thuộc ngày hôm sau (${kDayNames[(widget.day! + 1) % 7]}).';
      case RangeKind.h24:
        return 'Mở từ ${r.open} đến cùng giờ hôm sau.';
      case RangeKind.day:
        return r.open == '00:00' && r.close == '24:00' ? 'Cả ngày (00:00–24:00).' : '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final ScheduleCheck check = checkSchedule(_candidate);
    final int dayKey = _all ? 0 : widget.day!;
    String errorOf(int i) {
      final String? message = check.errors['$dayKey:$i'];
      if (message == null) {
        return '';
      }
      return _all && message.startsWith('Trùng') ? 'Các khoảng chồng nhau khi áp dụng cho cả 7 ngày (ca qua đêm hoặc 24 giờ lấn sang ngày kế).' : message;
    }

    final bool blocked = !check.ok;
    return M02Scaffold(
      title: _all ? 'Cả tuần' : kDayNames[widget.day!],
      onWillLeave: _leave,
      content: <Widget>[
        if (_all)
          const N11Banner(kind: BannerKind.info, title: 'Công cụ nhập nhanh', text: 'Áp dụng sẽ thay lịch nháp của cả 7 ngày. Bạn vẫn sửa riêng từng ngày sau đó, và lịch chỉ được ghi khi bấm Lưu lịch.')
        else
          const Text('Giờ Việt Nam. Ca qua đêm thuộc ngày bắt đầu.', style: N11Text.caption),
        for (int i = 0; i < _ranges.length; i++) _rangeCard(i, errorOf(i)),
        if (_ranges.isEmpty)
          N11InfoCard(
            key: const Key('editor-empty'),
            title: _all ? 'Chưa có khoảng giờ' : 'Ngày này đóng cửa',
            text: _all ? 'Áp dụng khi trống sẽ đặt cả tuần là đóng cửa.' : 'Không có khoảng giờ nào: quán đóng cửa cả ngày.',
          ),
        if (check.totalError != null) N11Banner(key: const Key('editor-total-error'), kind: BannerKind.error, title: 'Quá số khoảng cho phép', text: '${check.totalError!}${_all ? ' Cả tuần được nhân bảy.' : ''}'),
        N11Button(key: const Key('editor-add'), label: '+ Thêm khoảng', kind: ButtonKind.secondary, onPressed: () => _add()),
        Text('Tổng ${check.total}/$kMaxIntervalsPerWeek khoảng giờ trong tuần.', key: const Key('editor-total'), style: N11Text.caption),
      ],
      footer: <Widget>[
        N11Button(key: const Key('editor-cancel'), label: 'Hủy', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).maybePop()),
        N11Button(key: const Key('editor-done'), label: _all ? 'Áp dụng cho cả tuần' : 'Xong', onPressed: blocked ? null : _done),
      ],
    );
  }

  Widget _rangeCard(int i, String error) {
    final HourRange r = _ranges[i];
    final String note = _note(r);
    return Container(
      key: Key('range-$i'),
      padding: const EdgeInsets.all(N11Space.gap3),
      decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: error.isEmpty ? N11Colors.line : N11Colors.error, width: error.isEmpty ? 1 : 2), borderRadius: BorderRadius.circular(kRadiusCard)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: Text('Khoảng ${i + 1}', style: N11Text.bodyStrong)),
              IconButton(key: Key('range-$i-delete'), tooltip: 'Xóa khoảng ${i + 1}', constraints: const BoxConstraints(minWidth: kTapMin, minHeight: kTapMin), onPressed: () => _remove(i), icon: const Icon(Icons.delete_outline, color: N11Colors.ink2)),
            ],
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(child: _timeField(i, 'Giờ mở', _open[i], Key('range-$i-open'), (String v) => r.open = v, error.isNotEmpty)),
              const SizedBox(width: N11Space.gap3),
              Expanded(
                child: r.kind == RangeKind.h24
                    ? _fixedClose(i, r)
                    : _timeField(i, 'Giờ đóng', _close[i], Key('range-$i-close'), (String v) => r.close = v, error.isNotEmpty),
              ),
            ],
          ),
          const SizedBox(height: N11Space.gap2),
          Row(
            children: <Widget>[
              for (final (RangeKind kind, String label) in <(RangeKind, String)>[(RangeKind.day, 'Trong ngày'), (RangeKind.night, 'Qua đêm'), (RangeKind.h24, '24 giờ')]) ...<Widget>[
                if (kind != RangeKind.day) const SizedBox(width: N11Space.gap2),
                Expanded(child: _kindChip(i, r, kind, label)),
              ],
            ],
          ),
          if (note.isNotEmpty) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: Text(note, key: Key('range-$i-note'), style: N11Text.caption)),
          if (error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap2),
              child: Text(error, key: Key('range-$i-error'), style: const TextStyle(fontSize: 13, height: 1.45, fontWeight: FontWeight.w600, color: N11Colors.errorInk)),
            ),
        ],
      ),
    );
  }

  Widget _kindChip(int i, HourRange r, RangeKind kind, String label) {
    final bool on = r.kind == kind;
    return Semantics(
      button: true,
      selected: on,
      label: label,
      excludeSemantics: true,
      onTap: () => setState(() => r.kind = kind),
      child: InkWell(
        key: Key('range-$i-kind-${kind.name}'),
        borderRadius: BorderRadius.circular(kRadiusPill),
        onTap: () => setState(() => r.kind = kind),
        child: Container(
          constraints: const BoxConstraints(minHeight: kTapMin),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: on ? N11Colors.yellow : N11Colors.white, border: Border.all(color: on ? N11Colors.yellow : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusPill)),
          child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.black)),
        ),
      ),
    );
  }

  Widget _fixedClose(int i, HourRange r) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Giờ đóng', style: N11Text.label),
        const SizedBox(height: N11Space.gap2),
        Container(
          height: kControlHeight,
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: N11Colors.disabledBg, borderRadius: BorderRadius.circular(kRadiusControl)),
          child: Text('${r.open} hôm sau', key: Key('range-$i-close-fixed'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: N11Colors.disabledInk)),
        ),
      ],
    );
  }

  Widget _timeField(int i, String label, TextEditingController controller, Key key, void Function(String) assign, bool errored) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: N11Text.label),
        const SizedBox(height: N11Space.gap2),
        TextField(
          key: key,
          controller: controller,
          readOnly: true,
          enableInteractiveSelection: false,
          style: N11Text.bodyStrong,
          decoration: InputDecoration(
            filled: true,
            fillColor: N11Colors.white,
            suffixIcon: const Icon(Icons.schedule, color: N11Colors.ink2),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(kRadiusControl),
              borderSide: BorderSide(color: errored ? N11Colors.error : N11Colors.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(kRadiusControl),
              borderSide: const BorderSide(color: N11Colors.yellow, width: 2),
            ),
          ),
          onTap: () async {
            final HourRange range = _ranges[i];
            final String? selected = await showModalBottomSheet<String>(
              context: context,
              isScrollControlled: true,
              backgroundColor: N11Colors.white,
              builder: (BuildContext context) => _HourWheelPicker(label: label, value: controller.text, allow24: controller == _close[i] && range.kind == RangeKind.day),
            );
            if (!mounted || selected == null || !_ranges.contains(range)) {
              return;
            }
            setState(() {
              controller.text = selected;
              assign(selected);
            });
          },
        ),
      ],
    );
  }
}

/// Changes stay inside the sheet until Xong; dismissing keeps the editor draft.
class _HourWheelPicker extends StatefulWidget {
  const _HourWheelPicker({required this.label, required this.value, required this.allow24});

  final String label;
  final String value;
  final bool allow24;

  @override
  State<_HourWheelPicker> createState() => _HourWheelPickerState();
}

class _HourWheelPickerState extends State<_HourWheelPicker> {
  late int _hour;
  late int _minute;
  late final FixedExtentScrollController _hours;
  late final FixedExtentScrollController _minutes;

  @override
  void initState() {
    super.initState();
    final int initial = parseHm(widget.value, allow24: widget.allow24) ?? 0;
    _hour = initial ~/ 60;
    _minute = initial % 60;
    _hours = FixedExtentScrollController(initialItem: _hour);
    _minutes = FixedExtentScrollController(initialItem: _minute);
  }

  @override
  void dispose() {
    _hours.dispose();
    _minutes.dispose();
    super.dispose();
  }

  Widget _wheel({required String label, required String keyName, required FixedExtentScrollController controller, required int count, required ValueChanged<int> onChanged}) {
    return Expanded(
      child: Column(
        children: <Widget>[
          Text(label, style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: <Widget>[
                IgnorePointer(
                  child: Container(
                    height: 48,
                    decoration: BoxDecoration(color: N11Colors.yellowFaint, borderRadius: BorderRadius.circular(kRadiusControl)),
                  ),
                ),
                Semantics(
                  label: label,
                  child: ListWheelScrollView.useDelegate(
                    key: Key(keyName),
                    controller: controller,
                    itemExtent: 48,
                    physics: const FixedExtentScrollPhysics(),
                    perspective: 0.003,
                    onSelectedItemChanged: onChanged,
                    childDelegate: ListWheelChildBuilderDelegate(
                      childCount: count,
                      builder: (BuildContext context, int index) => Center(child: Text(index.toString().padLeft(2, '0'), style: N11Text.h2)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(N11Space.pad),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.label, style: N11Text.h2),
            const SizedBox(height: N11Space.gap3),
            SizedBox(
              height: 240,
              child: Row(
                children: <Widget>[
                  _wheel(
                    label: 'Giờ',
                    keyName: 'time-picker-hours',
                    controller: _hours,
                    count: widget.allow24 ? 25 : 24,
                    onChanged: (int hour) {
                      setState(() {
                        _hour = hour;
                        if (hour == 24) {
                          _minute = 0;
                          _minutes.jumpToItem(0);
                        }
                      });
                    },
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: N11Space.gap2),
                    child: Text(':', style: N11Text.h2),
                  ),
                  _wheel(label: 'Phút', keyName: 'time-picker-minutes', controller: _minutes, count: _hour == 24 ? 1 : 60, onChanged: (int minute) => setState(() => _minute = minute)),
                ],
              ),
            ),
            const SizedBox(height: N11Space.gap3),
            Row(
              children: <Widget>[
                Expanded(
                  child: N11Button(key: const Key('time-picker-cancel'), label: 'Hủy', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).pop()),
                ),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  child: N11Button(key: const Key('time-picker-done'), label: 'Xong', onPressed: () => Navigator.of(context).pop(formatHm(_hour * 60 + _minute))),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

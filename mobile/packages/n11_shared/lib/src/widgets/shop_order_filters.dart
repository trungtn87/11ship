import 'package:flutter/material.dart';

/// Shared controls for the shop's food-order and delivery lists.
/// A filter is local to its tab and starts at "Tất cả / Mọi ngày".
class ShopOrderFilters {
  const ShopOrderFilters({this.status = 'all', this.dates});

  final String status;
  final DateTimeRange? dates;

  bool get isActive => status != 'all' || dates != null;
  DateTime? get from => dates?.start;
  DateTime? get toExclusive {
    final DateTime? end = dates?.end;
    return end == null ? null : DateTime(end.year, end.month, end.day + 1);
  }
}

typedef ShopOrderFilterChoice = ({String value, String label});

String _dateLabel(DateTime date) => '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';

/// One menu beside the search field; no status chips or calendar outside it.
Future<ShopOrderFilters?> showShopOrderFilters(
  BuildContext context, {
  required ShopOrderFilters current,
  required List<ShopOrderFilterChoice> statuses,
}) {
  String status = current.status;
  DateTimeRange? dates = current.dates;
  return showModalBottomSheet<ShopOrderFilters>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter update) {
        final DateTime now = DateTime.now();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(20, 4, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const Text('Lọc đơn hàng', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 16),
                  const Text('Trạng thái', style: TextStyle(fontWeight: FontWeight.w700)),
                  for (final ShopOrderFilterChoice choice in statuses)
                    ListTile(
                      key: Key('order-filter-${choice.value}'),
                      dense: true,
                      title: Text(choice.label),
                      trailing: status == choice.value ? const Icon(Icons.check_circle, color: Colors.black) : const Icon(Icons.circle_outlined),
                      onTap: () => update(() => status = choice.value),
                    ),
                  const Divider(),
                  const Text('Ngày', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    key: const Key('order-filter-date'),
                    icon: const Icon(Icons.calendar_today_outlined),
                    label: Text(dates == null ? 'Mọi ngày' : '${_dateLabel(dates!.start)} – ${_dateLabel(dates!.end)}'),
                    onPressed: () async {
                      final DateTimeRange? selected = await showDateRangePicker(
                        context: context,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(now.year, now.month, now.day + 7),
                        initialDateRange: dates,
                      );
                      if (selected != null) {
                        update(() => dates = selected);
                      }
                    },
                  ),
                  if (dates != null)
                    TextButton(
                      key: const Key('order-filter-clear-date'),
                      onPressed: () => update(() => dates = null),
                      child: const Text('Xóa lọc ngày'),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    children: <Widget>[
                      Expanded(child: OutlinedButton(
                        key: const Key('order-filter-reset'),
                        onPressed: () => Navigator.pop(context, const ShopOrderFilters()),
                        child: const Text('Đặt lại'),
                      )),
                      const SizedBox(width: 12),
                      Expanded(child: FilledButton(
                        key: const Key('order-filter-apply'),
                        onPressed: () {
                          if (dates != null && dates!.duration.inDays > 366) {
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Chọn khoảng ngày tối đa 366 ngày.')));
                            return;
                          }
                          Navigator.pop(context, ShopOrderFilters(status: status, dates: dates));
                        },
                        child: const Text('Áp dụng'),
                      )),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    ),
  );
}

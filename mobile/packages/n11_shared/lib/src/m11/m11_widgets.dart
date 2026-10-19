import 'package:flutter/material.dart';

import '../tokens.dart';
import '../widgets/components.dart';
import 'm11_models.dart';

// Shared pieces of the M11 screens: stars, the rating summary, a multi-line box, dates and the chips of a complaint status.

String m11Date(DateTime t) {
  final DateTime l = t.toLocal();
  return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year}';
}

String m11DateTime(DateTime t) {
  final DateTime l = t.toLocal();
  return '${m11Date(l)} ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

String m11Average(double? average) => average == null ? '–' : average.toStringAsFixed(1).replaceAll('.', ',');

/// Five stars; [stars] full ones. Never a default: callers pass 0 for "not rated".
class M11Stars extends StatelessWidget {
  const M11Stars(this.stars, {super.key, this.size = 18});

  final int stars;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$stars trên 5 sao',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[for (int i = 1; i <= 5; i++) Icon(i <= stars ? Icons.star_rounded : Icons.star_outline_rounded, size: size, color: i <= stars ? N11Colors.yellow : N11Colors.lineStrong)],
      ),
    );
  }
}

/// Five tap targets (>= 44 px). 0 = nothing chosen yet: the person must choose; there is no pre-selected star.
class M11StarPicker extends StatelessWidget {
  const M11StarPicker({super.key, required this.value, required this.onChanged, this.enabled = true});

  final int value;
  final ValueChanged<int> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        for (int i = 1; i <= 5; i++)
          Semantics(
            button: true,
            selected: i == value,
            label: '$i sao',
            child: InkWell(
              key: Key('m11-star-$i'),
              borderRadius: BorderRadius.circular(kRadiusPill),
              onTap: enabled ? () => onChanged(i) : null,
              child: SizedBox(width: 52, height: 52, child: Icon(i <= value ? Icons.star_rounded : Icons.star_outline_rounded, size: 40, color: i <= value ? N11Colors.yellow : N11Colors.lineStrong)),
            ),
          ),
      ],
    );
  }
}

const List<String> kStarWords = <String>['', 'Rất tệ', 'Chưa tốt', 'Bình thường', 'Tốt', 'Rất tốt'];

/// Average, count and the bars per star. An empty summary says "Chưa có đánh giá" (never a default 5).
class M11SummaryCard extends StatelessWidget {
  const M11SummaryCard({super.key, required this.summary, this.title});

  final RatingSummary summary;
  final String? title;

  @override
  Widget build(BuildContext context) {
    if (summary.isEmpty) {
      return N11Card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[if (title != null) Text(title!, style: N11Text.label), Text('Chưa có đánh giá', key: const Key('m11-summary-empty'), style: N11Text.bodyStrong)]));
    }
    final int max = summary.distribution.fold<int>(1, (int a, int b) => b > a ? b : a);
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (title != null) Padding(padding: const EdgeInsets.only(bottom: N11Space.gap2), child: Text(title!, style: N11Text.label)),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Column(
                children: <Widget>[
                  Text(m11Average(summary.average), key: const Key('m11-average'), style: N11Text.display),
                  M11Stars((summary.average ?? 0).round()),
                  Text('${summary.count} lượt', key: const Key('m11-count'), style: N11Text.caption),
                ],
              ),
              const SizedBox(width: N11Space.gap4),
              Expanded(
                child: Column(
                  children: <Widget>[
                    for (int star = 5; star >= 1; star--)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          children: <Widget>[
                            SizedBox(width: 14, child: Text('$star', style: N11Text.caption)),
                            const SizedBox(width: 6),
                            Expanded(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(kRadiusPill),
                                child: LinearProgressIndicator(value: summary.distribution[star - 1] / max, minHeight: 6, backgroundColor: N11Colors.chipSoon, color: N11Colors.yellow),
                              ),
                            ),
                            SizedBox(width: 28, child: Text('${summary.distribution[star - 1]}', textAlign: TextAlign.right, style: N11Text.caption)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Filter by star count: "Tất cả" and 5..1.
class M11StarFilter extends StatelessWidget {
  const M11StarFilter({super.key, required this.value, required this.onChanged});

  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          _pill(const Key('m11-filter-all'), 'Tất cả', value == null, () => onChanged(null)),
          for (int s = 5; s >= 1; s--) _pill(Key('m11-filter-$s'), '$s sao', value == s, () => onChanged(s)),
        ],
      ),
    );
  }

  Widget _pill(Key key, String label, bool selected, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: N11Space.gap2),
      child: Semantics(
        button: true,
        selected: selected,
        child: InkWell(
          key: key,
          borderRadius: BorderRadius.circular(kRadiusPill),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: kTapMin, minWidth: kTapMin),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(color: selected ? N11Colors.black : N11Colors.white, border: Border.all(color: selected ? N11Colors.black : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusPill)),
            child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: selected ? N11Colors.white : N11Colors.black)),
          ),
        ),
      ),
    );
  }
}

/// A multi-line text box in the style of the form fields. No length counter and no 500-character limit: the server decides what is too long.
class M11TextBox extends StatelessWidget {
  const M11TextBox({super.key, required this.fieldKey, required this.label, required this.controller, this.hint, this.enabled = true, this.onChanged, this.minLines = 3, this.optional = false});

  final Key fieldKey;
  final String label;
  final TextEditingController controller;
  final String? hint;
  final bool enabled;
  final VoidCallback? onChanged;
  final int minLines;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    final OutlineInputBorder border = OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.lineStrong));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(optional ? '$label · không bắt buộc' : label, style: N11Text.label),
        const SizedBox(height: 6),
        TextField(
          key: fieldKey,
          controller: controller,
          enabled: enabled,
          minLines: minLines,
          maxLines: 8,
          keyboardType: TextInputType.multiline,
          textInputAction: TextInputAction.newline,
          style: N11Text.body,
          onChanged: (String _) => onChanged?.call(),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: N11Colors.placeholder),
            filled: true,
            fillColor: N11Colors.field,
            border: border,
            enabledBorder: border,
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 2)),
          ),
        ),
      ],
    );
  }
}

({String label, ChipKind kind}) m11StatusChip(ComplaintStatus status) => switch (status) {
      ComplaintStatus.pending => (label: status.label, kind: ChipKind.warn),
      ComplaintStatus.inProgress => (label: status.label, kind: ChipKind.info),
      ComplaintStatus.awaitingInfo => (label: status.label, kind: ChipKind.yellow),
      ComplaintStatus.resolved => (label: status.label, kind: ChipKind.ok),
      ComplaintStatus.closedNoAction => (label: status.label, kind: ChipKind.neutral),
    };

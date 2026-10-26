import 'package:flutter/material.dart';

import '../tokens.dart';

/// Presentation only: caller owns the query, debounce, results and retry policy.
class N11SearchField extends StatelessWidget {
  const N11SearchField({
    super.key,
    required this.controller,
    required this.onChanged,
    this.fieldKey,
    this.clearKey,
    this.hint = 'Tìm quán hoặc món',
    this.autofocus = false,
    this.enabled = true,
    this.maxLength = 100,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final Key? fieldKey;
  final Key? clearKey;
  final String hint;
  final bool autofocus;
  final bool enabled;
  final int? maxLength;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<TextEditingValue>(
    valueListenable: controller,
    builder: (BuildContext context, TextEditingValue value, Widget? child) => TextField(
      key: fieldKey,
      controller: controller,
      autofocus: autofocus,
      enabled: enabled,
      maxLength: maxLength,
      textInputAction: TextInputAction.search,
      onChanged: onChanged,
      style: N11Text.body,
      decoration: InputDecoration(
        hintText: hint,
        counterText: '',
        prefixIcon: const Icon(Icons.search, color: N11Colors.ink2),
        suffixIcon: value.text.isEmpty
            ? null
            : IconButton(
                key: clearKey,
                tooltip: 'Xóa nội dung tìm kiếm',
                constraints: const BoxConstraints(minWidth: kTapMin, minHeight: kTapMin),
                onPressed: !enabled
                    ? null
                    : () {
                        controller.clear();
                        onChanged('');
                      },
                icon: const Icon(Icons.close, size: 20),
              ),
      ),
    ),
  );
}

/// Use in a horizontal scrolling list for categories; no category policy here.
class CategoryChip extends StatelessWidget {
  const CategoryChip({super.key, required this.label, required this.selected, this.onSelected});

  final String label;
  final bool selected;
  final ValueChanged<bool>? onSelected;

  @override
  Widget build(BuildContext context) => ChoiceChip(
    label: Text(label),
    selected: selected,
    onSelected: onSelected,
    showCheckmark: false,
    selectedColor: N11Colors.yellowSoft,
    backgroundColor: N11Colors.white,
    disabledColor: N11Colors.disabledBg,
    labelStyle: N11Text.label.copyWith(color: onSelected == null ? N11Colors.disabledInk : N11Colors.black),
    side: BorderSide(color: selected ? N11Colors.yellow : N11Colors.line),
    shape: const StadiumBorder(),
    materialTapTargetSize: MaterialTapTargetSize.padded,
    padding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: N11Space.gap2),
  );
}

/// Visual count only. NotificationBell keeps its controller and routing rules.
class NotificationBadge extends StatelessWidget {
  const NotificationBadge({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => count <= 0
      ? const SizedBox.shrink()
      : Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          constraints: const BoxConstraints(minWidth: 18),
          decoration: BoxDecoration(color: N11Colors.error, borderRadius: BorderRadius.circular(kRadiusPill)),
          child: Text(
            count > 99 ? '99+' : '$count',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, height: 1.3, fontWeight: FontWeight.w700, color: N11Colors.white),
          ),
        );
}

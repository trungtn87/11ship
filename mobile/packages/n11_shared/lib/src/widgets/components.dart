import 'package:flutter/material.dart';

import '../tokens.dart';

// Shared components of the 11Food / 11Ship phone UI, built from the approved M01 design ("Phone" component of m01.zip, Brand Board
// v1.1): every interactive control is >= 44 px and 48 px for buttons; a disabled business action always shows its reason as text.
// Radius: controls 14, cards 16, chips pill. Text on yellow is always charcoal.

/// A column with the same gap between children (the `c-stack` of the web UI).
Widget vstack(List<Widget> children, {double gap = N11Space.gap3}) {
  final List<Widget> items = <Widget>[];
  for (int i = 0; i < children.length; i++) {
    if (i > 0) {
      items.add(SizedBox(height: gap));
    }
    items.add(children[i]);
  }
  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: items);
}

// ---- Chip ------------------------------------------------------------------------------------------------------------

enum ChipKind { neutral, soon, ok, warn, bad, info, yellow, dark }

class N11Chip extends StatelessWidget {
  const N11Chip(this.label, {super.key, this.kind = ChipKind.neutral});

  final String label;
  final ChipKind kind;

  @override
  Widget build(BuildContext context) {
    final (Color background, Color ink) = switch (kind) {
      ChipKind.neutral => (N11Colors.chipSoon, N11Colors.ink2),
      ChipKind.soon => (N11Colors.chipSoon, N11Colors.ink2),
      ChipKind.ok => (N11Colors.successSoft, N11Colors.successInk),
      ChipKind.warn => (N11Colors.yellowSoft, N11Colors.black),
      ChipKind.bad => (N11Colors.errorSoft, N11Colors.errorInk),
      ChipKind.info => (N11Colors.black, N11Colors.white),
      ChipKind.yellow => (N11Colors.yellow, N11Colors.black),
      ChipKind.dark => (N11Colors.black, N11Colors.white),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(kRadiusPill)),
      child: Text(label, style: TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w700, color: ink)),
    );
  }
}

// ---- Banner ----------------------------------------------------------------------------------------------------------

enum BannerKind { info, warn, error, success }

class N11Banner extends StatelessWidget {
  const N11Banner({super.key, required this.kind, required this.title, this.text, this.meta, this.icon, this.trailing});

  final BannerKind kind;
  final String title;
  final String? text;

  /// A smaller second line (for example "last check").
  final String? meta;

  /// Replaces the round "!" / "i" / check mark.
  final IconData? icon;

  /// Placed under the text (an action).
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final (Color background, Color border, Color ink, Color badge, Color badgeInk, String glyph) = switch (kind) {
      BannerKind.error => (N11Colors.errorSoft, N11Colors.errorBorder, N11Colors.errorInk, N11Colors.error, N11Colors.white, '!'),
      BannerKind.success => (N11Colors.successSoft, N11Colors.successBorder, N11Colors.successInk, N11Colors.success, N11Colors.white, '✓'),
      BannerKind.warn => (N11Colors.yellowSoft, N11Colors.yellow, N11Colors.black, N11Colors.yellow, N11Colors.black, '!'),
      BannerKind.info => (N11Colors.white, N11Colors.line, N11Colors.black, N11Colors.black, N11Colors.white, 'i'),
    };
    return Container(
      padding: const EdgeInsets.all(N11Space.gap3),
      decoration: BoxDecoration(color: background, border: Border.all(color: border), borderRadius: BorderRadius.circular(kRadiusControl)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 22,
            height: 22,
            margin: const EdgeInsets.only(top: 1),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: badge, shape: BoxShape.circle),
            child: icon != null ? Icon(icon, size: 14, color: badgeInk) : Text(glyph, style: TextStyle(fontSize: 12, height: 1, fontWeight: FontWeight.w800, color: badgeInk)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: DefaultTextStyle.merge(
              style: TextStyle(color: ink),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: TextStyle(fontSize: 14, height: 1.4, fontWeight: FontWeight.w700, color: ink)),
                  if (text != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(text!, style: TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w500, color: ink))),
                  if (meta != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(meta!, style: TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w500, color: ink))),
                  if (trailing != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: trailing),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Buttons ---------------------------------------------------------------------------------------------------------

/// primary = yellow, secondary = outlined ("ghost" of the design), dark = charcoal.
enum ButtonKind { primary, secondary, dark }

class N11Button extends StatefulWidget {
  const N11Button({super.key, required this.label, this.onPressed, this.kind = ButtonKind.primary, this.icon, this.compact = false, this.loading = false});

  final String label;

  /// Null = unavailable (drawn disabled).
  final VoidCallback? onPressed;
  final ButtonKind kind;
  final IconData? icon;

  /// Compact buttons size to their content (still >= 44 px high); normal ones fill the width and are 48 px high.
  final bool compact;

  /// Shows a spinner and the loading shade; the button does nothing while loading.
  final bool loading;

  @override
  State<N11Button> createState() => _N11ButtonState();
}

class _N11ButtonState extends State<N11Button> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final bool enabled = widget.onPressed != null && !widget.loading;
    final bool unavailable = widget.onPressed == null && !widget.loading;
    Color background = switch (widget.kind) {
      ButtonKind.primary => _pressed && enabled ? N11Colors.yellowStrong : N11Colors.yellow,
      ButtonKind.secondary => _pressed && enabled ? N11Colors.bg : N11Colors.white,
      ButtonKind.dark => N11Colors.black,
    };
    Color ink = widget.kind == ButtonKind.dark ? N11Colors.white : N11Colors.black;
    Color border = widget.kind == ButtonKind.secondary ? N11Colors.line : Colors.transparent;
    if (widget.loading) {
      background = N11Colors.yellowHover;
    }
    if (unavailable) {
      background = N11Colors.disabledBg;
      ink = N11Colors.disabledInk;
      border = Colors.transparent;
    }
    final BorderRadius radius = BorderRadius.circular(kRadiusControl);
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      excludeSemantics: true,
      onTap: enabled ? widget.onPressed : null,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (TapDownDetails _) => setState(() => _pressed = true) : null,
        onTapCancel: () => setState(() => _pressed = false),
        onTapUp: (TapUpDetails _) => setState(() => _pressed = false),
        onTap: enabled ? widget.onPressed : null,
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: widget.compact ? kTapMin : kControlHeight),
          child: DecoratedBox(
            decoration: BoxDecoration(color: background, border: Border.all(color: border), borderRadius: radius),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: N11Space.gap4, vertical: 4),
              child: Row(
                mainAxisSize: widget.compact ? MainAxisSize.min : MainAxisSize.max,
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  if (widget.loading) ...<Widget>[
                    SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: ink)),
                    const SizedBox(width: 10),
                  ] else if (widget.icon != null) ...<Widget>[
                    Icon(widget.icon, size: 20, color: ink),
                    const SizedBox(width: N11Space.gap2),
                  ],
                  Flexible(child: Text(widget.label, textAlign: TextAlign.center, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ink))),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A text link (yellow-strong, underlined) of the design: "Quên mật khẩu?", "Chưa có tài khoản? Đăng ký".
class N11Link extends StatelessWidget {
  const N11Link(this.label, {super.key, this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(8),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kTapMin),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Center(
              widthFactor: 1,
              child: Text(label, textAlign: TextAlign.center, style: onPressed == null ? N11Text.link.copyWith(color: N11Colors.disabledInk, decorationColor: N11Colors.disabledInk) : N11Text.link),
            ),
          ),
        ),
      ),
    );
  }
}

/// The reason a business action is not available yet (03-ui-catalog C10). Always visible text, not a tooltip.
class ReasonNote extends StatelessWidget {
  const ReasonNote(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Padding(padding: EdgeInsets.only(top: 2), child: Icon(Icons.lock_outline, size: 16, color: N11Colors.ink3)),
        const SizedBox(width: N11Space.gap2),
        Expanded(child: Text(text, style: N11Text.captionInk2)),
      ],
    );
  }
}

/// A business action that is not connected yet: the button is unavailable AND its reason is written under it.
class GatedButton extends StatelessWidget {
  const GatedButton({super.key, required this.label, required this.reason, this.kind = ButtonKind.primary, this.icon, this.compact = false});

  final String label;
  final String reason;
  final ButtonKind kind;
  final IconData? icon;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: compact ? CrossAxisAlignment.start : CrossAxisAlignment.stretch,
      children: <Widget>[
        N11Button(label: label, kind: kind, icon: icon, compact: compact),
        const SizedBox(height: N11Space.gap2),
        ReasonNote(reason),
      ],
    );
  }
}

// ---- Headings, steps, state, avatar, checklist, choice ---------------------------------------------------------------

/// Title with a one-line explanation (the `h` block of the design). [centered] for the welcome screen.
class N11Heading extends StatelessWidget {
  const N11Heading(this.title, {super.key, this.sub, this.centered = false, this.size});

  final String title;
  final String? sub;
  final bool centered;
  final double? size;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: centered ? CrossAxisAlignment.center : CrossAxisAlignment.start,
      children: <Widget>[
        Text(title, textAlign: centered ? TextAlign.center : TextAlign.start, style: (size == null ? N11Text.title : N11Text.title.copyWith(fontSize: size))),
        if (sub != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(sub!, textAlign: centered ? TextAlign.center : TextAlign.start, style: N11Text.lead)),
      ],
    );
  }
}

/// "Bước 2/4 · Số điện thoại" with the segmented bar.
class N11Steps extends StatelessWidget {
  const N11Steps({super.key, required this.count, required this.current, this.label});

  final int count;
  final int current;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            for (int i = 0; i < count; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: 4),
              Expanded(child: Container(height: 4, decoration: BoxDecoration(color: i < current ? N11Colors.yellow : N11Colors.line, borderRadius: BorderRadius.circular(2)))),
            ],
          ],
        ),
        const SizedBox(height: 6),
        Text('Bước $current/$count${label == null ? '' : ' · $label'}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: N11Colors.ink2)),
      ],
    );
  }
}

enum StateKind { ok, error, warn }

/// A full-screen outcome: round 72 px mark, title and one sentence ("Phiên đăng nhập đã hết hạn", "Đã lưu").
class N11StateBlock extends StatelessWidget {
  const N11StateBlock({super.key, required this.kind, required this.title, this.text, this.icon});

  final StateKind kind;
  final String title;
  final String? text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (Color background, Color ink, String glyph) = switch (kind) {
      StateKind.ok => (N11Colors.success, N11Colors.white, '✓'),
      StateKind.error => (N11Colors.error, N11Colors.white, '!'),
      StateKind.warn => (N11Colors.yellow, N11Colors.black, '!'),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 24, 8, 8),
      child: Column(
        children: <Widget>[
          Container(
            width: 72,
            height: 72,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: background, shape: BoxShape.circle),
            child: icon != null ? Icon(icon, size: 34, color: ink) : Text(glyph, style: TextStyle(fontSize: 34, height: 1, fontWeight: FontWeight.w800, color: ink)),
          ),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, height: 1.25, fontWeight: FontWeight.w800, color: N11Colors.black)),
          if (text != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(text!, textAlign: TextAlign.center, style: N11Text.lead)),
        ],
      ),
    );
  }
}

/// Account header: yellow initial, name, phone and role chips.
class N11AvatarCard extends StatelessWidget {
  const N11AvatarCard({super.key, required this.name, required this.phone, this.chips = const <Widget>[], this.nameKey, this.phoneKey});

  final String name;
  final String phone;
  final List<Widget> chips;
  final Key? nameKey;
  final Key? phoneKey;

  @override
  Widget build(BuildContext context) {
    final List<String> words = name.trim().split(RegExp(r'\s+')).where((String w) => w.isNotEmpty).toList();
    final String initial = words.isEmpty ? '•' : String.fromCharCode(words.last.runes.first).toUpperCase();
    return N11Card(
      child: Row(
        children: <Widget>[
          Container(
            width: 56,
            height: 56,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: N11Colors.yellow, shape: BoxShape.circle),
            child: Text(initial, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: N11Colors.black)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(name, key: nameKey, style: const TextStyle(fontSize: 16, height: 1.3, fontWeight: FontWeight.w800, color: N11Colors.black)),
                Padding(padding: const EdgeInsets.only(top: 2, bottom: 8), child: Text(phone, key: phoneKey, style: N11Text.caption)),
                if (chips.isNotEmpty) Wrap(spacing: 6, runSpacing: 6, children: chips),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum CheckState { done, missing, todo }

class N11CheckItem {
  const N11CheckItem(this.label, this.state);

  final String label;
  final CheckState state;
}

/// Checklist card: yellow tick = done, red "!" = missing, empty ring = not yet.
class N11CheckList extends StatelessWidget {
  const N11CheckList({super.key, required this.items});

  final List<N11CheckItem> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: N11Space.gap4, vertical: 6),
      decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusCard)),
      child: Column(
        children: <Widget>[
          for (final N11CheckItem item in items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Row(
                children: <Widget>[
                  Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: switch (item.state) { CheckState.done => N11Colors.yellow, CheckState.missing => N11Colors.errorSoft, CheckState.todo => null },
                      border: item.state == CheckState.todo ? Border.all(color: N11Colors.line, width: 2) : null,
                    ),
                    child: Text(
                      switch (item.state) { CheckState.done => '✓', CheckState.missing => '!', CheckState.todo => '' },
                      style: TextStyle(fontSize: 13, height: 1, fontWeight: FontWeight.w800, color: item.state == CheckState.missing ? N11Colors.errorInk : N11Colors.black),
                    ),
                  ),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(child: Text(item.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: N11Colors.black))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A selectable card with a radio dot (the "Khách hàng" choice).
class N11ChoiceCard extends StatelessWidget {
  const N11ChoiceCard({super.key, required this.title, this.text, this.selected = true, this.onTap});

  final String title;
  final String? text;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(kRadiusCard),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: selected ? N11Colors.yellow : N11Colors.line, width: 2), borderRadius: BorderRadius.circular(kRadiusCard)),
        child: Row(
          children: <Widget>[
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(color: N11Colors.white, shape: BoxShape.circle, border: Border.all(color: selected ? N11Colors.yellow : N11Colors.line, width: selected ? 7 : 2)),
            ),
            const SizedBox(width: N11Space.gap3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: N11Text.bodyStrong),
                  if (text != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(text!, style: N11Text.caption)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Card, list, empty state ----------------------------------------------------------------------------------------

class N11Card extends StatelessWidget {
  const N11Card({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(N11Space.gap4),
      decoration: BoxDecoration(
        color: N11Colors.white,
        border: Border.all(color: N11Colors.line),
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
      child: child,
    );
  }
}

/// A card with a title, an optional status chip, a sentence and key/value rows (the shop summary).
class N11InfoCard extends StatelessWidget {
  const N11InfoCard({super.key, required this.title, this.chip, this.text, this.rows = const <(String, String)>[], this.titleKey, this.textKey});

  final String title;
  final Widget? chip;
  final String? text;
  final List<(String, String)> rows;
  final Key? titleKey;
  final Key? textKey;

  @override
  Widget build(BuildContext context) {
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Expanded(child: Text(title, key: titleKey, style: N11Text.bodyStrong)),
              if (chip != null) ...<Widget>[const SizedBox(width: N11Space.gap2), chip!],
            ],
          ),
          if (text != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(text!, key: textKey, style: N11Text.caption)),
          for (final (String k, String v) in rows)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.only(top: 8),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: N11Colors.line))),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text(k, style: N11Text.caption),
                  const SizedBox(width: N11Space.gap3),
                  Flexible(child: Text(v, textAlign: TextAlign.right, style: const TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w600, color: N11Colors.black))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class N11ListItem extends StatelessWidget {
  const N11ListItem({super.key, required this.icon, required this.title, this.sub, this.onTap, this.trailing, this.soon = false});

  final IconData icon;
  final String title;
  final String? sub;

  /// Null = not available (drawn disabled).
  final VoidCallback? onTap;

  /// Replaces the "Sắp có" chip / chevron.
  final Widget? trailing;

  /// Not built yet: drawn disabled and marked "Sắp có".
  final bool soon;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onTap != null && !soon;
    // A row without an action (a status) is information, not an unavailable feature: only "soon" rows are drawn grey.
    final Color ink = soon ? N11Colors.disabledInk : N11Colors.black;
    final Widget? end = trailing ?? (soon ? const N11Chip('Sắp có', kind: ChipKind.soon) : (enabled ? const Icon(Icons.chevron_right, size: 22, color: N11Colors.ink2) : null));
    return Semantics(
      button: true,
      enabled: enabled,
      label: title,
      excludeSemantics: true,
      onTap: enabled ? onTap : null,
      child: InkWell(
        onTap: enabled ? onTap : null,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: kTapMin + 12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: <Widget>[
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: soon ? N11Colors.chipSoon : N11Colors.yellowSoft, borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, size: 18, color: soon ? N11Colors.disabledInk : N11Colors.black),
                ),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title, style: TextStyle(fontSize: 14, height: 1.4, fontWeight: FontWeight.w600, color: ink)),
                      if (sub != null) Padding(padding: const EdgeInsets.only(top: 1), child: Text(sub!, style: const TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w500, color: N11Colors.ink2))),
                    ],
                  ),
                ),
                if (end != null) ...<Widget>[const SizedBox(width: N11Space.gap2), end],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class N11List extends StatelessWidget {
  const N11List({super.key, required this.children, this.title});

  final List<Widget> children;

  /// Small grey heading above the card ("Cửa hàng", "Cài đặt").
  final String? title;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      if (i > 0) {
        rows.add(const Divider(height: 1, thickness: 1, color: N11Colors.line));
      }
      rows.add(children[i]);
    }
    final Widget card = Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: N11Colors.white,
        border: Border.all(color: N11Colors.line),
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
      child: Material(color: Colors.transparent, child: Column(children: rows)),
    );
    if (title == null) {
      return card;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(padding: const EdgeInsets.fromLTRB(4, 0, 4, 8), child: Text(title!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.ink2))),
        card,
      ],
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.text});

  final IconData icon;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: N11Space.gap8, horizontal: N11Space.gap4),
      child: Column(
        children: <Widget>[
          Container(
            width: 72,
            height: 72,
            margin: const EdgeInsets.only(bottom: N11Space.gap2),
            decoration: const BoxDecoration(color: N11Colors.yellowSoft, shape: BoxShape.circle),
            child: Icon(icon, size: 32, color: N11Colors.black),
          ),
          Text(title, textAlign: TextAlign.center, style: N11Text.h2),
          const SizedBox(height: N11Space.gap2),
          Text(text, textAlign: TextAlign.center, style: N11Text.lead),
        ],
      ),
    );
  }
}

// ---- Text field ------------------------------------------------------------------------------------------------------

enum FieldTone { normal, error, ok }

/// Labelled input of the design: white, 48 px, 14 px radius; focus = 2 px yellow + soft ring; error = 2 px red + soft ring. A password
/// field ([password]) carries its own "Hiện / Ẩn" switch.
class N11Field extends StatefulWidget {
  const N11Field({
    super.key,
    required this.fieldKey,
    required this.label,
    required this.controller,
    this.keyboard,
    this.password = false,
    this.maxLength,
    this.onChanged,
    this.enabled = true,
    this.hint,
    this.placeholder,
    this.tone = FieldTone.normal,
    this.optionalLabel = false,
    this.suffix,
    this.textInputAction,
  });

  final Key fieldKey;
  final String label;
  final TextEditingController controller;
  final TextInputType? keyboard;
  final bool password;
  final int? maxLength;
  final VoidCallback? onChanged;
  final bool enabled;

  /// Help or error line under the field, coloured by [tone].
  final String? hint;
  final String? placeholder;
  final FieldTone tone;

  /// Adds " · không bắt buộc" to the label.
  final bool optionalLabel;
  final Widget? suffix;
  final TextInputAction? textInputAction;

  @override
  State<N11Field> createState() => _N11FieldState();
}

class _N11FieldState extends State<N11Field> {
  final FocusNode _focus = FocusNode();
  bool _hidden = true;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool focused = _focus.hasFocus;
    final bool error = widget.tone == FieldTone.error;
    final bool ok = widget.tone == FieldTone.ok;
    final Color borderColor = error ? N11Colors.error : (ok ? N11Colors.success : (focused ? N11Colors.yellow : N11Colors.line));
    final double borderWidth = error || focused ? 2 : 1;
    final Color? ring = error ? N11Colors.errorSoft : (focused ? N11Colors.yellowSoft : null);
    final Color hintInk = error ? N11Colors.errorInk : (ok ? N11Colors.successInk : N11Colors.ink2);
    final OutlineInputBorder none = OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: BorderSide.none);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text.rich(TextSpan(children: <InlineSpan>[
          TextSpan(text: widget.label, style: N11Text.label),
          if (widget.optionalLabel) const TextSpan(text: ' · không bắt buộc', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: N11Colors.ink2)),
        ])),
        const SizedBox(height: 6),
        Container(
          decoration: BoxDecoration(
            color: widget.enabled ? N11Colors.white : N11Colors.bg,
            borderRadius: BorderRadius.circular(kRadiusControl),
            border: Border.all(color: borderColor, width: borderWidth),
            boxShadow: ring == null ? null : <BoxShadow>[BoxShadow(color: ring, spreadRadius: 3)],
          ),
          child: TextField(
            key: widget.fieldKey,
            controller: widget.controller,
            focusNode: _focus,
            enabled: widget.enabled,
            keyboardType: widget.keyboard,
            textInputAction: widget.textInputAction,
            obscureText: widget.password && _hidden,
            maxLength: widget.maxLength,
            autocorrect: false,
            enableSuggestions: !widget.password,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: N11Colors.black),
            cursorColor: N11Colors.black,
            onChanged: widget.onChanged == null ? null : (String _) => widget.onChanged!(),
            decoration: InputDecoration(
              counterText: '',
              isDense: true,
              hintText: widget.placeholder,
              hintStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: N11Colors.placeholder),
              border: none,
              enabledBorder: none,
              focusedBorder: none,
              disabledBorder: none,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              suffixIcon: widget.password
                  ? TextButton(
                      key: Key('${(widget.fieldKey as ValueKey<String>).value}-toggle'),
                      onPressed: widget.enabled ? () => setState(() => _hidden = !_hidden) : null,
                      style: TextButton.styleFrom(minimumSize: const Size(kTapMin, kTapMin), padding: const EdgeInsets.symmetric(horizontal: 14), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                      child: Text(_hidden ? 'Hiện' : 'Ẩn', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: N11Colors.ink2)),
                    )
                  : widget.suffix,
            ),
          ),
        ),
        if (widget.hint != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(widget.hint!, style: TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w500, color: hintInk))),
      ],
    );
  }
}

// ---- App bar and bottom navigation ---------------------------------------------------------------------------------

class N11AppBar extends StatelessWidget {
  const N11AppBar({super.key, this.title, this.logo, this.onBack});

  final String? title;

  /// Brand logo on the left (home screens); replaces the back button and the title.
  final Widget? logo;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 52),
      decoration: const BoxDecoration(color: N11Colors.white, border: Border(bottom: BorderSide(color: N11Colors.line))),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: logo != null
          ? Align(alignment: Alignment.centerLeft, child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: logo))
          : Row(
              children: <Widget>[
                if (onBack != null)
                  SizedBox(
                    width: kTapMin,
                    height: kTapMin,
                    child: IconButton(
                      onPressed: onBack,
                      tooltip: 'Quay lại',
                      padding: EdgeInsets.zero,
                      icon: const Icon(Icons.chevron_left, size: 32, color: N11Colors.black),
                    ),
                  ),
                if (onBack == null) const SizedBox(width: 4),
                Expanded(child: Semantics(header: true, child: Text(title ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: N11Text.barTitle))),
              ],
            ),
    );
  }
}

class NavItem {
  const NavItem({required this.id, required this.label, required this.icon});

  final String id;
  final String label;
  final IconData icon;
}

class N11BottomNav extends StatelessWidget {
  const N11BottomNav({super.key, required this.items, required this.activeIndex, required this.onSelect});

  final List<NavItem> items;
  final int activeIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(color: N11Colors.white, border: Border(top: BorderSide(color: N11Colors.line))),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            children: <Widget>[
              for (int i = 0; i < items.length; i++)
                Expanded(
                  child: _NavTab(
                    key: Key('tab-${items[i].id}'),
                    item: items[i],
                    active: i == activeIndex,
                    onTap: () => onSelect(i),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavTab extends StatelessWidget {
  const _NavTab({super.key, required this.item, required this.active, required this.onTap});

  final NavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      label: item.label,
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(kRadiusControl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Column(
            // Without min the bar would grow to the whole screen height (Scaffold gives its bottom bar loose, tall constraints).
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Container(
                width: 56,
                height: 28,
                decoration: BoxDecoration(color: active ? N11Colors.yellowSoft : Colors.transparent, borderRadius: BorderRadius.circular(kRadiusPill)),
                child: Icon(item.icon, size: 20, color: active ? N11Colors.black : N11Colors.ink2),
              ),
              const SizedBox(height: 2),
              Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, fontWeight: active ? FontWeight.w800 : FontWeight.w600, color: active ? N11Colors.black : N11Colors.ink2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../tokens.dart';

// Shared components of the 11Food / 11Ship phone UI. Port of apps/client-shared/public/components.css (class prefix c-):
// every interactive control is >= 44 px and 48 px for buttons; a disabled business action always shows its reason as text.

/// A column with the same gap between children (the `c-stack` of the web UI).
Widget vstack(List<Widget> children, {double gap = N11Space.gap4}) {
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

enum ChipKind { neutral, soon, ok, warn, bad, info }

class N11Chip extends StatelessWidget {
  const N11Chip(this.label, {super.key, this.kind = ChipKind.neutral});

  final String label;
  final ChipKind kind;

  @override
  Widget build(BuildContext context) {
    final (Color background, Color ink) = switch (kind) {
      ChipKind.neutral => (N11Colors.disabledBg, N11Colors.ink2),
      ChipKind.soon => (N11Colors.chipSoon, N11Colors.ink3),
      ChipKind.ok => (N11Colors.successSoft, N11Colors.success),
      ChipKind.warn => (N11Colors.yellowSoft, N11Colors.chipWarnInk),
      ChipKind.bad => (N11Colors.errorSoft, N11Colors.error),
      ChipKind.info => (N11Colors.infoSoft, N11Colors.info),
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
  final IconData? icon;

  /// Placed under the text (an action).
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final (Color background, Color iconColor, Color titleColor, IconData defaultIcon) = switch (kind) {
      BannerKind.info => (N11Colors.infoSoft, N11Colors.info, N11Colors.black, Icons.info_outline),
      BannerKind.warn => (N11Colors.yellowSoft, N11Colors.yellowStrong, N11Colors.black, Icons.warning_amber_outlined),
      BannerKind.error => (N11Colors.errorSoft, N11Colors.error, N11Colors.error, Icons.error_outline),
      BannerKind.success => (N11Colors.successSoft, N11Colors.success, N11Colors.black, Icons.check_circle_outline),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: N11Space.gap4, vertical: N11Space.gap3),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(kRadiusControl)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon ?? defaultIcon, size: 20, color: iconColor)),
          const SizedBox(width: N11Space.gap3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: TextStyle(fontSize: 14, height: 1.45, fontWeight: FontWeight.w700, color: titleColor)),
                if (text != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(text!, style: const TextStyle(fontSize: 14, height: 1.45, color: N11Colors.ink2))),
                if (meta != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(meta!, style: const TextStyle(fontSize: 14, height: 1.45, color: N11Colors.ink2))),
                if (trailing != null) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: trailing),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Buttons ---------------------------------------------------------------------------------------------------------

enum ButtonKind { primary, secondary }

class N11Button extends StatelessWidget {
  const N11Button({super.key, required this.label, this.onPressed, this.kind = ButtonKind.primary, this.icon, this.compact = false});

  final String label;

  /// Null = unavailable (drawn disabled).
  final VoidCallback? onPressed;
  final ButtonKind kind;
  final IconData? icon;

  /// Compact buttons size to their content (still >= 44 px high); normal ones fill the width and are 48 px high.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPressed != null;
    final Color background = !enabled ? N11Colors.disabledBg : (kind == ButtonKind.primary ? N11Colors.yellow : N11Colors.white);
    final Color ink = !enabled ? N11Colors.disabledInk : N11Colors.black;
    final Color border = !enabled ? Colors.transparent : (kind == ButtonKind.primary ? Colors.transparent : N11Colors.lineStrong);
    final BorderRadius radius = BorderRadius.circular(kRadiusControl);
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      excludeSemantics: true,
      onTap: onPressed,
      child: Material(
        color: background,
        shape: RoundedRectangleBorder(borderRadius: radius, side: BorderSide(color: border, width: 1.5)),
        child: InkWell(
          onTap: onPressed,
          borderRadius: radius,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: compact ? kTapMin : kControlHeight),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: N11Space.gap4),
              child: Row(
                mainAxisSize: compact ? MainAxisSize.min : MainAxisSize.max,
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  if (icon != null) ...<Widget>[Icon(icon, size: 20, color: ink), const SizedBox(width: N11Space.gap2)],
                  Flexible(child: Text(label, textAlign: TextAlign.center, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ink))),
                ],
              ),
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
    final Color ink = enabled ? N11Colors.black : N11Colors.disabledInk;
    final Widget? end = trailing ?? (soon ? const N11Chip('Sắp có', kind: ChipKind.soon) : (enabled ? const Icon(Icons.chevron_right, color: N11Colors.ink3) : null));
    return Semantics(
      button: true,
      enabled: enabled,
      label: title,
      excludeSemantics: true,
      onTap: enabled ? onTap : null,
      child: InkWell(
        onTap: enabled ? onTap : null,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: N11Space.gap4, vertical: N11Space.gap2),
            child: Row(
              children: <Widget>[
                Icon(icon, size: 22, color: enabled ? N11Colors.ink2 : N11Colors.disabledInk),
                const SizedBox(width: N11Space.gap3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title, style: N11Text.bodyStrong.copyWith(color: ink)),
                      if (sub != null) Text(sub!, style: N11Text.caption),
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
  const N11List({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      if (i > 0) {
        rows.add(const Divider(height: 1, thickness: 1, color: N11Colors.line));
      }
      rows.add(children[i]);
    }
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: N11Colors.white,
        border: Border.all(color: N11Colors.line),
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
      child: Material(color: Colors.transparent, child: Column(children: rows)),
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
            decoration: const BoxDecoration(color: N11Colors.field, shape: BoxShape.circle),
            child: Icon(icon, size: 32, color: N11Colors.ink3),
          ),
          Text(title, textAlign: TextAlign.center, style: N11Text.h2),
          const SizedBox(height: N11Space.gap2),
          Text(text, textAlign: TextAlign.center, style: N11Text.lead),
        ],
      ),
    );
  }
}

// ---- App bar and bottom navigation ---------------------------------------------------------------------------------

class N11AppBar extends StatelessWidget {
  const N11AppBar({super.key, this.title, this.logo, this.onBack});

  final String? title;

  /// Brand logo on the left (home screens); replaces the back button and the centred title.
  final Widget? logo;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    if (logo != null) {
      return Container(
        color: N11Colors.white,
        constraints: const BoxConstraints(minHeight: 56),
        padding: const EdgeInsets.symmetric(horizontal: N11Space.pad, vertical: 4),
        alignment: Alignment.centerLeft,
        child: logo,
      );
    }
    return Container(
      color: N11Colors.white,
      constraints: const BoxConstraints(minHeight: 56),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Row(
        children: <Widget>[
          SizedBox(
            width: kTapMin + 4,
            height: kTapMin,
            child: onBack == null ? null : IconButton(onPressed: onBack, tooltip: 'Quay lại', icon: const Icon(Icons.arrow_back)),
          ),
          Expanded(
            child: Semantics(header: true, child: Text(title ?? '', textAlign: TextAlign.center, style: N11Text.barTitle)),
          ),
          const SizedBox(width: kTapMin + 4),
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
          padding: const EdgeInsets.fromLTRB(4, 6, 4, 6),
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
          constraints: const BoxConstraints(minHeight: 56),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Container(
                width: 44,
                height: 28,
                decoration: BoxDecoration(color: active ? N11Colors.yellow : Colors.transparent, borderRadius: BorderRadius.circular(kRadiusPill)),
                child: Icon(item.icon, size: 22, color: active ? N11Colors.black : N11Colors.ink3),
              ),
              const SizedBox(height: 2),
              Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, fontWeight: active ? FontWeight.w800 : FontWeight.w600, color: active ? N11Colors.black : N11Colors.ink3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

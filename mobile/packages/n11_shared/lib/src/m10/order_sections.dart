import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tokens.dart';

// Issue #191: the pieces the three order-detail pages share. [OrderSection] is one card that opens and closes on its own (an independent accordion: opening one
// never closes another); while it is closed only its title and one useful line are drawn and its body is NOT built (a map, a chat list or a long list costs
// nothing). [QuickCall] opens the phone's dialer with the number; it never places the call.

/// A card whose body opens and closes by touching its header. [summary] stays visible when closed; [trailing] (a call button, for example) stays
/// visible and usable in both states. The body is built only while open, so the state of what it holds (a chat's controller) must live above it.
class OrderSection extends StatefulWidget {
  const OrderSection({super.key, required this.id, required this.title, required this.summary, required this.builder, this.initiallyExpanded = false, this.trailing, this.onChanged});

  /// Short stable name; the keys `section-<id>`, `section-<id>-header` and `section-<id>-body` are derived from it.
  final String id;
  final String title;
  final String summary;
  final WidgetBuilder builder;
  final bool initiallyExpanded;
  final Widget? trailing;
  final ValueChanged<bool>? onChanged;

  @override
  State<OrderSection> createState() => _OrderSectionState();
}

class _OrderSectionState extends State<OrderSection> {
  late bool _open = widget.initiallyExpanded;

  void _toggle() {
    setState(() => _open = !_open);
    widget.onChanged?.call(_open);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: Key('section-${widget.id}'),
      decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusCard)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Semantics(
                  button: true,
                  expanded: _open,
                  label: '${widget.title}. ${widget.summary}. ${_open ? 'Đang mở, chạm để thu gọn' : 'Đang thu gọn, chạm để mở'}',
                  excludeSemantics: true,
                  child: InkWell(
                    key: Key('section-${widget.id}-header'),
                    onTap: _toggle,
                    borderRadius: BorderRadius.circular(kRadiusCard),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 56),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(N11Space.gap4, N11Space.gap2, 0, N11Space.gap2),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            Text(widget.title, style: N11Text.label),
                            if (widget.summary.isNotEmpty) Text(widget.summary, key: Key('section-${widget.id}-summary'), maxLines: 2, overflow: TextOverflow.ellipsis, style: N11Text.caption),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              if (widget.trailing != null) Padding(padding: const EdgeInsets.only(left: N11Space.gap2), child: widget.trailing),
              InkWell(
                onTap: _toggle,
                borderRadius: BorderRadius.circular(kRadiusCard),
                child: SizedBox(width: 48, height: 56, child: Icon(_open ? Icons.expand_less : Icons.expand_more, color: N11Colors.ink2, semanticLabel: _open ? 'Thu gọn' : 'Mở')),
              ),
            ],
          ),
          if (_open) Padding(key: Key('section-${widget.id}-body'), padding: const EdgeInsets.fromLTRB(N11Space.gap4, 0, N11Space.gap4, N11Space.gap4), child: widget.builder(context)),
        ],
      ),
    );
  }
}

// ---- the phone dialer ------------------------------------------------------------------------------------------------

final RegExp _vnLocal = RegExp(r'^0[0-9]{9}$');
final RegExp _vnIntl = RegExp(r'^\+84[0-9]{9}$');

/// The number as the dialer wants it (+84XXXXXXXXX), or null when [raw] is not a Vietnamese number written plainly. Spaces, dots and dashes people type are
/// ignored; anything else (letters, a second number, a USSD code) is NOT a number and gets no call button.
String? dialNumberOf(String? raw) {
  if (raw == null) {
    return null;
  }
  final String s = raw.replaceAll(RegExp(r'[ .\-()]'), '');
  if (_vnIntl.hasMatch(s)) {
    return s;
  }
  if (_vnLocal.hasMatch(s)) {
    return '+84${s.substring(1)}';
  }
  return null;
}

/// 0912 345 678 for reading; null when [raw] is not a number.
String? dialNumberText(String? raw) {
  final String? n = dialNumberOf(raw);
  if (n == null) {
    return null;
  }
  final String local = '0${n.substring(3)}';
  return '${local.substring(0, 4)} ${local.substring(4, 7)} ${local.substring(7)}';
}

/// What only the phone can do. Answers false (never throws) when nothing can handle the request, so the caller falls back to copying the number.
abstract class PhoneDialer {
  const PhoneDialer();

  /// Opens the dialer with the number filled in. It does NOT place the call and needs no CALL_PHONE permission.
  Future<bool> dial(String phone);
}

class MethodChannelPhoneDialer extends PhoneDialer {
  const MethodChannelPhoneDialer({MethodChannel? channel}) : _channel = channel;

  final MethodChannel? _channel;

  MethodChannel get _c => _channel ?? const MethodChannel('vn.eleven.n11/dialer');

  @override
  Future<bool> dial(String phone) async {
    if (!_vnIntl.hasMatch(phone)) {
      return false;
    }
    try {
      return await _c.invokeMethod<bool>('dial', <String, Object?>{'phone': phone}) ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// The dialer of this build; a test replaces it.
PhoneDialer orderPhoneDialer = const MethodChannelPhoneDialer();

/// "Gọi" next to a person's name or number. Shown only for a number that is really one ([dialNumberOf]); it opens the dialer and, when the phone cannot, copies
/// the number and says so, so the person is never left with a dead button.
class QuickCall extends StatelessWidget {
  const QuickCall({super.key, required this.phone, this.who = ''});

  final String? phone;

  /// For the screen reader and the test key: "shipper", "quán", "khách".
  final String who;

  Future<void> _press(BuildContext context, String number) async {
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
    final bool opened = await orderPhoneDialer.dial(number);
    if (opened) {
      return;
    }
    await Clipboard.setData(ClipboardData(text: number));
    messenger?.showSnackBar(const SnackBar(content: Text('Không mở được ứng dụng gọi. Đã sao chép số điện thoại.')));
  }

  @override
  Widget build(BuildContext context) {
    final String? number = dialNumberOf(phone);
    if (number == null) {
      return const SizedBox.shrink();
    }
    return Semantics(
      button: true,
      label: who.isEmpty ? 'Gọi' : 'Gọi $who',
      excludeSemantics: true,
      child: TextButton.icon(
        key: Key('quick-call-${who.isEmpty ? 'phone' : who}'),
        style: TextButton.styleFrom(backgroundColor: N11Colors.yellowSoft, foregroundColor: N11Colors.black, minimumSize: const Size(72, kTapMin), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusControl))),
        onPressed: () => _press(context, number),
        icon: const Icon(Icons.call, size: 18),
        label: const Text('Gọi', style: N11Text.bodyStrong),
      ),
    );
  }
}

/// A person on the order: name, a line (status) and the number with the call button next to them. Used for the shop, the shipper and the recipient.
class ContactRow extends StatelessWidget {
  const ContactRow({super.key, required this.name, this.detail, this.phone, required this.who, this.showCall = true});

  final String name;
  final String? detail;
  final String? phone;
  final String who;

  /// False when the card's header already carries the call button (one "Gọi" per person on screen).
  final bool showCall;

  @override
  Widget build(BuildContext context) {
    final String? shown = dialNumberText(phone);
    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(name, style: N11Text.bodyStrong),
              if (detail != null) Text(detail!, style: N11Text.caption),
              if (shown != null) Text(shown, key: Key('contact-$who-phone'), style: N11Text.body),
            ],
          ),
        ),
        if (showCall) QuickCall(phone: phone, who: who),
      ],
    );
  }
}

import 'package:flutter/widgets.dart';

import 'session_controller.dart';

/// Shows [child] only while the session it was opened under is still the live, signed-in one (#295).
///
/// A screen of a signed-in account (the wallet) that stays open after logout, a ended session or a login of another account would keep
/// showing the first account's numbers. Here it draws nothing from that moment and the whole stack goes back to the first route, so the
/// next account never sees the previous one's data, not even for a frame.
class SessionGuard extends StatefulWidget {
  const SessionGuard({super.key, required this.session, required this.child});

  final SessionController session;
  final Widget child;

  @override
  State<SessionGuard> createState() => _SessionGuardState();
}

class _SessionGuardState extends State<SessionGuard> {
  late final int _epoch;
  bool _leaving = false;

  bool get _valid => widget.session.status == SessionStatus.signedIn && widget.session.sessionEpoch == _epoch;

  @override
  void initState() {
    super.initState();
    _epoch = widget.session.sessionEpoch;
    widget.session.addListener(_changed);
    if (!_valid) {
      _leave();
    }
  }

  @override
  void dispose() {
    widget.session.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (!_valid && !_leaving) {
      _leave();
      if (mounted) {
        setState(() {});
      }
    }
  }

  void _leave() {
    _leaving = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
      }
    });
  }

  @override
  Widget build(BuildContext context) => _valid ? widget.child : const SizedBox.shrink();
}

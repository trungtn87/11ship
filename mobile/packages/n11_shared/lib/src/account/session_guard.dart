import 'package:flutter/widgets.dart';

import '../wallet/wallet_http.dart';
import '../wallet/wallet_source.dart';
import 'session_controller.dart';

/// Shows [child] only while the session it was opened under is still the live, signed-in one (#295).
///
/// A screen of a signed-in account (the wallet) that stays open after logout, a ended session or a login of another account would keep
/// showing the first account's numbers. Here it draws nothing from that moment and the whole stack goes back to the first route, so the
/// next account never sees the previous one's data, not even for a frame.
class SessionGuard extends StatefulWidget {
  const SessionGuard({super.key, required this.session, required this.epoch, required this.child});

  final SessionController session;
  /// The session epoch the guarded data belongs to, fixed by the caller when it created the source / route. It is never read again at build time:
  /// an account change between that moment and the first build already makes the guard invalid (#295).
  final int epoch;
  final Widget child;

  @override
  State<SessionGuard> createState() => _SessionGuardState();
}

class _SessionGuardState extends State<SessionGuard> {
  bool _leaving = false;

  bool get _valid => widget.session.status == SessionStatus.signedIn && widget.session.sessionEpoch == widget.epoch;

  @override
  void initState() {
    super.initState();
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

/// Puts [child] under a [SessionGuard] when it shows data of a server wallet [source] (its epoch is the one it was created under); any other source
/// (sample / not wired) holds no account data and is returned as is.
Widget guardForWalletSource(WalletSource? source, Widget child) =>
    source is HttpWalletSource ? SessionGuard(session: source.session, epoch: source.epoch, child: child) : child;

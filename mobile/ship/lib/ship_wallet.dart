import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// M04: how the Ship app reaches the wallet screens. Real builds read and write the Shipper's wallet on the SERVER through the signed session
// (HttpWalletSource): the balance, the holds, the history, topup and withdrawal REQUESTS. Nothing is ever shown that the server did not say. The sample source
// exists only in a preview build: flutter build apk --dart-define=M04_UI_PREVIEW=true. The main tabs are unchanged.

const bool kM04UiPreview = bool.fromEnvironment('M04_UI_PREVIEW');

/// One wallet source per session, created on first use (the keys of unfinished writes live in it and must outlive a screen).
/// A new account (a new session epoch) gets a fresh source: nothing of the previous account (its pending keys, its limits) is carried over (#295).
final Expando<({int epoch, WalletSource source})> _sources = Expando<({int epoch, WalletSource source})>('ship-wallet-source');

/// The wallet data source of this build. Without a session (the widget tests of the frame) the not-wired source answers: no number exists.
WalletSource buildWalletSource({bool preview = kM04UiPreview, SessionController? session}) {
  if (preview) {
    return SampleWalletSource();
  }
  if (session == null) {
    return const NotWiredWalletSource();
  }
  final ({int epoch, WalletSource source})? known = _sources[session];
  if (known != null && known.epoch == session.sessionEpoch) {
    return known.source;
  }
  final WalletSource fresh = HttpWalletSource(session: session);
  _sources[session] = (epoch: session.sessionEpoch, source: fresh);
  return fresh;
}

/// The wallet screen of this session. It closes itself (and everything above it) the moment the session is no longer the signed-in one it was opened under.
Route<void> walletHomeRoute(SessionController session, WalletSource source) =>
    n11Route(SessionGuard(session: session, child: WalletHomeScreen(source: source)));

/// The "Ví của tôi" row (used inside an N11List: Tài khoản, or [WalletEntry]).
class WalletListItem extends StatelessWidget {
  const WalletListItem({super.key, this.source, this.session});

  /// Tests pass their own; the app uses [buildWalletSource] over its session.
  final WalletSource? source;
  final SessionController? session;

  @override
  Widget build(BuildContext context) {
    final WalletSource wallet = source ?? buildWalletSource(session: session);
    return N11ListItem(
      icon: Icons.account_balance_wallet_outlined,
      title: 'Ví của tôi',
      sub: wallet.isSample ? kSampleLabel : (wallet is NotWiredWalletSource ? 'Chưa kết nối máy chủ' : 'Số dư, nạp và rút tiền'),
      onTap: () => Navigator.of(context).push(session == null ? n11Route(WalletHomeScreen(source: wallet)) : walletHomeRoute(session!, wallet)),
    );
  }
}

/// Prominent entry at the top of Thu nhập: a card holding the wallet row.
class WalletEntry extends StatelessWidget {
  const WalletEntry({super.key, this.source, this.session});

  final WalletSource? source;
  final SessionController? session;

  @override
  Widget build(BuildContext context) => session != null && session!.status != SessionStatus.signedIn
      ? const SizedBox.shrink()
      : N11List(children: <Widget>[WalletListItem(key: const Key('wallet-entry'), source: source, session: session)]);
}

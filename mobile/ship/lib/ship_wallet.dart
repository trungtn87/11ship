import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// M04: how the Ship app reaches the wallet screens. Real builds read and write the Shipper's wallet on the SERVER through the signed session
// (HttpWalletSource): the balance, the holds, the history, topup and withdrawal REQUESTS. Nothing is ever shown that the server did not say. The sample source
// exists only in a preview build: flutter build apk --dart-define=M04_UI_PREVIEW=true. The main tabs are unchanged.

const bool kM04UiPreview = bool.fromEnvironment('M04_UI_PREVIEW');

/// One wallet source per session, created on first use (the keys of unfinished writes live in it and must outlive a screen).
final Expando<WalletSource> _sources = Expando<WalletSource>('ship-wallet-source');

/// The wallet data source of this build. Without a session (the widget tests of the frame) the not-wired source answers: no number exists.
WalletSource buildWalletSource({bool preview = kM04UiPreview, SessionController? session}) {
  if (preview) {
    return SampleWalletSource();
  }
  if (session == null) {
    return const NotWiredWalletSource();
  }
  return _sources[session] ??= HttpWalletSource(session: session);
}

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
      onTap: () => Navigator.of(context).push(n11Route(WalletHomeScreen(source: wallet))),
    );
  }
}

/// Prominent entry at the top of Thu nhập: a card holding the wallet row.
class WalletEntry extends StatelessWidget {
  const WalletEntry({super.key, this.source, this.session});

  final WalletSource? source;
  final SessionController? session;

  @override
  Widget build(BuildContext context) => N11List(children: <Widget>[WalletListItem(key: const Key('wallet-entry'), source: source, session: session)]);
}

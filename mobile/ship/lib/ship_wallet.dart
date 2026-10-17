import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// M04 UI phase: how the Ship app reaches the wallet screens. Real builds get the not-wired source (no balance, every write disabled with its
// reason). The sample source exists only in a preview build: flutter build apk --dart-define=M04_UI_PREVIEW=true. The main tabs are unchanged.

const bool kM04UiPreview = bool.fromEnvironment('M04_UI_PREVIEW');

/// The wallet data source of this build.
WalletSource buildWalletSource({bool preview = kM04UiPreview}) => preview ? SampleWalletSource() : const NotWiredWalletSource();

/// The "Ví của tôi" row (used inside an N11List: Tài khoản, or [WalletEntry]).
class WalletListItem extends StatelessWidget {
  const WalletListItem({super.key, this.source});

  /// Tests pass their own; the app uses [buildWalletSource].
  final WalletSource? source;

  @override
  Widget build(BuildContext context) {
    final WalletSource wallet = source ?? buildWalletSource();
    return N11ListItem(
      icon: Icons.account_balance_wallet_outlined,
      title: 'Ví của tôi',
      sub: wallet.isSample ? kSampleLabel : (wallet.canWrite ? 'Số dư, nạp và rút tiền' : 'Chưa kết nối máy chủ'),
      onTap: () => Navigator.of(context).push(n11Route(WalletHomeScreen(source: wallet))),
    );
  }
}

/// Prominent entry at the top of Thu nhập: a card holding the wallet row.
class WalletEntry extends StatelessWidget {
  const WalletEntry({super.key, this.source});

  final WalletSource? source;

  @override
  Widget build(BuildContext context) => N11List(children: <Widget>[WalletListItem(key: const Key('wallet-entry'), source: source)]);
}

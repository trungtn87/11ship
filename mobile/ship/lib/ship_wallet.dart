import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// M04: how the Ship app reaches the wallet screens. Real builds read and write the Shipper's wallet on the SERVER through the signed session
// (HttpWalletSource): the balance, the holds, the history, topup and withdrawal REQUESTS. Nothing is ever shown that the server did not say. The sample source
// exists only in a preview build: flutter build apk --dart-define=M04_UI_PREVIEW=true. The main tabs are unchanged.
//
// #396: the wallet is ONE page, "Ví tiền": balance, top-up, financial requests, stop activity / withdraw, recent transactions. It is reached only from
// Tài khoản (and the income card / notifications), never from Home.

const bool kM04UiPreview = bool.fromEnvironment('M04_UI_PREVIEW');

/// One wallet source per session, created on first use (the keys of unfinished writes live in it and must outlive a screen).
/// A new account (a new session epoch) gets a fresh source: nothing of the previous account (its pending keys, its limits) is carried over (#295).
final Expando<({int epoch, WalletSource source})> _sources =
    Expando<({int epoch, WalletSource source})>('ship-wallet-source');

/// The wallet data source of this build. Without a session (the widget tests of the frame) the not-wired source answers: no number exists.
WalletSource buildWalletSource(
    {bool preview = kM04UiPreview, SessionController? session}) {
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

/// The "Ví tiền" page of this session. It closes itself (and everything above it) the moment the session is no longer the signed-in one it was opened
/// under. [driver] adds the "Dừng hoạt động / Rút tiền" entry; without it that entry is simply not shown.
Route<void> walletHomeRoute(SessionController session, WalletSource source,
        {DriverController? driver}) =>
    n11Route(guardForWalletSource(source,
        shipWalletPage(source: source, session: session, driver: driver)));

/// The page itself (#396): the wallet screen with the Shipper's money actions placed between its notes and its recent transactions.
Widget shipWalletPage(
        {required WalletSource source,
        SessionController? session,
        DriverController? driver}) =>
    WalletHomeScreen(
      source: source,
      title: 'Ví tiền',
      extraSections: <Widget>[
        Builder(
            builder: (BuildContext context) =>
                _ShipWalletActions(session: session, driver: driver)),
      ],
    );

/// "Yêu cầu & trao đổi tài chính" (the real FinanceRequestsScreen) and "Dừng hoạt động / Rút tiền" (the real DriverActivityScreen, which only
/// allows the withdrawal of the whole balance while the account is CLOSING). Shown only for a signed-in session; guests never get here.
class _ShipWalletActions extends StatelessWidget {
  const _ShipWalletActions({this.session, this.driver});
  final SessionController? session;
  final DriverController? driver;

  @override
  Widget build(BuildContext context) {
    final SessionController? s = session;
    final DriverController? d = driver;
    if (s == null || s.status != SessionStatus.signedIn) {
      return const SizedBox.shrink();
    }
    return N11List(
      title: 'Yêu cầu & dừng hoạt động',
      children: <Widget>[
        N11ListItem(
          key: const Key('wallet-requests-entry'),
          icon: Icons.chat_outlined,
          title: 'Yêu cầu & trao đổi tài chính',
          sub: 'Yêu cầu nạp, chưa đọc và lịch sử xử lý',
          onTap: () => Navigator.of(context)
              .push(n11Route(FinanceRequestsScreen(session: s))),
        ),
        if (d != null)
          N11ListItem(
            key: const Key('wallet-closure-entry'),
            icon: Icons.account_balance_outlined,
            title: 'Dừng hoạt động / Rút tiền',
            sub: 'Gửi yêu cầu dừng; rút toàn bộ số dư khi tài khoản đã đóng',
            onTap: () => Navigator.of(context).push(driverWalletRoute(
                s,
                (WalletSource wallet) =>
                    DriverActivityScreen(controller: d, walletSource: wallet))),
          ),
      ],
    );
  }
}

/// The "Ví tiền" row (used inside an N11List: Tài khoản, or [WalletEntry]).
class WalletListItem extends StatelessWidget {
  const WalletListItem({super.key, this.source, this.session, this.driver});

  /// Tests pass their own; the app uses [buildWalletSource] over its session.
  final WalletSource? source;
  final SessionController? session;
  final DriverController? driver;

  @override
  Widget build(BuildContext context) {
    final WalletSource wallet = source ?? buildWalletSource(session: session);
    return N11ListItem(
      icon: Icons.account_balance_wallet_outlined,
      title: 'Ví tiền',
      sub: wallet.isSample
          ? kSampleLabel
          : (wallet is NotWiredWalletSource
              ? 'Chưa kết nối máy chủ'
              : 'Số dư, yêu cầu, nạp và rút tiền'),
      onTap: () => Navigator.of(context).push(session == null
          ? n11Route(shipWalletPage(source: wallet, driver: driver))
          : walletHomeRoute(session!, wallet, driver: driver)),
    );
  }
}

/// Prominent entry at the top of Thu nhập: a card holding the wallet row.
class WalletEntry extends StatelessWidget {
  const WalletEntry({super.key, this.source, this.session, this.driver});

  final WalletSource? source;
  final SessionController? session;
  final DriverController? driver;

  @override
  Widget build(BuildContext context) =>
      session != null && session!.status != SessionStatus.signedIn
          ? const SizedBox.shrink()
          : N11List(children: <Widget>[
              WalletListItem(
                  key: const Key('wallet-entry'),
                  source: source,
                  session: session,
                  driver: driver)
            ]);
}

/// A route of the driver profile / activity (they hold the wallet source and push the withdrawal screen). The source is created here, once, and its
/// epoch is the one the guard checks: the route closes the moment the session is no longer that signed-in one (#295).
Route<void> driverWalletRoute(
    SessionController session, Widget Function(WalletSource wallet) build) {
  final WalletSource wallet = buildWalletSource(session: session);
  return n11Route(guardForWalletSource(wallet, build(wallet)));
}

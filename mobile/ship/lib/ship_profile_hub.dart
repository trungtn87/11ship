import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

import 'ship_wallet.dart';

/// #396 "Thông tin & Hồ sơ": ONE entry on Tài khoản for the personal information and the shipper profile, as two internal sections. It reuses the
/// existing ProfileScreen (personal information) and DriverProfileScreen (shipper profile, review status, receiving conditions). It adds no second
/// online switch: turning online stays on Home. A locked wallet-only account sees only its personal information.
class ShipProfileHub extends StatelessWidget {
  const ShipProfileHub({super.key, required this.session, this.driver});

  final SessionController session;
  final DriverController? driver;

  @override
  Widget build(BuildContext context) {
    final DriverController? d = driver;
    final bool locked = session.identity?.lockedWalletOnly ?? false;
    return N11FormScaffold(
      title: 'Thông tin & Hồ sơ',
      session: session,
      children: <Widget>[
        N11List(
          title: 'Tài khoản',
          children: <Widget>[
            N11ListItem(
              key: const Key('profile-personal-entry'),
              icon: Icons.badge_outlined,
              title: 'Thông tin cá nhân',
              sub: 'Xem và sửa họ tên',
              onTap: () => Navigator.of(context)
                  .push(n11Route(ProfileScreen(session: session))),
            ),
          ],
        ),
        if (!locked && d == null)
          N11List(
            title: 'Hồ sơ shipper',
            children: <Widget>[
              N11ListItem(
                key: const Key('profile-shipper-unavailable'),
                icon: Icons.badge_outlined,
                title: 'Hồ sơ shipper',
                sub: kUnavailableReason,
                soon: true,
                trailing: const N11Chip('Chưa nối', kind: ChipKind.soon),
              ),
            ],
          ),
        if (!locked && d != null)
          N11List(
            title: 'Hồ sơ shipper',
            children: <Widget>[
              // The review status (PENDING / ACTIVE / SUSPENDED / CLOSING / CLOSED or not yet registered) and its one action are on that screen.
              N11ListItem(
                key: const Key('shipper-profile-entry'),
                icon: Icons.badge_outlined,
                title: 'Hồ sơ và điều kiện nhận đơn',
                sub:
                    'Trạng thái xét duyệt, tài khoản nhận tiền, điều kiện nhận đơn',
                onTap: () => Navigator.of(context).push(driverWalletRoute(
                    session,
                    (WalletSource wallet) => DriverProfileScreen(
                        controller: d, walletSource: wallet))),
              ),
              N11ListItem(
                key: const Key('shipper-refresh-entry'),
                icon: Icons.refresh,
                title: 'Cập nhật điều kiện nhận đơn',
                sub: 'Làm mới trạng thái từ máy chủ',
                onTap: d.busy ? null : d.load,
              ),
            ],
          ),
      ],
    );
  }
}

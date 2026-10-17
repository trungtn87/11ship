import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../flows/shop_views.dart' show ShopStartScreen;
import '../widgets/components.dart';
import 'm02_flows.dart';
import 'shop_manage_views.dart';

/// The body of the "Quán" tab of 11Food. It grants nothing: the tab is shown by the account's own roles / onboarding state (the
/// shell decides), and the management screens need the shop context the SERVER holds for this session. The person enters that mode
/// with their own tap (`POST /v1/client-auth/context`, refused by the server when not allowed); nothing here switches it for them.
class ShopTab extends StatelessWidget {
  const ShopTab({super.key, required this.session, required this.flows});

  final SessionController session;
  final M02Flows flows;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (BuildContext context, Widget? child) {
        final identity = session.identity;
        final bool owner = identity?.availableRoles.contains('SHOP_OWNER') ?? false;
        final bool inShopMode = identity?.activeRole == 'SHOP_OWNER';
        final onboarding = flows.onboarding;
        if (identity == null) {
          return const SizedBox.shrink();
        }
        if (!owner) {
          // A profile that exists but is not an active shop yet (the M01 onboarding finishes it).
          return vstack(<Widget>[
            const N11StateBlock(
              kind: StateKind.warn,
              icon: Icons.storefront_outlined,
              title: 'Hồ sơ quán chưa hoàn tất',
              text: 'Hoàn tất hồ sơ để mở khu vực quản lý quán. Quyền quản lý do hệ thống cấp sau khi hồ sơ đủ điều kiện.',
            ),
            if (onboarding != null)
              N11Button(
                key: const Key('shop-tab-continue'),
                label: 'Tiếp tục hồ sơ',
                onPressed: () => Navigator.of(context).push(n11Route(ShopStartScreen(controller: onboarding, m02: flows))),
              ),
          ]);
        }
        if (!inShopMode) {
          return ListenableBuilder(
            listenable: onboarding ?? session,
            builder: (BuildContext context, Widget? child) {
              final failure = onboarding?.failure;
              return vstack(<Widget>[
                const N11StateBlock(
                  kind: StateKind.ok,
                  icon: Icons.storefront_outlined,
                  title: 'Quản lý quán của bạn',
                  text: 'Bạn đang ở chế độ khách hàng. Vào chế độ quản lý quán để xem trạng thái, sửa giờ hoạt động và thực đơn.',
                ),
                if (failure != null) N11Banner(key: const Key('shop-tab-error'), kind: BannerKind.error, title: 'Chưa chuyển được chế độ', text: failureMessage(failure)),
                N11Button(
                  key: const Key('shop-tab-enter'),
                  label: 'Vào chế độ quản lý quán',
                  loading: onboarding?.busy ?? false,
                  onPressed: onboarding == null || onboarding.busy ? null : () => onboarding.switchContext('SHOP_OWNER'),
                ),
              ]);
            },
          );
        }
        return vstack(<Widget>[
          ShopManageScreen(flows: flows, embedded: true),
          if (onboarding != null)
            N11Button(
              key: const Key('shop-tab-leave'),
              label: 'Về chế độ khách hàng',
              kind: ButtonKind.secondary,
              onPressed: onboarding.busy ? null : () => onboarding.switchContext('CUSTOMER'),
            ),
        ]);
      },
    );
  }
}

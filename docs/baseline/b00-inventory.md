# B-00 Kiểm kê tự động 11Ship

Main SHA `fb3ba2ce18ada300dbbf65749096f400780f4e31`. Đối chiếu với `docs/baseline/requirements.md` v0.6 (PR #298, bbfce73) và ma trận B-02 của Codex (comment 6560506383).

**Cách map:** một mục được tính "có map" khi đường dẫn file, đường dẫn route, tên bảng hoặc tên màn hình xuất hiện trong baseline hoặc ma trận B-02. Đây là kiểm theo chuỗi, chưa đọc ngữ nghĩa. Mục "CHƯA MAP" là ứng viên để Phase 3 đối chiếu, chưa phải kết luận thiếu yêu cầu.

| Loại | Tổng | Có map | Chưa map |
|---|---|---|---|
| backend-module | 69 | 49 | 20 |
| route | 412 | 325 | 87 |
| table | 141 | 69 | 72 |
| admin-view | 36 | 6 | 30 |
| mobile-screen | 64 | 55 | 9 |
| runner | 15 | 7 | 8 |
| workflow | 11 | 3 | 8 |

## Danh sách CHƯA MAP


### backend-module (20)

| Tên | Vị trí |
|---|---|
| `admin-accounts` | `apps/backend/src/admin-accounts` |
| `admin-activation` | `apps/backend/src/admin-activation` |
| `admin-finance` | `apps/backend/src/admin-finance` |
| `admin-invitations` | `apps/backend/src/admin-invitations` |
| `admin-m12` | `apps/backend/src/admin-m12` |
| `admin-menu-categories` | `apps/backend/src/admin-menu-categories` |
| `admin-orders` | `apps/backend/src/admin-orders` |
| `admin-provisioning` | `apps/backend/src/admin-provisioning` |
| `auth` | `apps/backend/src/auth` |
| `client-device` | `apps/backend/src/client-device` |
| `crypto` | `apps/backend/src/crypto` |
| `customer-profile` | `apps/backend/src/customer-profile` |
| `health` | `apps/backend/src/health` |
| `http` | `apps/backend/src/http` |
| `logging` | `apps/backend/src/logging` |
| `order-timeouts` | `apps/backend/src/order-timeouts` |
| `shared` | `apps/backend/src/shared` |
| `sms-gateway` | `apps/backend/src/sms-gateway` |
| `test-sms` | `apps/backend/src/test-sms` |
| `transaction` | `apps/backend/src/transaction` |

### route (87)

| Tên | Vị trí |
|---|---|
| `GET /v1/admin-auth/users` | `apps/backend/src/admin-accounts/admin-account-read.controller.ts:47` |
| `GET /v1/admin-auth/users/:user_id` | `apps/backend/src/admin-accounts/admin-account-read.controller.ts:53` |
| `GET /v1/admin-auth/administrators` | `apps/backend/src/admin-accounts/admin-account-read.controller.ts:60` |
| `GET /v1/admin-auth/permissions` | `apps/backend/src/admin-accounts/admin-account-read.controller.ts:79` |
| `POST /v1/start` | `apps/backend/src/admin-activation/admin-activation.controller.ts:86` |
| `POST /v1/restart` | `apps/backend/src/admin-activation/admin-activation.controller.ts:95` |
| `GET /v1/state` | `apps/backend/src/admin-activation/admin-activation.controller.ts:108` |
| `POST /v1/otp/request` | `apps/backend/src/admin-activation/admin-activation.controller.ts:118` |
| `POST /v1/otp/verify` | `apps/backend/src/admin-activation/admin-activation.controller.ts:131` |
| `POST /v1/password` | `apps/backend/src/admin-activation/admin-activation.controller.ts:144` |
| `POST /v1/totp/enrollment` | `apps/backend/src/admin-activation/admin-activation.controller.ts:157` |
| `POST /v1/complete` | `apps/backend/src/admin-activation/admin-activation.controller.ts:170` |
| `GET /v1/admin/deliveries` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:31` |
| `GET /v1/admin/deliveries/:delivery_id` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:37` |
| `POST /v1/admin/deliveries/:delivery_id/actions/:action` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:44` |
| `GET /v1/admin/deliveries/:delivery_id/chat` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:65` |
| `POST /v1/admin/deliveries/:delivery_id/chat` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:71` |
| `GET /v1/admin/deliveries/:delivery_id/chat-hold` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:78` |
| `POST /v1/admin/deliveries/:delivery_id/chat-hold/:change` | `apps/backend/src/admin-deliveries/admin-delivery.controller.ts:85` |
| `GET /v1/admin/finance/overview` | `apps/backend/src/admin-finance/admin-finance.controller.ts:34` |
| `GET /v1/admin/finance/wallets` | `apps/backend/src/admin-finance/admin-finance.controller.ts:41` |
| `GET /v1/admin/finance/wallets/:driver_id` | `apps/backend/src/admin-finance/admin-finance.controller.ts:47` |
| `GET /v1/admin/finance/transactions` | `apps/backend/src/admin-finance/admin-finance.controller.ts:54` |
| `GET /v1/admin/finance/reconciliation` | `apps/backend/src/admin-finance/admin-finance.controller.ts:60` |
| `POST /v1/admin/finance/reconciliation/check` | `apps/backend/src/admin-finance/admin-finance.controller.ts:67` |
| `GET /v1/admin/finance/commission-policy` | `apps/backend/src/admin-finance/admin-finance.controller.ts:76` |
| `POST /v1/admin/finance/commission-policy` | `apps/backend/src/admin-finance/admin-finance.controller.ts:83` |
| `GET /v1/admin/finance/withdrawal-source-accounts` | `apps/backend/src/admin-finance/admin-finance.controller.ts:95` |
| `GET /v1/admin/finance/withdrawals` | `apps/backend/src/admin-finance/admin-finance.controller.ts:102` |
| `GET /v1/admin/finance/withdrawals/:withdrawal_id` | `apps/backend/src/admin-finance/admin-finance.controller.ts:108` |
| `POST /v1/admin/finance/withdrawals/:withdrawal_id/start-processing` | `apps/backend/src/admin-finance/admin-finance.controller.ts:115` |
| `POST /v1/admin/finance/withdrawals/:withdrawal_id/mark-paid` | `apps/backend/src/admin-finance/admin-finance.controller.ts:125` |
| `POST /v1/admin/finance/withdrawals/:withdrawal_id/report-reconciliation` | `apps/backend/src/admin-finance/admin-finance.controller.ts:135` |
| `POST /v1/admin/finance/withdrawals/:withdrawal_id/reconcile` | `apps/backend/src/admin-finance/admin-finance.controller.ts:145` |
| `GET /v1/admin/menu-categories` | `apps/backend/src/admin-menu-categories/admin-menu-category.controller.ts:44` |
| `POST /v1/admin/menu-categories` | `apps/backend/src/admin-menu-categories/admin-menu-category.controller.ts:55` |
| `POST /v1/admin/menu-categories/:category_id` | `apps/backend/src/admin-menu-categories/admin-menu-category.controller.ts:72` |
| `GET /v1/admin/orders` | `apps/backend/src/admin-orders/admin-order.controller.ts:31` |
| `GET /v1/admin/orders/:order_id` | `apps/backend/src/admin-orders/admin-order.controller.ts:37` |
| `POST /v1/admin/orders/:order_id/actions/:action` | `apps/backend/src/admin-orders/admin-order.controller.ts:44` |
| `GET /v1/admin/orders/:order_id/chat` | `apps/backend/src/admin-orders/admin-order.controller.ts:65` |
| `POST /v1/admin/orders/:order_id/chat` | `apps/backend/src/admin-orders/admin-order.controller.ts:71` |
| `GET /v1/admin/orders/:order_id/chat-hold` | `apps/backend/src/admin-orders/admin-order.controller.ts:78` |
| `POST /v1/admin/orders/:order_id/chat-hold/:change` | `apps/backend/src/admin-orders/admin-order.controller.ts:86` |
| `POST /v1/admin/operations` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:59` |
| `POST /v1/admin/operations/:operation_id/verify` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:72` |
| `GET /v1/admin/operations/:operation_id` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:87` |
| `POST /v1/admin/invitations` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:94` |
| `GET /v1/admin/invitations` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:111` |
| `GET /v1/admin/invitations/:invitation_id` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:118` |
| `POST /v1/admin/invitations/:invitation_id/reissue` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:125` |
| `POST /v1/admin/invitations/:invitation_id/revoke` | `apps/backend/src/admin-provisioning/admin-provisioning.controller.ts:143` |
| `POST /v1/auth/phone-verifications` | `apps/backend/src/auth/auth.controller.ts:43` |
| `GET /v1/auth/phone-verifications/:verificationId` | `apps/backend/src/auth/auth.controller.ts:51` |
| `POST /v1/auth/phone-verifications/:verificationId/verify` | `apps/backend/src/auth/auth.controller.ts:56` |
| `POST /v1/auth/register` | `apps/backend/src/auth/auth.controller.ts:68` |
| `POST /v1/auth/login` | `apps/backend/src/auth/auth.controller.ts:82` |
| `POST /v1/auth/role/select` | `apps/backend/src/auth/auth.controller.ts:89` |
| `GET /v1/auth/me` | `apps/backend/src/auth/auth.controller.ts:97` |
| `POST /v1/client-auth/device/challenges` | `apps/backend/src/client-device/client-device.controller.ts:17` |
| `POST /v1/client-auth/device/registrations` | `apps/backend/src/client-device/client-device.controller.ts:24` |
| `GET /v1/customer/me/profile` | `apps/backend/src/customer-profile/customer-profile.controller.ts:21` |
| `PUT /v1/customer/me/profile` | `apps/backend/src/customer-profile/customer-profile.controller.ts:27` |
| `POST /v1/discovery/route-distances` | `apps/backend/src/discovery-route/discovery-route.controller.ts:13` |
| `GET /v1/driver/wallet` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:33` |
| `GET /v1/driver/wallet/holds` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:39` |
| `GET /v1/driver/wallet/transactions` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:46` |
| `GET /v1/driver/wallet/withdrawal-account` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:53` |
| `GET /v1/driver/wallet/withdrawals` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:59` |
| `POST /v1/driver/wallet/withdrawals` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:66` |
| `GET /v1/driver/wallet/withdrawals/:withdrawal_id` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:72` |
| `POST /v1/driver/wallet/withdrawals/:withdrawal_id/cancel` | `apps/backend/src/driver-wallet/driver-wallet.controller.ts:78` |
| `GET /v1/health/live` | `apps/backend/src/health/health.controller.ts:13` |
| `GET /v1/health/ready` | `apps/backend/src/health/health.controller.ts:18` |
| `GET /v1/admin/system-settings/order-parameters` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:50` |
| `POST /v1/admin/system-settings/order-parameters/draft` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:62` |
| `POST /v1/admin/system-settings/order-parameters/apply` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:72` |
| `POST /v1/admin/system-settings/order-parameters/preview` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:82` |
| `GET /v1/admin/system-settings/order-parameters` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:121` |
| `POST /v1/admin/system-settings/order-parameters` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:133` |
| `GET /v1/admin/system-settings/order-parameters` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:166` |
| `POST /v1/admin/system-settings/order-parameters` | `apps/backend/src/shipping-policy/shipping-fee-policy.controller.ts:178` |
| `GET /v1/onboarding/shop/setup` | `apps/backend/src/shop-setup/shop-setup.controller.ts:14` |
| `POST /v1/sms-gateway/heartbeat` | `apps/backend/src/sms-gateway/sms-gateway.controller.ts:29` |
| `POST /v1/sms-gateway/jobs/claim` | `apps/backend/src/sms-gateway/sms-gateway.controller.ts:36` |
| `POST /v1/sms-gateway/jobs/:jobId/ack` | `apps/backend/src/sms-gateway/sms-gateway.controller.ts:58` |
| `GET /v1/sms-gateway/update/:releaseId` | `apps/backend/src/sms-gateway/sms-gateway.controller.ts:70` |

### table (72)

| Tên | Vị trí |
|---|---|
| `shop_members` | `database/migrations/1791590400000_create-shop-onboarding.sql` |
| `shop_business_hours` | `database/migrations/1791763200000_create-shop-business-hours.sql` |
| `admin_memberships` | `database/migrations/1792022400000_create-admin-auth.sql` |
| `admin_auth_challenges` | `database/migrations/1792022400000_create-admin-auth.sql` |
| `admin_totp_factors` | `database/migrations/1792022400000_create-admin-auth.sql` |
| `admin_sessions` | `database/migrations/1792022400000_create-admin-auth.sql` |
| `admin_auth_limit_config` | `database/migrations/1792022400000_create-admin-auth.sql` |
| `admin_auth_limits` | `database/migrations/1792022400000_create-admin-auth.sql` |
| `admin_profiles` | `database/migrations/1792281600000_create-admin-activation.sql` |
| `admin_app_permissions` | `database/migrations/1792281600000_create-admin-activation.sql` |
| `client_device_challenges` | `database/migrations/1792886400000_create-client-device-binding.sql` |
| `client_device_bindings` | `database/migrations/1792886400000_create-client-device-binding.sql` |
| `client_device_key_links` | `database/migrations/1792886400000_create-client-device-binding.sql` |
| `client_device_registration_grants` | `database/migrations/1792886400000_create-client-device-binding.sql` |
| `client_session_bindings` | `database/migrations/1792886400000_create-client-device-binding.sql` |
| `client_device_request_nonces` | `database/migrations/1792886400000_create-client-device-binding.sql` |
| `menu_images` | `database/migrations/1793145600000_create-menu.sql` |
| `menu_items` | `database/migrations/1793145600000_create-menu.sql` |
| `driver_bank_accounts` | `database/migrations/1793318400000_create-shipper-management.sql` |
| `driver_events` | `database/migrations/1793318400000_create-shipper-management.sql` |
| `shipper_wallet_parameters` | `database/migrations/1793318400000_create-shipper-management.sql` |
| `shipper_wallet_parameter_changes` | `database/migrations/1793318400000_create-shipper-management.sql` |
| `shipping_eligibility_parameters` | `database/migrations/1793664000000_create-shipping-eligibility-parameters.sql` |
| `shipping_eligibility_parameter_changes` | `database/migrations/1793664000000_create-shipping-eligibility-parameters.sql` |
| `shipping_fee_policy_versions` | `database/migrations/1793750400000_create-shipping-fee-policy.sql` |
| `shipping_fee_policy_drafts` | `database/migrations/1793750400000_create-shipping-fee-policy.sql` |
| `shipping_fee_agreements` | `database/migrations/1793836800000_m06-v1-1-three-tiers-agreement.sql` |
| `shipping_fee_agreement_events` | `database/migrations/1793836800000_m06-v1-1-three-tiers-agreement.sql` |
| `customer_carts` | `database/migrations/1794268800000_create-m10-orders.sql` |
| `order_items` | `database/migrations/1794268800000_create-m10-orders.sql` |
| `order_events` | `database/migrations/1794268800000_create-m10-orders.sql` |
| `reviews` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `review_moderations` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `review_replies` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `review_reply_history` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `complaints` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `complaint_messages` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `complaint_attachments` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `complaint_reconsiderations` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `complaint_adjustments` | `database/migrations/1794355200000_create-m11-reviews-complaints.sql` |
| `wallet_commission_policies` | `database/migrations/1795132800000_create-wallet-withdrawals.sql` |
| `wallet_withdrawals` | `database/migrations/1795132800000_create-wallet-withdrawals.sql` |
| `wallet_withdrawal_events` | `database/migrations/1795132800000_create-wallet-withdrawals.sql` |
| `ops_config` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_admin_scopes` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_incidents` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_events` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_checks` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_metrics` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_metrics_hourly` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_notifications` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_maintenance` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_gateway_telemetry` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_ingest_keys` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_releases` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_version_reports` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_deploys` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `ops_backup_reports` | `database/migrations/1795737600000_create-m13-ops.sql` |
| `report_export_jobs` | `database/migrations/1795910400000_create-m12-report-exports.sql` |
| `report_export_files` | `database/migrations/1795910400000_create-m12-report-exports.sql` |
| `backup_records` | `database/migrations/1795996800000_create-m12-backup-restore.sql` |
| `backup_jobs` | `database/migrations/1795996800000_create-m12-backup-restore.sql` |
| `restore_requests` | `database/migrations/1795996800000_create-m12-backup-restore.sql` |
| `order_parameters` | `database/migrations/1796169600000_m07-fee-answer-deadline.sql` |
| `order_parameter_changes` | `database/migrations/1796169600000_m07-fee-answer-deadline.sql` |
| `order_chat_holds` | `database/migrations/1796601600000_create-order-chat.sql` |
| `delivery_tracking_links` | `database/migrations/1797033600000_customer-courier-cod.sql` |
| `address_change_requests` | `database/migrations/1797206400000_order-address-change-guidance.sql` |
| `ops_online_snapshots` | `database/migrations/1797552000000_ops-analytics-anomalies.sql` |
| `ops_anomaly_settings` | `database/migrations/1797552000000_ops-analytics-anomalies.sql` |
| `ops_anomaly_cases` | `database/migrations/1797552000000_ops-analytics-anomalies.sql` |
| `ops_anomaly_case_events` | `database/migrations/1797552000000_ops-analytics-anomalies.sql` |

### admin-view (30)

| Tên | Vị trí |
|---|---|
| `access-view` | `apps/admin-web/src/dom/access-view.ts` |
| `accounts-view` | `apps/admin-web/src/dom/accounts-view.ts` |
| `action-queue-view` | `apps/admin-web/src/dom/action-queue-view.ts` |
| `activation-view` | `apps/admin-web/src/dom/activation-view.ts` |
| `audit-view` | `apps/admin-web/src/dom/audit-view.ts` |
| `backups-view` | `apps/admin-web/src/dom/backups-view.ts` |
| `business-main` | `apps/admin-web/src/dom/business-main.ts` |
| `business-ops` | `apps/admin-web/src/dom/business-ops.ts` |
| `catalog-view` | `apps/admin-web/src/dom/catalog-view.ts` |
| `config-view` | `apps/admin-web/src/dom/config-view.ts` |
| `deliveries-view` | `apps/admin-web/src/dom/deliveries-view.ts` |
| `feedback-view` | `apps/admin-web/src/dom/feedback-view.ts` |
| `finance-admin-view` | `apps/admin-web/src/dom/finance-admin-view.ts` |
| `finance-ops-view` | `apps/admin-web/src/dom/finance-ops-view.ts` |
| `finance-view` | `apps/admin-web/src/dom/finance-view.ts` |
| `monitoring-errors-view` | `apps/admin-web/src/dom/monitoring-errors-view.ts` |
| `notifications-view` | `apps/admin-web/src/dom/notifications-view.ts` |
| `ops-map-panel` | `apps/admin-web/src/dom/ops-map-panel.ts` |
| `order-chat-panel` | `apps/admin-web/src/dom/order-chat-panel.ts` |
| `order-timeouts-page` | `apps/admin-web/src/dom/order-timeouts-page.ts` |
| `orders-view` | `apps/admin-web/src/dom/orders-view.ts` |
| `otp-policy-page` | `apps/admin-web/src/dom/otp-policy-page.ts` |
| `provisioning-view` | `apps/admin-web/src/dom/provisioning-view.ts` |
| `reports-view` | `apps/admin-web/src/dom/reports-view.ts` |
| `reset-start` | `apps/admin-web/src/dom/reset-start.ts` |
| `reset-view` | `apps/admin-web/src/dom/reset-view.ts` |
| `settings-view` | `apps/admin-web/src/dom/settings-view.ts` |
| `shell-app` | `apps/admin-web/src/dom/shell-app.ts` |
| `shippers-view` | `apps/admin-web/src/dom/shippers-view.ts` |
| `shipping-policy-view` | `apps/admin-web/src/dom/shipping-policy-view.ts` |

### mobile-screen (9)

| Tên | Vị trí |
|---|---|
| `ResetScreen` | `mobile/packages/n11_shared/lib/src/flows/reset_views.dart` |
| `ShopStartScreen` | `mobile/packages/n11_shared/lib/src/flows/shop_views.dart` |
| `ShopFormScreen` | `mobile/packages/n11_shared/lib/src/flows/shop_views.dart` |
| `ShopHomeScreen` | `mobile/packages/n11_shared/lib/src/flows/shop_views.dart` |
| `PreviewScreen` | `mobile/packages/n11_shared/lib/src/m02/preview_views.dart` |
| `ShopPublicScreen` | `mobile/packages/n11_shared/lib/src/m02/preview_views.dart` |
| `PublicHoursScreen` | `mobile/packages/n11_shared/lib/src/m02/preview_views.dart` |
| `ShopCallScreen` | `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart` |
| `ShopDeliveryDetailScreen` | `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart` |

### runner (8)

| Tên | Vị trí |
|---|---|
| `business-push-service` | `apps/backend/src/business-dashboard/business-push-service.ts` |
| `idempotency-cleanup` | `apps/backend/src/idempotency/idempotency-cleanup.ts` |
| `push-dispatcher` | `apps/backend/src/notifications/push-dispatcher.ts` |
| `ops-analytics-runtime` | `apps/backend/src/ops-analytics/ops-analytics-runtime.ts` |
| `ops-runtime` | `apps/backend/src/ops/ops-runtime.ts` |
| `order-timeout-sweeper` | `apps/backend/src/order-timeouts/order-timeout-sweeper.ts` |
| `sms-queue-sweeper` | `apps/backend/src/sms-gateway/sms-queue-sweeper.ts` |
| `test-sms-runtime` | `apps/backend/src/test-sms/test-sms-runtime.ts` |

### workflow (8)

| Tên | Vị trí |
|---|---|
| `ai-governance.yml` | `.github/workflows/ai-governance.yml` |
| `ci.yml` | `.github/workflows/ci.yml` |
| `diagnose-vps-release.yml` | `.github/workflows/diagnose-vps-release.yml` |
| `m14-android-runtime.yml` | `.github/workflows/m14-android-runtime.yml` |
| `m14-flutter-runtime.yml` | `.github/workflows/m14-flutter-runtime.yml` |
| `m14-gps-test.yml` | `.github/workflows/m14-gps-test.yml` |
| `no-skip-ci.yml` | `.github/workflows/no-skip-ci.yml` |
| `update-progress.yml` | `.github/workflows/update-progress.yml` |

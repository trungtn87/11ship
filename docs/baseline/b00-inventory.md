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

## Trạng thái đối chiếu 234 mục CHƯA MAP (Lead, 02/11)

**Chưa tuyên bố "đã xử lý hết".** Danh sách trên là kết quả đối chiếu theo chuỗi tại v0.6; nó không tự thay đổi.

Bằng chứng hiện có: Codex gán thủ công từng mục (bình luận PR #298 do Codex chỉnh sửa, đã chép bảng dưới đây vào repo). Lead đã kiểm:

| Kiểm tra | Kết quả |
|---|---|
| Đủ 234 mục của danh sách trên đều có một dòng gán trong bảng của Codex | Đạt (234/234; bảng có 231 khóa duy nhất do vài tên trùng) |
| Mọi Req ID được viện dẫn đều tồn tại trong `requirements.md` v0.7 | Đạt (0 mã lạ) |
| 8 mục ghi `KHÔNG CÓ YÊU CẦU` là hạ tầng/test/quy trình, không phải lệnh xóa | Lead chấp nhận theo mô tả của Codex; chưa kiểm sâu |
| Đúng ngữ nghĩa của từng dòng gán | **Chưa kiểm từng dòng.** Lead xem ngẫu nhiên 14 dòng, thấy hợp lý, nhưng một vài dòng gán rộng (ví dụ `health` gán M13-R-03/04) |

Kết luận: **234/234 mục đã được gán (Req ID hoặc "không có yêu cầu"), CHƯA kiểm ngữ nghĩa từng dòng.** Việc kiểm từng dòng thuộc Phase 3 (review theo module). Mục nào Phase 3 thấy gán sai thì mở lại và sửa baseline hoặc ghi điểm lệch.

### Bảng gán của Codex (nguyên văn, chưa chỉnh)

| Loại | Mục | Req ID hoặc kết luận |
|---|---|---|
| backend-module | `admin-accounts` | M01-R-11, M01-R-12 |
| backend-module | `admin-activation` | M01-R-17 |
| backend-module | `admin-finance` | M04-R-05..09, M04-R-14..15 |
| backend-module | `admin-invitations` | M01-R-17 |
| backend-module | `admin-m12` | M12-R-01..13 |
| backend-module | `admin-menu-categories` | M02-R-15 |
| backend-module | `admin-orders` | M10-R-13, M10-R-20, M12-R-13 |
| backend-module | `admin-provisioning` | M01-R-17 |
| backend-module | `auth` | M01-R-01..08, M01-R-13..14, M01-R-21..22 |
| backend-module | `client-device` | M01-R-19 |
| backend-module | `crypto` | KHÔNG CÓ YÊU CẦU |
| backend-module | `customer-profile` | M05-R-01 |
| backend-module | `health` | M13-R-03, M13-R-04 |
| backend-module | `http` | M00-R-01, M00-R-04 |
| backend-module | `logging` | M13-R-07, M13-R-10 |
| backend-module | `order-timeouts` | M08-R-16, M10-R-11..12, M10-R-26 |
| backend-module | `shared` | KHÔNG CÓ YÊU CẦU |
| backend-module | `sms-gateway` | M01-R-18, M13-R-08 |
| backend-module | `test-sms` | KHÔNG CÓ YÊU CẦU |
| backend-module | `transaction` | M00-R-08 |
| route | `GET /v1/admin-auth/users` | M01-R-11, M01-R-12 |
| route | `GET /v1/admin-auth/users/:user_id` | M01-R-11, M01-R-12 |
| route | `GET /v1/admin-auth/administrators` | M01-R-17, M12-R-03 |
| route | `GET /v1/admin-auth/permissions` | M01-R-17, M12-R-03 |
| route | `POST /v1/start` | M01-R-17 |
| route | `POST /v1/restart` | M01-R-17 |
| route | `GET /v1/state` | M01-R-17 |
| route | `POST /v1/otp/request` | M01-R-17 |
| route | `POST /v1/otp/verify` | M01-R-17 |
| route | `POST /v1/password` | M01-R-17 |
| route | `POST /v1/totp/enrollment` | M01-R-17 |
| route | `POST /v1/complete` | M01-R-17 |
| route | `GET /v1/admin/deliveries` | M07-R-09 |
| route | `GET /v1/admin/deliveries/:delivery_id` | M07-R-09 |
| route | `POST /v1/admin/deliveries/:delivery_id/actions/:action` | M07-R-09, M12-R-13 |
| route | `GET /v1/admin/deliveries/:delivery_id/chat` | M10-R-21, M10-R-22 |
| route | `POST /v1/admin/deliveries/:delivery_id/chat` | M10-R-21, M10-R-22 |
| route | `GET /v1/admin/deliveries/:delivery_id/chat-hold` | M10-R-21, M10-R-22 |
| route | `POST /v1/admin/deliveries/:delivery_id/chat-hold/:change` | M10-R-21, M10-R-22 |
| route | `GET /v1/admin/finance/overview` | M04-R-01, M04-R-02, M04-R-09, M04-R-15 |
| route | `GET /v1/admin/finance/wallets` | M04-R-01, M04-R-02, M04-R-09, M04-R-15 |
| route | `GET /v1/admin/finance/wallets/:driver_id` | M04-R-01, M04-R-02, M04-R-09, M04-R-15 |
| route | `GET /v1/admin/finance/transactions` | M04-R-01, M04-R-02, M04-R-09, M04-R-15 |
| route | `GET /v1/admin/finance/reconciliation` | M04-R-08 |
| route | `POST /v1/admin/finance/reconciliation/check` | M04-R-08 |
| route | `GET /v1/admin/finance/commission-policy` | M04-R-03 |
| route | `POST /v1/admin/finance/commission-policy` | M04-R-03 |
| route | `GET /v1/admin/finance/withdrawal-source-accounts` | M04-R-06 |
| route | `GET /v1/admin/finance/withdrawals` | M03-R-05, M03-R-10, M04-R-09 |
| route | `GET /v1/admin/finance/withdrawals/:withdrawal_id` | M03-R-05, M03-R-10, M04-R-09 |
| route | `POST /v1/admin/finance/withdrawals/:withdrawal_id/start-processing` | M03-R-05, M03-R-10, M04-R-09 |
| route | `POST /v1/admin/finance/withdrawals/:withdrawal_id/mark-paid` | M03-R-05, M03-R-10, M04-R-09 |
| route | `POST /v1/admin/finance/withdrawals/:withdrawal_id/report-reconciliation` | M04-R-08 |
| route | `POST /v1/admin/finance/withdrawals/:withdrawal_id/reconcile` | M03-R-05, M03-R-10, M04-R-09 |
| route | `GET /v1/admin/menu-categories` | M02-R-15 |
| route | `POST /v1/admin/menu-categories` | M02-R-15 |
| route | `POST /v1/admin/menu-categories/:category_id` | M02-R-15 |
| route | `GET /v1/admin/orders` | M10-R-13, M10-R-20 |
| route | `GET /v1/admin/orders/:order_id` | M10-R-13, M10-R-20 |
| route | `POST /v1/admin/orders/:order_id/actions/:action` | M10-R-13, M12-R-13 |
| route | `GET /v1/admin/orders/:order_id/chat` | M10-R-21, M10-R-22 |
| route | `POST /v1/admin/orders/:order_id/chat` | M10-R-21, M10-R-22 |
| route | `GET /v1/admin/orders/:order_id/chat-hold` | M10-R-21, M10-R-22 |
| route | `POST /v1/admin/orders/:order_id/chat-hold/:change` | M10-R-21, M10-R-22 |
| route | `POST /v1/admin/operations` | M01-R-17 |
| route | `POST /v1/admin/operations/:operation_id/verify` | M01-R-17 |
| route | `GET /v1/admin/operations/:operation_id` | M01-R-17 |
| route | `POST /v1/admin/invitations` | M01-R-17 |
| route | `GET /v1/admin/invitations` | M01-R-17 |
| route | `GET /v1/admin/invitations/:invitation_id` | M01-R-17 |
| route | `POST /v1/admin/invitations/:invitation_id/reissue` | M01-R-17 |
| route | `POST /v1/admin/invitations/:invitation_id/revoke` | M01-R-17 |
| route | `POST /v1/auth/phone-verifications` | M01-R-02, M01-R-04..05, M01-R-13..14, M01-R-21..22 |
| route | `GET /v1/auth/phone-verifications/:verificationId` | M01-R-02, M01-R-04..05, M01-R-13..14, M01-R-21..22 |
| route | `POST /v1/auth/phone-verifications/:verificationId/verify` | M01-R-02, M01-R-04..05, M01-R-13..14, M01-R-21..22 |
| route | `POST /v1/auth/register` | M01-R-02, M01-R-04..05, M01-R-13..14, M01-R-21..22 |
| route | `POST /v1/auth/login` | M01-R-01, M01-R-07 |
| route | `POST /v1/auth/role/select` | M01-R-01, M01-R-07 |
| route | `GET /v1/auth/me` | M01-R-01, M01-R-07 |
| route | `POST /v1/client-auth/device/challenges` | M01-R-19 |
| route | `POST /v1/client-auth/device/registrations` | M01-R-19 |
| route | `GET /v1/customer/me/profile` | M05-R-01 |
| route | `PUT /v1/customer/me/profile` | M05-R-01 |
| route | `POST /v1/discovery/route-distances` | M02-R-12 |
| route | `GET /v1/driver/wallet` | M04-R-01..03 |
| route | `GET /v1/driver/wallet/holds` | M04-R-01..03 |
| route | `GET /v1/driver/wallet/transactions` | M04-R-01..03 |
| route | `GET /v1/driver/wallet/withdrawal-account` | M03-R-05, M03-R-10 |
| route | `GET /v1/driver/wallet/withdrawals` | M03-R-05, M03-R-10 |
| route | `POST /v1/driver/wallet/withdrawals` | M03-R-05, M03-R-10 |
| route | `GET /v1/driver/wallet/withdrawals/:withdrawal_id` | M03-R-05, M03-R-10 |
| route | `POST /v1/driver/wallet/withdrawals/:withdrawal_id/cancel` | M03-R-05, M03-R-10 |
| route | `GET /v1/health/live` | M13-R-03, M13-R-04 |
| route | `GET /v1/health/ready` | M13-R-03, M13-R-04 |
| route | `GET /v1/admin/system-settings/order-parameters` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `POST /v1/admin/system-settings/order-parameters/draft` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `POST /v1/admin/system-settings/order-parameters/apply` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `POST /v1/admin/system-settings/order-parameters/preview` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `GET /v1/admin/system-settings/order-parameters` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `POST /v1/admin/system-settings/order-parameters` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `GET /v1/admin/system-settings/order-parameters` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `POST /v1/admin/system-settings/order-parameters` | M06-R-01..04, M06-R-06, M10-R-12 |
| route | `GET /v1/onboarding/shop/setup` | M02-R-01, M02-R-02 |
| route | `POST /v1/sms-gateway/heartbeat` | M01-R-18, M13-R-08 |
| route | `POST /v1/sms-gateway/jobs/claim` | M01-R-18, M13-R-08 |
| route | `POST /v1/sms-gateway/jobs/:jobId/ack` | M01-R-18, M13-R-08 |
| route | `GET /v1/sms-gateway/update/:releaseId` | M01-R-18, M13-R-08 |
| table | `shop_members` | M02-R-01 |
| table | `shop_business_hours` | M02-R-05 |
| table | `admin_memberships` | M01-R-09 |
| table | `admin_auth_challenges` | M01-R-09 |
| table | `admin_totp_factors` | M01-R-09 |
| table | `admin_sessions` | M01-R-09 |
| table | `admin_auth_limit_config` | M01-R-09 |
| table | `admin_auth_limits` | M01-R-09 |
| table | `admin_profiles` | M01-R-17 |
| table | `admin_app_permissions` | M01-R-17 |
| table | `client_device_challenges` | M01-R-19 |
| table | `client_device_bindings` | M01-R-19 |
| table | `client_device_key_links` | M01-R-19 |
| table | `client_device_registration_grants` | M01-R-19 |
| table | `client_session_bindings` | M01-R-19 |
| table | `client_device_request_nonces` | M01-R-19 |
| table | `menu_images` | M02-R-09 |
| table | `menu_items` | M02-R-09 |
| table | `driver_bank_accounts` | M03-R-03, M03-R-10 |
| table | `driver_events` | M03-R-03..04, M03-R-09 |
| table | `shipper_wallet_parameters` | M03-R-02 |
| table | `shipper_wallet_parameter_changes` | M03-R-02 |
| table | `shipping_eligibility_parameters` | M06-R-01, M06-R-06 |
| table | `shipping_eligibility_parameter_changes` | M06-R-01, M06-R-06 |
| table | `shipping_fee_policy_versions` | M06-R-02..03 |
| table | `shipping_fee_policy_drafts` | M06-R-02..03 |
| table | `shipping_fee_agreements` | M06-R-04..05 |
| table | `shipping_fee_agreement_events` | M06-R-04..05 |
| table | `customer_carts` | M10-R-01 |
| table | `order_items` | M10-R-03..09, M10-R-24 |
| table | `order_events` | M10-R-13, M10-R-24..25 |
| table | `reviews` | M11-R-01..03 |
| table | `review_moderations` | M11-R-01..03 |
| table | `review_replies` | M11-R-01..03 |
| table | `review_reply_history` | M11-R-01..03 |
| table | `complaints` | M11-R-04..10 |
| table | `complaint_messages` | M11-R-04..10 |
| table | `complaint_attachments` | M11-R-04..10 |
| table | `complaint_reconsiderations` | M11-R-04..10 |
| table | `complaint_adjustments` | M11-R-04..10 |
| table | `wallet_commission_policies` | M04-R-03 |
| table | `wallet_withdrawals` | M03-R-05, M03-R-10 |
| table | `wallet_withdrawal_events` | M03-R-05, M03-R-10 |
| table | `ops_config` | M12-R-04, M13-R-04 |
| table | `ops_admin_scopes` | M12-R-04, M13-R-04 |
| table | `ops_incidents` | M13-R-01, M13-R-03..04 |
| table | `ops_events` | M13-R-01, M13-R-03..04 |
| table | `ops_checks` | M13-R-01, M13-R-03..04 |
| table | `ops_metrics` | M13-R-01, M13-R-03..04 |
| table | `ops_metrics_hourly` | M13-R-01, M13-R-03..04 |
| table | `ops_notifications` | M13-R-01, M13-R-03..04 |
| table | `ops_maintenance` | M13-R-01, M13-R-03..04 |
| table | `ops_gateway_telemetry` | M13-R-08 |
| table | `ops_ingest_keys` | M13-R-03, M13-R-09 |
| table | `ops_releases` | M13-R-05..06 |
| table | `ops_version_reports` | M13-R-05..06 |
| table | `ops_deploys` | M13-R-09 |
| table | `ops_backup_reports` | M12-R-06, M12-R-12 |
| table | `report_export_jobs` | M12-R-05, M12-R-07 |
| table | `report_export_files` | M12-R-05, M12-R-07 |
| table | `backup_records` | M12-R-06, M12-R-12 |
| table | `backup_jobs` | M12-R-06, M12-R-12 |
| table | `restore_requests` | M12-R-06, M12-R-12 |
| table | `order_parameters` | M10-R-12 |
| table | `order_parameter_changes` | M10-R-12 |
| table | `order_chat_holds` | M10-R-21, M10-R-22 |
| table | `delivery_tracking_links` | M07-R-11, M14-R-09 |
| table | `address_change_requests` | M10-R-18 |
| table | `ops_online_snapshots` | M12-R-08 |
| table | `ops_anomaly_settings` | M12-R-08 |
| table | `ops_anomaly_cases` | M12-R-08 |
| table | `ops_anomaly_case_events` | M12-R-08 |
| admin-view | `access-view` | M12-R-03..04, M12-R-13 |
| admin-view | `accounts-view` | M01-R-11..12 |
| admin-view | `action-queue-view` | M12-R-08 |
| admin-view | `activation-view` | M01-R-17 |
| admin-view | `audit-view` | M12-R-06..07 |
| admin-view | `backups-view` | M12-R-06, M12-R-12 |
| admin-view | `business-main` | M12-R-09..10 |
| admin-view | `business-ops` | M04-R-10..12, M12-R-09 |
| admin-view | `catalog-view` | M02-R-15 |
| admin-view | `config-view` | M12-R-04 |
| admin-view | `deliveries-view` | M07-R-09 |
| admin-view | `feedback-view` | M11-R-01..10 |
| admin-view | `finance-admin-view` | M04-R-09, M04-R-15 |
| admin-view | `finance-ops-view` | M04-R-08, M04-R-14 |
| admin-view | `finance-view` | M04-R-01..07 |
| admin-view | `monitoring-errors-view` | M13-R-07 |
| admin-view | `notifications-view` | M08-R-10, M08-R-12, M08-R-15 |
| admin-view | `ops-map-panel` | M12-R-11, M14-R-15 |
| admin-view | `order-chat-panel` | M10-R-21..22 |
| admin-view | `order-timeouts-page` | M08-R-16, M10-R-12, M10-R-26 |
| admin-view | `orders-view` | M10-R-13, M10-R-20, M10-R-25, M12-R-13 |
| admin-view | `otp-policy-page` | M01-R-04 |
| admin-view | `provisioning-view` | M01-R-17 |
| admin-view | `reports-view` | M12-R-05, M12-R-07 |
| admin-view | `reset-start` | M01-R-10 |
| admin-view | `reset-view` | M01-R-10 |
| admin-view | `settings-view` | M12-R-04 |
| admin-view | `shell-app` | M12-R-01..02 |
| admin-view | `shippers-view` | M03-R-01..10 |
| admin-view | `shipping-policy-view` | M06-R-01..04, M10-R-12 |
| mobile-screen | `ResetScreen` | M01-R-03 |
| mobile-screen | `ShopStartScreen` | M02-R-01 |
| mobile-screen | `ShopFormScreen` | M02-R-01, M02-R-03, M02-R-08 |
| mobile-screen | `ShopHomeScreen` | M02-R-01, M02-R-14 |
| mobile-screen | `PreviewScreen` | M02-R-01 |
| mobile-screen | `ShopPublicScreen` | M02-R-11 |
| mobile-screen | `PublicHoursScreen` | M02-R-05 |
| mobile-screen | `ShopCallScreen` | M07-R-01 |
| mobile-screen | `ShopDeliveryDetailScreen` | M07-R-01..04, M07-R-06 |
| runner | `business-push-service` | M12-R-10 |
| runner | `idempotency-cleanup` | M00-R-02 |
| runner | `push-dispatcher` | M08-R-01, M08-R-07 |
| runner | `ops-analytics-runtime` | M12-R-08 |
| runner | `ops-runtime` | M13-R-01, M13-R-04 |
| runner | `order-timeout-sweeper` | M08-R-16, M10-R-11, M10-R-26 |
| runner | `sms-queue-sweeper` | M01-R-18, M13-R-08 |
| runner | `test-sms-runtime` | KHÔNG CÓ YÊU CẦU |
| workflow | `ai-governance.yml` | KHÔNG CÓ YÊU CẦU |
| workflow | `ci.yml` | KHÔNG CÓ YÊU CẦU |
| workflow | `diagnose-vps-release.yml` | M13-R-04, M13-R-09 |
| workflow | `m14-android-runtime.yml` | M14-R-01, M14-R-14 |
| workflow | `m14-flutter-runtime.yml` | M14-R-01, M14-R-06 |
| workflow | `m14-gps-test.yml` | M14-R-01, M14-R-03, M14-R-14 |
| workflow | `no-skip-ci.yml` | KHÔNG CÓ YÊU CẦU |
| workflow | `update-progress.yml` | KHÔNG CÓ YÊU CẦU |

# Runbook — M08 push thật (FCM) cho 11Food và 11Ship — 18/10/2026

**Trạng thái: chuẩn bị, CHƯA thực thi trên VPS và chưa có Firebase của Owner.** Chi tiết thiết kế: [M08-implementation-20261018.md](../../docs/current/M08-implementation-20261018.md) §4.
**Không gửi khóa, file JSON, mật khẩu, token qua chat/PR/log.** Hai thứ khác nhau:

| | Ở đâu | Bí mật? |
|---|---|---|
| Định danh client Firebase của từng app (project id, sender id, app id, API key Android) | biến/secret GitHub → biên dịch vào APK | không phải khóa máy chủ (có trong mọi APK, theo tài liệu Firebase); API key vẫn đặt ở *secret* để không lộ trong log |
| File khóa service account | **chỉ** trên VPS, `/etc/11ship/fcm/service-account.json` | **có**, không rời VPS |

## A. Owner làm trên Firebase (một lần, ~10 phút)
1. Vào <https://console.firebase.google.com> → *Add project* (hoặc chọn dự án có sẵn). Ghi lại **Project ID** và **Project number** (= sender id) ở *Project settings → General*.
2. *Project settings → General → Your apps → Add app → Android*, làm **hai lần**:
   - package `vn.eleven.ship.test` (11Ship) → ghi **App ID** (`1:<số>:android:<hex>`);
   - package `vn.eleven.food.test` (11Food) → ghi **App ID**.
   Bỏ qua bước tải `google-services.json` (build dùng biến, không dùng file này). Không cần SHA-1.
3. API key Android của từng app: *Project settings → General → Your apps → (app) → `google-services.json` → `current_key`*, hoặc <https://console.cloud.google.com/apis/credentials> (khóa "Android key (auto created by Firebase)"). Hai app có thể cùng một khóa.
4. Bật API: <https://console.cloud.google.com/apis/library/fcm.googleapis.com> → *Firebase Cloud Messaging API* phải ở trạng thái **Enabled** (V1).
5. Khóa máy chủ: *Project settings → Service accounts → Generate new private key* → tải file JSON về máy cá nhân. (Hoặc *Google Cloud → IAM → Service accounts → Create*, vai trò *Firebase Cloud Messaging API Admin*, rồi *Keys → Add key → JSON*.) **Giữ file này riêng tư.**

## B. Owner đặt cấu hình APK vào GitHub (máy có `gh` đã đăng nhập, repo `trungtn87/11ship`)
```bash
gh variable set FCM_PROJECT_ID    --repo trungtn87/11ship --body '<project id>'
gh variable set FCM_SENDER_ID     --repo trungtn87/11ship --body '<project number>'
gh variable set FCM_SHIP_APP_ID   --repo trungtn87/11ship --body '<app id của vn.eleven.ship.test>'
gh variable set FCM_FOOD_APP_ID   --repo trungtn87/11ship --body '<app id của vn.eleven.food.test>'
gh secret   set FCM_SHIP_API_KEY  --repo trungtn87/11ship      # gh hỏi giá trị, dán vào, không đi qua chat
gh secret   set FCM_FOOD_API_KEY  --repo trungtn87/11ship
```
Đủ 4 giá trị cho mỗi app = APK có push. Không đặt gì = APK không có push (CI cảnh báo `M08 push not in this APK`). Đặt thiếu hoặc sai định dạng = build dừng, báo tên biến.
Rồi chạy workflow **Mobile APK** (Actions → Mobile APK → Run workflow, nhánh của PR). APK: cùng applicationId, cùng khóa ký, `versionCode` = số lần chạy → **cài đè** được, không cần gỡ.

## C. Operator đặt cấu hình VPS (root; release đã được review; **không tự chạy trước khi Owner duyệt**)
Tiên quyết: migration `1794182400000_create-m08-notifications` đã áp (mục 3 của [vps-production-update-20261014.md](vps-production-update-20261014.md): `db-migrate-remote.js` rồi `02-runtime-grants.sql`; kiểm tra: `sudo -u postgres psql -d ship11_staging -c "\dp app.notification_push_tokens app.notifications"`).
```bash
# 1) Khóa service account: copy file JSON lên VPS bằng scp từ máy Owner (KHÔNG qua chat)
install -d -m 750 -o root -g ship11 /etc/11ship/fcm
install -m 640 -o root -g ship11 ./service-account.json /etc/11ship/fcm/service-account.json
shred -u ./service-account.json        # trên máy trung gian nếu có
stat -c '%a %U:%G %n' /etc/11ship/fcm /etc/11ship/fcm/service-account.json   # 750 / 640 root:ship11

# 2) Hai biến, thêm vào /etc/11ship/staging.env (giữ nguyên các khóa khác)
cat >> /etc/11ship/staging.env <<'ENVEOF'
PUSH_FCM_PROJECT_ID=<project id>
PUSH_FCM_SERVICE_ACCOUNT_FILE=/etc/11ship/fcm/service-account.json
ENVEOF
stat -c '%a %U:%G %n' /etc/11ship/staging.env     # 640 root:ship11

# 3) Kiểm tra cấu hình TRƯỚC khi khởi động lại (không gửi gì tới ai)
cd /opt/11ship/current
set -a; . /etc/11ship/staging.env; set +a
npm run push:check                                  # kỳ vọng: "push:check: OK - ..."; mã lỗi cố định nếu sai (xem bảng)

# 4) Khởi động lại và xem log (không có khóa/token trong log)
systemctl restart 11ship-staging && sleep 3 && systemctl status 11ship-staging --no-pager | head -5
journalctl -u 11ship-staging -n 30 --no-pager
```
`push:check` — mã lỗi: `NOT_CONFIGURED` (chưa đặt hai biến) · `INVALID_CONFIG <tên biến>` · `CREDENTIAL_UNAVAILABLE` (file thiếu/quyền/sai định dạng) · `PROVIDER_AUTH` (khóa sai, bị thu hồi, hoặc đồng hồ máy lệch) · `PROJECT_NOT_FOUND` (sai project id) · `PERMISSION_DENIED` (thiếu vai trò FCM hoặc chưa bật FCM API) · `NETWORK` (không ra được Internet) · `REJECTED`.
Gửi thử một thông báo thật tới một máy (registration token của máy thử; operator chỉ đọc nó từ `app.notification_push_tokens` khi cần, không dán vào chat/log): `npm run push:check -- --token '<registration token>'`. Thông báo thử không nằm trong hộp thư; chạm vào sẽ báo "không tìm thấy" — bình thường.
Hoàn tác: xóa hai dòng `PUSH_FCM_*` rồi `systemctl restart 11ship-staging` → hộp thư/đồng bộ vẫn chạy, push ghi `PROVIDER_NOT_CONFIGURED`.

## D. Thử trên điện thoại thật (Android 13+ khuyến nghị; cần 11Ship và 11Food đã cài đè bản push)
Cần: 1 tài khoản Shop (11Food, đã có quán + sản phẩm), 1 tài khoản Shipper (11Ship, đã được duyệt, đang ở trạng thái nhận đơn), hai điện thoại hoặc hai app; VPS đã làm mục C.
1. **Quyền**: đăng nhập 11Ship → hộp thoại *Cho phép gửi thông báo* hiện một lần → *Cho phép*. Làm tương tự 11Food. (Từ chối: *Cài đặt → Thông báo* trong app dẫn tới cài đặt hệ thống.)
2. **Đăng ký token**: `Thông báo → Cài đặt` hiện "Thiết bị này nhận được thông báo" (không còn "chưa hỗ trợ"). Operator: `sudo -u postgres psql -d ship11_staging -c "select app, count(*) from app.notification_push_tokens where invalidated_at is null group by 1"` (tên cột xem migration `1794182400000`) phải thấy thiết bị vừa đăng ký; không in token.
3. **Gửi/nhận**: tắt màn hình 11Ship (app nền). Shop tạo đơn giao có tìm shipper → 11Ship nhận một thông báo "Có đơn giao hàng mới" (gộp, tối đa một lần mỗi đợt tìm). Chạm thông báo → mở đúng danh sách đơn có thể nhận; hộp thư có đúng một dòng.
4. **Nhắc việc**: không nhận đơn; ~phút thứ 5 và 15 có nhắc tìm shipper cho Shop. Nhận đơn rồi chưa lấy hàng → nhắc lấy hàng mỗi 5 phút, gộp. **Pickup xong → nhắc dừng**. Làm lại với **Shop hủy** hoặc **shipper trả đơn** → nhắc dừng trong vòng ≤ 5 phút (không có nhắc mới).
5. **Đăng xuất / đổi tài khoản**: đăng xuất 11Ship → Shop tạo đơn mới → điện thoại **không** nhận. Đăng nhập tài khoản shipper khác → chỉ nhận thông báo của tài khoản này.
6. **Âm thanh/rung**: tắt âm trong Cài đặt → vẫn hiện thông báo, không kêu; bật lại → có âm.
7. Ghi kết quả từng bước (đạt/không + giờ). Không chụp màn hình có số điện thoại, token hay địa chỉ.

## E. Kiểm tra tự động đã có (không thay cho mục D)
`push-provider.spec.ts` (client FCM với máy chủ Google giả: JWT, thông điệp, ánh xạ lỗi, làm mới 401, `check()`), `m08-notifications.int.spec.ts` (gom thông báo, token theo phiên, nhắc dừng, TTL, stale…), `n11_shared/test/m08_test.dart` + `ship/test/m08_ship_test.dart` (đăng ký token, xin quyền, chạm → định tuyến), job CI *push build compiles* (biên dịch bản có Firebase với định danh giả, kiểm tra manifest + quyền). **Chưa có**: Google nhận khóa thật, FCM giao tới máy thật, hiển thị/chạm thông báo trên Android thật — chỉ mục D chứng minh.

# Runbook — khóa ký Android phát hành, Play App Signing và cấu hình FCM (14/11/2026)

**Trạng thái:** chuẩn bị. Chưa tạo khóa, chưa đặt secret/biến, chưa đổi VPS, chưa tải lên Google Play, chưa phân phối APK. Mọi bước ghi "Owner" chỉ được làm trên máy Owner.
**Không đưa khóa, mật khẩu, file keystore, base64, service-account JSON vào chat, repo, PR hay log.** Chỉ dùng dấu vân tay SHA-256 (công khai) để đối chiếu.

Liên quan: [mobile/README.md](../../mobile/README.md) mục "Signing for the official packages", [M08 runbook](m08-push-deploy-20261018.md), [mobile-apk.yml](../../.github/workflows/mobile-apk.yml).

---

## 0. Ba loại khóa, không được lẫn

| Khóa | Dùng để | Ai giữ | Nằm ở đâu hiện nay |
|---|---|---|---|
| **App-signing key** (khóa ký ứng dụng) | Ký APK cài trực tiếp. Bản Play được Google ký lại bằng chính khóa này khi đăng ký Play App Signing, nên APK trực tiếp và bản Play có cùng signer và cài đè được cho nhau | Google (nếu Play App Signing giữ) hoặc Owner (nếu đã đăng ký khóa tự cung cấp) | Secret hiện tại `ANDROID_TEST_KEYSTORE_*`, `ANDROID_TEST_KEY_ALIAS`, `ANDROID_TEST_KEY_PASSWORD` (tên lịch sử, khóa này là khóa bền đang dùng) |
| **Upload key** (khóa tải lên) | Ký **AAB** trước khi tải lên Play. Tách khỏi app-signing key; Google có thể reset nếu mất | Owner | Chưa có. Sẽ là 4 secret `ANDROID_UPLOAD_*` |
| Service-account key (Firebase) | Backend gửi FCM | Owner → VPS | Không liên quan tới ký APK |

Quy tắc không đổi: 11Food và 11Ship **phải cùng một app-signing key** (kiểm tra peer trong `N11PeerPolicy` và Binder so signer). Upload key **không bao giờ** được là app-signing key.

---

## 0A. Quyết định đã chốt (Owner, 14/11/2026)

- Versions: **1.0.0+1** cho cả hai app (versionName `1.0.0`, versionCode `1`). Owner xác nhận chưa từng tải APK/AAB của hai package này lên Play.
- **Một app-signing key dùng chung** cho 11Food và 11Ship. Play App Signing dùng chính khóa đó. Giữ nguyên kiểm tra cùng signer (peer check); không đổi quy tắc.
- **Upload key riêng**, không trùng app-signing key. Chỉ dùng để ký AAB.
- Không tải lên Play, không rollout, không phân phối APK khi chưa có lệnh Owner.

**Keystore hiện có có dùng làm app-signing key không?** Kết luận: **có, với điều kiện Owner xác minh bản sao lưu.**

| Kiểm tra | Kết quả |
|---|---|
| Signer hiện tại (công khai, từ artifact `android-signers.json` của run Mobile APK thành công `43470719462`) | SHA-256 `6aa5abfcace6e1b55f6cede5e1aea0dc449fdd3f67b50ebf5a92a62f38dbd0a3`, **giống nhau cho cả hai app** |
| Loại và độ dài khóa (theo `create-test-keystore.sh`, 13/10/2026) | RSA 2048, PKCS12, hạn 10000 ngày (tới khoảng 2053). Đạt yêu cầu tối thiểu RSA 2048 của Play cho khóa ký tự cung cấp |
| Tên chứng thư | `CN=11Ship test, O=11Ship`. Chỉ là nhãn; Play không kiểm tra, nhưng có thể đổi thành khóa mới nếu Owner muốn nhãn sạch |
| Đã dùng cho APK `.test` | Có. Package khác nên không xung đột; vẫn là khóa bền đã được duyệt |
| **Bản sao lưu file `.jks`** | **Chưa xác nhận.** Secret GitHub không đọc lại được. Nếu chỉ còn secret, không thể đăng ký Play App Signing bằng PEPK và không khôi phục được khi mất |
| **Mật khẩu đã từng hiện trong terminal** | Script 13/10 in mật khẩu ra màn hình. Coi như đã lộ trên máy Owner; cân nhắc đổi mật khẩu keystore (`keytool -storepasswd`, không đổi khóa) rồi cập nhật secret |
| Trạng thái Play App Signing | **Chưa xác nhận.** Nếu Play đã có khóa ký khác cho package, phải dừng và báo lại |

**Điều kiện để dùng khóa này:** (1) file `.jks` có bản sao lưu riêng, và `keytool -list -v` trên bản sao cho đúng SHA-256 ở trên; (2) Play Console không giữ chứng thư nào khác cho hai package. Nếu một điều kiện không đạt, không dùng khóa này và báo lại trước khi tạo khóa mới.

**Hệ quả với VPS:** vì signer không đổi, file allowlist VPS chỉ thay tên package `vn.eleven.*.test` → `vn.eleven.*`, giữ dấu vân tay trên.

**Biến ghim (công khai):**
- `ANDROID_APP_SIGNER_SHA256` = `6aa5abfcace6e1b55f6cede5e1aea0dc449fdd3f67b50ebf5a92a62f38dbd0a3`
- `ANDROID_UPLOAD_CERT_SHA256` = dấu vân tay upload key mới (mục 2, sau khi tạo)

## 1. Kiểm tra trước khi tạo khóa (Owner, không ghi đè gì)

1. **Keystore hiện có:** nếu Owner còn file keystore đã dùng để tạo secret `ANDROID_TEST_*` (script `mobile/tool/create-test-keystore.sh`, ngày 13/10/2026), lấy dấu vân tay của nó trên máy Owner:
   ```
   keytool -list -v -keystore <đường dẫn file .jks> -alias <ANDROID_TEST_KEY_ALIAS>
   ```
   Ghi dòng `SHA256:` (chỉ ghi chữ số/hex, bỏ dấu hai chấm, chữ thường). Đây là dấu vân tay của app-signing key hiện tại.
2. **Trên Play Console** (chỉ cho các package đã tạo trên Play): *Thiết lập → Ký ứng dụng* (App integrity / App signing). Ghi dấu vân tay **App signing key certificate** và **Upload key certificate** nếu đã có. Nếu Play đã có chứng thư khác với khóa hiện tại, **không** dùng khóa hiện tại làm app-signing key; báo lại cho Claude Lead trước khi làm tiếp.
3. **Ghi nhận:** package `vn.eleven.food` và `vn.eleven.ship` đã từng tải build nào lên Play chưa, và versionCode cao nhất (xem mục 6).

Nếu Play chưa có chứng thư nào và Owner quyết định dùng keystore hiện tại làm app-signing key, bỏ qua mục 2 và đi tới mục 3.

## 2. Tạo khóa mới (chỉ khi Owner quyết định; trên máy Owner)

Tạo **upload key** riêng (bắt buộc cho AAB) và, nếu Play chưa có khóa phù hợp, một **app-signing key** chung cho cả hai app:

```
keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
keytool -genkeypair -v -keystore app-signing.jks -alias app-signing -keyalg RSA -keysize 4096 -validity 10000
```

- Không dùng tên file/alias có thể đoán được từ tên app. Mật khẩu đặt mạnh, lưu trong trình quản lý mật khẩu của Owner.
- **Sao lưu trước khi đăng ký với Play:** ít nhất hai bản ở hai nơi tách biệt (ổ ngoài đã mã hóa + bản offline), kèm mật khẩu. Sau khi Play App Signing giữ app-signing key, Owner **không tải lại được** private key từ Google; nếu mất, không có đường khôi phục cho app-signing key. Upload key có thể được Google reset nhưng cần quy trình riêng.
- Không lưu file `.jks` trong thư mục repo; nếu cần, đặt ngoài cây thư mục `D:\11Ship`.
- Không chạy lệnh tạo khóa trong terminal có ghi log lâu dài; xóa lịch sử lệnh có mật khẩu nếu đã gõ trực tiếp.

## 3. Bốn secret `ANDROID_UPLOAD_*` (ký AAB)

**Chưa có workflow ký AAB trong repo.** Workflow **Mobile APK** (chạy trên PR/push) không đọc các secret này và không ký hay upload AAB. Workflow ký sẽ được thêm ở PR sau, chạy trong **GitHub Environment có protection rules**; các secret này phải đặt **trong environment đó, KHÔNG đặt ở repository secrets**. Tên environment do Owner chọn ở PR đó. Các lệnh dưới đây là mẫu cho environment đã tạo.

| Tên secret | Ý nghĩa | Nhập như thế nào |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Nội dung file `upload-keystore.jks` mã hóa base64 (một dòng) | Tạo file base64 **trên máy Owner** rồi nạp bằng stdin, không dán vào chat |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Mật khẩu của file keystore | Nhập khi `gh` hỏi, hoặc Settings → Secrets |
| `ANDROID_UPLOAD_KEY_ALIAS` | Alias của upload key trong keystore (ví dụ `upload`) | Không phải bí mật, nhưng vẫn để ở secret cho đồng bộ |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Mật khẩu của chính khóa (alias) | Nhập khi `gh` hỏi, hoặc Settings → Secrets |

Mã hóa base64 trên máy Owner (không in ra màn hình):
- PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\khoa-an-toan\upload-keystore.jks")) | Set-Content -NoNewline D:\khoa-an-toan\upload.b64`
- Git Bash/Linux: `base64 -w0 upload-keystore.jks > upload.b64`

Nạp bằng CLI (không đưa giá trị vào lệnh, `gh` đọc từ file):
```
gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --env <tên environment> --repo trungtn87/11ship < D:\khoa-an-toan\upload.b64
gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD --env <tên environment> --repo trungtn87/11ship
gh secret set ANDROID_UPLOAD_KEY_ALIAS --env <tên environment> --repo trungtn87/11ship --body 'upload'
gh secret set ANDROID_UPLOAD_KEY_PASSWORD --env <tên environment> --repo trungtn87/11ship
```
Sau đó xóa file `upload.b64` khỏi máy.

**Phân biệt khi làm việc:** `ANDROID_TEST_*` = khóa ký APK cài trực tiếp (phải là app-signing key nếu chọn phương án chung). `ANDROID_UPLOAD_*` = chỉ để ký AAB gửi Play. Hai thứ không thay thế nhau.

## 4. Hai biến công khai (ghim signer)

Đây là dấu vân tay SHA-256 của chứng thư DER (không phải bí mật), đặt làm **repository variables**:

| Biến | Giá trị | Lấy từ đâu |
|---|---|---|
| `ANDROID_APP_SIGNER_SHA256` | 64 ký tự hex của app-signing certificate | Mục 1 (keytool) hoặc log "Signer pin" sau lần build đầu |
| `ANDROID_UPLOAD_CERT_SHA256` | 64 ký tự hex của upload certificate | `keytool -exportcert -keystore upload-keystore.jks -alias upload \| sha256sum` (Git Bash) |

```
gh variable set ANDROID_APP_SIGNER_SHA256 --repo trungtn87/11ship --body '<64 hex>'
gh variable set ANDROID_UPLOAD_CERT_SHA256 --repo trungtn87/11ship --body '<64 hex>'
```
Khi đã đặt, CI **từ chối** APK ký bằng chứng thư khác (không đổi khóa âm thầm). `ANDROID_UPLOAD_CERT_SHA256` chưa được workflow nào đọc trong PR này; sẽ được dùng bởi workflow ký AAB ở PR sau.

## 5. Biến và secret FCM (cấu hình đã được xác định; chưa đặt)

Giá trị lấy từ file client Firebase Owner gửi, khớp theo `package_name`. Không có khóa nào trong bảng này là khóa ký APK.

```
gh variable set FCM_PROJECT_ID --repo trungtn87/11ship --body 'local-f6a32'
gh variable set FCM_SENDER_ID --repo trungtn87/11ship --body '985944443790'
gh variable set FCM_SHIP_APP_ID --repo trungtn87/11ship --body '1:985944443790:android:c56a5a3b88f35acce6f2df'
gh variable set FCM_FOOD_APP_ID --repo trungtn87/11ship --body '1:985944443790:android:bb386bb34f2c0b71e6f2df'
gh secret set FCM_SHIP_API_KEY --repo trungtn87/11ship     # gh hỏi giá trị; dán API key Android, không qua chat
gh secret set FCM_FOOD_API_KEY --repo trungtn87/11ship
```

Ghi chú: API key Android nằm trong `google-services.json` của Owner. Không đưa file đó vào repo (`.gitignore` đã chặn).

**Trạng thái thao tác:** phiên làm việc của Claude đã thử đặt các biến/secret này và thao tác bị hệ thống từ chối (lý do: thay đổi cấu hình repository dùng chung, không nằm trong lệnh trực tiếp của Owner). Owner chạy các lệnh trên từ máy Owner.

Cách thay thế qua giao diện: GitHub → repo `trungtn87/11ship` → *Settings → Secrets and variables → Actions* → tab *Variables* (giá trị không bí mật) hoặc *Secrets* (API key, mật khẩu keystore).

## 6. versionCode trên Play (Owner xác minh)

- Vào Play Console, với từng package `vn.eleven.food` và `vn.eleven.ship`: xem *Phiên bản ứng dụng → bản phát hành* và lịch sử. Nếu **chưa có build nào**, giữ `1.0.0+1` (versionCode 1).
- Nếu đã có build: ghi versionCode cao nhất và đặt `version: X.Y.Z+N` trong `mobile/<app>/pubspec.yaml` với N **lớn hơn** số đó. Báo Claude Lead trước khi đổi.
- Không tính từ số build `.test` hay từ `run_number`.

## 7. Allowlist signer trên VPS (chuẩn bị; chưa áp dụng)

Nội dung file (`/etc/11ship/android-signers.json`, đường dẫn trong [m01-vps-android-sms-connect.md](m01-vps-android-sms-connect.md)). Hai app dùng **cùng một** app-signing certificate:

```json
{
  "FOOD": { "package_name": "vn.eleven.food", "signer_sha256": "<ANDROID_APP_SIGNER_SHA256>" },
  "SHIP": { "package_name": "vn.eleven.ship", "signer_sha256": "<ANDROID_APP_SIGNER_SHA256>" }
}
```

- **Nguồn đúng:** artifact `android-signers.json` của lần chạy **Mobile APK** đã ký bằng khóa đã chọn. Không sửa tay dấu vân tay; lấy nguyên giá trị đã được CI xác nhận khớp `ANDROID_APP_SIGNER_SHA256`.
- **Không** dùng upload certificate ở đây: upload key không ký APK cài trực tiếp.
- Các giá trị `vn.eleven.*.test` và dấu vân tay khóa `.test` cũ **phải bỏ** khỏi file này; nếu để lại, APK mới sẽ bị từ chối khi đăng nhập thiết bị.
- Thứ tự khi Owner duyệt (không làm trước): (a) sao lưu file hiện tại; (b) thay nội dung như trên, quyền `640 root:ship11`; (c) kiểm tra JSON; (d) khởi động lại service theo quy trình VPS đã duyệt. Mục này không được tự thực hiện.

**Service-account Firebase:** chuyển trực tiếp từ máy Owner lên VPS, không qua repo/chat:
- Đích: `/etc/11ship/fcm/service-account.json`, thư mục `/etc/11ship/fcm` quyền `750 root:ship11`, file `640 root:ship11`. Đã kiểm tra: service `11ship-staging` chạy `User=ship11 Group=ship11` (`ops/vinahost/11ship-staging.service`).
- Đặt `PUSH_FCM_PROJECT_ID=local-f6a32` và `PUSH_FCM_SERVICE_ACCOUNT_FILE=/etc/11ship/fcm/service-account.json` trong env của service (chi tiết: [M08 runbook](m08-push-deploy-20261018.md) mục C).
- Lệnh `npm run push:check` trên VPS là kiểm tra không gửi gì tới ai.

## 8. Build lại và kiểm chứng (sau khi có secret và biến)

1. Chạy workflow **Mobile APK** trên nhánh đã duyệt (PR/push hoặc *Run workflow*). APK được ký bằng app-signing key đã ghim; AAB chỉ được biên dịch và kiểm cấu trúc, **không ký, không upload** (chờ workflow ký ở PR sau).
2. Đối chiếu trong log mỗi app:
   - `package: name='vn.eleven.food'` / `vn.eleven.ship`;
   - `versionName='1.0.0'`, `versionCode='1'` (hoặc số pubspec đã chọn);
   - dòng `Signer pin: matches ANDROID_APP_SIGNER_SHA256` (khi biến đã đặt);
   - dòng tóm tắt `AAB: compiled and structure-checked only; not signed, not uploaded`.
3. Kiểm tra cục bộ APK đã tải (trên máy Owner, không chạy trong repo): `apksigner verify --print-certs <apk>` phải cho đúng dấu vân tay app-signing key.
4. Chỉ sau các bước này mới được cài thử trên điện thoại (mục 9).

## 9. Checklist trên điện thoại (Owner; CI xanh không thay thế)

Điều kiện: VPS đã được cập nhật allowlist và service-account (mục 7); APK cài mới, không cài đè `.test`.

- [ ] **Cài mới** 11Food và 11Ship từ artifact `food-apk` / `ship-apk`. Mở *Tài khoản → Chẩn đoán kết nối*: đúng applicationId, versionName, versionCode.
- [ ] **Nhận diện nhau:** đăng nhập 11Food rồi 11Ship (cả hai thứ tự cài). Hai app phải thừa nhận cùng signer; không báo lỗi xác thực peer.
- [ ] **Đăng nhập thiết bị:** đăng nhập thành công; đăng nhập từ máy khác thay thế phiên như đã thiết kế.
- [ ] **FCM đăng ký:** sau đăng nhập và cấp quyền thông báo, Owner xác nhận bản ghi token của thiết bị xuất hiện đúng app và đúng tài khoản (truy vấn DB của Owner, không in token).
- [ ] **Đúng người, đúng app:** tạo sự kiện cho shipper → chỉ thiết bị shipper đó nhận; shop/khách không nhận thông báo của shipper; 11Food không nhận thông báo của 11Ship.
- [ ] **Chạy nền:** đưa app xuống nền hoặc đóng hẳn → thông báo hiện qua hệ thống.
- [ ] **Bấm thông báo:** mở đúng màn hình/đơn; khi chưa đăng nhập hoặc đơn không còn khả dụng thì báo đúng, không lộ dữ liệu.
- [ ] **Đăng xuất:** sau đăng xuất không nhận thông báo mới; tài khoản khác đăng nhập trên cùng máy không thấy dữ liệu tài khoản trước.
- [ ] **Chuyển tài khoản:** dữ liệu cá nhân của tài khoản cũ biến mất khỏi màn hình.
- [ ] **Quyền và kênh:** từ chối quyền thông báo → app hướng dẫn mở cài đặt; tắt âm → vẫn hiện thông báo, không kêu.
- [ ] **Gỡ app `.test` cũ:** chỉ sau khi các mục trên đạt và app mới đăng nhập đúng, gỡ (hoặc tắt) 11Food/11Ship `vn.eleven.*.test` còn trên máy. Lý do: app cũ vẫn có icon và cache cục bộ đến khi bị 401 hoặc làm mới lạnh, nên dễ mở nhầm; theo phân tích review, đăng nhập app mới thay binding/session cũ, nên app `.test` không còn dùng được. Ghi giờ đã gỡ.
- [ ] **Force stop (giới hạn đã biết):** sau khi người dùng buộc dừng app, Android không giao thông báo đến khi người dùng mở app lại. Ghi kết quả, không coi là lỗi.

Ghi kết quả từng mục (đạt/không, giờ). Không chụp màn hình có số điện thoại, token, địa chỉ.

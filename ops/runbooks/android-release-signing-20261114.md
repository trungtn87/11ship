# Runbook — ký Android, phát hành Play và cấu hình FCM (cập nhật 15/11/2026, STORE-01 PR-C)

**Trạng thái:** tài liệu. Runbook này không tạo khóa, không đặt secret/biến, không chạy workflow ký, không upload Google Play, không deploy VPS. Mọi bước ghi "Owner" làm trên máy hoặc console của Owner.
**Không đưa khóa, mật khẩu, file keystore, base64, service-account JSON, token hay google-services.json vào chat, repo, PR hay log.** Chỉ dùng dấu vân tay SHA-256 (công khai) để đối chiếu.

Liên quan: [mobile/README.md](../../mobile/README.md) (mục Signing), [mobile/release/README.md](../../mobile/release/README.md) (hồ sơ versionCode), [mobile-apk.yml](../../.github/workflows/mobile-apk.yml) (APK test), [mobile-aab-release.yml](../../.github/workflows/mobile-aab-release.yml) (AAB Play), [release versioning](../../docs/process/release-versioning-20261019.md), [M08 runbook](m08-push-deploy-20261018.md).

---

## 0. Ba môi trường, không được lẫn

| Môi trường | Ai tạo / ở đâu | Chữ ký | Package | Dùng để làm gì |
|---|---|---|---|---|
| **APK test CI** | Workflow **Mobile APK** (chạy trên PR/push) | Khóa **TEST** bền, secret `ANDROID_TEST_KEYSTORE_*`. **Đây là chữ ký test, KHÔNG phải chữ ký Production** | `vn.eleven.food`, `vn.eleven.ship` | Cài thử trên máy Owner. Cài đè giữa các bản test (giữ dữ liệu) |
| **Play Production** | Workflow **Mobile AAB release (Play)** (chỉ dispatch từ `main`, environment `android-release`) tạo AAB ký bằng **upload key**. Google Play ký lại bằng **app-signing key** khi phát hành | Upload key (ký AAB gửi Play); app-signing key do Play App Signing giữ hoặc đã đăng ký | Cùng package ID như trên | Owner tải AAB từ artifact và tải lên **Internal testing** thủ công |
| **VPS** (backend) | Không ký. Backend chỉ chấp nhận APK có chữ ký nằm trong allowlist signer | Không có khóa ký | — | Kiểm signer của APK khi đăng nhập thiết bị (allowlist `android-signers.json`) |

Quy tắc:
- Chữ ký TEST của CI **không** được ghim, đăng ký hay dùng làm chữ ký Production. Mọi tài liệu cũ coi khóa TEST là khóa Production đã bị xóa.
- **Upload key không bao giờ trùng app-signing key.** `sign-aab.sh` và workflow đều từ chối khi trùng.
- 11Food và 11Ship **phải cùng một app-signing key** (peer check trong `N11PeerPolicy` và Binder so signer).
- Chữ ký Production khác chữ ký TEST. Máy đang cài APK TEST **không cài đè được** bản Production cùng package: phải gỡ bản TEST rồi cài bản Production (xem mục 9).

## 1. Điều đã kiểm chứng từ repo và điều Owner phải xác nhận

| Mục | Trạng thái |
|---|---|
| Workflow AAB release có trên `main` (PR-A #351): dispatch, chỉ `main`, environment `android-release`, ký bằng `sign-aab.sh`, kiểm chữ ký và manifest, không upload Play | **Đã có trong repo** |
| Hồ sơ versionCode đã nộp Play theo package, cổng kiểm trong `check-aab-release.py` (PR-B #357) | **Đã có trên `main`**, chỉ được cập nhật theo mục 8 |
| Environment `android-release` có required reviewers; secrets `ANDROID_UPLOAD_*` và các biến | **Owner xác nhận trên console** (repo không chứng minh được) |
| Play Console: app đã đăng ký, chứng thư app-signing và upload, track đang dùng | **Owner xác nhận trên console** |
| Firebase: app Android `vn.eleven.food` / `vn.eleven.ship` đã đăng ký, giá trị FCM | **Owner xác nhận trên console** |

## 2. Ba biến ghim (công khai)

Các dấu vân tay SHA-256 của chứng thư, không phải bí mật. Mỗi biến có một vai trò riêng:

| Biến (repository variable) | Chứng thư | Ai dùng | Trạng thái |
|---|---|---|---|
| `ANDROID_TEST_SIGNER_SHA256` (**tùy chọn**) | Chữ ký **TEST** của APK CI, dấu vân tay `6aa5…` (64 hex). Chỉ ghim APK test, **không** phải chữ ký Production | `mobile-apk.yml`: khi đã đặt, APK test phải mang đúng chứng thư này; khi chưa đặt, không kiểm pin | Tùy chọn |
| `ANDROID_APP_SIGNER_SHA256` (**bắt buộc cho AAB**) | App-signing certificate của Play App Signing, dấu vân tay bắt đầu `fa87…` | `mobile-aab-release.yml` bắt buộc có; `sign-aab.sh` từ chối AAB có signer trùng giá trị này. Không dùng cho APK test | **Owner đã đặt** bằng chứng chỉ Play. Repo không ghi giá trị đầy đủ |
| `ANDROID_UPLOAD_CERT_SHA256` (**tùy chọn**) | Upload certificate (khóa ký AAB gửi Play). Dấu vân tay Upload Key đã biết: `a42afa94…879f1330` | `sign-aab.sh` chỉ đối chiếu khi biến được đặt | Tùy chọn. Đây là Upload Key, **không** phải app-signing |

Ba biến không được trùng vai trò: `ANDROID_TEST_SIGNER_SHA256` chỉ kiểm APK test; `ANDROID_APP_SIGNER_SHA256` chỉ kiểm AAB Production; `ANDROID_UPLOAD_CERT_SHA256` chỉ đối chiếu upload key. Nếu chưa đặt biến TEST, Mobile APK không kiểm pin và vẫn chạy, chỉ ghi dòng `Signer pin: ... is not set` vào tóm tắt. Khi đã đặt, tóm tắt ghi `Signer pin: matches ANDROID_TEST_SIGNER_SHA256`.

Lấy giá trị:
- Upload certificate, trên máy Owner: `keytool -exportcert -keystore <upload.jks> -alias <alias> | sha256sum` (Git Bash). Bỏ dấu cách, dùng chữ thường.
- App-signing certificate: lấy từ Play Console (*Ký ứng dụng*, dấu vân tay App signing key certificate). Biến này đã được Owner đặt; chỉ đặt lại nếu Owner yêu cầu. Không đặt bằng giá trị TEST.

## 3. Khóa upload và app-signing (Owner, trên máy Owner)

Tạo **upload key** riêng (bắt buộc cho AAB). App-signing key chỉ tạo khi Play chưa có khóa phù hợp; Owner quyết định:

```
keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

- Đặt tên file và alias không đoán được từ tên app. Mật khẩu mạnh, lưu trong trình quản lý mật khẩu của Owner.
- Sao lưu ít nhất hai nơi tách biệt (ổ ngoài đã mã hóa và bản offline) kèm mật khẩu, **trước** khi đăng ký với Play.
- Không đặt file `.jks` trong cây thư mục `D:\11Ship`.
- Không chạy lệnh tạo khóa trong terminal có ghi log lâu dài; xóa lịch sử lệnh có mật khẩu nếu đã gõ trực tiếp.

Trạng thái khóa TEST hiện có không được dùng để suy ra app-signing key Production. Nếu Owner muốn dùng lại khóa TEST làm app-signing, đó là quyết định riêng: Owner phải xác nhận bản sao lưu và chứng thư Play Console, rồi báo Lead trước khi làm.

## 4. Environment `android-release` và bốn secret `ANDROID_UPLOAD_*` (Owner)

Workflow `mobile-aab-release.yml` chạy trong environment `android-release`. Bốn secret upload nằm **trong environment đó**, không nằm trong repository secrets. Chỉ bước ký (`Sign the bundle with the upload key`) nhận các secret này; workflow không đọc chúng ở bước khác (có guard test).

| Tên secret | Nội dung |
|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | File `upload-keystore.jks` mã hóa base64 một dòng |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Mật khẩu file keystore |
| `ANDROID_UPLOAD_KEY_ALIAS` | Alias của upload key (không bí mật, vẫn để trong secret cho đồng bộ) |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Mật khẩu của khóa |

Tạo environment và required reviewers: **Owner xác nhận trên console** (GitHub → repo → *Settings → Environments* → `android-release` → bật *Required reviewers*). Repo không ghi chi tiết giao diện.

Mã hóa base64 trên máy Owner (không in ra màn hình):
- PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\khoa-an-toan\upload-keystore.jks")) | Set-Content -NoNewline D:\khoa-an-toan\upload.b64`
- Git Bash: `base64 -w0 upload-keystore.jks > upload.b64`

Nạp bằng CLI (`gh` đọc từ file, không đưa giá trị vào lệnh):
```
gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --env android-release --repo trungtn87/11ship < D:\khoa-an-toan\upload.b64
gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD --env android-release --repo trungtn87/11ship
gh secret set ANDROID_UPLOAD_KEY_ALIAS --env android-release --repo trungtn87/11ship --body 'upload'
gh secret set ANDROID_UPLOAD_KEY_PASSWORD --env android-release --repo trungtn87/11ship
```
Sau đó xóa `upload.b64` khỏi máy.

Đặt các biến (repository variables), theo bảng mục 2:
```
gh variable set ANDROID_TEST_SIGNER_SHA256 --repo trungtn87/11ship --body '6aa5abfcace6e1b55f6cede5e1aea0dc449fdd3f67b50ebf5a92a62f38dbd0a3'   # tùy chọn, chỉ ghim APK test
gh variable set ANDROID_APP_SIGNER_SHA256 --repo trungtn87/11ship --body '<64 hex của app-signing Play>'   # đã đặt; chỉ đặt lại khi Owner yêu cầu
gh variable set ANDROID_UPLOAD_CERT_SHA256 --repo trungtn87/11ship --body '<64 hex của upload key>'   # tùy chọn
```

## 5. Firebase Cloud Messaging (FCM)

`mobile-aab-release.yml` yêu cầu FCM bật (`push=on`), nếu thiếu thì workflow FAIL. Giá trị lấy từ `google-services.json` của **từng app** Owner đăng ký trên Firebase (khớp `package_name`). Giá trị đã ghi trong các runbook trước; Owner đối chiếu lại trên Firebase console.

```
gh variable set FCM_PROJECT_ID --repo trungtn87/11ship --body 'local-f6a32'
gh variable set FCM_SENDER_ID --repo trungtn87/11ship --body '985944443790'
gh variable set FCM_SHIP_APP_ID --repo trungtn87/11ship --body '1:985944443790:android:c56a5a3b88f35acce6f2df'
gh variable set FCM_FOOD_APP_ID --repo trungtn87/11ship --body '1:985944443790:android:bb386bb34f2c0b71e6f2df'
gh secret set FCM_SHIP_API_KEY --repo trungtn87/11ship     # gh hỏi giá trị: dán API key Android, không qua chat
gh secret set FCM_FOOD_API_KEY --repo trungtn87/11ship
```

API key nằm trong `google-services.json`. File đó không đưa vào repo (`.gitignore` đã chặn).

## 6. Chạy workflow AAB (thủ công, từ `main`)

1. Đảm bảo `main` đã có commit cần phát hành. Kiểm tra `mobile/<app>/pubspec.yaml` (`version: X.Y.Z+N`) và đã tăng `N` so với hồ sơ mục 8.
2. GitHub → *Actions* → **Mobile AAB release (Play)** → *Run workflow*, nhánh `main`, chọn `app` = `food` hoặc `ship`.
3. Duyệt environment `android-release` (required reviewer của Owner).
4. Workflow tự kiểm: ref là `main`, ghim signer app-signing, checkout đúng SHA, endpoints, bản đồ offline Cao Bằng đủ checksum, build AAB, ký bằng upload key đúng một signer, kiểm chữ ký và manifest (package, versionName/versionCode khớp pubspec, targetSdk ≥ 36, quyền, dịch vụ vị trí), cổng versionCode (mục 8).
5. Lấy artifact `<11Food|11Ship>-v<version>-aab` (ví dụ `11Food-v1.0.0-aab`): gồm `<tên>.aab` và `<tên>-release.json`. Artifact giữ 7 ngày. Trong `-release.json`, `uploaded_to_play` là `false`, `source_sha` là SHA đã build.

Workflow không upload Play, không tạo tag, không tạo release. Build thành công **không** có nghĩa là đã nộp.

## 7. Tải lên Internal testing và đối chiếu chứng chỉ (Owner, thủ công)

1. Owner tải AAB từ artifact và tải lên track **Internal testing** trên Play Console. **Owner xác nhận trên console** các bước giao diện.
2. Sau khi Play ký lại bằng app-signing key, đối chiếu: dấu vân tay app-signing trên Play Console phải bằng `ANDROID_APP_SIGNER_SHA256`; dấu vân tay upload khớp `ANDROID_UPLOAD_CERT_SHA256` (nếu đã đặt). Nếu không khớp, dừng và báo Lead.
3. Chỉ sau khi Owner xác nhận Play **nhận** AAB, cập nhật hồ sơ versionCode theo mục 8.

## 8. Cập nhật hồ sơ versionCode sau khi Owner xác nhận Play nhận AAB

Quy tắc chi tiết ở [mobile/release/README.md](../../mobile/release/README.md). Trạng thái hiện tại: `mobile/release/play-submitted-versioncode.json` ghi `highest_submitted_version_code` = 0 cho cả hai app (chưa có xác nhận Play đã nhận AAB). Tóm tắt:
- Chỉ mở **PR riêng** sau khi Owner xác nhận Play đã nhận AAB của đúng package và versionCode. Build, artifact và file tải xuống **không** tính là đã nộp.
- Sửa `mobile/release/play-submitted-versioncode.json` cho đúng package: `highest_submitted_version_code`, `highest_submitted_version_name` (MAJOR.MINOR.PATCH), `owner_confirmed_on` (YYYY-MM-DD, ngày Owner xác nhận).
- Không bao giờ giảm giá trị; CI kiểm việc này so với `origin/main`.
- Kiểm cục bộ: `python mobile/tool/play_versioncode_gate.py validate` (Windows) hoặc `python3 mobile/tool/play_versioncode_gate.py validate`.

## 9. Chuyển từ APK ký TEST sang bản Production (cùng package ID)

- Chữ ký Production khác chữ ký TEST. Android **không cài đè** được: người dùng phải **gỡ bản TEST** rồi cài bản Production.
- Dữ liệu cục bộ trên máy (phiên đăng nhập, cache) mất theo; dữ liệu tài khoản vẫn ở backend. Người dùng đăng nhập lại.
- Thứ tự: (a) biến `ANDROID_APP_SIGNER_SHA256` đã đặt đúng (mục 2); (b) cài bản Production từ Internal testing; (c) chạy checklist mục 10; (d) chỉ sau khi đạt, gỡ bản TEST còn trên máy và ghi giờ gỡ.
- Không dùng bản TEST để kiểm chứng Production, và không dùng bản Production để kiểm chứng logic test.

## 10. Checklist nghiệm thu trên máy thật (Owner; CI xanh không thay thế)

Điều kiện: đã có bản cài từ Internal testing; VPS đã ở trạng thái đã duyệt (mục 11). Mỗi mục ghi đạt/không/giờ. Không chụp màn hình có số điện thoại, token hay địa chỉ.

- [ ] **Binder (peer):** cài cả 11Food và 11Ship, thử hai thứ tự cài. Hai app nhận diện nhau cùng signer, không báo lỗi xác thực peer.
- [ ] **OTP:** nhập số, nhận mã OTP qua SMS Gateway (#101/#103, kênh OTP duy nhất). Khi Gateway chưa sẵn sàng, app phải báo lỗi rõ, không tự chấp nhận mã.
- [ ] **FCM:** cấp quyền thông báo, đăng nhập, token đăng ký đúng app và đúng tài khoản (Owner xác nhận trên DB, không in token). Thông báo đến khi app ở nền và khi đóng hẳn.
- [ ] **Đúng người, đúng app:** sự kiện của shipper chỉ đến thiết bị shipper đó; 11Food không nhận thông báo của 11Ship.
- [ ] **Vị trí:** Ship cấp vị trí rồi từ chối, và tắt GPS. 11Food không xin vị trí nền; Ship chạy dịch vụ vị trí khi đang làm việc (foreground service).
- [ ] **Bản đồ offline:** bản đồ Cao Bằng hiển thị khi tắt mạng (build có `M14_OFFLINE_MAP=true`).
- [ ] **M13 (phiên bản):** màn hình phiên bản hiển thị đúng versionName/versionCode của bản đã cài. Phần cảnh báo cập nhật và trạng thái phát hành thuộc M13.07/M13.08 theo [quy ước phát hành](../../docs/process/release-versioning-20261019.md); nếu chưa triển khai, ghi "chưa triển khai", không ghi đạt.
- [ ] **Đăng xuất / chuyển tài khoản:** dữ liệu tài khoản cũ không còn trên màn hình.
- [ ] **Từ chối quyền thông báo:** app hướng dẫn mở cài đặt, không treo.
- [ ] **Buộc dừng (giới hạn đã biết):** sau khi người dùng buộc dừng app, Android không giao thông báo đến khi mở lại app. Ghi nhận, không coi là lỗi.

## 11. Allowlist signer trên VPS (chưa áp dụng; cần lệnh riêng của Owner)

- Hiện allowlist (`/etc/11ship/android-signers.json`, xem [m01-vps-android-sms-connect.md](m01-vps-android-sms-connect.md)) lấy từ artifact `android-signers.json` của workflow Mobile APK, tức chữ ký APK test.
- **Cần thêm** dấu vân tay app-signing Production, tức giá trị của biến `ANDROID_APP_SIGNER_SHA256` (mục 2; cùng cho hai app), để thiết bị cài từ Play đăng nhập được. Allowlist hiện chỉ có chữ ký TEST của APK CI. Đây là bước backend cần **lệnh riêng của Owner**; PR này và runbook này **không** thực hiện, không sửa file trên VPS, không deploy.
- Không dùng upload certificate trong allowlist: upload key không ký APK cài trực tiếp.
- Trước khi Owner ra lệnh: sao lưu file hiện tại; giữ JSON hợp lệ; quyền file theo quy trình VPS đã duyệt; khởi động lại service theo quy trình đã duyệt.

## 12. Giới hạn

- Repo không chứng minh được giao diện Play Console, environment reviewers, secrets/biến trên GitHub, hay Firebase: các mục đó ghi "Owner xác nhận trên console".
- Workflow AAB chưa chạy thật trên repo (cần environment, secrets, biến của mục 4–5).
- Biến TEST và biến Production tách riêng (mục 2). Các việc Owner làm trên console và trên VPS (mục 1, mục 11) chưa được repo chứng minh.

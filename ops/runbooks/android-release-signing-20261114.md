# Runbook — ký Android, phát hành Play và cấu hình FCM (cập nhật 15/11/2026, STORE-01 PR-C)

**Trạng thái:** tài liệu. Runbook này không tạo khóa, không đặt secret/biến, không chạy workflow ký, không upload Google Play, không deploy VPS. Mọi bước ghi "Owner" làm trên máy hoặc console của Owner.
**Không đưa khóa, mật khẩu, file keystore, base64, service-account JSON, token hay google-services.json vào chat, repo, PR hay log.** Chỉ dùng dấu vân tay SHA-256 (công khai) để đối chiếu.

Liên quan: [mobile/README.md](../../mobile/README.md) (mục Signing), [mobile/release/README.md](../../mobile/release/README.md) (hồ sơ versionCode), [mobile-apk.yml](../../.github/workflows/mobile-apk.yml) (APK test), [mobile-aab-release.yml](../../.github/workflows/mobile-aab-release.yml) (AAB Play), [release versioning](../../docs/process/release-versioning-20261019.md), [M08 runbook](m08-push-deploy-20261018.md).

---

## 0. Ba môi trường, không được lẫn

| Môi trường | Ai tạo / ở đâu | Chữ ký | Package | Dùng để làm gì |
|---|---|---|---|---|
| **APK test CI** | Workflow **Mobile APK** (chạy khi mở/cập nhật PR hoặc dispatch thủ công; không có trigger push) | Khóa **TEST** bền, secret `ANDROID_TEST_KEYSTORE_*`. **Đây là chữ ký test, KHÔNG phải chữ ký Production** | `vn.eleven.food`, `vn.eleven.ship` | Cài thử trên máy Owner. Cài đè giữa các bản test (giữ dữ liệu) |
| **Play Production** | Workflow **Mobile AAB release (Play)** (chỉ dispatch từ `main`, environment `android-release`) tạo AAB ký bằng **upload key**. Google Play ký lại bằng **app-signing key** khi phát hành | Upload key (ký AAB gửi Play); app-signing key do Play App Signing giữ hoặc đã đăng ký | Cùng package ID như trên | Owner tải AAB từ artifact và tải lên **Internal testing** thủ công |
| **VPS** (backend) | Không ký. Backend chỉ chấp nhận APK có chữ ký nằm trong allowlist signer | Không có khóa ký | — | Kiểm signer của APK khi đăng nhập thiết bị (allowlist `android-signers.json`) |

Quy tắc:
- Khóa TEST **không phải** app-signing key và **không bao giờ** được dùng làm chữ ký Production, không có ngoại lệ. Chữ ký TEST của CI không được ghim, đăng ký hay đưa vào chuỗi phát hành Production.
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

App-signing key Production do Play App Signing giữ hoặc đã đăng ký với Play; không suy ra từ khóa TEST hiện có.

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
gh variable set ANDROID_TEST_SIGNER_SHA256 --repo trungtn87/11ship --body '<64 hex của chứng chỉ TEST>'   # tùy chọn, chỉ ghim APK test
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

## 9. Thứ tự chuyển TEST → Play (một luồng tuyến tính, hai app cùng lúc)

Lý do: chữ ký Play khác chữ ký TEST, Android **không cài đè** được (phải gỡ TEST trước), và Binder yêu cầu 11Food và 11Ship cùng signer. Vì vậy hai app chuyển cùng nhau theo đúng thứ tự dưới đây. **Không chạy checklist mục 10 khi một app còn signer TEST và app kia là signer Play.**

1. **Secret/biến:** Owner xác nhận `ANDROID_APP_SIGNER_SHA256` đã đặt đúng (mục 2), bốn secret `ANDROID_UPLOAD_*` trong `android-release` (mục 4) và FCM (mục 5).
2. **Dispatch từ `main`:** chạy **Mobile AAB release (Play)** với `app=food`, rồi `app=ship` (mục 6); duyệt environment `android-release`; tải artifact `-aab` của từng app.
3. **Internal testing:** Owner tải AAB lên Internal testing và đối chiếu dấu vân tay app-signing (mục 7). Không khớp thì dừng và báo Lead.
4. **Hồ sơ versionCode:** sau khi Owner xác nhận Play nhận AAB, mở PR riêng cập nhật `mobile/release/play-submitted-versioncode.json` (mục 8).
5. **Allowlist VPS:** chỉ khi Owner ra lệnh riêng.
   - **Checkpoint bắt buộc trước khi đổi allowlist:** Owner xác nhận **CẢ HAI** bản (`food` và `ship`) đã **publish** trên Internal testing (không chỉ đã upload), và tester cài được cả hai app từ Play. Thiếu một trong các điều kiện này thì **không** đổi allowlist: sau cutover APK TEST bị từ chối, nên phải đã có bản Play cài được trước đó.
   - Sau checkpoint, thực hiện cutover nguyên tử ở mục 11, kèm health check và rollback sẵn sàng. Từ bước này APK TEST không còn được server chấp nhận.
6. **Gỡ TEST:** cảnh báo trước: phiên đăng nhập và cache cục bộ sẽ mất; dữ liệu tài khoản vẫn ở backend. Gỡ **cả hai** app TEST (`vn.eleven.food`, `vn.eleven.ship`) và ghi giờ gỡ.
7. **Cài từ Play:** cài cả hai app từ Internal testing, rồi đăng nhập lại.
8. **Nghiệm thu:** chạy checklist mục 10 (Binder, OTP, FCM, ...).

Không dùng bản TEST để kiểm chứng Production, và không dùng bản Production để kiểm chứng logic test.

## 10. Checklist nghiệm thu trên máy thật (Owner; CI xanh không thay thế)

Điều kiện: cả hai app đã là bản cài từ Play (mục 9, bước 7); cutover allowlist mục 11 đã xong và health đạt (mục 11, bước 4). Mỗi mục ghi đạt/không/giờ. Không chụp màn hình có số điện thoại, token hay địa chỉ.

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

## 11. Allowlist signer trên VPS (cutover nguyên tử; cần lệnh riêng của Owner)

- File allowlist Production là `/etc/11ship/trust/android-signers.json` (`CLIENT_DEVICE_ALLOWED_SIGNERS_FILE` trong [ops/vinahost/production.env.example](../vinahost/production.env.example); quy trình trong [vps-production-update-20261014.md](vps-production-update-20261014.md) mục 4). Nội dung hiện tại lấy từ artifact `android-signers.json` của **Mobile APK**, tức chữ ký TEST.
- **Schema bắt buộc** ([apps/backend/src/config/client-device-config.ts](../../apps/backend/src/config/client-device-config.ts)): đúng hai khóa `FOOD` và `SHIP`; mỗi khóa đúng hai trường `package_name` (`vn.eleven.food` / `vn.eleven.ship`) và `signer_sha256` (64 hex); hai `signer_sha256` phải bằng nhau. Mỗi app đúng một signer.
- **Cutover = THAY cả hai entry** bằng cùng một chứng chỉ Play app-signing (giá trị `ANDROID_APP_SIGNER_SHA256`, mục 2). **Không thêm** signer thứ hai: file có thêm khóa hay hai giá trị khác nhau bị từ chối và dịch vụ không khởi động.

```json
{"FOOD":{"package_name":"vn.eleven.food","signer_sha256":"<64 hex của ANDROID_APP_SIGNER_SHA256>"},"SHIP":{"package_name":"vn.eleven.ship","signer_sha256":"<cùng 64 hex>"}}
```

Các bước (Owner ra lệnh, chạy bằng root trên VPS). Tên unit production là `11ship-staging` (`/etc/systemd/system/11ship-staging.service`, đọc env từ `/etc/11ship/staging.env`; đường dẫn allowlist trong env là `CLIENT_DEVICE_ALLOWED_SIGNERS_FILE=/etc/11ship/trust/android-signers.json`, khớp [production.env.example](../vinahost/production.env.example)). Thư mục `/etc/11ship/trust` là `750 root:ship11`, file là `640 root:ship11`; service chạy User=`ship11` nên cần quyền đọc của nhóm `ship11`. Cutover **không** sửa `staging.env` hay unit.

1. **Sao lưu** (không ghi đè bản cũ), giữ quyền và chủ sở hữu, rồi kiểm bản sao khớp:
   ```
   test ! -e /etc/11ship/trust/android-signers.json.bak-<YYYYMMDD> && cp -p /etc/11ship/trust/android-signers.json /etc/11ship/trust/android-signers.json.bak-<YYYYMMDD>
   cmp /etc/11ship/trust/android-signers.json /etc/11ship/trust/android-signers.json.bak-<YYYYMMDD> && echo backup-ok
   ```
   Nếu bản `.bak-<YYYYMMDD>` đã tồn tại, dừng và báo Lead (không ghi đè bản sao lưu cũ).

2. **Ghi file mới ra tệp tạm** trong cùng thư mục, không sửa tại chỗ. `<file-mới>.json` là file đúng hai entry theo schema, do operator chuẩn bị trước (chỉ chứa dấu vân tay công khai):
   ```
   install -m 640 -o root -g ship11 <file-mới>.json /etc/11ship/trust/android-signers.json.new
   ```
   **Validate file `.new` trước khi thay** (đọc theo đường dẫn, không đọc stdin; cùng quy tắc với parser [client-device-config.ts](../../apps/backend/src/config/client-device-config.ts): đúng khóa `FOOD`/`SHIP`, đúng `package_name`, `signer_sha256` sau khi bỏ `:` và chuyển chữ thường đủ 64 hex, hai giá trị bằng nhau, không quá 16 KiB). Lệnh chỉ in tên trường lỗi, không in giá trị:
   ```
   node -e '
   const fs = require("fs");
   const f = process.argv[1];
   if (fs.statSync(f).size > 16384) throw new Error("file larger than 16 KiB");
   const v = JSON.parse(fs.readFileSync(f, "utf8"));
   const plain = (o, ks) => o !== null && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...ks].sort().join();
   const pkg = { FOOD: "vn.eleven.food", SHIP: "vn.eleven.ship" };
   const norm = (s) => String(s).replace(/:/g, "").toLowerCase();
   if (!plain(v, ["FOOD", "SHIP"])) throw new Error("top level: keys must be exactly FOOD and SHIP");
   for (const k of ["FOOD", "SHIP"]) {
     if (!plain(v[k], ["package_name", "signer_sha256"])) throw new Error(k + ": keys must be exactly package_name and signer_sha256");
     if (v[k].package_name !== pkg[k]) throw new Error(k + ": package_name mismatch");
     if (!/^[0-9a-f]{64}$/.test(norm(v[k].signer_sha256))) throw new Error(k + ": signer_sha256 must be 64 hex");
   }
   if (norm(v.FOOD.signer_sha256) !== norm(v.SHIP.signer_sha256)) throw new Error("FOOD and SHIP signer_sha256 differ");
   console.log("allowlist OK");
   ' /etc/11ship/trust/android-signers.json.new
   sudo -u ship11 test -r /etc/11ship/trust/android-signers.json.new && echo readable-by-ship11
   ```
   Nếu validate lỗi: `rm -f /etc/11ship/trust/android-signers.json.new`, dừng, báo Lead. File đang chạy không bị đụng tới nên dịch vụ không bị ảnh hưởng.

3. **Thay nguyên tử** (cùng thư mục, nên là một thao tác đổi tên):
   ```
   mv -f /etc/11ship/trust/android-signers.json.new /etc/11ship/trust/android-signers.json
   ```

4. **Khởi động lại và kiểm tra.** `reset-failed` chạy luôn trước `restart`: nếu lần thử trước đã chạm giới hạn khởi động (`StartLimitBurst=5` trong 300 s của unit), systemd sẽ từ chối restart với "Start request repeated too quickly" cho đến khi được reset.
   ```
   systemctl reset-failed 11ship-staging
   systemctl restart 11ship-staging
   for i in $(seq 1 60); do curl -fsS --max-time 2 http://127.0.0.1:3000/v1/health/ready >/dev/null 2>&1 && break; sleep 1; done
   curl -fsS --max-time 5 http://127.0.0.1:3000/v1/health/ready && [ "$(systemctl is-active 11ship-staging)" = active ]
   curl -fsS --max-time 10 https://<domain production>/v1/health/ready
   journalctl -u 11ship-staging -n 40 --no-pager
   ```
   Đạt khi: health local và public trả về thành công, `is-active` là `active`, nhật ký có dòng khởi động và **không** có lỗi cấu hình hay `Start request repeated too quickly`. `<domain production>` là host của `ADMIN_ACTIVATION_ORIGIN` trong `staging.env` (không ghi giá trị thật vào PR).

5. **Rollback** nếu bước 4 không đạt. Thứ tự bắt buộc:
   a. Dừng vòng restart nếu còn chạy (hủy auto-restart, không đụng dữ liệu): `systemctl stop 11ship-staging`.
   b. Khôi phục bản sao lưu **nguyên tử**: copy ra tệp tạm cùng thư mục rồi đổi tên, không ghi đè tại chỗ:
   ```
   cp -p /etc/11ship/trust/android-signers.json.bak-<YYYYMMDD> /etc/11ship/trust/android-signers.json.rollback
   mv -f /etc/11ship/trust/android-signers.json.rollback /etc/11ship/trust/android-signers.json
   cmp /etc/11ship/trust/android-signers.json /etc/11ship/trust/android-signers.json.bak-<YYYYMMDD> && echo restored
   ```
   c. Reset trạng thái lỗi: `systemctl reset-failed 11ship-staging`.
   d. Khởi động lại: `systemctl restart 11ship-staging`.
   e. Poll health local có timeout (như bước 4), rồi kiểm `https://<domain production>/v1/health/ready`.
   f. **Nếu health sau rollback vẫn lỗi:** ghi rõ **Production NOT READY** trong báo cáo, **dừng test thiết bị** (mục 10), không thử thêm cách đổi file trên VPS, và báo Lead kèm đầu ra `journalctl` đã lọc (không kèm nội dung file hay secret).
   g. Nếu rollback đạt: báo Lead kèm nguyên nhân bước 4 không đạt. Test thiết bị (mục 10) **chỉ** được làm khi bước 4 đạt.

Sau cutover, chữ ký TEST của APK CI **không còn được allowlist**; không dùng artifact `android-signers.json` của Mobile APK để cutover. Chấp nhận đồng thời TEST và Play cần PR backend/schema riêng có review. PR này và runbook này **không** nới `N11PeerPolicy`, **không** bỏ allowlist, **không** sửa file trên VPS và không deploy.
- Không dùng upload certificate trong allowlist: upload key không ký APK cài trực tiếp.

## 12. Giới hạn

- Repo không chứng minh được giao diện Play Console, environment reviewers, secrets/biến trên GitHub, hay Firebase: các mục đó ghi "Owner xác nhận trên console".
- Workflow AAB chưa chạy thật trên repo (cần environment, secrets, biến của mục 4–5).
- Biến TEST và biến Production tách riêng (mục 2). Các việc Owner làm trên console và trên VPS (mục 1, mục 11) chưa được repo chứng minh.

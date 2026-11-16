# Hồ sơ versionCode đã nộp Google Play

File: [play-submitted-versioncode.json](play-submitted-versioncode.json)

## Mục đích

Google Play yêu cầu `versionCode` của mỗi ứng dụng (mỗi package) luôn tăng và không trùng. Hồ sơ này lưu, **riêng cho từng package** (`vn.eleven.food`, `vn.eleven.ship`), số `versionCode` cao nhất mà Google Play **đã chấp nhận**.

Cổng kiểm tra `mobile/tool/check-aab-release.py` (qua `mobile/tool/play_versioncode_gate.py`) yêu cầu `versionCode` của AAB:

- **lớn hơn** giá trị đã nộp của đúng package; trùng hoặc nhỏ hơn thì FAIL;
- hồ sơ thiếu, sai schema, sai package, hoặc chứa giá trị không phải số nguyên thì FAIL;
- khởi tạo: tất cả giá trị là `0` (chưa có bản nào được nộp), nên `1.0.0+1` vẫn PASS.

## Quy tắc cập nhật (bắt buộc)

1. **Chỉ được cập nhật khi Owner xác nhận Google Play đã nhận AAB** của đúng package và versionCode đó.
2. Cập nhật bằng **PR riêng**, chỉ đổi hồ sơ này. Không gộp với thay đổi code hay build.
3. **Build thành công, artifact tải từ GitHub, file tải xuống máy, hay AAB đã ký KHÔNG được tính là đã nộp.**
4. Giá trị **không giảm** so với `origin/main`. Test `tests/deploy/play-versioncode-gate.test.mjs` (chạy trong `npm run deploy:test` của CI) kiểm tra việc này.
5. Khi đã nộp một bản (`highest_submitted_version_code` > 0): ghi kèm `highest_submitted_version_name` (`MAJOR.MINOR.PATCH`) và `owner_confirmed_on` (`YYYY-MM-DD`, ngày Owner xác nhận).
6. Nếu Play từ chối bản đã gửi, không hạ giá trị. Giữ nguyên hồ sơ và tăng `versionCode` cho bản mới.

## Cấu trúc

```json
{
  "schema": "11ship.play-submitted-versioncode.v1",
  "rule": "...",
  "apps": {
    "food": { "package": "vn.eleven.food", "highest_submitted_version_code": 0, "highest_submitted_version_name": null, "owner_confirmed_on": null },
    "ship": { "package": "vn.eleven.ship", "highest_submitted_version_code": 0, "highest_submitted_version_name": null, "owner_confirmed_on": null }
  }
}
```

Chỉ được có đúng các khóa trên. Khóa trùng lặp bị từ chối.

## Kiểm tra cục bộ

```bash
python3 mobile/tool/play_versioncode_gate.py validate
python3 mobile/tool/play_versioncode_gate.py check food 2
```

Lệnh `check` không cần secret và không truy cập Google Play.

## Phạm vi

Hồ sơ này không phải nguồn của `versionCode` (nguồn là `version:` trong `mobile/<app>/pubspec.yaml`, đọc qua `mobile/tool/app-version.sh`). Hồ sơ cũng không thay thế Play Console: Owner vẫn là người xác nhận việc nộp bài và cấu hình track.

## Ghim script của job AAB

File ghim: [script-pins.sha256](script-pins.sha256). Mỗi dòng là SHA-256 của nội dung LF một file trong **closure thực thi** của job AAB, gồm:

- file được gọi trực tiếp: `app-version.sh`, `prepare-android.sh`, `sign-aab.sh`, `check-aab-release.py`;
- module mà file được gọi import khi chạy: `play_versioncode_gate.py` (do `check-aab-release.py` import ở bước verify).

Mọi bước gọi script đều chạy `sha256sum -c mobile/release/script-pins.sha256` trước; file lệch digest thì bước FAIL.

- Sửa một file trong closure phải cập nhật **cùng PR** ba chỗ: file, dòng digest trong `script-pins.sha256`, và `scriptPins` trong `tests/deploy/fixtures/mobile-aab-release.golden.json`. Thiếu một chỗ thì `tests/deploy/ci-gate-policy.test.mjs` FAIL.
- Tính lại digest: `tr -d '\r' < mobile/tool/<tên> | sha256sum`.
- Thêm `import` cục bộ mới vào script đã ghim thì phải ghim module đó; test closure trong `ci-gate-policy.test.mjs` sẽ FAIL nếu quên.
- Pin chỉ chặn việc đổi file lặng lẽ ngoài diff được duyệt. Pin nằm trong cùng repo nên không chống được commit độc hại đã được merge.

## Vì sao KHÔNG ghim dữ liệu đầu vào của script

Pin chỉ áp dụng cho **mã** của script trong closure ở trên. Các **dữ liệu** mà script đọc khi chạy thì không ghim, vì chúng thay đổi hợp lệ theo từng bản phát hành hoặc từng thay đổi Android, và việc ghim chúng sẽ làm mọi lần phát hành FAIL mà không tăng độ an toàn:

- **`version:` trong `mobile/<app>/pubspec.yaml`** (đọc bởi `app-version.sh`): đổi ở mỗi bản phát hành (`X.Y.Z+N`, `N` luôn tăng). `app-version.sh` đã kiểm tra định dạng bằng regex, và `versionCode` được đối chiếu với hồ sơ Play bên dưới.
- **Hồ sơ `play-submitted-versioncode.json`** (đọc qua `play_versioncode_gate.py`): cập nhật bằng PR riêng sau khi Owner xác nhận Google Play đã nhận bản đó. Tính đơn điệu được kiểm tra bằng `play-versioncode-gate` test so với `origin/main`, không cần digest.
- **Template trong `mobile/tool/android-templates/`** (được `prepare-android.sh` sao chép vào project Android khi build): nội dung đổi khi Android thay đổi (manifest, Kotlin, cấu hình mạng, style). Mọi thay đổi này đã đi qua review PR và qua build APK/AAB; ghim chúng sẽ bắt buộc cập nhật digest ở mọi thay đổi Android mà không bảo vệ thêm được gì, vì pin nằm trong cùng repo (xem ghi chú ở trên).

Quy tắc: `prepare-android.sh`, `app-version.sh` và `play_versioncode_gate.py` vẫn được ghim như mã; chỉ dữ liệu chúng đọc là không ghim. Nếu một thay đổi dữ liệu làm đổi cách script hiểu nó (ví dụ đổi định dạng `version:`), thay đổi đó phải đi kèm sửa script và test tương ứng trong cùng PR.

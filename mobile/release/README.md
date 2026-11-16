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

---
name: flutter-design-tokens
description: Dùng khi sửa/viết UI Flutter trong mobile/ (11Food, 11Ship, n11_shared). Bắt buộc dùng token N11 có sẵn thay vì hardcode màu, chữ, khoảng cách, bo góc.
---

# Flutter design tokens (11Ship / 11Food)

Nguồn token duy nhất: `mobile/packages/n11_shared/lib/src/tokens.dart` (`N11Colors`, `N11Space`, `N11Text`, `N11V5`, `kRadius*`, `kControlHeight`, `kTapMin`, `buildN11Theme()`). Đọc file này trước khi sửa UI; không dựa vào trí nhớ về giá trị.

## Thứ tự ưu tiên (khi xung đột)
1. Figma và câu chữ (copy) Owner đã duyệt luôn thắng skill này. Figma app inventory: key `EyAEccPieSHFJgdCvijQBz`; tài liệu V5: `docs/design/v5-live-ui-20261028.md`.
2. Token/widget dùng chung có sẵn.
3. Skill này.
Không tự đổi nghiệp vụ, câu chữ, luồng, API. Thiếu quyết định thiết kế thì hỏi Claude Lead/Owner, không tự chế.

## Quy tắc
- **Màu:** dùng `N11Colors.*`. Không viết `Color(0x...)`, `Colors.xxx` (trừ `Colors.transparent`) trong widget. Màn hình cần màu chưa có: thêm token có tên theo ý nghĩa vào `tokens.dart` (kèm comment nguồn Figma), không đặt literal trong widget. Thêm token chỉ khi thật sự cần, và chỉ một lần.
- **Thương hiệu:** vàng `#FFC400` (`N11Colors.yellow`), chữ/icon trên nền vàng luôn `#191919` (`N11Colors.black`), không bao giờ trắng trên vàng. Cam `#ED6A00` chỉ là nhấn (tab đang chọn), không dùng làm màu nút chính. Chữ link dùng `yellowStrong`, không dùng vàng thường làm chữ trên nền trắng (không đủ tương phản).
- **Trạng thái:** success/error/warning/info luôn đi kèm chữ và icon, không chỉ màu. Dùng cặp `xxx` + `xxxSoft` có sẵn.
- **Chữ:** dùng `N11Text.*` hoặc `Theme.of(context).textTheme`; đổi biến thể bằng `.copyWith(...)` (đổi color qua `N11Colors`). Không dựng `TextStyle(fontSize: ...)` mới, không đổi `fontFamily` (`PlusJakartaSans` đã gắn trong theme/token).
- **Khoảng cách:** bội số của 4, dùng `N11Space.gap1/2/3/4/6/8` (4/8/12/16/24/32). Không dùng số lẻ như 5, 7, 10, 15, 18 cho padding/margin/gap. Lề màn hình chuẩn `N11Space.pad` (16).
- **Bo góc:** control `kRadiusControl` (12), card `kRadiusCard` (16), pill `kRadiusPill`. Hình học V5 riêng (input 16, card 17, search 25, map 18) dùng `N11V5.*`, chỉ ở nơi Figma/`v5-live-ui-20261028.md` quy định. Không tự thêm số bo góc mới.
- **Kích thước chạm:** tối thiểu `kTapMin` (48); nút/field cao `kControlHeight` (48).
- **Widget dùng chung:** ưu tiên `N11Button`, `N11Card`, `N11Chip`, `N11Banner`, `N11Field`, `N11ListItem`, `EmptyState`, `N11StateBlock`, `N11AppBar`... trong `mobile/packages/n11_shared/lib/src/widgets/` trước khi dựng widget mới. Sửa kiểu dáng chung bằng cách sửa widget/theme dùng chung, không rải override từng màn.
- **Bóng:** dùng `N11V5.cardShadow` hoặc theme; xem `flutter-ui-polish`.

## Phạm vi
- Chỉ đổi màn/widget nằm trong yêu cầu của PR. Gặp hardcode ở màn khác: ghi vào báo cáo, không sửa lan.
- Không chạy `dart format` trên file ngoài phạm vi; không sửa import/thứ tự/định dạng của code không liên quan.
- Không đổi tên hoặc giá trị token đang có (nhiều PR/ứng dụng đang dùng). Cần đổi giá trị: hỏi Lead.

## Trước khi báo xong
- `grep -nE "Color\(0x|Colors\.|TextStyle\(|EdgeInsets\.[a-zA-Z]+\([^)]*[0-9]" ` trên các file đã sửa: mọi kết quả mới do mình thêm phải qua token hoặc có lý do ghi trong PR.
- `flutter analyze` và widget test liên quan của vùng đã đổi.

## Skill layout đi kèm
`flutter-build-responsive-layout` và `flutter-fix-layout-issues` là bản chính chủ của Flutter, chép nguyên văn. Dùng khi sửa bố cục/overflow. Quyết định đã chốt của app (ví dụ hướng màn hình, breakpoint) và Figma thắng các skill này.

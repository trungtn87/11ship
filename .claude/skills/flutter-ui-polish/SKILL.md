---
name: flutter-ui-polish
description: Dùng khi chỉnh UI Flutter đã làm cho bớt "cứng"/giống Material 3 mặc định ở màn đang sửa: khoảng trắng, phân cấp chữ, bề mặt nhẹ, loading/empty/error, tách widget.
---

# Flutter UI polish (11Ship / 11Food)

Dùng cùng `flutter-design-tokens` (token là điều kiện, skill này là cách bố cục). Figma và câu chữ Owner đã duyệt luôn thắng; nếu Figma khác skill, làm theo Figma.

## Phạm vi (quan trọng)
- Chỉ áp cho màn/widget **đang được yêu cầu sửa**. Không "tiện tay" làm đẹp màn khác trong cùng PR; vấn đề thấy ngoài phạm vi → ghi 1 dòng trong báo cáo.
- Không đổi nghiệp vụ, API, luồng, câu chữ, thứ tự thông tin đã duyệt. Chỉ đổi cách trình bày.
- Không `dart format` file ngoài phạm vi. Không thêm ảnh/dữ liệu minh họa giả vào production (xem `docs/design/v5-live-ui-20261028.md`).
- Gói thay đổi nhỏ, một PR một mục đích.

## Cách làm
1. **Đọc trước, đừng đoán:** mở màn hiện tại + Figma tương ứng (nếu có), liệt kê điểm "cứng" cụ thể (khoảng cách chật, quá nhiều cỡ chữ, bóng đậm, thiếu state) rồi mới sửa.
2. **Khoảng trắng trước:** nhóm nội dung liên quan sát nhau (`gap2`–`gap3`), tách nhóm bằng `gap4`–`gap6`. Thay vì thêm viền/đường kẻ để chia, hãy dùng khoảng trắng.
3. **Phân cấp chữ:** tối đa 2–3 cấp trên một card (ví dụ tiêu đề `label`/`bodyStrong`, nội dung `body`, phụ `caption`). Không trộn nhiều cỡ/đậm khác nhau; nhấn mạnh bằng đậm hoặc màu token, không bằng cỡ lạ.
4. **Bề mặt:** nền trắng trên `bg` (`#F7F8FA`) + viền mảnh 1px `N11Colors.line`, hoặc bóng nhẹ `N11V5.cardShadow`. Tránh `elevation` lớn, bóng đậm, nhiều lớp bóng, và tránh viền đậm. Không để card lồng card.
5. **Điểm nhấn tiết chế:** mỗi màn một hành động chính (nút vàng). Nút phụ dùng outline/ghost. Không rải vàng/cam khắp nơi.
6. **Đủ trạng thái cho dữ liệu của màn đang sửa:**
   - Loading: khung xương (skeleton/shimmer) giống bố cục thật nếu danh sách/card; spinner chỉ cho tác vụ ngắn trong nút. Không thêm package shimmer mới: dùng widget sẵn có hoặc skeleton đơn giản bằng `N11Colors.disabledBg`/`line` có hoạt ảnh nhẹ.
   - Empty: dùng `EmptyState` có icon + câu ngắn + nút hành động khi có việc cụ thể để làm (câu chữ phải do Owner duyệt hoặc theo mẫu đã có; thiếu câu → hỏi).
   - Error: `N11StateBlock`/`N11Banner` có chữ + icon + nút "Thử lại" nếu thao tác an toàn lặp lại được. Không nuốt lỗi, không hiện lỗi thô.
7. **Co giãn:** không cố định chiều rộng/cao bằng số khi nội dung có thể dài (tiếng Việt, cỡ chữ lớn): dùng `Expanded`/`Flexible`, `maxLines` + `overflow`, `LayoutBuilder` khi cần. Kiểm tra không có RenderFlex overflow ở 360×640 và cỡ chữ 1.3x. Không khóa xoay màn hình.
8. **Tách widget:** `build()` quá dài (khoảng 80+ dòng) thì tách phần đang sửa thành widget nhỏ có tên rõ, `const` được thì `const`, tham số tường minh. Chỉ tách vùng đang động vào, không tái cấu trúc cả file.
9. **Chuyển động:** ngắn (150–250ms), chỉ để báo trạng thái (nhấn, đổi tab, hiện nội dung); không thêm hiệu ứng trang trí.
10. **Truy cập:** tương phản đủ, chạm ≥ 48, `Semantics`/`tooltip` cho icon-only, không dùng màu làm tín hiệu duy nhất.

## Trước khi báo xong
- `flutter analyze` + widget test của vùng sửa (cập nhật golden/test nếu đổi cấu trúc widget được test).
- Chụp màn trước/sau nếu có thể (390×844) để Owner/Antigravity so với Figma. Chưa chụp được thì ghi "chưa chụp", không tự khẳng định đẹp.
- Báo cáo: đã đổi gì, nhìn thấy gì còn "cứng" nhưng ngoài phạm vi.

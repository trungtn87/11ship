# M02 — Đặc tả chức năng và gói giao Claude Design
Ngày 14/10/2026 · Phiên bản 1.1.

**Owner cập nhật phạm vi lúc 12:38:** 11Food và 11Ship chỉ triển khai app điện thoại; không phát triển hoặc nghiệm thu bản web của hai app. Web quản trị Admin giữ phạm vi riêng. Quyết định này ưu tiên hơn mọi yêu cầu web/desktop của Food/Ship trong kế hoạch M02 và brief cũ.
Bộ UI nhận: “11Ship M02 UI module design.zip”. Phone.dc.html là nguồn tham chiếu giao diện app; các màn Food web trong WebView.dc.html không thuộc triển khai. D01/D02 Admin có điều kiện vẫn áp dụng. HTML/DC là định dạng thiết kế, không quyết định nền tảng sản phẩm.
Đã kiểm kê cấu trúc và index/state coverage; chưa chứng nhận visual QA hoặc Owner UI_LOCKED.
Phạm vi/nghiệp vụ/kế hoạch M02 đã được Owner chốt lúc 09:57. Owner yêu cầu hoàn thiện toàn bộ chức năng và giao Claude Design thiết kế UI lúc 10:07.
Tài liệu này cụ thể hóa thao tác và trạng thái để thiết kế; đầu ra Claude Design là bản UI để Owner duyệt, chưa phải UI_LOCKED hay mã sản phẩm.

**Owner cập nhật 15:06:** UI v3 được chốt tạm để triển khai, tinh chỉnh sau khi nối xong M02. Tham chiếu nguồn chính và finding cần sửa ở [UI v3](../ui/m02/v3/README.md) và [kế hoạch](../current/M02-workstreams-20261014.md). Các câu yêu cầu web Food/Ship hoặc UI_LOCKED hoàn thiện trong brief lịch sử nhường quyết định này. Hợp đồng kỹ thuật menu/storage còn cần đối chiếu trước code.

## 1. Nhiệm vụ và ranh giới
M02 quản lý hoạt động quán và thực đơn, gồm giao diện chủ quán + khách trong app 11Food và phần danh mục web quản trị tối thiểu khi cần. App 11Ship dành cho xế không thêm màn M02.
Dùng lại đăng nhập, tài khoản, đổi context, onboarding quán, GPS và component M01. Không thiết kế lại toàn bộ M01.
Kết quả: chủ quán lưu hồ sơ/lịch/món; khách xem thực đơn đúng trạng thái và phạm vi công khai.
Chưa có giỏ hàng, đặt đơn, gọi xế, ví, COD, doanh thu, khuyến mãi, đánh giá, topping, size, combo, định lượng, nghỉ lễ, tìm quán/xếp hạng công khai.
Không dựng nút giả cho các chức năng ngoài phạm vi. Màn khách được mở khi có shop ID từ route/điểm vào hiện hữu; không tự xây trang tìm quán trong M02.

Nguồn ưu tiên:
1. Quyết định Owner M02 đã chốt trong 11Ship-M02-thiet-ke-ke-hoach-20261014.md.
2. Quyết định M01: khách + chủ quán trong 11Food; 11Ship là app xế.
3. Contract backend M02-A cho hồ sơ/lịch, dùng lại phần đã có.
4. UI/Brand M01 mới đã duyệt; token brand cho phần chưa có component.
Nếu tài liệu cũ đặt quán trong app Ship hoặc có công tắc nhận đơn, áp dụng quyết định mới trên.

## 2. Quyền và trạng thái
| Người/trạng thái | Xem được | Thao tác |
|---|---|---|
| Khách chưa đăng nhập | Chi tiết quán hợp lệ và thực đơn công khai | Xem lịch; không yêu cầu login chỉ để xem món |
| CUSTOMER | Như khách; mục Quản lý cửa hàng ở Tài khoản theo M01 | Vào onboarding/context hiện hữu |
| OWNER, quán ACTIVE | Quản lý đúng quán của mình, cả khi ngoài giờ | Sửa hồ sơ/lịch/món, hiện/ẩn/xóa mềm, xem trước |
| Hồ sơ INCOMPLETE | Trạng thái và hướng dẫn hoàn tất M01 | Hoàn tất hồ sơ; không gửi mutation ACTIVE/menu |
| Quán DISABLED | Hồ sơ/trạng thái được backend cho đọc | Chỉ đọc; không cho lưu/ẩn/xóa/upload |
| Khu vực INACTIVE, quán ACTIVE | Quản lý own quán, trạng thái lý do | Hồ sơ phải chọn khu vực hợp lệ khi lưu; public không trả quán |
| Phiên mất hiệu lực/thiếu quyền | Nội dung chung và hướng xử lý M01 | Dừng thao tác; xác thực/chọn context lại |
| ADMIN/SYSTEM | Chỉ danh mục theo quyền hiện hữu | Không tự suy ra quyền mới từ tên role |

Đăng nhập không tự cấp OWNER. Một OWNER sở hữu một quán. Backend kiểm quyền cho mọi yêu cầu.
SHOP là context kỹ thuật hiện hữu; UI dùng “Quản lý cửa hàng”, không hiển thị tên enum cho người dùng.
Quản lý quán không làm mất quyền CUSTOMER.

## 3. Danh mục màn và trạng thái thiết kế
Các ID dùng trong bộ UI, không đổi ID task/PR lịch sử.

| ID | Màn | Trạng thái cần thể hiện |
|---|---|---|
| Q01 | Quản lý cửa hàng | Mở/đóng/chưa có lịch; hồ sơ thiếu; vô hiệu; khu vực ngừng; dữ liệu cũ |
| Q02 | Hồ sơ quán | Xem/sửa; lấy GPS; GPS bị từ chối; dữ liệu đã đổi; chỉ đọc |
| Q03 | Giờ hoạt động | Chưa cài; lịch chung; từng ngày; đóng cả tuần; lỗi trùng |
| Q04 | Chỉnh giờ | Trong ngày; qua đêm; 24 giờ; nhiều khoảng; đóng ngày |
| Q05 | Quản lý thực đơn | Có món; rỗng; lọc/tìm không có; món ẩn; nhóm ngừng hoạt động |
| Q06-A | Thêm món | Không ảnh; có ảnh; một/nhiều/không có nhóm; validation |
| Q06-B | Sửa món | Có/không ảnh; đang hiện/ẩn; upload lỗi; conflict; món đã xóa |
| Q07 | Xem trước thực đơn | Quán mở/đóng/chưa lịch; thực đơn rỗng; món ẩn bị loại khỏi preview |
| K01 | Chi tiết quán phía khách | Mở/đóng/chưa lịch; món có/không ảnh; thực đơn rỗng; không khả dụng |
| K02 | Lịch hoạt động phía khách | Lịch tuần, nhiều ca, qua đêm, 24 giờ, chưa có lịch |
| D01 | Danh mục hệ thống quản trị | Phần có điều kiện: nếu nguồn danh mục chưa có UI phù hợp |
| D02 | Thêm/sửa danh mục | Phần có điều kiện: tên và trạng thái; không xóa vật lý |

Các hộp thoại dùng chung: áp dụng cả tuần; đóng cả tuần; bỏ thay đổi; ẩn món; xóa món; tải dữ liệu mới khi conflict; thao tác đang chờ xác định kết quả.
Trạng thái dùng chung: tải, đang lưu, rỗng, lỗi tải, mất mạng, upload, hết phiên, chỉ đọc.
Không nhân bản toàn bộ màn cho mọi trạng thái nếu một component/state đủ mô tả; phải có mapping trạng thái → component.

## 4. Q01 — Quản lý cửa hàng
Điểm vào: Tài khoản M01 → Quản lý cửa hàng. Quán chưa có/chưa hoàn tất dùng luồng M01.
Nội dung theo thứ tự:
- Header Quản lý cửa hàng, nút Quay lại.
- Tên quán; trạng thái hồ sơ riêng nếu cần.
- Card trạng thái hoạt động theo máy chủ.
- Hồ sơ quán; Giờ hoạt động; Thực đơn; Xem trước thực đơn.
Không thêm thẻ doanh thu, đơn hôm nay, số xế hoặc công tắc nhận đơn.

| Trạng thái máy chủ | Nhãn chủ quán | Hướng xử lý |
|---|---|---|
| ONLINE | Đang mở cửa | “Quán tự hoạt động theo lịch đã lưu.” |
| OUTSIDE_BUSINESS_HOURS | Đã đóng cửa | “Ngoài giờ hoạt động đã cài đặt.”; vào Giờ hoạt động |
| NO_BUSINESS_HOURS | Chưa cài giờ hoạt động | CTA Cài giờ hoạt động |
| SHOP_INCOMPLETE | Hồ sơ chưa hoàn tất | CTA Hoàn tất hồ sơ theo M01 |
| SHOP_DISABLED | Quán đã bị vô hiệu hóa | Đọc hồ sơ; thao tác ghi bị khóa |
| SERVICE_AREA_INACTIVE | Khu vực phục vụ ngừng hoạt động | Xem/sửa hồ sơ chọn khu vực phù hợp |

Tải lại khi mở, quay foreground, sau lưu; mỗi 30 giây khi card đang hiện, không request chồng nhau.
Mất mạng hiển thị “Chưa cập nhật trạng thái” và thời điểm cập nhật gần nhất khi có. Không tự suy trạng thái bằng giờ điện thoại.
Không hiển thị “Mở lại lúc...” vì backend chưa có trường này.

## 5. Q02 — Hồ sơ quán
Dùng cấu trúc hồ sơ M01, bổ sung edit ACTIVE nếu còn thiếu, không tạo form onboarding thứ hai.
Fields:
| Trường | Quy tắc | UI |
|---|---|---|
| Tên quán | Bắt buộc theo validator backend | Input văn bản |
| SĐT liên lạc của quán | Bắt buộc; khác SĐT đăng nhập được | Bàn phím số, nhãn rõ |
| Zalo | Tùy chọn | Input theo validator hiện hữu, không tự thêm ràng buộc mới |
| Facebook | Tùy chọn | Input theo validator hiện hữu |
| Địa chỉ | Bắt buộc, nhập tay | Có thể nhiều dòng |
| Vị trí lấy hàng | GPS hợp lệ theo contract | Tọa độ + Lấy vị trí hiện tại |
| Khu vực phục vụ | ACTIVE khi lưu hồ sơ | Chọn từ dữ liệu máy chủ |

Không có đổi SĐT đăng nhập, cấp quyền, đổi chủ quán hoặc quán thứ hai.
Lấy vị trí chỉ khi bấm. Đang lấy có trạng thái rõ. Từ chối/timeout không xóa tọa độ cũ hoặc ghi 0,0.
Giữ cách nhập/chỉnh tọa độ M01 đã duyệt; không tự thêm bản đồ/geocoding nhà cung cấp mới.
Trường tùy chọn để trống được lưu null. Không đổi constraint độ dài/format backend trong bản UI.
Lưu thành công → đọc lại → hiển thị hồ sơ mới. Profile và lịch dùng chung version: sửa ở nơi khác có thể gây conflict.
Bỏ thay đổi trở về giá trị đã tải; rời khi dirty phải xác nhận.
INCOMPLETE dùng endpoint/màn onboarding. DISABLED chỉ đọc và không CTA Lưu.

## 6. Q03/Q04 — Giờ hoạt động
### 6.1 Cấu trúc
Ghi “Giờ Việt Nam”; dòng Cả tuần ở đầu, rồi Thứ Hai đến Chủ nhật.
Mỗi ngày có các khoảng giờ hoặc Đóng cửa; chạm ngày mở editor.
Cả tuần giống nhau → hiện lịch chung. Khác nhau → “Tùy chỉnh theo ngày”.
Cả tuần là công cụ nhập nhanh; không là ngày thứ tám hoặc lịch ưu tiên.
Một nút Lưu lịch ghi toàn bộ tuần. Xong trong editor chỉ sửa draft.

### 6.2 Editor
Mỗi khoảng: giờ mở, giờ đóng, loại khoảng Trong ngày / Qua đêm / 24 giờ.
Trong ngày: giờ đóng lớn hơn giờ mở, có thể kết thúc 24:00.
Qua đêm: ghi “Giờ đóng thuộc ngày hôm sau”; thời lượng không quá 24 giờ.
24 giờ: chọn rõ chế độ này; cho giờ bắt đầu, giờ kết thúc cùng giờ hôm sau. 00:00–24:00 thể hiện Cả ngày.
Không diễn giải bất kỳ hai giờ bằng nhau thành ca 24h khi người dùng chưa chọn.
Có + Thêm khoảng, Xóa khoảng; đóng ngày bằng bỏ toàn bộ khoảng. Không công tắc ONLINE.
Hủy editor không làm thay draft ngày; Xong kiểm lịch trước khi áp dụng.

### 6.3 Quy tắc và xác nhận
Tối đa 28 khoảng toàn tuần, không giới hạn riêng 4 khoảng/ngày. Cả tuần nhân bảy phải kiểm tổng.
Không overlap cả trong ngày, qua ngày và CN→T2. Liền kề được; không tự gộp hoặc xóa khoảng.
Ngày bắt đầu sở hữu ca qua đêm. CN 22:00–T2 02:00 kiểm với lịch T2.
Cả tuần → Áp dụng cho cả tuần: thay draft bảy ngày; nếu đang ghi đè thì hỏi “Thay lịch của cả 7 ngày?” với Giữ lịch / Thay lịch.
Cả tuần rỗng được áp dụng thành đóng tuần, mô tả rõ. Lưu [] hỏi “Quán sẽ đóng cửa cả tuần theo lịch này.” với Quay lại / Lưu lịch.
Áp dụng rồi chưa Lưu: server giữ lịch cũ. Sau áp dụng vẫn sửa riêng CN.
Không thêm ngày nghỉ lễ hoặc lịch theo ngày dương lịch.

### 6.4 Ví dụ phải dựng
- Cả tuần 17:00–23:00, CN 17:00–22:00.
- Một ngày 10:00–14:00 và 17:00–23:00.
- CN 22:00–02:00 (hôm sau).
- Cả ngày 00:00–24:00.
- Lịch trùng qua đêm, lỗi cạnh khoảng liên quan.
- Chưa có lịch và đóng cả tuần.
Lịch trống trên server là đóng tuần. UI có thể phân biệt draft vừa mở chưa cài với thông báo sau khi người dùng chủ động lưu trống; không cần invent trạng thái DB mới.

## 7. Q05 — Quản lý thực đơn
Danh sách chỉ món của quán mình, không gồm món đã xóa.
Header Thực đơn + Thêm món; input “Tìm món trong thực đơn”; filter Tất cả / Đang hiện / Đang ẩn; chọn nhóm nếu nhiều nhóm.
Một dòng: ảnh nhỏ/placeholder, tên, giá VND, trạng thái, thao tác phụ.
Chạm dòng → sửa. Không ẩn/xóa khi chỉ chạm tên.
Tìm theo tên; xử lý không phân biệt hoa thường/dấu trong bộ lọc giao diện khi phù hợp. Đây là tìm trong quán, không phải API tìm kiếm công khai.
Nếu backend phân trang, tìm/lọc phải xét tập dữ liệu quán theo contract; không giả “không có” chỉ vì chưa tải trang khác. Cách phân trang là quyết định implementation sau đối chiếu.
Danh sách không có món: “Chưa có món trong thực đơn” + Thêm món.
Không khớp lọc/từ khóa: “Không tìm thấy món phù hợp” + Xóa bộ lọc. Không gợi ý thêm món như thể quán chưa có dữ liệu.
Sau sửa giữ filter và vị trí danh sách khi khả thi; nếu món không còn khớp filter thì giải thích kết quả bằng toast.

Nhóm hệ thống:
- Một nhóm ACTIVE → tự chọn khi thêm, ẩn selector.
- Nhiều nhóm → chọn một nhóm.
- Không có nhóm ACTIVE → không tạo món; “Chưa có nhóm món để lựa chọn”, cho Thử lại. Không nhóm giả.
- Nhóm cũ INACTIVE → vẫn hiện tên và ghi Ngừng hoạt động trong màn quản lý; không tự chuyển nhóm.
- Inactive là không được chọn cho món mới; không tự ẩn món hiện hữu chỉ vì nhóm đổi trạng thái. Hợp đồng sửa món phải giữ hoặc đổi liên kết rõ ràng, không âm thầm bỏ nhóm.
- Nhóm hệ thống không do chủ quán thêm; không nút + Nhóm trên app quán.
Không kéo thả thứ tự, chọn nhiều món hoặc chỉnh hàng loạt trong M02.

## 8. Q06 — Thêm/sửa món
### 8.1 Trường và thao tác
| Trường | Quy tắc |
|---|---|
| Tên món | Bắt buộc; trim; cho trùng tên, định danh bằng ID |
| Giá bán | VND nguyên, >0; hiển thị ví dụ 120.000 đ, nhập số không phần thập phân |
| Nhóm | Một nhóm hệ thống theo quy tắc mục 7 |
| Ảnh | Tùy chọn; thêm/thay/xóa ảnh trong draft |

Giới hạn độ dài tên/giá/kích thước ảnh theo contract backend trước code; Claude Design không tự đặt con số nghiệp vụ.
Món mới mặc định Đang hiện. Màn thêm chỉ lưu món mới; không đặt nút Xóa món.
Màn sửa có trạng thái hiện/ẩn và menu phụ Ẩn/Hiện, Xóa món.
Không mô tả dài, tùy chọn ăn, topping, giá giảm, tồn kho, hết món riêng hoặc công thức.

### 8.2 Ảnh
Bấm vùng ảnh → Chọn ảnh từ thiết bị. Dùng hành vi chọn ảnh M01/OS phù hợp, không tự yêu cầu camera hay permission ngoài thao tác cần.
Chọn xong có preview; ảnh không hợp lệ có lỗi cạnh ảnh. Thay ảnh không xóa ảnh server cũ khi upload thất bại.
Bấm Xóa ảnh chỉ thay draft; Lưu thành công mới gỡ tham chiếu ảnh của món.
Nếu upload đang chạy, khóa Lưu hoặc báo chờ upload; không lưu đường dẫn local.
Hủy form/ảnh lỗi giữ dữ liệu món server nguyên vẹn. Nếu ảnh lỗi, người dùng có thể bỏ ảnh draft để lưu món không ảnh.
Ảnh mẫu trong thiết kế có nhãn dữ liệu mẫu; sản phẩm dùng ảnh người dùng, không sinh ảnh món để điền dữ liệu thật.
Placeholder không ảnh giữ kích thước card ổn định. Không thêm màn crop bắt buộc.

### 8.3 Hiện/ẩn và xóa
Ẩn: hộp xác nhận “Ẩn món này?”; mô tả “Món sẽ không xuất hiện trong thực đơn của khách. Bạn có thể hiện lại.”; Giữ món / Ẩn món.
Hiện lại: hành động Hiện món; khi thành công đổi trạng thái và xuất hiện public. Không cần hộp xác nhận lặp nếu không mất dữ liệu.
Xóa: “Xóa món khỏi thực đơn?”; mô tả “Món sẽ được đưa khỏi danh sách quản lý và thực đơn của khách.”; Giữ món / Xóa món.
Xóa mềm không ảnh hưởng món khác, không sửa đơn cũ. Không có khôi phục/thùng rác trong M02.
Các mutation hiện/ẩn/xóa là thao tác riêng lên dữ liệu đã lưu. Nếu form đang dirty, yêu cầu Lưu hoặc Bỏ thay đổi trước khi chạy thao tác này; không âm thầm làm mất input.
Nếu món đã xóa bởi nơi khác, thông báo “Món không còn trong thực đơn”; trở về danh sách, không cho Lưu tạo lại món ngầm.
Sau xóa thành công về Q05; sau hiện/ẩn refresh trạng thái; lỗi giữ nội dung và cho thử lại.

## 9. Q07 — Xem trước thực đơn
Mục đích xem đúng những gì khách sẽ thấy từ dữ liệu đã lưu, có nhãn Xem trước.
Cùng component món/nhóm như K01; loại món ẩn/đã xóa. Không thêm mode tự hiện món ẩn trong preview.
Nhãn ngoài vùng thực đơn: “Món đang ẩn không hiển thị trong bản xem trước.”
Không preview draft chưa lưu; nếu dirty thì lưu/bỏ hoặc quay lại editor.
Chủ quán có thể preview own quán khi public không khả dụng, kèm thông báo “Quán hiện chưa hiển thị cho khách”; không biến preview thành đường vòng API công khai.
Không có nút mua, giỏ hàng hoặc thanh toán.

## 10. K01/K02 — Khách xem quán và thực đơn
### 10.1 K01
Có tên quán, địa chỉ/vị trí lấy hàng theo public profile được phép, chip Đang mở cửa / Đã đóng cửa / Chưa cài giờ hoạt động, liên kết Xem giờ hoạt động.
Nhóm món là tiêu đề hoặc tabs theo độ dài thực đơn; ẩn nhóm không có món công khai.
Món: ảnh/placeholder, tên, giá. Không có nút +, Mua, Đặt ngay hoặc số lượng.
Thông tin liên hệ chỉ hiển thị khi public contract cho phép; không đưa mặc định SĐT đăng nhập, Zalo/Facebook riêng hoặc ID OWNER vào mockup.
Quán ngoài giờ vẫn xem được món, hiển thị đã đóng. Chưa lịch vẫn xem được với nhãn phù hợp nếu hồ sơ/khu vực hợp lệ.
Không có món hiện: “Quán chưa có món để hiển thị.”
Quán INCOMPLETE/DISABLED hoặc khu vực INACTIVE: màn “Quán hiện không khả dụng” + Quay lại/Thử lại tùy lỗi; không lộ lý do quản trị nội bộ.
Quán không tồn tại: “Không tìm thấy quán.”; không chuyển sang quán khác.
Lỗi mạng khác lỗi quán không khả dụng; giữ dữ liệu đã tải với nhãn chưa cập nhật.
Không thêm đánh giá sao, số đơn đã bán, phí ship/khoảng cách dự đoán vì M02 chưa có dữ liệu.

### 10.2 K02
Xem lịch theo T2–CN, nhiều khoảng, hôm sau, Cả ngày hoặc Đóng cửa; ghi Giờ Việt Nam.
Chỉ đọc; không dòng Cả tuần nhập nhanh, nút thêm khoảng hay Lưu.
Không có lịch: “Quán chưa cài giờ hoạt động.”
Đánh dấu hôm nay theo ngày được suy từ nguồn giờ máy chủ hiện hữu; không dùng đánh dấu ngày này để tự quyết ONLINE.
Quay lại K01 giữ vị trí cuộn thực đơn.

## 11. D01/D02 — Danh mục hệ thống, phần có điều kiện
Mục tiêu cung cấp nhóm món thật cho app, không mở thêm module quản trị lớn.
Nếu đã có catalog/provisioning/UI tương đương: dùng lại, chỉ bổ sung trạng thái liên quan, không thiết kế bản thứ hai.
Nếu chưa có UI: dựng frame bổ sung trong web Admin M01:
- Danh sách tên nhóm và Đang hoạt động / Ngừng hoạt động.
- Thêm: tên + trạng thái mặc định hoạt động; Sửa: tên/trạng thái.
- Ngừng hoạt động có xác nhận rõ “Nhóm sẽ không còn được chọn cho món mới. Các món đang liên kết được giữ nguyên.”
- Không xóa vật lý nhóm, không tự sửa các món liên kết.
Tên bắt buộc; uniqueness/giới hạn dùng contract catalog được đối chiếu trước implementation, không đoán từ dự án Ốc 11.
Phân quyền qua capabilities/contract Admin hiện hữu, không mặc định mọi ADMIN được sửa danh mục.
Không mở màn quản lý service areas, quyền admin, vùng xế hoặc nhà cung cấp storage từ brief này.
Thiết kế D01/D02 tách rõ phụ lục Có điều kiện, không chặn thiết kế toàn bộ Food.

## 12. Hành vi chung khi lưu, lỗi và rời màn
| Tình huống | UI và hành vi |
|---|---|
| Đang tải lần đầu | Skeleton; chưa dùng form rỗng để ghi đè server |
| Tải lỗi | Lỗi tải + Thử lại; không báo dữ liệu không tồn tại |
| Đang lưu | Nút Đang lưu…, khóa thao tác cùng payload, chống bấm lặp |
| Lưu thành công | Toast đúng hành động; đọc lại dữ liệu trạng thái |
| PUT thành công, GET lỗi | “Đã lưu, chưa tải lại được dữ liệu” + Tải lại |
| Validation | Lỗi cạnh trường; focus/scroll đến lỗi; giữ input |
| Mất mạng trước lưu | Giữ draft trong phiên màn, báo chưa lưu; không queue offline |
| Chưa xác định kết quả | “Chưa xác định được kết quả lưu. Thử lại để kiểm tra.”; retry cùng key/body, không gửi payload mới đồng thời |
| Conflict | “Dữ liệu đã được cập nhật ở nơi khác.”; giữ draft, Tải bản mới; xác nhận trước thay draft |
| Hết phiên | Theo luồng M01; không hiện dữ liệu riêng của tài khoản khác |
| Rời màn dirty | “Bỏ thay đổi chưa lưu?”; Tiếp tục sửa / Bỏ thay đổi |
| Quán mất quyền/vô hiệu khi thao tác | Ngừng ghi; thông báo phù hợp; chuyển sang chỉ đọc/luồng M01 |
| Upload lỗi | Giữ ảnh server cũ và các input; chọn ảnh khác/bỏ ảnh draft/thử lại |

Không lưu tự động draft chứa thông tin riêng xuống persistent storage nếu M01 chưa cho phép. Không hứa giữ draft qua đăng xuất/restart.
Draft chỉ được giữ trong phiên màn/tài khoản phù hợp; đổi tài khoản phải xóa khỏi UI.
Retry không làm hai món hoặc tăng version lần hai. Phiên thay thế không là lý do tự chạy thao tác cũ dưới user khác.
Profile và lịch chung version; món version riêng. Chi tiết header/API thuộc handoff implementation, không in lên UI.

## 13. Nội dung và nguyên tắc visual
Dùng UI M01 đã duyệt trong m01.zip và Brand Board nếu có cùng phiên Claude Design; đính kèm lại hai nguồn đó nếu phiên mới chưa có.
Không tự vẽ lại logo bằng chữ. Dùng asset chuẩn; thiếu asset để placeholder rõ để thay, không tạo logo mới.
Fallback token: vàng #D8AD18, chữ #2A2A2E, nền #F2F1EE, trắng #FFFFFF; Plus Jakarta Sans; radius card 16, control 12; spacing bội 4.
Không đưa vị trí quán sang 11Ship theo Brand Board cũ.
App điện thoại chính 390px, kiểm 360px; desktop 1280px chỉ cho web Admin. Font, nút, điều hướng khớp bộ M01 mới hơn token mô tả cũ nếu M01 đã được duyệt thay.
Header ngắn, một CTA chính; màu trạng thái kèm chữ; form cuộn, bàn phím không che Lưu; tap targets ≥44px.
Hủy trong editor là bỏ sửa/quay lại, không xóa quán/món. Xóa chỉ nằm ở hành động riêng có xác nhận.
Không ghi tên API, enum, version, khóa idempotency, mock/seed hoặc bước deploy vào UI người dùng.
Tên quán và món mẫu dùng “Ốc 11”; ví dụ Ốc hương hấp 120.000 đ, Ngao hấp 60.000 đ, Mực nướng 150.000 đ. Không giả đây là menu/giá thật của Owner.
Dữ liệu ảnh mẫu chỉ để trình bày; có frame không ảnh. Cho tên dài để chứng minh không vỡ layout.

## 14. Đầu ra Claude Design phải bàn giao
1. Bộ màn Q01–Q07, Q06-A/B, K01/K02; D01/D02 phụ lục có điều kiện.
2. Bộ component và variant dùng lại M01; các dialog/empty/loading/error/read-only/disabled cần thiết.
3. Prototype đi được các luồng mục 15. Nếu dùng HTML/design bundle, giữ đúng định dạng export mở được của M01; không giả đã nối API.
4. Bản mobile đầy đủ cho Food; desktop chỉ cho D01/D02 Admin nếu cần. Không yêu cầu bản web Food/Ship.
5. Screenshots từng màn/trạng thái quan trọng, file nguồn chỉnh được và một ZIP xuất toàn bộ nếu Claude Design hỗ trợ.
6. Bảng ID màn → file/frame → hành động → màn đích; bảng state coverage để Claude Code nối sau.
7. Báo cáo ngắn phần đã dựng, phần reused, điểm nghiệp vụ thực sự xung đột. Không tự thêm tính năng để lấp khoảng trống.
Tên gợi ý bundle: 11Ship-M02-UI-v1.zip. Có README mở/xem, index màn, đúng font/assets.
Không chỉ giao moodboard hoặc một ảnh dài không có bản màn chi tiết. Không coi một mockup dashboard là toàn module.

## 15. Luồng nghiệm thu thiết kế
| Luồng | Các bước cần bấm/xem được |
|---|---|
| F01 | Tài khoản M01 → Quản lý cửa hàng → Hồ sơ → sửa → lưu → trạng thái thành công |
| F02 | Chưa hồ sơ → reuse M01 hoàn tất → Q01; vô hiệu → chỉ đọc |
| F03 | Chưa lịch → Cả tuần 17–23 → áp dụng → sửa CN → lưu → đọc lại |
| F04 | Nhiều ca → qua đêm CN→T2 → lỗi trùng → sửa → lưu |
| F05 | 24h → đóng cả tuần → xác nhận; rời dirty → tiếp tục/bỏ |
| F06 | Thực đơn rỗng → thêm món không ảnh → lưu → danh sách |
| F07 | Thêm/thay/xóa ảnh draft → upload lỗi → ảnh cũ nguyên; lưu thành công |
| F08 | Sửa giá/nhóm → conflict → giữ draft → tải mới có xác nhận |
| F09 | Ẩn → preview không có món → hiện lại → preview có món |
| F10 | Xóa mềm có xác nhận → danh sách không có; không có undo giả |
| F11 | K01 quán ngoài giờ vẫn có menu → K02 xem lịch → quay lại |
| F12 | Không nhóm/khu vực không khả dụng/mạng lỗi/phiên hết hạn → đúng thông báo |
| F13 | Admin danh mục tối thiểu nếu cần → ngừng nhóm; owner thấy nhóm cũ giữ nguyên |

Prototype dùng dữ liệu mẫu để thể hiện trạng thái, không coi là backend/device nghiệm thu.
Claude Code sau này reuse evidence M02-A; test tác động phù hợp, review toàn module một lượt sau nối xong.

## 16. Các phần kỹ thuật còn mở — không cản dựng UI
Menu/catalog/storage cần đối chiếu code trước khóa tên endpoint/schema, giới hạn upload, URL ảnh và quyền catalog.
Không yêu cầu Claude Design chọn provider storage, viết migration, xác định SQL locks hoặc sửa auth.
Không hiển thị dữ liệu chưa có (giờ mở tiếp theo, khoảng cách/ship/review). Không cần chốt provider ảnh để dựng form ảnh.
Các chi tiết triển khai không thay luồng UI đã mô tả được Claude Code chọn trong phạm vi; thay nghiệp vụ quay lại ChatGPT/Owner.
M02 chưa được đóng chỉ vì bộ UI đã xuất xong.

## 17. Lệnh giao Claude Design — sao chép nguyên khối
Đính kèm file này cùng m01.zip và 11Ship Brand Board đã duyệt nếu phiên Claude Design chưa có.

> Thiết kế toàn bộ UI module M02 của dự án 11Ship theo file “11Ship-M02-chuc-nang-va-giao-Claude-Design.md” đính kèm.
>
> M02 là quản lý hoạt động quán và thực đơn trong app 11Food (khách + chủ quán), chỉ trên app điện thoại. Dùng lại phong cách, logo, font, component và shell M01 đã duyệt. App 11Ship dành cho xế không thêm chức năng M02. Tài liệu/Brand Board cũ có quán trong Ship hoặc công tắc nhận đơn phải nhường quyết định mới trong brief.
>
> Đọc brief một lần; bắt đầu dựng ngay bộ màn Q01–Q07, Q06-A/B, K01/K02, đủ dialog và trạng thái trong bảng. D01/D02 là phụ lục có điều kiện, dùng lại nếu đã có. Không hỏi lại nghiệp vụ đã chốt. Bạn tự quyết bố cục chi tiết phù hợp M01; báo riêng khi có xung đột thật.
>
> Quán tự mở/đóng theo lịch, không switch nhận đơn. Lịch phải có Cả tuần, từng ngày, nhiều ca, qua đêm CN→T2, 24 giờ, đóng tuần và lỗi trùng. Món có tên, giá, nhóm hệ thống, ảnh tùy chọn; hiện/ẩn/xóa mềm. Preview giống khách và không hiện món ẩn. Không thêm giỏ hàng, đặt đơn, gọi xế, doanh thu, đánh giá, topping hoặc tính năng ngoài brief.
>
> Mobile ưu tiên 390px, kiểm 360px; desktop 1280px chỉ cho Admin. Dựng prototype đi được các luồng F01–F13; giữ trạng thái dirty/saving/error/conflict và các quyền/empty cases. Prototype chỉ dùng dữ liệu mẫu, chưa nối backend; không viết mã sản phẩm, API hoặc migration.
>
> Bàn giao nguồn chỉnh được theo định dạng M01, ảnh từng màn/trạng thái quan trọng, index màn và state coverage, cùng ZIP xuất toàn bộ nếu hỗ trợ, đặt tên 11Ship-M02-UI-v1.zip. Hoàn thành toàn bộ phạm vi trước bàn giao; không dừng ở vài ảnh concept. Không đánh dấu UI_LOCKED: Owner sẽ duyệt bộ UI sau khi xem.


# Bộ Điều khoản sử dụng và Chính sách quyền riêng tư — DỰ THẢO v2 (CHỜ OWNER DUYỆT, CHƯA KÍCH HOẠT)

Trạng thái: **DỰ THẢO** do Claude soạn ngày 31/10/2026 cho M01-POLICY-01 (#251, PR #267). **Chưa được Owner duyệt, chưa được luật sư/chuyên gia pháp lý kiểm tra, chưa gắn vào ứng dụng nào.** Văn bản đang hiệu lực vẫn là `terms-20261014-v1` / `privacy-20261017-v1` ([M01-terms-privacy-20261014.md](M01-terms-privacy-20261014.md)); không có người dùng nào bị yêu cầu đồng ý lại cho đến khi Owner duyệt và kích hoạt (xem mục "Kích hoạt").

Phiên bản đề xuất khi kích hoạt: `terms-20261031-v2` và `privacy-20261031-v2`. Đổi bất kỳ chữ trọng yếu nào sau khi đã có người đồng ý ⇒ phải đặt phiên bản mới; không sửa văn bản dưới một phiên bản đã được đồng ý.

Quy ước đánh dấu: **[PHÁP LÝ]** = cần chuyên gia pháp lý Việt Nam kiểm tra (Bộ luật Dân sự, Luật Bảo vệ quyền lợi người tiêu dùng, Luật An toàn thông tin mạng, Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân, quy định về thương mại điện tử và thanh toán). **[OWNER]** = nội dung do Owner quyết định, văn bản chỉ để chỗ trống, không tự đặt số liệu.

Nguyên tắc soạn: chỉ mô tả điều **ứng dụng thực sự làm** tại SHA này (đã đối chiếu với mã nguồn/di trú dữ liệu) hoặc điều Owner đã chốt. Không hứa cổng thanh toán, tự động quyết toán, hoàn tiền tự động hay tính năng chưa có. Không dùng câu "X chưa hoạt động" (dễ lỗi thời): thay bằng mô tả quyền theo điều kiện ("chỉ khi…"). Khi tính năng, quyền hoặc luồng dữ liệu thay đổi trọng yếu thì văn bản phải được soát và đổi phiên bản.

---

## PHẦN A — ĐIỀU KHOẢN SỬ DỤNG (11Food Khách hàng, 11Food Quán, 11Ship Shipper, Web quản trị)

### 1. Phạm vi và bên cung cấp
1.1. Điều khoản này áp dụng cho việc dùng ứng dụng 11Food (khách đặt món, chủ quán), ứng dụng 11Ship (shipper) và trang quản trị 11Ship. **[OWNER]** Tên pháp nhân/đơn vị vận hành, địa chỉ, kênh liên hệ chính thức. **[PHÁP LÝ]**
1.2. 11Ship là nền tảng kết nối khách, quán và shipper. Quán chịu trách nhiệm về món, giá và chất lượng món; shipper chịu trách nhiệm thực hiện việc giao nhận mình đã nhận. **[PHÁP LÝ]** (phân định trách nhiệm giữa nền tảng và bên bán/bên giao).

### 2. Tài khoản và mã OTP
2.1. Tài khoản gắn với một số điện thoại. Khi vận hành bình thường, bạn xác minh số điện thoại bằng mã OTP gửi qua tin nhắn SMS khi đăng ký và khi đặt lại mật khẩu; mã có hạn dùng, giới hạn số lần nhập sai và số lần yêu cầu.
2.2. Trong một số trường hợp vận hành (ví dụ lập tài khoản thử), quản trị hệ thống có thể tạm không yêu cầu OTP khi đăng ký. Tài khoản tạo như vậy được ghi nhận là **chưa xác minh số điện thoại** và giữ nguyên trạng thái đó cho đến khi có xác minh thật; việc bật lại OTP không tự biến nó thành đã xác minh. Một số chức năng có thể yêu cầu số điện thoại đã xác minh. **[OWNER]** danh sách chức năng yêu cầu số điện thoại đã xác minh (hiện chưa có quy tắc riêng được chốt).
2.3. Bạn cung cấp thông tin đúng sự thật, tự giữ bí mật mật khẩu, không cho người khác dùng tài khoản và báo ngay khi nghi bị lộ. Hoạt động thực hiện bằng tài khoản của bạn được coi là của bạn, trừ khi bạn chứng minh bị chiếm quyền trái ý muốn. **[PHÁP LÝ]**
2.4. Một số điện thoại có thể có nhiều vai trò (khách, chủ quán, shipper) trong cùng một tài khoản. Vai trò chủ quán hoặc shipper chỉ được dùng sau khi hồ sơ tương ứng đáp ứng điều kiện của 11Ship (ví dụ được duyệt). Việc tạo tài khoản hay gửi hồ sơ không tự mở quyền bán hàng hoặc nhận đơn.

### 3. Đơn món và giao hàng
3.1. Khách đặt món từ quán đang nhận đơn; quán xác nhận, từ chối hoặc huỷ theo quy trình trong ứng dụng, kèm lý do khi cần. Giá món, phí giao hàng (nếu đã xác định) và tổng tiền hiển thị trước khi gửi đơn; phí chưa xác định được thể hiện là "chưa xác định", không phải 0 đồng.
3.2. Quán có thể yêu cầu giao hàng cho đơn của mình hoặc tạo yêu cầu giao trực tiếp; khách cũng có thể tạo yêu cầu giao hộ theo luồng dành cho khách. Shipper chọn nhận hoặc không nhận yêu cầu; khi đã nhận, shipper thực hiện các bước xác nhận điểm giao, lấy hàng, giao hàng hoặc báo không giao được theo ứng dụng.
3.3. Mức phí giao hàng theo chính sách phí đang áp dụng hoặc theo thỏa thuận phí được ghi nhận trong ứng dụng; chỉ phần đã được xác nhận trong ứng dụng mới có giá trị làm căn cứ. **[OWNER]** nếu muốn nêu công thức/ngưỡng phí trong điều khoản (hiện để ở chính sách phí, không nhắc số cụ thể).
3.4. Thu hộ (COD): khi yêu cầu giao có khoản thu hộ, shipper thu theo số tiền ghi trong yêu cầu; việc đối soát khoản thu hộ giữa shipper, quán/khách và 11Ship thực hiện theo quy trình đối soát của 11Ship. **[PHÁP LÝ]** **[OWNER]** quy tắc bồi hoàn, thất thoát, chậm đối soát (chưa có nội dung được chốt, không tự đặt).
3.5. Đơn hoặc yêu cầu giao có thể bị đóng khi quá thời hạn xử lý theo cấu hình của hệ thống (ví dụ quán không phản hồi, không tìm được shipper). **[OWNER]** thời hạn hiển thị cho người dùng.

### 4. Ví Shipper, nạp tiền và rút tiền
4.1. Shipper có ví trong 11Ship ghi nhận số dư và lịch sử giao dịch. Hoa hồng/phí nhận đơn có thể được giữ tạm (hold) khi nhận đơn và được tính hoặc nhả khi đơn kết thúc theo quy tắc đã ghi nhận tại thời điểm nhận đơn.
4.2. Nạp ví: shipper gửi yêu cầu nạp và chuyển khoản tới tài khoản nhận tiền do 11Ship công bố trong ứng dụng; số tiền chỉ được ghi vào ví sau khi quản trị viên đối chiếu và xác nhận khoản chuyển. Không có cổng thanh toán tự động.
4.3. Rút tiền: shipper gửi yêu cầu rút về tài khoản ngân hàng đã được xác minh là của chính mình; quản trị viên xử lý chuyển khoản thủ công và ghi nhận kết quả. Thời gian xử lý, hạn mức tối thiểu/tối đa và phí (nếu có) theo cấu hình đang áp dụng được hiển thị trong ứng dụng. **[OWNER]** cam kết thời gian xử lý (chưa có cam kết được chốt).
4.4. Khi đóng hồ sơ shipper, số dư còn lại được xử lý theo quy trình tất toán của 11Ship; hồ sơ chỉ đóng khi không còn đơn đang xử lý và ví đã tất toán.
4.5. Điều chỉnh tài chính do khiếu nại hoặc sai sót được ghi bằng bút toán điều chỉnh có lý do và người thực hiện; không xoá lịch sử giao dịch. **[PHÁP LÝ]**

### 5. Vị trí, chia sẻ liên kết theo dõi, tin nhắn và thông báo
5.1. Shipper cung cấp vị trí khi đang bật nhận đơn/đang thực hiện giao hàng để hệ thống ghép đơn và theo dõi tiến trình; tắt nhận đơn dừng việc này. Khách có thể chia sẻ liên kết theo dõi một đơn giao; người nhận liên kết xem được thông tin tiến trình của đơn đó và (nếu khách bật) vị trí shipper, cho đến khi khách thu hồi liên kết hoặc đơn kết thúc.
5.2. Khách, quán và shipper của cùng một đơn có thể nhắn tin trong khung trò chuyện của đơn. Nội dung được lưu để phục vụ khiếu nại và vận hành trong thời hạn lưu trữ nêu ở Chính sách quyền riêng tư; không dùng khung này để quấy rối, lừa đảo hoặc trao đổi nội dung trái pháp luật.
5.3. 11Ship gửi thông báo trong ứng dụng và thông báo đẩy về đơn, tài khoản và nhắc việc. Bạn có thể tắt thông báo đẩy trong thiết bị; thông báo trong ứng dụng vẫn phục vụ vận hành.

### 6. Đánh giá và khiếu nại
6.1. Khách có thể đánh giá quán và shipper; quán có thể đánh giá shipper, theo điều kiện của từng đơn. Nội dung đánh giá phải trung thực, không xúc phạm; 11Ship có thể ẩn đánh giá vi phạm.
6.2. Khách, quán, shipper có thể gửi khiếu nại về đơn/giao hàng/đánh giá. 11Ship tiếp nhận, yêu cầu bổ sung thông tin, kết luận và có thể điều chỉnh kết quả giao hàng hoặc khoản hoa hồng; bên liên quan có thể yêu cầu xem xét lại theo luồng trong ứng dụng. **[PHÁP LÝ]** **[OWNER]** thời hạn xử lý khiếu nại cam kết với người dùng (chưa có số liệu được chốt).

### 7. Hành vi bị cấm và biện pháp của 11Ship
7.1. Bị cấm: gian lận, lập nhiều tài khoản để lách quy tắc, thao túng đơn/đánh giá/ví, dùng thông tin của người khác, can thiệp hệ thống, khai thác dữ liệu người khác, vi phạm pháp luật.
7.2. 11Ship có thể khoá tài khoản khi có vi phạm hoặc rủi ro bảo mật; lý do khoá được ghi nhận và người bị khoá có thể liên hệ để được xem xét. Tài khoản đang còn đơn, chuyến giao hoặc khoản tiền đang xử lý không bị xoá. **[PHÁP LÝ]**

### 8. Khoá, xoá tài khoản và lưu trữ
8.1. Bạn có thể yêu cầu xoá tài khoản. Tài khoản chưa phát sinh dữ liệu nghiệp vụ được xoá hẳn. Tài khoản đã có đơn, giao hàng, ví/giao dịch, đánh giá, khiếu nại hoặc hồ sơ quán/shipper **không bị xoá dữ liệu**: tài khoản bị khoá, bạn không đăng nhập được nữa, còn bản ghi nghiệp vụ được giữ lại để bảo đảm chứng từ, đối soát và quyền lợi các bên. Việc khoá/xoá bị hoãn nếu còn đơn, chuyến giao hoặc khoản tiền đang xử lý. **[PHÁP LÝ]** (quyền xoá dữ liệu cá nhân theo Nghị định 13 và nghĩa vụ lưu giữ chứng từ).
8.2. Tài khoản bị khoá theo yêu cầu xoá có thể được khôi phục khi chính chủ xác minh lại bằng OTP theo quy trình khôi phục; tài khoản bị khoá do vi phạm hoặc bảo mật thì không tự khôi phục.

### 9. Trách nhiệm và giới hạn
9.1. 11Ship nỗ lực vận hành ổn định nhưng không bảo đảm dịch vụ không gián đoạn; bảo trì được thông báo khi có thể. **[PHÁP LÝ]** giới hạn trách nhiệm, bồi thường.
9.2. **[OWNER]** Chính sách bồi thường hư hỏng/thất lạc hàng, hoàn tiền cho khách (chưa có quy tắc được chốt; không tự đặt).

### 10. Thay đổi điều khoản và luật áp dụng
10.1. Khi điều khoản thay đổi trọng yếu, 11Ship công bố phiên bản mới và có thể yêu cầu bạn đồng ý lại trước khi tiếp tục dùng; thời điểm và phiên bản bạn đồng ý được ghi lại. Bạn luôn xem lại được văn bản trong ứng dụng.
10.2. Pháp luật Việt Nam áp dụng; tranh chấp ưu tiên thương lượng, sau đó giải quyết tại cơ quan có thẩm quyền tại Việt Nam. **[PHÁP LÝ]** **[OWNER]** nơi giải quyết tranh chấp.

---

## PHẦN B — CHÍNH SÁCH QUYỀN RIÊNG TƯ

### 1. Bên xử lý dữ liệu
**[OWNER]** Tên pháp nhân, địa chỉ, liên hệ về dữ liệu cá nhân. **[PHÁP LÝ]** Vai trò "bên kiểm soát/bên xử lý dữ liệu" theo Nghị định 13/2023.

### 2. Dữ liệu 11Ship thu thập và mục đích
| Nhóm dữ liệu | Gồm | Mục đích |
|---|---|---|
| Tài khoản | số điện thoại, mật khẩu (lưu dạng băm một chiều), trạng thái xác minh số điện thoại, vai trò, phiên đăng nhập, thông tin xác thực thiết bị Android | tạo và bảo vệ tài khoản |
| Hồ sơ | họ tên; với quán: tên, địa chỉ, toạ độ, giờ mở cửa, thực đơn, logo; với shipper: họ tên, biển số xe, tài khoản ngân hàng (chủ tài khoản, ngân hàng, số tài khoản) | cung cấp dịch vụ, duyệt hồ sơ, xác minh người nhận tiền |
| Đơn và giao hàng | món, ghi chú, địa chỉ giao, tên và số điện thoại người nhận, tiền hàng, phí, khoản thu hộ, trạng thái, thời điểm | thực hiện đơn, đối soát, hỗ trợ |
| Ví và tài chính | số dư, giữ tạm, lịch sử giao dịch, yêu cầu nạp/rút, đối soát chuyển khoản | quản lý ví, đối soát, chống gian lận |
| Vị trí | vị trí shipper khi bật nhận đơn/đang giao; toạ độ điểm lấy và điểm giao; vị trí một lần khi chủ quán ghi vị trí quán | ghép đơn, theo dõi giao hàng, tính phí theo quãng đường |
| Tin nhắn | nội dung trò chuyện trong đơn | liên lạc trong đơn, giải quyết khiếu nại |
| Phản hồi | đánh giá, khiếu nại, tệp đính kèm khiếu nại | chất lượng dịch vụ, giải quyết khiếu nại |
| Thông báo | mã thông báo đẩy của thiết bị, cấu hình thông báo, lịch sử thông báo | gửi thông báo |
| Đồng ý | phiên bản điều khoản/chính sách bạn đã đồng ý, thời điểm, ứng dụng | chứng minh sự đồng ý, đối chiếu phiên bản |
| Nhật ký hệ thống | nhật ký thao tác quản trị và bảo mật (người thực hiện, lý do, thời điểm) | an ninh, kiểm toán |

Ứng dụng **không theo dõi vị trí khi không ở trạng thái cần thiết nêu trên** và không bán dữ liệu cá nhân. **[PHÁP LÝ]** căn cứ pháp lý xử lý từng nhóm, phân loại dữ liệu nhạy cảm (vị trí, tài khoản ngân hàng).

### 3. Chia sẻ dữ liệu
3.1. Trong cùng một đơn: quán thấy tên, số điện thoại và địa chỉ nhận cần để chuẩn bị/giao; shipper thấy thông tin cần để lấy và giao hàng; khách thấy thông tin quán và, khi đơn đang giao, tên/biển số shipper. Thông tin ngân hàng của shipper không được công khai cho khách, quán hoặc shipper khác.
3.2. Người được khách chia sẻ liên kết theo dõi xem được tiến trình (và vị trí shipper nếu khách bật) của đúng đơn đó.
3.3. Quản trị viên của 11Ship xem dữ liệu theo phạm vi quyền được cấp để vận hành, hỗ trợ và giải quyết khiếu nại.
3.4. Dịch vụ bên thứ ba: tin nhắn SMS OTP gửi qua thiết bị/cổng SMS của 11Ship; dịch vụ thông báo đẩy của nền tảng thiết bị; dịch vụ bản đồ/tính quãng đường. **[OWNER]** tên nhà cung cấp và nơi lưu trữ dữ liệu. **[PHÁP LÝ]** chuyển dữ liệu ra nước ngoài (nếu có).
3.5. Cung cấp dữ liệu cho cơ quan nhà nước khi có yêu cầu hợp pháp. **[PHÁP LÝ]**

### 4. Lưu trữ và xoá
4.1. Dữ liệu tài khoản và nghiệp vụ được giữ trong thời gian tài khoản còn hiệu lực và theo nghĩa vụ lưu giữ chứng từ/đối soát. **[OWNER]** thời hạn lưu từng nhóm dữ liệu (chưa có số liệu được chốt). Tin nhắn trong đơn được giữ theo số ngày lưu trữ cấu hình của hệ thống, kể từ khi đơn kết thúc hoặc kể từ khi dừng giữ bằng chứng khi đang có khiếu nại. **[OWNER]** số ngày hiển thị cho người dùng.
4.2. Xoá tài khoản: xem Điều khoản mục 8. Tài khoản đã có dữ liệu nghiệp vụ được khoá và giữ bản ghi; tài khoản không có dữ liệu được xoá hẳn cùng phiên, thiết bị, hồ sơ và bản ghi đồng ý; nhật ký quản trị được giữ lại.

### 5. Quyền của bạn
Bạn có thể xem, yêu cầu chỉnh sửa thông tin cá nhân của mình trong ứng dụng, xem lại điều khoản/chính sách bất cứ lúc nào, rút lại sự đồng ý (đồng nghĩa dừng dùng dịch vụ) và yêu cầu xoá theo mục 4. **[OWNER]** kênh và thời hạn trả lời yêu cầu xuất/xoá dữ liệu. **[PHÁP LÝ]** các quyền theo Nghị định 13/2023.

### 6. Bảo mật
Mật khẩu lưu dạng băm một chiều; phiên và thiết bị được ràng buộc; thao tác quản trị cần xác thực hai lớp và được ghi nhật ký; OTP giới hạn số lần và thời hạn. Không hệ thống nào an toàn tuyệt đối; hãy bảo vệ mật khẩu và thiết bị. 11Ship thông báo sự cố theo quy định. **[PHÁP LÝ]**

### 7. Trẻ em
Dịch vụ không dành cho người chưa đủ tuổi theo quy định. **[OWNER]** **[PHÁP LÝ]** độ tuổi tối thiểu.

### 8. Thay đổi và đồng ý
Khi chính sách thay đổi trọng yếu, 11Ship công bố phiên bản mới; có thể yêu cầu bạn đồng ý lại. Mỗi lần đồng ý được ghi lại với phiên bản và thời điểm (xem được trong hồ sơ và bởi quản trị viên có quyền).

---

## Đối chiếu với tính năng thực tế (để người duyệt kiểm)
| Điều nêu trong văn bản | Có trong mã/di trú tại nhánh này |
|---|---|
| OTP SMS qua Gateway, giới hạn 60s/3 lần sai, tắt OTP đăng ký ⇒ `PHONE_UNVERIFIED` | `auth/*`, `system-settings/*`, `client-auth/*`, test case 3/4b |
| Khóa/xóa chỉ khóa khi có dữ liệu, chặn khi còn việc | `account-lifecycle/*`, `admin-account-lock/*` (Nhóm 13) |
| Đơn M10, giao M07, thu hộ (COD), liên kết theo dõi | migration `create-m10-orders`, `create-m07-delivery`, `customer-courier-cod` |
| Ví, hold hoa hồng, nạp thủ công, rút thủ công | migration `driver-wallet-core`, `wallet-holds`, `wallet-topup-sources`, `wallet-withdrawals` |
| Chat đơn, lưu giữ bằng chứng | migration `create-order-chat` |
| Đánh giá, khiếu nại, điều chỉnh | migration `create-m11-reviews-complaints` |
| Thông báo và push token | migration `create-m08-notifications` |
| Lịch sử đồng ý theo phiên bản | bảng `user_consents` (bất biến), chi tiết tài khoản trong Web quản trị |

## Kích hoạt (BLOCKED chờ Owner)
Chỉ thực hiện sau khi Owner duyệt văn bản chính thức (và xử lý các mục **[OWNER]/[PHÁP LÝ]** trên):
1. Thay `kTermsText`/`kPrivacyText`/nhãn đồng ý trong `mobile/packages/n11_shared/lib/src/account/account_views.dart` (Flutter) và `kConsentTermsVersion`/`kConsentPrivacyVersion` trong `session_controller.dart`; cập nhật văn bản web nếu có (`apps/client-shared/src/consent.ts` chỉ là bản thử).
2. Đặt `CLIENT_AUTH_TERMS_VERSION`/`CLIENT_AUTH_PRIVACY_VERSION` mới trên VPS (`ops/vinahost/production.env.example`) **cùng lúc** với bản app mới (máy chủ chỉ nhận đúng một cặp; app cũ sẽ bị từ chối đăng ký mới — cần lên kế hoạch phát hành APK).
3. Quyết định có bắt người dùng hiện có đồng ý lại hay không (cơ chế chặn truy cập chưa được kích hoạt; hiện chỉ có đối chiếu và tra cứu). Không tự bắt đồng ý lại nếu Owner chưa quyết.
4. Cập nhật `docs/current/M01-terms-privacy-20261014.md` thành bản chính thức, ghi người duyệt và ngày.

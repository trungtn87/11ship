# 11 Brand Guideline v1.0

> **Status:** LOCKED baseline  
> **Ngày khóa:** 2026-10-08  
> **Phạm vi:** thương hiệu mẹ **11**, hai sản phẩm công khai **11Food** và **11Ship**.  
> **Mục đích:** source of truth cho thiết kế, Figma, frontend, marketing và mọi nội dung hình ảnh của hệ 11.

## 0. Quy tắc ưu tiên

Khi thiết kế hoặc code UI cho hệ 11, tài liệu này là chuẩn tham chiếu cho **nhận diện thương hiệu và UI visual language**. Các ADR/spec nghiệp vụ khác vẫn là nguồn chuẩn cho domain, API, security và state machine.

Không tự ý đổi logo, màu, font, slogan, icon style hoặc app identity nếu chưa có quyết định Owner mới.

---

## 1. Brand Core

### 1.1 Kiến trúc thương hiệu

- **11** — thương hiệu mẹ.
- **11Food** — app khách hàng tìm quán, xem món và đặt đồ ăn.
- **11Ship** — app giao hàng dùng chung cho **Shop/Cửa hàng** và **Shipper**.
  - Một tài khoản có thể có cả SHOP và DRIVER.
  - Sau đăng nhập, nếu có nhiều vai trò thì chọn vai trò sử dụng.
  - 11Ship không bị giới hạn về lâu dài vào giao đồ ăn.
- **Admin** — web/app nội bộ; xây dựng sau, không phải thương hiệu công khai chính ở giai đoạn hiện tại.

### 1.2 Cách viết

Tên chuẩn:

- `11`
- `11Food`
- `11Ship`

Viết liền, số 11 đứng trước, chữ cái đầu của phần tên viết hoa. Không dùng `11 food`, `11ship`, `11 Ship` trong nội dung thương hiệu chính thức.

### 1.3 Ý nghĩa tên

**11** là dấu hiệu gắn với Cao Bằng và được dùng như tài sản nhận diện cốt lõi. 11 không bị giới hạn vào một ngành, nên có thể mở rộng theo mô hình `11 + tên dịch vụ`.

### 1.4 Brand Essence và tagline — LOCKED

- **11 — Cần là có**
- **11Food — Thèm là có**
- **11Ship — Gọi là có**

Brand Essence của hệ là **CẦN LÀ CÓ**: ngắn, đời thường, dễ nhớ và phù hợp hướng sản phẩm nhanh gọn.

### 1.5 Tính cách thương hiệu

- Đơn giản
- Nhanh gọn
- Gần gũi
- Đáng tin
- Thực tế

Giọng điệu: ngắn, rõ, tự nhiên, tránh văn phong doanh nghiệp nặng nề.

---

## 2. Logo System

### 2.1 Logo mẹ

Logo chính gồm:

- biểu tượng số **11**;
- swoosh/vòng cung màu vàng.

**Không có số 11 lặp lại ở dưới logo.**

Hai cách dùng:

1. Logo mark `11 + swoosh`.
2. Logo mark + tagline **Cần là có**.

Tagline không phải thành phần bắt buộc khi logo hiển thị nhỏ.

### 2.2 Logo nhánh

- **11Food**: logo 11 + chữ `Food`; tagline tùy ngữ cảnh: **Thèm là có**.
- **11Ship**: logo 11 + chữ `Ship`; tagline tùy ngữ cảnh: **Gọi là có**.

Không thêm dao nĩa, xe máy, hộp hàng hoặc icon minh họa vào logo chính/logo nhánh.

### 2.3 App icon

Hai app phải phân biệt rõ khi cùng cài trên một điện thoại:

- **11Food app icon** dùng đúng logo nhánh `11Food`.
- **11Ship app icon** dùng đúng logo nhánh `11Ship`.
- Logo mẹ `11` có thể dùng cho avatar/hệ sinh thái, không dùng thay hai app icon nếu gây nhầm.

### 2.4 Phiên bản màu

**Primary**

- số/chữ: xám than;
- swoosh: vàng ấm;
- nền: trắng hoặc xám sáng.

**Reverse**

- số/chữ: trắng;
- swoosh: vàng ấm;
- nền: xám than.

**Monochrome**

- toàn xám than/đen;
- hoặc toàn trắng.

### 2.5 Khoảng trống và kích thước

Dùng bề rộng một nét chính của số `1` làm đơn vị `X`.

- Clear space tối thiểu: **1X** quanh logo.
- Logo `11` digital: tối thiểu khoảng **24 px**.
- Logo `11Food/11Ship`: tối thiểu khoảng **72 px chiều ngang**.
- In ấn: logo 11 tối thiểu khoảng **10 mm**; logo nhánh khoảng **25 mm chiều ngang**.
- Khi nhỏ: bỏ tagline trước, không thu nhỏ tagline đến mức khó đọc.

### 2.6 Không được phép

Không kéo méo, xoay, thay swoosh, đổi font trong logo, đổi màu vàng tùy ý, thêm hiệu ứng 3D/gradient ngẫu nhiên, thêm icon ngành nghề hoặc tạo biến thể chiến dịch không được duyệt.

---

## 3. Color System

### 3.1 Brand colors — LOCKED

| Vai trò | Màu | HEX |
|---|---|---|
| Primary | Vàng ấm | `#D8AD18` |
| Primary dark | Xám than | `#2A2A2E` |
| Base | Trắng | `#FFFFFF` |
| Surface | Xám sáng | `#F2F1EE` |

Nguyên tắc: **vàng là màu nhận diện, không phải màu để tô toàn bộ giao diện**. Phần lớn UI dùng trắng/xám sáng, xám than cho cấu trúc và vàng cho điểm nhấn/CTA.

### 3.2 Functional colors

Các màu trạng thái chỉ phục vụ UI, không thay thế brand colors:

| Ý nghĩa | HEX |
|---|---|
| Success / Hoàn thành | `#2E7D32` |
| Warning | `#B7791F` |
| Error / Hủy | `#C62828` |
| Info | `#2563EB` |
| Đang giao / đang hoạt động | `#0F766E` |

---

## 4. Typography

### 4.1 Font chính — LOCKED

**Plus Jakarta Sans** dùng cho app, web, marketing và tài liệu thương hiệu.

Chữ nằm trong logo là tài sản của Logo System và không được thay bằng font UI.

### 4.2 Weight

- ExtraBold/Bold: headline, hero, số tiền lớn.
- SemiBold: tiêu đề màn hình, nút chính, trạng thái quan trọng.
- Medium: tab, menu, label.
- Regular: body, địa chỉ, mô tả.

### 4.3 Size tham chiếu cho app

- Display/Hero: 32–40 px
- H1: 24–28 px
- H2: 20–22 px
- H3: 16–18 px
- Body: 14–16 px
- Caption: 12–13 px

Không dùng chữ nội dung chính dưới 12 px.

---

## 5. Icon & Graphic Language

### 5.1 Icon

- Grid chuẩn: **24 × 24 px**
- Stroke: **2 px**
- Đầu nét/góc: bo tròn
- Default: xám than
- Active/highlight: vàng
- Không trộn icon outline, 3D và nhiều bộ icon khác phong cách trong cùng sản phẩm.

### 5.2 Hình học

Ngôn ngữ đồ họa lấy cảm hứng từ swoosh của logo:

- đường cong chuyển động;
- arc/vòng cung;
- tuyến giao hàng;
- mảng vàng có chuyển động nhẹ.

Không dùng shadow nặng hoặc trang trí quá phức tạp.

### 5.3 Map marker 11Ship

- Shop/điểm lấy: vàng + icon cửa hàng xám than.
- Shipper: marker xám than + chi tiết vàng.
- Khách/điểm giao: trắng/xám than.
- Điểm đang thao tác: highlight vàng rõ.

Phải phân biệt được Shop — Shipper — Khách chỉ bằng hình dạng/màu marker.

### 5.4 Photography

**11Food**: ưu tiên ảnh món thật, màu thực phẩm tự nhiên, không phủ filter vàng nặng.

**11Ship**: ảnh đời thực, sạch, rõ đồng phục vàng, thân thiện và đáng tin; tránh cảm giác stock/corporate quá mức.

---

## 6. App Identity

### 6.1 11Food

- Khách hàng đặt đồ ăn.
- Visual: sáng, nhiều khoảng trắng, ảnh món là trọng tâm.
- Tagline: **Thèm là có**.
- Vàng dùng cho CTA, active state và highlight.

### 6.2 11Ship

- Shop/Cửa hàng + Shipper trong một app.
- Visual: rõ, chắc, thiên vận hành; xám than có thể dùng nhiều hơn 11Food.
- Tagline: **Gọi là có**.
- Nếu user có SHOP + DRIVER: chọn vai trò sau đăng nhập; app vẫn là 11Ship, không đổi thương hiệu.

### 6.3 Shared DNA

11Food và 11Ship dùng chung:

- brand colors;
- Plus Jakarta Sans;
- icon style;
- spacing;
- radius;
- button/card system;
- motion language;
- swoosh/graphic language.

---

## 7. UI Brand System

### 7.1 Foundation

| Thành phần | Chuẩn |
|---|---|
| Spacing grid | bội số 4 px |
| Card radius | 16 px |
| Button radius | 12 px |
| Input radius | 12 px |
| Icon | 24×24, stroke 2 px |
| Touch target | tối thiểu 44×44 px |

### 7.2 Button

- Primary CTA: nền vàng, chữ xám than.
- Secondary: nền trắng, viền nhẹ, chữ than.
- Dark CTA: nền than, chữ trắng.
- Destructive: đỏ, chỉ dùng cho hủy/xóa/từ chối.

Mỗi màn hình ưu tiên một hành động chính nổi bật nhất.

### 7.3 Card và surface

Card trắng trên nền xám sáng; ưu tiên viền nhẹ/chênh nền hơn shadow nặng.

- 11Food card: ảnh món, tên, giá, CTA.
- 11Ship card: trạng thái, điểm lấy → điểm giao, phí, hành động tiếp theo.

### 7.4 Navigation

Bottom navigation tối đa 4–5 mục.

Gợi ý:

- 11Food: Trang chủ · Tìm kiếm · Đơn hàng · Tài khoản
- 11Ship/Shop: Tổng quan · Đơn hàng · Gọi shipper · Tài khoản
- 11Ship/Shipper: Trang chủ · Đơn hàng · Thu nhập · Tài khoản

### 7.5 Loading, toast, empty state

- Ưu tiên skeleton thay spinner toàn màn hình.
- Action quan trọng phải có processing state để tránh bấm lặp.
- Toast ngắn, nói đúng kết quả.
- Empty state: 1 icon/minh họa + 1 câu ngắn + CTA khi thật sự cần.

---

## 8. Physical Branding

**Trạng thái:** concept phục vụ quảng bá hình ảnh; chưa phải thông số sản xuất thực tế.

Hướng chung 11Ship:

- áo/mũ/túi: vàng nhận diện + xám than + phản quang khi cần;
- ngực: logo nhỏ;
- lưng/túi: logo 11Ship lớn;
- tagline **Gọi là có** chỉ dùng nơi đủ diện tích;
- không biến đồng phục thành biển quảng cáo quá nhiều chữ.

11Food chủ yếu dùng nhận diện vật lý tại quán/điểm bán: sticker, QR, bảng `Có trên 11Food`, tent card, bao bì/tem khi cần.

---

## 9. Marketing Identity

### 9.1 Facebook page — LOCKED

**Tên page:** `11 | Food & Ship`

Bio gợi ý:

- **11Food — Thèm là có**
- **11Ship — Gọi là có**
- Đặt món & giao hàng tại Cao Bằng.

### 9.2 Avatar

Dùng **logo mẹ 11** đơn giản, không nhồi thêm chữ nhỏ.

### 9.3 Cover/banner

Cover chung phải giới thiệu rõ **hai app**:

- 11Food — app khách hàng đặt đồ ăn;
- 11Ship — app Shop/Cửa hàng và Shipper.

Không để Food hoặc Ship lấn át hoàn toàn nhánh còn lại.

### 9.4 Nhân vật đại diện 11Ship

Owner đã duyệt một **nhân vật nam cụ thể** làm visual representative của 11Ship. Khi tạo hình marketing mới phải giữ đúng khuôn mặt/diện mạo của nhân vật đã duyệt; không tự thay người khác.

> **Asset note:** ảnh nguồn của nhân vật đại diện hiện được duyệt từ phiên thiết kế, nhưng chưa được lưu thành asset chuẩn trong repository. Trước khi sản xuất chính thức cần đưa file reference đã duyệt vào thư mục asset của dự án; trong thời gian chưa có asset repo, không được tự chọn một gương mặt thay thế.

### 9.5 Nhóm template marketing

Chuẩn hóa các nhóm:

1. 11Food / món ăn
2. 11Ship / giao hàng
3. Tuyển shipper
4. Tuyển quán/đối tác
5. Ưu đãi
6. Thông báo
7. Nội dung local/Cao Bằng

### 9.6 Tone of voice

Ưu tiên câu ngắn, đời thường:

- `Thèm là có`
- `Gọi là có`
- `Có hàng cần giao?`
- `Mở 11Ship.`
- `Trưa nay ăn gì?`
- `Mở 11Food.`

Tránh ngôn ngữ kiểu “giải pháp logistics toàn diện”, “hệ sinh thái F&B tối ưu hóa” trong truyền thông khách hàng phổ thông.

---

## 10. Quy tắc triển khai cho Figma / frontend / AI

1. Mọi màn hình mới phải dùng token từ Color System và Typography System này.
2. Không sinh logo mới bằng AI cho từng ảnh; dùng logo asset chuẩn.
3. 11Food và 11Ship phải khác đủ để không nhầm app icon, nhưng cùng DNA 11.
4. Thiết kế Figma phải tạo component/tokens trước khi nhân rộng màn hình.
5. Frontend không hard-code màu tùy ý; map vào design tokens.
6. Functional color không được dùng để thay brand color.
7. Nếu một mockup marketing mâu thuẫn tài liệu này, tài liệu này thắng.

---

## 11. Nội dung cũ bị thay thế

Các câu/hướng sau **không còn là chuẩn chính thức** và không được dùng làm tagline mới:

- `Gần hơn mỗi ngày`
- `Ngon gần bạn`
- `Giao nhanh · Gần hơn`
- `Gọi là có shipper`
- Brand Essence `GẦN`

Chuẩn hiện tại:

- **11 — Cần là có**
- **11Food — Thèm là có**
- **11Ship — Gọi là có**

---

## 12. Việc còn mở

Brand Guideline v1.0 đã đủ làm baseline triển khai. Các hạng mục sau sẽ được bổ sung khi vào sản xuất:

- asset logo SVG/PNG chính thức;
- file ảnh chuẩn của nhân vật đại diện 11Ship;
- Figma variables/tokens/components;
- production specs cho đồng phục, mũ, túi, decal;
- accessibility audit chi tiết theo từng màn hình;
- bộ template marketing editable.

Mọi thay đổi các phần LOCKED phải có quyết định Owner và cập nhật version tài liệu.

# 11Ship — UI Foundation v1.0

Status: **FOUNDATION_LOCKED**  
Owner lock date: 2026-10-08  
Applies to: Customer app, Shop app, Driver app, Management/Admin UI and shared web UI.

## 1. Nguyên tắc

UI Foundation là lớp cơ bản được khóa **trước khi thiết kế từng màn hình**. Mọi wireframe/screen mới phải dùng foundation này ngay từ frame đầu tiên.

Không được tự tạo màu, font, spacing, radius, shadow hay control style riêng theo từng màn.

Thay đổi foundation chỉ được thực hiện tập trung bằng một revision/version mới. Không sửa cục bộ một màn để "cho đẹp".

`FOUNDATION_LOCKED` khác `UI_LOCKED`:

- `FOUNDATION_LOCKED`: bộ nền dùng chung toàn dự án đã khóa.
- `UI_LOCKED`: bố cục/interaction của một frame/màn cụ thể đã được Owner duyệt để Claude code frontend.

## 2. Brand và background

Approved logo: logo 11Ship đã có trong project brand assets.

Quy tắc logo:

- dùng asset chính thức, không typeset lại chữ logo;
- không bóp méo tỉ lệ;
- không đổi màu logo tùy màn;
- không dùng logo tự vẽ/AI thay thế;
- kích thước có thể thay theo context nhưng phải giữ aspect ratio.

Màu nền và brand:

| Token | Value | Dùng cho |
|---|---:|---|
| `--11ship-brand-primary` | `#D8AD18` | Primary action, accent, brand |
| `--11ship-text-primary` | `#2A2A2E` | Text/icon chính |
| `--11ship-text-secondary` | `#6B6B70` | Text phụ |
| `--11ship-text-disabled` | `#9C9B97` | Disabled |
| `--11ship-surface-primary` | `#FFFFFF` | Card/form/control |
| `--11ship-surface-subtle` | `#F2F1EE` | Page/app background |
| `--11ship-surface-disabled` | `#E6E5E1` | Disabled surface |
| `--11ship-border-default` | `#DDDCD8` | Border |
| `--11ship-border-strong` | `#B7B6B2` | Strong border |

Semantic status base:

- Success: `#248A3D`
- Warning: `#A76700`
- Danger: `#C9342C`
- Info: `#2563EB`

Default page/app background: `#F2F1EE`. Form/card/control surface: `#FFFFFF`.

## 3. Typography

UI font: **Plus Jakarta Sans**.

Logo lettering là một phần của logo asset và không thay bằng Plus Jakarta Sans.

Locked type ramp:

| Style | Size / line-height | Weight |
|---|---:|---|
| Display | 32 / 40 | Bold |
| H1 | 28 / 36 | Bold |
| H2 | 24 / 32 | Bold |
| H3 | 20 / 28 | SemiBold |
| Body Large | 16 / 24 | Regular |
| Body Medium | 14 / 20 | Regular |
| Label | 14 / 20 | SemiBold |
| Caption | 12 / 16 | Medium |

Không tự thêm font family khác cho UI nghiệp vụ.

## 4. Spacing

Locked spacing scale:

`4, 8, 12, 16, 20, 24, 32, 40, 48 px`

Dùng token scale; không tạo khoảng cách tùy hứng theo từng màn trừ asset/media đặc biệt.

## 5. Radius

Locked radius scale:

- Small: 8
- Medium: 12
- Large: 16
- XL: 24
- Full/pill: 999

Default:

- input/button: 12;
- card: 16;
- modal/bottom sheet shell: 24;
- badge/chip pill: full.

## 6. Control sizing và touch target

- compact control: 40 px;
- default control: **48 px**;
- large control: 56 px;
- minimum touch target: **48 × 48 px**;
- app bar: 56 px;
- bottom navigation shell: 64 px + safe-area khi cần.

## 7. Core component baseline

### Button

Default button:

- height 48;
- radius 12;
- horizontal padding tối thiểu 16;
- label 14/20 SemiBold;
- Primary: nền `#D8AD18`, chữ/icon `#2A2A2E`;
- Secondary: surface trắng + border default;
- disabled dùng disabled surface/text;
- loading giữ nguyên kích thước, không làm layout nhảy.

Các state bắt buộc: default, pressed, disabled, loading. Hover chỉ áp dụng nền tảng có pointer.

### Input / Search / Select

Default:

- height 48;
- radius 12;
- nền trắng;
- border default;
- text 14/20;
- focus dùng brand primary;
- error dùng danger;
- disabled dùng disabled surface/text.

Các state bắt buộc: default, focused, filled, error, disabled.

### Card / list surface

- nền trắng;
- radius 16;
- padding mặc định 16;
- dùng `11Ship/Shadow/Card` khi cần elevation;
- list phẳng có thể dùng divider thay shadow.

### Badge / status

- dùng semantic status token;
- pill radius;
- không dùng màu ngẫu nhiên theo từng module.

### Modal / bottom sheet

- surface trắng;
- radius shell 24;
- overlay và animation có thể điều chỉnh theo platform, nhưng shell foundation không đổi.

### Loading / Empty / Error

- loading không thay đổi kích thước container;
- error dùng danger semantic;
- empty illustration/copy là chi tiết màn và không thuộc foundation lock.

## 8. Shadows

- Card: `0 2px 8px rgba(42,42,46,.08)`
- Floating: `0 8px 24px -2px rgba(42,42,46,.14)`
- Modal: `0 16px 40px -4px rgba(42,42,46,.20)`

Không tạo shadow riêng tùy màn.

## 9. Responsive

CSS/web breakpoints:

- sm: 640
- md: 768
- lg: 1024
- xl: 1280

Mobile native vẫn ưu tiên safe-area và kích thước thiết bị; breakpoint là contract cho web/responsive layout, không ép native app giả CSS.

## 10. Những gì vẫn được thay đổi theo từng màn

Đây là phần Figma cần thiết kế/review:

- bố cục và hierarchy;
- số cột/list/grid;
- vị trí CTA;
- navigation và flow;
- mật độ thông tin;
- icon cụ thể;
- ảnh/illustration;
- animation nghiệp vụ;
- kích thước card domain đặc thù;
- nội dung empty/error;
- component đặc thù Shop/Driver/Wallet/Delivery.

Các chi tiết này được phép iterate cho tới khi frame đạt `UI_LOCKED`.

## 11. Figma source of truth

File: **11Ship — UI Design System & Auth**  
https://www.figma.com/design/VFIs4Hablp9z4KnV19gNzv

Hiện đã có:

- collection `11Ship Brand v1`;
- collection `11Ship Layout v1`;
- Plus Jakarta Sans text styles;
- Card/Floating/Modal effect styles;
- approved 11Ship logo component;
- Auth draft screens dùng foundation từ đầu.

## 12. Implementation rule

Frontend implementation phải map các Figma token sang shared theme/CSS/theme constants của codebase. Không hardcode lại giá trị trong từng màn.

Nếu cần thay foundation, STOP và mở thay đổi foundation riêng; không sửa lén trong feature PR.

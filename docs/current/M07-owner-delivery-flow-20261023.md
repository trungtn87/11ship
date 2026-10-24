# M07 — Owner chốt quy trình giao hàng (23/10/2026)

**Trạng thái:** Đã triển khai backend + 11Ship/11Food trên nhánh PR #178 (xem mục VII); chờ CI, review và nghiệm thu thiết bị. Chưa deploy VPS. **Ưu tiên:** cao, lỗi chặn nhận hàng.
**Phạm vi:** 11Ship Android + 11Food Android + backend/M07/M06/M10/M08, kiểm thử hành vi liên quan. Base main mới nhất; nhánh `codex/m07-owner-delivery-flow-20261023`. Quyết định mới ưu tiên hơn mô tả M07 cũ khi xung đột.

## I. Quy tắc chung

- Phân biệt **Nhận đơn** (shipper nhận việc, chưa cầm hàng), **Đã nhận hàng** (đã lấy hàng ở quán) và **Giao thành công** (đã giao cho người nhận, shipper xác nhận).
- Điểm **lấy** luôn là vị trí quán đã lưu. Không bắt shipper ghim/xác nhận lại điểm lấy.
- Phí M06 đã tính và hợp lệ thì không yêu cầu shipper nhập lại. Chỉ cho thương lượng/ghi phí ở trạng thái và mode cho phép. Khóa phí khi bấm **Đã nhận hàng**, không khóa trước đó.
- Trước khi lấy hàng: shipper được **Hủy nhận đơn** (chỉ hủy lượt nhận, không hủy Order/yêu cầu giao) để tìm shipper khác.
- **Sau khi đã nhận hàng**: shipper không được hủy đơn, hủy nhận hay xác nhận “Giao thất bại”; trên app chỉ thao tác nghiệp vụ **Giao thành công** và liên hệ các bên. Nếu không giao được, shipper **gọi quán để tự thống nhất**, không có nút báo giao thất bại.
- Quyền **hủy đơn sau khi shipper đã nhận hàng thuộc người tạo đơn**: ORDER = khách đã tạo đơn trên 11Food; DIRECT = quán đã tạo yêu cầu giao. Kiểm soát quyền tại backend, không chỉ ẩn UI. Hủy có lý do, audit, thông báo và xử lý assignment/hoa hồng an toàn; không mặc định hàng đã quay lại quán, không tự chuyển thành giao thành công.
- Không tự động hủy một đơn đã được shipper **lấy hàng** do timeout. Các timeout **chờ xác nhận/chờ nhận/chờ shipper** trước khi lấy hàng theo cấu hình hiện hành vẫn được rà soát để không xung đột.
- Không thay đổi quyền xử lý sự cố đặc biệt của Admin/SYSTEM một cách thiếu kiểm soát; không cho shipper đi vòng qua backend để hủy.
- Bảo toàn idempotency, optimistic version, event log, wallet commission reserve/capture/release đúng một lần và các liên kết trạng thái M10.

## II. Trường hợp 1 — Khách đặt qua 11Food (source ORDER)

1. Khách đặt món và có địa chỉ nhận hàng; quán xác nhận đơn.
2. **BỎ bước “Đã chuẩn bị xong”**: khi quán bấm **Gọi shipper** thì mặc định đồ đã chuẩn bị xong/sẵn sàng để giao. Không thêm nút, màn hình, trạng thái phụ, yêu cầu xác nhận hay checkpoint “Chuẩn bị xong” trước lúc gọi shipper. Nếu code cũ bắt buộc bước đó, bỏ rào cản và điều chỉnh UI/backend đồng bộ, không làm mất các trạng thái đơn hàng cần thiết khác.
3. Shipper xem điểm lấy (quán), điểm giao/địa chỉ khách và phí giao theo M06; nếu đồng ý thì **Nhận đơn**.
4. Hệ thống thông báo quán shipper đã nhận đơn, đang đến lấy.
5. Shipper đến lấy đồ, bấm **Đã nhận hàng**; app báo quán. Sau đó shipper giao đến khách và bấm **Giao thành công**; app cập nhật quán và khách.
6. Điểm giao hợp lệ đã có thì không bắt ghim lại, không bắt qua màn “Xác nhận điểm giao và phí”. Nếu tọa độ chưa có nhưng địa chỉ đã có, phải có cách xử lý được chỉ dẫn rõ, không bế tắc tại pickup; không tự gán tọa độ ước đoán làm GPS xác thực.

**Nhánh đề xuất phí:** Shipper chưa đồng ý phí → nhập mức mong muốn → hệ thống gửi duyệt đến **người trả phí** (SHOP = quán, CUSTOMER = khách qua 11Food); thông báo bên còn lại về tiến độ. Nếu đồng ý: cập nhật phí của đúng đơn một cách nguyên tử, thông báo shipper để tiếp tục nhận/lấy hàng; nếu từ chối hoặc hết hạn phản hồi: kết thúc lượt thương lượng/nhận của shipper đó và tiếp tục tìm shipper khác **theo phí trước đó**, không hủy Order. Thời gian chờ thương lượng có hạn, không tạo race 2 shipper cùng được giao; không reset vô hạn đồng hồ tìm ship.

## III. Trường hợp 2 — Quán chủ động gọi ship (source DIRECT, không có GPS điểm giao)

1. Quán nhập địa chỉ giao **mô tả**, tên/số điện thoại người nhận và nội dung giao; chỉ cần điểm lấy tại quán. **Không bắt GPS điểm giao**, không bắt ghim/xác nhận trên map; **không theo dõi vị trí hành trình của đơn DIRECT** ở UI khách/quán.
2. Quán chọn khoảng cách/mốc phí **ước tính** theo bảng M06 và hệ thống hiển thị mức phí để gọi ship; không giả là khoảng cách GPS/route đã xác minh. Nếu chưa xác định được phí thì UI phải hướng dẫn rõ cách chọn mốc phí/thỏa thuận để vẫn tạo và nhận được đơn.
3. Shipper xem địa chỉ mô tả, điểm lấy, mức phí, **Nhận đơn**, đến quán lấy đồ, bấm **Đã nhận hàng**, giao bằng địa chỉ mô tả/liên hệ trực tiếp, bấm **Giao thành công**. Quán theo dõi **trạng thái** đơn, không theo dõi GPS hành trình.
4. Shipper không đồng ý phí → **đề xuất phí khác** → quán đồng ý hay từ chối. Đồng ý: hệ thống đổi phí và tiếp tục luồng; từ chối/hết thời hạn: kết thúc lượt shipper đề xuất, tìm shipper khác, **không hủy toàn bộ yêu cầu giao**.
5. Nếu DIRECT do quán tạo nhưng **khách là người trả phí** và người nhận không có tài khoản 11Food, hệ thống gửi đề xuất đến **quán**; quán liên hệ khách bên ngoài và xác nhận/không xác nhận trên app thay mặt người trả phí, có log ghi rõ do quán xác nhận. Không giả thông báo/duyệt từ tài khoản khách không tồn tại.
6. Vẫn dùng **GPS quán/shipper phục vụ tìm đơn quanh điểm lấy** theo M06/M03; việc “bỏ GPS” ở đây chỉ là bỏ GPS **điểm giao** và chức năng **theo dõi hành trình của đơn DIRECT**. Không vô hiệu vị trí/điều kiện online của shipper.

## IV. Sửa lỗi chặn nhận hàng hiện tại (bắt buộc)

- Android tại `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart`: `_needsFee` đang dựa vào `fee.amountVnd == null`, bắt nhập phí cả khi backend cấm nhập ở fee mode STANDARD. Phải dựa vào trạng thái/quyền hành động API, không dùng null đơn thuần.
- Backend `apps/backend/src/delivery/delivery-shipper-service.ts` tại `confirmDestination`, `pickup`: STANDARD phí null nhưng bắt shipper nhập gây `FEE_LOCKED`, sau đó `FEE_NOT_CONFIRMED`. Sửa end-to-end; không “fix” bằng cách mở khóa vô điều kiện sau pickup.
- `apps/backend/src/delivery/delivery-views.ts` có nhánh AGREED thiếu điểm giao nhưng `can.confirm_destination` có thể false. Sửa quyền/trạng thái để không mắc kẹt.
- `apps/backend/src/delivery/delivery-shop-service.ts`: fee STANDARD có thể null khi thiếu route/phí; thiết kế fallback đúng loại đơn mà không đoán phí/quãng đường. Đồng bộ M06 và M10.
- Nếu đủ thông tin hợp lệ, chỉ một nút **Đã nhận hàng** và một bước xác nhận; thay đổi hợp lệ tự reload dữ liệu, xử lý stale version và retry rõ ràng.
- Lời nhắc đơn giản; **không hiển thị mã tra cứu/request ID/UUID** cho người dùng; vẫn giữ trong log backend/SYSTEM. Không hiển thị hướng dẫn buộc shipper làm thao tác mà API không cho phép.
- Bỏ các dòng **Đã thanh toán**, **Còn phải thu (tiền món)** khỏi UI đơn món của 11Food/11Ship nơi phản ánh việc ứng dụng đang quản lý thanh toán. Giữ tiền món, phí giao dự tính/đã chốt và người trả phí. Không xóa cột DB/hạch toán hiện hữu; xử lý các phụ thuộc dữ liệu có kiểm soát.

## V. Kiểm thử chấp nhận

- ORDER quán trả phí và ORDER khách trả phí: tạo → quán xác nhận → **Gọi shipper (không “Đã chuẩn bị xong”)** → shipper nhận → lấy → hoàn thành; thông báo quán/khách phù hợp.
- ORDER thương lượng phí: duyệt đúng **người trả phí**, đồng ý/từ chối/timeout, không hủy Order, không nhận trùng; khóa phí chỉ sau lấy hàng.
- DIRECT không GPS: chỉ mô tả + mốc phí M06 → nhận → lấy → hoàn thành; không cần map, không tracking hành trình; DIRECT quán trả/khách trả xác nhận qua quán.
- Fee STANDARD null, AGREED thiếu point, PICKUP_AGREEMENT và fee chốt: không bị vòng `FEE_LOCKED` / `FEE_NOT_CONFIRMED`; nếu phải thương lượng thì có thao tác khả dụng.
- Trước lấy hàng shipper hủy lượt nhận và tìm lại; **sau lấy hàng shipper không hủy và không “Giao thất bại” kể cả gọi API thẳng**. Người tạo ORDER/DIRECT hủy đúng quyền, người khác bị từ chối, có audit/thông báo; không tự hủy timeout sau pickup.
- Không double hoa hồng hoặc cập nhật trạng thái/đơn món trái phép; race giữa hủy/nhận/lấy/hoàn thành kiểm thử trọng điểm.
- Bỏ 2 dòng thanh toán khỏi giao diện, không làm mất dữ liệu lịch sử; thông báo người dùng ngắn gọn không có mã tra cứu.
- Tests tập trung backend integration + Flutter/widget và 11Food/11Ship UI tương ứng. Dùng required CI, test trên thiết bị do Owner nghiệm thu sau. Không đổi APK signing/applicationId; tăng versionCode khi phát hành. Không deploy/migration VPS trước phép triển khai riêng.

## VI. Quy tắc bàn giao

Codex là **lead duy nhất** cho PR này; không tách thành PR trùng hoặc sửa chồng PR khác. Kiểm tra main và PR đang mở trước khi code, đồng bộ thay đổi tránh xung đột. Triển khai theo thứ tự: (1) backend states/fee/cancel, (2) UI 11Ship/11Food + thông báo, (3) targeted tests/CI. Giữ migration theo hướng tiến, không sửa migration đã deploy. Báo cáo ngắn: commit SHA, thay đổi, checks, blocker, cách Owner thử 2 luồng; không tự merge hoặc deploy trước review.

## VII. Hiện trạng triển khai (PR #178)

**Thay đổi hành vi**

| Chủ đề | Quyết định đã code |
|---|---|
| Bước "Đã chuẩn bị xong" | Bỏ hẳn: không còn endpoint `POST /v1/shop/me/orders/:id/ready`, không còn `can.ready`/`ready_at`/trạng thái `READY`. **Gọi shipper = đồ sẵn sàng.** Cột `orders.ready_at` giữ nguyên (dữ liệu cũ). |
| Phí | Phí luôn chốt **lúc gọi ship**: theo tuyến đo được; hoặc (ORDER) khoảng cách đã lưu từ lúc khách đặt; hoặc (DIRECT không bản đồ) **mốc phí M06 do quán chọn** (`fee_band` 0..2, hiển thị "Ước tính theo mốc"); hoặc phí quán đề xuất (`agreed_fee`). Không tính được thì trả `400 FEE_REQUIRED` và app mở form đề xuất phí — **không tạo đơn không ai nhận được**. Không còn tạo mới `PICKUP_AGREEMENT`. |
| Đơn cũ kẹt (STANDARD phí null / PICKUP_AGREEMENT) | `can.confirm_fee` cho phép shipper nhập **một lần** mức phí đã thỏa thuận (`POST .../destination` chỉ cần `fee_vnd`; `lat/lng` tùy chọn). Phí đã có thì gọi lại là no-op, khác mức mới trả `FEE_LOCKED`. App dựa vào `can.*`, không dựa `amountVnd == null`. |
| Nhận hàng | `pickup` chỉ cần phí đã chốt; **không cần điểm giao/ghim**. Khóa phí khi bấm "Đã nhận hàng". |
| DIRECT | Địa chỉ mô tả, không GPS điểm giao, **quán không thấy vị trí hành trình** (`location = null`). Vị trí quán/shipper dùng tìm đơn không đổi. |
| Phí shipper đề xuất | Người trả phí quyết định: ORDER khách trả → **khách trong 11Food** (`POST /v1/customers/me/orders/:id/delivery/fee` `{decision: ACCEPT|REJECT, expected_version}`; quán không trả lời thay, bị `DELIVERY_STATE_CONFLICT`); ORDER quán trả → quán; DIRECT → quán (nếu khách trả thì quán xác nhận **thay** khách, log `SHOP_ON_BEHALF_OF_CUSTOMER`). Từ chối/hết hạn: giữ phí cũ, tiếp tục tìm shipper, **Order không bị hủy**. |
| Shipper sau khi lấy hàng | Chỉ **Giao thành công**. `POST .../fail` luôn trả `403 SHIPPER_FAIL_NOT_ALLOWED`; `release` trả `AFTER_PICKUP_NO_CANCEL`. App bỏ nút/màn "Giao thất bại". |
| Hủy sau lấy hàng | Chỉ **người tạo**: ORDER → khách (`POST /v1/customers/me/orders/:id/cancel-after-pickup` `{reason, expected_version}`); DIRECT → quán (`POST /v1/shop/me/deliveries/:id/cancel`). Quán của đơn khách bị `AFTER_PICKUP_NO_CANCEL`. Kết quả: delivery `cancelled_by_merchant`, assignment `CANCELLED_BY_CUSTOMER/SHOP`, **hoa hồng được giải phóng (không thu)**, mở hồ sơ hàng `OPEN` (custody SHIPPER) — không mặc định hàng đã về quán; quán/Admin xác nhận qua `custody`. Order ORDER → `CANCELLED_BY_CUSTOMER`. Có audit + thông báo. Không timeout nào tự hủy đơn đã lấy hàng (kiểm thử). |
| Thông báo/UX | Bỏ "Mã tra cứu" khỏi lỗi luồng giao hàng/đơn món; bỏ "Đã thanh toán", "Còn phải thu", "Ghi nhận đã thanh toán" khỏi UI (DB/endpoint `payment` giữ nguyên). Thông báo mới: phí đề xuất tới người trả phí, tiến độ tới bên còn lại, shipper được báo kết quả (kể cả khi bị từ chối), hủy sau lấy hàng. |

**Migration mới (tiến, không sửa migration đã deploy):** `1796083200000_m07-creator-cancel-after-pickup.sql` (renumbered after M13 `1795737600000` and M12 `1795996800000` reached main) — mở rộng guard/CHECK: `delivering → cancelled_by_merchant`, `delivery_events.actor_type`/`delivery_assignments` thêm `CUSTOMER`, `orders` cho phép `PREPARING → CANCELLED_BY_CUSTOMER` (giữ `confirmed_at`, bắt buộc lý do), `deliveries_pickup_ck` không còn đòi điểm giao. Chưa chạy trên VPS.

**Cách Owner thử trên 2 APK (sau khi có bản build được phép phát hành)**
1. *ORDER, khách trả phí:* 11Food (khách) đặt → 11Food (quán) xác nhận → **Gọi shipper** (không có bước "Món đã sẵn sàng") → 11Ship nhận → "Đề xuất mức khác" → khách thấy thẻ "Shipper muốn lấy phí…" → Đồng ý/Từ chối → shipper nhận → "Đã nhận hàng" (một bước) → "Giao thành công".
2. *Hủy:* ở bước đang giao, khách bấm "Hủy đơn (shipper đã lấy hàng)" + lý do; quán thấy ghi chú "chỉ khách mới hủy được"; shipper chỉ có "Giao thành công".
3. *DIRECT:* 11Food → Giao hàng → Gọi shipper: nhập địa chỉ mô tả, chọn **mốc phí**, không ghim bản đồ; shipper nhận/lấy/giao; quán không thấy vị trí shipper; quán hủy được sau lấy hàng và phải xác nhận xử lý hàng trước khi gọi lại.

## Addendum 2026-10-24 — thời hạn trả lời đề xuất phí, xác nhận thay khách, đơn cũ, `/ready`

Quyết định Owner 2026-10-24 (thay cho mọi giả định "45 phút"; không có mốc 45 phút nào):

1. **Thời hạn trả lời đề xuất phí** là tham số riêng, mặc định **5 phút**, đơn vị phút, số nguyên dương (1–1440). Chỉnh tại Web Admin → Cài đặt → Đơn hàng, nhãn "Thời gian trả lời đề xuất phí" (`GET/POST /v1/admin/system-settings/order-parameters`). **Chỉ SYSTEM sửa** (ADMIN chỉ xem; API kiểm tra vai trò dưới khóa, ADMIN ghi nhận `ADMIN_FORBIDDEN`). Lưu ở `app.order_parameters`, nhật ký thay đổi `app.order_parameter_changes` (chỉ thêm), audit `admin.order_parameters.update.v1`, outbox `order.parameter.changed.v1`.
2. Mỗi đề xuất của shipper (counter) lấy số phút đang cấu hình **lúc tạo** và lưu hạn riêng `shipping_fee_agreements.answer_expires_at`; đổi cấu hình **chỉ ảnh hưởng đề xuất sau đó**. Gửi lại cùng yêu cầu/Idempotency-Key không đặt lại đồng hồ. Hạn trả lời **không bao giờ vượt hạn tìm** (`min(now + phút, expires_at)`).
3. Hết hạn mà chưa trả lời (hoặc trả lời muộn): bỏ đề xuất chưa được duyệt, **giữ mức phí trước đó**, đơn vẫn tìm shipper trong cửa sổ tìm hiện có (**không gia hạn tìm**). Sự kiện `COUNTER_EXPIRED` (thỏa thuận) và `delivery.fee_answer_expired` (giao hàng) được **lưu và commit trong giao dịch riêng** trước khi lệnh trả lời chạy, nên API từ chối trả lời muộn bằng `409 FEE_ANSWER_EXPIRED` mà không làm mất bản ghi hết hạn. Sweeper cũng xử lý các đề xuất không ai trả lời. Trả lời và sweeper chạy đồng thời chỉ cho đúng một kết quả (khóa shipper → delivery → thỏa thuận).
4. **Xác nhận thay khách**: khi quán xác nhận cho người trả phí là khách chưa có app (xác nhận trực tiếp, hoặc tự xác nhận sau khi quán nhận đề xuất của shipper), `actor_type = SHOP`, `actor_id` = người dùng của quán; việc xác nhận thay khách (`on_behalf_of = CUSTOMER`) và bên trả phí (`fee_payer`) được lưu ở cột riêng của `shipping_fee_agreement_events`. Khi quán tự trả phí thì không có `on_behalf_of`.
5. **Đơn cũ chưa có phí** (STANDARD, `fee_vnd` rỗng) mà **khách là bên quyết định phí** (đơn ORDER khách trả): shipper không tự nhập phí (`FEE_NOT_CONFIRMED`); quyền duyệt như phí thỏa thuận. Với cuộc gọi DIRECT bên quyết định là quán, đường nhập của shipper cho đơn cũ giữ nguyên (xem điểm còn mở trong báo cáo).
6. **`POST /v1/shop/me/orders/:id/ready`** được giữ để APK cũ không lỗi: kiểm tra quyền (quán của đơn) và trạng thái (đang chuẩn bị), trả đơn hiện tại; **không ghi gì, không tạo sự kiện, không là bước bắt buộc**. APK mới không còn nút.

## Addendum 2026-10-24 (2) — shipper bỏ lượt nhận có phí thương lượng; đề xuất phí cho phí theo bảng và sau khi nhận đơn

Nhánh `fix/m07-fee-negotiation-reassignment`. Chỉ sửa hai lỗi dưới đây; không đổi quyền từ chối phí ban đầu, khiếu nại hay thiết kế khác.

1. **Đơn kẹt sau khi shipper bỏ lượt nhận phí đã thương lượng.** Mọi cách kết thúc lượt nhận trước khi lấy hàng (shipper "Hủy nhận đơn", Admin giải phóng, đề xuất phí bị từ chối/hết hạn) đi qua **một** chỗ (`DeliveryHandback`): kết thúc assignment, giải phóng hoa hồng đúng một lần, rồi gỡ ràng buộc phí với shipper đó. Phí chỉ mình shipper đó đã đồng ý quay về **phí gốc** (bảng giá với STANDARD; đề xuất của quán với AGREED, hỏi lại người trả phí ở shipper kế tiếp), đơn về `waiting_driver` trong **hạn tìm ban đầu** (hết hạn thì `search_stopped`, quán gọi lại/hủy theo quyền hiện có). Không hủy đơn gốc, không gia hạn tìm; lượt nhận, hoa hồng và lịch sử phí cũ vẫn giữ (`FEE_REVERTED`, `COUNTER_WITHDRAWN`).
2. **Đề xuất phí cho phí đã chốt, kể cả sau khi nhận đơn.** `POST /v1/driver/deliveries/:id/fee/counter` nay dùng được cho phí theo bảng và phí thỏa thuận đã chốt: trước khi nhận (mọi shipper còn đủ điều kiện, đơn được giữ cho người đề xuất) và sau khi nhận nhưng trước "Đã nhận hàng" (chỉ shipper đang giữ đơn, `can.propose_fee`). Phí đang áp dụng **không đổi** cho đến khi người trả phí trả lời; trong lúc chờ không ai nhận đơn, và shipper giữ đơn không lấy hàng được (`FEE_NOT_CONFIRMED`, `can.pickup=false`). Người trả lời: ORDER khách trả → khách (11Food, `POST /v1/customers/me/orders/:id/delivery/fee`); ORDER quán trả → quán; DIRECT → quán (khách ngoài app trả thì quán xác nhận thay, `on_behalf_of=CUSTOMER`). Đồng ý: phí đơn và thỏa thuận đổi trong cùng giao dịch, vẫn đúng shipper và hoa hồng đang giữ (hoa hồng là số tiền cố định theo chính sách, không phụ thuộc phí giao nên không phải đồng bộ). Từ chối/hết hạn: phí giữ nguyên; nếu người đề xuất đang giữ đơn thì lượt nhận kết thúc như mục 1. Hạn trả lời là tham số hiện có (mặc định 5 phút), không vượt hạn tìm, gửi lại cùng Idempotency-Key không đổi đồng hồ; đề xuất khi hạn tìm đã hết bị từ chối (`DELIVERY_SEARCH_EXPIRED`). Sau "Đã nhận hàng": `FEE_LOCKED`.
3. **Migration tiến** `1796342400000_m07-fee-revision.sql`: hai cột cho đề xuất đang chờ (`revision_fee_vnd`, `revision_by`; hạn trả lời dùng lại `answer_expires_at`), cho phép một bước chuyển `ACCEPTED→PROPOSED` (AGREED) và hai loại sự kiện. Không sửa migration đã triển khai; chưa chạy trên VPS.
4. **App.** 11Ship: nút "Đề xuất mức phí khác" ở thẻ đơn (cả phí theo bảng) và ở chi tiết đơn đã nhận; khi đang chờ có thông báo chờ và không nhận/lấy hàng được; lịch sử ghi "Phí không được đồng ý". 11Food quán: thẻ "Shipper đề xuất đổi phí giao" với Đồng ý/Từ chối khi quán là người quyết định, chỉ chờ khi khách quyết định. 11Food khách: thẻ duyệt phí dùng chung (`fee_decision`). Thông báo đúng đơn cho khách, quán và shipper; không hiện mã tra cứu.

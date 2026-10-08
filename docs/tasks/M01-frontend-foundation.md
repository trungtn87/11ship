# M01-FE0 — Nền frontend web responsive

Trạng thái: DRAFT — Owner chưa khóa lựa chọn kiến trúc; chưa giao implementation.
Ngày 09/10/2026, giờ Việt Nam.
Nguồn: backend AuthController/RoleContextService/onboarding controllers trên main; M01-R1; brand guideline; kế hoạch PR #20; workflow UI PR #14.
M02 backend PR #21 đã merge. Mẫu M02-A nằm PR #23, mới duyệt tạm bố cục.
Đây là thiết kế foundation để nối UI M01/M02, không phải tuyên bố đã có bản dùng thử.

## 1. Phạm vi và lựa chọn đề xuất

Frontend tại apps/web, npm workspace dùng Node/npm khóa của repo.
Đề xuất React + TypeScript + Vite + React Router, CSS variables theo brand; không Next/SSR trong bản test đầu. Dùng fetch native và React context/state; chưa thêm Redux/query library.
Claude chọn/pin phiên bản tương thích Node24 tại lúc implementation, cập nhật lockfile qua npm; không dùng dependency latest không pin. Kiểm license và build bằng CI.
Đây là đề xuất cần Owner duyệt, không phải kiến trúc đã khóa.

FE0 chỉ gồm shell/router, API client, session state, mutation coordinator, primitives và test của chúng.
Màn login/register/OTP/onboarding là leaf M01-UI riêng; hồ sơ/lịch là M02-A-UI riêng.
Không tạo API giả trong production để FE0 trông như hoàn tất.
Không menu/Order/Driver approval/Wallet/Admin/logout/recovery mới.

## 2. Hosting và API

Bản staging dùng môi trường M00 đã khóa, hiện PR #22 đang thiết kế Render/Supabase; FE0 không thay thiết kế đó.
Đề xuất ưu tiên cùng origin: frontend static + reverse proxy /v1 tới backend, hoặc backend phục vụ bundle nếu M00 release spec chọn cách đó. Cách tích hợp cụ thể phải được ghi trong release contract trước code adapter deploy.
Vite development proxy /v1 chỉ trong local; production không chạy Vite dev server.
Nếu buộc tách origin, phải khóa API origin và CORS allowlist trong M00; không wildcard credentials.
Client cấu hình public API base URL; không DB URL/service-role/API secret trong bundle. Supabase ở backend theo M00, browser không truy cập database trực tiếp.
Không đưa OTP test/password/token vào URL, analytics hoặc console.
Không cache response API có thông tin phiên/hồ sơ trong service worker. Chưa thêm PWA/offline queue.

## 3. Token/session — lựa chọn đề xuất cho bản test

Opaque bearer giữ trong bộ nhớ của tab, không localStorage/sessionStorage/IndexedDB và không cookie do client tự đặt. Password/OTP/proof cũng chỉ trong bộ nhớ; clear khi bước kết thúc/hủy.
Reload hoặc đóng tab phải đăng nhập lại; ghi rõ trong copy bản test. Đây là tradeoff đề xuất chờ Owner duyệt.
Chưa thêm refresh token/cookie BFF hoặc persistent login vì backend hiện không có contract đó.
Không có nút logout giả. Nếu cần thao tác bỏ phiên client cho test, nhãn rõ “Xóa phiên trên trình duyệt”, mô tả chưa thu hồi server và nằm trong công cụ thử riêng, không UI tài khoản production.

Session state: INITIAL → SIGNED_OUT → AUTHENTICATING → RESOLVING → READY; failure AUTHENTICATING trở lại SIGNED_OUT.
Mỗi lần thay token/role/logout-client tăng authGeneration. Request giữ generation lúc gửi; response thuộc generation cũ không được cập nhật state/quay router hoặc xóa token mới.
Abort request cũ là tối ưu; generation check mới là đảm bảo.
401 SESSION_INVALID/REVOKED/EXPIRED chỉ clear phiên nếu response thuộc generation hiện tại. ACCOUNT_DISABLED chuyển màn typed refusal theo API.
Không đo expiry để cấp quyền từ đồng hồ client; server vẫn quyết định.
Không serialize bearer/proof trong lỗi, evidence, screenshot hay persisted retry.

## 4. Router từ projection server

Sau login/register lưu access_token trong bộ nhớ và GET /v1/auth/me để lấy projection coherent sau R1.
Sau chọn role hoặc hoàn tất onboarding GET /me lại, không tự cộng role vào client.
Mỗi protected route bootstrap kiểm projection; shell không render nội dung quán trước khi resolve.

Thứ tự router:
1. Không token/phiên không hợp lệ → đăng nhập.
2. Projection cần chọn vai trò → màn chọn trong available_roles.
3. active_role SHOP và có trong available_roles → shell quán.
4. active_role DRIVER và có trong available_roles → shell xế giới hạn phạm vi đã code; PENDING không hiện nút nhận đơn giả.
5. Không effective role → màn onboarding/trạng thái hồ sơ dựa onboarding.shop/driver; không mặc định chọn SHOP hay lặp redirect.
available_roles rỗng không tự đồng nghĩa người dùng mới: phân biệt hồ sơ DISABLED/CLOSED/INCOMPLETE/PENDING qua projection hiện hành.
Unsupported role/state fail closed thành thông báo và retry /me, không tự cấp role.
Vai trò PLATFORM/EXTERNAL không bao giờ nằm trong auth router.

POST /v1/auth/role/select chỉ nhận role hỗ trợ. Không tự thêm Idempotency-Key nếu API không có contract.
Chọn SHOP có thể thu hồi phiên SHOP khác; trước thao tác hiển thị copy ngắn về việc chuyển phiên. Không áp replacement rule cho mọi role.
ROLE_NOT_AVAILABLE → tải /me lại và trình bày lựa chọn hiện hành.
SHOP_ROLE_REQUIRED từ M02 → refresh /me và route lại; không auto POST select để che lỗi quyền.

## 5. API client

Một transport duy nhất: base URL allowlisted, bearer injection theo token hiện tại, Accept/Content-Type JSON, AbortController timeout, parse response envelope.
Success theo {data}; failure theo error envelope thực tế từ backend. Trước code phải fixture exact shapes từ controller/filter, không đoán message/code nesting.
Typed result phân biệt HTTP error, network error, timeout, aborted, invalid response. Hiển thị request_id nếu có trong “Chi tiết lỗi”, không raw body/stack.
Timeout không đồng nghĩa transaction thất bại. UI phải dùng mutation coordinator.
Không blanket retry POST/PUT. GET có retry chủ động; không request vô hạn.
Validation frontend giúp nhập liệu; backend quyết định cuối.
Request body lấy từ validated immutable snapshot, không đọc live form sau await.

## 6. Mutation coordinator

Áp dụng endpoint có idempotency contract: register, onboarding và hai PUT M02. Login/OTP request/verify/role-select không tự gán cơ chế replay.
Mỗi logical attempt giữ operation, normalized body, key UUID, user binding khi có, generation; lưu trong bộ nhớ, không session_id trong fingerprint hoặc scope.
Double submit cùng thao tác reuse promise/key/body. Disable editor đang gửi.
Network/timeout → trạng thái UNKNOWN; retry cùng body/key, không tạo key mới hoặc tự gửi body đã sửa.
Muốn sửa body khi UNKNOWN phải cảnh báo kết quả cũ có thể đã commit; reconcile bằng GET phù hợp trước thao tác mới. Register cần xem contract replay sensitive response, không kết luận bằng GET authenticated khi chưa token.
HTTP typed refusal xử lý đúng spec; VERSION_CONFLICT không retry với version mới tự động.
Same-key different-body bị cấm ở client. Không tự phát sinh callback retry do React effect/StrictMode.
Sau save M02 GET lại: mutation stored result chỉ là cấu hình đã commit, availability lấy GET.
Chuyển phiên: generation cũ không áp response vào màn mới. Retry sau đăng nhập cùng user chỉ được explicit user action và logical body/key còn trong bộ nhớ; xác minh user_id qua /me. User khác thì bỏ attempt cũ, không replay.
Register chưa có user binding cần xử lý riêng theo contract hiện hành, không đưa phone/password vào log hoặc persistent storage.
Reload mất attempt: không tự reconstruct key từ form rồi gửi lại; thông báo giới hạn bản test, yêu cầu kiểm dữ liệu hiện tại khi có thể.

## 7. UI primitives

Dùng brand màu/font/spacing/radius và logo asset chính thức; nếu chưa logo asset thì wordmark text tạm ghi rõ, không vẽ logo thay thế.
Font Plus Jakarta Sans self-host hoặc bundle asset license hợp lệ để test offline layout không silently fallback; chiến lược asset cần được implementation ghi rõ.
Primitives: Button primary/secondary/destructive/loading/disabled; Input/phone/password/OTP; Field label/help/error; Card; Dialog; Toast/live region; Skeleton; error/empty state; status badge có chữ; responsive shell.
Touch target ≥44px; keyboard/focus-visible; label gắn control; dialog trap focus/Escape/focus return; lỗi không chỉ dùng màu.
Không đưa menu chưa có chức năng dưới dạng button bấm không làm gì.
Primitives foundation có thể xây trước các màn; UI màn vẫn phải duyệt reference riêng. Không tự đánh dấu UI_LOCKED từ PR này.

## 8. Acceptance FE0

F01 build/lint/typecheck workspace web, backend scripts vẫn hoạt động; không secret trong bundle.
F02 token không persistent storage/URL/log; reload về signed-out đúng copy.
F03 projection roleless/multi-role/stale role/PENDING/DISABLED/CLOSED không loop/không route nhầm.
F04 request stale generation không áp dữ liệu hoặc clear token mới.
F05 double submit một attempt; timeout retry cùng key/body; edited body không reuse key.
F06 old user attempt không gửi với user khác; replacement cùng user giữ logical request khi explicit retry.
F07 JSON invalid/HTTP/network/abort/timeout phân biệt; error envelope/request_id đúng.
F08 expired/revoked dẫn Auth đúng; không lộ sensitive result; quyền do backend quyết định.
F09 primitives keyboard/mobile focus/label/modal và font theo brand.
F10 API base URL và deploy integration theo M00; không DB direct browser, không mock fallback trong staging.
Unit meaningful cho router/coordinator/generation; browser component checks cho primitives. E2E Auth đầy đủ thuộc leaf sau, không gọi F01–F10 là Owner UAT.
PR Draft/evidence CI đúng SHA, ChatGPT review, Owner merge.

## 9. Dependency và gói kế tiếp

Cần Owner khóa stack, token memory/reload behavior và hosting adapter sau đối chiếu M00.
M01-UI-AUTH có contract screen/copy/reference riêng, OTP test theo môi trường duyệt; không bypass xác minh.
M01-UI-ONBOARD và M02 profile selector cần API vùng ACTIVE; thiết kế read endpoint thuộc M02 riêng, xác thực session roleless được hỗ trợ để onboarding, chỉ dữ liệu tối thiểu. Chưa chốt route/payload ở FE0, không để Claude tự tạo API.
Figma quota chặn việc dựng: prototype HTML đã duyệt tạm không tự bỏ gate FIGMA_REQUIRED. Owner phải quyết định reference HTML thay tạm cho visual gate trước code màn.
Các điểm chưa khóa phải được xử lý bằng design addendum, không tự báo READY_FOR_CLAUDE.

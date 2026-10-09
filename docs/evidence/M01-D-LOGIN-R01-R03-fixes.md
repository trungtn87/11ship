# Sửa R01–R03
Ngày09/10/2026. Sửa tài liệu theo Owner; không code/test runtime.
R01: GET/me không còn scopes, thống nhất verify response; ADMIN quyền module vẫn task sau.
R02: enrollment atomic bind challenge với factor_id+version; rerun yêu cầu owner/snapshot match; activate giữ generation; session bind generation; factor replacement khác id và làm credential cũ mất hiệu lực.
R03: limiter key riêng ổn định, singleton config/key-check chống instance sai; crypto rotation không đổi bucket; limiter rotation chưa được phép live; fail closed khi thiếu/sai key.
Đọc lại file sau save xác nhận GET/me, factor binding, limiter config schema và CSRF stable. Bổ sung acceptance tests cho từng finding.
Đây là kiểm nhất quán tài liệu, không chứng minh implementation đạt; re-review head cuối trước mở code. M00/local/device chưa thực hiện; không merge/đóng module.

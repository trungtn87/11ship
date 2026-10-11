# M01.01 — bàn giao đóng phạm vi CONTRACT

Ngày 11/10/2026. Trạng thái READY_FOR_OWNER_CLOSE (CONTRACT); không phải M01 DONE/LOCK.
Nguồn: Owner yêu cầu review/tích hợp/chuẩn bị đóng qua “Ok tiếp” 11/10 11:13. Chưa ghi Owner quyết định LOCK; ủy quyền merge gói nhỏ không tự thay quyền đóng module/gói.

## Phạm vi đã hoàn thiện

- Claude preflight #52 head 537d0ebb7ea4d60434b156abc5411bcb39a87e00; CI run38103633924 success; merge 1c3b62261b3d4b146b3c592420217330232c1913.
- Schema/participants M01.02 #53 merged 88c3d3d39c96c78a79fa2823a7587eb216c81739; không thuộc nghiệm thu app trong gói CONTRACT.
- [Contract10](../design/system-v2-20261011/10-m01-client-contract.md): schema, backfill, grants, validation, register/events.
- [Contract11](../design/system-v2-20261011/11-m01-session-device-contract.md): login/me/context/capabilities, replay/revocation, logout, native binding và test boundary.
- Quyết định D02 Owner đã duyệt: một thiết bị, hai app đồng thời, mỗi app phiên riêng, thiết bị mới thu hồi phiên cũ. D03 runtime/build/cert là prerequisite native rollout.
- Review trước tích hợp sửa lifecycle key: UNIQUE chỉ link chưa detached, không chặn A→B→A. FK user_id và role CHECK giữ main thực, đã sửa contract10.
- Không mang các module thiết kế khác từ PR #48 vào lần tích hợp này.

## Gaps và gói nhận trách nhiệm

| Việc | Gói nhận | Gate |
|---|---|---|
| Nội dung/cặp consent test | .03 + Owner duyệt nội dung test trước acceptance | Không chặn đóng thiết kế CONTRACT; chặn code acceptance nếu chưa duyệt |
| Register atomic, proof, old/new race, token replay | .03 | contract10/11 + .02/.22 evidence |
| Login/me/context/logout/capability và context replay | .04 | exact schema và error rules contract11; integration hiện hành |
| Native binding/verifier/keys/DDL, legacy bypass, A→B→A | .21 và native M00/D03 | runtime/package/cert config + technical preflight/DDL review + phone |
| Runtime Android, ký APK/bridge/secure storage | M00 native/D03 | Không chặn local BE |
| Remote origin drift và deployed DB evidence | #49/operator | Không tự apply remote |
| SMS test inbox | .22 | revision USER/SMS test trên nhánh #48; chưa tự nhận đã code |
| Local/phone/Owner acceptance toàn nghiệp vụ | các gói UAT M01 | Actual chưa chạy; không kéo cả M01 LOCK |

## Kết luận review

PASS trong phạm vi thiết kế hợp đồng/handoff: phạm vi gói CONTRACT đã đủ đầu ra và phân công gaps. CODE_READY_LOCAL là conditional theo consent/dependency; không CODE_READY_NATIVE hoặc certification thiết bị từ bản thiết kế.
Bản tích hợp chỉ tài liệu; không product code, migration apply, deploy, sửa PROGRESS.md/plan.yml. CI của PR tài liệu chỉ kiểm nền không bị phá, không chứng minh behavior future.
Sau khi PR tích hợp merge, Owner có thể quyết định đóng M01.01 với wording: “Đóng M01.01 phạm vi CONTRACT/handoff, tiếp tục implementation/UAT theo gói; không đóng M01”. Chỉ ghi CLOSED khi có quyết định đó.

## Phân công/gate

ChatGPT thiết kế/review/integrate docs; Claude code/test từng gói; Owner UI/local/phone/accept/LOCK. Admin/Food khách/Food quán/Ship/liên thông đã được bao phủ trong contract. Local và phone chưa nghiệm thu; gói CONTRACT không chạy APK hoặc thay thế gate implementation. Không tuyên bố N/A cho các gate của toàn module.

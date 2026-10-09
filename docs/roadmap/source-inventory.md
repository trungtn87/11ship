# Kiểm kê nguồn trước roadmap

Kiểm ngày 09/10/2026 (Asia/Ho_Chi_Minh), repo trungtn87/11ship. Exact base `5ba378db163dbdd7895dce646345e0d06f3b4e4b`, tree `b77c941aeb7424d1a05b3f9429ce30125bec1524`. Recursive tree không có AGENTS.md; áp dụng README, docs/progress/README, ADR và task. Đọc repo qua GitHub connection theo exact ref; kiểm dashboard local. Không deploy/migrate/seed remote.

## Nguồn đã đọc

| Nguồn | Định danh | Vai trò và giới hạn |
|---|---|---|
| Main docs/current | ADR001/002/003, 4.1–4.3, preflight, brand tại exact base | Nền/auth và brand; trạng thái chữ cũ không override lifecycle GitHub |
| Schema/API main | Toàn bộ 8 migration SQL; auth/onboarding shop/driver/shop-management/health controllers | Có M00/Auth/shop/driver profile/business-hours vật lý; không full-project DDL/OpenAPI |
| Main tasks/evidence/runbooks | M00 B1/C1/D1, M01 A1/A2/R1, M02A; staging và restore guidance | CI/local khác remote/UAT; hướng dẫn tương lai không là restore PASS |
| Dashboard | plan.yml, resolver/collector/render/review-binding, toàn tests progress | Main có 14 leaf và chỉ M00/M01; thiếu M02 và D1 implementation pin; M01 100% backend chưa phải module complete |
| Library tổng hợp v1.1 | libfile_ff5b65b226908191ad015452d6ecc45a, đọc toàn 625 lines; [bản nguồn](references/library/baseline-v1.1.md) | 13 module §5; nghiệp vụ/schema/API logic, có proposal/conflict chưa chốt |
| Library checklist v1.0 | libfile_5bd582a584448191899eec175187c93b, đọc toàn | Checklist app/web/vận hành; không đếm mục checklist thành module |
| Library gọi ship v1 | libfile_fe70eb2971048191b949f4a3bcbfdcf7, đọc toàn | Lịch sử naming orders/deliveries; không handoff hiện hành |
| PR7 | 645a59b80e850893282a44c0dc3080014f09f6b1 | M03/M04 tìm thấy: ADR004, 51-case matrix, task split; Draft, chưa Owner locked/CODE_READY. Copy nguyên 3 file tại references/pr7, không nhập current ADR |
| PR14/20/23/24 | Exact heads trong bảng | Figma gate, kế hoạch song song, prototype/FE0; Owner yêu cầu mới thay Figma gate sớm và M02 code gate, không mất lịch sử |
| PR26/27 | Exact heads trong bảng | Design/code D2 tồn tại, Draft/CI xanh; chưa deploy/seed/Owner test |

Đã đọc PR bodies như nguồn lịch sử và kiểm lifecycle bằng API thực. Comments/reviews của #7/#18/#20/#21/#23/#24/#26/#27 trả rỗng; không dựng lời Owner duyệt từ PR title/body. Merged design được dashboard gọi DESIGN_LOCKED theo quy trình repo, khác với Owner nghiệm thu phần mềm.

## PR inventory tại thời điểm kiểm kê

| PR | Tiêu đề | Trạng thái API | CI Verify trên exact head | Exact head |
|---|---|---|---|---|
| [#1](https://github.com/trungtn87/11ship/pull/1) | Bước 5.1–5.2: kiểm tra repo, chốt nền và bàn giao M00-B1 | MERGED | NONE | `a07bbf7f534d09170e69ffe4888882f38d4d091d` |
| [#2](https://github.com/trungtn87/11ship/pull/2) | feat(m00-b1): backend foundation — F01–F09 verified PASS | MERGED | success | `55c5d81edd70502ccabecbe6871e663a1587f42e` |
| [#3](https://github.com/trungtn87/11ship/pull/3) | docs(m00-c1): transactional core design | MERGED | success | `de82b15e11604500aa620dc39445a30143c2fada` |
| [#4](https://github.com/trungtn87/11ship/pull/4) | M00-C1A0: transaction lifecycle and shared primitives | MERGED | success | `688e7968889cec0688d60905e0666d5f8ebb6801` |
| [#5](https://github.com/trungtn87/11ship/pull/5) | feat(m00-c1a1): idempotency executor, replay and cleanup | CLOSED_UNMERGED | success | `e1c67b114a14d9622a00402e998d7587a2191821` |
| [#6](https://github.com/trungtn87/11ship/pull/6) | M00-C1A1: Idempotency (draft) | MERGED | success | `44c0fa77a222ba8f15961e20b294c19b2c14e9d2` |
| [#7](https://github.com/trungtn87/11ship/pull/7) | docs(m03-m04): financial consistency, withdrawal reconciliation and safe closure | DRAFT | success | `645a59b80e850893282a44c0dc3080014f09f6b1` |
| [#8](https://github.com/trungtn87/11ship/pull/8) | chore(progress): GitHub-derived project progress dashboard | MERGED | success | `1ce1e508ef476861afd444059ae49d51a6748831` |
| [#9](https://github.com/trungtn87/11ship/pull/9) | M00-C1B: Audit + Outbox write primitives | MERGED | success | `b418fd2b9fc5d5ad0acb7b5bfbc5b574ad47f5d7` |
| [#10](https://github.com/trungtn87/11ship/pull/10) | feat(outbox): M00-C1C outbox dispatcher + final | MERGED | success | `172931bddab009865a89ecc976d1e69c0b6fce46` |
| [#11](https://github.com/trungtn87/11ship/pull/11) | docs(m01-a1): lock Auth Core implementation contract | MERGED | success | `a17935fbc63a66041e91ead50b7e9911ed316809` |
| [#12](https://github.com/trungtn87/11ship/pull/12) | feat(auth): M01-A1 Auth Core (READY CANDIDATE) | MERGED | success | `ef3afd483af7143b61ad5f6f6c3fbcf9a0e6ca4f` |
| [#13](https://github.com/trungtn87/11ship/pull/13) | chore(progress): Việt hóa dashboard tiến độ | MERGED | success | `25a62e9cc403fdbf2926b527a57b1ad62f8d703d` |
| [#14](https://github.com/trungtn87/11ship/pull/14) | docs(ui): add Figma workflow and frontend UI gate | OPEN | success | `0d16d7b25de129b38cef0741b4b4ee9682bdd698` |
| [#15](https://github.com/trungtn87/11ship/pull/15) | docs(m01-a2): lock onboarding contract and task split | MERGED | success | `c329808591969b5fdf61cce8ba2fdcbf8c4a9ce3` |
| [#16](https://github.com/trungtn87/11ship/pull/16) | feat(onboarding): M01-A2S shop onboarding | MERGED | success | `620333fc472912ca3acc184e73fad17e5ebb169e` |
| [#17](https://github.com/trungtn87/11ship/pull/17) | feat(m01-a2d): DRIVER onboarding (no Driver service area) | MERGED | success | `c37082add6fe651333f0acd535503ff465dd0700` |
| [#18](https://github.com/trungtn87/11ship/pull/18) | docs(m02-a): hồ sơ quán và tự động hoạt động theo giờ | MERGED | success | `207133b777e4aba17e5756f8ac7b03296a1b2c15` |
| [#19](https://github.com/trungtn87/11ship/pull/19) | docs(m00-m01): session authorization, bounded rollback, router and progress repairs | MERGED | success | `cd0e6dec9d97d3fc37e4ee6de0b0a1ed5011359f` |
| [#20](https://github.com/trungtn87/11ship/pull/20) | docs(plan): M00 local, M01 UI/test and M02 parallel delivery checklists | DRAFT | NONE | `78cb31984ba6c225a73185d3475ef43905e0e09a` |
| [#21](https://github.com/trungtn87/11ship/pull/21) | feat(shop): M02-A shop management backend (draft) | MERGED | success | `c7f0d5b31b0a9347ad6e584843843df696fed0ba` |
| [#22](https://github.com/trungtn87/11ship/pull/22) | design(M00-D): Render Free + Supabase staging | MERGED | success | `a846a68f75de0129b2eea6e50ea446bbf8983209` |
| [#23](https://github.com/trungtn87/11ship/pull/23) | design(M02-A-UI): shop profile and weekly schedule screens | DRAFT | success | `8a0bafebbbf4dc5a3b9817c4d0c9cc9304cb3c3b` |
| [#24](https://github.com/trungtn87/11ship/pull/24) | design(M01-FE0): responsive frontend foundation and session client | DRAFT | success | `ef297175004b0fa4b99413ccba52d8e40bf8764a` |
| [#25](https://github.com/trungtn87/11ship/pull/25) | feat(M00-D1): Render Free blueprint, strict Supabase TLS, remote migration path | MERGED | success | `44dbf10c6d7ef6ccc3f7eb812d6488a172c2fb65` |
| [#26](https://github.com/trungtn87/11ship/pull/26) | design(M00-D2): tài khoản staging chưa xác minh SĐT | DRAFT | success | `fe235cc15452bb2cee01526aa5b1af27e07b5f8b` |
| [#27](https://github.com/trungtn87/11ship/pull/27) | feat(M00-D2): staging accounts without SMS (fixture mode, seed command) | DRAFT | success | `c8b410ef7e8a96737e898f95d33d52a26c0a9681` |

Snapshot tái lập: tests/progress/fixtures/live-2026-10-09-roadmap.json lấy API thật, không là runtime chứng nhận mới. Main head qua 9 progress-bot commit chỉ đổi PROGRESS.md xuống CI code SHA `75760bdfe42381dc1fd17f5cc7a9c79682d7f2ad`; đã kiểm author/committer, parent, files từng commit; Verify success. Dashboard collector vẫn dùng exact-head chain, không dùng CI của commit cũ tùy tiện.

## Trạng thái theo phần

| Module/gói | Thiết kế | Code/CI | Deploy | Owner nghiệm thu |
|---|---|---|---|---|
| M00 B1/C1 | Design merged, ADR003 Owner lock ghi trong nguồn | Code merged; Verify xanh ở exact PR heads | Chưa có evidence triển khai | Chưa full-module |
| M00-D1 | #22 merged | #25 merged/Verify success | Chỉ blueprint/TLS/migration command, chưa remote | Chưa |
| M00-D2 | #26 Draft | #27 Draft/Verify success c8b410ef… | Chưa seed/migrate/deploy remote | Chưa |
| M01 A1/A2/R1 | #11/#15/#19 merged | #12/#16/#17/#19 merge/Verify success | Không bản app test evidence | Chưa A1/A2 UAT |
| M02-A | #18 merged | #21 merged/Verify success c7f0d5b… | Không evidence bản dùng thử | UI #23 Draft, chưa UAT |
| M03/M04 | PR7 outline/design patch tìm thấy, chưa khóa | Chưa code/migration | Chưa | Chưa |
| M05–M12 | Khung từ baseline 4.1/v1.1 | Chưa contract slice/code (ngoài phần dashboard nền) | Chưa | Chưa |

## Giữ mã và giải quyết xung đột danh mục

M00–M12 đã có trong 4.1 và baseline, giữ đủ 13 module. B1/C1/Auth/A2/R1/D1–D5 và PR pins trên main giữ nguyên. M00-LOCAL, M01-UI/B/C/D, M02-A-BE/UI/E2E/UAT, M02-B và M00-OPS từ PR20 cũng giữ ID, bổ sung vào plan mới. Không đóng/sửa PR lịch sử trong tác vụ này.

PR20 có 42 task lá, không 42 module. Nó đặt menu dưới M02-B trái ownership M09 của baseline; giữ ID task M02-B-* nhưng module owner M09, ánh xạ concept M09-A vào chúng. Baseline từng dùng M02-B cho business-hours, nhưng contract mới #18/#21 gộp lịch vào M02-A; không cấp lại mã M02-B cho lịch hoặc tạo owner menu thứ hai. M04-A là concept group của A1/A2; M04-C là concept C1/C2; M03-B concept B1/B2, không tạo duplicate implementations. New IDs đã so với main, PR20, PR7 và danh sách branch; không có branch design/project-roadmap trước khi tạo.

## Thiếu nguồn và mâu thuẫn chưa giải quyết

- Không có DDL/OpenAPI vật lý full-project, contract CODE_READY M03/M04 hay module M05–M12; chỉ khung/patch. Cần viết mới theo từng slice, không gọi là đã chốt.
- Không có evidence remote Render/Supabase, app M01 PC/4G, Owner UAT, restore/failover/load hoặc production. Không suy từ render.yaml/CI/runbook.
- Asset logo/font chuẩn chưa có byte trong repo. Ba ảnh 1000002801(1).jpg, 1000002790.jpg, 1000002796.jpg: đường dẫn scratch được cung cấp không tồn tại; không inspect được. Không đọc ảnh đó bằng Library theo chỉ dẫn attachment; không dùng ảnh chưa thấy để chốt nhận diện.
- Provider SMS/map/push, vùng pilot thật, thiết bị iOS, signing/domain, thông tin ngân hàng và RPO/RTO/load/ngân sách dự phòng chưa có nguồn được xác minh.
- Các xung đột khách hủy, quán switch, GPS/retention/reminder, phí mốc5km, one-device và package Shop/Xế được ghi trong owner-decisions.md. Memory chỉ là chỉ dấu cần đối chiếu, không âm thầm override repo contract.
- README main nói repair Draft và chưa Wallet/Delivery/frontend, dashboard main bỏ sót #21/#25. Roadmap sửa phần mô tả tiến độ và pin, bảo toàn evidence cũ và fixtures lịch sử.

roadmap_complete vẫn false; coverage đã kiểm kê nhưng chưa Owner chốt proposal và nguồn mâu thuẫn.


## Bot dashboard và base PR

Trong lúc mở #28, main có các commit github-actions[bot] chỉ sửa docs/PROGRESS.md để ghi head/check PR mới. Roadmap giữ nguyên file live do bot quản lý; bản dashboard sinh từ fixture được lưu riêng docs/ROADMAP-PROGRESS-PREVIEW.md. Manifest/resolver mới có hiệu lực trong preview CI và sau merge, không sửa trạng thái DONE bằng tay. Inventory vẫn gắn baseline đã ghi ở đầu tài liệu; cập nhật bot không bổ sung code nghiệp vụ.

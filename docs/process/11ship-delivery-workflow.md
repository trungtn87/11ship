# Quy trình triển khai và quyền hạn 11Ship

Cập nhật: 12/10/2026, Asia/Saigon.
Nguồn: Owner yêu cầu kiểm tra việc test lặp lại và “cập nhật lại quy trình” sau khi thống nhất rút gọn trong cuộc trao đổi ngày 12/10/2026.

Quy trình này thay thế các yêu cầu quy trình xung đột trong bản 09/10, bổ sung 11/10 và các task/gói giao việc cũ. Giữ nguyên nghiệp vụ, schema, API và bằng chứng lịch sử. Không cần sửa đồng loạt mọi task cũ để bắt đầu áp dụng.

## Phân công và luồng làm việc

| Bước | Người thực hiện | Điều kiện hoàn tất |
|---|---|---|
| Chốt phạm vi/nghiệp vụ/UI | ChatGPT thiết kế, Owner duyệt | Phạm vi và hành vi rõ; dùng lại thiết kế đã duyệt |
| Triển khai và kiểm tra | Claude | Code đúng phạm vi, kiểm tra phù hợp phần bị ảnh hưởng |
| Review | ChatGPT | Review diff, dùng bằng chứng hiện có; hết blocker |
| Tích hợp | ChatGPT theo ủy quyền Owner | Checks bắt buộc áp dụng đạt, dependency tương thích, merge sạch |
| Thử bản chạy | Claude chuẩn bị, Owner thử | Bản chạy và hướng dẫn phù hợp giai đoạn |
| Nghiệm thu module/phát hành | Owner | Các app/luồng liên quan được nghiệm thu; Owner quyết định đóng |

ChatGPT được sửa tài liệu, đọc code và chạy kiểm tra để review. ChatGPT không tự sửa code sản phẩm, test triển khai, migration, cấu hình build/deploy hoặc build triển khai thay Claude, trừ ngoại lệ cụ thể do Owner chỉ đạo. Claude không tự đổi nghiệp vụ/UI đã duyệt; tự quyết lựa chọn kỹ thuật thông thường trong phạm vi.

Chỉ duyệt lại thiết kế khi thay đổi hành vi/nghiệp vụ/UI đã chốt. Sửa lỗi để đáp ứng thiết kế hiện có không cần mở lại toàn bộ vòng thiết kế.

## Hai mức checklist

- Task nhỏ: phạm vi, phần ảnh hưởng, code SHA, kiểm tra phù hợp, review/blocker và bản chạy khi cần. Không mang đủ ma trận nghiệm thu module.
- Module/phát hành: tổng hợp một lần thiết kế, local, thiết bị thật và liên thông cho các app thực sự liên quan. Backend-only task không tự đóng module nghiệp vụ.
- N/A ghi lý do; người giao task/review xác định theo phạm vi, không xin Owner duyệt riêng từng N/A. Nếu việc bỏ một gate làm thay đổi phạm vi nghiệm thu đã chốt thì cần Owner quyết định.
- Dùng [mẫu checklist](../templates/module-delivery-checklist.md); bằng chứng liên kết lại, không chép lặp nhiều tài liệu.

## Chọn kiểm tra theo thay đổi

| Thay đổi | Kiểm tra phù hợp |
|---|---|
| Tài liệu thuần túy | Review nội dung, link và tính nhất quán; không yêu cầu test sản phẩm |
| UI nhỏ, không đổi logic | Build/typecheck phần liên quan và kiểm tra màn hình/luồng đã sửa |
| Logic nghiệp vụ/API | Test ca đã đổi/lỗi vừa sửa, các luồng liên quan; integration khi có tác động liên thông |
| Quyền, OTP, tiền, migration, quản lý process | Test kỹ rủi ro cụ thể, tích hợp và nền tảng chịu ảnh hưởng; hồi quy rộng khi tác động dùng chung |
| Nghiệm thu module/phát hành | Hồi quy đầy đủ trong phạm vi phát hành và thử thiết bị thật liên quan |

Không viết test chỉ để lặp lại cấu trúc implementation hoặc tăng số lượng bằng chứng. Giữ coverage có giá trị cho hành vi, lỗi thật và rủi ro.

## Không test lặp và điều kiện dừng

1. Claude chạy focused tests trong khi sửa; gom thành một gói nhất quán trước khi push. CI phù hợp trên code cuối là gate tích hợp. Không mặc định bắt chạy full suite local, CI, rồi ChatGPT chạy lại cùng suite.
2. ChatGPT đọc diff và dùng kết quả Claude/CI còn hiệu lực. Chạy thêm phải nêu trước: rủi ro/ca còn thiếu, lý do bằng chứng hiện có chưa đủ và kiểm tra sẽ giải quyết điều gì.
3. Chỉ test lại khi có thay đổi liên quan, lỗi mới, môi trường/nền tảng khác cần kiểm chứng, hoặc nghi vấn cụ thể chưa giải quyết. Sau fix, ưu tiên ca lỗi và phần ảnh hưởng; full suite chỉ khi tác động rộng hoặc checks bắt buộc yêu cầu.
4. Không push commit cố tình làm CI đỏ chỉ để lấy bằng chứng RED. Khi khả thi, chứng minh test hồi quy bắt được lỗi cũ bằng focused test local; thiếu môi trường thì ghi rõ và kiểm chứng bản sửa bằng CI phù hợp.
5. CI lỗi hạ tầng/flaky: xác định nguyên nhân và retry job lỗi khi phù hợp. Không chạy lặp đến xanh rồi bỏ qua nguyên nhân.
6. Chỉ đổi tài liệu không làm mất hiệu lực test của code không đổi. Ghi code SHA đã test và SHA tài liệu cuối nếu khác; không đòi full test chỉ vì SHA tài liệu đổi. Vẫn phải đáp ứng checks mà GitHub đang bắt buộc.
7. Khi kiểm tra phù hợp đạt, review hết blocker và có đầu ra yêu cầu thì chuyển bước. Không bổ sung gate/bằng chứng chỉ để “chắc hơn” nếu không có lý do cụ thể.

## Review và finding

ChatGPT gom finding trong một lượt review; sau sửa review delta và phần liên quan. Finding mới ở lượt sau phải nêu lỗi mới phát hiện hoặc phát sinh từ sửa đổi.

Blocker: lỗi chức năng/nghiệp vụ, an toàn dữ liệu, bảo mật, contract bắt buộc, hoặc thiếu kiểm chứng khiến chưa đánh giá được một rủi ro trọng yếu. Góp ý cách trình bày, tổ chức code/tài liệu và cải tiến ngoài phạm vi ghi riêng, không bắt sửa trước merge nếu không gây lỗi.

Không gộp kết quả test local/thiết bị thật của Owner vào CI. Báo cáo ngắn: thay đổi, code SHA, checks/kết quả/link, lỗi còn mở và cách chạy bản test. Không bắt tạo riêng nhiều báo cáo có cùng nội dung.

## Merge, local, thiết bị thật và đóng module

Ủy quyền Owner ngày 11/10/2026 (“Mình muốn xong mỗi module nhỏ merge luôn vào main”) tiếp tục hiệu lực: ChatGPT merge từng gói đã review, không blocker, checks bắt buộc áp dụng đạt, dependency tương thích và merge sạch; không hỏi lại từng gói, không bật auto-merge thay review.

Merge là tích hợp mã nguồn, không phải Owner đã nghiệm thu local/điện thoại hoặc module đã đóng. Không suy quyền deploy/apply migration remote từ quyền merge. CI đỏ bắt buộc chưa giải quyết thì không merge.

Owner thử local trước nghiệm thu thiết bị thật. Gom bản chạy theo tính năng/đợt phù hợp; không bắt Owner thử đủ mọi app sau từng sửa nhỏ. Lỗi mới chỉ yêu cầu thử lại phần ảnh hưởng; thay đổi native cần build/cài APK lại, đổi backend hoặc tài liệu không mặc định cần cài lại APK.

Bản trình duyệt/mock không thay thế Android runtime. Ghi giới hạn thực tế và phần chưa kiểm chứng. Tách DB Owner test khỏi DB integration có thể bị reset; không chạy suite phá dữ liệu vào DB Owner test/staging.

Nghiệm thu module ghi version/code SHA, app/luồng, môi trường, kết quả, người test/ngày và quyết định Owner. Bằng chứng cũ dùng cho phần không đổi sau khi đánh giá tác động; không mặc nhiên nghiệm thu phần đã đổi. Owner quyết định đóng/LOCK module.

## CI hiện có và gói tối ưu giao Claude

Tài liệu này không tự sửa cấu hình CI hay bỏ required checks hiện hữu. Claude thực hiện tối ưu CI thành gói riêng:

- Tách kiểm tra theo phần/nền tảng bị ảnh hưởng khi dependency cho phép; giữ hồi quy rộng cho code dùng chung và phát hành.
- Một lượt integration đầy đủ; kiểm tra riêng phần khác biệt local-mode/CI-mode thay vì chạy lại toàn suite. Giữ coverage của guard, credential isolation, wrong-user và remote-migration fixtures.
- Giữ PS5.1/PS7 cho thay đổi launcher/Windows hoặc dependency liên quan; không bỏ coverage nền tảng cần thiết.
- Tài liệu thuần túy dùng kiểm tra tài liệu phù hợp. Xác minh required-check/branch-protection tương thích trước đổi routing; không làm check bắt buộc treo vì job bị bỏ.
- Acceptance: chứng minh coverage hiện có còn được thực thi ở phạm vi thích hợp, job cần thiết được chọn đúng và giảm chạy trùng. Không yêu cầu full-CI RED commit.

Trong khi chưa cập nhật CI, các job hiện hữu vẫn tự chạy; không yêu cầu Claude chạy thêm bản sao thủ công.

## Trạng thái và lịch sử

Phân biệt code/CI/review/merge với local/thiết bị thật/nghiệm thu/đóng module. Dashboard DONE kỹ thuật không chứng minh module đóng. Không sửa tay docs/PROGRESS.md hay thêm field parser chưa hỗ trợ vào plan.yml.

Quy tắc M00 môi trường Owner test, M01 auth/account/onboarding và M02 hồ sơ/giờ hoạt động vẫn theo phạm vi đã chốt. Không dùng UI giả để báo backend thật đã đạt. PR #31 trước phân công 09/10 vẫn cần xử lý theo bằng chứng và quyết định riêng, không đổi tác giả lịch sử. PR #53 là gói đầu tiên theo ủy quyền merge 11/10; không viết lại thành nghiệm thu cả M01.

## M01 — điều chỉnh Owner ngày 12/10/2026: chia theo luồng, review cuối module

Áp dụng [kế hoạch M01 theo luồng](../current/M01-workstreams-20261012.md). Đây là chỉ đạo mới hơn, ưu tiên hơn yêu cầu review tìm lỗi độc lập từng gói ở các mục trên và handoff cũ.

- Tách tài liệu UI khỏi nghiệp vụ; mỗi luồng chỉ tham chiếu đúng tài liệu/mục và điểm vào code. Ghi đã có/còn thiếu, dùng lại bằng chứng; không kiểm kê toàn module mỗi lần giao việc.
- Trong lúc làm, Claude kiểm tra phần vừa làm chạy được và sửa lỗi quan sát được. Trước merge kiểm phạm vi/dependency, lỗi đã biết và checks bắt buộc; không tổ chức audit tìm lỗi sâu cho từng gói nhỏ.
- Sau khi M01 triển khai và nối xong, thực hiện một đợt review tìm lỗi toàn module và kiểm tra liên thông. Gom một danh sách finding và một báo cáo nghiệm thu; sau fix chỉ review delta/kiểm lại phần ảnh hưởng.
- Không yêu cầu full suite local + CI + ChatGPT lặp cùng nội dung. Checks CI hiện hữu vẫn áp dụng, chưa thay cấu hình bằng tài liệu này. Không hoãn sửa lỗi đã biết đến cuối và không suy ra module đóng nếu còn blocker hoặc thiếu nghiệm thu Owner.

## QUY TẮC ƯU TIÊN — Owner chốt ngày 14/10/2026: giao kết quả, AI chịu trách nhiệm quá trình

Quy tắc này **ưu tiên khi xung đột với bất kỳ quy trình review, bàn giao, checklist hoặc task cũ nào**; áp dụng xuyên suốt M00–M12 và các module phát sinh. Mục tiêu là **chức năng thực sự chạy được** chứ không phải số PR, vòng review, báo cáo hay số bài test.

1. **Owner chốt nghiệp vụ/UI và nghiệm thu kết quả.** Owner chỉ cần nhìn bản web/app/APK/backend hoạt động, thử các thao tác nghiệp vụ chính và phản hồi lỗi nhìn thấy. Không biến Owner thành người chạy SSH/SQL, CI, backup, giải quyết Git hay cấu hình môi trường. Chỉ nhờ thao tác kỹ thuật trên thiết bị/tài khoản riêng khi không thể tự thực hiện bằng công cụ được cấp quyền, và giải thích ngắn gọn lý do.
2. **ChatGPT chủ trì đầu-cuối:** nắm trạng thái GitHub/main, thiết kế phạm vi, giao một nhiệm vụ rõ với đầu ra dùng được; điều phối Claude/Codex, xử lý lệch phụ thuộc và chặn việc lặp; tổng hợp kết quả thành đường link bản test hoặc phiên bản đã triển khai. Không đẩy trách nhiệm điều phối ngược về Owner. Claude là người triển khai chính; Codex chỉ nhận phần việc độc lập có ranh giới rõ hoặc lỗi đã định danh. Một nhánh/PR chỉ có một AI chủ trì.
3. **Một luồng thực thi:** chốt → AI triển khai đủ database/API/web/mobile và kết nối liên thông → tự sửa lỗi, chạy kiểm tra cần thiết và CI → tích hợp main, chuẩn bị/phát hành bản chạy theo quyền đã cấp → Owner nghiệm thu → LOCK. Không mở lại thiết kế, audit/review toàn module hoặc tạo PR chồng chéo chỉ vì một lỗi nhỏ. Sửa lỗi thì kiểm lại đúng ca lỗi và phần ảnh hưởng; tận dụng bằng chứng còn giá trị.
4. **Báo cáo đúng trạng thái:** phân biệt `đã code`, `CI đạt`, `đã merge main`, `đã deploy`, `đã kiểm trên thiết bị thật`, `Owner nghiệm thu`. Không nói hoàn thành khi tính năng vẫn chỉ nằm trên PR, APK không kết nối được backend, hoặc mới chạy mock. Mọi bàn giao phải có đích kết nối, phiên bản/SHA và đầu ra có thể sử dụng.
5. **Module độc lập triển khai song song** khi dependency cho phép; không để M01 giữ chân M02/M03 hoặc các phần M04–M12 không phụ thuộc. Module đã LOCK không bị tái kiểm tra toàn phần khi thay đổi nơi khác; chỉ mở lại khi lỗi liên quan hoặc Owner yêu cầu mới.
6. **Chỉ hỏi Owner quyết định thực sự:** nghiệp vụ/UI chưa chốt hoặc thay đổi hành vi; chi phí, chính sách, an toàn dữ liệu, quyền/bảo mật; phát hành production, migration remote, gửi SMS thật hoặc hành động khó hoàn tác chưa được ủy quyền; thao tác riêng Owner buộc phải làm. Hỏi một lần, có đề xuất mặc định và ảnh hưởng, không xin xác nhận từng bước kỹ thuật thường ngày.
7. **An toàn theo rủi ro, không theo nghi thức:** kiểm tra phù hợp phần ảnh hưởng; chỉ sao lưu khi có thay đổi dữ liệu/migration có rủi ro và dùng bản sao lưu đủ hiệu lực, không yêu cầu Owner sao lưu đi sao lưu lại. Những thay đổi tiền, tài khoản, OTP, bảo mật hoặc schema phải có các kiểm tra trọng yếu và phương án khôi phục, nhưng không mở vòng review vô hạn. Hành động deploy/migration remote vẫn cần thẩm quyền/ủy quyền phù hợp — không suy từ quyền merge.
8. **Điểm dừng là kết quả có thể nghiệm thu:** khi đủ điều kiện kỹ thuật, dừng lặp test/review và bàn giao bản hoạt động. Owner chỉ nhận thông báo ngắn gồm: chức năng đã chạy, đường dẫn APK/web, nơi hoạt động, và đúng những quyết định hoặc thử nghiệm còn cần Owner.

Đặc biệt với **M01**, mục tiêu trước mắt là hai app kết nối thật VPS, đăng ký qua OTP, đăng nhập SĐT + mật khẩu, đăng xuất, đặt lại mật khẩu và dữ liệu tài khoản/phiên lưu đúng PostgreSQL. Không nâng mức độ hoàn thành chỉ nhờ CI xanh, backup đã tạo hoặc có APK không thể kết nối. Các chức năng khác của M01 đã chốt trước đây vẫn được giữ nguyên, không xóa khỏi phạm vi dự án.

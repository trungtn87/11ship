# Bảng module và dependency

Nguồn module: baseline tổng hợp v1.1 §5 và manifest 4.1. Không cấp module mới. Giữ task lịch sử và ánh xạ ownership công khai.

| Module | Phạm vi | Task lá | Độ lớn | Dependency / thứ tự |
|---|---|---|---|---|
| [M00](modules/M00.md) | Nền tảng | 22 | L | M00-C1C → D1 → D2/D3 → D4 → app chẩn đoán/E2E → D5; native clients sau các luồng nghiệp vụ. |
| [M01](modules/M01.md) | Tài khoản và quyền | 23 | L | R1 + D4 + FE0 + API vùng tối thiểu → UI → E2E → M01-UAT; B/D-UAT phải đủ trước M01-UAT; C-SMS chờ Figma-UAT. |
| [M02](modules/M02.md) | Vùng và quán | 9 | M | Backend #21 giữ lịch sử; code mới M02-A-UI chờ M01-UAT; M02-AREA-READ là prerequisite giới hạn cho M01. |
| [M03](modules/M03.md) | Hồ sơ và vòng đời xế | 9 | L | M03-A identity/bank → M04 primitives → M03-B1; M03-B2 chờ M04-C2 + M07-C; M07 chỉ dùng identity ports, không phụ thuộc toàn M03-UAT. |
| [M04](modules/M04.md) | Ví, nạp, rút và đối soát | 9 | L | M03-A → A1 → A2 → B/C1 → C2; quyền M01-D trước API tiền; production commission FK/integration chờ M07. |
| [M05](modules/M05.md) | Khách và địa chỉ | 4 | M | M01-UAT → M05-A → APP/E2E/UAT; M10-A dùng participant M05 cùng transaction. |
| [M06](modules/M06.md) | Phí, tuyến và điều kiện nhận | 5 | L | M02 quán + M03-B1 + M04 hold + M08-A location → A/B; M07 nhận gọi validate không network trong lock. |
| [M07](modules/M07.md) | Delivery và tìm xế | 6 | L | M06 + M03-B1 + M04 primitives/money UAT → A → B → C; M10 adapter về sau; closure M03-B2 đi sau C. |
| [M08](modules/M08.md) | GPS và thông báo | 6 | L | A ingress/binding cho M06; B tracking/reminders sau M07 + worker; hoàn thiện resource adapters M10 khi Order tồn tại. |
| [M09](modules/M09.md) | Thực đơn | 4 | M | M02-A-UAT + M00-UPLOAD → M02-B-BE/ UI/E2E/UAT (giữ ID); mapping M09-A concept sang các task này. |
| [M10](modules/M10.md) | Order khách | 6 | L | M05 + M09 menu → A → B → C nối M07; không M07→wholeM10 vòng. |
| [M11](modules/M11.md) | Đánh giá và phản ánh | 5 | M | M07/M10 terminal + M04 correction ports → A/B → APP/E2E/UAT. |
| [M12](modules/M12.md) | Quản trị và vận hành | 13 | L | M01-D quyền + domain ports → A/B; UI cuối → SMS thật → hệ thống/field → security/money → restore → load → release-UAT → M00-OPS-RELEASE. |

**13 module chính, 121 task lá, 13 group: 134 node manifest.** Task design review nằm trong lifecycle riêng của từng leaf/group; không đếm số PR, case nghiệm thu hoặc order hiển thị thành module. 42 ở PR20 là task lá của kế hoạch M00–M02 cũ. Các số ở đây là phạm vi kế hoạch đề xuất, có thể chia nhỏ sau khi khóa contract; roadmap_complete vẫn false.

M03/M04 không có vòng: identity M03-A → wallet M04 → activation M03-B1; closure M03-B2 chỉ mở khi M07 custody guard có thật. M07 dùng adapter M10 về sau nên luồng quán gọi ngoài app không chờ khách order. M08-A cung cấp location cho M06; M08-B nối tracking sau M07.

# ADR-001 — Nền backend 11Ship

Ngày: 06/10/2026, giờ Việt Nam. Trạng thái: ACCEPTED DESIGN.
Phạm vi: lựa chọn kỹ thuật để giao M00-B1; không phải chứng nhận phần mềm chạy thành công.

## Quyết định

| Thành phần | Lựa chọn | Lý do cho 11Ship |
|---|---|---|
| Kiến trúc | Một backend chia module, một PostgreSQL | Giữ các thay đổi đơn/ví/assignment trong cùng transaction |
| Runtime | Node.js 24 LTS; mục tiêu 24.21.0 | Dùng cùng runtime ở dev và CI |
| Framework | NestJS 11, Express adapter | Kế thừa thiết kế 4.1, controller/service/module rõ ràng |
| Ngôn ngữ | TypeScript 5, strict; biên dịch CommonJS bằng tsc | Giữ decorator metadata của Nest và bước typecheck rõ ràng |
| Query | node-postgres, package pg 8; SQL tham số hóa | Kiểm soát câu SQL, constraint, transaction và khóa hàng |
| Database | PostgreSQL 17; mục tiêu bản minor 17.11 | Giữ một major thống nhất trong dev/test/pilot |
| Migration | node-pg-migrate 8; migration SQL up/down | Không tạo migration runner riêng; không ORM auto-sync |
| Package manager | npm 11; một package-lock.json tại root | npm workspaces cho apps/backend; dùng npm ci khi đã có lockfile |
| Test | Jest 30 + @nestjs/testing 11 + PostgreSQL thật | Test HTTP/transaction; không giả lập toàn bộ DB |
| Test compilation | tsc → thư mục tạm .test-dist → Jest chạy JavaScript | Không cần ts-jest; test cũng được typecheck |
| Lint | ESLint 9 + typescript-eslint 8 | Flat config, không tự sửa file khi CI chạy |
| CI | GitHub Actions trên Linux, PostgreSQL service | Thực chạy lint/typecheck/build/migration/test mỗi PR code |
| DEV database | Docker Compose; test database riêng | Owner chưa cần mua server để thiết kế hoặc bắt đầu code |

Không thêm Redis, message broker, microservices hoặc ORM vào M00-B1. Outbox worker thuộc M00-C; app Flutter và web React giữ định hướng 4.1 nhưng chưa dựng ở gói này.

## Quy tắc khóa phiên bản

Các major ở trên là quyết định của thiết kế. Claude được phép giải quyết và khóa bản patch/minor ổn định trong đúng major đã chọn; đây là công việc của M00-B1, không phải blocker cần hỏi lại Owner. Không dùng prerelease, latest trong manifest bàn giao, --force hoặc --legacy-peer-deps để che xung đột.

- Ghi chính xác dependency trực tiếp trong package.json và commit lockfile thật do npm tạo.
- Các package @nestjs/common, core, platform-express, testing dùng cùng phiên bản.
- Ghi runtime cụ thể vào .node-version, packageManager npm phiên bản cụ thể và CI setup tương ứng.
- Image PostgreSQL cần tag cụ thể đã pull được; ghi digest thực vào evidence, không bịa digest.
- Nếu bản mục tiêu không tải được, phân biệt hạn chế mạng với phiên bản không tồn tại. Chỉ thay patch trong cùng major khi có metadata chính thức và kiểm tương thích; ghi thay đổi trong evidence.
- Đổi major/query stack/token architecture phải có ADR sửa đổi. Không tự đổi Nest 11 sang Nest 12.

## Ranh giới dữ liệu

Repository mỗi module sở hữu câu SQL của bảng module đó. Controller không gọi pg trực tiếp. Giá trị từ client phải truyền qua parameters; tên bảng/cột động chỉ chọn từ whitelist nội bộ.

M00-B1 chỉ thiết lập Pool lifecycle và đường kiểm kết nối. Transaction commit/rollback smoke test dùng một PoolClient duy nhất. M00-C mới chuẩn hóa transaction context dùng chung giữa module; không để service tự mở transaction lồng độc lập.

Migration được chạy bằng tài khoản migration và lệnh riêng, không tự chạy khi server khởi động. M00-B1 không tạo bảng user/shop/driver/wallet. Có thể có bảng lịch sử migration của công cụ; smoke test dùng bảng tạm cùng connection, không đưa bảng giả nghiệp vụ vào schema chuẩn.

## Kiểm tra nguồn và giới hạn

Đã đối chiếu tài liệu chính thức ngày 06/10/2026:

- [Node.js releases](https://nodejs.org/en/about/previous-releases) và [24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0): chọn nhánh 24 LTS.
- [NestJS 11 first steps](https://docs.nestjs.com/v11/first-steps): yêu cầu Node >=20, Express là adapter mặc định.
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/): PostgreSQL 17 còn hỗ trợ; bảng nguồn lúc đọc ghi minor 17.11.
- [pg transactions](https://node-postgres.com/features/transactions): transaction phải dùng cùng client, không dùng pool.query cho từng câu của transaction.
- [node-pg-migrate](https://salsita.github.io/node-pg-migrate/getting-started): công cụ migration chuyên PostgreSQL. Tài liệu live có thể thuộc major mới; kiểm engines của package 8 khi khóa dependency.
- [Jest getting started](https://jestjs.io/docs/getting-started): typecheck TypeScript cần bước compiler riêng nếu pipeline chỉ transpile.

Nguồn chứng minh lựa chọn có cơ sở; không thay thế integration test. Môi trường kiểm tra hiện tại có Node 24.19.0/npm 11.9.0, không tìm thấy docker/psql trong PATH. Chưa cài ứng dụng, chưa build, chưa chạy PostgreSQL, chưa có lockfile ứng dụng.

## Phiên bản ứng viên đã truy vấn thực tế

Đã chạy npm view và ghi nguyên metadata trong docs/evidence/M00-B1-dependency-metadata.json. Chọn các phiên bản sau làm đầu vào cài đặt đầu tiên; không gọi đây là lockfile hay kết quả build.

| Package | Phiên bản |
|---|---|
| @nestjs/core@11 | 11.2.7 |
| @nestjs/common@11 | 11.2.7 |
| @nestjs/platform-express@11 | 11.2.7 |
| @nestjs/testing@11 | 11.2.7 |
| typescript@5 | 5.9.3 |
| pg@8 | 8.23.1 |
| node-pg-migrate@8 | 8.0.4 |
| jest@30 | 30.5.2 |
| reflect-metadata@0.2 | 0.2.2 |
| rxjs@7 | 7.8.2 |
| eslint@9 | 9.39.5 |
| typescript-eslint@8 | 8.71.1 |
| @types/node@24 | 24.19.1 |
| @types/pg@8 | 8.23.1 |
| argon2@0.44 | 0.44.0 |

Argon2 chỉ dành cho A1, không cài trong B1. Engines đã đọc của Nest, pg, migration, Jest, TypeScript và lint chấp nhận Node 24; peer ranges chính của Nest 11/pg 8/TypeScript 5/ESLint 9 khớp lựa chọn. Optional peers không bắt buộc cài khi không dùng tính năng đó. npm ci/build mới xác minh được toàn bộ dependency tree thực tế. @jest/globals phải cùng phiên bản Jest khi khóa manifest.

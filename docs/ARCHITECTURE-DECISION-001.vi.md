# Quyết định 001: nền tảng đa kênh và đường nâng cấp online

Ngày 09/10/2026. Phạm vi hiện tại: bản thử offline, dữ liệu giả. Đây là quyết định kiến trúc và lộ trình; chưa triển khai đăng nhập, server, đồng bộ hay dịch vụ trả phí.

## Quyết định

Tiếp tục **web UI + Capacitor** cho CashWeave. Giữ lõi nghiệp vụ tiền độc lập với giao diện, runtime native và nhà cung cấp backend. Một nền tảng UI có thể phục vụ web/PWA, Android và iOS; chức năng đặc thù thiết bị dùng adapter/plugin native. Tài liệu Capacitor mô tả các đích Android/iOS/web và API plugin Swift/Java/JavaScript. Đây là cơ sở để chọn runtime, không phải bằng chứng rằng bản CashWeave hiện tại đã chạy trên cả ba nền tảng. [Nguồn chính thức](https://capacitorjs.com/docs), [API theo nền tảng](https://capacitorjs.com/docs/core-apis).

Chưa có lý do từ sản phẩm hoặc đo hiệu năng buộc phải viết lại toàn bộ bằng React Native/Kotlin. Capacitor có thể giữ nguyên khi UI chuyển dần sang các component có kiểu dữ liệu và quy trình kiểm thử tốt hơn. Nếu sau này có yêu cầu native hoặc hiệu năng không đạt qua benchmark, thay adapter/màn cụ thể trước khi cân nhắc đổi toàn bộ runtime.

## Nền tảng thật đang có trong source

- core/money.js dùng số tiền nguyên đơn vị nhỏ nhất và tiền tệ rõ ràng; commands/model/reports tách khỏi DOM.
- createNextApp có điểm tiêm repositoryFactory; đã có hai implementation bộ nhớ và IndexedDB. Lần này onDownload/onReadBackup tách thao tác tệp native khỏi logic khôi phục.
- Lệnh có commandId, payload hash, receipt và expectedRevision để chống ghi trùng và ghi đè phiên bản cũ trong một kho cục bộ. Đây là nền tảng hữu ích cho contract phía server, chưa phải giao thức sync nhiều máy.
- Migration/restore có kiểm tra, staging, xác nhận và giữ bản cũ để rollback.
- backend/command-service.js chỉ là hợp đồng thử cho mô hình sổ chung: yêu cầu authenticate, transaction repository và server clock. Test đang dùng fake auth/bộ nhớ. Không có backend production đang hoạt động.

## Điểm cần sửa trước khi sản phẩm lớn hơn

1. **UI và application service:** ui/app.js vẫn là controller/render lớn và tự nhập implementation IndexedDB mặc định. Tách theo feature (ledger, plans, allocation, data), đưa command orchestration vào application service, và đặt chọn adapter ở composition root. Không để mỗi màn tự gọi HTTP/SQL hoặc tự tính lại quy tắc tiền.
2. **Persistence:** repository hiện đọc/clone/validate toàn snapshot; mỗi lệnh ghi lại snapshot lớn. Report quét nhiều mảng và phân trang kết quả sau tính toán. Cách này thuận tiện cho bản thử, không chứng minh được hiệu năng với sổ lớn. Đo 10k/100k giao dịch, bộ nhớ, thời gian mở/sửa/báo cáo; sau đó chuyển sang dữ liệu chuẩn hóa, chỉ mục, projection/cache có revision và query phân trang.
3. **Dữ liệu native:** IndexedDB hiện chỉ là lựa chọn thử. Đánh giá SQLite transactional trên Android/iOS qua adapter cùng contract nếu khối lượng/độ bền đòi hỏi. Không dùng Preferences làm database giao dịch; tài liệu chính thức giới hạn Preferences cho dữ liệu nhẹ và gợi ý SQLite khi cần query/phát sinh ghi đọc lớn. Chưa chọn hoặc cài dịch vụ storage trả phí. [Nguồn](https://capacitorjs.com/docs/apis/preferences).
4. **Sổ chung:** couples.js/adapter A/B hiện là mô phỏng, trạng thái mất khi tải lại. Trước online phải đưa luồng đồng thuận/thành viên vào mô hình server-authoritative cùng chuẩn tiền và quyền truy cập đã review. Không quảng cáo demo này như tính năng chia sẻ an toàn.
5. **Khác biệt nền tảng:** LocalBackup hiện chỉ có Android. Cần implementation iOS/web tương đương, cùng contract cancel/error/byte limit và bộ test từng nền tảng. iOS cần toolchain và ký riêng; desktop native không tự xuất hiện chỉ vì có Capacitor.

## Các ranh giới nên giữ

- Domain: số tiền, tiền tệ, quy tắc lệnh, kế hoạch, phân bổ, invariant; không phụ thuộc UI, Capacitor, HTTP hoặc tài khoản đăng nhập.
- Application: thực thi use case, trạng thái pending, khôi phục lỗi, phân trang, xác nhận và phối hợp adapter.
- Local repository: transaction/receipt/revision, schema migration, truy vấn có scope, export/stage/activate/rollback. Cùng contract cho IndexedDB, SQLite và adapter test.
- Platform services: chọn/lưu tệp, vòng đời app, nút Back, safe area; không truyền secret hay toàn bộ data xuống UI tùy tiện.
- Future auth/sync: session, membership, remote command API và đồng bộ là các adapter riêng, chỉ được bật sau review bảo mật và phép của chủ dự án.

## Khi làm bản online có tài khoản

- Server xác thực session và quyền theo user/space cho **mọi** read/write. Không tin actorId, tenantId, vai trò, ngày server hoặc quyền từ payload/client; A/B selector không phải authentication.
- Session/token trên native cần secure platform storage và flow chuẩn được review; web dùng cơ chế session phù hợp với origin/cookie/CSRF. Không cất secret dài hạn trong localStorage, Preferences thường hoặc JSON backup.
- Chốt ownership cho guest book → account book. Hiển thị dữ liệu nào sẽ upload, user/space nhận, kiểm tra trùng và xác nhận rõ. Đăng nhập không tự động upload dữ liệu đang nằm riêng trên thiết bị.
- Dùng durable outbox + command ID/idempotency, server revision/cursor và inbox/delta pull. Phân biệt đã lưu local, đang chờ sync, bị từ chối, cần giải quyết xung đột. Không dùng “last write wins” cho số dư, giao dịch hoặc xác nhận hai người.
- Server commit transaction và kiểm tra invariant trước khi trả receipt. Reconnect phải retry an toàn; trùng, đảo thứ tự, đồng thời hai máy, offline lâu, revoke membership và schema cũ phải có test.
- Tách ledger immutable/correction khỏi dữ liệu hiển thị. Tính report server theo tenant và chỉ mục; cache/projection phải gắn revision và có kiểm tra đối soát.
- Thêm migration có version, compatibility window và replay contract; quản lý app update bằng cùng identity/signer. Không coi cùng app ID là đủ chứng minh dữ liệu giữ được.
- Trước mở rộng người dùng cần threat model, rate limit, audit riêng tư, backup/restore được diễn tập, quan sát lỗi không chứa dữ liệu tiền thật, kiểm tra tải và chính sách lưu/xóa/xuất dữ liệu.

## Đề nghị các bước tăng dần

A. Hoàn tất UI và kiểm thử offline/native với dữ liệu giả; giữ financial core hiện tại. Đây là phạm vi đang làm.

B. Tách application/feature modules và contract test các repository/platform adapter. Đo hiệu năng dữ liệu lớn; chỉ đổi persistence khi có bằng chứng và migration có rollback.

C. Thiết kế API, quyền user/space và giao thức sync; chọn backend/auth dựa trên yêu cầu vận hành, chi phí và khả năng khôi phục. Xin duyệt dịch vụ/permissions trước khi tạo.

D. Pilot đăng nhập/guest migration/sync với dataset giả; kiểm thử hai máy và server từ chối quyền trước khi mở dữ liệu thật.

Đây là đường mở rộng có chủ đích. Bản thử hiện tại không được gọi là “đã sẵn scale” hoặc “đã sẵn online” chỉ vì đã có wrapper Capacitor.

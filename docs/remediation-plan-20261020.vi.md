# Phương án khắc phục CashWeave — 20/10/2026

Chủ dự án đã yêu cầu khắc phục theo báo cáo, ưu tiên Android, bảo đảm hỗ trợ iOS, giữ offline và bảo toàn dữ liệu. Đây là phạm vi triển khai hiện hành; chưa phải chứng nhận native hoặc quyền upload store.

Nguồn bắt đầu: `fe5609b8243d709ff6c37bebc232eb926284e44c`, tracked checkout sạch. Báo cáo gốc và bằng chứng tại `evidence/audit-20261020/` được giữ nguyên.

## Phân công và thay đổi

1. **Domain:** sửa hoàn tác/correction chi, kiểm kiểu profile, tên mẫu, sửa kế hoạch sau unlink; correction giữ memo và association, giảm dưới tổng liên kết cần đối soát rõ. Thêm adjustment sửa số dư đầu kỳ có lịch sử, không biến thành thu nhập. Owner `fix_domain`: core/model, commands, calendar và regression tests riêng.
2. **Persistence:** đọc được envelope legacy, giữ blocker mapping không an toàn; multipart backup mỗi tệp <=5 MiB, kiểm trọn bộ trước activation; API recovery tồn tại sau restart; restore lại cùng tệp an toàn mà không mở stale stage. Owner `fix_persistence`: migration/repository/backup modules và tests riêng.
3. **Native:** composition root Android/iOS; plugin LocalBackup Swift với cùng contract; target Xcode/privacy/offline policy, bảo toàn Android ID/origin/signing; native build lint trước AAB. Owner `native_platforms`: mobile, android, ios, package và build/check scripts.
4. **Root:** tích hợp UI recovery/legacy file/segmented backup/correction/recurrence/số dư đầu kỳ; giữ lối dùng tương thích đầy đủ cho dữ liệu legacy chưa ánh xạ; sửa harness CRLF; cập nhật tài liệu requirement/workflow/QC; pipeline kiểm thử offline và inventory release đầy đủ.

Không sửa file của owner khác trước khi thống nhất contract. Không đọc/import saves thật, không xóa/reset checkout, không tạo signing key thay thế hoặc tự nối cloud. App ID, signer và WebView origin Android giữ nguyên. Không bỏ guard để ép dữ liệu legacy vào model không tương thích.

## Bổ sung phạm vi sổ chung

Chủ dự án đã chọn bổ sung sổ chung offline dùng trên một điện thoại trước phát hành. Mã demo cũ được giữ làm lịch sử thử nghiệm; UI hiện hành chuyển sang adapter lưu trữ riêng. Persistence owner phụ trách schema/journal/capsule, IndexedDB, backup/recovery; UI owner phụ trách giao diện và I/O được inject; domain reviewer phụ trách correction/void có lịch sử; root tích hợp route/namespace, browser QC, tài liệu và build lại. Xem [phạm vi sổ chung](shared-offline.vi.md). Không thêm xác thực hoặc đồng bộ cloud. Android 13 thử nghiệm chưa có CashWeave/dữ liệu; iOS chưa có môi trường Mac/Xcode.

## QC và cổng phát hành

- Test đúng lỗi và tình huống lân cận; chạy lại toàn Node suite, gate tests, Python packager, browser IndexedDB và rendered browser flows với profile giả riêng.
- Kiểm build/rebuild assets Android/iOS, origin/CSP/offline policy/native source; kiểm native lint/compile/artifact trên toolchain hiện có khi đủ điều kiện.
- Đối chiếu backup/restore, counts/số dư, idempotency, rollback sau reopen và future/corrupt/oversize/missing-part failures. Đo khôi phục trên fixture.
- Đối chiếu feature matrix và defect register; kiểm UAT, accessibility, lifecycle/process death/update/SAF trên thiết bị trước phát hành.
- Bằng chứng ghi PASS/FAIL/BLOCKED/NOT_APPLICABLE đúng phạm vi. Không tự ghi PASS cho Xcode/device/SDK chưa chạy. Native signing, SDK agreements, store target/approval cần bằng chứng đúng candidate và hành động.
- Chỉ đóng gói phát hành sau khi QC áp dụng đạt. Nếu môi trường native thiếu, bàn giao source, tài liệu và bằng chứng đã chạy cùng blocker cụ thể; không gọi gói unsigned/source là bản sẵn lên store.

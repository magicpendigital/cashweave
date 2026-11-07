# Nội dung và hành vi hiển thị

Cập nhật 20/10/2026. Nội dung cần khớp hành vi đang chạy trong `ui/i18n.js`, `ui/remediation-text.js`, UI chính và màn tương thích. Đây là hướng dẫn nghiệm thu nội dung, không phải bằng chứng mọi màn đã được render trên thiết bị.

## Ngôn ngữ và số tiền

- Dùng tiếng Việt/Anh theo profile đã kiểm kiểu; dữ liệu profile lỗi không làm mất đường recovery.
- Hiển thị currency cùng số tiền. VND không có phần thập phân; tiền tệ khác dùng số đơn vị nhỏ nhất đúng metadata. Không diễn giải kế hoạch hoặc forecast thành số đã thu/chi.
- Opening/điều chỉnh số dư có lịch sử riêng, không gắn nhãn thu nhập. Correction cần nêu hậu quả với các plan settlement và yêu cầu đối soát khi số replacement không đủ liên kết cũ.
- Sổ chung hiện hành ghi rõ offline trên một thiết bị, VND và lưu riêng với sổ cá nhân. A/B/tên là nhãn ghi nhận; không tạo cảm giác đã có xác thực danh tính, khóa riêng giữa hai người hoặc đồng bộ. Module mô phỏng cũ chỉ dùng làm fixture/lịch sử, không phải UI native hiện hành.

## Backup, restore và dữ liệu lớn

Trước xuất file, nói rõ file chứa dữ liệu tài chính chưa mã hóa ở cấp ứng dụng; người dùng chọn nơi giữ file. Backup JSON/checksum phát hiện thay đổi, không xác thực tác giả. Không gửi cloud tự động.

Xuất nhiều phần phải hiển thị tổng số, thứ tự đang ghi và trạng thái từng phần. Chỉ báo hoàn tất khi mọi native save trả thành công; hủy hoặc lỗi ở bất kỳ phần nào nghĩa là bộ backup chưa đầy đủ. Người dùng giữ tất cả các phần cùng một bộ, không trộn các lần xuất.

Nhập nhiều phần cần đủ bộ, không trùng, đúng bundle/checksum và ≤64 MiB tổng trước khi preview/stage. Native chọn lần lượt từng phần; hủy giữa chừng giữ sổ hiện tại nguyên vẹn. Trình duyệt có thể chọn nhiều file. Không hiển thị “đã khôi phục” ở bước đọc file hoặc stage.

Archive `recovery-only` giữ bytes/record gốc nhưng **chưa thể khôi phục tự động**. Nêu lý do: vượt trần 64 MiB hoặc snapshot không hợp lệ; giữ bản gốc và cần công cụ/phiên bản sửa offline được review. Không dùng câu “backup thành công và chắc chắn khôi phục được” cho loại archive này.

## Migration legacy và recovery

File cũ có envelope `mach-tien-backup` hoặc direct state v1/v2. Hiển thị đúng tài khoản và yêu cầu ngày opening thực tế cho từng tài khoản, xác nhận đã giữ backup gốc, preview counts/số dư và xác nhận activation riêng. Không đoán ngày, không dùng ngày hôm nay làm ngày opening mặc định không được người dùng xác nhận.

Khi còn mapping credit/tài sản/settlement/template, nêu chính xác dữ liệu đang chặn và đường sổ tương thích. Sổ tương thích lưu riêng toàn bộ model cũ; không gọi đó là migration v3 hoàn tất. Thay đổi kho phải là thao tác người dùng rõ ràng.

Recovery liệt kê dataset cũ, active/valid, revision và counts biết được; không suy đoán dữ liệu thiếu là số 0. Dataset invalid chỉ cho xuất archive; rollback chọn dataset valid và xác nhận đúng active dataset/revision. Lỗi hoặc stale guard phải nói rõ chưa ghi thay đổi và yêu cầu tải lại. Reload không được xóa tay handle rollback.

## Tiêu chí nội dung QC

Thông báo phải phân biệt chọn file, kiểm file, preview, activation, save hoàn tất, cancel và failure. Luồng lỗi luôn có hành động tiếp theo thực hiện được; text người dùng đi qua text node/escaping. Không đưa stack trace, khóa nội bộ, token hoặc dữ liệu riêng vào nội dung/screenshot/report. Hướng dẫn Android/iOS chỉ đánh dấu đã kiểm khi có bằng chứng đúng nền tảng và candidate.

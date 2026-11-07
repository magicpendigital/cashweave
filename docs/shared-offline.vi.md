# Sổ chung offline trên một thiết bị

Phạm vi do chủ dự án chọn ngày 20/10/2026: bổ sung sổ chung có lưu trữ trước phát hành Android, dùng cùng source cho iOS. Không đồng bộ nhiều máy, không đăng nhập, xác thực danh tính hay khóa riêng giữa hai người. Nhãn A/B và tên người ghi là thông tin quy ước trên thiết bị; ai dùng được ứng dụng trên điện thoại đã mở đều có thể chọn nhãn. Xác nhận thỏa thuận/chốt kỳ ghi lại lựa chọn tại máy, không chứng minh hai danh tính đã được xác thực.

## Sổ và tiền

Sổ chung có kho IndexedDB, revision, journal và backup riêng với sổ cá nhân/legacy. Có thể mở từ màn bắt đầu mà chưa tạo sổ cá nhân. Tạo sổ trắng cần tên hai người và xác nhận phạm vi dùng chung; không tự thêm giao dịch mẫu. Bản đầu hỗ trợ VND nguyên, không quy đổi tiền tệ.

- Đóng góp tăng tiền quỹ; chi từ quỹ giảm tiền quỹ và tính chi tiêu.
- Ứng trước là người đó trả bằng tiền riêng: tính chi tiêu và khoản quỹ cần hoàn, không tự tăng/giảm tiền quỹ.
- Hoàn ứng giảm tiền quỹ và nghĩa vụ hoàn ứng, không tính chi tiêu lần hai. Không vượt khoản ứng còn lại, sai người hoặc trước ngày ứng.
- Hóa đơn chỉ là kế hoạch. Ghi thanh toán bằng chi quỹ/ứng trước mới tính số đã trả; không trả vượt phần còn lại.
- Thỏa thuận ngân sách cố định/tỷ lệ cần ghi hai xác nhận; thay đổi có hiệu lực theo kỳ, không tự tạo dòng tiền.
- Mục tiêu là cách xem phần có thể dành, không khóa tiền hoặc tạo tài khoản ngân hàng. Hóa đơn chưa trả cần được xem riêng.

Ghi ở sổ chung không tự sửa tài khoản cá nhân hay thực hiện chuyển khoản. Báo cáo từng sổ giữ phạm vi riêng; không tự cộng hai sổ thành một tổng để tránh tính trùng.

## Lịch sử và bảo toàn

Lệnh ghi có command ID, revision và nhật ký. Thử lại cùng lệnh không nhân đôi tiền; tab cũ phải đọc lại trước ghi. Chỉ báo lưu sau khi transaction xác nhận. Thiếu Web Locks thì đọc/xuất được nhưng không ghi.

Sửa/hủy bản ghi giữ giá trị trước/sau và lý do. Giữ nguyên loại, người, hóa đơn và khoản ứng liên quan. Đối soát lại toàn bộ số dư theo ngày, hóa đơn và hoàn ứng; không sửa kỳ đã chốt hoặc làm mất liên kết. Bản ghi hủy vẫn có lịch sử, không được tái sử dụng ID.

Backup sổ chung mang định dạng riêng, không nhập nhầm vào sổ cá nhân. Giới hạn ban đầu 5 MiB cho toàn envelope và 10.000 lệnh trong journal; chặn ghi vượt trần để vẫn xuất được. Giữ bản sao ngoài ứng dụng trước khôi phục. Stage chỉ kiểm/preview; activation cần xác nhận riêng và đúng dataset/revision. Giữ dataset trước đó để rollback sau mở lại. Thiếu/sai checksum, journal không tái hiện được hoặc future schema phải từ chối mà không đổi sổ đang dùng.

Capsule kiểm toàn vẹn trong IndexedDB phát hiện dữ liệu thay đổi ngoài đường ghi của ứng dụng; đó không phải chữ ký/xác thực trước người kiểm soát thiết bị và có thể sửa cả dữ liệu lẫn hash. File nhập luôn cần kiểm đầy đủ journal và số tiền. Dữ liệu invalid giữ được để xuất phục hồi, không được tự đặt lại thành sổ mới.

## QC và giới hạn nghiệm thu

Kiểm tạo sổ, contribution/expense/advance/reimbursement, trả hóa đơn từng phần, thỏa thuận, mục tiêu, chốt kỳ, correction/void, duplicate/stale/abort, backup/restore/rollback sau reopen và dữ liệu giả bị sửa. Đối chiếu counts, số dư, chi tiêu, nghĩa vụ hoàn và liên kết hóa đơn. Kiểm namespace/sổ cá nhân không thay đổi.

Đo riêng chi phí replay journal và thao tác thường; không dùng benchmark sổ cá nhân thay cho sổ chung. Node/memory và browser IndexedDB tách bằng chứng. Native Android/iOS cần kiểm lưu/mở lại, process death, file I/O và accessibility trên exact binary; static source không tự đạt các cổng này.

Full replay khi nhập nhiều nghìn lệnh có thể mất hàng chục giây trên máy phát triển; giao diện nhường luồng trong lúc kiểm, chưa có ngưỡng hiệu năng được nghiệm thu trên điện thoại. Mở/ghi kho đã được kiểm dùng capsule và kiểm cấu trúc, không replay toàn lịch sử mỗi lần. Khi bản lưu duy nhất bị hỏng hoặc mất active pointer, có thể nhập backup hợp lệ qua màn phục hồi với xác nhận bổ sung; raw cũ vẫn được giữ để xuất archive, kể cả NaN/cycle không biểu diễn được bằng JSON thường. Archive không phải backup được kích hoạt trực tiếp.

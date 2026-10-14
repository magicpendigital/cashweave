# Vai trò: Sản phẩm và nội dung

**Đầu vào:** nhu cầu đã ghi trong `documents/` ở mức cấu trúc, [kế hoạch](../docs/development-plan.md), tình trạng chức năng do người tạo mẫu và QA xác nhận. Không dùng số tiền cá nhân trong đầu ra.

**Phụ trách tệp:** `docs/development-plan.md`, `docs/content.md` và brief này khi được giao. Không sửa mã ứng dụng hoặc test; gửi yêu cầu thay đổi cho điều phối.

**Cách làm:** chuyển nhu cầu thành luồng, quy tắc số tiền, tiêu chí nghiệm thu và câu chữ ngắn, rõ. Đối chiếu chữ giao diện với hành vi đang chạy; mọi lời hứa về lưu dữ liệu, đối soát hoặc bảo mật cần bằng chứng từ code/QA.

**A0:** chỉ mô tả tổng quan, thêm tài khoản/giao dịch, CSV báo lỗi/trùng, cập nhật tài sản mẫu, lịch tiền và hướng dẫn. Nêu dữ liệu giả lập và giới hạn. **A1 chưa hoàn thành:** viết yêu cầu và chữ dự kiến cho sửa giao dịch, xem trước CSV, đối soát sao kê, xuất/sao lưu/khôi phục và tạo tài sản mới; đánh dấu chưa hiển thị trong A0.

**Đầu ra/bàn giao:** tài liệu có giả định, phạm vi, tiêu chí kiểm được và microcopy cho trạng thái thường, trống, lỗi. Bàn giao cho người tạo mẫu khi mỗi màn hình cần làm có hành động và trạng thái rõ; bàn giao cho QA khi tiêu chí có kết quả kỳ vọng đo được.

**P0/P1:** nếu phát hiện chữ gây hiểu sai số tiền, tình trạng đối soát hoặc quyền riêng tư, báo ngay điều phối và người tạo mẫu; đề xuất câu sửa cụ thể. Không gọi cổng đạt khi lời hứa sản phẩm vượt quá chức năng thực tế.

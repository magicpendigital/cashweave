# Vai trò: Review độc lập

**Đầu vào:** bản chạy và mã do người tạo mẫu bàn giao, [cổng nghiệm thu](../docs/development-plan.md), [quy trình Agent](../docs/agent-workflow.md) và nội dung A0/A1.

**Phụ trách tệp:** báo cáo review, ví dụ `docs/review-report.md`, khi được điều phối giao. Không sửa mã hoặc test đang thuộc Agent khác; gửi phát hiện cho điều phối.

**Cách làm:** đọc luồng tiền và thử các đường đi thẻ, chuyển nội bộ, đầu tư, CSV, lịch tiền; kiểm tra tính đúng, khả năng truy nguyên số, giới hạn dữ liệu mẫu và câu chữ. Ghi mỗi phát hiện với vị trí, dữ liệu giả lập, bước tái hiện, thực tế, kỳ vọng và ảnh hưởng. Gán P0–P3 theo [quy trình](../docs/agent-workflow.md).

**A0:** review chức năng đang có, không chấm thiếu đối soát/sửa giao dịch/sao lưu là lỗi A0 nếu giới hạn đã được nói rõ. Ghi chúng là việc A1. **A1 chưa hoàn thành:** khi được giao review vòng A1, kiểm tra thêm sửa giao dịch, xem trước CSV, đối soát và khôi phục dữ liệu.

**Đầu ra/bàn giao:** danh sách phát hiện có thể hành động, phần đã xem nhưng chưa thử, kết luận rủi ro cho cổng tương ứng. Bàn giao khi điều phối và người tạo có đủ thông tin để tái hiện, ưu tiên và sửa.

**P0/P1:** báo ngay điều phối và QA trước khi hoàn thành toàn bộ review; yêu cầu giữ cổng ở trạng thái chưa đạt cho đến khi sửa và chạy lại.

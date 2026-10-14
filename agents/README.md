# Bộ hướng dẫn vai trò Agent

Các tệp này là **role brief để giao việc thủ công**, không phải cấu hình khiến Agent tự chạy. Trong vòng làm việc hiện tại, nhóm Agent được điều phối thủ công. Người điều phối cần giao nhiệm vụ, phạm vi tệp và nhận báo cáo từ từng vai trò.

| Vai trò | Brief | Bàn giao chính |
|---|---|---|
| Điều phối | [coordinator.md](coordinator.md) | Phạm vi, thứ tự công việc, quyết định cổng |
| Tạo mẫu | [prototype-builder.md](prototype-builder.md) | Ứng dụng chạy được và tự kiểm |
| Sản phẩm & nội dung | [product-content.md](product-content.md) | Yêu cầu, tiêu chí, chữ giao diện |
| Review độc lập | [independent-reviewer.md](independent-reviewer.md) | Phát hiện có bằng chứng và mức ưu tiên |
| Kiểm thử phần mềm | [software-qa.md](software-qa.md) | Kết quả test, lỗi tái hiện, kiểm tra lại |

Đọc [quy trình bàn giao](../docs/agent-workflow.md), [kế hoạch phát triển](../docs/development-plan.md) và [nội dung giao diện](../docs/content.md) trước khi nhận việc. Mỗi Agent chỉ sửa tệp được giao trong brief hoặc nhiệm vụ cụ thể; báo điều phối nếu cần đổi phạm vi.

**Cổng A0:** bản tương tác đầu tiên với tổng quan, thêm tài khoản/giao dịch, CSV báo lỗi và trùng, cập nhật giá tài sản mẫu, lịch tiền và hướng dẫn. Kiểm thử kỹ thuật đã đạt; thử khả năng dùng với người dùng độc lập còn mở. A0 chưa có đối soát sao kê hay sao lưu. **Cổng A1 chưa hoàn thành:** sửa giao dịch, xem trước CSV, đối soát sao kê, xuất/sao lưu/khôi phục và tạo tài sản mới. Chỉ thử dữ liệu tài chính cá nhân thật sau khi A1 được nghiệm thu.

Quy tắc chung: dùng dữ liệu giả lập, không chép số tiền trong `documents/` vào mã, báo cáo hoặc ảnh. **P0** là sai tiền nghiêm trọng hoặc mất/lộ dữ liệu; **P1** là lỗi chặn luồng chính. Người phát hiện báo ngay điều phối, người tạo sửa, QA xác nhận lại. Không tuyên bố cổng đạt khi còn P0/P1.

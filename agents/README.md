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

Các cổng A0/A1 trong brief là lịch sử prototype. Từ 20/10/2026, dùng ma trận requirement trong `docs/development-plan.md` và chuỗi cổng trong `docs/agent-workflow.md`: domain/recovery → full QC → native/device → candidate/store. Mã correction, CSV preview, backup/restore và tạo tài sản đã được bổ sung/kiểm hồi quy theo model tương ứng; không suy ra native hoặc người dùng độc lập đã nghiệm thu. Dữ liệu legacy chưa ánh xạ được giữ trong sổ tương thích. Sổ chung offline một thiết bị thuộc phạm vi hiện hành do owner chọn; demo cũ không thay được bằng chứng persistence/recovery của module mới.

Quy tắc chung: dùng dữ liệu giả lập, không chép số tiền trong `documents/` vào mã, báo cáo hoặc ảnh. **P0** là sai tiền nghiêm trọng hoặc mất/lộ dữ liệu; **P1** là lỗi chặn luồng chính. Người phát hiện báo ngay điều phối, người tạo sửa, QA xác nhận lại. Không tuyên bố cổng đạt khi còn P0/P1.

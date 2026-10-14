# Vai trò: Kiểm thử phần mềm

**Đầu vào:** bản chạy, [kế hoạch phát triển](../docs/development-plan.md), [kế hoạch test](../docs/test-plan.md), báo cáo review và hướng dẫn chạy từ người tạo mẫu.

**Phụ trách tệp:** `tests/**`, `docs/test-plan.md` và báo cáo QA (ví dụ `docs/qa-report.md`) theo phân công. Không tự sửa mã sản phẩm trừ khi điều phối giao riêng.

**Cách làm:** chạy `npm test`, `npm start`, rồi thao tác giao diện bằng dữ liệu giả lập. Với mỗi lỗi, ghi môi trường, đầu vào, bước tái hiện, kết quả thực tế/kỳ vọng và mức P0–P3. Sau khi sửa, chạy lại đúng lỗi và một trường hợp lân cận; cập nhật trạng thái.

**A0:** kiểm thẻ trả sau không đếm chi hai lần, chuyển nội bộ, góp đầu tư, CSV lỗi/trùng, thêm tài khoản, cập nhật giá, lịch tiền và lưu/đặt lại dữ liệu mẫu. Kiểm tra giao diện nói rõ chưa có đối soát, sửa giao dịch và sao lưu. **A1 chưa hoàn thành:** chỉ kiểm thử các luồng sửa giao dịch, xem trước CSV, đối soát, xuất/sao lưu/khôi phục và tạo tài sản mới khi đã được triển khai; dùng dữ liệu giả lập nhiều kỳ.

**Đầu ra/bàn giao:** kết quả test tự động, kết quả thao tác, lỗi chưa đóng và bảng cổng A0/A1 đạt/chưa đạt/chưa thử. Bàn giao khi người khác có thể chạy lại test và hiểu chính xác giới hạn kết luận.

**P0/P1:** báo ngay điều phối/người tạo, đánh dấu cổng chưa đạt và giữ lỗi mở đến khi đã xác nhận bản sửa bằng test thực chạy.

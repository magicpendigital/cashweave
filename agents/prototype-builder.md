# Vai trò: Tạo mẫu

**Đầu vào:** [kế hoạch và tiêu chí](../docs/development-plan.md), [chữ giao diện](../docs/content.md), nhiệm vụ cụ thể từ điều phối và dữ liệu kiểm thử giả lập.

**Phụ trách tệp:** `index.html`, `styles.css`, `app.js`, `ledger.js`, `storage.js`, `sample.js`, `server.js`, `package.json` theo phân công. Không sửa `documents/`, tài liệu sản phẩm hoặc test của QA khi chưa được giao.

**Cách làm:** triển khai quy tắc thu, chi, chuyển nội bộ, trả thẻ và đầu tư theo cùng một sổ; dùng dữ liệu mẫu riêng. Giữ màn hình, lỗi và chú thích đúng với chức năng đang chạy. Tự chạy `npm test`, `npm start` và thử luồng chính trước khi bàn giao.

**A0:** duy trì tổng quan, thêm tài khoản/giao dịch, CSV báo lỗi/nghi trùng, cập nhật giá tài sản mẫu, lịch tiền, hướng dẫn và lưu cục bộ. Ghi rõ A0 chưa có sửa giao dịch, xem trước CSV đầy đủ, đối soát sao kê hoặc xuất/sao lưu.

**A1 chưa hoàn thành:** chỉ triển khai từng phần sau khi điều phối giao việc; cần sửa giao dịch, xem trước CSV, đối soát, xuất/sao lưu/khôi phục và tạo tài sản mới, kèm test và nội dung tương ứng.

**Đầu ra/bàn giao:** tệp đã sửa, lệnh chạy, các tình huống đã tự kiểm, giới hạn và lỗi còn lại. Bàn giao cho reviewer/QA khi bản chạy khởi động được và các tình huống cơ bản có kết quả cụ thể.

**P0/P1:** báo ngay điều phối nếu thấy sai số tiền, mất/lộ dữ liệu hoặc luồng chính bị chặn; nêu cách tái hiện và ảnh hưởng. Sửa theo ưu tiên rồi yêu cầu QA xác nhận lại, không tự đóng lỗi.

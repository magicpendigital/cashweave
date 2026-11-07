# Vai trò: Điều phối

**Đầu vào:** [kế hoạch](../docs/development-plan.md), [quy trình Agent](../docs/agent-workflow.md), báo cáo của các vai trò và trạng thái mã hiện tại.

**Phụ trách tệp:** danh sách nhiệm vụ/quyết định cổng trong `docs/agent-workflow.md` và brief điều phối khi được giao. Chỉ sửa tệp sản phẩm, ứng dụng hoặc test sau khi phân lại quyền sở hữu rõ ràng.

**Cách làm:**

1. Giao từng việc với requirement/cổng hiện hành trong `docs/development-plan.md`, tệp được sửa, đầu ra và cách nghiệm thu. Chia việc độc lập để tránh ghi đè. A0/A1 chỉ ghi lịch sử prototype.
2. Nhận bàn giao từ người tạo mẫu; chuyển bản chạy cho review độc lập và QA. Giữ một danh sách lỗi với trạng thái mở, đang sửa, cần kiểm tra lại, đã đóng.
3. Đối chiếu từng luồng với source, model dữ liệu và kiểm chứng đã thực chạy; phân biệt Node/VM, browser, native compile và thiết bị. Không ghi “sẵn sàng dùng dữ liệu thật” từ test giả lập.
4. Chỉ nghiệm thu cổng tương ứng khi đủ bằng chứng; giữ migration blocker, kiểm recovery sau restart và bảo toàn dữ liệu tương thích. Native/device/owner còn thiếu phải ghi BLOCKED.

**Đầu ra/bàn giao:** danh sách tệp và chức năng đã được kiểm, lỗi còn lại, kết quả từng cổng hiện hành và nhiệm vụ kế tiếp có người nhận. Bàn giao khi mọi kết luận có bằng chứng test hoặc review, không dựa riêng vào lời tự báo của người tạo.

**P0/P1:** dừng quyết định nghiệm thu, giao người tạo sửa, yêu cầu QA chạy lại đúng lỗi và tình huống lân cận. Báo rõ tác động và trạng thái chưa giải quyết cho các vai trò liên quan.

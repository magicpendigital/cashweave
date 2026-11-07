# Quy trình phát triển và bàn giao Cash Weave

Cập nhật 20/10/2026. Phạm vi hiện hành: [phương án khắc phục](remediation-plan-20261020.vi.md), [yêu cầu](development-plan.md), [QC](test-plan.md), [cổng release](release/RELEASE_RUNBOOK.md). Các mô tả A0/A1 trong brief cũ ghi lịch sử prototype; không dùng chúng làm bằng chứng v3 hoặc native đã nghiệm thu. App tiếp tục offline; thử nghiệm dùng dữ liệu giả, không mở sổ thật.

## Quyền sở hữu và phối hợp

| Vai trò | Trách nhiệm | Bàn giao bắt buộc |
|---|---|---|
| Điều phối | Chốt phạm vi, giao một owner cho từng vùng tệp, giữ sổ lỗi, giải quyết contract và quyết định cổng | Danh sách diff, bằng chứng, blocker và người chịu trách nhiệm |
| Domain | Tiền nguyên, posting/undo/correction, kế hoạch, quỹ, validator | Test đúng lỗi, bảo toàn số dư/liên kết, negative paths |
| Persistence | Backup/migration, IDB, transaction, recovery, giới hạn tài nguyên | Fixture cũ/corrupt/future, counts/số dư trước-sau, lỗi không thay dữ liệu gốc |
| UI/sản phẩm | Luồng người dùng, nội dung Việt/Anh, hỗ trợ tiếp cận | Thao tác thông thường, giải thích hậu quả, không báo thành công khi chưa ghi |
| Native | Android/iOS composition root, bridge, origin/CSP, input và build | Static/runtime phân biệt rõ; exact artifact/device evidence khi có |
| Review độc lập | Kiểm diff và contract ngoài nhóm tác giả; xác minh các giả định/giới hạn | Phát hiện có file/bước tái hiện và đề xuất; không tự đóng lỗi của mình chỉ bằng đọc code |
| Software QA | Chạy fixture độc lập, full QC, thiết bị và hồi quy | Lệnh/exit/source hash/môi trường, kết quả PASS/FAIL/BLOCKED/NOT_APPLICABLE |
| Chủ dự án/operator | Nghiệm thu candidate, target và hành động cụ thể | Owner packet, exact manifest/approval; operator xác minh quyền từ bên ngoài checker |

`agents/*.md` là role brief giao việc; không phải engine tự chạy, cơ chế cô lập, quyền truy cập hay bằng chứng sub-agent đã làm việc. Chỉ phối hợp song song với phạm vi tệp rõ. Thay đổi contract phải báo owner liên quan trước khi tích hợp; không reset/stash/ghi đè dirty work. Không đọc saves, CSV hoặc tài liệu tài chính riêng để tạo fixture.

## Chu kỳ thay đổi

1. Ghi trigger, hành vi hiện tại/kỳ vọng, tác động tài chính/dữ liệu, phạm vi và điểm dừng. Đọc AGENTS/release runbook khi liên quan staging/packaging/handoff.
2. Giao owner, tệp, API và test. Chạy tái hiện bằng dữ liệu giả; giữ raw backup trước migration. Mọi chuyển đổi phải có đối soát; mapping thiếu tiếp tục chặn activation.
3. Sửa nhỏ theo contract. Quyết định actual/planned/proposed và tiền tệ phải hiện rõ. Không nối cloud hoặc thêm quyền network khi chữa lỗi offline.
4. QA chạy đúng lỗi và lân cận, sau đó `node scripts/qc.mjs`; review độc lập xem diff và bằng chứng. Tác giả ghi giới hạn kỹ thuật, không thay human UAT/native bằng test VM.
5. Chỉ đóng lỗi khi test thực chạy khớp source và tiêu chí. Khi source/input thay đổi, bằng chứng cũ không còn chứng minh candidate mới.
6. Chuẩn bị owner packet khi các cổng áp dụng đạt; còn native/device/store blocker thì giữ release đóng. Build/source archive/unsigned AAB chưa phải quyền ký, cài hay upload.

## Sổ lỗi và trạng thái

Mỗi lỗi có ID, mức P0–P3, owner, ảnh hưởng, fixture/bước tái hiện, file/API, kết quả kỳ vọng/thực tế, source digest và trạng thái. Trạng thái: **OPEN → IN_PROGRESS → READY_FOR_QA → VERIFIED_FIXED**; QA thất bại thì **REOPENED**. **BLOCKED** phải nêu điều kiện bên ngoài còn thiếu; **DEFERRED** cần phạm vi sản phẩm được chấp nhận và không được che P0/P1. Trạng thái triển khai code và trạng thái nghiệm thu thiết bị là hai cột riêng.

- P0: sai tiền nghiêm trọng, mất/lộ dữ liệu; dừng candidate, bảo toàn raw và giao owner ngay.
- P1: chặn luồng chính hoặc khôi phục; không thông qua release cho đến khi sửa và QA xác nhận.
- P2/P3: ghi tác động/giới hạn rõ; không tự coi sự vắng mặt test là PASS.

Chuỗi cổng hiện hành: phạm vi/feature matrix → domain và recovery → full QC → Android native/device → candidate ký/store; iOS có cổng Xcode/device riêng. Các cổng lịch sử A0/A1 của prototype không thay thế chuỗi này.

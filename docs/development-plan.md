# Phạm vi phát triển và tiêu chí nghiệm thu

Cập nhật 20/10/2026. Android ưu tiên; domain/UI/backup dùng chung cho iOS. Mã có trong repo không đồng nghĩa đã được native/device QC. Hiện tại chưa có bằng chứng đủ để tuyên bố sẵn sàng Google Play/App Store. [Báo cáo audit](../evidence/audit-20261020/REPORT.vi.md) là baseline lỗi; [phương án khắc phục](remediation-plan-20261020.vi.md) là phạm vi sửa.

## Hai kho nghiệp vụ

UI chính `/next` và mobile dùng schema v3/IndexedDB: tiền nguyên theo đơn vị nhỏ nhất, currency rõ, posting bất biến, actual/planned/proposed tách biệt. Prototype `/` và màn sổ tương thích giữ model legacy v1/v2 với thẻ/tài sản/CSV. Chúng lưu riêng; không tự gộp sổ hay suy ra tương đương số tiền giữa model.

Dữ liệu legacy có credit/card/asset/investment, settlement hoặc template chưa ánh xạ đủ tiếp tục bị chặn migration v3. Sổ tương thích là đường giữ và sử dụng đầy đủ dữ liệu theo model cũ, có backup riêng; không được nói các nghiệp vụ đó đã trở thành v3. Theo lựa chọn của chủ dự án, [sổ chung offline](shared-offline.vi.md) có kho/journal/backup riêng, hai nhãn người dùng trên cùng thiết bị và VND. Không có xác thực danh tính, khóa riêng hay đồng bộ nhiều máy. Cloud/backend/auth/sync không nằm trong phạm vi offline này; demo cũ giữ làm fixture/lịch sử.

## Ma trận requirement → source → kiểm chứng

| Yêu cầu | Source chính | Tiêu chí nghiệm thu và kiểm chứng |
|---|---|---|
| Onboarding, tài khoản, số dư đầu kỳ và điều chỉnh có lịch sử | `core/model.js`, `core/commands.js`, `ui/app.js` | Không tính opening/adjustment thành income; thu/chi và số dư đối soát; domain + UI regression |
| Thu/chi/chuyển, hoàn tác và correction | `core/commands.js`, `core/model.js` | Bảo toàn tiền, không duplicate retry; chi âm đảo dương hợp lệ; correction giữ memo và đối soát settlement; domain/IDB/UI |
| Kế hoạch và recurrence | `core/calendar.js`, `core/commands.js`, `ui/app.js` | Tháng ngắn/day31, gia hạn không trùng; net unlink về 0 cho sửa lại; actual không tự phát sinh |
| Quỹ, template version và phân bổ | `core/allocation.js`, `core/commands.js` | Tiền nguyên, shortage rõ, tên sửa lưu được, source capacity và quota đúng cutoff; domain regression |
| Báo cáo và forecast | `core/reports.js`, `ui/app.js` | Tổng cùng grain/scope, pagination giữ tổng toàn bộ, forecast không ghi actual; reporting tests + benchmark |
| Restore v3 và chuyển legacy qua file | `core/migration.js`, `ui/app.js` | Kiểm checksum/schema/namespace; xác nhận raw backup, ngày opening và preview; counts/số dư khớp trước activation |
| Recovery sau restart/corrupt active | `core/repository.js`, `ui/storage-failure.js` | Tìm lại dataset cũ không cần profile hợp lệ, export bản gốc, rollback có guard; IDB reopen và UI |
| Backup lớn | `core/backup-policy.js`, `core/migration.js` | Mỗi tệp ≤5 MiB; toàn bộ restore ≤64 MiB; thiếu/trùng/sai checksum không stage; roundtrip Unicode exact |
| Tính năng legacy chưa ánh xạ | `compatibility.js`, `legacy-platform.js`, `mobile/legacy-entry.js`, model legacy | Lưu riêng và backup đủ, không xóa dữ liệu bằng migration; regression + UI/browser |
| Sổ chung offline một thiết bị | `core/shared-*`, `ui/shared-offline-view.js`, `couples.js` | Journal, tiền/nghĩa vụ, correction/void, chốt kỳ, persistence/recovery và namespace riêng; không giả định A/B là auth |
| Android offline | `android/`, `mobile/`, config và build scripts | ID/origin/signer giữ nguyên, static/source hash đạt; native lint/bundle/device theo cổng riêng |
| iOS offline | `ios/`, `mobile/`, build scripts | Cùng contract LocalBackup, WKWebView/origin/lifecycle; Swift/Xcode/device/privacy/signing cần bằng chứng macOS |

`tests/*.test.mjs` bao phủ domain/legacy/UI harness/static native; `tests/browser-idb-scenarios.js` thực thi IndexedDB trong browser cô lập. Native device matrix tại [native-device-qa.vi.md](native-device-qa.vi.md). Các file test chỉ chứng minh phạm vi đã chạy.

## Dữ liệu và giới hạn

Backup v3 bình thường là một JSON; vượt 5 MiB thì là bộ JSON có số thứ tự, mỗi phần chứa tối đa 2 MiB raw bytes trước base64. Bộ restore hỗ trợ tối đa 64 MiB raw envelope, tối đa 64 phần, phải đủ bộ và checksum khớp. Native picker/export giữ giới hạn 5 MiB mỗi tệp.

Repository chặn ghi mới làm snapshot vượt 64 MiB export envelope. Dataset cũ đã vượt trần vẫn đọc được, xuất archive đầy đủ và cho phép thay đổi làm nhỏ hơn; archive vượt trần hoặc snapshot invalid là **recovery-only**, chưa thể activate. Không cắt bớt journal/giao dịch để qua trần. Cần bản chuyển đổi offline được review để giảm dữ liệu rồi kiểm lại đầy đủ; không hứa bản archive là bản khôi phục tự động.

Origin khác có kho riêng. Chuyển browser/origin/điện thoại cần xuất và nhập file có xác nhận; không uninstall/clear data để né upgrade. Giữ package ID, signer và Android `https://localhost`; iOS dùng origin đã cấu hình riêng và không tự đọc kho Android.

Bản đọc hiện tại nhận save v3 cũ hợp lệ. Sau khi sửa số dư đầu kỳ, operation `ADJUSTMENT` dương có thể trở thành funding source; binary v3 cũ không hiểu mở rộng này dù schema vẫn là 3. Không hứa hạ binary cũ đọc được save mới: xuất backup trước nâng cấp, giữ dataset trước activation và dùng recovery reader hiện tại hoặc bản sửa tiến. Correction legacy có journal riêng; migration v3 tiếp tục chặn nếu chưa thể giữ toàn bộ journal đó.

## Trình tự thực hiện

1. Đóng CW-01…CW-12 ở cấp code, regression và review; giữ dữ liệu legacy chưa ánh xạ trong workspace tương thích.
2. Hoàn thiện UI thông thường, tài liệu, full QC và inventory input/source/artifact chính xác.
3. Chuẩn bị dependency/toolchain đã review ngoài ứng dụng; không tự chấp nhận license, tải SDK hay giải quyết package bằng network trong lệnh build offline.
4. Chạy lint/compile/artifact inspection, Android device update/recovery/accessibility/UAT/performance. iOS chạy analyze/build/WKWebView/device trên macOS.
5. Tạo exact candidate và owner packet; ký/phân phối/upload cần cổng và quyết định đúng hành động. Còn P0/P1, toolchain, device hoặc owner evidence thiếu thì chưa phát hành.

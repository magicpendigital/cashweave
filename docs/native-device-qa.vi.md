# Phiếu QC Android và iOS trên thiết bị

Trạng thái mẫu: **BLOCKED — chưa có native/device execution cho candidate hiện hành**. Điền bằng dữ liệu giả; không uninstall, clear data hay thay signer trên ứng dụng có dữ liệu để né upgrade. Giữ Android app ID/origin hiện hành. Không tự chấp nhận SDK license, tải dependency, ký/cài hay upload ngoài hành động đã được duyệt.

## Nhận diện candidate và môi trường

Ghi commit + exact input digest, asset manifest hash, APK/AAB/app archive hash, build config/versionCode/versionName, app ID/bundle ID, origin, dependency/package lock, SDK/JDK/Gradle/Xcode/WebView/OS, model thiết bị, signer fingerprint (không private key), người thực hiện, ngày/giờ và log đã khử dữ liệu riêng. Source hoặc artifact đổi thì chạy lại các mục bị ảnh hưởng.

Android: `node scripts/check-android-toolchain.mjs`; khi đủ điều kiện, offline `lintRelease` trước `bundleRelease`, kiểm compiled manifest/permissions/debuggable/assets/signature. Lệnh unsigned chỉ tạo candidate kỹ thuật khi toolchain đã review; không tự tạo signed upload bundle. iOS: `node scripts/check-ios-toolchain.mjs`; Windows không chứng minh Swift/Xcode. Cần macOS/Xcode/SDK, reviewed Package.resolved/cache, analyze/build không resolve package qua mạng, sau đó device/archive/signing theo cổng riêng.

## Matrix bắt buộc

| Nhóm | Thao tác giả lập/thiết bị | Kỳ vọng | Android | iOS |
|---|---|---|---|---|
| Cold launch/offline | Airplane mode, launch/relaunch; inspect traffic/permission | App dùng local assets, không request cloud; CSP/bridge đúng | BLOCKED | BLOCKED |
| Tiền/domain | Opening, income, expense, transfer, undo, correction có settlement | Counts/số dư/currency khớp, không duplicate | BLOCKED | BLOCKED |
| Data lifecycle | Save, background/foreground, force stop/process kill/recreate | Committed dữ liệu còn; pending không báo thành công giả | BLOCKED | BLOCKED |
| Native file I/O | Android SAF import/export; iOS import picker và xác nhận export vào Documents/Backups local; cancel, deny/retry, provider chậm | Cancel/error rõ, tệp ≤5 MiB, không payload trong saved state/log; iOS không đưa payload ra export provider | BLOCKED | BLOCKED |
| Multipart | Bộ >5 MiB, đầy đủ/thiếu/trùng/trộn/sai checksum, cancel giữa bộ | Chỉ stage khi đủ và đúng; không kích hoạt khi lỗi; report tiến độ | BLOCKED | BLOCKED |
| Migration | File v1/v2, dates/backup ack, unsupported credit/assets/template | Preview và reconciliation; giữ raw/sổ tương thích; không ép activation | BLOCKED | BLOCKED |
| Recovery | Restore→restart→rollback→restore cùng file, corrupt active fixture | Liệt kê dataset cũ, rollback guarded, stale stage bị chặn | BLOCKED | BLOCKED |
| Sổ chung offline | Tạo sổ trắng, ghi A/B, chi/ứng/hoàn, sửa/hủy, chốt kỳ, backup riêng; process kill/reopen | Tiền/journal/attribution giữ nguyên, cá nhân không đổi; label không phải xác thực | BLOCKED | BLOCKED |
| Kho lỗi duy nhất | Không còn retained valid: corrupt/future/missing head → backup preview → xác nhận phục hồi | Raw lỗi giữ được, không auto-seed; tạo dataset riêng và mở lại đúng số dư | BLOCKED | BLOCKED |
| Quota/disk/provider error | Ghi/activation khi thiếu dung lượng, ngắt file I/O | Transaction atomic, active cũ còn, export/recovery vẫn truy cập được | BLOCKED | BLOCKED |
| Update tại chỗ | Bản trước→candidate cùng ID/signer/origin có fixture | Dữ liệu giữ; backup và rollback measured; không clear data | BLOCKED | BLOCKED |
| Navigation/lifecycle | Android Back; iOS gesture/background; picker quay về sau recreation | Không thoát mất pending write, không bridge result lạc phiên | BLOCKED | BLOCKED |
| Visual/a11y | Small screen, landscape, keyboard, safe area, font200%, TalkBack/VoiceOver | Đọc và thao tác được, focus/error/live region đúng, không che nút | BLOCKED | BLOCKED |
| Performance | Fixtures 10k/100k hoặc ngưỡng size thực hỗ trợ | Ghi latency/memory/cold start/restore theo máy; ngưỡng đã chốt riêng | BLOCKED | BLOCKED |
| Privacy/binary | Compiled permissions/entitlements/privacy manifest/SDK required-reason APIs | Khớp offline, không quyền dư, declaration đúng binary cuối | BLOCKED | BLOCKED |
| Human UAT | Owner/reviewer đi qua luồng thực bằng fixture | Nghiệm thu scope, giới hạn và recovery, exact candidate | BLOCKED | BLOCKED |

## Receipt và quyết định

Mỗi dòng điền PASS/FAIL/BLOCKED/NOT_APPLICABLE với bước thực chạy, artifact/source digest, môi trường, duration, expected/actual, log/screenshot/video hash và lỗi còn mở. NOT_APPLICABLE cần lý do scope cụ thể; Android/iOS chưa chạy phải là BLOCKED. Ghi thời gian phục hồi thực đo và data loss/RPO, không dùng mục tiêu đề xuất làm kết quả.

Store gates riêng: Android signed AAB/Play identity, listing/screenshots/privacy/Data safety/testing account và exact owner approval; iOS archive/provisioning/entitlements/privacy labels/TestFlight/App Store. Xác minh chính sách store hiện hành từ nguồn chính thức ở giai đoạn chuẩn bị upload. Mẫu này và static PASS không cấp quyền phát hành.

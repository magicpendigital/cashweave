# Cash Weave iOS source target

Target nguồn iOS dùng cùng core/UI v3 và sổ tương thích v1/v2 với Android. iOS tối thiểu **15.4** để giữ Web Locks cho sổ tương thích; không bỏ khóa ghi. `App.xcodeproj` bắt đầu từ template SPM chính thức Capacitor CLI **8.5.3**, dependency SPM pin `exact: "8.5.3"`; Node packages Android/core/CLI/iOS cùng version.

## Dựng lại local

Sau `npm ci --ignore-scripts`, chạy `npm run ios:sync`. Lệnh chỉ build/copy/đối chiếu asset ESM cục bộ, không tải dependency Swift, ký, cài hoặc truyền dữ liệu. Mở `ios/App/App.xcodeproj` trên máy macOS có Xcode 26.x/iOS SDK 26.x đã cấu hình. Dependency Swift cần được operator chuẩn bị và review trước, lưu `Package.resolved` và cache để build offline. Không tự chấp nhận license, chọn tài khoản, tạo key hoặc provisioning.

`npm run ios:check` báo PASS/BLOCKED về môi trường. `npm run ios:compile:unsigned` chỉ chạy analyze rồi build Release với `CODE_SIGNING_ALLOWED=NO`, tắt tự resolve/update package. Không tạo IPA phân phối. Team/signing trong project để trống; cần bước riêng cho candidate đã được duyệt.

## Ranh giới dữ liệu và offline

- iOS cố định origin `capacitor://localhost`, Android giữ nguyên `https://localhost` và app ID `app.cashweave.offline.trial`. Hai nền tảng không tự chia sẻ storage; chuyển máy bằng backup do người dùng chọn.
- Dùng WKWebsiteDataStore mặc định có persistence. Không đổi sang ephemeral storage, không xóa IndexedDB/localStorage khi khởi động/nâng cấp. Đánh dấu Library/Documents không tham gia backup hệ thống; dữ liệu và JSON vẫn là plaintext ở cấp ứng dụng.
- CSP chặn network/iframe, WKContentRuleList chặn HTTP(S)/WS(S) trước khi tải trang đầu, plugin chặn external navigation và thay native `CapacitorHttp` bằng adapter từ chối request. App không có tài khoản/backend/cloud integration.
- `LocalBackup` có cùng contract `saveJson`, `saveText` CSV, `openJson`, `consumeInterruption`, `ready`, `acknowledgeBack`, `minimize`. iOS không có API thoát/minimize hợp lệ; nút quay lại trong UI xử lý điều hướng.
- Xuất dùng xác nhận native rồi lưu atomic vào **Documents/Backups/UUID/filename** trong sandbox thiết bị, có file protection/exclude-backup. Files → On My iPhone/iPad → CashWeave Trial cho phép lấy các bản sao đã chủ động xuất; kho đang dùng vẫn nằm riêng trong Library. Giới hạn **5 MiB UTF-8**, đọc stream có giới hạn, chỉ báo thành công sau khi đọc lại destination và đối chiếu toàn bộ byte. Payload không vào state restoration hay UserDefaults; chỉ marker boolean về thao tác dở. Không ghi đè bản sao cũ cùng tên.
- iOS không mở document/provider/share picker cho import hoặc export. Người dùng dùng Files chép tệp JSON/CSV cục bộ vào **On My iPhone/iPad → CashWeave Trial → Imports**, rồi chọn tệp từ danh sách native trong app. Danh sách chỉ duyệt tối đa 250 mục trực tiếp/50 tệp hợp lệ, không đi vào thư mục con/symlink; kiểm lại descriptor bằng `openat`/`O_NOFOLLOW`/`fstat` và giới hạn byte khi đọc. App không tự gọi nhà cung cấp hoặc tải tệp cloud. Thao tác ngoài app trong Files do người dùng chủ động thực hiện.
- Background/process interruption không replay file operation hoặc activate dataset. Có thể còn tệp đích trống/chưa đầy đủ/đã ghi; app yêu cầu kiểm tra và xuất lại. Timeout chỉ ngăn báo thành công muộn, không đảm bảo chấm dứt provider I/O đang bị treo.

## QC còn bắt buộc trên macOS/thiết bị

Kiểm Swift compile/analyze, privacy report của app và SDK trong archive cuối, ATS/bridge/network denial, iPhone/iPad safe area/bàn phím/font lớn, cold launch, pending writes, background/kill/relaunch, Files nhìn thấy thư mục Imports/Backups, local export/import/cancel, tệp link/device/đổi tệp trong lúc chọn, JSON/CSV sai UTF-8/quá giới hạn, backup/restore/rollback sau restart và update giữ dữ liệu. Thử tệp giả, không dùng dữ liệu tài chính thật. Node source/asset checks trên Windows không thay các cổng này.

App icon/splash dùng đúng ba path/màu từ Android `ic_launcher.xml`, chuyển định dạng bằng `scripts/render-ios-brand.mjs` với sharp 0.35.5 đã có trong desktop runtime, không thiết kế lại hoặc dùng AI. `ios/brand-assets.json` ghi hash nguồn/generator/PNG và phiên bản renderer. Icon RGB không alpha 1024×1024; splash 128/256/384 pixel cho 1×/2×/3×, logo giữ 128 point giữa nền native `#f5f8f3`, không crop. Tái tạo bằng `node scripts/render-ios-brand.mjs <bundled-node-modules-directory>`; không cài dependency mới. Cần nghiệm thu launch screen thực tế trên iPhone/iPad.

Privacy manifest khai báo không tracking/không collection, app-only UserDefaults `CA92.1`, metadata file trong app container `C617.1` cho `fstat`/`fstatat` ([Apple required-reason APIs](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)); phải đối chiếu lại required-reason APIs và SDK manifest trên binary đã build. Chưa có chứng nhận archive/runtime iOS trong môi trường Windows hiện tại.

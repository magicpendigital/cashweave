# CashWeave: trạng thái native và checklist kiểm thử

Cập nhật cho bàn giao nguồn ngày 14/10/2026. **Native QA của nguồn hiện tại: BLOCKED / CHƯA CHẠY. Chưa có APK mới trong candidate hoặc tại output local vừa kiểm.** Đây là hướng dẫn chuẩn bị kiểm thử, không phải chỉ dẫn cài ngay hay xác nhận đủ deploy.

## Phân định bằng chứng lịch sử

Guide cũ ngày10/10/2026 mô tả checkpoint Android V4 trong workspace cô lập: APK4.029.151byte, SHA256 aac3210ea2981754ce3e4f60a3782d5b0bdf61aaa79c31dea84e18f0880e83f7; certificate debug SHA256 db2e97055df49ca6cf1780c26f15139e813d82a35d807dbaeb01d88fea7d1058. Khi đó build/binary inspection ghi PASS, lint FAIL1error/7warnings, runtime BLOCKED. Đây là artifact/checkpoint lịch sử; không phải kết quả của source đang bàn giao. Full source-input manifest/digest43inputs lịch sử không có trong curated candidate và không được đối chiếu lại ở lượt này; hash APK không thay source identity.

Các số219/219,37/37, toolchain/SDK agreement và cấu trúc permission được ghi trong ANDROID_TRIAL.md đều thuộc checkpoint lịch sử này. APK và evidence/mobile lịch sử không nằm trong candidate source-only. Không lấy certificate cũ làm xác minh signer hiện tại hoặc coi đường dẫn archive là tệp sẵn có để tải/cài.

Nguồn live đã đối chiếu141file theo allowlist SHA256 e9392ac7553d41b91c94d6e81cf979032f1cee8e3bc87839244f454d59cf4dc0. Candidate mới sửa đúng hai guide và có manifest riêng. Source sau Windows/packager/CAMERA-suppression changes không được kế thừa nativePASS cũ; suppression vẫn cần fresh lint. MockV3PASS chỉ kiểm logic bộ nhớ, không chứng nhận APK/native runtime.

## Điều kiện trước mọi cài thử trong tương lai

1. Có APK được build và kiểm thật từ exact source/config/toolchain; ghi SHA256, package, versionCode, embedded assets và signer. Package hiện tại dự kiến app.cashweave.offline.trial, code40101/name0.4.1-trial.1, origin https://localhost; identity trong file build phải được kiểm lại, không giả định.
2. Fresh lint, build, merged/compiled permission và signature checks đạt; Linh review exact artifact/evidence. Không dùng kết quả static/web hay QA lịch sử thay fresh native gates. Runtime chưa thực hiện phải giữ BLOCKED.
3. Có phê duyệt đúng target/action và dữ liệu thử giả. Trước update, xác minh signer/installed identity và kế hoạch phục hồi an toàn riêng; giữ app/save hiện hữu. Không gỡ app, clear data, downgrade, tạo key mới hay thay signer để giải quyết lỗi update.
4. Source bàn giao không chứa key. Không chuyển key qua Git. Không đổi security settings hoặc chấp nhận thêm SDK terms/download/tooling chỉ vì guide cũ từng được duyệt. Nếu quyền bị từ chối thì dừng và báo, không thử route né.
5. Chuyển sang Máy Marketing không miễn gate native/release/install. Miu/Linh đang review source handoff; pre-push vẫn đóng khi chưa rõ hosting/hooks/branch triggers và owner decision. Xem README hiện hành.

Không có lệnh cài/build native nào được thực thi hoặc cấp phép mới bởi tài liệu này. Sau khi các gate phù hợp được giải quyết, operator ghi kết quả thực; không tự đánh PASS trước thử nghiệm.

## Checklist tương lai — toàn bộ chưa chứng nhận cho nguồn hiện tại

Chỉ dùng dữ liệu giả; ghi model/Android/WebView, exact APK/source/signer và PASS/FAIL/BLOCKED từng bước. Thời điểm checklist được viết không phải executedAt.

1. Cold launch offline/máy bay; kiểm bridge/CSP/IndexedDB startup. Browser saves không tự chuyển vào APK.
2. Tạo sổ giả1.000.000VND, thu200.000/chi50.000: actual1.150.000. Thêm planned100.000 vẫn giữ actual; phân biệt actual/planned/forecast.
3. Bàn phím, scrolling, safe areas, font scaling, navigation; kiểm widths360/390/412 khi có công cụ. Back đóng filter, bảo vệ pending writes, điều hướng/background đúng cả trước JS readiness.
4. Đóng/mở lại và process recreation trên fixture; so IDs/counts/balances, kiểm tách Cá nhân/Chung. Không dùng tài chính thật.
5. SAF export local, cancel/retry, verify bytes/hash; unwritable/stalled providers không false-success. JSON plaintext; không dùng provider cloud. Partial file có thể còn sau lỗi.
6. Import qua preview/explicit activation; reconcile và synthetic rollback. Corrupt/future/oversized>5MiB/cancelled không thay active data.
7. Rotate/background/process recreation khi picker/I/O; cảnh báo interruption, không ghi tiền hai lần hoặc tự activate restore.
8. Upgrade rehearsal với đúng signer/package và versionCode cao hơn có chủ đích, giữ synthetic saves. Relaunch cùng bản không phải upgrade test. Không tự tăng versionCode trong lượt sửa docs.

Auto Backup/cloud-transfer exclusions phải được kiểm lại trong APK mới và hành vi runtime thực; dữ liệu local không tự có recovery chỉ vì cấu hình tắt backup. Gỡ/clear-data làm mất saves. Checklist và source-only handoff không cấp production approval.

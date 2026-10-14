# CashWeave — bàn giao phát triển trên Máy Marketing

Source-only candidate ngày 14/10/2026. Chưa commit/push: Miu và Linh phải kiểm exact manifest/snapshot trước. Đây không phải APK/release đã đạt native QA. App tiếp tục offline; không thêm cloud/live transmission.

## Snapshot và Git

Nguồn hiện hành: D:\Projects\financial-assistant, không có Git local khi kiểm.141 tệp khớp allowlist SHA256 e9392ac7553d41b91c94d6e81cf979032f1cee8e3bc87839244f454d59cf4dc0. Snapshot Git đề xuất bỏ29 native generated assets đang ignored, giữ112 source/config/test/guidance files; .gitignore được bổ sung safeguards và README này mới, đều cần review. Không dùng snapshot Drive V4 cũ để ghi đè Windows fixes/packager fixes.

Remote đã kiểm read-only: https://github.com/magicpendigital/cashweave private,size0, branches rỗng,default_branch main. Local chưa cấu hình remote. Sau review, đề xuất initial branch handoff/marketing-20261014; chưa tạo. Vì remote rỗng, branch mới không có base cho PR thông thường. Miu quyết định initial branch/default baseline trước publish; không force hoặc ghi lên main mặc định. Nếu remote có commit mới trước publish phải recompare, không reset. Sau publish ghi actual branch+commit SHA ở hồ sơ bàn giao.

## Trên Máy Marketing sau publish được duyệt

Clone branch/SHA thật đã bàn giao vào thư mục mới; không dùng nhánh đề xuất khi chưa tồn tại. Xác minh full commit SHA và source hashes trước sửa. Khi actual handoff branch đã được publish, lệnh clone dự kiến là git clone --branch handoff/marketing-20261014 --single-branch https://github.com/magicpendigital/cashweave.git ; SHA commit phải do operator cung cấp sau push, hiện chưa có. Không chuyển máy tự động ở task này.

Node>=22, package-lock.json và Capacitor core/android/CLI8.5.3 đã pin version. node_modules không đi qua Git; dependency install/cache setup trên máy mới là bước riêng sau khi kiểm quyền/network. Khi được phép chuẩn bị dependency, npm ci theo lockfile; không coi thư mục node_modules local chỉ-copy94files là npm install đầy đủ. Có thể thiếu CLI/transitive deps. Không commit dependency/cache/toolchain hoặc credentials để né setup.

Sau dependencies đúng, các lệnh phát triển dự kiến: npm.cmd run build:review; npm.cmd test; node scripts/build-android-web.mjs; node scripts/sync-android-assets.mjs; node scripts/verify-android-assets.mjs. Đây là hướng dẫn, chưa chạy trên Marketing. npm test rebuild review outputs qua pretest. Android generated assets29files, mobile-www và review-output đều tái tạo, không cần force-add ignored assets. Mobile runtime lấy từ pinned @capacitor/core/dist/index.js và LICENSE. Không tự chạy npm run android:compile:unsigned như chứng nhận QA: nó cần native toolchain/gates riêng.

Không có Gradle wrapper trong curated/native source; dùng Gradle8.14.3 đã được cài và kiểm riêng. Native cần JDK21, Android platform36/build-tools36.0.0 và offline cache đầy đủ. android/local.properties là machine-specific bị bỏ; ANDROID_HOME/SDK root cần cấu hình riêng. Không upload SDK, Gradle cache, global init scripts/properties hay debug.keystore. package app.cashweave.offline.trial, code40101/name0.4.1-trial.1 và origin https://localhost phải giữ. Không tạo key thay thế để update app đã cài; signing certificate/installed identity cần xác minh an toàn riêng, key không qua Git.

## QA và giới hạn

Native lint/build/APK/signature/merged permissions/runtime/install vẫn BLOCKED; chưa có current APK. QA web/packager lịch sử không chứng minh native PASS. MockV3 22PASS chỉ logical memory supervisor cases, chưa OS containment/telemetry/cancellation proof; không dùng nó làm điều kiện tự chạy build. V3 ở hồ sơ ngoài repo, không lẫn vào application source.

Guard available2304MiB giữ nguyên; memory plan đề xuất startup4608 gồm job budget/headroom, chưa benchmark. Không chạy native build cạnh Tiệm nhỏ/MCY. Cần fresh resource preflight, pinned full toolchain/cache, signing decision, exact input/config/evidence, lintDebug rồi assembleDebug tuần tự với recheck, independent APK review trước install. Giữ lint abortOnError và permission removal/offline gates. Server loopback từng BLOCKED EACCES: không né quyền. Synthetic persistence/recovery/upgrade và device smoke còn phải xác minh đúng source/artifact.

Đọc AGENTS.md, .agents/skills/financial-assistant-release/SKILL.md, docs/release/RELEASE_RUNBOOK.md và OWNER_PACKET.vi.md. Đây là source handoff, không deployment/install approval. Không tạo workflow/deploy hoặc thay production. Local .github không có; remote workflows endpoint bị connector chặn, rulesets403; external integration/webhooks chưa được xác minh nên không hứa push không kích hoạt automation. Kiểm lại trước publish trong quyền có sẵn, không đổi visibility/plan để né403.

## Giữ riêng và bảo toàn

documents/ là dữ liệu tài chính thật: không đọc, hash, copy, upload. evidence/raw logs, .env, credentials, keys, user profiles/database/saves, node_modules, caches, machine config và old APK không nằm trong candidate. .gitignore chỉ hỗ trợ; publish phải dùng exact allowlist, không git add . hoặc broad force-add. Bản local gốc và mọi extra files giữ nguyên. README/manual QA và historical manifests/logs ngoài reviewed141 không tự nhận là tài liệu hiện hành; cần review bổ sung nếu muốn publish. Source packaging script là exact-allowlist tool; không chạy root discovery. Chưa đóng ZIP mới trong lượt chuẩn bị này.

## Pre-push gate va owner decision

Repo rong khong chung minh push khong kich hoat hosting. Parent bao audit Vercel project-detail HTTP403; task nay khong thu lai hoac dung route khac. Hooks/integrations/branch triggers chua ro: PRE-PUSH BLOCKED. Owner can cung cap bang chung tu giao dien tai khoan co quyen ve connected hosting, production branch/preview triggers va repo hooks/integrations; hoac cho phep operator co quyen kiem trong kenh hop le. Khong coi mot loi dong y chung la thay the bang chung hoac cho phep ne403. Sau khi biet tac dong, owner/Miu xac nhan exact destination, initial branch/default baseline, pham vi source-only va trigger/deployment consequences, Linh review exact candidate manifest. Khong thay visibility, plan hay production config de vuot gate. Native QA BLOCKED duoc ban giao trung thuc; chuyen may khong bo gate native/release/install.

# CashWeave — bàn giao phát triển trên Máy Marketing

Checkpoint source-only đã được bàn giao ngày14/10/2026 vào repository private magicpendigital/cashweave, nhánh handoff/marketing-20261014. Commit source: bd8a23e21b50ee63383a2fb2efdfc222932afe5e. 113/113 tệp remote đã được đọc lại và khớp SHA256 với candidate V2 được duyệt. Đây không phải APK/release đã đạt native QA. App tiếp tục offline; không thêm cloud/live transmission.

## Snapshot và Git

Nguồn local khi tạo checkpoint: D:\Projects\financial-assistant, chưa có Git trong thư mục live tại lúc kiểm.141 tệp nguồn khớp allowlist SHA256 e9392ac7553d41b91c94d6e81cf979032f1cee8e3bc87839244f454d59cf4dc0. Git checkpoint đã bàn giao bỏ29 native generated assets đang ignored, giữ112 source/config/test/guidance files cùng README này thành113files. Safeguards .gitignore và hai native guide đã qua review source-only; chúng không cấp quyền native release. Không dùng snapshot Drive V4 cũ để ghi đè Windows fixes/packager fixes.

Repository private đã nhận source: https://github.com/magicpendigital/cashweave, nhánh handoff/marketing-20261014. Source checkpoint commit bd8a23e21b50ee63383a2fb2efdfc222932afe5e, tree SHA1 6ac1b06d3bae69daa197ff915739d16dab1a4440. GitHub tự chọn nhánh bàn giao làm default khi nhận nhánh đầu tiên; main chưa được tạo bởi lượt bàn giao. Readback độc lập API tree và113blob từ fresh clone khớp candidate manifest SHA256 4a4bc456a8b5ea9b28f456d8158209ce8a22ce81194451230d70cd455c2b62c3. Đây là checkpoint source cố định, không phải cam kết HEAD tương lai vẫn đứng yên. Trước thay đổi hoặc đồng bộ mới phải đọc lại remote và compare, không force/reset hoặc ghi đè work mới.

## Trên Máy Marketing: clone checkpoint đã bàn giao

Clone vào thư mục mới bằng git clone --branch handoff/marketing-20261014 --single-branch https://github.com/magicpendigital/cashweave.git . Kiểm git -C cashweave rev-parse HEAD và git -C cashweave rev-parse 'HEAD^{tree}'. Checkpoint source đã bàn giao là bd8a23e21b50ee63383a2fb2efdfc222932afe5e, tree6ac1b06d3bae69daa197ff915739d16dab1a4440; không dùng số này làm SHA của mọi cập nhật README/commit sau đó. Nếu HEAD đã tiến, xem diff/ancestry và xác minh checkpoint cùng source hashes trước sửa, không reset để ép về bản cũ. Không chuyển máy hoặc setup tự động từ tài liệu này.

Node>=22, package-lock.json và Capacitor core/android/CLI8.5.3 đã pin version. node_modules không đi qua Git; dependency install/cache setup trên máy mới là bước riêng sau khi kiểm quyền/network. Khi được phép chuẩn bị dependency, npm ci theo lockfile; không coi thư mục node_modules local chỉ-copy94files là npm install đầy đủ. Có thể thiếu CLI/transitive deps. Không commit dependency/cache/toolchain hoặc credentials để né setup.

Sau dependencies đúng, các lệnh phát triển dự kiến: npm.cmd run build:review; npm.cmd test; node scripts/build-android-web.mjs; node scripts/sync-android-assets.mjs; node scripts/verify-android-assets.mjs. Đây là hướng dẫn, chưa chạy trên Marketing. npm test rebuild review outputs qua pretest. Android generated assets29files, mobile-www và review-output đều tái tạo, không cần force-add ignored assets. Mobile runtime lấy từ pinned @capacitor/core/dist/index.js và LICENSE. Không tự chạy npm run android:compile:unsigned như chứng nhận QA: nó cần native toolchain/gates riêng.

Không có Gradle wrapper trong curated/native source; dùng Gradle8.14.3 đã được cài và kiểm riêng. Native cần JDK21, Android platform36/build-tools36.0.0 và offline cache đầy đủ. android/local.properties là machine-specific bị bỏ; ANDROID_HOME/SDK root cần cấu hình riêng. Không upload SDK, Gradle cache, global init scripts/properties hay debug.keystore. package app.cashweave.offline.trial, code40101/name0.4.1-trial.1 và origin https://localhost phải giữ. Không tạo key thay thế để update app đã cài; signing certificate/installed identity cần xác minh an toàn riêng, key không qua Git.

## QA và giới hạn

Native lint/build/APK/signature/merged permissions/runtime/install vẫn BLOCKED; chưa có current APK. QA web/packager lịch sử không chứng minh native PASS. MockV3 22PASS chỉ logical memory supervisor cases, chưa OS containment/telemetry/cancellation proof; không dùng nó làm điều kiện tự chạy build. V3 ở hồ sơ ngoài repo, không lẫn vào application source.

Guard available2304MiB giữ nguyên; memory plan đề xuất startup4608 gồm job budget/headroom, chưa benchmark. Không chạy native build cạnh Tiệm nhỏ/MCY. Cần fresh resource preflight, pinned full toolchain/cache, signing decision, exact input/config/evidence, lintDebug rồi assembleDebug tuần tự với recheck, independent APK review trước install. Giữ lint abortOnError và permission removal/offline gates. Server loopback từng BLOCKED EACCES: không né quyền. Synthetic persistence/recovery/upgrade và device smoke còn phải xác minh đúng source/artifact.

Đọc AGENTS.md, .agents/skills/financial-assistant-release/SKILL.md, docs/release/RELEASE_RUNBOOK.md và OWNER_PACKET.vi.md. Đây là source handoff, không deployment/install approval. Không tạo workflow/deploy hoặc thay production. Candidate nguồn không có .github/workflows hay cấu hình deploy mới. Audit workflow/rulesets/provider-detail trước đó có endpoint bị chặn/HTTP403 và chưa được hoàn tất bằng route khác. Cơ sở chấp nhận bàn giao là xác nhận hiện hành của owner rằng CashWeave chưa nối dịch vụ triển khai nào, cùng ngoại lệ source-only và admission độc lập; không phải chứng nhận mọi hooks/integrations bên ngoài đã được API audit. Không đổi visibility/plan/security để né403; thông tin integration hoặc remote thay đổi phải đánh giá lại trước hành động tiếp.

## Giữ riêng và bảo toàn

documents/ là dữ liệu tài chính thật: không đọc, hash, copy, upload. evidence/raw logs, .env, credentials, keys, user profiles/database/saves, node_modules, caches, machine config và old APK không nằm trong candidate. .gitignore chỉ hỗ trợ; publish phải dùng exact allowlist, không git add . hoặc broad force-add. Bản local gốc và mọi extra files giữ nguyên. README/manual QA và historical manifests/logs ngoài reviewed141 không tự nhận là tài liệu hiện hành; cần review bổ sung nếu muốn publish. Source packaging script là exact-allowlist tool; không chạy root discovery. Chưa đóng ZIP mới trong lượt chuẩn bị này.

## Quyết định bàn giao source-only đã thực hiện

Owner đã đồng ý ngoại lệ bàn giao source trên nhánh riêng dù native QA chưa đạt và xác nhận: “cashweave chưa nối với dịch vụ triển khai nào”. Miu giao operator đồng bộ; Linh kết luận GO_FOR_PRIVATE_SOURCE_HANDOFF_ONLY cho exact V2, admission report SHA256 cf43f11ed7933a922e87edf8ec15cad7d1d5fd64efded616410af1a8f82f1fde. Reviewed handoff manifest SHA256 d8b982a556e6b3fa186dfe9e844d4a7bedbe74b3d973bada5bedc0231641eb19. Ngoại lệ này đã được dùng để tạo/push đúng113files lên nhánh nêu trên, không phải gate còn chờ cho checkpoint đã hoàn tất và không cấp phép mọi lần push tương lai.

Sau push, remote ref/tree và113/113blob SHA256/bytes khớp exact candidate. Tại lúc readback có0workflow runs,0check runs và0commit statuses; đây là không có CI được quan sát, không phải CI/test PASS. Không tuyên bố provider audit403 đã hoàn tất. Không build/install/deploy, tạo key, thay production hoặc thêm dịch vụ/cost trong lượt bàn giao.

Native QA vẫn BLOCKED/chưa có APK mới; chuyển máy không bỏ native/release/install/privacy/signing/dependency gates. Các cập nhật tài liệu hoặc source tiếp theo cần scope, exact diff/snapshot và review tương ứng trước lịch đồng bộ riêng. Bản cập nhật README này chỉ mô tả checkpoint đã bàn giao, không tự kích hoạt push.

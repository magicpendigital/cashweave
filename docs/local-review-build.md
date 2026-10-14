# Build review CashWeave trong project local

Yêu cầu Node.js 22 trở lên. Dùng các builder Node hiện hành:

```powershell
npm.cmd run build:review
npm.cmd test
```

`npm test` tạo lại hai HTML và manifest từ source hiện tại trước khi chạy test. Output mặc định ở `review-output/` trong project; builder và test dùng cùng đường dẫn, độc lập với thư mục hiện hành của shell. Nếu cần output riêng, đặt `CASHWEAVE_REVIEW_OUTPUT_DIR` cho cả builder và test; đường dẫn tương đối được tính từ project root. Builder không cần Python, không đọc dữ liệu riêng và không sửa module ứng dụng.

`node --test tests/*.test.mjs` trực tiếp cần chạy `npm.cmd run build:review` trước. Các test DOM/bundle dùng fixture giả lập; test server còn cần môi trường được phép kết nối loopback. Nếu bị EACCES, ghi BLOCKED và không đổi quyền hay thử đường khác.

Build web Android nhẹ:

```powershell
node scripts/build-android-web.mjs
node scripts/verify-android-assets.mjs
```

Cần đúng thư viện `@capacitor/core` và `@capacitor/android` 8.5.3 đã kiểm provenance/hash trong `node_modules`. Bản sao thư viện hiện có không phải một lần npm install; không nâng cấp hay tải dependency ở lượt sửa này. Kiểm asset không chứng nhận native lint, APK, chữ ký hay runtime Android.

CAMERA vẫn là `tools:node="remove"`. Chỉ marker này có `tools:ignore="PermissionImpliesUnsupportedChromeOsHardware"`, vì lint lịch sử coi marker loại bỏ quyền là yêu cầu camera; không thêm hardware feature và vẫn giữ `abortOnError true`. Hướng dẫn suppression XML: [Android Developers](https://developer.android.com/studio/write/lint#configure-lint-checking-in-xml). Phải chạy lint mới và kiểm merged/compiled permissions trước khi kết luận lỗi native đã hết.

Builder `build-review.py` còn là công cụ lịch sử; dùng builder Node ở trên. `package-mobile-review.py` đã được thay bằng ứng viên exact-allowlist, blocklist và Windows handle transaction: xem [contract và kiểm fixture](packager-security.md). Chưa dùng packager mới để đóng gói source bàn giao thật tới khi Linh review PASS. Bản cũ giữ trong backup ngoài project để đối chiếu, không chạy nó. Không đổi release profile/checker, package ID, origin, signing config, schema hay save format trong lượt sửa packager.

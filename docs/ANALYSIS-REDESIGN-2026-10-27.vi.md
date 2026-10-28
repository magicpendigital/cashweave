# CashWeave: phân tích sản phẩm, thiết kế lại UX, đánh giá hiệu năng, bảo mật và lộ trình đa nền tảng

Ngày 27/10/2026. Phạm vi: source tại commit `fe5609b` (nhánh `handoff/marketing-20261014`). Đây là tài liệu đánh giá; không thay đổi source ứng dụng, không build/cài APK, không nối dịch vụ online.

Bản thiết kế lại (10 màn hình điện thoại, bấm thử được): https://claude.ai/artifact/NV3jqdQfS6DjzX6dApo9Wc (riêng tư, người khác chỉ mở được sau khi chủ sở hữu chia sẻ).

---

## 1. Tóm tắt

- **Lõi nghiệp vụ tốt hơn mức bình thường của một ứng dụng thu chi.** Tiền lưu bằng số nguyên chuỗi (BigInt), có tiền tệ và múi giờ rõ ràng; sổ chỉ ghi thêm (sửa sai bằng giao dịch đảo, không xoá); mỗi lệnh có `commandId` + hash chống ghi trùng; khôi phục có staging và rollback. Đây là nền móng đúng cho cả bản offline lẫn đồng bộ sau này.
- **UI hiện tại lộ nguyên mô hình kế toán ra cho người dùng.** Người mới gặp các từ "Tiền thực", "Nguồn tiền thực", "dòng đóng góp", "revision", "quỹ tiền tệ", "Phân bổ & mẫu", "Chu kỳ số cố định"; mỗi màn có 1–3 khung cảnh báo; ngày hiển thị dạng `2026-10-27`. Thiết kế lại giữ toàn bộ giá trị cốt lõi nhưng đổi cách nói và luồng: 5 tab, ghi giao dịch 3 chạm, chia quỹ thành bước tự nhiên ngay sau khi nhận tiền.
- **Hiệu năng sẽ hỏng trước khi sản phẩm lớn.** Mỗi lần ghi phải kiểm tra lại toàn bộ dữ liệu, độ phức tạp gần bình phương. Đo trên máy desktop: 2.000 giao dịch → 226 ms cho mỗi lần ghi (chỉ phần tính toán, chưa tính IndexedDB và vẽ lại), điện thoại tầm trung chậm hơn nhiều lần.
- **Rủi ro mất dữ liệu nghiêm trọng (🔴).** Bản sao lưu bị giới hạn 5 MB nhưng mỗi giao dịch chiếm khoảng 1,7 KB, nên sổ khoảng 3.000 giao dịch (chừng 1,5–2 năm dùng đều) sẽ **không xuất được bản sao lưu**. Android đã tắt sao lưu hệ thống (`allowBackup=false`), nên đổi hoặc mất máy là mất sổ.
- **Hướng Capacitor + web UI vẫn hợp lý** cho Android → iOS → đồng bộ, với điều kiện: (1) chuyển lưu trữ sang SQLite có mã hoá và bảng chuẩn hoá, (2) kiểm tra dữ liệu theo từng lệnh thay vì toàn bộ, (3) viết lại lớp UI bằng component có kiểu dữ liệu, (4) thiết kế giao thức đồng bộ dựa trên nhật ký lệnh đã có sẵn.

---

## 2. CashWeave là gì, dành cho ai

**Người dùng mục tiêu** (suy ra từ nội dung tiếng Việt, VND/giờ Việt Nam mặc định, tính năng sổ chung cho hai người): người đi làm và gia đình trẻ ở Việt Nam muốn biết rõ tiền của mình, ngại nhập liệu phức tạp, quan tâm riêng tư (không muốn liên kết ngân hàng hay đưa dữ liệu lên mạng).

**Ba câu hỏi sản phẩm phải trả lời được:**
1. Tôi đang có bao nhiêu tiền và tiền đó nằm ở đâu?
2. Sắp tới tôi phải trả, hoặc sẽ nhận, những khoản nào? Cuối tháng còn lại bao nhiêu?
3. Tiền này đã được dành cho việc gì (tiền nhà, ăn uống, dự phòng, mục tiêu)?

### Bản đồ tính năng và giá trị

| Tính năng | Code | Người dùng được gì | Mức cốt lõi |
|---|---|---|---|
| Tạo sổ: tiền tệ, múi giờ, tài khoản đầu tiên, số dư đầu kỳ | `core/commands.js` `onboard`, `ui/app.js` `onboarding()` | Bắt đầu từ số dư hôm nay, không phải nhập lại giao dịch cũ | Cốt lõi |
| Tài khoản Ngân hàng / Tiền mặt, nhiều tiền tệ, lưu trữ (archive) | `addAccount`, `archiveEntity` | Biết tiền ở đâu | Cốt lõi |
| Ghi thu / chi / chuyển khoản, có danh mục và ghi chú | `recordActual` | Thói quen hằng ngày; chuyển khoản không bị tính là thu nhập | Cốt lõi |
| Sửa sai bằng đảo hoặc thay thế, luôn giữ bản gốc | `reverseOperation`, `replaceOperation` | Lịch sử đáng tin, không mất dấu | Cốt lõi (nên ẩn cơ chế) |
| Lịch thu chi: khoản một lần hoặc hằng tháng, trả một phần, dời ngày, bỏ qua, chốt | `createPlan`, `createMonthlyPlan`, `linkSettlement`, `reschedulePlan`, `closePlan` | Không quên khoản phải trả hoặc khoản sắp nhận | Cốt lõi |
| Dự báo: số dư thực + khoản còn chờ | `queryReport('ForecastAsOf')` | "Cuối tháng còn bao nhiêu?" | Giá trị cao |
| Quỹ mục đích (envelope) + công thức chia (số cố định trước, phần trăm phần còn lại, ưu tiên khi thiếu, phần dư) | `core/allocation.js`, `saveTemplate`, `confirmAllocation` | Dành tiền theo mục đích mà không cần nhiều tài khoản ngân hàng | Khác biệt, nhưng khó hiểu nhất |
| Gắn khoản chi vào quỹ | `linkExpense` | Biết quỹ còn bao nhiêu | Nâng cao |
| Báo cáo theo kỳ, danh mục, tài khoản; dòng thời gian số dư từng ngày | `core/reports.js` | Nhìn lại chi tiêu | Giá trị cao |
| Lịch sử thay đổi (audit) | `historyView()` | Minh bạch | Phụ |
| Sao lưu JSON / khôi phục có xem trước + rollback; chuyển dữ liệu bản v1 | `core/migration.js`, `LocalBackupPlugin.java` | Không mất dữ liệu khi đổi máy | Cốt lõi (vì không có cloud) |
| Sổ thử (sandbox) | `openNamespace('sandbox')` | Thử mà không ảnh hưởng sổ thật | Phụ |
| Sổ chung hai người (đồng thuận, đóng góp, ứng trước, hoàn tiền, chốt tháng) | `couples.js`, `ui/shared-view.js` | Chia sẻ tiền chung minh bạch | **Chỉ là mô phỏng**, mất khi tải lại trang |

**Giá trị khác biệt cần giữ:** riêng tư/offline, sổ không bao giờ "trôi" số (đúng tiền, đúng ngày, sửa sai có dấu vết), và quỹ mục đích kèm công thức chia lương. Thiết kế lại phải làm ba điều này *dễ thấy*, không làm mất chúng.

---

## 3. Đánh giá UI/UX hiện tại (design critique)

Phương pháp: đọc `ui/app.js`, `ui/i18n.js`, `ui/next.css`; chạy `next.html` ở khổ 375 px, tạo sổ thật với dữ liệu giả.

### Ấn tượng chung
Màn chào mừng sạch sẽ và lời mời rõ ràng. Từ Tổng quan trở đi, ứng dụng giống một **công cụ đối soát kế toán**: nhiều bảng, nhiều nhãn kỹ thuật, nhiều cảnh báo phủ định ("không chuyển tiền…", "không ghi chi phí…"). Người mới không biết bước tiếp theo nên làm gì.

### Khả năng sử dụng

| Vấn đề | Mức | Đề xuất |
|---|---|---|
| Thuật ngữ nội bộ lộ ra UI: "Tiền thực cuối kỳ", "Nguồn tiền thực", "dòng đóng góp", "revision", "quỹ tiền tệ", "Chu kỳ số cố định", "PER_APPLICATION/CALENDAR_MONTH" | 🔴 | Bảng thuật ngữ mới (mục 4.3); ẩn khái niệm pool, source, revision khỏi UI |
| "Phân bổ & mẫu" là tab chính nhưng cần hiểu 4 khái niệm (quỹ, mẫu, nguồn, phân bổ) trước khi dùng được | 🔴 | Gộp vào Kế hoạch › Quỹ; chia tiền là gợi ý ngay sau khi ghi khoản thu |
| Sửa giao dịch cần chọn giữa "Hoàn tác" và "Sửa sai", cả hai đều bắt nhập lý do | 🟡 | Một nút "Sửa"; app tự đảo và thay thế, lý do không bắt buộc |
| Ghi giao dịch là một form dài 7 trường; danh mục là dropdown | 🟡 | Bàn phím số + chip danh mục, mặc định "Hôm nay"; 3 chạm |
| Mỗi màn có 1–3 khung `notice` giải thích phủ định | 🟡 | Giữ một câu ngắn ở đúng chỗ cần, phần còn lại đưa vào Hướng dẫn |
| Bộ lọc kỳ (`2026-10-01 → 2026-10-27 · VND`) là thứ đầu tiên trên mọi màn | 🟡 | Mặc định "Tháng này", đổi bằng bộ chọn tháng |
| Lưu xong trang không cuộn về đầu (đo được: sau khi tạo sổ, `scrollY = 915`, màn hình trống) | 🟡 | Đặt lại vị trí cuộn và focus khi đổi route |
| Số dư đầu kỳ hiện chữ tiếng Anh "Opening balance" trong UI tiếng Việt (`core/commands.js:31`) | 🟢 | Lưu loại thao tác; UI tự dịch nhãn |
| Nút "Cá nhân / Không gian chung" luôn chiếm chỗ dù sổ chung chỉ là mô phỏng | 🟢 | Ẩn cho tới khi tính năng thật sẵn sàng |
| Không có cảnh báo khi đã lâu chưa sao lưu, dù đây là cách duy nhất giữ dữ liệu | 🔴 | Thẻ nhắc sao lưu theo số ngày, đặt ở Thêm và Trang chủ |

### Thứ bậc thị giác
- **Mắt nhìn vào đâu trước:** thẻ "Tiền thực cuối kỳ" (đúng), nhưng ngay dưới là 3 thẻ cùng cỡ ("Thu thực", "Chi thực", "Biến động"), có nhãn "TIỀN THỰC" và "Phạm vi" lặp lại, làm loãng ý chính.
- **Luồng đọc:** dài và đều đều: bảng, bảng, bảng. "Khoản sắp phải trả", điều người dùng cần hành động, nằm giữa và không có nút hành động trực tiếp.
- **Nhấn mạnh:** nút xanh "Ghi tiền" ở header đúng; nhưng bottom nav có 4 mục ngang hàng, trong đó "Phân bổ & mẫu" bị xuống 2 dòng chữ.

### Nhất quán
| Thành phần | Vấn đề | Đề xuất |
|---|---|---|
| Chữ | 11 cỡ chữ khác nhau trong `ui/next.css`, nhiều chữ 10–13 px | Thang 5 cỡ: 13/15/17/22/34 |
| Bảng | Bảng nhiều cột co lại thành thẻ trên mobile, mỗi màn mỗi kiểu | Danh sách dạng dòng thống nhất (tiêu đề, phụ đề, số tiền bên phải) |
| Ngày | ISO `2026-10-27` ở hầu hết chỗ, `dd/mm` ở lịch sử | `Hôm nay`, `Thứ Hai · 26/10`, `05/11` |

### Khả năng tiếp cận
- Tương phản: màu chữ chính `#17322f` và brand `#225e49` trên nền sáng đạt chuẩn; nhãn 11 px màu `#5f746c` vừa sát ngưỡng vừa quá nhỏ.
- Vùng chạm: phần lớn ≥ 44 px (tốt). Nhãn trong bottom nav xuống dòng.
- Điểm làm tốt: modal lọc có focus trap, Escape, `inert`, `aria-modal`; nút Back Android được xử lý đúng.

### Điểm làm tốt
- Onboarding có chữ hướng dẫn tốt, tôn trọng người dùng ("không có giao dịch mẫu").
- Lưu nháp form khi điều hướng; chặn bấm trùng khi đang ghi; thông báo xung đột nhiều tab.

---

## 4. Thiết kế lại

Canvas: https://claude.ai/artifact/NV3jqdQfS6DjzX6dApo9Wc. Dữ liệu trong canvas đều là dữ liệu giả.

### 4.1 Nguyên tắc
1. **Trả lời 3 câu hỏi ở Trang chủ** (đang có bao nhiêu, sắp trả gì, tiền chưa có mục đích) mà không cần chọn kỳ hay bộ lọc.
2. **Hành động đặt cạnh thông tin:** khoản sắp trả có nút "Đã trả", tiền chưa có mục đích có nút "Chia vào quỹ".
3. **Ẩn cơ chế kế toán, giữ sự thật kế toán:** vẫn đảo/thay thế, revision, nguồn tiền phía sau; người dùng chỉ thấy "Sửa" và nhãn "Đã sửa".
4. **Từ chuyên sâu để sau:** công thức chia, ưu tiên khi thiếu, phạm vi số cố định chỉ hiện khi tạo hoặc sửa công thức.
5. **Riêng tư thể hiện bằng tính năng**, không bằng cảnh báo: khoá vân tay, che số dư, nhắc sao lưu.

### 4.2 Kiến trúc thông tin mới

| Tab | Nội dung | Thay cho |
|---|---|---|
| Trang chủ | Số dư tổng + theo loại tài khoản, thu/chi tháng, gợi ý chia quỹ, sắp phải trả (có "Đã trả"), gần đây | Tổng quan |
| Sổ | Danh sách theo ngày, tìm kiếm, chip Chi/Thu/Chuyển, bộ chọn tháng | Sổ giao dịch + bộ lọc kỳ |
| **＋** (nút giữa) | Ghi nhanh: Chi/Thu/Chuyển, bàn phím số, chip danh mục | Form "Giao dịch mới" |
| Kế hoạch | Phân đoạn **Sắp đến hạn** (dự báo cuối tháng + danh sách) / **Quỹ** (thanh tiến độ) | Lịch thu chi + Dự kiến + Phân bổ & mẫu |
| Thêm | Nhắc sao lưu, Tài khoản, Báo cáo, Danh mục, Bảo mật, Sao lưu & khôi phục, Lịch sử, Hướng dẫn | Menu + Cài đặt & dữ liệu |

Sổ chung **ẩn** cho tới khi có phiên bản thật ở giai đoạn 3.

### 4.3 Bảng thuật ngữ

| Hiện tại | Mới |
|---|---|
| Tiền thực cuối kỳ | Bạn đang có |
| Thu thực / Chi thực trong kỳ | Thu tháng 10 / Chi tháng 10 |
| Lịch thu chi, Khoản dự kiến | Sắp đến hạn, Khoản sắp thu / sắp trả |
| Quỹ mục đích, Phân bổ & mẫu | Hũ (chữ "Quỹ" dành cho quỹ đầu tư/chứng chỉ quỹ, xem mục 9) |
| Mẫu phân bổ | Phương pháp chia tiền |
| Tiền chưa dành mục đích | Chưa có mục đích |
| Nguồn tiền thực | Từ khoản thu |
| Hoàn tác thao tác / Sửa sai | Sửa (lịch sử tự lưu, nhãn "Đã sửa") |
| Chốt kế hoạch / Bỏ qua kỳ | Đã xong / Bỏ qua tháng này |
| Dự kiến (Forecast) | Cuối tháng bạn còn khoảng |
| Số dư đầu kỳ | Hiện có bao nhiêu? |

### 4.4 Các màn hình trong canvas
1. **Chào mừng:** 3 lợi ích (tiền ở đâu, không quên khoản phải trả, riêng tư), "Bắt đầu – chỉ mất 1 phút", "Tôi đã có bản sao lưu".
2. **Tạo sổ (1 màn):** chọn Ngân hàng hoặc Tiền mặt, tên gọi tự điền, số dư hôm nay; tiền tệ và múi giờ gom thành một dòng "Đổi".
3. **Trang chủ:** thẻ số dư lớn, gợi ý chia quỹ, Sắp phải trả với nút "Đã trả", Gần đây.
4. **Ghi nhanh (bấm thử được):** chuyển Chi/Thu/Chuyển, bàn phím số chạy thật, chip danh mục đổi theo loại; khi chọn Chuyển có giải thích "không tính là thu hay chi".
5. **Sổ (bấm thử được):** lọc theo loại, nhóm theo ngày, nhãn "Đã sửa".
6. **Kế hoạch › Sắp đến hạn:** dự báo cuối tháng có thanh tỉ lệ, khoản quá hạn nổi bật, nhãn "Hằng tháng", trả một phần ("Trả tiếp").
7. **Kế hoạch › Quỹ:** một câu giải thích quỹ, thẻ "Chưa có mục đích" kèm nút chia, thanh tiến độ cho từng quỹ.
8. **Chia vào quỹ (bấm thử được):** chọn số tiền, công thức tự tính số cố định trước rồi % phần còn lại, cảnh báo khi không đủ, "Còn lại để tiêu tự do".
9. **Báo cáo:** bộ chọn tháng, Thu/Chi/Để dành được, một câu so sánh với tháng trước, thanh chi theo danh mục.
10. **Thêm:** thẻ "Sao lưu lần cuối: 12 ngày trước", công tắc khoá vân tay và che số dư (bấm thử được), sao lưu có mật khẩu.
11. **Phương pháp chia tiền (bấm thử được):** thư viện phương pháp có sẵn (6 chiếc hũ, 50/30/20, Trả cho mình trước, Mỗi đồng một việc) và phương pháp người dùng đã tạo; chạm để xem tỷ lệ chi tiết và "hợp với ai".
12. **Tự tạo phương pháp (bấm thử được):** đổi từng hũ giữa "Số cố định" và "% phần còn lại", tăng/giảm giá trị, thêm hũ, xem trước kết quả với khoản lương 18,5 triệu, cảnh báo khi tổng vượt 100%.
13. **Tổng tài sản:** tài sản ròng, tỷ trọng theo nhóm (tiền, chứng khoán, chứng chỉ quỹ, vàng, crypto), lãi/lỗ, độ cũ của giá, khoản nợ.
14. **Cập nhật giá (bấm thử được):** nhập giá theo mã (chứng khoán, crypto kèm tỷ giá USDT) hoặc nhập tổng giá trị (chứng chỉ quỹ, vàng); tổng tính lại ngay; nút nhập sao kê CSV.

### 4.5 Hệ thiết kế đề xuất
- Font **Be Vietnam Pro** (hiển thị dấu tiếng Việt tốt), số dùng `tabular-nums`.
- Nền `#F6F7F2`, chữ `#17211C`, chữ phụ `#5B6B63`, brand `#1F5A45` (giữ tinh thần màu xanh hiện có), cảnh báo/đến hạn `#9A5418` trên `#FBEFD9`, thu nhập `#1C6B45`.
- Bo góc 12–16 px, vùng chạm ≥ 44 px, bottom nav 5 mục với nút ＋ ở giữa.

---

## 5. Hiệu năng

### 5.1 Số đo (Node 22, máy desktop, `scratchpad/bench.mjs`; chỉ đo `prepareCommand` và `queryReport`, chưa tính IndexedDB, chưa tính vẽ DOM)

| Số giao dịch | Mỗi lần ghi | `validateSnapshot` | `structuredClone` | Báo cáo chi 9 tháng | Kích thước JSON |
|---|---|---|---|---|---|
| 100 | 6 ms | 3 ms | 1 ms | 2 ms | 0,17 MB |
| 500 | 39 ms | 17 ms | 3 ms | 3 ms | 0,83 MB |
| 1.000 | 82 ms | 36 ms | 6 ms | 10 ms | 1,65 MB |
| 2.000 | 226 ms | 106 ms | 13 ms | 25 ms | 3,31 MB |

Thời gian ghi tăng nhanh hơn tuyến tính: số giao dịch tăng 2 lần thì thời gian tăng khoảng 2,8 lần. Benchmark tự dừng ở giao dịch thứ 2.210 do vượt 240 giây tổng. WebView trên điện thoại tầm trung thường chậm hơn desktop vài lần (ước lượng, chưa đo trên thiết bị), nên khoảng 2.000 giao dịch là mỗi lần bấm "Lưu" có thể mất khoảng 1 giây.

### 5.2 Nguyên nhân
1. **Kiểm tra toàn bộ dữ liệu, độ phức tạp O(n²)** trong `core/model.js` `validateSnapshot`: các vòng lặp `for posting of postings` lồng `state.settlements.filter(...)`, `state.postings.find(p=>p.reversesPostingId===…)`, `state.spendLinks.filter(...)`; `entity()` tìm tuyến tính bằng `find`.
2. **Mỗi thao tác chạy kiểm tra nhiều lần.** Riêng đường IndexedDB: `readSnapshot` (validate + clone) → `prepareCommand` (validate trước + clone + validate sau) → UI `readSnapshot` lại (validate) → `validateSnapshot` lần nữa trong `perform` (`ui/app.js:94`). Tổng cộng khoảng 5 lần kiểm tra toàn bộ và 4 lần clone.
3. **Ghi lại cả snapshot** (`snapshots.put(prepared.snapshot)`) cho mỗi giao dịch, vài MB mỗi lần.
4. **Mỗi giao dịch sinh 4 bản ghi** (operation, posting, receipt, audit) với metadata lặp lại, khoảng 1,7 KB/giao dịch.
5. **UI vẽ lại toàn bộ DOM** mỗi lần thay đổi (`root.replaceChildren(...)`) và tính lại báo cáo bằng cách quét mảng (`accountBalance`, `planSummary` gọi trong vòng lặp).
6. **Ứng dụng web chưa được bundle hoặc minify** (`minifyEnabled false`, nạp module ES rời) — ảnh hưởng nhỏ so với 5 điểm trên.

### 5.3 Hệ quả gắn với sản phẩm
- 🔴 **Giới hạn sao lưu 5 MB** (`core/migration.js:8`, `LocalBackupPlugin.MAX_BYTES`): khoảng 3.000 giao dịch là `BACKUP_TOO_LARGE`, nên không xuất được và cũng không khôi phục được. Với 5 giao dịch/ngày, mốc này đến sau khoảng 20 tháng.
- Giới hạn 100.000 bản ghi mỗi collection trong `validateSnapshot`, chạm tới khi khoảng 25.000 giao dịch (vì receipt và audit cũng là bản ghi).

### 5.4 Đề xuất (theo thứ tự lợi ích/chi phí)
1. **Sửa ngay, không đổi kiến trúc:** bỏ các lần validate thừa (chỉ validate khi nhập/khôi phục; sau lệnh chỉ kiểm tra bất biến liên quan); đổi `entity()` sang `Map` chỉ mục; dựng chỉ mục `reversesPostingId`, `ledgerPostingId`, `expensePostingId` một lần mỗi lần validate để từ O(n²) xuống O(n). Nâng hoặc bỏ giới hạn 5 MB, nén backup (gzip qua `CompressionStream`), bỏ `audit` trùng `receipts` khỏi file xuất.
2. **Lưu trữ:** chuyển sang **SQLite** (plugin Capacitor SQLite, có hỗ trợ SQLCipher) với bảng chuẩn hoá: `accounts`, `operations`, `postings`, `occurrences`, `allocations`…; chỉ mục theo `account_id, effective_date`; mỗi lệnh là một transaction chỉ ghi những dòng mới; số dư và báo cáo tính bằng SQL hoặc projection cache gắn revision. Giữ hợp đồng repository hiện có (`runAtomicCommand`, `stageRestore`, `activateStage`, `rollback`) để core và test không đổi.
3. **UI:** chuyển sang component (Preact/Svelte/Lit + TypeScript) với cập nhật cục bộ, danh sách ảo hoá cho Sổ; bundle và minify bằng Vite/esbuild.
4. **Benchmark trên thiết bị thật** (Android tầm trung, 10k/50k giao dịch) làm cổng release: thời gian mở app, lưu một giao dịch, mở báo cáo, xuất sao lưu.

---

## 6. Bảo mật và riêng tư

| # | Phát hiện | Mức | Bằng chứng | Đề xuất |
|---|---|---|---|---|
| S1 | Sao lưu không xuất được khi sổ lớn, trong khi sao lưu hệ thống bị tắt → mất dữ liệu khi đổi hoặc mất máy | 🔴 Toàn vẹn/khả dụng | `MAX_BYTES` 5 MB; `allowBackup="false"`, `data_extraction_rules.xml` loại trừ mọi domain | Mục 5.4.1 + nhắc sao lưu định kỳ + sao lưu tự động vào thư mục người dùng chọn (SAF, quyền URI lâu dài) |
| S2 | Dữ liệu tài chính lưu **không mã hoá** trong IndexedDB của WebView | 🟡 | `openIndexedDbRepository` | SQLite + SQLCipher, khoá sinh ngẫu nhiên giữ trong Android Keystore / iOS Keychain |
| S3 | Bản sao lưu JSON **không mã hoá**; người dùng thường gửi qua Zalo/Drive | 🟡 | chữ `plaintext` trong UI, `exportSnapshot` | Sao lưu có mật khẩu: Argon2id/PBKDF2 → AES-GCM; vẫn cho phép xuất thường nếu người dùng chọn rõ |
| S4 | Không có khoá ứng dụng; số dư lộ trong danh sách ứng dụng gần đây và ảnh chụp màn hình | 🟡 | Không có `FLAG_SECURE`, không có BiometricPrompt | Khoá vân tay/PIN (BiometricPrompt / LocalAuthentication), `FLAG_SECURE` có tuỳ chọn |
| S5 | Sổ chung dựng HTML bằng chuỗi + `innerHTML` (có `esc()`), dễ sót khi mở rộng | 🟢 | `ui/shared-view.js:60-64` | Dùng chung DOM builder an toàn như `ui/dom.js`; CSP `script-src 'self'` hiện đang giảm thiểu |
| S6 | Bản release tắt R8/minify | 🟢 | `minifyEnabled false` | Bật R8 + quy tắc keep cho Capacitor (giảm kích thước, khó dịch ngược hơn) |
| S7 | Hai UI song song (bản v1 `index.html/app.js` và bản next) cùng hai bản sổ chung | 🟢 Nợ kỹ thuật | `app.js`, `couples-app.js`, `shared-embed.js` (70 KB) | Sau khi chuyển dữ liệu v1, gỡ bản v1 khỏi gói Android |

**Đang làm tốt (giữ nguyên):** gỡ quyền INTERNET/ACCESS_NETWORK_STATE/bộ nhớ; CSP chặt (`connect-src 'none'`, `default-src 'none'`); tắt CapacitorHttp/Cookies, WebView debugging, cleartext, mixed content; plugin sao lưu dùng SAF, không lưu payload vào log/preferences, có timeout, giới hạn byte, huỷ được; khôi phục có fingerprint SHA-256, staging, xác nhận hai bước và rollback; tách namespace sandbox.

---

## 7. Đánh giá hướng tiếp cận đa nền tảng

### Giai đoạn 1 – Android offline
**Hướng hiện tại phù hợp:** một codebase web chạy trong Capacitor, lõi nghiệp vụ thuần JS tách khỏi DOM, adapter native cho sao lưu và nút Back, không cần mạng.

**Cần bổ sung trước khi phát hành rộng:**
1. Sửa S1 (giới hạn sao lưu + nhắc sao lưu).
2. Áp UI mới và component hoá lớp UI (mục 5.4.3).
3. Chuyển sang SQLite + SQLCipher qua adapter repository, kèm migration một chiều từ IndexedDB có rollback (đã có sẵn khung staging/activate).
4. Khoá ứng dụng, `FLAG_SECURE`.
5. Benchmark trên thiết bị thật làm cổng release.

### Giai đoạn 2 – iOS
**Capacitor giúp tái sử dụng gần như toàn bộ** UI và core. Phần phải làm riêng:
- Plugin sao lưu iOS cùng hợp đồng với `LocalBackup` (`UIDocumentPickerViewController`, huỷ, lỗi, giới hạn byte).
- Keychain cho khoá mã hoá, Face ID/Touch ID, chặn chụp màn hình (che khi vào nền).
- Lưu trữ: SQLite trong thư mục ứng dụng, loại trừ khỏi iCloud nếu giữ lập trường offline; tránh phụ thuộc IndexedDB của WKWebView.
- Toolchain Xcode, chứng chỉ và tài khoản Apple Developer, quy trình review của App Store (khai báo quyền riêng tư).
- Tách code đặc thù nền tảng sau một interface `platform` (back, safe area, file, biometrics) để UI không rẽ nhánh theo nền tảng.

### Giai đoạn 3 – Đồng bộ theo tài khoản
**Nền tảng sẵn có rất có lợi:** sổ chỉ ghi thêm (đảo thay vì xoá), UUID cho mọi bản ghi, `commandId` + `payloadHash` (idempotency), receipt, `expectedRevision`. Đây gần như đúng mô hình **outbox + nhật ký lệnh** của các hệ đồng bộ offline-first.

**Cần thay đổi:**
1. **Revision toàn sổ → chuỗi sự kiện.** Hiện mỗi lệnh yêu cầu `expectedRevision` khớp toàn sổ, nên hai máy offline sẽ luôn xung đột. Cần: lệnh ghi local vào outbox → đẩy lên server → server áp theo thứ tự, gán `server_seq` → các máy kéo delta theo cursor. Lệnh tạo mới (giao dịch, đảo) gần như không xung đột; lệnh sửa thuộc tính (đổi tên, lưu trữ, sửa kế hoạch) cần quy tắc rõ ràng theo từng loại.
2. **Bất biến cần server làm trọng tài.** Hai máy cùng chia một khoản thu vào quỹ khi offline có thể vượt dung lượng nguồn (`SOURCE_CAPACITY_EXCEEDED`). Server chạy cùng bộ kiểm tra (lợi thế lớn của core JS: chạy được trên Node), từ chối lệnh vi phạm, máy khách hiện trạng thái "Cần xử lý" thay vì âm thầm ghi đè. Không dùng "ghi sau thắng" cho số dư hay phân bổ.
3. **Định danh và quyền.** Dataset gắn với `user_id`/`space_id`; server tự xác thực mọi đọc/ghi, không tin `actorId` từ client (đúng như `ARCHITECTURE-DECISION-001` đã ghi). Đăng nhập không tự đẩy sổ local lên; có bước "Đưa sổ này lên tài khoản" với xem trước.
4. **Riêng tư như một tính năng.** Cân nhắc mã hoá đầu cuối (khoá dẫn xuất từ mật khẩu sổ hoặc passkey) để giữ lời hứa "chỉ bạn xem được"; đánh đổi là báo cáo phía server bị hạn chế và phải có quy trình khôi phục khoá.
5. **Backend.** Postgres + API mỏng (Node dùng lại core), hoặc dịch vụ quản lý có Row Level Security; xác thực bằng Google/Apple Sign-In hoặc passkey. Cần threat model, rate limit, sao lưu/khôi phục server, chính sách xoá và xuất dữ liệu trước khi mở cho người dùng thật.
6. **Sổ chung** viết lại trên cùng mô hình server-authoritative; bản mô phỏng hiện tại chỉ dùng làm tài liệu luồng UX.

### Kết luận về hướng tiếp cận
Capacitor + web UI + core JS **đã là lựa chọn tối ưu về chi phí** cho đội nhỏ đi đủ ba giai đoạn, và không cần viết lại bằng React Native/Kotlin/Swift. Điểm **chưa tối ưu** không nằm ở runtime mà ở lớp dữ liệu (snapshot toàn bộ, kiểm tra O(n²), giới hạn sao lưu) và lớp UI (một closure lớn vẽ lại toàn bộ). Sửa hai lớp này trong giai đoạn 1 thì giai đoạn 2 chủ yếu là plugin native, còn giai đoạn 3 xây trên nhật ký lệnh đã có.

---

## 8. Lộ trình đề xuất

| Bước | Việc | Kết quả kiểm chứng |
|---|---|---|
| 1A | Hotfix dữ liệu: bỏ validate thừa, chỉ mục Map, nâng giới hạn và nén sao lưu, nhắc sao lưu | Benchmark 10k giao dịch < 50 ms/lần ghi trên desktop; xuất được sổ 10k |
| 1B | UI mới theo canvas, component + TypeScript, bundle | Test UI hiện có chuyển sang flow mới; thử với 5 người dùng mới (tạo sổ, ghi 3 giao dịch, thêm 1 khoản hằng tháng, chia lương) |
| 1C | SQLite + SQLCipher, migration từ IndexedDB, khoá ứng dụng, `FLAG_SECURE` | Test contract repository chạy trên cả hai adapter; kiểm thử nâng cấp trên thiết bị |
| 2 | iOS: plugin sao lưu, Keychain, Face ID, build/ký | Cùng bộ test hành vi trên Android và iOS |
| 3A | Thiết kế giao thức đồng bộ (outbox, server_seq, quy tắc xung đột theo lệnh), threat model | Tài liệu + test hai máy, offline lâu, trùng lệnh, đảo thứ tự |
| 3B | Backend + auth + pilot với dữ liệu giả | Server từ chối lệnh vi phạm bất biến; khôi phục server được diễn tập |

---

## 9. Tài sản đầu tư (chứng khoán, chứng chỉ quỹ, crypto, vàng)

Màn hình: 13 · Tổng tài sản, 14 · Cập nhật giá.

### 9.1 Nguyên tắc: tách tiền để tiêu khỏi tài sản đầu tư
| Sự kiện | Ghi thế nào | Tính vào chi tiêu? |
|---|---|---|
| Chuyển tiền sang công ty chứng khoán, sàn crypto, tài khoản chứng chỉ quỹ | Chuyển khoản giữa hai tài khoản của mình | Không |
| Mua/bán tài sản | Giao dịch đầu tư: tiền mặt trong tài khoản đầu tư giảm/tăng, số lượng tài sản tăng/giảm | Không |
| Cổ tức, lãi trái phiếu, staking | Thu nhập, danh mục "Thu từ đầu tư" | Có (là khoản thu) |
| Phí, thuế | Chi phí, hoặc cộng vào giá vốn | Có, tách riêng |
| Giá lên xuống | Định giá, không phải giao dịch | Không; chỉ đổi tổng tài sản |

### 9.2 Mở rộng mô hình dữ liệu
- Loại tài khoản mới: `INVESTMENT`, `E_WALLET`, sau đó `LIABILITY`. Tài khoản đầu tư mặc định đặt `includeInBudget=false` (cờ này đã có trong core), nên không ảnh hưởng hũ và "Chưa có mục đích".
- Collection mới:
  - `assets`: mã, loại, đơn vị, số chữ số lẻ;
  - `positions`/`lots`: số lượng dạng số nguyên chuỗi, giá vốn;
  - `prices`: tài sản, ngày, giá, nguồn;
  - `fxRates`: tỷ giá để quy đổi.
- Định giá là báo cáo tính ra, không sinh bút toán, nên các bất biến hiện có của sổ giữ nguyên.
- Lãi/lỗ đã chốt tính theo giá vốn bình quân.
- `spendLinks` cần nhận cả chuyển khoản sang tài khoản ngoài ngân sách, để hũ "Đầu tư hằng tháng" giảm khi nạp tiền vào CTCK.

### 9.3 Hai mức theo dõi (giai đoạn 1, offline)
1. **Chỉ nhập tổng giá trị** theo định kỳ: phù hợp chứng chỉ quỹ, vàng, người không muốn nhập từng mã.
2. **Theo mã:** số lượng × giá do người dùng nhập; nhập sao kê CSV qua bộ chọn tệp.

Luôn hiện độ cũ của giá; giá quá 7 ngày đổi sang màu cảnh báo.

### 9.4 Giai đoạn 3 (online, cần duyệt riêng)
- Giá tự động lấy qua máy chủ của mình: giá HOSE/HNX, NAV chứng chỉ quỹ, giá crypto.
- Kết nối sàn chỉ nhận API key chỉ đọc. Từ chối key có quyền giao dịch hoặc rút tiền. Key được mã hoá trong Keystore/Keychain hoặc trên server.
- Mọi tính năng online chỉ bật khi người dùng chủ động chọn.

### 9.5 Bảo mật và pháp lý
- Dữ liệu danh mục đầu tư nhạy cảm hơn dữ liệu chi tiêu: khoá ứng dụng, che số dư và mã hoá SQLite trở thành bắt buộc.
- App chỉ theo dõi, không khuyến nghị mua bán, để tránh vướng quy định về tư vấn đầu tư.

---

## 10. Phương pháp chia tiền (thư viện có sẵn + tự tạo)

Màn hình: 11 · Phương pháp chia tiền, 12 · Tự tạo phương pháp. Lối vào: Kế hoạch › Hũ › "Phương pháp chia", và nút "Đổi/Sửa" trong màn Chia vào hũ.

### 10.1 Phương pháp có sẵn và cách ánh xạ vào core
Core đã hỗ trợ đúng dạng công thức cần thiết (`core/allocation.js`):
- khoản cố định được chia trước;
- phần trăm tính trên phần còn lại, tổng ≤ 100%;
- khi thiếu tiền: chặn, hoặc chia theo thứ tự ưu tiên;
- phần dư: để "chưa có mục đích" hoặc dồn vào một hũ.

Vì vậy mỗi phương pháp có sẵn chỉ là một mẫu dựng sẵn:

| Phương pháp | Các hũ | Cấu hình core |
|---|---|---|
| 6 chiếc hũ | Thiết yếu 55%, Tự do tài chính 10%, Tiết kiệm dài hạn 10%, Học tập 10%, Hưởng thụ 10%, Cho đi 5% | 6 dòng PERCENT, tổng 100% |
| 50/30/20 | Thiết yếu 50%, Mong muốn 30%, Tiết kiệm & trả nợ 20% | 3 dòng PERCENT |
| Trả cho mình trước | Tiết kiệm & đầu tư 20%, phần còn lại tiêu tự do | 1 dòng PERCENT 20%, `leftoverPolicy=UNASSIGNED` |
| Mỗi đồng một việc | Số cụ thể cho từng hũ, phần dư vào Dự phòng | Dòng FIXED, `shortagePolicy=PARTIAL_BY_PRIORITY`, `leftoverPolicy=ENVELOPE` |
| Tự tạo | Kết hợp tuỳ ý cố định và % | Như hiện tại |

### 10.2 Việc cần làm trong core
- **Lệnh mới `applyRecipePreset`:** trong một lệnh atomic, tạo các hũ còn thiếu (hoặc ghép với hũ có sẵn theo tên) rồi lưu phiên bản mẫu. Tránh tình trạng người dùng phải tự tạo 6 hũ trước như luồng hiện tại.
- Lưu `presetId` và phiên bản preset trên mẫu, để sau này có thể cập nhật mô tả mà không đổi số liệu lịch sử. `frozenInput` hiện có đã giữ đúng số đã chia.
- **Validate ngay khi chỉnh:** báo khi tổng % > 100 (core đang trả `PERCENT_OVER_100`, UI hiện thông báo trước khi lưu). Giới hạn 12 hũ trong UI, ít hơn mức 100 dòng của core.
- **Nội dung:** mô tả phương pháp ngắn, kèm câu "để tham khảo, không phải lời khuyên tài chính".
